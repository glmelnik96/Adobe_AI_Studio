# Комплексный аудит после V1.1 (2026-05-23)

Свод результатов четырёх параллельных аудитов: internal panel, internal sidecar,
external (Pr/AE marketplace), external (web AI tools UX).

---

## TL;DR — Топ-10 приоритетных действий

| # | Action | Categ. | Effort | Impact | Источник |
|---|---|---|---|---|---|
| 1 | **Re-import dedup fix** (NEXT_AUDIT.md §1: `mergeJobs` before `diffJobs` + host-side `findByPath`) | bug | S | High | panel #1 |
| 2 | **PhygitalClient resource leak** в `preview_cost`/`account` (нет `await` на `__aexit__`) | bug | S | Critical | sidecar #1,#2 |
| 3 | **HEAD /download auth** — endpoint открыт без токена | sec | XS | High | sidecar #5 |
| 4 | **Video-to-video / restyle режим** — выделенный клип → промпт → новая версия | feature | M | Very High | external #1 (ChatVideoPro делает на этом маркетинг) |
| 5 | **N-variant batch (1/2/4 grid)** — Midjourney-pattern, переиспользует очередь | feature | S | High | web #1 |
| 6 | **Insert-as-overlay-track** (Topaz-pattern) рядом с insert в bin | feature | S | Medium | external #3 |
| 7 | **Prompt history + 1-click re-roll** | feature | S | High | web #2 |
| 8 | **Preset-pack** (b-roll / transition / establishing-shot) | feature | M | High | external #5 |
| 9 | **Vision-LLM frame-to-prompt** (взять фрейм → GPT-4V описывает → редактируешь) | feature | M | High | external #4 |
| 10 | **AssetCache double-upload race** + jsonl compaction | reliability | M | Medium | sidecar #3,#13 |

---

## 1. Internal — CEP Premiere Panel

### Critical (4)
1. **Re-import дублей при reload** — порядок `diffJobs`/`mergeJobs` в `App.js:75-131`. Решение в `NEXT_AUDIT.md §1`.
2. **Race в auto-fill image slot** (`GenerateTab.js:77-104`) — `autoFilledForScenarioRef` блокирует A→B→A re-fill. Добавить timestamp в ключ.
3. **ObjectURL leak в History** (`App.js:160-162`) — нет global cleanup в `beforeunload`.
4. **No partial-success в array-slot pick** (`GenerateTab.js:272-303`) — один failed item → весь onPick колапсится.

### Performance (3)
1. O(N²) при auto-import N completed-джобов после reload (`host.jsx _findProjectItemById`). Добавить `_pathCache`.
2. Cost-estimate debounce 600ms — на copy-paste каждый paste = 600ms wait. Inline "stale estimate" в SubmitButton.
3. Нет LRU на localStorage — `ASSET_HISTORY_KEY` растёт без ограничений (лимит 5-10MB).

### UX gaps (4)
1. Auto-fill image slot молча no-op'ит при non-image clip / нет sequence. Добавить inline-hint.
2. Discoverability "Timeline frame" vs "Timeline In/Out" в SlotPicker — кнопки без context.
3. При import-fail после download — `localPath` потерян в toast'е (исчезает через 5s). Добавить "Show in explorer" + retry в History.
4. Cost estimate не передаёт `init_files` — для платных-per-MB моделей цена неточна.

### Missing features (4)
1. Undo/Redo для draft-form (Ctrl+Z после смены scenario).
2. Batch ops в History (multi-select delete/retry).
3. Keyboard shortcuts (Ctrl+Enter → Submit, Ctrl+H → History tab).
4. Preview перед insert (external viewer вместо сразу bin).

### Test gaps (3)
- `mergeJobs` после reload (восстановление projectItemId из meta).
- Integration test: poll-loop → diffJobs → importToBin → meta-cache (re-import guard).
- `friendlyHostError` маппинг unknown-code/long-reason.

### Quick wins (5)
1. Disabled-state на SlotPicker при offline sidecar (15 мин).
2. Upload-progress для больших файлов в slot (45 мин).
3. Cachebust localStorage на major version (20 мин).
4. `sidecar/pyproject.toml` version bump до `1.1.0` (5 мин).
5. File-picker cancel vs error различение (20 мин).

---

## 2. Internal — Sidecar (FastAPI)

### Critical (5)
1. **PhygitalClient leak в `preview_cost`** (`routers/jobs.py:45-75`) — `__aexit__` без `await`. При параллельных preview исчерпание FD.
2. **PhygitalClient leak в `account/balance`** (`routers/account.py:21-33`) — то же в finally.
3. **AssetCache double-upload race** (`asset_cache.py:127-194`) — два параллельных `add()` одного файла оба попадают на upload.
4. **Cancelled jobs могут не записаться в jsonl** на shutdown — `cancel_all()` race перед task.cancel.
5. **HEAD /download без auth** (`jobs.py:206-225`) — PUBLIC_PATHS только `/health`, но HEAD унаследован.

