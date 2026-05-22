// Spawn the sidecar via CEP's Node.js (`--enable-nodejs` in manifest)
// if it isn't already reachable on 127.0.0.1:8765.
//
// Strategy:
//   1. Probe /health with a short timeout. If alive, no-op.
//   2. Otherwise, resolve the sidecar directory by walking up from the
//      extension's real path (realpathSync — the extension is loaded via
//      symlink from Adobe's per-user CEP extensions folder).
//   3. Spawn `<python> -m app.main` detached, headless. Try a Python on PATH
//      first, fall back to known install locations.
//   4. Poll /health up to ~15s waiting for it to come up.
//
// Cross-platform notes:
//   - Windows: pythonw.exe (no console window). Stop = taskkill /T /F because
//     uvicorn forks workers and Node's process.kill leaves children running.
//   - macOS:   python3. Spawned with `detached: true` Node sets the child as
//     a new process group leader; stop = kill(-pgid, SIGTERM) to take the
//     workers down with it.

const SIDECAR_URL = 'http://127.0.0.1:8765';
const IS_WIN = typeof process !== 'undefined' && process.platform === 'win32';

const PYTHON_CANDIDATES = IS_WIN
  ? [
      'pythonw',
      'C:\\Python310\\pythonw.exe',
      'C:\\Python311\\pythonw.exe',
      'C:\\Python312\\pythonw.exe',
    ]
  : [
      // macOS — order matters: PATH first, then Homebrew (Apple-silicon, Intel),
      // then Python.org framework installs, then system.
      'python3',
      '/opt/homebrew/bin/python3',
      '/usr/local/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.12/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.11/bin/python3',
      '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3',
      '/usr/bin/python3',
    ];

// PID of the sidecar process WE spawned (null if /health was already alive at
// panel boot — in that case the sidecar was started elsewhere and we leave it
// alone on Pr quit). Tracked in module scope so stopSpawnedSidecar() can find
// it from the beforeunload / ApplicationBeforeQuit handlers in panel.js.
let spawnedPid = null;

async function isAlive(timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(SIDECAR_URL + '/health', { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch (_) {
    return false;
  }
}

function resolveSidecarDir() {
  // CEP exposes Node.js as the standard `require`.
  if (typeof require !== 'function') return null;
  try {
    const path = require('path');
    const fs = require('fs');
    // CSInterface is loaded via <script> in index.html → global.
    const cs = new (globalThis.CSInterface || window.CSInterface)();
    const extDirRaw = cs.getSystemPath((globalThis.SystemPath || window.SystemPath).EXTENSION);
    // Walk through the symlink so we land on the real cep-premiere directory.
    const extDir = fs.realpathSync(extDirRaw);
    // sidecar/ is a sibling of cep-premiere/.
    return path.resolve(extDir, '..', 'sidecar');
  } catch (_) {
    return null;
  }
}

function spawnSidecarOnce(sidecarDir) {
  if (typeof require !== 'function') return false;
  const { spawn } = require('child_process');
  for (const py of PYTHON_CANDIDATES) {
    try {
      const child = spawn(py, ['-m', 'app.main'], {
        cwd: sidecarDir,
        detached: true,    // new process group → we can kill the group on quit
        stdio: 'ignore',
        windowsHide: true, // no-op on macOS, hides console on Windows
      });
      // Surface spawn errors (ENOENT for missing interpreter) — they fire after
      // spawn returns, so we attach a listener and let the next candidate try.
      let failed = false;
      child.once('error', () => { failed = true; });
      // Give the OS a tick to fail-fast on missing executable.
      // We can't await here synchronously; rely on subsequent isAlive() polling.
      child.unref();
      if (!failed) {
        spawnedPid = child.pid;
        return true;
      }
    } catch (_) {
      // try next candidate
    }
  }
  return false;
}

// Kill the sidecar process tree if (and only if) we spawned it. Called from
// panel.js on beforeunload + CSXS ApplicationBeforeQuit.
export function stopSpawnedSidecar() {
  if (spawnedPid == null) return false;
  if (typeof require !== 'function') return false;
  try {
    if (IS_WIN) {
      // /T = tree, /F = force. Required because uvicorn forks workers.
      const { execFileSync } = require('child_process');
      execFileSync('taskkill', ['/PID', String(spawnedPid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    } else {
      // detached:true made the child a process-group leader, so its pgid == pid.
      // Signal the negative pgid → SIGTERM goes to the whole group (parent +
      // uvicorn workers). Fall back to the bare pid if pgid kill fails.
      try { process.kill(-spawnedPid, 'SIGTERM'); }
      catch (_) { try { process.kill(spawnedPid, 'SIGTERM'); } catch (_) {} }
    }
  } catch (_) {
    // Already dead, or signal denied — nothing we can do from here.
  }
  spawnedPid = null;
  return true;
}

export async function ensureSidecar({ pollTimeoutMs = 15000, pollIntervalMs = 500 } = {}) {
  if (await isAlive()) return { ok: true, spawned: false };
  const sidecarDir = resolveSidecarDir();
  if (!sidecarDir) return { ok: false, reason: 'cep-node-unavailable' };
  if (!spawnSidecarOnce(sidecarDir)) return { ok: false, reason: 'spawn-failed' };
  const deadline = Date.now() + pollTimeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    if (await isAlive()) return { ok: true, spawned: true };
  }
  return { ok: false, reason: 'spawn-timeout' };
}
