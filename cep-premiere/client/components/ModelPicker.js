import { html } from '../lib/html.js';
import { EnumDropdown } from './EnumDropdown.js';

// Node 94 (Nano Banana) is the only image model; everything else from
// /nodes/video produces video. Tagging in the dropdown removes the "wait,
// is this image or video?" question users hit on first open.
function modelKind(nodeId) {
  return nodeId === 94 ? 'image' : 'video';
}

export function ModelPicker({ nodes, value, onChange }) {
  const items = nodes.map(n => ({
    value: n.node_id,
    label: `${n.model} — ${modelKind(n.node_id)}`,
  }));
  return html`
    <div class="field">
      <label>Model</label>
      <${EnumDropdown} options=${items} value=${value} onChange=${onChange} />
    </div>
  `;
}
