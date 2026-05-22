# Sub-project B — Premiere Pro panel — Design spec

**Дата:** 2026-05-21
**Статус:** design approved (brainstorm закончен)
**Зависит от:** sub-project A (sidecar MVP), D (видео-воркфлоу), img2img hot-fix, Live E2E 5/5 — все закрыты 2026-05-21.
**Что разблокирует:** sub-project C (AE-панель — переиспользует те же модули) + E (расширенные input sources — drag-and-drop, sequence-segments).

## 1. Контекст и цели

Phygital Adobe Studio состоит из локального FastAPI-sidecar'а + двух CEP-панелей: Pr и AE. Sidecar полностью готов: 5 моделей × 10 сценариев Phygital+, asset cache с sha256-dedup, cost preview, error propagation, всё подтверждено Live E2E на 5/5 узлах. Sub-project B — это **первая UI-обёртка**, которая позволяет монтажёру/моушен-дизайнеру в Premiere Pro:
1. Выбрать модель и сценарий Phygital+.
2. Подсунуть в обязательные слоты файлы из 4 источников: bin / timeline / source monitor / disk.
3. Запустить генерацию и видеть прогресс.
4. Автоматически получить результат в bin проекта и вставить на таймлайн одним кликом.

Не-цель MVP: drag-and-drop, multi-segment timeline extracts, asset cache manager UI, sidecar autostart, Mac QA. Эти задачи — отдельные sub-projects (E, F).

## 2. Зафиксированные решения брейншторма

| # | Решение | Обоснование |
|---|---|---|
| 1 | **Scope:** форма генерации + cost preview + история джоб + multi-source input | Cost preview критичен (Phygital жжёт кредиты молча); история нужна для видео-джоб 30-300s; multi-source — главное «зачем» интеграции с Pr |
| 2 | **File source model:** pre-selection в Pr + disk Browse, без drag-and-drop в MVP | Selection API в CEP стабильное; drag-host из Pr — глючная зона |
| 3 | **Video → image slot:** auto-extract playhead frame + UI-подсказка | Меньше кликов, mental model «то что вижу — то и попадёт» |
| 4 | **Result delivery:** auto-import в bin при completed + manual `[Insert to timeline]` | Auto-insert загрязняет sequence; preview-only — лишние клики |
| 5 | **Layout:** 2 таба — `Generate` / `History` | CEP-панель узкая; tabs снижают визуальный шум |
| 6 | **Persistence:** stateless по job/asset state (sidecar = source of truth) + localStorage только для draft формы | sidecar уже держит jobs.jsonl + asset_cache.jsonl; UI-state дублировать незачем |
| 7 | **Платформа:** Win-first, Mac-compat без QA | Не блокируем себя Win-only API; Mac QA — отдельная фаза |
| 8 | **Стек:** Preact + htm, без bundler, vendor copies | Реактивность + zero build pipeline; ZXP-build остаётся примитивным zip'ом |

## 3. Архитектура

### 3.1 Границы модулей

```
cep-premiere/
├── CSXS/
│   └── manifest.xml              CEP extension descriptor (PPRO Win+Mac targets, debug port)
├── client/                       UI side — HTML+JS внутри CEF
│   ├── index.html                shell, грузит panel.js как ES module
│   ├── panel.js                  entry: рендерит <App>, монтирует store, запускает poller
│   ├── panel.css                 styles
│   ├── vendor/                   offline copies (не CDN — CEF ограничен по CSP)
│   │   ├── preact.module.js
│   │   ├── preact-hooks.module.js
│   │   ├── htm.module.js
│   │   └── CSInterface.js        Adobe CEP bridge (из Adobe CEP-Resources)
│   ├── lib/
│   │   ├── api.js                **единственный модуль с fetch**: /health, /nodes, /nodes/video,
│   │   │                          /assets, /jobs, /jobs/preview-cost, /jobs/{id}, /jobs/{id}/download
│   │   ├── host.js               **единственный модуль с CSInterface.evalScript**, обёртка над host.jsx
│   │   ├── state.js              reactive store: draft form + cached job list snapshot
│   │   ├── validation.js         чистые функции: form-валидация, scenario↔slot compat
│   │   ├── toast.js              toast-система: success / warning / error
│   │   └── slot_schema.js        статическая таблица для node 94 (которой нет в /nodes/video)
│   └── components/               Preact components
│       ├── App.js                root: <Header>, <Tabs>, <GenerateTab>, <HistoryTab>
│       ├── Header.js             sidecar/session status pill
│       ├── Tabs.js
│       ├── GenerateTab.js
│       ├── ModelPicker.js
│       ├── ScenarioPicker.js
│       ├── PromptInput.js
│       ├── SlotList.js
│       ├── SlotPicker.js         source toggle + thumbnail + clear
│       ├── ParamsAccordion.js
│       ├── CostBar.js
│       ├── SubmitButton.js
│       ├── HistoryTab.js
│       ├── JobFilter.js
│       ├── JobList.js
│       └── JobCard.js            insert / show-in-bin / download / delete actions
└── host/
    └── host.jsx                  ExtendScript: getSelection, extractFrame, importToBin, insertClip
```

