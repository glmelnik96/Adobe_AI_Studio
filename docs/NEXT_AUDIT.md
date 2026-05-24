# Открытые вопросы для следующего аудита (после V1.1)

Этот документ — backlog того, что НЕ вошло в V1.1, но требует архитектурного
ответа перед V1.2. Каждый пункт — формулировка проблемы + ответ/предлагаемый
план фикса.

---

## 1. Re-import после перезагрузки панели (вопрос пользователя, 2026-05-23)

### Симптом

Сейчас при перезапуске Premiere Pro (или перезагрузке CEP-панели) панель
импортирует файлы в bin `PhygitalStudio` повторно, даже если они уже есть в
проекте. Получаются дубликаты ProjectItem'ов с одинаковым `getMediaPath()`.

### Можно ли добавить проверку? — Да, технически и архитектурно

**Кратко: да, это безопасно делается двумя слоями защиты — JS-side cache hit и
host-side path-lookup.** Базовая инфраструктура уже на месте, нужен ~15 LOC.

### Почему сейчас дублируется

В `cep-premiere/client/components/App.js` (poll-tick, строки 75–131):

```js
const cur  = store.get().jobs || [];       // ← после reload — пустой массив
const remote = r.jobs || [];
const { completedNow } = diffJobs(cur, remote);
store.set({ jobs: mergeJobs(cur, remote) });  // ← merge с persisted meta — ПОСЛЕ diff
for (const j of completedNow) { ... importToBin(localPath) ... }
```

На первом poll-tick'е после reload:

1. `cur` пустой → `diffJobs` считает «новыми completed» ВСЕ remote-completed.
2. `mergeJobs` дальше восстанавливает `localPath` + `projectItemId` из
   `JOB_META_KEY` localStorage — но это уже после того, как `completedNow`
   решён.
3. Каждый completed job → `importToBin(localPath)` → Pr радостно создаёт
   второй ProjectItem на тот же путь.

### План фикса (для V1.2)

**Layer 1 (JS, дешёвый — фильтрация перед import):**

В `App.js` поменять порядок: сначала `mergeJobs`, потом `diffJobs` на merged
снэпшоте; либо в auto-import loop'е проверять `patchJobMetaCache`:

```js
const merged = mergeJobs(cur, remote);
store.set({ jobs: merged });
const { completedNow } = diffJobs(cur, merged);   // diff на merged
const meta = loadJobMetaCache();
for (const j of completedNow) {
  if (meta[j.job_id]?.projectItemId) continue;     // уже импортирован
  if (meta[j.job_id]?.localPath) {
    // путь сохранён, но Pr-проект мог быть пересоздан → layer 2
  }
  ...
}
```

**Layer 2 (host, защита от stale projectItemId):**

В `host.jsx` уже есть `_findImportedByPath(targetPath)` (строки 793–811),
которое walk'ит дерево и ищет ProjectItem по `getMediaPath()`. Достаточно
экспонировать его как отдельную функцию `findByPath(path)` и вызывать перед
`importToBin`:

```js
// host.jsx — новая API-функция
function findByPath(path) {
  var hit = _findImportedByPath(path);
  if (!hit) return _err('not_found');
  return _ok({
    projectItemId: String(hit.item.nodeId),
    binName: String(hit.parent.name || 'root'),
  });
}
```

```js
// App.js — обёртка над importToBin
async function importIfMissing(localPath) {
  try {
    const f = await hostQueued('findByPath', localPath);
    return { projectItemId: f.projectItemId, reused: true };
  } catch (_) { /* not_found — нормально */ }
  const r = await hostQueued('importToBin', localPath);
  return { projectItemId: r.projectItemId, reused: false };
}
```

Это закрывает три кейса разом:
1. **Reload панели, проект Pr тот же** — layer 1 (cache hit на projectItemId).
2. **Reload панели, проект Pr пересоздан/переоткрыт** — layer 2 (path lookup).
3. **Пользователь руками удалил ProjectItem из бина** — layer 2 не найдёт →
   честный re-import (это уже не дубль).

### Риски и edge-cases

- **getMediaPath нормализация.** `_findImportedByPath` уже делает
  `toLowerCase().replace(/\//g, '\\')`. На macOS это нужно адаптировать (там
  case-sensitive FS на APFS-noncasefolding и forward-slash separator). Сейчас
  весь импорт — на Windows, для V1.2 переноса нужен платформо-специфичный
  компаратор.
