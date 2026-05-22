# Sub-project D — Video Workflows + Asset Cache (Design Spec)

**Status:** draft, awaiting approval
**Date:** 2026-05-21
**Scope:** sub-project D из декомпозиции `Phygital-Adobe-Studio`. Расширяет sidecar (sub-project A) до поддержки 4 видео-моделей с жёстко зашитыми сценариями + персистентный asset cache. Параллельно — частично перекрывает sub-project E (input sources) на уровне sidecar API: добавляет upload-эндпоинты и кэш `file_obj_id`. UI-выбор источника (диск / Pr timeline / AE timeline / project items) остаётся за sub-project E внутри панелей.

## Источник истины по схемам и сценариям

**[Видеоноды Phygital+ — рекон 2026-05-21](обсидиан-vault: `01 Projects/Phygital Adobe Studio/Видеоноды Phygital+ — рекон 2026-05-21.md`)** — детальный разбор HAR-сессии 2026-05-21, матрица 10 шаблонов `(модель × сценарий)`, схемы слотов и параметров, заметки по особенностям UI (например, дублирование Seedance `ref_img`, тоггл `character_orientation` в Kling Motion).

Локальные fixtures для каждой пары `(model, scenario)`:
- `sidecar/recon-captures/20260521-133657/extracted/submit_*.json` (17 файлов) — реальные payload'ы `POST /api/v2/tasks/`
- `sidecar/recon-captures/20260521-133657/extracted/config_*.json` (17 файлов) — реальные `config_history` для каждого task'а

**Использование:** при реализации каждого `<Model>Workflow.build_payload()` сверяться с соответствующим `submit_NN_schemaXXX_*.json`. Тесты `test_<model>_workflow.py` загружают этот же JSON как expected output.

## Контекст

Источник истины по общей архитектуре — [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md). Спек A — [`2026-05-21-sidecar-mvp-design.md`](2026-05-21-sidecar-mvp-design.md). Этот документ их не дублирует, конкретизирует только D.

## Decomposition reminder

| # | Sub-project | Статус |
|---|---|---|
| A | Sidecar MVP (image-only, Nano Banana) | ✅ closed 2026-05-21 |
| B | Pr panel MVP | ждёт |
| C | AE panel MVP | ждёт |
| **D** | **Video workflows + asset cache** | **этот спек** |
| E | Input sources (timeline-extract, project items) | частично перекрывается D |
| F | Polish + Mac parity | ждёт |

## Решения

| # | Вопрос | Решение |
|---|---|---|
| 1 | Список моделей | Жёстко **4 модели**: Kling (74), Seedance (100), Kling Omni (121), Kling Motion (124). Без auto-discovery — `GET /nodes/video` возвращает этот фиксированный список. |
| 2 | Версии моделей | Зашиты в `Workflow.__init__`: Kling `kling_v3`/pro, Seedance `v_2_0`/p720, Omni `omni_3`/pro, Motion `kling_v3`/pro. Юзер не выбирает. |
| 3 | Сценарии | **10 жёстко зашитых** `(model, scenario_id)`. Pydantic-enum `VideoScenario`. UI выбирает model → раскрывается её список сценариев → подставляются нужные слоты. |
| 4 | `JobCreate.init_files` | Меняем `list[str]` → `dict[str, list[str] \| str]` (слоты по имени). Обратная совместимость с image-флоу A — `image_gen.py` принимает `{"init_img": [...]}` или legacy `[]`. |
| 5 | Nano Banana как pre-step | **Двухшаговый flow**: панель отправляет отдельный POST `/jobs` на node_id=94 → получает `file_obj_id` через asset cache → шлёт второй POST `/jobs` на видео-ноду с этим id. НЕ составной `config_history`. Объяснение в [recon artifact](обсидиан-vault). |
| 6 | Asset cache | Persistent jsonl + индекс в памяти. Ключ — `sha256(local_path content)`, значение — `(file_obj_id, uploaded_at, size, mime)`. Cache invalidation по 401/not-found при ре-submit → re-upload + обновление записи. Хранится в `%LOCALAPPDATA%\PhygitalStudio\asset_cache.jsonl`. |
| 7 | Concurrency | Глобальный `Semaphore(N=5)` остаётся, **+ per-node** для видео: `video_sem = Semaphore(2)` (видеоджоба дорогая, $3.5–13.5). Конфиг `.env`: `PHYGITAL_MAX_CONCURRENT_VIDEO=2`. Все 4 видео-ноды используют общий video_sem. |
| 8 | Cost preview | Каждый workflow в `submit()` уже вызывает `get_credits_price` (как в `image_gen.py`). Добавляем `GET /jobs/preview-cost` (без сабмита) — отдельный эндпоинт для UI «показать цену до клика». |
| 9 | `character_orientation` в Motion | Не enum параметра модели, а **отдельный input slot** в `VideoScenario` → передаётся в `KlingMotionWorkflow.build_payload(character_orientation="image" \| "video")`. |
| 10 | Seedance `ref_img` дублирование | UI Phygital+ шлёт `[id, id, id]` при 1 референсе. Воспроизводим. Открытый вопрос — проверить, работает ли `[id]` (отдельной live-джобой, **после** MVP). |
| 11 | `PhygitalClient` lifecycle | Закрываем TODO из sub-project A: `JobRunner` создаёт один общий `PhygitalClient` через `async with` в lifespan'е FastAPI, шарит на все воркфлоу. Не создаём клиент на каждую джобу. |
| 12 | Recon-fixtures как unit tests | Каждый `<Model>Workflow.build_payload()` имеет unit test, который сверяет результат с реальным `submit_NN_*.json` из `recon-captures/20260521-133657/extracted/` (модулу `isModified`/`taskPrice` — игнорируем, они зависят от runtime). |

