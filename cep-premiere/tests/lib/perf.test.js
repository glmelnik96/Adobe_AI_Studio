// Tests for the V1.3 performance work: adaptive poll interval, same-reference
// mergeJobs (render skipping), debounced draft persistence, jobMeta
// skip-if-unchanged, lazy thumbnails fallback, ASCII-safe evalScript bridge.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  jobsPollInterval, ACTIVE_JOB_STATUSES,
  mergeJobs,
  saveDraftToStorageDebounced, flushDraftSave, loadDraftFromStorage, DRAFT_LS_KEY,
  saveJobMetaCache, loadJobMetaCache,
} from '../../client/lib/state.js';
import { asciiSafeJson } from '../../client/lib/host.js';

const J = (id, status, updated = '1') => ({
  job_id: id, status, updated_at: updated, node_id: 94, progress: 0,
  result_paths: [], error: null,
});

describe('jobsPollInterval', () => {
  it('1s when at least one active job', () => {
    expect(jobsPollInterval([J('A', 'completed'), J('B', 'running')])).toBe(1000);
    expect(jobsPollInterval([J('A', 'queued')])).toBe(1000);
    expect(jobsPollInterval([J('A', 'pending')])).toBe(1000);
  });
  it('5s when idle (all terminal) or empty', () => {
    expect(jobsPollInterval([J('A', 'completed'), J('B', 'failed')])).toBe(5000);
    expect(jobsPollInterval([])).toBe(5000);
    expect(jobsPollInterval(null)).toBe(5000);
  });
  it('ACTIVE_JOB_STATUSES covers exactly queued/running/pending', () => {
    expect([...ACTIVE_JOB_STATUSES].sort()).toEqual(['pending', 'queued', 'running']);
  });
});

describe('mergeJobs same-reference memoization', () => {
  beforeEach(() => localStorage.clear());

  it('returns the SAME array reference when nothing changed', () => {
    const prev = [J('A', 'running', '5'), J('B', 'completed', '3')];
    // Server returns fresh objects with identical content (typical poll tick).
    const remote = [J('A', 'running', '5'), J('B', 'completed', '3')];
    expect(mergeJobs(prev, remote)).toBe(prev);
  });

  it('returns a new array when a status changed', () => {
    const prev = [J('A', 'running', '5')];
    const remote = [J('A', 'completed', '6')];
    const out = mergeJobs(prev, remote);
    expect(out).not.toBe(prev);
    expect(out[0].status).toBe('completed');
  });

  it('compares nested params by content, not identity', () => {
    const prev = [{ ...J('A', 'running'), params: { prompt: 'cat', seed: 1 } }];
    const remote = [{ ...J('A', 'running'), params: { prompt: 'cat', seed: 1 } }];
    expect(mergeJobs(prev, remote)).toBe(prev);
  });

  it('detects nested params change', () => {
    const prev = [{ ...J('A', 'running'), params: { prompt: 'cat' } }];
    const remote = [{ ...J('A', 'running'), params: { prompt: 'dog' } }];
    expect(mergeJobs(prev, remote)).not.toBe(prev);
  });

  it('new job in remote → new array', () => {
    const prev = [J('A', 'running')];
    const remote = [J('A', 'running'), J('B', 'queued')];
    const out = mergeJobs(prev, remote);
    expect(out).not.toBe(prev);
    expect(out).toHaveLength(2);
  });
});

describe('saveDraftToStorageDebounced / flushDraftSave', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    flushDraftSave();          // drain module-level timer state between tests
    localStorage.clear();
    vi.useRealTimers();
  });

  it('does not write before the delay elapses', () => {
    saveDraftToStorageDebounced({ model_id: 94, prompt: 'a' }, 800);
    vi.advanceTimersByTime(500);
    expect(localStorage.getItem(DRAFT_LS_KEY)).toBeNull();
  });

  it('writes the LAST draft after trailing delay (keystroke coalescing)', () => {
    saveDraftToStorageDebounced({ model_id: 94, prompt: 'a' }, 800);
    vi.advanceTimersByTime(400);
    saveDraftToStorageDebounced({ model_id: 94, prompt: 'ab' }, 800);
    vi.advanceTimersByTime(400);
    expect(localStorage.getItem(DRAFT_LS_KEY)).toBeNull(); // timer was reset
    vi.advanceTimersByTime(400);
    expect(loadDraftFromStorage().prompt).toBe('ab');
  });

  it('flushDraftSave persists pending draft immediately (beforeunload path)', () => {
    saveDraftToStorageDebounced({ model_id: 94, prompt: 'tail' }, 800);
    flushDraftSave();
    expect(loadDraftFromStorage().prompt).toBe('tail');
  });

  it('flushDraftSave is a no-op when nothing pending', () => {
    flushDraftSave();
    expect(localStorage.getItem(DRAFT_LS_KEY)).toBeNull();
  });
});

describe('saveJobMetaCache skip-if-unchanged', () => {
  beforeEach(() => localStorage.clear());

  it('skips localStorage.setItem when content identical', () => {
    saveJobMetaCache({ A: { localPath: '/x.png' } });
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    saveJobMetaCache({ A: { localPath: '/x.png' } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('writes when content changed', () => {
    saveJobMetaCache({ A: { localPath: '/x.png' } });
    saveJobMetaCache({ A: { localPath: '/y.png' } });
    expect(loadJobMetaCache().A.localPath).toBe('/y.png');
  });

  it('re-writes if storage was cleared externally', () => {
    saveJobMetaCache({ A: { localPath: '/x.png' } });
    localStorage.clear();
    saveJobMetaCache({ A: { localPath: '/x.png' } });
    expect(loadJobMetaCache().A.localPath).toBe('/x.png');
  });
});

describe('asciiSafeJson (evalScript bridge encoding)', () => {
  it('escapes Cyrillic path to pure ASCII', () => {
    const s = asciiSafeJson('C:\\Users\\Глеб\\img.png');
    expect(/^[\x00-\x7e]*$/.test(s)).toBe(true);
    expect(s).toContain('\\u0413\\u043b\\u0435\\u0431');
  });
  it('round-trips through JSON.parse', () => {
    const orig = { path: 'C:\\Users\\Глеб\\Видео\\клип — финал.mov', n: 3 };
    expect(JSON.parse(asciiSafeJson(orig))).toEqual(orig);
  });
  it('plain ASCII passes through unchanged', () => {
    expect(asciiSafeJson({ a: 1, b: 'x' })).toBe(JSON.stringify({ a: 1, b: 'x' }));
  });
  it('handles emoji (surrogate pairs) losslessly', () => {
    const s = asciiSafeJson('done ✨🎬');
    expect(/^[\x00-\x7e]*$/.test(s)).toBe(true);
    expect(JSON.parse(s)).toBe('done ✨🎬');
  });
});

describe('useLazyVisible fallback (no IntersectionObserver)', () => {
  it('JobCard exports the hook', async () => {
    const mod = await import('../../client/components/JobCard.js');
    expect(typeof mod.useLazyVisible).toBe('function');
  });
});
