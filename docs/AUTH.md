# Бутстрап Phygital-сессии

Phygital+ не имеет публичного API. Авторизация — SuperTokens (cookies + Bearer JWT),
сессию можно получить только через реальный браузерный логин на
`https://app.phygital.plus/`.

## Алгоритм (тот же, что в Phygital-bot / Phygital_MCP)

1. Sidecar при старте проверяет `%LOCALAPPDATA%\PhygitalStudio\session.json`.
2. Если файла нет ИЛИ JWT истёк и refresh-token тоже не валиден →
   `POST /auth/recon` от панели запускает Playwright headed Chromium с
   `launch_persistent_context(user_data_dir=%LOCALAPPDATA%\PhygitalStudio\user_data)`.
3. Пользователь логинится один раз руками. Sidecar ловит cookies (`st-access-token`,
   `st-refresh-token`, `sFrontToken`, `st-last-access-token-update`), пишет `session.json`.
4. Дальше каждый HTTP-запрос идёт с `Authorization: Bearer <st-access-token>`
   + cookie-jar. При `401`/`418` SuperTokens — `/auth/session/refresh` обновляет токен,
   запрос повторяется (логика `SessionManager` из `Phygital-bot/client/session.py`).
5. Pre-flight refresh при старте sidecar'а: если JWT доживёт <15 мин — рефрешим заранее,
   чтобы не получить 418 в середине задачи.

## Расположение файлов

| OS | Путь |
|---|---|
| Windows | `%LOCALAPPDATA%\PhygitalStudio\` |
| macOS | `~/Library/Application Support/PhygitalStudio/` |
| Linux | `~/.local/share/PhygitalStudio/` |

Содержимое:

```
session.json         текущие cookies + JWT + captured_at
user_data/           Playwright persistent profile (cookies, localStorage)
downloads/<job_id>/  скачанные результаты (TTL 24h)
uploads/<sess_id>/   загруженные init-картинки (TTL 1h)
jobs.jsonl           журнал задач (для restore после рестарта)
```

Всё в gitignore, никогда не уходит в репо.

## UX логина в панели

- Панель при первом запуске вызывает `GET /health`.
- Если в ответе `session_age_sec == null` → показывает кнопку
  «Войти в Phygital» → `POST /auth/recon` → опрос `GET /health` каждые 2с до появления
  валидной сессии.
- В заголовке панели — индикатор сессии: `OK (TTL 4ч 12мин)` / `Refreshing...` / `Не залогинен`.

## Корпоративный proxy / MITM (Cloud.ru)

Sidecar использует `truststore.SSLContext` — берёт CA из системного хранилища
(Windows Cert Store / Keychain), а не из bundled certifi. Это обязательно под корп-проксей
Cloud.ru с самоподписным CA. Решение проверено в `Phygital-bot/client/api.py`.

## Что НЕ делать

- Не пытаться зашить пароль/логин в sidecar — SuperTokens сессии короткоживущие, всё
  равно понадобится refresh-цикл, который реализован.
- Не дублировать cookies в CEP-панель — она к Phygital напрямую не ходит.
- Не коммитить `session.json` (gitignore это покрывает, но напоминаю).