- **Стоимость walk'а дерева.** На больших проектах (1000+ ProjectItem) каждый
  `findByPath` — это full DFS. Cache miss на N completed-джобов = N*O(tree).
  Mitigation: добавить `_pathCache: {mediaPath → ProjectItem}`, инвалидация на
  `importToBin` (так же как `_piCache`). +20 LOC, идёт вместе с фиксом.
- **HEIC/HEIF и другие форматы, которые Pr транскодирует.** Если Pr внутри
  переименовал файл, `getMediaPath` может вернуть staged-путь, отличающийся
  от того, что мы сохранили в `localPath`. Маловероятно для PNG/MP4/JPEG из
  Phygital, но стоит проверить на live recon.

### Acceptance criteria

- [ ] Reload панели с 5 completed-джобами → 0 повторных импортов (в bin
      остаётся ровно 5 ProjectItem).
- [ ] Юзер удалил один ProjectItem руками → следующий reload → 1 re-import
      (только удалённого).
- [ ] Юзер переоткрыл другой Pr-проект → reload панели → 5 импортов в новый
      bin.
- [ ] Тест в `cep-premiere/tests/test_app_jobs.test.js` на `findByPath`-fast-path.

---

## 2. L1–L3, L9, L12, M13, M16 audit codes — содержание не определено

В sub-project S6 backlog'е были перечислены коды без расшифровки. Перед V1.2
нужно определить их формулировки или подтвердить, что они уже закрыты
смежными фиксами.

---

## 3. Symlink installer — verification

Установщик `scripts/install_mac.sh` symlink-based, поэтому новые модули V1.1
(`app/services/idempotency.py`, `QueueWidget.js`) подхватываются автоматически
без переустановки. `pip install -e ".[dev]"` идемпотентен. Новые зависимости
не добавлены — `idempotency.py` использует только stdlib.

Однако CHANGELOG-bump в `sidecar/pyproject.toml` (`version = "0.1.0"`) ещё не
сделан — для V1.2 стоит синхронизировать с тегом V1.x.

---

## 4. AE-панель (sub-project C) — scaffold готов, реализации нет

`cep-ae/` содержит CSXS-манифест и stub-файлы (`client/panel.js` 20 LOC,
`host/insert_media.jsx` 28 LOC), но HTTP-клиента к sidecar и UI нет. V1.1
затрагивает только Pr-панель. Перенос фич V1.1 на AE — отдельный sub-project C,
не блокер для V1.1 release. См. `cep-ae/README.md` для текущего state.

---

## 5. Консолидированный приоритет-лист V1.2 (из AUDIT_V1.1)

Полный комплексный аудит (4 sub-audits: internal panel, internal sidecar,
external Pr/AE marketplace, external web AI UX) — `docs/AUDIT_V1.1.md`.
Ниже — топ-10 экшенов, отсортированных по соотношению impact / effort. Пп. 1-3
дублируют critical-баги из аудита; пп. 4-10 — стратегические фичи, защищающие
USP против ChatVideoPro и грядущих native Adobe-плагинов (окно 6-12 мес).

| # | Действие | Категория | Effort | Источник |
|---|---|---|---|---|
| 1 | Re-import dedup fix (§1 выше, mergeJobs→diffJobs + host findByPath) | bug:critical | 15 LOC | internal panel |
| 2 | `PhygitalClient` leak в `preview_cost`/`account` — нет `await client.__aexit__` | bug:critical | 5 LOC | internal sidecar |
| 3 | `HEAD /download/{id}` обходит auth middleware — добавить в protected paths | bug:critical | 3 LOC | internal sidecar |
| 4 | Video-to-video / restyle режим (главная маркетинговая фича ChatVideoPro) | feature | M | external Pr/AE |
| 5 | N-variant batch (1/2/4 grid, Midjourney-pattern) | feature:ux | M | external web AI |
| 6 | Insert-as-overlay-track (V2 timeline-pattern из Topaz) | feature:host | S | external Pr/AE |
| 7 | Prompt history + 1-click re-roll (`localStorage[PROMPT_HISTORY_KEY]`) | feature:ux | S | external web AI |
| 8 | Preset-pack: b-roll / transition / establishing-shot (вшитые промпт-шаблоны) | feature:ux | S | external Pr/AE |
| 9 | Vision-LLM frame-to-prompt (timeline-aware USP) | feature:ai | M | competitive |
| 10 | `AssetCache` double-upload race + jsonl compaction | bug:perf | 10 LOC | internal sidecar |

