# Handoff — как подхватить проект в новом чате

Этот документ — точка входа для любой следующей Claude Code сессии.

## Контекст в одном абзаце

Проект `Adobe AI Studio` (internal repo path остался `Phygital-Adobe-Studio` для
совместимости со старыми клонами) — две независимые CEP-панели (Premiere Pro и
After Effects) + локальный Python-sidecar. Цель — генерировать изображения и видео
прямо из Adobe и класть результат на таймлайн / в comp. Архитектура —
sidecar pattern (FastAPI на `localhost:8765` поверх переиспользуемого Python-клиента).
Источник истины по архитектуре — [ARCHITECTURE.md](ARCHITECTURE.md),
по auth — [AUTH.md](AUTH.md).

**Текущая версия:** V1.3 (релиз 2026-06-02, tag `v1.3`, ветка `main`)
+ post-release fixes на `main` (`664f286`, `160d925`, `d3b4a95`, `db6f863`).
История — [`CHANGELOG.md`](../CHANGELOG.md).

### Что вошло в V1.3 и post-release fixes

1. **Семейства нод**: Image / Video / Upscale / Voice — вкладки в панели,
   `/nodes`, `/nodes/video`, `/nodes/upscale` в sidecar. Voice = ElevenLabs
   TTS (node 89) с inline-плеером в History.
2. **Видеоноды**: 74 Kling, 100 Seedance, 121 Kling Omni, 124 Kling Motion;
   t2v-сценарий на 74/100/121. Метки нод — нейтральные семейства (без
   версии), версия движка — параметр `model_name`/`model` и вынесена в
   **Version-дропдаун** под Model (post-release `db6f863`).
3. **Источники слотов**: Browse / From bin / From Timeline frame /
   From Timeline In/Out / **Selected clip** (Higgsfield-style, `160d925`);
   ffmpeg-обвязка на sidecar — `POST /extract-frame`, `POST /clip-video`.
4. **Пресеты форм** (`/presets`, `presets.json` в AppData) + отказ от
   авто-импорта чужих past-session jobs (`d3b4a95`).
5. **Perf**: параллельный price+submit, adaptive polling, smart UI
   rendering, фикс Cyrillic в evalScript (`664f286`).
6. **Prompt Enhancer** (`POST /enhance`, Gemini Text node 72) —
   preview-and-confirm UX.
7. Topaz Video Upscale (87), GPT Image (98) — из V1.2-скоупа, в проде.

**Источник истины по shape'ам и опциям видеонод/Topaz:**
👉 [`V1.2_T2V_TOPAZ_NOTES.md`](V1.2_T2V_TOPAZ_NOTES.md)

Там — реальные payload'ы из manual recon
(`sidecar/recon-captures/20260531-162221-t2v-manual/`), Topaz dropdowns
(скриншоты + backend codes), версионная матрица Kling/Seedance. Любая
правка `video_common.py` / `topaz_upscale.py` начинается с этого файла.

### Подводный камень при тестировании

Sidecar — **отдельный Python-процесс**, перезапуск Pr на него не влияет.
После `git pull` обязательно перезапустить sidecar: macOS —
`pkill -f "app.main"`, Windows — `Get-Process pythonw | Stop-Process`;
панель при следующем mount поднимет новый процесс сама (autostart).
Проверка: процесс на порту 8765 должен быть запущен **после** последнего
коммита (`lsof -iTCP:8765 -sTCP:LISTEN` / `Get-NetTCPConnection -LocalPort 8765`).

## Что прочитать в новом чате (в порядке приоритета)

1. `README.md` корня — карта проекта и связанных репозиториев.
2. Этот файл (HANDOFF.md).
3. `docs/PROJECT_OVERVIEW.md` — как всё работает целиком: компоненты,
   e2e-пайплайны (image и video), persistence, autostart, подводные камни.
4. `docs/ARCHITECTURE.md` — контракт sidecar ↔ панели, ExtendScript-вызовы
   (короче и старее, чем OVERVIEW; OVERVIEW в приоритете).
5. Профильные файлы фазы:
   - **sidecar**: `sidecar/README.md`, `sidecar/app/main.py`.
   - **Pr-панель**: `cep-premiere/README.md`, `cep-premiere/CSXS/manifest.xml`,
     `cep-premiere/client/panel.js`, `cep-premiere/host/insert_media.jsx`.
   - **AE-панель**: `cep-ae/README.md`, `cep-ae/CSXS/manifest.xml`,
     `cep-ae/client/panel.js`, `cep-ae/host/insert_media.jsx`.

## Связанные репозитории на этой машине

Не модифицировать без явной просьбы — это отдельные продукты.

| Путь | Зачем нужен |
|---|---|
| `<USERPROFILE>\Documents\Adobe-Extensions-Audit\ext_pr\` | Reference: CSXS-манифест Pr CEP 12, bridge-паттерн |
| `<USERPROFILE>\Documents\Adobe-Extensions-Audit\ext_main\` | Reference: AE CEP, готовый `import_file`+`add_to_comp` |

## Правила (для агента)

- **Не коммитить без явной отмашки.** Любой `git commit` / `git push` — только после явного "коммит" / "пуш" от пользователя на конкретное изменение.
- **UI без декоративных эмодзи.** Кнопки/статусы — текстом. См. `feedback_ui_minimal_emoji.md`.
- **Windows-конвенции.** `.bat` — ASCII-only (cp866), stdout python — `reconfigure(encoding='utf-8')`.
  См. `windows_lessons.md`, `windows_port_conventions.md`.
- **Перенос на Mac.** Все пути в `sidecar/` строить через `pathlib` + платформо-зависимые
  AppData / Application Support resolver'ы. Установка / autostart документированы
  в [`INSTALL_WINDOWS.md`](INSTALL_WINDOWS.md) и [`INSTALL_MACOS.md`](INSTALL_MACOS.md) —
  шаги симметричны, расхождения только в командах
  (reg add vs defaults write, mklink vs ln -s, taskkill vs kill -pgid).

## Открытые вопросы (ждут решения в фазе)

См. секцию «Открытые вопросы» в конце [ARCHITECTURE.md](ARCHITECTURE.md).

## Что НЕ делать

- Не пытаться портировать SuperTokens auth на JS внутри CEP — это явно отвергнутая альтернатива.
- Не дублировать vendored workflows копипастой — vendor с pinned commit.
- Не модифицировать `Extensions-LLM-Chat_Pr` и `Extensions-LLM-Chat` — это другие продукты,
  тут только как reference.
- Не подключать CEP-панель напрямую к backend API (минуя sidecar) — auth не выживет.
