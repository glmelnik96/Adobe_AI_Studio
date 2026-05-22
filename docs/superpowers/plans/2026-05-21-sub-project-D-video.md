# Plan — Sub-project D: видеогенерация Phygital+ из Adobe (sidecar часть)

**Дата:** 2026-05-21
**Spec:** `docs/superpowers/specs/2026-05-21-sub-project-D-video.md`
**Recon источник истины:** `01 Projects/Phygital Adobe Studio/Видеоноды Phygital+ — рекон 2026-05-21.md` (vault) + `sidecar/recon-captures/20260521-133657/extracted/*.json`
**Скоуп этого плана:** только sidecar (HTTP API, workflows, asset cache, валидация). UI Pr/AE — отдельные sub-projects B и C.

## Цели

1. Sidecar умеет создавать видеогенерации 4 моделей × 10 (model, scenario) шаблонов.
2. Файлы переиспользуются между запусками без повторной загрузки (asset cache по sha256).
3. Frontend (CEP) получает чёткий контракт: enum моделей/сценариев, схема слотов, preview-cost, /jobs/preview-cost.
4. Существующее (Nano Banana, auth, registry, downloader) остаётся зелёным до и после.

## Что **не** в скоупе этой фазы

- Pr/AE-панели (sub-projects B, C).
- Источники файлов «timeline / project items» — фронт сам делает экспорт во временный файл и шлёт в `/assets`. Sidecar видит только локальный путь / multipart.
- Compaction asset_cache.jsonl (постпонится — TODO в коде).
- Webhook-режим (long-polling остаётся; видеотаски ≤ 5–10 мин, JWT refresh уже есть).

## Архитектура изменений

### Контракт API (новый/изменённый)

```
POST   /assets                       — multipart upload файла; возвращает {sha256, file_obj_id, mime, size}
GET    /assets                       — список cache entries
DELETE /assets/{sha256}              — удалить одну запись (и file_obj_id remote, если возможно)
DELETE /assets?all=true              — clear cache

GET    /nodes/video                  — матрица: list[{node_id, model, slots, scenarios, params}]
POST   /jobs/preview-cost            — body как POST /jobs, возвращает {credits, breakdown}
POST   /jobs                         — изменён: init_files → dict[str, list[str] | str]
```

### Изменения в существующих файлах

| Файл | Изменение |
|---|---|
| `app/paths.py` | `+asset_cache_path()`, `+asset_uploads_dir()`; `ensure_dirs` создаёт asset_uploads |
| `app/config.py` | `+phygital_max_concurrent_video: int = Field(2, ge=1, le=10)` |
| `app/routers/jobs.py` | `init_files: dict[str, list[str] | str]`; +`/jobs/preview-cost` |
| `app/workflows/__init__.py` | NODES += {74, 100, 121, 124}; NODE_NAMES += такие же |
| `app/workflows/image_gen.py` | back-compat shim: если `init_files` пришёл `list`, поднять в `{"init_img": list}` |
| `app/services/job_runner.py` | + `video_semaphore` для node_ids {74,100,121,124}; вход через `_acquire(node_id)` ⇒ оба semaphor'а если видео |
| `app/main.py` | lifespan переписать на единый `app.state.phygital_client` (через `async with`) — убирает `_get_client` фабрику и MVP-хак с GC |
| `app/services/task_registry.py` | без изменений |
| `app/phygital_client/api.py` | без изменений (всё уже есть: submit_task / post_config_history / task_status / get_download_links / upload_file / get_credits_price) |

### Новые файлы

