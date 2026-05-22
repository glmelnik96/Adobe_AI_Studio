import { html } from '../lib/html.js';

export function ModelPicker({ nodes, value, onChange }) {
  return html`
    <div class="field">
      <label>Model</label>
      <select value=${value} onChange=${e => onChange(parseInt(e.target.value, 10))}>
        ${nodes.map(n => html`<option value=${n.node_id}>${n.model}</option>`)}
      </select>
    </div>
  `;
}
