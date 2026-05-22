import { html } from '../lib/html.js';
import { useState } from '../vendor/preact-hooks.module.js';
import { validateDraft } from '../lib/validation.js';
import { toast } from '../lib/toast.js';

export function SubmitButton({ snap, api, onSubmitted }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const { draft, videoNodes, health } = snap;
  const v = validateDraft({ videoNodes, draft });
  const disabled = busy || health.status !== 'online' || !v.ok;

  async function onClick() {
    setBusy(true); setErr(null);
    try {
      const init_files = {};
      for (const [name, val] of Object.entries(draft.slots)) {
        if (Array.isArray(val)) init_files[name] = val.map(x => x.path);
        else if (val) init_files[name] = val.path;
      }
      const params = { ...draft.params, prompt: draft.prompt, scenario: draft.scenario };
      const out = await api.createJob({ node_id: draft.model_id, params, init_files });
      if (onSubmitted) onSubmitted(out.job_id);
    } catch (e) {
      setErr(e.message || 'submit failed');
      toast.error('Submit failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  return html`
    <div class="submit">
      <button class="primary" onClick=${onClick} disabled=${disabled}>
        ${busy ? 'Submitting...' : 'Generate'}
      </button>
      ${!v.ok && v.errors.length > 0
        ? html`<div class="submit-errs">${v.errors.map(e => html`<div>${e.message}</div>`)}</div>`
        : null}
      ${err ? html`<div class="submit-err">${err}</div>` : null}
    </div>
  `;
}