| Файл | Назначение |
|---|---|
| `app/services/asset_cache.py` | sha256-keyed dedup, jsonl persistence, in-memory index с lock, MIME через `mimetypes` |
| `app/routers/assets.py` | endpoints для /assets |
| `app/workflows/video_kling.py` | node 74 — Kling v3 pro; scenarios: start, start+end, elements (+video), nano-banana upstream |
| `app/workflows/video_seedance.py` | node 100 — Seedance 2.0 p720; scenarios: start, start+end, ref (+video) |
| `app/workflows/video_kling_omni.py` | node 121 — Omni 3 pro; scenarios: start, start+end, elements (+video) |
| `app/workflows/video_kling_motion.py` | node 124 — Motion v3 pro; scenarios: char+video+prompt с `character_orientation ∈ {video,image}` |
| `app/workflows/video_common.py` | enum `VideoScenario`, helper `validate_slots()`, helper `build_video_config()` |
| `tests/test_asset_cache.py` | unit |
| `tests/test_video_workflows.py` | fixture-driven — для каждого submit_NN_*.json: `KlingWorkflow(...).build_payload(...) == json.load(submit_NN)["inputs"+"params"+"outputs"]` (за вычетом runtime UUIDов) |
| `tests/conftest_video.py` | `normalize_submit(d)` хелпер: убирает `isModified`, `meta.taskPrice`, runtime UUIDы, чтобы сравнение детерминировано |
| `tests/fixtures/scenarios.yaml` (опц.) | таблица submit_NN → (node, scenario, args) — чтобы тесты не были «магическими номерами» |

## Фазы

### Phase 1 — asset cache + init_files dict + back-compat

**Цель:** перейти на новый shape `init_files`, не сломав Nano Banana; добавить sha256-cache.

**Файлы:**
- `app/paths.py` — `+asset_cache_path() -> resolve_app_data()/"asset_cache.jsonl"`, `+asset_uploads_dir() -> resolve_app_data()/"asset_uploads"`, обновить `ensure_dirs`.
- `app/services/asset_cache.py` — новый.
  - `class AssetCacheEntry(BaseModel)`: `sha256: str`, `file_obj_id: int`, `local_path: str | None`, `mime: str`, `size: int`, `uploaded_at: datetime`.
  - `class AssetCache`: `add(path: Path, client: PhygitalClient) -> Entry` (sha256 → если есть, вернуть; иначе `client.upload_file(path)` → append jsonl → in-memory dict), `list()`, `delete(sha256)`, `clear()`, `restore()`.
  - In-memory `asyncio.Lock` чтобы избежать гонок при двух параллельных uploads одного файла.
- `app/routers/assets.py` — новый.
  - `POST /assets` принимает `UploadFile`, пишет в `asset_uploads_dir()/{sha256}.{ext}`, MIME через `mimetypes.guess_type` (fallback: `application/octet-stream`).
  - `GET /assets` → `[{sha256, file_obj_id, mime, size, uploaded_at}]`.
  - `DELETE /assets/{sha256}`, `DELETE /assets?all=true`.
- `app/routers/jobs.py` — `JobCreate.init_files: dict[str, list[str] | str] = Field(default_factory=dict)`.
- `app/workflows/image_gen.py` — в начале `build_payload` добавить:
  ```python
  if isinstance(init_img, list):
      init_img_list = init_img
  elif isinstance(init_img, dict):
      init_img_list = init_img.get("init_img") or []
  else:
      init_img_list = []
  ```
  (или принять адаптер в job_runner — окончательное место решим по тому где init_files резолвится в file_obj_ids; см. ниже).
- `app/services/job_runner.py` — добавить шаг **resolve init_files**:
  - Если `state.params["init_files"]` (dict[str, list[str]|str]) непуст и значения — пути,
    runner идёт в `AssetCache.add(path, client)` для каждого пути, заменяет на `file_obj_id` и кладёт `state.params[<slot>] = [file_obj_id]` (или scalar).
  - Это позволяет workflows получать «готовые» file_obj_ids в kwargs без знания про cache.
- `app/main.py` — wire `AssetCache` в state перед `JobRunner`.
- Tests:
  - `tests/test_asset_cache.py` — мок client.upload_file → assert sha256 stable, повторный `add` не дёргает upload, persistence через `restore()`.
  - `tests/test_jobs_router.py` — обновить под dict-shape; добавить тест что back-compat list ещё проходит для node 94.
  - `tests/test_image_gen_workflow.py` — добавить смок что workflow всё ещё принимает `init_img=[15380010]` без падений.

**Не-регресс бар:** `pytest -m "not live"` зелёный.

### Phase 2 — VideoScenario enum + slot-валидация + /nodes/video + /jobs/preview-cost

