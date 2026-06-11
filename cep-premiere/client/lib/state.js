// Tiny reactive store. Single exported `store`; createStore() for tests.

export function createStore(initial = {}) {
  let state = { ...initial };
  const listeners = new Set();
  function get() { return state; }
  function set(patch) {
    state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) };
    for (const l of listeners) l(state);
  }
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  return { get, set, subscribe };
}

export const DEFAULT_STATE = {
  health: { status: 'unknown', jwt_ttl_sec: null },
  videoNodes: null,
  draft: null,
  jobs: [],
  toasts: [],
  cost: { key: null, price: null, loading: false, error: null },
  // Balance в store (а не в локальном state Header'а) — нужно CostBar'у/
  // SubmitButton'у для сравнения price vs balance до Generate.
  balance: { value: null, infinity: false, error: null, loading: false },
};

// Cost cache: key = JSON.stringify({model_id, scenario, params, prompt})
// Invalidated on any draft change that affects price.
export function makeCostKey(draft) {
  if (!draft) return '';
  return JSON.stringify({
    m: draft.model_id,
    s: draft.scenario,
    p: draft.params || {},
    pr: draft.prompt || '',
  });
}

export const store = createStore(DEFAULT_STATE);

import {
  getNodeMeta, getNodeFamily, getSlotsForScenario,
  listNodesByFamily, NANO_BANANA_META,
} from './slot_schema.js';

export function makeInitialDraft() {
  return {
    family: 'image',          // 'image' | 'video' | 'upscale' (V1.2 taxonomy)
    model_id: NANO_BANANA_META.node_id,
    scenario: NANO_BANANA_META.scenarios[0],
    prompt: '',
    slots: {},
    params: {},
    // ── ✨ Enhance prompt (V1.2 preview-and-confirm flow) ──────────────
    // enhance_prompt = пользователь нажал toggle ON
    // enhanced_prompt = текст от sidecar /enhance (null до первого вызова)
    // enhanced_busy = идёт сейчас вызов /enhance (UI блокирует Submit)
    // enhanced_error = последняя ошибка (для UI; null после успеха)
    // enhanced_for = {model_id, prompt} ключ, для которого был получен
    //   enhanced_prompt; если draft.model_id/prompt поменяются — preview
    //   считается stale (UI просит юзера re-enhance).
    enhance_prompt: false,
    enhanced_prompt: null,
    enhanced_busy: false,
    enhanced_error: null,
    enhanced_for: null,
  };
}

export const DRAFT_LS_KEY = 'phygital-studio.draft.v1';

