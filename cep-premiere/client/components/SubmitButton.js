import { html } from '../lib/html.js';
import { useState } from '../vendor/preact-hooks.module.js';
import { validateDraft } from '../lib/validation.js';
import { makeCostKey, isEnhancedFresh } from '../lib/state.js';
import { slotLabel } from '../lib/slot_labels.js';
import { toast } from '../lib/toast.js';
import { getNodeMeta, nodeHasPrompt, nodeSupportsEnhancer, getNodeFamily } from '../lib/slot_schema.js';

// Turn validation errors into one-line user hints. Same field codes the
// validation lib emits, but with friendly slot/scenario names baked in.
function friendlyValidationError(err) {
  if (!err || !err.field) return err && err.message;
  if (err.field === 'prompt') return 'Write a prompt first.';
  if (err.field === 'scenario') return err.message; // already includes model
  if (err.field === 'model_id') return 'Pick a model first.';
  if (err.field.startsWith('slot:')) {
    const name = err.field.slice(5);
    return `Add a file for "${slotLabel(name)}".`;
  }
  return err.message;
}

export function SubmitButton({ snap, api, store, onSubmitted }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const { draft, videoNodes, health, cost, balance } = snap;
  const v = validateDraft({ videoNodes, draft });

  // Show price inline on the button when we have a fresh estimate for the
  // current draft. Stale or missing estimates fall back to "Generate".
  const costKey = makeCostKey(draft);
  const freshCost = cost && cost.key === costKey && typeof cost.price === 'number'
    ? cost.price
    : null;

  // Блокируем submit, если price точно превышает balance (infinity = пропускаем
  // проверку, неизвестный balance — не блокируем чтобы не ловить ложный
  // negative до первого /balance ответа).
  const bal = balance || {};
  const insufficientBalance =
    freshCost != null &&
    !bal.infinity &&
    typeof bal.value === 'number' &&
    freshCost > bal.value;

  // V1.2: ✨ Enhance toggle ON но preview ещё не сделан / устарел —
  // блокируем submit. Иначе юзер удивится, что заплатил без энхансинга.
  // Topaz/Voice (nodeSupportsEnhancer=false) — enhance к ним не относится,
  // не блокируем (toggle в UI скрыт, но draft.enhance_prompt мог остаться
  // в state от прошлой ноды).
  const meta = getNodeMeta({ videoNodes, nodeId: draft.model_id });
  const enhanceRequired = draft.enhance_prompt && nodeSupportsEnhancer(meta);
  const enhanceFresh = isEnhancedFresh(draft);
  const needsEnhancePreview = enhanceRequired && !enhanceFresh;

  const disabled =
    busy ||
    health.status !== 'online' ||
    !v.ok ||
    insufficientBalance ||
    needsEnhancePreview ||
    draft.enhanced_busy;

  async function onClick() {
    setBusy(true); setErr(null);
    try {
      const init_files = {};
      for (const [name, val] of Object.entries(draft.slots)) {
        if (Array.isArray(val)) init_files[name] = val.map(x => x.path);
        else if (val) init_files[name] = val.path;
      }
      // Мержим defaults из meta перед отправкой. Без этого, если юзер не
      // тронул дропдаун, key отсутствует в draft.params → бэк падает на
      // свой Python-default (который мог разойтись с тем, что показано в
      // UI — напр. seed=-1 в video_common vs 0 в build_payload signature).
      // Это симптом «aspect_ratio не передавался» на Mac после reload.
      const defaults = (meta && meta.default_params) || {};
      // V1.2: если ✨ Enhance ON и preview свежий — отправляем
      // enhanced_prompt (юзер мог его ещё подправить). Иначе — исходный.
      // Topaz prompt вообще не нужен; для него draft.prompt==='' и бэк
      // его проигнорирует.
      const finalPrompt = (enhanceRequired && enhanceFresh)
        ? (draft.enhanced_prompt || draft.prompt)
        : draft.prompt;
      // Voice (89): sidecar VoiceTTSWorkflow.build_payload ждёт `text` +
      // `voice` (custom_voice_id), а не `prompt`+`scenario`. Голос
      // выбирается через ParamsAccordion → draft.params.voice; здесь
      // переименовываем prompt → text, scenario не шлём (только 'tts').
      const family = getNodeFamily(meta);
      const params = family === 'voice'
        ? { ...defaults, ...draft.params, text: finalPrompt }
        : { ...defaults, ...draft.params, prompt: finalPrompt, scenario: draft.scenario };
      const out = await api.createJob({ node_id: draft.model_id, params, init_files });
      // Optimistic UI: сразу кладём job в store — QueueWidget/History видят
      // его мгновенно, не дожидаясь следующего poll-тика. Следующий poll
      // заменит запись серверной (mergeJobs: server fields побеждают).
      if (store && out && out.job_id) {
        const s = store.get();
        if (!(s.jobs || []).some(j => j.job_id === out.job_id)) {
          const now = new Date().toISOString();
          store.set({
            jobs: [...(s.jobs || []), {
              job_id: out.job_id,
              node_id: draft.model_id,
              status: out.status || 'queued',
              progress: 0,
              params,
              created_at: out.created_at || now,
              updated_at: out.updated_at || now,
            }],
          });
        }
      }
      if (onSubmitted) onSubmitted(out.job_id);
    } catch (e) {
      setErr(e.message || 'submit failed');
      toast.error('Submit failed: ' + e.message);
    } finally {
      setBusy(false);
    }
  }

  const label =
    busy ? 'Submitting…' :
    draft.enhanced_busy ? 'Enhancing prompt…' :
    needsEnhancePreview ? 'Click ✨ Enhance first' :
    insufficientBalance ? `Insufficient balance · ~${freshCost} credits` :
    freshCost != null ? `Generate · ~${freshCost} credits` :
    'Generate';

  const btnTitle =
    disabled && !v.ok ? 'Fix the errors below first' :
    needsEnhancePreview ? 'Enhance toggle is ON — click ✨ Enhance to preview the enhanced prompt, then Submit.' :
    insufficientBalance ? `Need ${freshCost} credits, only ${bal.value} available` :
    undefined;

  return html`
    <div class="submit">
      <button class="primary submit-btn" onClick=${onClick} disabled=${disabled} title=${btnTitle}>
        ${label}
      </button>
      ${!v.ok && v.errors.length > 0
        ? html`<div class="submit-errs">${v.errors.map(e => html`<div>· ${friendlyValidationError(e)}</div>`)}</div>`
        : null}
      ${err ? html`<div class="submit-err">${err}</div>` : null}
    </div>
  `;
}
