import { describe, it, expect } from 'vitest';
import { jobAgeMs, fmtDuration } from '../../client/lib/format.js';

describe('jobAgeMs', () => {
  const createdAt = '2026-05-25T10:00:00.000Z';
  const updatedAt = '2026-05-25T10:01:30.000Z';
  const now = Date.parse('2026-05-25T10:05:00.000Z');

  it('ticks for in-progress jobs (uses created_at vs now)', () => {
    const job = { status: 'running', created_at: createdAt, updated_at: updatedAt };
    // 5 minutes from created_at
    expect(jobAgeMs(job, now)).toBe(5 * 60 * 1000);
  });

  it('freezes for completed jobs (uses updated_at - created_at)', () => {
    const job = { status: 'completed', created_at: createdAt, updated_at: updatedAt };
    // 90s span — must NOT keep ticking
    expect(jobAgeMs(job, now)).toBe(90 * 1000);
  });

  it('freezes for failed jobs', () => {
    const job = { status: 'failed', created_at: createdAt, updated_at: updatedAt };
    expect(jobAgeMs(job, now)).toBe(90 * 1000);
  });

  it('freezes for canceled jobs (both spellings)', () => {
    const j1 = { status: 'canceled', created_at: createdAt, updated_at: updatedAt };
    const j2 = { status: 'cancelled', created_at: createdAt, updated_at: updatedAt };
    expect(jobAgeMs(j1, now)).toBe(90 * 1000);
    expect(jobAgeMs(j2, now)).toBe(90 * 1000);
  });

  it('falls back to live tick when terminal job lacks updated_at', () => {
    const job = { status: 'completed', created_at: createdAt };
    expect(jobAgeMs(job, now)).toBe(5 * 60 * 1000);
  });

  it('returns 0 for malformed created_at', () => {
    expect(jobAgeMs({ status: 'running', created_at: 'nope' }, now)).toBe(0);
  });
});

describe('fmtDuration', () => {
  it('formats seconds-only', () => {
    expect(fmtDuration(45 * 1000)).toBe('45s');
  });
  it('formats minutes + zero-padded seconds', () => {
    expect(fmtDuration(90 * 1000)).toBe('1m 30s');
  });
  it('returns 0s for falsy/negative', () => {
    expect(fmtDuration(0)).toBe('0s');
    expect(fmtDuration(-1)).toBe('0s');
  });
});