## Out-of-scope для D

- **UI выбора источника файла** (диск / Pr timeline / AE timeline / project items) — sub-project E, делается в `cep-premiere/` и `cep-ae/`. D даёт **HTTP API** для аплоада (`POST /assets`) и кэш-листинг (`GET /assets`).
- **`multi_shot` / `multi_prompt_*`** в Kling и Omni — продвинутый режим, скрыт от UI, в payload всегда `multi_shot=False`.
- **`image_mask`** (inpaint в Kling) — не в скоупе.
- **`ref_audio`** в Seedance — не в скоупе.
- **Standalone Nano Banana edit** — это sub-project B (image-плагин). В D Nano Banana используется только как pre-step через двухшаговый flow.
- **SSE стриминг** — `ARCHITECTURE.md` Phase 2.
- **Webhook от Phygital** — не публикует.
- **Optimistic `ref_img=[id]` (без дублирования)** — отдельный эксперимент после MVP.

## 4 модели и 10 сценариев

Источник — [Видеоноды Phygital+ — рекон 2026-05-21](обсидиан-vault). Здесь — компактная таблица, нормативная для D.

### Pydantic enum `VideoScenario`

```python
class VideoScenario(str, Enum):
    # Kling 74
    KLING_START_PROMPT             = "kling/start_prompt"
    KLING_START_END_PROMPT         = "kling/start_end_prompt"
    KLING_ELEMENTS_PROMPT          = "kling/elements_prompt"
    # Seedance 100
    SEEDANCE_START_PROMPT          = "seedance/start_prompt"
    SEEDANCE_START_END_PROMPT      = "seedance/start_end_prompt"
    SEEDANCE_REFERENCE_PROMPT      = "seedance/reference_prompt"
    SEEDANCE_REFERENCE_PROMPT_VIDEO = "seedance/reference_prompt_video"
    # Kling Omni 121
    OMNI_ELEMENTS_PROMPT           = "omni/elements_prompt"
    OMNI_ELEMENTS_PROMPT_VIDEO     = "omni/elements_prompt_video"
    # Kling Motion 124
    MOTION_CHAR_VIDEO_PROMPT       = "motion/char_video_prompt"
```

### Маппинг scenario → required input slots

| Scenario | Required `init_files` keys | Required `params` |
|---|---|---|
| `kling/start_prompt` | `init_img: [file_obj_id]` | `text_prompt` |
| `kling/start_end_prompt` | `init_img: [id]`, `image_tail: id` | `text_prompt` |
| `kling/elements_prompt` | `element_1: [id, ...]` (1–3 элемента, `element_2`/`element_3` опц.) | `text_prompt` |
| `seedance/start_prompt` | `start_img: id` | `prompt` |
| `seedance/start_end_prompt` | `start_img: id`, `end_frame: id` | `prompt` |
| `seedance/reference_prompt` | `ref_img: [id, ...]` (1–3, дублировать как UI) | `prompt` |
| `seedance/reference_prompt_video` | `ref_img: [id, ...]`, `ref_vid: [vid_id]` | `prompt` |
| `omni/elements_prompt` | `element_1: [id, ...]` (1–4) | `text_prompt`, `duration` |
| `omni/elements_prompt_video` | `element_1: [id, ...]`, `video: vid_id` | `text_prompt`, `duration` |
| `motion/char_video_prompt` | `char_ref: img_id`, `video: vid_id` | `prompt`, `character_orientation ∈ {"image","video"}` |

