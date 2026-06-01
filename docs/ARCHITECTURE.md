# Архитектура

## Высокоуровневая схема

```
┌────────────────────────────────────────────────────────────┐
│  CEP-панель (отдельная для Pr и AE)                        │
│  ┌─────────────┐  ┌──────────────────────────────────────┐ │
│  │ UI (HTML+JS)│←→│ HTTP к localhost:8765                │ │
│  │ presets,    │  │ POST /jobs   (node_id + params)      │ │
│  │ queue, prev │  │ GET  /jobs/{id}  (status, polling)   │ │
│  │             │  │ GET  /jobs/{id}/stream  (SSE — план) │ │
│  └─────┬───────┘  │ GET  /jobs/{id}/download → bytes     │ │
│        │          └──────────────────────────────────────┘ │
│        │ CSInterface.evalScript                            │
│        ▼                                                   │
│  host/*.jsx:                                               │
│    Pr: app.project.importFiles → seq.videoTracks[i]        │
│        .insertClip(projectItem, ticks)                     │
│    AE: app.project.importFile → comp.layers.add(footage)   │
└────────────────────────────────────────────────────────────┘
              ▲ Pr/AE                ▲ генерации
              │                      │
        ┌─────┴──────────────────────┴───────┐
        │ Python sidecar (FastAPI + uvicorn) │
        │ — vendored backend-клиент и базовые│
        │   workflows                        │
        │ — добавляет video-workflow классы  │
        │   (sora, veo, runway, kling)       │
        │ — рулит очередью, скачивает S3 в   │
        │   общую temp-папку                 │
        │ — Playwright recon для bootstrap   │
        │ — TaskRegistry с persistence,      │
        │   переживает рестарт Pr/AE         │
        └────────────────────────────────────┘
```

## Почему sidecar

| Альтернатива | Что не так |
|---|---|
| JS-порт backend-клиента в CEP | SuperTokens (header-mode, rid:anti-csrf, refresh-cookies), truststore-аналог под MITM-прокси, HTTP/2 multipart с `fileobject` — 2-3 недели работы, новые баги. |
| Webview-перехват в CEP CEF | Хрупко: при обновлении SPA-фронта backend'а cookies могут переехать; CEF не умеет в `truststore`. |
| MCP-only (без HTTP) | CEP не запускает MCP-stdio-сервер удобно из панели. HTTP проще для UI-polling и SSE. |
| FastAPI sidecar (выбрано) | Тонкий слой поверх уже-работающего кода. 1-2 дня MVP. |

## Контракт HTTP (sidecar ↔ panel)

| Метод | Путь | Тело / параметры | Ответ |
|---|---|---|---|
| `GET`  | `/health` | — | `{"ok": true, "session_age_sec": N, "jwt_ttl_sec": N}` |
| `GET`  | `/nodes` | — | список доступных нод (`id`, `name`, `inputs`, `params`, `averageTimeInSeconds`, `default_price`) |
| `POST` | `/auth/recon` | — | запускает Playwright headed login (только если sidecar обнаружил отсутствие session.json) |
| `POST` | `/jobs` | `{node_id, params: {...}, init_files: [path...]}` | `{job_id}` |
| `POST` | `/jobs/{id}/upload` | multipart `fileobject` (для i2i/i2v init-картинок до отправки `/jobs`) | `{file_obj_id}` |
| `GET`  | `/jobs/{id}` | — | `{status, progress, eta_sec, error?, result?: {paths: [...], urls: [...]}}` |
| `GET`  | `/jobs/{id}/download` | — | бинарный stream результата (panel скачивает к себе в temp) |
| `DELETE` | `/jobs/{id}` | — | отмена + cleanup |
| `GET`  | `/jobs` | `?status=running&limit=50` | список задач — для восстановления UI после рестарта Pr |

Статусы: `queued | uploading | submitted | pending | running | downloading | completed | failed | canceled`.

## Очередь и persistence

`TaskRegistry` (в памяти + JSON-журнал в `%LOCALAPPDATA%\PhygitalStudio\jobs.jsonl`):
- На рестарт sidecar'а — read-only восстановление статусов незавершённых задач (полл backend'а
  по `task_id`, ресинхронизация).
- На рестарт Pr/AE — панель при загрузке делает `GET /jobs?status in {running,pending,...}` и
  восстанавливает список.

## Размещение временных файлов

| Что | Куда | Кто чистит |
|---|---|---|
| Скачанное медиа (готовые .png/.mp4) | `%LOCALAPPDATA%\PhygitalStudio\downloads\<job_id>\` | sidecar по retention TTL=24h |
| Init-картинки от пользователя (для i2v) | `%LOCALAPPDATA%\PhygitalStudio\uploads\<session_id>\` | sidecar TTL=1h после завершения job'а |
| ExtendScript-копии импорта в проект Adobe | Pr/AE решает сам (footage линкуется по пути) | пользователь |

macOS — соответствующие пути в `~/Library/Application Support/PhygitalStudio/`.

## ExtendScript-контракт (panel → host)

### Premiere
```js
phygitalStudio_importAndInsert({
  filePath: "C:/.../job-abc.mp4",
  trackKind: "video",          // "video" | "audio"
  trackIndex: 0,               // 0-based
  insertAtSec: -1,             // -1 = playhead, иначе абсолют в seq
  mode: "insert"               // "insert" (ripple) | "overwrite"
})
→ { ok: true, projectItemId: N, trackItemId: N }
```

### After Effects
```js
phygitalStudio_importAndAdd({
  filePath: "C:/.../job-abc.mp4",
  compName: null,              // null = активная comp
  timeSec: -1,                 // -1 = playhead
  duration: null               // null = native footage duration
})
→ { ok: true, footageId: N, layerIndex: N }
```

## Auth bootstrap

См. отдельный документ — [AUTH.md](AUTH.md).

## Безопасность

- Любые API-ключи внешних сервисов — в `sidecar/.env`, никогда не уходят в CEP-панель.
- `session.json` — только в `%LOCALAPPDATA%\PhygitalStudio\` (или
  `~/Library/Application Support/PhygitalStudio/`), gitignore.
- Sidecar слушает строго `127.0.0.1:8765` без CORS (CEP-панель — same-origin через `localhost`).

## Открытые вопросы (на будущие чаты)

1. **SSE vs polling** для статуса. Решить в фазе 2 после фактических замеров: polling каждые
   1.5с (как в боте) или SSE-стрим с этапами `Gemini Text → Nano Banana → ...`.
2. **Transcode на conform**: Pr делает conform нативного MP4 от Sora автоматически, но мелкие
   фреймрейт-расхождения могут давать заикания. Опциональный ffmpeg-pass в sidecar — фаза 3.
3. **Batch UI**: «сгенерировать N вариантов одной нодой» — нужен ли в MVP или после.
4. **UXP-форк Pr-панели**: планировать на 2027+ или раньше, в зависимости от Adobe roadmap.
