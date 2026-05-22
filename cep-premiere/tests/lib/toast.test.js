import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createToastManager } from '../../client/lib/toast.js';

describe('toast manager', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('addToast appends and dispatches updates', () => {
    const tm = createToastManager();
    const updates = [];
    tm.subscribe(t => updates.push(t));
    tm.success('hi');
    expect(updates[0].length).toBe(1);
    expect(updates[0][0].message).toBe('hi');
    expect(updates[0][0].level).toBe('success');
  });

  it('auto-dismisses after duration', () => {
    const tm = createToastManager();
    let last = [];
    tm.subscribe(t => { last = t; });
    tm.success('hi', 1000);
    expect(last.length).toBe(1);
    vi.advanceTimersByTime(1100);
    expect(last.length).toBe(0);
  });

  it('error toasts default to longer ttl', () => {
    const tm = createToastManager();
    let last = [];
    tm.subscribe(t => { last = t; });
    tm.error('bad');
    expect(last[0].duration).toBeGreaterThanOrEqual(5000);
  });

  it('max 3 stacked toasts', () => {
    const tm = createToastManager({ max: 3 });
    let last = [];
    tm.subscribe(t => { last = t; });
    tm.success('a'); tm.success('b'); tm.success('c'); tm.success('d');
    expect(last.length).toBe(3);
  });
});
