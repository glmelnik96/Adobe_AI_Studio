export function fmtDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  if (m === 0) return `${ss}s`;
  return `${m}m ${ss.toString().padStart(2, '0')}s`;
}

// For terminal jobs use updated_at so the elapsed counter freezes when the job
// finishes. Without this, App.js's 2s poll keeps re-rendering JobCard with an
// ever-increasing "age" even on completed/failed/canceled jobs.
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'canceled', 'cancelled']);

export function jobAgeMs(job, now = Date.now()) {
  const start = Date.parse(job.created_at);
  if (isNaN(start)) return 0;
  if (TERMINAL_STATUSES.has(job.status)) {
    const end = Date.parse(job.updated_at);
    if (!isNaN(end)) return Math.max(0, end - start);
  }
  return now - start;
}
