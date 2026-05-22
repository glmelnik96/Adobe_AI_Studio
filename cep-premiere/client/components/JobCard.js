import { html } from '../lib/html.js';
import { fmtDuration, jobAgeMs } from '../lib/format.js';

const STATUS_CLS = {
  queued: 'q', running: 'r', completed: 'ok', failed: 'fail', canceled: 'fail',
};

export function JobCard({ job, api, onAction }) {
  const cls = STATUS_CLS[job.status] || 'q';
  const age = fmtDuration(jobAgeMs(job));
  const prog = Math.round((job.progress || 0) * 100);
  return html`
    <div class=${`job-card ${cls}`}>
      <div class="job-head">
        <span class="job-title">${job.node_id}</span>
        <span class="job-age">${age}</span>
      </div>
      <div class="job-status">${job.status} ${job.status === 'running' ? `· ${prog}%` : ''}</div>
      ${job.error ? html`<div class="job-error">${job.error}</div>` : null}
      ${job.resultBlobUrl
        ? html`<img class="job-thumb" src=${job.resultBlobUrl} alt="" />`
        : null}
      <div class="job-actions">
        ${job.status === 'completed' ? html`
          <button onClick=${() => onAction('show', job)}>Show in bin</button>
          <button onClick=${() => onAction('download', job)}>Download</button>
        ` : null}
        ${job.status === 'failed' || job.status === 'canceled'
          ? html`<button onClick=${() => onAction('retry', job)}>Retry</button>`
          : null}
        <button onClick=${() => onAction('delete', job)}>Delete</button>
      </div>
    </div>
  `;
}
