# Sidecar MVP — Design Spec (Sub-project A)

**Status:** approved, ready for implementation planning
**Date:** 2026-05-21
**Scope:** sub-project A из декомпозиции `Phygital-Adobe-Studio`. Реализует Python sidecar,
от которого зависят все остальные sub-project'ы (B Pr-panel, C AE-panel, D video workflows,
E input sources, F polish/mac). Без A панели не могут работать.

## Контекст

Источник истины по общей архитектуре — [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md),
по auth — [`../../AUTH.md`](../../AUTH.md), мотивация выбора sidecar pattern — [`../../AUDIT.md`](../../AUDIT.md).
Этот документ **не дублирует** их, а конкретизирует решения, принятые в брейнсторме 2026-05-21,
для границ sub-project A.

## Decomposition (для напоминания на будущих сессиях)

| # | Sub-project | Зависимости |
|---|---|---|
| **A** | Sidecar MVP (image-only) | — (этот спек) |
| B | Pr panel MVP | A |
| C | AE panel MVP | A |
| D | Video workflows (sora/veo/runway/kling) | A |
| E | Input sources (timeline-extract, screenshots, drag-drop) | B, C |
| F | Polish + Mac parity | B, C, D |

A — blocking foundational. Каждый sub-project получает свой спек → план → реализацию.

## Решения, принятые в брейнсторме

| # | Вопрос | Решение |
|---|---|---|
| 1 | Vendoring `Phygital-bot` | Vendor copy с pinned commit hash. Скрипт `scripts/sync_from_bot.py` для ресинка. Никаких submodule/sys.path. |
| 2 | Persistence для TaskRegistry | `jobs.jsonl` append-only журнал. SQLite отложено до Phase 5+ если упрёмся в перформанс. |
| 3 | Concurrency | `asyncio.Semaphore(N)` с дефолтом **N=5**, конфиг через `.env` `PHYGITAL_MAX_CONCURRENT`. |
| 4 | DoD / приёмка | Три слоя: юнит-pytest (в CI) + CLI smoke-обёртка (`python -m scripts.cli`) + live pytest (`@pytest.mark.live`, не в CI). README документирует все три. |

## Out-of-scope для A (явно)

- Video workflows (sora/veo/runway/kling) — sub-project D.
- Init-file upload (i2i/i2v входы) — sub-project D.
- Gemini text node для prompt enhancement — sub-project D (или раньше, если выяснится что нужно для B/C UI). Не реализуем здесь.
- CEP-панели — sub-project B и C.
- Rate-limit обработка от Phygital — фиксируем как fail, юзер ждёт. Бэкофф добавим если станет проблемой.
- Webhook вместо polling — Phygital не публикует webhook.
- Шифрование `session.json` — лежит в `%LOCALAPPDATA%`, защищено правами юзера ОС.
- SSE стриминг прогресса — `ARCHITECTURE.md` Phase 2 решение, в A не входит.

## Структура `sidecar/`

```
sidecar/
  app/
    __init__.py
    main.py                  # FastAPI app + uvicorn entrypoint (run())
    config.py                # pydantic-settings, читает .env
    paths.py                 # %LOCALAPPDATA% / Application Support resolver

    routers/
      health.py              # GET /health
      auth.py                # POST /auth/recon
      nodes.py               # GET /nodes
      jobs.py                # POST/GET/DELETE /jobs, /jobs/{id}, /jobs/{id}/download

    services/
      task_registry.py       # in-memory dict + jsonl журнал + restore on startup
      job_runner.py          # asyncio.Semaphore(N=5), запуск workflow по node_id
      session_bootstrap.py   # обёртка над vendor: Playwright recon, preflight refresh
      downloader.py          # тянет результат Phygital в downloads/<job_id>/

    phygital_client/         # ← VENDOR от Phygital-bot/client/ (pinned commit)
      __init__.py            # содержит SOURCE_COMMIT = "..." (записывается sync скриптом)
      api.py
      auth.py
      config.py
      models.py
      session.py

    workflows/               # ← VENDOR от Phygital-bot/workflows/ (только нужное для MVP)
      __init__.py
      base.py
      image_gen.py           # Nano Banana, node_id=94

  scripts/
    cli.py                   # python -m scripts.cli {auth login, generate, jobs list, ...}
    sync_from_bot.py         # копирует client/ и нужные workflows/, обновляет SOURCE_COMMIT

  tests/
    test_paths.py
    test_task_registry.py
    test_config.py
    test_jobs_router.py
    test_e2e_live.py         # @pytest.mark.live

  .env.example
  pyproject.toml
  README.md
```