**Цель:** дать фронту описание «какие модели/сценарии/слоты доступны» + цену.

**Файлы:**
- `app/workflows/video_common.py`:
  ```python
  class VideoScenario(StrEnum):
      START_PROMPT = "start_prompt"
      START_END_PROMPT = "start_end_prompt"
      REF_PROMPT = "ref_prompt"
      REF_PROMPT_VIDEO = "ref_prompt_video"
      ELEMENTS_PROMPT = "elements_prompt"
      ELEMENTS_PROMPT_VIDEO = "elements_prompt_video"
      CHAR_VIDEO_PROMPT = "char_video_prompt"
  ```
- `NODE_SLOTS: dict[int, dict[str, Literal["array","scalar","text","bool"]]]` — точная схема из recon (см. memory project_adobe_studio.md → "Slot shapes by node").
- `SCENARIO_SLOTS: dict[(int, VideoScenario), list[str]]` — какие slots обязательны.
- `validate_slots(node_id, scenario, init_files: dict)` → raise ValueError при несовпадении.
- `app/routers/nodes.py`:
  - `+ GET /nodes/video` → возвращает матрицу из video_common.
- `app/routers/jobs.py`:
  - `+ POST /jobs/preview-cost` — собирает payload через нужный workflow (только `build_payload`, без submit), вызывает `client.get_credits_price(payload)`, возвращает результат.
- Tests:
  - `test_nodes_video_endpoint.py` — schema-snapshot.
  - `test_video_validate_slots.py` — таблица: для каждой пары (node, scenario) — успех+падение.

### Phase 3 — Kling 74 + Seedance 100 workflows

**Цель:** покрыть 7 из 10 сценариев (всё кроме Omni elements и Motion char).

- `app/workflows/video_kling.py` — class `KlingWorkflow(Workflow)` со scenarios: `start_prompt`, `start_end_prompt`, `elements_prompt`, `elements_prompt_video`.
  - `build_payload(prompt, init_files, scenario, **params)` — карта сценарий→inputs (init_img / image_tail / element_1..3 / nano_banana_upstream).
  - `_build_config(prompt, init_files)` — `globalId="Phygital Creator/phygc-rnd-api-kling"`, `serviceVersion="0.0.63"` (из config_01).
- `app/workflows/video_seedance.py` — class `SeedanceWorkflow(Workflow)` со scenarios: `start_prompt`, `start_end_prompt`, `ref_prompt`, `ref_prompt_video`.
  - `globalId="Phygital Creator/phygc-rnd-seedance-api"`, `serviceVersion="0.0.24"`.
  - Slot shapes: `start_img` scalar, `end_frame` scalar, `ref_img` array, `ref_vid` array, `ref_audio` array.
- `app/workflows/__init__.py` — зарегистрировать.
- `tests/conftest_video.py` — `normalize_submit()`, `load_fixture(NN)`.
- `tests/test_video_workflows.py` — для каждого fixture submit_NN:
  ```python
  @pytest.mark.parametrize("fixture_id,model,scenario,args", [
      ("01", "kling", "start_prompt", {...}),
      ("02", "seedance", "start_prompt", {...}),
      ...
  ])
  def test_build_payload_matches_recon(...):
      expected = normalize_submit(load_fixture(fixture_id))
      actual = normalize_submit(workflow.build_payload(**args))
      assert actual["params"] == expected["params"]
      assert actual["inputs"] == expected["inputs"]
      assert actual["outputs"] == expected["outputs"]
  ```

### Phase 4 — Kling Omni 121 + Kling Motion 124

