import { html } from '../lib/html.js';

export function Tabs({ active, onChange, tabs }) {
  return html`
    <div class="tabs">
      ${tabs.map(t => html`
        <div class=${`tab ${active === t.id ? 'active' : ''}`}
             onClick=${() => onChange(t.id)}>${t.label}</div>
      `)}
    </div>
  `;
}
