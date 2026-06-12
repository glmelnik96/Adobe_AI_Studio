# Adobe AI Studio

Две независимые CEP-панели (Adobe Premiere Pro и After Effects) + локальный Python-sidecar.
Цель — генерировать изображения, видео, апскейлы и озвучку (Nano Banana, GPT Image,
Kling, Seedance, Kling Omni, Kling Motion, Topaz Video Upscale, ElevenLabs TTS)
прямо из интерфейса Adobe и автоматически класть результат на таймлайн (Pr)
или в активный composition (AE).

**Status (2026-06, V1.3 + post-release fixes):**
- Sidecar — **274 теста** (pytest). Семейства нод: Image / Video / Upscale / Voice;
  `/enhance` (prompt enhancer), `/presets` (пресеты форм), `/extract-frame` и
  `/clip-video` (ffmpeg-обвязка таймлайна), Idempotency-Key, `/v1/` versioning.
- Pr-панель — **175 тестов** (vitest), проходит manual E2E. Вкладки семейств,
  Version-дропдаун, источники слотов From bin / From Timeline / Selected clip,
  queue widget, cost preview, пресеты форм, inline-плеер для TTS.
- AE-панель — scaffold готов (`cep-ae/CSXS/manifest.xml` + stub
  `client/panel.js` + `host/insert_media.jsx`), реализации UI/HTTP-клиента нет.

История изменений — в [CHANGELOG.md](CHANGELOG.md).

## Документация

| Документ | О чём |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | История версий (последняя — V1.3) |
| [docs/PROJECT_OVERVIEW.md](docs/PROJECT_OVERVIEW.md) | Как работает целиком: компоненты, e2e пайплайны, persistence, подводные камни |
| [docs/INSTALL_WINDOWS.md](docs/INSTALL_WINDOWS.md) | Пошаговая установка на Windows + траблшут |
| [docs/INSTALL_MACOS.md](docs/INSTALL_MACOS.md) | Пошаговая установка на macOS + траблшут |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Sidecar + CEP, потоки данных, контракты HTTP |
| [docs/AUTH.md](docs/AUTH.md) | Бутстрап backend-сессии через Playwright recon |
| [docs/HANDOFF.md](docs/HANDOFF.md) | Как подхватить проект в новом Claude Code чате |

## Структура

```
sidecar/        Python FastAPI: HTTP-обёртка над backend-клиентом + workflows
cep-premiere/   CEP 12 панель для Premiere Pro 2024+
cep-ae/         CEP 11 панель для After Effects 2023+
shared/         JSON-пресеты нод, общие промпт-доки
docs/           архитектура, auth, install, handoff
```

## Источники переиспользуемого кода (вне этого репо)

- `<USERPROFILE>\Documents\Adobe-Extensions-Audit\ext_pr\` — клон Extensions-LLM-Chat_Pr,
  справочно (CSXS-манифест, bridge-паттерн CEP↔ExtendScript).
- `<USERPROFILE>\Documents\Adobe-Extensions-Audit\ext_main\` — клон Extensions-LLM-Chat (AE),
  справочно (готовые `import_file`+`add_to_comp` в `host/index.jsx`).

Эти проекты — независимые продукты. Adobe AI Studio их не модифицирует, только
читает как референс.

## Запуск

Каждая панель документирует свою установку отдельно. Sidecar стартует
**автоматически** из CEP-панели — отдельно его запускать не нужно.

- **Premiere Pro panel** → [`cep-premiere/README.md`](cep-premiere/README.md) —
  prerequisites для Windows и macOS, autostart-схема, manual E2E чек-лист.
- **After Effects panel** → [`cep-ae/README.md`](cep-ae/README.md) — scaffold
  (CSXS-манифест + dev-install для Win/Mac); полная панель — в sub-project C.

Контракт между sidecar и панелями — `http://127.0.0.1:8765`, идентичный
на обеих платформах. Один путь session.json (имя директории сохранено
для совместимости с уже установленными копиями):
- Windows: `%LOCALAPPDATA%\PhygitalStudio\session.json`
- macOS:   `~/Library/Application Support/PhygitalStudio/session.json`

## Перенос на macOS

Sidecar — кросс-платформенный (Python, FastAPI, httpx, truststore, pathlib).
Pr-панель autostart знает оба `pythonw`/`python3`-набора путей и оба способа
убить process tree (`taskkill /T /F` vs `kill -pgid TERM`). Подробности —
[`cep-premiere/README.md`](cep-premiere/README.md) → секция «Prerequisites — macOS».
