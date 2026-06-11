import { html } from '../lib/html.js';
import { useState, useEffect } from '../vendor/preact-hooks.module.js';
import { EnumDropdown } from './EnumDropdown.js';
import { applyPresetToDraft } from '../lib/state.js';
import { toast } from '../lib/toast.js';

// Пресеты формы генерации (V1.3, минимальный UX):
//   [Preset ▾] [Save preset] [✕]
// Пресет хранит ТОЛЬКО форму (family/model/scenario/prompt/params) — слоты
// при применении очищаются, файлы юзер подбирает каждый раз.
// Хранение — sidecar /presets (общие для Pr- и AE-панелей).
//
// Имя для сохранения вводится в inline-инпуте, не через window.prompt():
// в части CEP-билдов prompt() отключён и молча возвращает null.
export function PresetBar({ snap, store, api }) {
  const { draft, videoNodes, health } = snap;
  const [presets, setPresets] = useState(null);   // null = ещё не загружали
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);    // true = показан name-input
  const [nameInput, setNameInput] = useState('');
  const online = health.status === 'online';

  // (Пере)загрузка при появлении sidecar'а. Не на каждый рендер: только
  // переход в online при пустом списке.
  useEffect(() => {
    if (!online || presets !== null) return;
    api.listPresets()
      .then(r => setPresets(r.presets || []))
      .catch(() => setPresets([]));
  }, [online, presets]);

  const items = presets || [];

  function onApply(id) {
    setSelectedId(id);
    const p = items.find(x => x.id === id);
    if (!p) return;
    const res = applyPresetToDraft(p, { videoNodes });
    if (!res.ok) {
      toast.error(res.error === 'unknown_model'
        ? `Preset model (node ${p.model_id}) is unavailable — model list may still be loading`
        : 'Preset is corrupted — delete and re-save it');
      return;
    }
    store.set({ draft: res.draft });
    toast.success('Preset applied — pick your files');
  }

  function startSave() {
    const cur = items.find(x => x.id === selectedId);
    setNameInput(cur ? cur.name : '');
    setSaving(true);
  }

  async function doSave() {
    const name = nameInput.trim();
    if (!name) { toast.warning('Preset name is empty'); return; }
    try {
      const r = await api.savePreset({
        name,
        family: draft.family || null,
        model_id: draft.model_id,
        scenario: draft.scenario || null,
        prompt: draft.prompt || '',
        params: draft.params || {},
      });
      setSaving(false);
      setPresets(null);            // force reload from sidecar
      setSelectedId(r.preset.id);
      toast.success(r.created ? `Preset "${name}" saved` : `Preset "${name}" updated`);
    } catch (e) {
      const detail = (e.body && e.body.detail) || {};
      toast.error('Save preset failed: ' + (detail.reason || detail.error || e.message));
    }
  }

  async function doDelete() {
    const p = items.find(x => x.id === selectedId);
    if (!p) return;
    try {
      await api.deletePreset(p.id);
      setSelectedId(null);
      setPresets(null);            // force reload
      toast.success(`Preset "${p.name}" deleted`);
    } catch (e) {
      toast.error('Delete preset failed: ' + e.message);
    }
  }

  // Пресетов нет и sidecar offline — не занимаем место в форме.
  if (!online && items.length === 0) return null;

  return html`
    <div class="preset-bar">
      <div class="preset-row">
        <${EnumDropdown}
          options=${items.map(p => ({ value: p.id, label: p.name }))}
          value=${selectedId}
          placeholder="Preset…"
          onChange=${onApply} />
        ${saving ? null : html`
          <button title="Save current form (model, scenario, prompt, params) as a preset"
                  onClick=${startSave}>Save preset</button>
        `}
        ${selectedId && !saving ? html`
          <button class="preset-del" title="Delete selected preset"
                  onClick=${doDelete}>✕</button>
        ` : null}
      </div>
      ${saving ? html`
        <div class="preset-row">
          <input class="preset-name" type="text" placeholder="Preset name"
                 value=${nameInput}
                 onInput=${e => setNameInput(e.target.value)}
                 onKeyDown=${e => {
                   if (e.key === 'Enter') doSave();
                   if (e.key === 'Escape') setSaving(false);
                 }} />
          <button class="primary-soft" onClick=${doSave}>Save</button>
          <button onClick=${() => setSaving(false)}>Cancel</button>
        </div>
      ` : null}
    </div>
  `;
}
