// Tests for the Higgsfield-style "process selected clip" bridge additions:
// host.getSelectedClipSource() / host.insertToTimeline() wrappers — argument
// serialization through the ASCII-safe evalScript bridge and ok/error parsing.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { host } from '../../client/lib/host.js';

// host.js caches the CSInterface instance module-wide, so install the mock
// once and swap out the evalScript implementation per test.
const evalScript = vi.fn();
beforeEach(() => {
  evalScript.mockReset();
  window.CSInterface = function () { this.evalScript = evalScript; };
});

function respondWith(obj) {
  evalScript.mockImplementation((_expr, cb) => cb(JSON.stringify(obj)));
}

describe('host.getSelectedClipSource', () => {
  it('calls the ExtendScript fn with no args and resolves on ok', async () => {
    respondWith({ ok: true, path: 'C:\\media\\a.mp4', inSec: 1.5, outSec: 4.25, clipName: 'A' });
    const r = await host.getSelectedClipSource();
    expect(evalScript.mock.calls[0][0]).toBe('getSelectedClipSource()');
    expect(r.inSec).toBe(1.5);
    expect(r.outSec).toBe(4.25);
  });

  it('rejects with result attached on ok:false (no_selection)', async () => {
    respondWith({ ok: false, error: 'no_selection', reason: 'select a clip on the timeline first' });
    await expect(host.getSelectedClipSource()).rejects.toMatchObject({
      message: 'no_selection',
      result: { error: 'no_selection' },
    });
  });
});

describe('host.insertToTimeline', () => {
  it('serializes projectItemId and atSec through the bridge', async () => {
    respondWith({ ok: true, trackLabel: 'V2', atSec: 0 });
    const r = await host.insertToTimeline('42', -1);
    expect(evalScript.mock.calls[0][0]).toBe('insertToTimeline("42", -1)');
    expect(r.trackLabel).toBe('V2');
  });

  it('defaults atSec to -1 (playhead)', async () => {
    respondWith({ ok: true, trackLabel: 'V3', atSec: 12 });
    await host.insertToTimeline('7');
    expect(evalScript.mock.calls[0][0]).toBe('insertToTimeline("7", -1)');
  });

  it('escapes non-ASCII in ids ASCII-safely (bridge mangles raw Cyrillic)', async () => {
    respondWith({ ok: true, trackLabel: 'V2', atSec: 0 });
    await host.insertToTimeline('клип-1', 2.5);
    const expr = evalScript.mock.calls[0][0];
    expect(expr).toBe('insertToTimeline("\\u043a\\u043b\\u0438\\u043f-1", 2.5)');
    // Printable ASCII only — survives the CEP C++ layer.
    expect(/^[\x20-\x7e]+$/.test(expr)).toBe(true);
  });

  it('rejects on no_free_track with the result for UI mapping', async () => {
    respondWith({ ok: false, error: 'no_free_track', reason: 'all 3 video-tracks busy/locked at 4.00s' });
    await expect(host.insertToTimeline('42')).rejects.toMatchObject({
      result: { error: 'no_free_track' },
    });
  });
});