- `app/workflows/video_kling_omni.py` — Omni 3 pro; slots: `first_frame` scalar, `last_frame` scalar, `element_1..4` array, `video` scalar.
- `app/workflows/video_kling_motion.py` — Motion v3 pro; slots: `char_ref` scalar, `video` scalar; param `character_orientation`.
- Зарегистрировать в NODES.
- Расширить fixture-таблицу (submits #6, #9, #10, #11, #14, #17).
- Submit #15 (standalone Nano Banana) — отдельный сценарий image-edit без видео, **не** входит в Kling/Omni/Motion/Seedance тесты; для него ImageGenWorkflow расширим только если recon показал параметры, которых сейчас не хватает.

### Phase 5 — per-node concurrency + Phygital lifespan + live E2E + CLI + README

**Per-node concurrency:**
- `app/services/job_runner.py` — добавить `video_semaphore = asyncio.Semaphore(settings.phygital_max_concurrent_video)`.
- `run_job`: если `node_id in {74,100,121,124}` — `async with self.video_semaphore: async with self.semaphore: ...`.
- Лог: при acquire/release видеосемафора писать `logger.debug("video_sem acquired (free={n})")`.

**PhygitalClient lifespan:**
- В `lifespan(app)` поднимать **один** `PhygitalClient(...)` через `async with` и сохранять в `app.state.phygital_client`.
- `_get_client` факторию убрать; `JobRunner` принимает `client: PhygitalClient` напрямую и в `run_job` берёт `self.client`.
- Refresh-логика клиента всё равно работает — он внутри сам обновляет JWT.

**Live E2E:**
- `tests/live/test_video_e2e_*.py` (опт-ин через env): по одному реальному запуску для каждой из 4 моделей в самом дешёвом сценарии (start_prompt, 5 sec).
- Доход: для запуска нужны реальные креды + 5-минутный allowance.

**CLI:**
- `sidecar/scripts/cli.py` — добавить:
  - `assets upload <path>`, `assets list`, `assets clear`.
  - `video models`, `video scenarios <model>`.
  - `video preview-cost <model> <scenario> --param ratio=r_16_9 ...`.
  - `video generate <model> <scenario> --prompt "..." --slot init_img=path/to/file ...`.
- Все команды — тонкие враппинги над уже существующими HTTP endpoints sidecar.

**README:**
- `sidecar/README.md` — секция «Video generation»:
  - endpoint reference (assets/, nodes/video, jobs/preview-cost);
  - таблица моделей/сценариев/slot shapes;
  - пример `curl`.

**MSIX-замечание:**
- В README + комментарий в `paths.py`: «Sidecar должен запускаться из user-shell, а не из Claude Code (MSIX-virtualization). Asset cache пишется в реальный `%LOCALAPPDATA%\PhygitalStudio\`».

**Закрытие фазы:**
- `pytest -m "not live"` зелёный.
- Live E2E хотя бы для Kling start_prompt 5 sec — зелёный.
- README обновлён.

### Phase 6 — vault closure

- Закрывающий артефакт `01 Projects/Phygital Adobe Studio/Sub-project D — закрытие 2026-05-21.md` (статус, метрики тестов, что осталось как TODO).
- Обновить folder note (статус D=done).
- Запись в `01 Projects/Экосистема Claude.md` (хронология).
- Memory update — пометить D как done в `project_adobe_studio.md`.

## Логирование

- `loguru` уже подключен. Новые точки логирования:
  - `asset_cache`: добавление (`uploaded sha256={...} file_obj_id={...}`), hit (`cache hit sha256={...}`), delete, clear.
  - `job_runner`: acquire/release video_sem с количеством свободных.
  - workflows: при `submit`/`config_history` уже есть.

## Не-регресс бар (на каждой фазе)

- `pytest -m "not live"` остаётся зелёным.
- Существующий E2E (Nano Banana через CLI) работает.
- `GET /nodes` всё ещё возвращает Nano Banana.

## Открытые места (явно отложено)

- Compaction `asset_cache.jsonl` (когда entries удаляются — записи остаются, только in-memory state их игнорирует). TODO в коде, не блокер MVP.
- Cancel реальных тасков на Phygital (есть TODO в `routers/jobs.py`). Из этой фазы вычеркнуто — нет данных recon по cancel endpoint.
- Webhook-режим — отложен; long-polling справляется для ≤10 мин видео.

## Правила (для агента)

- Не коммитить (см. `feedback_no_commits.md`).
- UI без декоративных эмодзи (этот sidecar не имеет UI, но в логах тоже без эмодзи).
- Все пути через `pathlib`.
- Не модифицировать `Phygital-bot`, `Phygital_MCP`, `Adobe-Extensions-Audit`.