Валидация делается в `routers/jobs.py`: для каждого `VideoScenario` есть schema требуемых keys в `init_files` — Pydantic-валидатор отбраковывает невалидные запросы до создания job.

## Структура (диффы к A)

```
sidecar/
  app/
    routers/
      jobs.py                  # ИЗМ: JobCreate.init_files: dict, валидация по VideoScenario
      assets.py                # НОВ: POST /assets, GET /assets, DELETE /assets/{sha256}
      nodes.py                 # ИЗМ: GET /nodes/video возвращает 4 фикс. модели

    services/
      asset_cache.py           # НОВ: jsonl + memory dict, sha256 ключи
      job_runner.py            # ИЗМ: video_sem (Semaphore(2)) + единый PhygitalClient
      task_registry.py         # без изменений

    workflows/
      base.py                  # без изменений
      image_gen.py             # ИЗМ: build_payload принимает init_img из dict
      kling.py                 # НОВ: KlingWorkflow (74), 3 scenarios
      seedance.py              # НОВ: SeedanceWorkflow (100), 4 scenarios
      kling_omni.py            # НОВ: KlingOmniWorkflow (121), 2 scenarios
      kling_motion.py          # НОВ: KlingMotionWorkflow (124), 1 scenario

    scenarios.py               # НОВ: VideoScenario enum + slot-schema validator

  tests/
    test_asset_cache.py        # НОВ: sha256 dedup, invalidation, restore from jsonl
    test_kling_workflow.py     # НОВ: payload diff vs recon fixtures
    test_seedance_workflow.py  # НОВ:
    test_kling_omni_workflow.py # НОВ:
    test_kling_motion_workflow.py # НОВ:
    test_scenarios_validation.py # НОВ: VideoScenario → slot schema
    test_jobs_router.py        # ИЗМ: init_files как dict, video scenarios
    test_e2e_live.py           # ИЗМ: @pytest.mark.live тест на seedance/start_prompt с pre-uploaded asset
```

## HTTP API изменения

### Новые эндпоинты

| Метод | Путь | Назначение |
|---|---|---|
| POST | `/assets` | multipart upload файла; sidecar проверяет cache по sha256, либо переиспользует `file_obj_id`, либо аплоадит в Phygital. Ответ: `{sha256, file_obj_id, cached: bool, size, mime}` |
| GET | `/assets` | список закэшированных, `?type=image\|video`, `?limit=`, `?since=ts` |
| DELETE | `/assets/{sha256}` | удалить запись из cache (Phygital-сторону не трогаем — там TTL свой) |
| DELETE | `/assets` | `?all=true` — очистить весь cache (для UI «очистить кэш») |
| GET | `/jobs/preview-cost` | `?node_id=N&params=...` (или POST с body) — возвращает `{credits, usd}` без сабмита. Делегирует `client.get_credits_price`. |
| GET | `/nodes/video` | возвращает 4 модели + их `VideoScenario` подмножества, для UI dropdown |

### Изменённые

`POST /jobs` — `body`:

```jsonc
{
  "node_id": 100,
  "scenario": "seedance/start_end_prompt",   // НОВ: обязательно для видео-нод
  "params": {
    "prompt": "...",
    // model/resolution/duration/etc. — заполняются дефолтами Workflow если не переданы
  },
  "init_files": {                            // ИЗМ: было list[str]
    "start_img": "15380020",                 // file_obj_id из POST /assets
    "end_frame": "15380016"
  }
}
```