### 3.2 Ключевые инварианты

- **panel.js не знает про Phygital.** Только HTTP к sidecar + evalScript к host.
- **host.jsx не знает про sidecar.** Только Pr API.
- **api.js — единственная точка fetch.** Все остальные модули вызывают api.*.
- **host.js — единственная точка evalScript.** Все остальные модули вызывают host.*.
- **state.js — единственная точка mutation.** Components читают через subscribe/hook; mutate через actions.

### 3.3 Зависимости

| Зависимость | Версия | Где живёт | Зачем |
|---|---|---|---|
| Preact | 10.x | `vendor/preact.module.js` | reactive rendering |
| preact/hooks | 10.x | `vendor/preact-hooks.module.js` | useState, useEffect |
| htm | 3.x | `vendor/htm.module.js` | JSX-подобный синтаксис без транспиляции |
| CSInterface | 9+ (ideally: CEP12) | `vendor/CSInterface.js` или из Adobe SDK | мост к host (evalScript) |
| FormData / fetch | браузерные | — | upload файлов в sidecar |

Версии vendor'а замораживаем в commit, обновление — отдельный PR.

## 4. UI компоненты

Дерево полностью описано в §3.1. Здесь — ключевые контракты.

### 4.1 Динамическая форма

`<GenerateTab>` слушает state и рендерит зависимо от `state.draft.model_id` и `state.draft.scenario`:

```
state.draft = {
  model_id: 94 | 74 | 100 | 121 | 124,
  scenario: "start_prompt" | "start_end_prompt" | "ref_prompt" | ... ,
  prompt: string,
  slots: { [slot_name]: SlotValue | SlotValue[] },
  params: { [param_name]: any }   // optional, defaults из /nodes/video
}
SlotValue = {
  source: "bin" | "timeline" | "source_monitor" | "disk",
  path: string,                   // абсолютный путь (после extract'а если video→image)
  name: string,                   // отображаемое имя
  thumb?: string,                 // dataURL превью (если есть)
  asset?: AssetEntry              // после успешного upload (file_obj_id, sha256, dedup)
}
```

Slot list берётся:
- Для node 94 (Nano Banana) — статичный `{ init_img: "array" }` из `slot_schema.js`.
- Для нод 74/100/121/124 — из `/nodes/video` → `nodes[i].scenario_slots[scenario]`.

При смене `model_id` или `scenario`:
- Очищаются slots, которых нет в новой схеме (с toast «slot X не использовался в новом сценарии»).
- Сохраняются slots, имена которых совпадают (`init_img` остаётся при переключении Kling start_prompt → start_end_prompt — только image_tail добавится).

### 4.2 Slot picker UX

`<SlotPicker name="init_img" kind="array|scalar" required>`

```
┌─ init_img (required, array) ─────────────────────┐
│ [Bin] [Timeline] [Source mon] [Browse...]         │
│                                                   │
│ ┌──────────────────────────────────────────────┐ │
│ │ [thumb] test.jpg          2048×2048  cached  │ │
│ │                                       [×]    │ │
│ └──────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────┘
```

- Source-кнопки активны всегда; нажатие триггерит соответствующий host-call или disk dialog.
- Для `array`-slots можно добавлять несколько файлов (multiple thumbnails в столбик); `scalar` — только один (повторный pick заменяет).
- `cached` индикатор появляется, если sidecar после upload вернул entry с уже известным sha256.
- `[×]` очищает slot value.

### 4.3 Cost preview

`<CostBar>`:

```
┌─ Estimated cost ──────────────────────────────────┐
│ [Estimate]   ← клик дёргает /jobs/preview-cost    │
│ После клика:                                      │
│ ~120 credits                                      │
│ (your balance: 4 520)                             │
│                                                   │
│ ⚠ This generation will cost > 100 credits  (если)│
└───────────────────────────────────────────────────┘
```

Estimate автоматически НЕ дёргается (экономим credits-API hit). Кнопка ручная. Результат кешируется в state до изменения params.

### 4.4 Job card

