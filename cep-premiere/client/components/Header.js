import { html } from '../lib/html.js';
import { host } from '../lib/host.js';
import { toast } from '../lib/toast.js';

async function runDiag() {
  try {
    const r = await host.diagApis();
    // Печатаем диагностику в консоль (CEP debug console) — удобнее, чем тостами.
    // eslint-disable-next-line no-console
    console.log('[Phygital diagApis]', JSON.stringify(r, null, 2));
    const seq = r.qe_seq_apis ? Object.entries(r.qe_seq_apis)
      .filter(([, v]) => v === 'function').map(([k]) => k).join(',') : 'qe_seq:n/a';
    toast.success(`Pr=${r.pr_version} qe=${r.qe_available} seq[${seq || 'none'}]`);
  } catch (e) {
    const reason = (e.result && e.result.reason) || e.message;
    toast.error('diagApis failed: ' + reason);
  }
}

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
      <button class="diag-btn" title="Dump available Pr APIs to console" onClick=${runDiag}>diag</button>
    </div>
  `;
}
