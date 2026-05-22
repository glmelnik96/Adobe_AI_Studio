import { html } from '../lib/html.js';
import { useState } from '../vendor/preact-hooks.module.js';

// Render a single param row. Widget shape is dictated by `opt` (from sidecar
// `describe_video_nodes` → `param_options`). Unknown params fall back to a
// text input so the field is still editable.
function ParamField({ name, value, opt, onChange }) {
  if (opt && opt.kind === 'enum' && Array.isArray(opt.options)) {
    return html`
      <div class="field">
        <label>${name}</label>
        <select value=${value} onChange=${e => onChange(name, e.target.value)}>
          ${opt.options.map(o => html`<option value=${o}>${o}</option>`)}
        </select>
      </div>
    `;
  }
  if (opt && opt.kind === 'bool') {
    const checked = value === true || value === 'true' || value === 1 || value === '1';
    return html`
      <div class="field">
        <label>${name}</label>
        <input type="checkbox" checked=${checked}
               onChange=${e => onChange(name, e.target.checked)} />
      </div>
    `;
  }
  if (opt && opt.kind === 'number') {
    return html`
      <div class="field">
        <label>${name}</label>
        <input type="number"
               min=${opt.min ?? undefined}
               max=${opt.max ?? undefined}
               step=${opt.step ?? undefined}
               value=${value}
               onInput=${e => onChange(name, e.target.value === '' ? '' : Number(e.target.value))} />
      </div>
    `;
  }
  return html`
    <div class="field">
      <label>${name}</label>
      <input value=${value} onInput=${e => onChange(name, e.target.value)} />
    </div>
  `;
}

export function ParamsAccordion({ defaults, options, values, onChange }) {
  const [open, setOpen] = useState(false);
  const keys = Object.keys(defaults || {});
  if (keys.length === 0) return null;
  return html`
    <div class="params">
      <div class="params-head" onClick=${() => setOpen(o => !o)}>
        ${open ? '▼' : '▶'} Advanced params (${keys.length})
      </div>
      ${open && html`
        <div class="params-body">
          ${keys.map(k => html`
            <${ParamField}
              name=${k}
              value=${values[k] ?? defaults[k]}
              opt=${(options || {})[k]}
              onChange=${onChange} />
          `)}
        </div>
      `}
    </div>
  `;
}