```
┌─ Kling v3 pro · start_prompt ─────────  3m 12s ──┐
│ ● running                                         │
│ "slow gentle camera push-in, subtle atmospheric…" │
│ progress: ▓▓▓▓░░░░░░ 42%                          │
└───────────────────────────────────────────────────┘

┌─ Nano Banana · img2img ───────────────  35s ─────┐
│ ● completed                                       │
│ "add warm sunset lighting…"                       │
│ [thumb of result]                                 │
│ [Insert to timeline]  [Show in bin]  [Download]   │
│                                          [Delete] │
└───────────────────────────────────────────────────┘

┌─ Seedance 2.0 p720 · start_prompt ────  18s ─────┐
│ ● failed                                          │
│ "slow gentle camera push-in…"                     │
│ Error: The request failed because the input image │
│ may contain real person                           │
│ [Retry]  [Delete]                                 │
└───────────────────────────────────────────────────┘
```

Sort: newest first. Pagination — нет (limit=50 из sidecar; если будет больше — добавим filter).

### 4.5 Header / status pill

`<Header>`:

```
┌─ Phygital Studio ───────────────── ● online ────┐
```

Полinger 5s. Состояния pill:
- `green online` — `/health` 200 + jwt_ttl_sec > 0
- `yellow no session` — `/health` 200 + jwt_ttl_sec ≤ 0 → клик открывает `POST /auth/recon`
- `red offline` — `/health` fails (network error или 5xx)

При `offline` или `no session` весь `<GenerateTab>` disabled (с tooltip почему).

## 5. Data flow

Три основных flow в системе:

**(a) User-action flow** (slot pick, form mutation): UI event → state.js action → state mutation → Preact re-render. Никаких side-effects вне state.js (никаких прямых fetch/evalScript из компонентов).

**(b) Submit flow:** [Submit] click → validation.js валидирует draft → api.uploadAsset() для каждого slot файла (parallel) → api.previewCost (если ещё не запрошено) → api.createJob(node_id, params, init_files: dict) → state.appendJob({id, status: "queued"}) → переключение на History tab.

**(c) Polling flow:** Раз в 2s `api.listJobs(limit=50)` → diff с локальным snapshot → для каждой changed job обновляем state. При первом `status="completed"` → `api.downloadJob(id)` (sidecar отдаёт blob) → host.importToBin(localPath) → state.setJobProjectItem(jobId, projectItemId). Polling останавливается, когда нет jobs в running/queued.

Сверху — **детали upload-цикла**:

```
Slot picked (disk/bin/timeline/source-mon)
  ↓
Для video clip + image-slot → host.extractFrame() → temp/frame.jpg
  ↓ (path к файлу на диске)
state.setSlot(slot, {path, name, thumb})
  ↓
[on submit или явный upload trigger] → api.uploadAsset(formdata file=path)
  ↓
Sidecar AssetCache.add():
  - sha256 файла
  - если в кэше → return existing entry (с dedup-флагом в headers? или просто same uploaded_at — мы посмотрим, что вернёт)
  - если нет → _prepare_for_upload (для images: ресайз/EXIF/RGB) + upload в Phygital → file_obj_id
  ↓
api.uploadAsset() → AssetEntry { sha256, file_obj_id, height?, width?, ... }
  ↓
state.setSlotAsset(slot, entry)
  ↓
UI обновляет SlotPicker: thumb + filename + cached-indicator если duplicate
```

**Dedup-индикатор:** sidecar возвращает один и тот же AssetEntry на повторный upload того же файла. Чтобы UI понял, что это hit — храним в state.uploadHistory локальные timestamps. Если `entry.uploaded_at < (now - 5s)` → это cache hit (т.е. файл был залит раньше). Не идеально, но без изменения sidecar API сойдёт. Альтернатива: добавить в sidecar header `X-Asset-Cache: hit` — отложено, не нужно для MVP функционально.

## 6. Error handling

Категории ошибок и UX:

| Источник | Тип | UI |
|---|---|---|
| `/health` fails | sidecar down / no session | red header pill + Generate disabled + toast «sidecar offline» |
| `/assets` 5xx, network | upload fail | inline warning под slot picker + retry button |
| `/jobs` POST 4xx (валидация slots) | сценарий несовместим | toast.error с сообщением sidecar'а; форма не очищается |
| `/jobs` POST 402 / 403 | мало кредитов / нет сессии | toast.error + ссылка на app.phygital.plus |
| job state = `failed`/`canceled` | content moderation, etc. | error в JobCard + [Retry] кнопка (форма пересоздаётся из job.params) |
| host.jsx returns `ok: false` | Pr API глюк | inline warning в SlotPicker / JobCard, не блокирует остальные действия |
| `extractFrame` fail | нет clip / timecode out of range | inline warning «Frame extract failed: <reason>» |

