// CEP exposes window.cep.fs.showOpenDialogEx. In jsdom tests this won't exist;
// callers should feature-detect.

export function pickFilesFromDisk({ multi, accept }) {
  const cep = window.cep;
  if (!cep || !cep.fs || !cep.fs.showOpenDialogEx) {
    return Promise.reject(new Error('cep.fs.showOpenDialogEx unavailable'));
  }
  // Per Adobe CEP docs: showOpenDialogEx(allowMultipleSelection, chooseDirectory, title, initialPath, fileTypes)
  const res = cep.fs.showOpenDialogEx(!!multi, false, 'Pick file', '', accept || []);
  if (res.err !== 0) return Promise.reject(new Error(`dialog err ${res.err}`));
  return Promise.resolve(res.data || []);
}

export async function readFileAsBlob(path) {
  // Use Node fs via the CEP node-enabled context.
  const fs = require('fs');
  // Pre-flight stat: даёт явный {code, path} вместо generic readFileSync
  // throw без контекста. На Mac частые причины ENOENT — HFS-форма пути от
  // Pr (см. host.jsx _macToPosix), NFD/NFC mismatch для Cyrillic-имён,
  // sandbox-restricted папки (~/Library/...).
  let stat;
  try {
    stat = fs.statSync(path);
  } catch (e) {
    const code = (e && e.code) || 'unknown';
    const len = String(path || '').length;
    throw new Error(`readFile ${code} (path len=${len})`);
  }
  if (!stat.isFile()) {
    throw new Error(`readFile: not a regular file (path len=${String(path).length})`);
  }
  let buf;
  try {
    buf = fs.readFileSync(path);
  } catch (e) {
    const code = (e && e.code) || 'unknown';
    throw new Error(`readFile ${code} after stat OK (size=${stat.size})`);
  }
  const ext = path.split('.').pop().toLowerCase();
  const mime =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
    ext === 'png' ? 'image/png' :
    ext === 'tif' || ext === 'tiff' ? 'image/tiff' :
    ext === 'webp' ? 'image/webp' :
    ext === 'heic' || ext === 'heif' ? 'image/heic' :
    ext === 'mp4' ? 'video/mp4' :
    ext === 'mov' ? 'video/quicktime' :
    ext === 'mkv' ? 'video/x-matroska' :
    ext === 'webm' ? 'video/webm' :
    ext === 'm4v' ? 'video/x-m4v' :
    ext === 'wav' || ext === 'mp3' ? `audio/${ext === 'mp3' ? 'mpeg' : 'wav'}` :
    'application/octet-stream';
  return new Blob([buf], { type: mime });
}

export async function makeThumbDataURL(blob, max = 64) {
  if (!blob.type.startsWith('image/')) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    const ratio = Math.min(max / img.width, max / img.height, 1);
    const w = Math.max(1, Math.round(img.width * ratio));
    const h = Math.max(1, Math.round(img.height * ratio));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.6);
  } finally { URL.revokeObjectURL(url); }
}
