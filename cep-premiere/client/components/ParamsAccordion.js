import { html } from '../lib/html.js';
import { useState } from '../vendor/preact-hooks.module.js';
import { paramLabel, paramDescription, valueLabel } from '../lib/param_labels.js';
import { EnumDropdown } from './EnumDropdown.js';

// Render a single param row. Widget shape is dictated by `opt` (from sidecar
// `describe_video_nodes` → `param_options`). Unknown params fall back to a
// text input so the field is still editable.
function ParamField({ name, value, opt, onChange }) {
  const label = paramLabel(name);
  const desc = paramDescription(name);
  const labelEl = html`<label title=${desc || undefined}>${label}</label>`;

  if (opt && opt.kind === 'enum' && Array.isArray(opt.options)) {
    const items = opt.options.map(o => ({ value: o, label: valueLabel(o) }));
    return html`
      <div class="field">
        ${labelEl}
        <${EnumDropdown} options=${items} value=${value}
                         onChange=${v => onChange(name, v)} />
        ${desc ? html`<div class="field-hint">${desc}</div>` : null}
      </div>
    `;
  }
  if (opt && opt.kind === 'bool') {
    const checked = value === true || value === 'true' || value === 1 || value === '1';
    return html`
      <div class="field field-inline">
        <input id=${`p_${name}`} type="checkbox" checked=${checked}
               onChange=${e => onChange(name, e.target.checked)} />
        <label for=${`p_${name}`} title=${desc || undefined}>${label}</label>
        ${desc ? html`<div class="field-hint">${desc}</div>` : null}
      </div>
    `;
  }
  if (opt && opt.kind === 'number') {
    return html`
      <div class="field">
        ${labelEl}
        <input type="number"
               min=${opt.min ?? undefined}
               max=${opt.max ?? undefined}
               step=${opt.step ?? undefined}
               value=${value}
               onInput=${e => onChange(name, e.target.value === '' ? '' : Number(e.target.value))} />
        ${desc ? html`<div class="field-hint">${desc}</div>` : null}
      </div>
    `;
  }
  return html`
    <div class="field">
      ${labelEl}
      <input value=${value} onInput=${e => onChange(name, e.target.value)} />
      ${desc ? html`<div class="field-hint">${desc}</div>` : null}
    </div>
  `;
}

// Какие параметры показывать в Advanced. Прячем:
//  - exclude (версия движка — у неё свой дропдаун под Model в GenerateTab);
//  - enum'ы с одной опцией (выбора нет — мёртвый дропдаун, напр. GPT Image
//    version=['v2']); дефолт всё равно уйдёт в payload через SubmitButton.
export function visibleParamKeys(defaults, options, exclude) {
  const skip = new Set(exclude || []);
  return Object.keys(defaults || {}).filter(k => {
    if (skip.has(k)) return false;
    const opt = (options || {})[k];
    if (opt && opt.kind === 'enum' && Array.isArray(opt.options) && opt.options.length <= 1) {
      return false;
    }
    return true;
  });
}

export function ParamsAccordion({ defaults, options, values, onChange, exclude }) {
  const [open, setOpen] = useState(false);
  const keys = visibleParamKeys(defaults, options, exclude);
  if (keys.length === 0) return null;
  return html`
    <div class="params">
      <div class="params-head" onClick=${() => setOpen(o => !o)}>
        ${open ? '▼' : '▶'} Advanced settings (${keys.length})
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