Дополнительно:

### 6.1 Toast система

`lib/toast.js` экспортирует:
```js
toast.success(msg, durationMs=3000)
toast.warning(msg, durationMs=5000)
toast.error(msg, durationMs=8000, persistent=false)
```

UI: top-right corner, stack до 3 toasts, dismissible кликом. Без эмодзи (per memory rule UI minimal emoji). Цвета — solid, контрастный border, без gradient.

### 6.2 Inline warnings

В каждом `<SlotPicker>` есть зона под source-кнопками для inline-warnings:
- «No clip selected in bin»
- «Slot expects image, got audio»
- «Frame extract failed: no clip at playhead»

Inline warning исчезает при следующем successful action на этом slot'е.

### 6.3 Sidecar disconnect resilience

Когда `/health` начинает возвращать errors во время polling:
1. Header pill → red.
2. Polling приостанавливается (don't spam).
3. Раз в 5s делаем `/health` retry.
4. При успешном повторе — resume polling + toast «sidecar reconnected».

Job'ы которые крутились в момент disconnect — их state восстановим по `GET /jobs` при reconnect.

## 7. Testing strategy

### 7.1 Unit tests — vitest + jsdom

Покрытие >80% для:
- `lib/api.js` — request builders, response parsers, error mapping.
- `lib/state.js` — reducers (slot set, scenario change, draft save/restore, polling state machine).
- `lib/validation.js` — form-валидация (slot completeness, prompt length, scenario↔node compat).
- `lib/slot_schema.js` — static + dynamic slot list generation.

~30-50 тестов. Запуск: `cd cep-premiere && npm test`.

### 7.2 Integration tests — vitest с реальным sidecar

| Сценарий | Подтверждаем |
|---|---|
| Sidecar up → /health succeeds → GenerateTab активна | api.js + state.js wired |
| Upload via /assets → повторный upload → cache hit detect | dedup-handling |
| Submit job → poll until completed → download blob | end-to-end без Pr |
| Cancel job (DELETE) → state updates | cancel flow |

~10-15 тестов. Запуск рядом с уже работающим sidecar (отдельный helper в test setup).

### 7.3 Manual E2E чек-лист

Хранится в этом spec'е (§9) и в `cep-premiere/README.md`:
1. Установить panel в `<PROGRAMDATA>/Adobe/CEP/extensions/com.phygital.studio.pr/`.
2. Открыть Pr → панель в Window menu.
3. Sidecar offline → red pill → Generate disabled.
4. Запустить sidecar → green pill → form working.
5. Pick disk file → submit Nano Banana img2img → completed → in bin → insert на таймлайн.
6. Pick timeline clip + extract frame → submit Kling → completed → in bin.
7. Submit Seedance с broken-content prompt → failed → error в JobCard видно.
8. Перезагрузить panel → draft восстановлен → running jobs продолжают polling.
9. Kill sidecar в процессе → red pill → reconnect → polling resumes.

### 7.4 ExtendScript host.jsx — manual

API contract (§8) тестируется через ExtendScript Debugger (VS Code extension). Не автоматизируем — нет CI для ES3 VM.

## 8. ExtendScript host.jsx — public API

Все функции возвращают `JSON.stringify({ok: bool, ...})`. Panel парсит ответ.

```jsx
// 8.1 Получить текущий selection в Project bin
// → {ok: true, items: [{path, name, kind: "video"|"image"|"audio"|"sequence", projectItemId}]}
// → {ok: false, error: "no_selection"|"unsupported_kind"}
function getBinSelection(): string

// 8.2 Получить selected clip(s) на текущей таймлайне
// playheadOnly=true → берём только клипы под playhead
// → {ok: true, items: [{path, name, kind, in_sec, out_sec, trackIndex}]}
// → {ok: false, error: "no_active_sequence"|"no_selection"|"no_clip_at_playhead"}
function getTimelineSelection(playheadOnly: bool): string

// 8.3 Получить клип из Source monitor
// → {ok: true, item: {path, name, kind}}
// → {ok: false, error: "no_source_monitor_clip"}
function getSourceMonitorItem(): string

// 8.4 Извлечь кадр из video clip
// projectItemId — id из getBinSelection / getTimelineSelection
// timecodeSec — null = playhead текущей sequence; число = explicit time
// → {ok: true, framePath: "C:/.../frame_<uuid>.jpg", timecode: "00:01:23.456"}
// → {ok: false, error: "extract_failed", reason: "..."}
function extractFrame(projectItemId: string, timecodeSec: number|null): string

// 8.5 Импортировать файл в bin (создаёт PhygitalStudio bin если его нет)
// → {ok: true, projectItemId: "...", binName: "PhygitalStudio"}
// → {ok: false, error: "import_failed", reason: "..."}
function importToBin(path: string): string

// 8.6 Вставить projectItem на activeSequence в playhead
// → {ok: true, sequenceId: "...", insertedAt: "00:01:23.456"}
// → {ok: false, error: "no_active_sequence"|"insert_failed", reason: "..."}
function insertClipAtPlayhead(projectItemId: string): string
```

Внутри `host.jsx` — обёртки над Pr ExtendScript: `app.project.activeSequence`, `app.project.rootItem.children`, `qe.project.getActiveSequence().exportFrameJPEG(...)` (если qe доступен) или `ProjectItem.exportFrameJPEG(...)`.

## 9. Implementation decomposition (B.1 – B.9)

| Шаг | Что | Acceptance |
|---|---|---|
| B.1 | Shell: index.html + panel.css + Preact/htm vendor + минимальный <App> с тестом + manifest.xml | Panel грузится, Header pill green при поднятом sidecar |
| B.2 | Read-only Generate form (no submit) + lib/state.js + draft autosave | Выбор Nano Banana→start_prompt рендерит правильный slot list |
| B.3 | Disk source + uploadAsset + thumbnail в slot picker + cached-индикатор | test.jpg загружается, повторный pick показывает cached |
| B.4 | Submit + polling loop + History tab + auto-download | Nano Banana img2img → completed → файл скачан |
| B.5 | Cost preview (CostBar + previewCost API) | Estimate показывает ~N credits |
| B.6 | host.jsx + host.js + Bin/Timeline/Source-monitor sources + frame extract | Pick clip из timeline → extract frame → upload → submit |
| B.7 | host.jsx importToBin + insertClipAtPlayhead + JobCard actions | Completed job → import in bin → insert на playhead одним кликом |
| B.8 | Error UX polish (toasts + inline warnings + disconnect handling) | Kill sidecar в процессе → red pill, no spam, reconnect resumes |
| B.9 | Manual E2E + README + vault closure note | Все 9 пунктов §7.3 пройдены вручную |

B.6 может идти параллельно с B.3-B.5 (две ветки работы).

## 10. Open items / risks

- **Frame extract method:** ExtendScript в Pr имеет `ProjectItem.exportFrameJPEG(filePath, timeSec)` (Pr 22+); проверить на текущей версии (`qe.project.getActiveSequence().exportFrameJPEG()` — fallback через QE).
- **CSP в CEF:** vendor copies — обязательны, CDN заблокирован. Проверить, что Preact module корректно грузится в CEP 11/12.
- **CSInterface multi-version:** CEP 11 vs CEP 12 — поведение немного отличается. Тестируем на текущей версии Pr (2025/26).
- **localStorage limits в CEP:** обычно 5-10 MB, для draft формы — overkill. Не проблема.
- **Dedup indicator without sidecar change:** §5 heuristic «uploaded_at < now - 5s» — fragile. Можно потом улучшить, добавив `X-Asset-Cache: hit` header в sidecar (отложено).
- **Project items refs stability:** Pr может переиздать projectItem'ы при reload/import. Сохраняем `projectItemId` в JobCard state — если ref устарел, host.insertClipAtPlayhead вернёт error, юзер увидит и нажмёт [Show in bin] для navigation.
- **Auto-import конкурентность:** если две джобы завершатся одновременно, обе захотят `importToBin`. ExtendScript однопоточный → последовательно через `host.js` Promise queue.

## 11. Что НЕ в этом spec'е

- AE-панель (sub-project C — отдельный spec).
- Расширенные input sources: drag-and-drop, sequence-segments, multi-track export (sub-project E).
- Sidecar autostart (Windows service, launchd) — sub-project F.
- Asset cache manager UI (отдельная вкладка для просмотра/удаления всех залитых файлов) — отложено, sidecar уже даёт `DELETE /assets`.
- Settings panel (sidecar URL, max concurrent, log level) — отложено, defaults достаточно.
- Mac QA — отдельная фаза.

## Связанные

- [[Phygital Adobe Studio]] (vault folder note)
- [[Sidecar MVP — закрытие sub-project A 2026-05-21]]
- [[Sub-project D — закрытие видео-воркфлоу 2026-05-21]]
- [[Img2img фикс Nano Banana 2026-05-21]]
- [[Live E2E все 5 узлов 2026-05-21]]