export function loadDraftFromStorage() {
  try {
    const raw = localStorage.getItem(DRAFT_LS_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (typeof obj !== 'object' || !obj.model_id) return null;
    return obj;
  } catch { return null; }
}

export function saveDraftToStorage(draft) {
  try { localStorage.setItem(DRAFT_LS_KEY, JSON.stringify(draft)); } catch {}
}

// Debounced-вариант: GenerateTab сохраняет draft на каждый keystroke промпта —
// это синхронный JSON.stringify+setItem на каждый символ. Trailing debounce
// 800ms; flushDraftSave() обязателен на beforeunload, чтобы не потерять хвост.
let _draftSaveTimer = null;
let _draftPending = null;
export function saveDraftToStorageDebounced(draft, delayMs = 800) {
  _draftPending = draft;
  if (_draftSaveTimer) clearTimeout(_draftSaveTimer);
  _draftSaveTimer = setTimeout(() => {
    _draftSaveTimer = null;
    const d = _draftPending;
    _draftPending = null;
    saveDraftToStorage(d);
  }, delayMs);
}
export function flushDraftSave() {
  if (_draftSaveTimer) { clearTimeout(_draftSaveTimer); _draftSaveTimer = null; }
  if (_draftPending != null) { saveDraftToStorage(_draftPending); _draftPending = null; }
}

export function createDraftActions(store) {
  function setDraft(patch) {
    store.set(s => ({ draft: { ...s.draft, ...patch } }));
  }
  // Сброс ✨ Enhance preview: вызывается на любой смене model_id/prompt,
  // т.к. enhanced_prompt привязан к (model_id, prompt) парой и иначе
  // юзер увидит preview для прошлой ноды/прошлого текста.
  function resetEnhancedPreview() {
    return {
      enhanced_prompt: null, enhanced_busy: false,
      enhanced_error: null, enhanced_for: null,
    };
  }
  return {
    setFamily(family, { videoNodes }) {
      // Берём первую ноду нового семейства как дефолт; если уже выбрана
      // нода из этого family — не трогаем.
      const draft = store.get().draft;
      const curFamily = getNodeFamily(getNodeMeta({ videoNodes, nodeId: draft.model_id }));
      if (curFamily === family) {
        setDraft({ family });
        return;
      }
      const candidates = listNodesByFamily({ videoNodes, family });
      const first = candidates[0];
      if (!first) {
        // Семейство пустое (напр. video до того как /nodes/video подгрузился) —
        // переключаем только family, model_id не трогаем, чтобы UI не сломался.
        setDraft({ family });
        return;
      }
      const scenario = first.scenarios ? first.scenarios[0] : null;
      setDraft({
        family,
        model_id: first.node_id,
        scenario,
        slots: {}, params: {},
        ...resetEnhancedPreview(),
      });
    },
    setModel(model_id, { videoNodes }) {
      const meta = getNodeMeta({ videoNodes, nodeId: model_id });
      const scenario = meta ? meta.scenarios[0] : null;
      const family = getNodeFamily(meta) || store.get().draft.family;
      // Чистим params: у каждой ноды свой набор ключей; иначе aspect_ratio
      // от Seedance леется в Kling (где такого парама нет) и бэк его
      // тихо игнорирует, а на cost-preview видит «неизвестный ключ».
      // family синхронизируется автоматически — если юзер выбрал в picker'е
      // ноду другого семейства (теоретически невозможно при правильном
      // фильтре в FamilyTabs, но защищаемся).
      setDraft({ model_id, scenario, family, slots: {}, params: {}, ...resetEnhancedPreview() });
    },
    setScenario(scenario, { videoNodes }) {
      const draft = store.get().draft;
      const allowed = new Set(
        getSlotsForScenario({ videoNodes, nodeId: draft.model_id, scenario }).map(s => s.name)
      );
      const slots = {};
      for (const [k, v] of Object.entries(draft.slots)) {
        if (allowed.has(k)) slots[k] = v;
      }
      // params оставляем как есть: сценарии у одной ноды делят param-схему
      // (model_name/ratio/duration не зависят от scenario для 74/100/121).
      setDraft({ scenario, slots });
    },
    setPrompt(prompt) {
      // На любую правку промпта инвалидируем preview — иначе юзер увидит
      // enhanced-текст, не соответствующий тому, что он набрал.
      setDraft({ prompt, ...resetEnhancedPreview() });
    },
    setSlot(name, value) {
      const draft = store.get().draft;
      setDraft({ slots: { ...draft.slots, [name]: value } });
    },
    clearSlot(name) {
      const draft = store.get().draft;
      const slots = { ...draft.slots };
      delete slots[name];
      setDraft({ slots });
    },
    setParam(name, value) {
      const draft = store.get().draft;
      setDraft({ params: { ...draft.params, [name]: value } });
    },
    // ── ✨ Enhance actions ───────────────────────────────────────────────
    setEnhanceToggle(on) {
      // Toggle ON без preview ничего не запускает — это делает PromptInput
      // (он знает API instance, action чистый редьюсер).
      setDraft({ enhance_prompt: !!on });
    },
    setEnhancedBusy(busy) {
      setDraft({ enhanced_busy: !!busy, enhanced_error: null });
    },
    setEnhancedResult({ prompt, model_id, text }) {
      setDraft({
        enhanced_prompt: text,
        enhanced_busy: false,
        enhanced_error: null,
        enhanced_for: { prompt, model_id },
      });
    },
    setEnhancedError(message) {
      setDraft({
        enhanced_busy: false,
        enhanced_error: message || 'enhance failed',
      });
    },
    editEnhancedPrompt(text) {
      // Юзер правит превью — оставляем enhanced_for как есть (preview
      // всё ещё привязан к исходным (prompt, model_id)).
      setDraft({ enhanced_prompt: text });
    },
    clearEnhancedPreview() {
      setDraft(resetEnhancedPreview());
    },
  };
}

// Применение пресета («только форма»): возвращает draft-патч или ошибку.
// Pure — UI решает, как показать ошибку (toast) и когда вызывать store.set.
//  - model_id валидируется против актуальной slot_schema: пресет с нодой,
//    исчезнувшей из /nodes/video, не должен молча ломать форму;
//  - scenario сверяется с meta.scenarios (fallback на первый);
//  - slots всегда очищаются — файлы в пресете не хранятся by design;
//  - params копируются как есть (per-node ключи сохранены при save).
export function applyPresetToDraft(preset, { videoNodes }) {
  if (!preset || typeof preset.model_id !== 'number') {
    return { ok: false, error: 'bad_preset' };
  }
  const meta = getNodeMeta({ videoNodes, nodeId: preset.model_id });
  if (!meta) return { ok: false, error: 'unknown_model' };
  const scenarios = meta.scenarios || [];
  const scenario = scenarios.includes(preset.scenario)
    ? preset.scenario
    : (scenarios[0] || null);
  return {
    ok: true,
    draft: {
      family: getNodeFamily(meta) || preset.family || 'image',
      model_id: preset.model_id,
      scenario,
      prompt: preset.prompt || '',
      slots: {},
      params: { ...(preset.params || {}) },
      enhance_prompt: false,
      enhanced_prompt: null,
      enhanced_busy: false,
      enhanced_error: null,
      enhanced_for: null,
    },
  };
}

// «Preview всё ещё свежий?» — true, если enhanced_prompt получен ровно
// под текущие (model_id, prompt). UI использует, чтобы решить, можно ли
// сабмитить с enhanced-текстом или надо сначала re-enhance.
export function isEnhancedFresh(draft) {
  if (!draft) return false;
  if (!draft.enhanced_prompt || !draft.enhanced_for) return false;
  return (
    draft.enhanced_for.model_id === draft.model_id &&
    draft.enhanced_for.prompt === draft.prompt
  );
}

const ASSET_HISTORY_KEY = 'phygital-studio.assetHistory.v1';

export function loadAssetHistory() {
  try { return JSON.parse(localStorage.getItem(ASSET_HISTORY_KEY) || '{}') || {}; }
  catch { return {}; }
}
export function saveAssetHistory(history) {
  try { localStorage.setItem(ASSET_HISTORY_KEY, JSON.stringify(history)); } catch {}
}

export function isAssetCacheHit({ history, entry, now }) {
  // Hit if we've seen this sha256 before in this client (history[sha256] exists),
  // OR if the asset's uploaded_at is older than 5s (predates this upload attempt).
  if (history[entry.sha256]) return true;
  const ts = Date.parse(entry.uploaded_at);
  // uploaded_at >5s ago means the sidecar's AssetCache already had this file before our POST — it's a cross-session cache hit.
  if (!isNaN(ts) && (now - ts) > 5000) return true;
  return false;
}

export function createUploadActions(store) {
  let history = loadAssetHistory();
  return {
    async upload({ api, blob, filename }) {
      const entry = await api.uploadAsset({ blob, filename });
      const now = Date.now();
      const cached = isAssetCacheHit({ history, entry, now });
      if (!history[entry.sha256]) {
        history[entry.sha256] = { firstSeenAt: now, filename };
        saveAssetHistory(history);
      }
      return { entry, cached };
    },
  };
}

// Persistent cache of per-job artefacts (localPath, projectItemId). Sidecar
// /jobs API не знает про disk-path/Pr-binding — после перезагрузки панели
// миниатюра пропадала и "Show in bin" заново качал/импортировал.
// Храним только лёгкие метаданные, blob не дублируем (он уже на диске).
const JOB_META_KEY = 'phygital-studio.jobMeta.v1';

export function loadJobMetaCache() {
  try { return JSON.parse(localStorage.getItem(JOB_META_KEY) || '{}') || {}; }
  catch { return {}; }
}
let _lastJobMetaJson = null;
export function saveJobMetaCache(cache) {
  try {
    const s = JSON.stringify(cache);
    // Skip-if-unchanged: reconcile/patch дёргаются на каждом poll-тике, и
    // чаще всего содержимое идентично. Сверяем и с реальным storage — на
    // случай если его очистили извне (тесты).
    if (s === _lastJobMetaJson && localStorage.getItem(JOB_META_KEY) === s) return;
    localStorage.setItem(JOB_META_KEY, s);
    _lastJobMetaJson = s;
  } catch {}
}
export function patchJobMetaCache(jobId, patch) {
  const c = loadJobMetaCache();
  c[jobId] = { ...(c[jobId] || {}), ...patch };
  saveJobMetaCache(c);
}
export function dropJobMetaCache(jobId) {
  const c = loadJobMetaCache();
  if (jobId in c) { delete c[jobId]; saveJobMetaCache(c); }
}
// Sweep entries for jobs no longer present in the live list — keeps localStorage bounded.
export function reconcileJobMetaCache(remoteJobIds) {
  const c = loadJobMetaCache();
  const keep = new Set(remoteJobIds);
  let dirty = false;
  for (const k of Object.keys(c)) if (!keep.has(k)) { delete c[k]; dirty = true; }
  if (dirty) saveJobMetaCache(c);
}

export function mergeJobs(prev, remote) {
  const prevById = new Map((prev || []).map(j => [j.job_id, j]));
  const meta = loadJobMetaCache();
  const out = remote.map(rj => {
    const local = prevById.get(rj.job_id);
    const persisted = meta[rj.job_id] || {};
    // priority: server fields > in-memory local enrichments > persisted cache.
    // persisted re-hydrates after panel reload (когда prevById пуст).
    return { ...persisted, ...(local || {}), ...rj };
  });
  // Same-reference, если ничего не поменялось: App.js тогда скипает store.set
  // и Preact не пере-рендерит JobList/QueueWidget на каждом poll-тике.
  if (prev && _jobsListEqual(prev, out)) return prev;
  return out;
}

function _jobsListEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!_jobShallowEqual(a[i], b[i])) return false;
  }
  return true;
}

