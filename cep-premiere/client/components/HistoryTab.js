import { html } from '../lib/html.js';
import { useState } from '../vendor/preact-hooks.module.js';
import { JobFilter } from './JobFilter.js';
import { JobList } from './JobList.js';

export function HistoryTab({ snap, api, onAction }) {
  const [filter, setFilter] = useState('all');
  const jobs = filter === 'all' ? snap.jobs : snap.jobs.filter(j => j.status === filter);
  return html`
    <div class="history">
      <${JobFilter} value=${filter} onChange=${setFilter} />
      <${JobList} jobs=${jobs} api=${api} onAction=${onAction} />
    </div>
  `;
}