### Security & Privacy (4)
1. Bearer-token может попасть в 401-retry logs (`phygital_client/api.py:111-119`) — log redaction ловит JWT, но не body.
2. `task_registry.restore()` доверяет content jsonl — `result_paths` валидируется только в `_resolve_download`, но не при restore.
3. ffmpeg `-protocol_whitelist file,crypto,data` (`clips.py:156`) — `crypto:` / `data:` могут быть вектором.
4. `assert max_concurrent >= 1` отсутствует в `JobRunner.__init__`.

### Performance (3)
1. `_sha256_file()` читает весь файл в память — на 500MB+ memory spike.
2. Nested semaphores video+general могут давать contention при ratio 8:2.
3. `_active` dict — нет try/except в callback `_pop`-а, может зависнуть.

### Reliability (4)
1. Atomicity create+schedule в `POST /jobs` — между create и schedule sidecar может упасть → orphan.
2. `asset_cache.jsonl` растёт без compaction (10k+ uploads = медленный restore).
3. `task_registry.restore()` не валидирует `node_id` против `NODES` — unknown ID создаёт JobState(node_id=0).
4. Нет SIGTERM-handler с graceful wait-timeout перед force cancel_all.

### Missing endpoints (6)
1. **Webhooks/SSE для job-completion** (вместо polling).
2. **DELETE /jobs/batch** для group-cancel.
3. **POST /jobs/{id}/retry** с exponential backoff.
4. **GET /assets/stats** (count, total_size, oldest).
5. Filters в GET /jobs — `created_after`, `node_id`, `error_contains`.
6. **GET /jobs/{id}/stream** SSE для прогресса.

### Test gaps (5)
- 5xx retry + timeout в phygital_client.
- Concurrent add() same file в asset_cache.
- Integration: kill sidecar → restart → orphans помечены failed.
- ffmpeg symlink-to-pipe rejection.
- Idempotency-conflict (different body).

### Quick wins (5)
1. `asyncio.wait_for(ffmpeg, timeout=120)` (`clips.py:170,233`).
2. `logger.exception(f"run_job({job_id}, node={node_id}, params_keys=...)")` (`job_runner.py:173`).
3. `assert max_concurrent >= 1` + видеосемафор >= 0.
4. Hardcode `PUBLIC_PATHS = frozenset({'/health'})`, убрать unused-параметр.
5. `session_ok: bool` в response `preview_cost`.

---

## 3. External — Pr/AE marketplace

### Прямые конкуренты

**ChatVideoPro** (chatvideopro.com) — единственный прямой аналог:
- 10+ моделей (Sora, Veo, Kling, Flux, Nano Banana) → таймлайн
- **Story Cutter** — LLM анализирует речь, делает rough cut
- **Timeline Prompter** — b-roll/переходы в текущую секвенцию
- **Reshoot Mode** — замена одежды/неба/освещения
- **Thumbnail Studio** с canvas-редактором
- Voice commands, SAM3-рото, Lumetri ассистент
- BYOK billing dashboard
- Pay-per-use без watermark
- Только Pr (нет AE), нет sidecar (vendor lock), не open-source

**Diffusae 2 / Local Diffusion** (aescripts) — AE-only локально на GPU:
- SD 1.5/SDXL/Civitai + ControlNet + InstructPix2Pix
- Native AE-effect (keyframable), не панель
- Lifetime license, offline, неограничено
- Нет современных video-моделей (Sora/Veo/Kling)

**Topaz Premiere Panel** (UXP!) — enhancement, не genAI:
- Starlight / Astra / Proteus upscale/denoise в cloud → новая track как overlay
- **UX-паттерн который стоит украсть**: результат как overlay-track, не replace

### Косвенные

**Adobe Firefly Video + Generative Extend** (Pr 25.x) — главная стратегическая угроза:
- Generative Extend (макс 2 сек видео, 10 сек аудио)
- Firefly Video Model, Firefly Boards в AE 25.2 с Nano Banana/Luma/Pika/Runway/Moonvalley
- **Заблокирован в РФ/РБ/Китае** — наш ключевой USP
- Ограничения: 2 сек, без HDR/iPhone, без музыки в клипе
- **Adobe анонсировал** native plugins Sora/Runway/Pika/Luma в Pr — но не доставил. Окно для нас: **6-12 месяцев**.

**Premiere Pro MCP** (github: leancoderkavy, hetpatel-11) — MCP-мост 269 команд:
- Не генерирует, но интересный pattern → можно добавить MCP-режим в sidecar.