**Принципы:**
- `routers/` тонкие, без логики — только парсинг запроса → service → формат ответа.
- `services/` тестируемы без HTTP.
- `phygital_client/` и `workflows/` — изолированный vendor, никто извне не правит,
  обновляется только через `scripts/sync_from_bot.py`.

## Lifecycle

**Startup:**
1. `paths.ensure_dirs()` создаёт `%LOCALAPPDATA%\PhygitalStudio\{downloads,uploads,user_data,logs}`.
2. `config.Settings()` читает `.env`.
3. `session_bootstrap.preflight()` — если session.json есть и JWT доживёт >15 мин → ok; иначе log warn (recon триггерится клиентом через `POST /auth/recon`).
4. `task_registry.restore()` читает `jobs.jsonl`, схлопывает до `dict[job_id → state]`. Для статусов `pending|running` запускает background resync с Phygital по `task_id` (если он сохранён) либо помечает `orphaned_on_restart` если `task_id` ещё не был получен.
5. `uvicorn.run(host=127.0.0.1, port=8765, workers=1)`.

Workers=1 обязателен — состояние `TaskRegistry` живёт в памяти процесса.

**Shutdown:**
1. `job_runner.cancel_all()` — отменить in-flight задачи, записать `canceled` в jsonl.
2. `session_bootstrap.snapshot()` — записать актуальные cookies/JWT в session.json.

## Жизненный цикл задачи

```
client                    sidecar (router)         job_runner          phygital_client
  │                          │                        │                      │
  │ POST /jobs               │                        │                      │
  │ {node_id, params}        │                        │                      │
  │─────────────────────────▶│                        │                      │
  │                          │ registry.create()      │                      │
  │                          │  → status=queued       │                      │
  │                          │ runner.schedule(job)   │                      │
  │                          │─────(asyncio.task)────▶│                      │
  │ ◀──── {job_id} ──────────│                        │                      │
  │                          │                        │ semaphore.acquire()  │
  │                          │                        │  → status=submitted  │
  │                          │                        │ workflow.run(params) │
  │                          │                        │─────────────────────▶│
  │                          │                        │  (POST workflow,     │
  │                          │                        │   получает task_id)  │
  │                          │                        │  → status=running    │
  │                          │                        │ poll loop (1.5s)     │
  │                          │                        │─────────────────────▶│
  │ GET /jobs/{id} (poll)    │                        │  ... progress upd ...│
  │─────────────────────────▶│ registry.get()         │                      │
  │ ◀── {status, progress} ──│                        │                      │
  │                          │                        │  status=completed,   │
  │                          │                        │  result_urls=[...]   │
  │                          │                        │ downloader.fetch()   │
  │                          │                        │  → downloads/<id>/x  │
  │                          │                        │ semaphore.release()  │
  │                          │                        │  → status=completed  │
  │ GET /jobs/{id}/download  │                        │                      │
  │─────────────────────────▶│ FileResponse           │                      │
  │ ◀──── bytes ─────────────│                        │                      │
```

**`jobs.jsonl` format** (одна строка на каждое изменение):

```jsonl
{"ts":"2026-05-21T10:00:00Z","job_id":"01HXY...","event":"created","node_id":94,"params":{...}}
{"ts":"2026-05-21T10:00:01Z","job_id":"01HXY...","event":"status","status":"submitted","task_id":"phygital-task-abc"}
{"ts":"2026-05-21T10:00:30Z","job_id":"01HXY...","event":"status","status":"completed","result_paths":["downloads/01HXY.../out.png"]}
```

**Job ID:** ULID (26 chars, sortable by creation time). Это снимает необходимость отдельного `created_at` поля в API ответе для сортировки.

## HTTP-контракт

Берётся из [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) секция «Контракт HTTP». В MVP A реализуем подмножество:

