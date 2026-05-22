export function fmtDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  if (m === 0) return `${ss}s`;
  return `${m}m ${ss.toString().padStart(2, '0')}s`;
}

export function jobAgeMs(job, now = Date.now()) {
  const t = Date.parse(job.created_at);
  if (isNaN(t)) return 0;
  return now - t;
}
