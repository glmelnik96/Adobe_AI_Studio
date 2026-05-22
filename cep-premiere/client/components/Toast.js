import { html } from '../lib/html.js';
import { useState, useEffect } from '../vendor/preact-hooks.module.js';
import { toast } from '../lib/toast.js';

export function ToastStack() {
  const [list, setList] = useState([]);
  useEffect(() => toast.subscribe(setList), []);
  return html`
    <div class="toast-stack">
      ${list.map(t => html`
        <div key=${t.id} class=${`toast ${t.level}`} onClick=${() => toast.dismiss(t.id)}>${t.message}</div>
      `)}
    </div>
  `;
}