| Метод | Путь | В A? | Замечание |
|---|---|---|---|
| GET | `/health` | да | возвращает `{ok, session_age_sec, jwt_ttl_sec, active_jobs}` |
| GET | `/nodes` | да | только image-ноды для MVP (Nano Banana обязательно, остальные image — bonus) |
| POST | `/auth/recon` | да | 409 если recon уже идёт |
| POST | `/jobs` | да | только node_id=94 (Nano Banana) обязателен, остальные image — bonus |
| GET | `/jobs/{id}` | да | возвращает status, progress, error, result_paths |
| GET | `/jobs/{id}/download` | да | бинарный FileResponse |
| GET | `/jobs` | да | restore-список для будущих панелей. `?status=`, `?limit=` |
| DELETE | `/jobs/{id}` | да | cancel + cleanup downloads/<id>/ |
| POST | `/jobs/{id}/upload` | **нет** (D) | init-files для i2i — sub-project D |

Все статусы из `ARCHITECTURE.md`: `queued | uploading | submitted | pending | running | downloading | completed | failed | canceled`.

## Error handling

| Категория | Источник | Реакция sidecar | Ответ клиенту |
|---|---|---|---|
| Auth: нет session.json | preflight | log warn, `/health` → `session_age_sec=null` | `/jobs` → `409 {"error":"no_session","hint":"POST /auth/recon"}` |
| Auth: JWT 401/418 | в середине job | `SessionManager.refresh()` + retry 1 раз (логика vendor) | прозрачно, status=running |
| Auth: refresh умер | в середине job | job → failed, `error="auth_expired"` | `/jobs/{id}` → failed |
| Network: timeout/conn | poll loop | exponential backoff 1.5→3→6→12→60s, 5 попыток | прозрачно, jsonl event `network_retry` |
| Phygital: task failed | poll вернул failed | job → failed, error из Phygital | `/jobs/{id}` → failed |
| Download: S3 5xx | downloader | 3 retry с backoff, потом fail | то же |
| Cancel during run | DELETE /jobs/{id} | пытается отменить в Phygital, локально canceled, остановка poll | `204` |
| Recon в процессе | второй POST /auth/recon | `409 {"error":"recon_in_progress"}` | poll `/health` |
| Crash mid-job | restart | restore() видит running с task_id → resync через Phygital | прозрачно |
| Crash до submit | restart | running без task_id → `orphaned_on_restart` → failed | client может повторить |
| Semaphore full | 6-я задача при N=5 | queued в локальной FIFO, runner подхватит | `/jobs/{id}` → `queued`, опционально `queue_position` |
| Disk full | downloader | failed, `error="disk_full"` | то же |
| Unknown node_id | POST /jobs | валидация в router до создания job | `400 {"error":"unknown_node","node_id":N}` |

**Логирование:**
- `loguru` → файл `%LOCALAPPDATA%\PhygitalStudio\logs\sidecar.log` (rotation 10MB, retain 5)
- Параллельно stdout (для запуска из терминала и `start.bat`)
- DEBUG только если `.env` `LOG_LEVEL=DEBUG`, по умолчанию INFO
- Тайные значения (cookies, Bearer-токены) никогда не логируются — хелпер `_redact()` в `phygital_client/`

## Тестирование

### Слой 1 — юнит-pytest (в CI)

```
tests/
  test_paths.py
    - resolve_app_data() корректен под Windows/Mac/Linux
    - ensure_dirs() идемпотентно

  test_task_registry.py
    - create() добавляет в memory + пишет в jsonl
    - update_status() добавляет event, обновляет memory
    - restore() из тестового jsonl корректно схлопывает
    - restore() running без task_id → orphaned_on_restart
    - 100 параллельных create() через asyncio.gather → 100 уникальных ULID

  test_config.py
    - .env override применяется (PHYGITAL_MAX_CONCURRENT=10)
    - дефолты применяются при отсутствии переменной

  test_jobs_router.py (с mock job_runner)
    - POST /jobs валидирует node_id, отвергает unknown
    - GET /jobs?status=running фильтрует
    - DELETE /jobs/{id} → 204
```

Цель: ≥80% coverage `services/` и `routers/`. `phygital_client/` и `workflows/` не покрываем — это vendor, тесты живут в `Phygital-bot`.

### Слой 2 — CLI smoke (`python -m scripts.cli`)

