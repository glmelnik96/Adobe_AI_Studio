import { html } from '../lib/html.js';

export function PromptInput({ value, onChange }) {
  return html`
    <div class="field">
      <label>Prompt</label>
      <textarea rows="3" value=${value} onInput=${e => onChange(e.target.value)}></textarea>
    </div>
  `;
}
