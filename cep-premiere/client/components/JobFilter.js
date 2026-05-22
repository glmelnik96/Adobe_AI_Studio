import { html } from '../lib/html.js';

export function JobFilter({ value, onChange }) {
  const opts = ['all', 'queued', 'running', 'completed', 'failed', 'canceled'];
  return html`
    <div class="job-filter">
      ${opts.map(o => html`
        <span class=${`fc ${value === o ? 'active' : ''}`} onClick=${() => onChange(o)}>${o}</span>
      `)}
    </div>
  `;
}
