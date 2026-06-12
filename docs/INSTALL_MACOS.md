# Установка на macOS

Premiere Pro 2024+ (CSXS 11/12), Python 3.11+, ffmpeg.

**Текущая версия: V1.3** ([CHANGELOG](../CHANGELOG.md)) — установщик идемпотентен,
обновление = `git pull && ./scripts/install_mac.sh` (skip-recon при
наличии валидной сессии) + перезапуск sidecar-процесса (`pkill -f "app.main"` —
рестарт Pr на sidecar не влияет, панель поднимет новый процесс сама).

Полная архитектура — [`PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md).
Подводные камни macOS — там же §11.3.

> Sidecar полностью кросс-платформенный (Python + httpx + truststore + pathlib).
> Установочная церемония отличается от Windows только командами:
> `defaults write` вместо `reg add`, `ln -s` вместо `mklink`,
> `kill -pgid` вместо `taskkill /T`.

---

## ⚡ TL;DR — автоматический установщик

```bash
cd ~/Documents/Phygital-Adobe-Studio
chmod +x scripts/install_mac.sh
./scripts/install_mac.sh
```

Скрипт делает всё, что описано ниже (Homebrew → python@3.11 → ffmpeg → venv
→ pip deps → playwright chromium → CSXS-ключи → симлинк → recon-логин).
Идемпотентен — повторный запуск безопасен.

Флаги:
- `--skip-deps` — не ставить brew/python/ffmpeg
- `--skip-recon` — не открывать логин в конце
- `--reinstall-venv` — снести и пересоздать `sidecar/.venv`

После завершения: `Cmd+Q` Pr (если открыт) → переоткрыть →
`Window → Extensions → Adobe AI Studio`.

---

## Ручная установка (шаг за шагом)

## 0. Что должно быть установлено заранее

| Зависимость | Версия | Проверить |
|---|---|---|
| Adobe Premiere Pro | 2024 (24.x) или 2025+ (25.x) | `Premiere Pro → About Premiere Pro` |
| Python | **3.11+** (НЕ системный 3.9; `requires-python = ">=3.11"` в `sidecar/pyproject.toml`) | `python3 --version` |
| ffmpeg | любая ≥ 4.x | `ffmpeg -version` |
| Git | любая (есть из Xcode CLI Tools) | `git --version` |
| Homebrew (опционально) | last | `brew --version` |

### Поставить Homebrew (если нет)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Apple Silicon: brew ставится в `/opt/homebrew/`. Intel: в `/usr/local/`.

### Поставить Python (3.11+)

**Не используй системный `/usr/bin/python3` — это 3.9.** Sidecar требует 3.11+.

Через Homebrew:
```bash
brew install python@3.11
```

Или с [python.org/downloads/macos](https://www.python.org/downloads/macos/) —
обычный .pkg installer (кладёт в `/Library/Frameworks/Python.framework/`).

Проверить:
```bash
python3 --version          # 3.11.x
which python3              # /opt/homebrew/bin/python3 (Apple Silicon)
                           # /usr/local/bin/python3   (Intel)
                           # /Library/Frameworks/...  (python.org)
```

### Поставить ffmpeg

```bash
brew install ffmpeg
ffmpeg -version
```

---

## 1. Склонировать репозиторий

```bash
cd ~/Documents
git clone <repo-url> Phygital-Adobe-Studio
cd Phygital-Adobe-Studio
```

---

## 2. Поставить sidecar-зависимости

```bash
cd sidecar
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
playwright install chromium
```

Или глобально (быстрее, грязнее; список = `dependencies` из
`sidecar/pyproject.toml`):
```bash
pip3 install fastapi "uvicorn[standard]" "httpx[http2]" truststore loguru Pillow pillow-heif playwright python-multipart pydantic pydantic-settings python-ulid
playwright install chromium
```

Autostart-логика панели пробует следующие интерпретаторы по очереди:
- `sidecar/.venv/bin/python3` (project-local venv — **находится сам**,
  в `PATH` добавлять не нужно; его создаёт `install_mac.sh`)
- `python3` на `PATH`
- `/opt/homebrew/bin/python3` (Apple Silicon Homebrew)
- `/usr/local/bin/python3` (Intel Homebrew)
- `/Library/Frameworks/Python.framework/Versions/3.{12,11,10}/bin/python3`
- `/usr/bin/python3` (системный 3.9 — fallback, лучше избегать)

---

## 3. Включить CEP debug mode

```bash
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
defaults write com.adobe.CSXS.12 PlayerDebugMode 1
```

**Оба ключа обязательны.** Pr 2024 = CSXS.11, Pr 2025+ = CSXS.12. Если выставлен
только один и Pr запустит «не тот» host, панель просто не появится в Extensions.

После записи — **выйти из Pr полностью (`Cmd+Q`)** и переоткрыть.
Перезагружать всю систему не обязательно.

Откатить:
```bash
defaults delete com.adobe.CSXS.11 PlayerDebugMode
defaults delete com.adobe.CSXS.12 PlayerDebugMode
```

---

## 4. Создать симлинк на панель

```bash
mkdir -p "$HOME/Library/Application Support/Adobe/CEP/extensions"
ln -s "$HOME/Documents/Phygital-Adobe-Studio/cep-premiere" \
      "$HOME/Library/Application Support/Adobe/CEP/extensions/com.phygital.studio.pr"
```

Проверить:
```bash
ls -la "$HOME/Library/Application Support/Adobe/CEP/extensions/com.phygital.studio.pr"
```
Должно показать стрелку на путь репозитория.

`autostart.js` делает `fs.realpathSync()`, поэтому sidecar стартует с реальным
`cwd` (директория репо), а не с символлинка.

---

## 5. Первичный auth recon (один раз)

```bash
cd ~/Documents/Phygital-Adobe-Studio/sidecar
python3 -m scripts.auth_recon
```

(Этот вариант — standalone, sidecar поднимать не надо.
Альтернатива — `python3 -m scripts.cli auth login`, она требует уже
запущенного sidecar'а на `127.0.0.1:8765`.)

Откроется headed Chromium. Залогиниться в открывшемся окне — скрипт ловит
SuperTokens cookies и пишет `session.json` в
`~/Library/Application Support/PhygitalStudio/session.json`.

---

## 6. Запустить Premiere Pro

1. **Полностью закрыть Pr** (`Cmd+Q`, не просто `Cmd+W`). CEP сканит расширения
   только при старте процесса.
2. Открыть Pr заново.
3. `Window → Extensions → Adobe AI Studio`.

Что должно произойти:

- В шапке pill «online» (зелёная) — autostart поднял sidecar.
- Pill с балансом кредитов аккаунта.
- На первом запуске **macOS может запросить TCC-разрешение**: «Premiere Pro
  хочет доступ к Files and Folders / Documents». **Одобрить** — иначе sidecar
  не сможет читать файлы и писать session.json.

Если pill красный:
1. Подождать 15 секунд (autostart polls /health до 15s).
2. DevTools панели: <http://localhost:8099> в Chrome → выбрать
   `Adobe AI Studio` → Console.
3. Поискать ошибки от `ensureSidecar()`.
4. Проверить, что `python3 --version` отвечает в Terminal.

---

## 7. Проверить, что всё работает

Smoke-test:

1. **Nano Banana text2img.** Вкладка `Image` → модель `Nano Banana` →
   сценарий `Generate from prompt (text→image)` → любой prompt → Generate.
   Через 10–30 сек в History — completed job.
2. **Insert.** На job-карточке жать `Insert`. Картинка импортируется в bin Pr
   и (опционально) ложится на playhead активной sequence.
3. **Frame extract.** Вкладка `Video` → модель `Kling` → сценарий
   `Start frame + prompt` → на слоте Start image жать `From Timeline frame` —
   подцепится кадр из-под playhead'а активной sequence (статичная картинка
   на дорожке — напрямую, видео — через ffmpeg `/extract-frame` на sidecar'е).
4. **Voice TTS.** Вкладка `Voice` → ввести текст → выбрать голос → Generate.
   В History появится mp3 с inline-плеером.

---

## 8. Деинсталляция

```bash
# Удалить симлинк
rm "$HOME/Library/Application Support/Adobe/CEP/extensions/com.phygital.studio.pr"

# Убить остатки sidecar'а
pkill -f "app.main"

# Удалить состояние
rm -rf "$HOME/Library/Application Support/PhygitalStudio"
rm -f /tmp/phygital-sidecar.pid
rm -rf /tmp/phygital-imports

# Выключить CEP debug (опционально)
defaults delete com.adobe.CSXS.11 PlayerDebugMode
defaults delete com.adobe.CSXS.12 PlayerDebugMode
```

---

## 9. Траблшут

### Панель не появляется в `Window → Extensions`

- `PlayerDebugMode = 1` выставлен для **обоих** CSXS.11 и CSXS.12.
- Симлинк существует: `ls -la "$HOME/Library/Application Support/Adobe/CEP/extensions/"`.
- Pr был закрыт через `Cmd+Q`, а не `Cmd+W`. `Cmd+W` оставляет процесс в доке.

### Pill «offline», sidecar не стартует

- В DevTools (`http://localhost:8099`) консоль показывает ENOENT — `python3`
  не находится. Проверить `which python3`. Если Homebrew, и панель не видит —
  убедиться, что `/opt/homebrew/bin` или `/usr/local/bin` в `PATH` для
  GUI-приложений: `launchctl setenv PATH "/opt/homebrew/bin:$PATH"`.
- Порт 8765 занят:
  ```bash
  lsof -nP -iTCP:8765 | grep LISTEN
  ```

### TCC: «Files and Folders» не дали

- `System Settings → Privacy & Security → Files and Folders → Adobe Premiere Pro`
  → включить доступ к `Documents` (и опционально к Downloads).
- После — рестарт Pr.

### Pill «no_session»

- session.json потерян / истёк → `python3 -m scripts.cli auth login`.

### Generate падает с «import failed»

- В V1.1 ASCII-staging убран — Pr на macOS ест UTF-8 пути напрямую. Если
  всё-таки `importFiles` падает: открыть `~/Library/Logs/CSXS/csxs*.log` и
  CEP DevTools (`http://localhost:8099`), искать ошибку от `host.jsx`
  `importToBin`. Возможные причины: файл не дочитан с диска (sniff по magic
  байтам не прошёл, см. `disk_save.js _sniffExt`) — проверить, что в
  `~/Library/Application Support/PhygitalStudio/downloads-panel/` лежит
  валидный PNG/JPEG/MP4.

### `From Timeline frame` молча ничего не делает

- Кадр извлекается через ffmpeg на sidecar'е (`POST /extract-frame`) —
  проверить `ffmpeg -version` и DevTools на ошибки `/extract-frame`.
  Если playhead стоит не над video/image-клипом активной sequence —
  будет toast с подсказкой, это не баг.

### Обновился по `git pull`, но изменений не видно

- Sidecar — отдельный Python-процесс; рестарт Pr его **не** перезапускает.
  `pkill -f "app.main"` и переоткрыть панель — autostart поднимет новый
  процесс с новым кодом.

### img2img / i2v завершается через ~30 сек без ошибки

- Silent-cancel backend из-за рассинхрона `value` ↔ `meta.dimensions`.
  Перепроверить, что обновлён `workflows/video_*.py` и тесты
  `test_workflow_video_*.py` зелёные.

### Pr тормозит после выхода — `python3` остался

- Sidecar не убит (Pr крашнулся или Cmd+W вместо Cmd+Q).
  ```bash
  pkill -f "app.main"
  rm -f /tmp/phygital-sidecar.pid
  ```
  При следующем mount панели autostart всё равно прибьёт по PID-файлу — но
  если файла нет, надо руками.

### Apple Silicon: «bad CPU type» при запуске python

- Pr под Rosetta, а Homebrew Python собран для arm64. Открыть Premiere Pro в
  Finder → Get Info → снять «Open with Rosetta».
- Альтернатива — поставить Python.org universal binary, который работает в
  обоих режимах.