```
status                                 # GET /health, активные jobs
auth login                             # POST /auth/recon, ждёт сессию
nodes                                  # GET /nodes, таблица id/name
generate --node nano-banana \          # POST /jobs + poll + GET download
  --prompt "cat in a hat" --out ./out.png
jobs list                              # GET /jobs?limit=50, таблица
jobs cancel <id>                       # DELETE /jobs/{id}
```

Использует sidecar как чёрный ящик через HTTP — тот же путь, что у будущих CEP-панелей.

### Слой 3 — live E2E pytest (не в CI)

```python
# tests/test_e2e_live.py
@pytest.mark.live
async def test_image_gen_end_to_end():
    """Требует валидный session.json и запущенный sidecar на :8765."""
    async with httpx.AsyncClient(base_url="http://127.0.0.1:8765") as c:
        h = (await c.get("/health")).json()
        assert h["ok"] and h["session_age_sec"] is not None

        r = await c.post("/jobs", json={
            "node_id": 94,
            "params": {"prompt": "test image, simple shape", "aspect_ratio": "1:1"}
        })
        job_id = r.json()["job_id"]

        for _ in range(80):
            await asyncio.sleep(1.5)
            j = (await c.get(f"/jobs/{job_id}")).json()
            if j["status"] in ("completed", "failed"):
                break
        assert j["status"] == "completed"

        d = await c.get(f"/jobs/{job_id}/download")
        assert d.status_code == 200
        assert d.headers["content-type"].startswith("image/")
        assert len(d.content) > 10_000
```

Запуск:
```
.venv\Scripts\activate
start /b uvicorn app.main:app --host 127.0.0.1 --port 8765
pytest -m live tests/test_e2e_live.py
```

## Definition of Done

- [ ] Vendor copy Phygital-bot выполнен через `scripts/sync_from_bot.py`,
      в `phygital_client/__init__.py` записан commit hash источника
- [ ] `python -m app.main` поднимает sidecar на `127.0.0.1:8765`
- [ ] `GET /health` отвечает с `session_age_sec`
- [ ] `POST /auth/recon` запускает Playwright headed, сохраняет session.json
- [ ] `GET /nodes` отдаёт список с Nano Banana (node_id=94) как минимум
- [ ] `POST /jobs` для Nano Banana → polling → completed → файл на диске
- [ ] `GET /jobs/{id}/download` отдаёт байты с правильным content-type
- [ ] Рестарт sidecar восстанавливает `jobs.jsonl` без потери завершённых
- [ ] CLI-команды (слой 2) работают, README документирует их
- [ ] Юнит-тесты (слой 1) проходят, coverage ≥80% `services/` и `routers/`
- [ ] Live pytest (слой 3) проходит на пользовательской машине с валидной сессией
- [ ] `Phygital-bot/` и `Phygital_MCP/` не модифицированы (read-only источник)
- [ ] Windows-конвенции: `.bat` ASCII-only (cp866), `stdout.reconfigure(encoding='utf-8')` в `cli.py`
- [ ] Все пути через `pathlib` + `paths.py` resolver — для будущего переноса на Mac

## Открытые вопросы (на этап реализации, не блокирующие спек)

1. **Список image-нод помимо Nano Banana** для `GET /nodes` в MVP. Минимум — node_id=94. Bonus — `gpt_image.py`, `image_to_image.py` если они тоже image-only без init-file. Решить при vendoring (видно по сигнатурам `WORKFLOW_SCHEMA_ID` в workflows/).

2. **Конкретный pinned commit Phygital-bot** для vendor — записать актуальный HEAD на момент первого `sync_from_bot.py`. Не требует решения сейчас.

3. **Reuse `Phygital-bot/recon/capture.py`** или дублировать в sidecar — `recon/` это не client/, а отдельный модуль для Playwright. На этапе реализации проверить можно ли его тоже vendor'ить или sidecar нужен отдельный thin-обёртку. Не блокирует спек.

## Связанные документы

- [`docs/HANDOFF.md`](../../HANDOFF.md) — точка входа для следующих сессий
- [`docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) — общая архитектура (источник истины)
- [`docs/AUTH.md`](../../AUTH.md) — auth bootstrap
- [`docs/AUDIT.md`](../../AUDIT.md) — мотивация выбора sidecar
- [`docs/ROADMAP.md`](../../ROADMAP.md) — общие фазы (этот спек = Phase 1)