function _jobShallowEqual(x, y) {
  if (x === y) return true;
  const kx = Object.keys(x);
  const ky = Object.keys(y);
  if (kx.length !== ky.length) return false;
  for (const k of kx) {
    const vx = x[k];
    const vy = y[k];
    if (vx === vy) continue;
    // params / result_paths — вложенные структуры с сервера; сервер каждый
    // раз отдаёт новые объекты, сравниваем по содержимому.
    if (vx && vy && typeof vx === 'object' && typeof vy === 'object') {
      if (JSON.stringify(vx) !== JSON.stringify(vy)) return false;
      continue;
    }
    return false;
  }
  return true;
}

// Интервал поллинга /jobs: есть активные джобы → 1s (быстрее ловим completion
// и auto-import), idle → 5s (не дёргаем sidecar зря). Pure для тестов.
export const ACTIVE_JOB_STATUSES = new Set(['queued', 'running', 'pending']);
export function jobsPollInterval(jobs) {
  const active = (jobs || []).some(j => ACTIVE_JOB_STATUSES.has(j.status));
  return active ? 1000 : 5000;
}

// Auto-import policy. Баг: при открытии любого проекта первый poll-тик видел
// всю историю sidecar (она глобальная, не per-project), diffJobs помечал все
// completed как «новые» и App.js заносил до 50 старых генераций в bin.
//  - isBaseline (первый успешный тик после маунта панели) → ничего не
//    импортируем: эти джобы завершились до открытия панели;
//  - meta-guard: job с localPath в jobMetaCache уже скачивался/импортировался
//    в прошлой сессии → skip (миниатюра восстановится через mergeJobs).
// Старые результаты по-прежнему доступны через ленивый ensureImported()
// («Show in bin» / «To timeline») — но это явный клик юзера.
export function pickAutoImportJobs(completedNow, meta, isBaseline) {
  if (isBaseline) return [];
  const m = meta || {};
  return (completedNow || []).filter(j => !(m[j.job_id] && m[j.job_id].localPath));
}

export function diffJobs(prev, remote) {
  const prevById = new Map((prev || []).map(j => [j.job_id, j]));
  const completedNow = [];
  const newJobs = [];
  for (const rj of remote) {
    const local = prevById.get(rj.job_id);
    if (!local) {
      newJobs.push(rj);
      if (rj.status === 'completed') completedNow.push(rj);
      continue;
    }
    if (local.status !== 'completed' && rj.status === 'completed') {
      completedNow.push(rj);
    }
  }
  return { completedNow, newJobs };
}
