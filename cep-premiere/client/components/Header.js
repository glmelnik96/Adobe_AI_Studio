import { html } from '../lib/html.js';

export function Header({ health }) {
  const cls = `pill ${health.status}`;
  const label =
    health.status === 'online' ? 'online' :
    health.status === 'no_session' ? 'no session' :
    health.status === 'offline' ? 'offline' :
    '...';
  return html`
    <div class="header">
      <div class="title">Phygital Studio</div>
      <div class=${cls}><span class="dot"></span>${label}</div>
    </div>
  `;
}