Critical-баги (#1-3, #10) — кандидаты на V1.1.1 hotfix, не ждать V1.2.

---

## 6. macOS compatibility audit (2026-05-24)

Аудит после V1.1 в свете того, что V1.1 фичи (persistent thumbnails, queue
widget) разрабатывались и тестировались под Windows. Ниже — что реально
сломается на Mac, по убыванию severity.

### 6.1. CRITICAL — `disk_save.js` ломает persistent thumbnails на Mac

**Файл:** `cep-premiere/client/lib/disk_save.js:34`

```js
const dir = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'PhygitalStudio', 'downloads-panel');
```

`LOCALAPPDATA` — Windows-only переменная. На Mac она `undefined`, fallback идёт
в `os.tmpdir()` = `/var/folders/<...>/T/`. macOS периодически GC'шит эту
директорию (особенно после `purge`, перезагрузки или 3-дневного простоя).
Это значит: **главная фича V1.1 «persistent thumbnails after Pr reload»
работает на Mac неделями случайно, а потом разом теряет все превью**.

**Fix:** зеркалировать платформо-детектор из `sidecar_token.js` /
`app/paths.py`:

```js
function _appDataDir() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  }
  return process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
}
const dir = path.join(_appDataDir(), 'PhygitalStudio', 'downloads-panel');
```

Тот же путь использует sidecar (`session.json`, `sidecar.token`) — превью
лягут рядом, что упростит uninstall (одна папка на удаление).

**Acceptance:** после Mac-reboot превью видны → V1.1 фича работает.

### 6.2. MEDIUM — `manifest.xml` исключает Pr 2024

**Файл:** `cep-premiere/CSXS/manifest.xml`

```xml
<Host Name="PPRO" Version="[24.0,99.9]" />
...
<RequiredRuntime Name="CSXS" Version="12.0" />
```

`HostList` разрешает Pr 24.0+ (Pr 2024), но `RequiredRuntime` требует CSXS 12,
который пришёл только с Pr 2025 (24.4+). Pr 2024 (24.0–24.3) — CSXS 11.
Манифест внутренне противоречив: Pr 2024.0 пройдёт `HostList`, потом упадёт
на `RequiredRuntime`.

**Fix:** опустить runtime до 11.0 (минимально совместимая с Pr 2024 GA):

```xml
<RequiredRuntime Name="CSXS" Version="11.0" />
```

CSXS 11 и 12 API-совместимы для нашего стека (`window.cep`, `evalScript`,
CEP file:// rendering — всё доступно с 11).

**Acceptance:** Pr 2024.0–2024.3 видит панель в `Window → Extensions`.
Документация (`INSTALL_MACOS.md`, `INSTALL_WINDOWS.md`) уже обещает Pr 2024+
поддержку — это приведёт код в соответствие с docs.

### 6.3. MEDIUM — `_findImportedByPath` хардкодит Windows-нормализацию

**Файл:** `cep-premiere/host/host.jsx:795,803`

```js
var needle = String(targetPath || '').toLowerCase().replace(/\//g, '\\');
var p = String(c.getMediaPath() || '').toLowerCase().replace(/\//g, '\\');
```

Случайно работает на Mac (оба пути проходят одну трансформацию → совпадают),
но семантически неверно: APFS по умолчанию case-sensitive (`Photo.png` ≠
`photo.png`), а separator на Mac — forward slash. Reverse-slash нормализация
маскирует ошибки.

**Сейчас** это безопасно, потому что compare происходит на одинаково
изуродованных строках. **Сломается**, когда мы реализуем §1 (`findByPath`
как public host-API): внешний caller передаст путь в native-форме Mac, и
сравнение `lowercase + backslash` с такой строкой даст false-negative.

**Fix:** перед V1.2 §1 — переделать в платформо-aware:

```js
function _normPath(p) {
  p = String(p || '');
  if ($.os.toLowerCase().indexOf('windows') >= 0) {
    return p.toLowerCase().replace(/\//g, '\\');
  }
  return p.replace(/\\/g, '/');   // Mac/Linux — case-sensitive, оставить как есть
}
```

### 6.4. LOW — устаревшие doc-references на `disk.js stageToAscii`

Функция `stageToAscii` удалена в V1.1 (ASCII-staging заменён на native UTF-8
import после фикса CEP-encoding на Pr 24.2+). Упоминания остались в:

- `docs/INSTALL_MACOS.md:274` (раздел «Generate падает с import failed»)
- `docs/INSTALL_WINDOWS.md:237` (тот же раздел)
- `docs/PROJECT_OVERVIEW.md:233` (описание disk.js)
- `docs/PROJECT_OVERVIEW.md:490` (диаграмма data flow)

**Fix:** заменить блок «Кириллица в пути» на актуальный — теперь Pr
импортирует UTF-8 напрямую, фикс не нужен; если всё-таки import падает —
проверить CEP-логи в `~/Library/Logs/CSXS/`. Аналогично — на Windows-странице.

### 6.5. OK — компоненты, верифицированные кросс-платформенными

| Компонент | Что проверено |
|---|---|
| `cep-premiere/client/lib/autostart.js` | `PYTHON_CANDIDATES` содержит `/opt/homebrew/bin/python3`, `/usr/local/bin/python3`, framework-paths, `/usr/bin/python3`; `process.kill(-pid, SIGTERM)` для process-group на darwin; PIDFILE через `os.tmpdir()` |
| `cep-premiere/client/lib/sidecar_token.js` | Резолвит `~/Library/Application Support/PhygitalStudio/sidecar.token` на darwin |
| `sidecar/app/paths.py` | Path-based resolver с `sys.platform` ветками win32/darwin/linux — идеально |
| `cep-premiere/host/host.jsx` `_tmpDir`/`_nativePath`/`_isWin` (lines 185-256) | Корректно проверяют `$.os`, переключают separator, используют `/tmp/PhygitalStudio_frames` и `/var/tmp/PhygitalStudio_frames` на Mac |
| `cep-premiere/client/lib/disk_save.js` `localPathToFileUrl` | `file:///` URL форма корректна для CEF на Mac (тестировано в Pr DevTools) |

### 6.6. Установщик `scripts/install_mac.sh` — OK

`bash -n` синтаксис проходит. Скрипт:
- Идемпотентен (повторный запуск безопасен).
- Symlink-based — `git pull` подхватывается без переустановки.
- Поднимает оба CSXS-ключа (`com.adobe.CSXS.11` и `.12`) — что после §6.2
  будет работать корректно для Pr 2024.
- V1.1 smoke-test добавлен (`import app.main`, `from app.services.idempotency
  import IdempotencyStore, hash_request_body`).
- Apple Silicon: `playwright install chromium` ставит arm64-бинарь; Pr под
  Rosetta — отдельный кейс, задокументирован в `INSTALL_MACOS.md:298-303`.

**Замечание (не блокер):** скрипт не делает `defaults delete` при reinstall,
но это и не нужно — `PlayerDebugMode = 1` идемпотентно.

### 6.7. Документация — статус

| Документ | Состояние |
|---|---|
| `docs/INSTALL_MACOS.md` | OK кроме §9 (stale stageToAscii в §6.4) |
| `docs/INSTALL_WINDOWS.md` | OK кроме §9 (stale stageToAscii в §6.4) |
| `docs/PROJECT_OVERVIEW.md` | OK кроме 2 mention'ов stageToAscii (§6.4); §11.3 macOS-pitfalls покрывает реальные кейсы |
| `cep-premiere/README.md` | Не проверен в этом аудите — добавить в TODO |
| `CHANGELOG.md` | V1.1 release notes полные |
| `docs/AUDIT_V1.1.md` | Свежий, отражает текущее состояние |
| `README.md` | Status="2026-05-23, V1.1", все ссылки рабочие |

### 6.8. Приоритет fix'ов перед V1.2

1. **§6.1** (disk_save.js) — критично, ломает Mac-юзеров на V1.1.
2. **§6.2** (manifest CSXS 11) — блокирует Pr 2024 GA users (Win+Mac).
3. **§6.4** (stale docs) — 10 минут, чисто текстовые правки.
4. **§6.3** (host.jsx normalization) — переделать перед §1 (V1.2).
