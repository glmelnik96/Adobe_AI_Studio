# Аудит (исходный, 2026-05-21)

Сохранённая копия аудита, по которому был выбран архитектурный путь.
Свежие изменения архитектуры — в [ARCHITECTURE.md](ARCHITECTURE.md), а не здесь.

## 1. Что уже есть (и что переиспользуется)

### Phygital-bot (Python)
- Полностью отлаженный `PhygitalClient` (`client/api.py`): SuperTokens auth + auto-refresh
  на 401/418, HTTP/2 + truststore (важно под Cloud.ru MITM-проксей), retry на 5xx,
  multipart-upload с полем `fileobject`, корректная последовательность
  `tasks/ → config_history → queue-position`.
- `workflows/`: `image_gen` (Nano Banana), `image_to_image`, `gemini_text`, `gpt_image`,
  `speaker_prep`, `brand_*`. Все наследуются от `Workflow ABC` — добавить video-workflow =
  ~1 файл по образцу `image_gen.py`.
- `recon/` — Playwright bootstrap сессии (без него никак — публичного API у Phygital нет,
  нужен браузерный логин).

### Phygital_MCP (Python)
- Тот же стек, переписан под `page.request` (Playwright-context HTTP). Phase 1: 5 read-only
  tools. Phase 2 (`phygital_run_node`) — то, что фактически нужно расширению.

### Phygital nodes (по `nodes_dump.json`, 17930 строк)
Видео-генерация — есть, и много:
- **Sora API** (`phygc-rnd-sora-api`, ~1000s)
- **VEO API** (~1000s)
- **Runway** i2v / v2v / t2i (~300–1000s)
- **Kling Omni Video** (~1500s)
- **Seedance** (~1000s)
- **Sora Remix**, **Sora Extract id**
- `fps_multiplier` / frame interpolation утилиты
- **Hunyuan 3d** (~1000s)

Картинки: Nano Banana, GPT Image, Flux, Seedream, Runway t2i.

### Extensions-LLM-Chat_Pr (Premiere, CEP 12) — справочно
CEP-панель работает: Chromium + Node.js, мост `bridge-premiere.js` ↔ `host/premiere.jsx`.
Манифест `[24.0,99.9]` (Pr 2024+). ExtendScript умеет razor через QE DOM, ripple/lift delete,
markers, snapshot, set_clip_enabled, mute_track. `importFile`/`insertClip` нет — ~30 строк
ExtendScript: `app.project.importFiles([path]) → projectItem → seq.videoTracks[i].insertClip(projectItem, ticks)`.

### Extensions-LLM-Chat (AE) — справочно
45 tools, среди них уже есть `import_file` и `add_to_comp` — для AE вставка медиа полностью
реализована.

## 2. Реалистичность — да, с одной оговоркой

| Аспект | Вердикт |
|---|---|
| Технически возможно | Да. Все три части (Phygital API, CEP-панель, ExtendScript-импорт) работают по отдельности. |
| Объём работы | Средний. 60–70% кода уже написано в трёх репозиториях — нужна интеграция. |
| Главный риск | **Auth Phygital.** Публичного API нет, единственный путь — SuperTokens-сессия из реального браузерного логина (Playwright recon). В CEP-панели Playwright не запустить → нужен либо локальный sidecar на Python (выбрано), либо встроенный CEF-webview с перехватом cookies (муторно, хрупко). |
| Вторичный риск | **UXP-миграция Adobe.** CEP 12 в Pr 25/26 жив, но 2027+ — придётся переписывать UI-слой. Sidecar не пострадает. |
| Длинные таски | Sora/VEO/Kling = 10–25 мин/клип. Нужна фоновая очередь, переживающая рестарт Pr. |
| Корпоративный MITM (Cloud.ru) | В Python решён через `truststore`. Sidecar этот вопрос снимает целиком. |
| Импорт на таймлайн | AE — готово (`import_file`+`add_to_comp`). Pr — ~30 строк ExtendScript. |

## 3. Решение: Sidecar pattern

См. [ARCHITECTURE.md](ARCHITECTURE.md). Тонкий FastAPI поверх готового `client/`+`workflows/`,
CEP-панели — тонкий UI + ExtendScript-импорт, общение через `localhost:8765`.