**DaVinci Resolve 20** — anti-generation позиция:
- Только enhancement (UltraNR, Magic Mask, SuperScale), не generates
- Lifetime $295, no fees
- Философская дифференциация: "AI который не замещает съёмку"

### Что они делают лучше нас

| Фича | Кто | Приоритет |
|---|---|---|
| Video-to-video / restyle | ChatVideoPro, Diffusae | **P0** |
| Story Cutter / LLM над таймлайном | ChatVideoPro | P1 |
| Insert as overlay-track (non-destructive) | Topaz | **P0** (low effort) |
| Voice-команды | ChatVideoPro | P3 |
| Native AE-effect (не панель) для img2img | Diffusae | P2 |
| Drag-to-extend жест на таймлайне | Adobe Gen-Extend | **P0** |
| BYOK + унифицированный billing | ChatVideoPro | P2 |
| Presets для use-cases | ChatVideoPro | P1 |
| Frame-to-prompt (vision-LLM caption) | ChatVideoPro | P1 |

### Что мы делаем лучше них

1. **Доступность в РФ** — Firefly заблокирован, ChatVideoPro через US-прокси (риск).
2. **Локальный sidecar** — данные не уходят на чужой backend кроме модели.
3. **Open-source-ready архитектура** (CEP + Python).
4. **Persistent queue + idempotency** — у ChatVideoPro не заявлено публично.
5. **Pr+AE одним sidecar** — Topaz/Diffusae только что-то одно.
6. **Прозрачность** — мы показываем Phygital+ node spec, у конкурентов black-box.

---

## 4. External — Web AI tools UX

### Tier A — high impact, low effort (≤1 спринт)
1. **N-variant batch (2×2 grid)** — Midjourney pattern. Селектор "Variants: 1/2/4" рядом с Generate.
2. **Discrete strength slider** (Leonardo) — Subtle/Mild/Default/Strong/Max вместо 0-1.
3. **Prompt history + re-roll** (Replicate) — persist last 50 в `disk.js`, collapsible panel.
4. **Cost = pre + actual** — добавить `actual_cost` в job records.
5. **Hover-scrub video thumbnails** (Runway) — ~20 LOC в SlotPicker / queue.

### Tier B — high impact, medium effort (1-2 спринта)
6. **Multi-slot typed references** (Pika ingredients / Kling) — subject/style/character/environment slots.
7. **Start+End keyframe для i2v** (Luma/Pika) — **наш unique advantage**: автозаполнение из In/Out таймлайна.
8. **Workflow presets** (Runway / ComfyUI App Mode) — YAML preset = {model, scenario, params, slots}.
9. **Prompt enhancer button** ("✦") — LLM rewrite с diff.
10. **A/B compare view** для 2 jobs со synced playhead.

### Tier C — high impact, higher effort
11. **Motion brush lite** (Runway) — mask + 4-way direction.
12. **Workflow chains** (Runway/fal.ai) — Job A out → Job B in.
13. **Asset library tab с фильтрами** (Runway).
14. **Storyboard mode** (Sora/Pikaframes) — row of shots → drop sequence в таймлайн. **Killer feature**.

### Tier D — defer
- Real-time canvas (Krea) — metered cloud, не подходит.
- Node graph (ComfyUI) — слишком широко для 320px panel.
- Discovery feed (Sora/Midjourney) — single-user.

### Anti-patterns (НЕ копировать)
- Opaque credit math (Runway/Luma/Kling).
- Modal-heavy reference upload (early Leonardo).
- Hidden queue position.
- Forced 4-image surcharge (Midjourney).
- "Magic" prompt rewriting без diff.
- Wide node graphs в narrow panels.
- Settings в cogwheel modals.

---

## Strategic conclusion

**Стратегическая угроза:** Adobe анонсировал native Sora/Runway/Pika/Luma plugins в Pr. Не доставил. Окно — **6-12 месяцев**.

**Наш USP** (защищать любой ценой):
1. РФ-доступность через Phygital+.
2. Локальный sidecar (no data egress beyond model).
3. Open-source-ready.
4. Pr+AE одним кодом.
5. Timeline-aware фичи (auto-fill image slot, frame-to-prompt, start+end из In/Out) — то, что только мы можем дать.

**V1.2 фокус (рекомендация):**
- Закрыть Critical bugs (re-import dedup, PhygitalClient leaks, HEAD auth).
- Video-to-video + drag-to-extend + overlay-track insert (отбить ChatVideoPro и Adobe Gen-Extend).
- N-variant batch + prompt history + strength labels (UX-полировка).

**V2 strategic plays:**
- Story Cutter (LLM over transcript).
- Storyboard mode (multi-shot → sequenced timeline).
- AE-native effect.
- BYOK alternative billing.
- MCP-режим sidecar'а (agentic editing future-proof).