`init_files` валидация:
- ключи должны соответствовать слотам сценария
- значения = `file_obj_id` (str-сериализация int'а) либо list таких id
- неизвестные ключи → `400 {"error":"unknown_slot","slot":"x","scenario":"y"}`
- отсутствие required ключа → `400 {"error":"missing_slot",...}`

## Жизненный цикл video job

```
client                  sidecar                 asset_cache         workflow            phygital
  │                       │                          │                  │                   │
  │ POST /assets (img)    │                          │                  │                   │
  │ ─────────────────────▶│ sha256 ──────────────────▶│                  │                   │
  │                       │                  cache hit?                 │                   │
  │                       │ ◀── cached: false ───────│                  │                   │
  │                       │ client.upload_file() ────│──────────────────│──────────────────▶│
  │                       │ ◀── file_obj_id=15380020 │                  │                   │
  │                       │ cache.put(sha, id) ──────▶│                  │                   │
  │ ◀── {sha, id, cached:false}                      │                  │                   │
  │                       │                          │                  │                   │
  │ POST /jobs            │                          │                  │                   │
  │ scenario, init_files  │                          │                  │                   │
  │ ─────────────────────▶│ validate scenario+slots  │                  │                   │
  │                       │ registry.create() ───────│                  │                   │
  │                       │ runner.schedule(job) ────│──────────────────▶│                   │
  │ ◀── {job_id}          │                          │                  │                   │
  │                       │                          │           video_sem.acquire()        │
  │                       │                          │           workflow.run(payload) ─────▶│
  │                       │                          │                  │ (submit/cfg/poll) │
  │                       │                          │                  │ status=completed  │
  │                       │                          │           downloader.fetch()         │
  │                       │                          │           video_sem.release()        │
  │ GET /jobs/{id}        │                          │                  │                   │
  │ ◀── completed, paths  │                          │                  │                   │
```

`asset_cache.jsonl` formats:

```jsonl
{"ts":"2026-05-21T13:00:00Z","event":"upload","sha256":"abc...","file_obj_id":15380020,"size":2822793,"mime":"image/jpeg","local_path":"C:/.../uploaded.jpg"}
{"ts":"2026-05-21T13:15:00Z","event":"invalidate","sha256":"abc...","reason":"phygital_404"}
{"ts":"2026-05-21T13:20:00Z","event":"upload","sha256":"abc...","file_obj_id":15380999,"size":2822793,"mime":"image/jpeg"}
{"ts":"2026-05-21T14:00:00Z","event":"delete","sha256":"abc...","by":"user"}
```

`restore()` на старте проигрывает события: последний `upload`/`invalidate`/`delete` побеждает.

## Per-node concurrency

```python
# job_runner.py (изменения)
GLOBAL_SEM = asyncio.Semaphore(settings.PHYGITAL_MAX_CONCURRENT)         # default 5
VIDEO_SEM  = asyncio.Semaphore(settings.PHYGITAL_MAX_CONCURRENT_VIDEO)   # default 2

VIDEO_NODES = {74, 100, 121, 124}

async def _run_job(job):
    async with GLOBAL_SEM:
        if job.node_id in VIDEO_NODES:
            async with VIDEO_SEM:
                await _execute(job)
        else:
            await _execute(job)
```

Acquire order: global → video. Никогда наоборот (защита от deadlock'а). `image_gen.py` остаётся вне `VIDEO_SEM`.

## Workflow-классы

Каждый видео-workflow наследует `Workflow` (см. `app/workflows/base.py`). Структура повторяет `image_gen.py`:

```python
class KlingWorkflow(Workflow):
    workflow_id = "74"
    NODE_GLOBAL_ID = "Phygital Creator/phygc-rnd-kling-v3"   # уточнить из recon config_history
    NODE_NAME = "Kling"
    SERVICE_VERSION = "..."   # из recon

    def __init__(self, client, *, model_name="kling_v3", mode="pro", ratio="r_16_9",
                 duration="sec_5", sound="off", cfg_scale=0.5): ...

    def build_payload(self, *, scenario: VideoScenario, text_prompt: str,
                      init_files: dict[str, Any]) -> dict[str, Any]:
        # branch по scenario, заполняет inputs:
        #   start_prompt   → init_img=[id],          image_tail="", elements=[]
        #   start_end      → init_img=[id],          image_tail=id, elements=[]
        #   elements       → init_img=[],            image_tail="", element_1..3=...
        ...

    def _build_config(self, ...): ...  # config_history payload
    async def submit(self, payload): ...
    async def wait(self, job_id, ...): ...  # повторяет image_gen, статусы те же
```

`build_payload` каждого класса берётся **построчно из recon submit JSON'а**: для Kling — `submit_01_schema74_*.json`, для Seedance — `submit_02_schema100_*.json`, и т.д. Конкретные `globalId`/`serviceVersion`/`uuid` нодов читаем из соответствующих `config_*.json`.

## Validation: scenario → slot schema

`app/scenarios.py`:

```python
SCENARIO_SLOTS: dict[VideoScenario, dict[str, SlotSpec]] = {
    VideoScenario.KLING_START_PROMPT: {
        "init_img": SlotSpec(type="image", multi=True, required=True, min=1, max=1),
    },
    VideoScenario.KLING_START_END_PROMPT: {
        "init_img":   SlotSpec(type="image", multi=True, required=True, min=1, max=1),
        "image_tail": SlotSpec(type="image", multi=False, required=True),
    },
    # ... остальные 8
}

def validate_init_files(scenario: VideoScenario, init_files: dict) -> None:
    spec = SCENARIO_SLOTS[scenario]
    extras = set(init_files) - set(spec)
    if extras: raise UnknownSlotError(scenario, extras)
    missing = [k for k, s in spec.items() if s.required and k not in init_files]
    if missing: raise MissingSlotError(scenario, missing)
    for k, s in spec.items():
        if k in init_files: s.check_value(init_files[k])
```

`SCENARIO_SLOTS` — единственный источник истины для **payload-builder'ов** И **router-валидации** И **UI-схемы** (`GET /nodes/video` отдаёт это same dict сериализованным для CEP-панели).

## Error handling (диффы к A)

| Категория | Источник | Реакция | Ответ |
|---|---|---|---|
| Asset cache miss + Phygital 404 | submit job с протухшим `file_obj_id` | cache.invalidate(sha256), job → failed с `error="asset_expired"` + hint | `409 {"error":"asset_expired","sha256":"..."}` — клиент перезаливает через POST /assets |
| Scenario без обязательного slot'а | POST /jobs | валидация до создания job | `400 {"error":"missing_slot",...}` |
| Slot не из схемы сценария | POST /jobs | валидация | `400 {"error":"unknown_slot",...}` |
| Video sem full | 3-я видео-джоба при N=2 | стоит в `GLOBAL_SEM` → `VIDEO_SEM`, статус `queued` | `/jobs/{id}` → queued (без `queue_position` — у нас две очереди) |
| Disk full при upload | `POST /assets` | 507 Insufficient Storage | `507 {"error":"disk_full"}` |
| Unknown sha256 в /assets DELETE | | 204 (idempotent) | |

## Тестирование

### Слой 1 — юнит-pytest (в CI)

```
test_asset_cache.py
  - put/get/invalidate/delete
  - sha256-based dedup: два put одинакового файла → один upload в mock client
  - restore() из jsonl корректно схлопывает события
  - invalidate помечает запись, следующий put переаплоадит

test_kling_workflow.py
  - build_payload(scenario=KLING_START_PROMPT, ...) == submit_01_schema74_*.json
    (после нормализации isModified/taskPrice)
  - build_payload(scenario=KLING_START_END_PROMPT, ...) == submit_04_*.json
  - build_payload(scenario=KLING_ELEMENTS_PROMPT, ...) == корректные element_1..3

test_seedance_workflow.py
  - 4 сценария × соответствующие submit_*.json
  - ref_img дублирование при 1 референсе — проверка соответствия recon UI

test_kling_omni_workflow.py
  - 2 сценария × submit_06_*.json, submit_09_*.json

test_kling_motion_workflow.py
  - character_orientation=image vs video → submit_10/11_*.json

test_scenarios_validation.py
  - missing required slot → MissingSlotError
  - unknown slot → UnknownSlotError
  - min/max нарушение → InvalidSlotValueError

test_jobs_router.py
  - POST /jobs со scenario без init_files для required → 400
  - POST /jobs с video scenario → создаёт job, ставит в VIDEO_SEM очередь
  - GET /nodes/video → 4 модели с slot-схемами
```

Coverage цель: ≥80% `services/asset_cache.py`, `app/scenarios.py`, `routers/jobs.py`, `routers/assets.py`. Workflow-классы покрываются через fixture-сравнение.

### Слой 2 — CLI smoke (`python -m scripts.cli`)

```
assets upload <path>                                # POST /assets
assets list                                         # GET /assets
assets clear                                        # DELETE /assets?all=true
video generate seedance start_end \                 # POST /assets x2 + POST /jobs
  --prompt "..." --start ./a.jpg --end ./b.jpg --out ./out.mp4
video preview-cost kling start_prompt --img ./a.jpg # GET /jobs/preview-cost
```

### Слой 3 — live E2E pytest (не в CI)

```python
@pytest.mark.live
async def test_video_seedance_start_prompt_e2e():
    # 1. upload изображения
    # 2. POST /jobs scenario=seedance/start_prompt
    # 3. poll до completed (timeout 600s для видео)
    # 4. /jobs/{id}/download → mp4 > 100 KB
    # 5. POST /assets того же файла → cached=true (sha256 hit)
```

## Definition of Done

- [ ] 4 workflow-класса (`kling.py`, `seedance.py`, `kling_omni.py`, `kling_motion.py`) с правильными `build_payload`/`_build_config` (сверка с `recon-captures/.../extracted/`)
- [ ] `app/scenarios.py` с `VideoScenario` enum и `SCENARIO_SLOTS` валидацией
- [ ] `services/asset_cache.py` с jsonl-persistence и sha256-dedup
- [ ] `routers/assets.py` (`POST/GET/DELETE /assets`)
- [ ] `routers/jobs.py`: `init_files` → dict, scenario validation, `/jobs/preview-cost`
- [ ] `routers/nodes.py`: `GET /nodes/video` отдаёт 4 модели + сценарии + slot-схемы
- [ ] `services/job_runner.py`: video_sem (N=2), единый `PhygitalClient` через lifespan
- [ ] `image_gen.py` совместим с новым `init_files` dict-форматом
- [ ] 10 unit-тестов payload'ов vs recon fixtures проходят
- [ ] Live E2E на seedance/start_prompt проходит на пользовательской машине
- [ ] CLI smoke (`video generate`, `assets upload/list/clear`) работает
- [ ] `Phygital-bot/` остаётся read-only
- [ ] Vault: артефакт закрытия sub-project D, обновлён folder note Phygital Adobe Studio, добавлена строка в хронологию `Экосистема Claude.md`

## Открытые вопросы (на этап реализации, не блокирующие спек)

1. **`globalId`/`serviceVersion`/`workspaceId`** для каждой ноды (74/100/121/124) — извлечь из `config_*.json` recon-fixtures. Не блокирует спек, но без них `_build_config` не соберётся корректно.

2. **`taskPrice` в config_history** — у image_gen он берётся из `get_credits_price` call. Для видео цены сильно выше — проверить, что Phygital принимает payload и без `taskPrice` (fallback) или эта meta критична.

3. **Seedance `ref_img=[id]` (без 3x дублирования)** — отдельный live эксперимент после MVP. Если работает — упростить payload.

4. **Lifetime `file_obj_id` на Phygital** — неизвестен (час? сутки? пока бакет жив?). Asset cache работает до первой 404 — это OK для MVP, но для UX «загрузил видео вчера, генерирую сегодня» нужны цифры. Эмпирика — после первой недели использования.

5. **Asset cache размер** — у нас jsonl без compaction. После ~10k записей чтение замедлится. Compaction (схлопывание событий → snapshot) — отложить до Phase 2.

6. **MSIX sandbox для asset_cache.jsonl** — `%LOCALAPPDATA%` под Claude Code виртуализируется в `Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\`. Sidecar запускается **юзером** (не Claude), так что использует реальный `%LOCALAPPDATA%`. CEP-панели тоже запускаются Pr/AE — тоже видят реальный путь. Если кто-то начнёт запускать sidecar через Claude — будет рассинхрон. См. memory `feedback_msix_sandbox.md`.

## Связанные документы

- **Vault recon** (источник истины по схемам): `01 Projects/Phygital Adobe Studio/Видеоноды Phygital+ — рекон 2026-05-21.md`
- **Локальные fixtures**: `sidecar/recon-captures/20260521-133657/extracted/{submit,config}_NN_*.json`
- [`docs/HANDOFF.md`](../../HANDOFF.md) — точка входа для следующих сессий
- [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md)
- [`2026-05-21-sidecar-mvp-design.md`](2026-05-21-sidecar-mvp-design.md) — спек sub-project A
- [`docs/ROADMAP.md`](../../ROADMAP.md) — общие фазы
