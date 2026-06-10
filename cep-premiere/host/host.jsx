// Phygital Studio — Pr ExtendScript host.
// Public API (all return JSON.stringify({ok, ...})):
//   getBinSelection()
//   getTimelineSelection(playheadOnly)
//   getSourceMonitorItem()
//   exportTimelineFrame()        — JPG из активной sequence на playhead'е
//   getSourceInOut()              — клип в Source Monitor + его In/Out marks
//   getSelectedClipSource()       — выделенный клип таймлайна → source in/out
//   insertToTimeline(projectItemId, atSec) — вставка на свободный трек выше
//   importToBin(path)
//   revealInBin(projectItemId)
//   diagApis()                    — диагностика доступных API (для debug)
//
// All paths are absolute. Functions never throw — wrap in try/catch and
// return {ok:false, error}.
//
// QE DOM: ряд методов (exportFrameJPEG, getInPoint marks и т.д.) отсутствуют
// на «стабильном» Sequence/ProjectItem DOM в части билдов Pr, но всегда есть
// в QE (Quality Engineering) DOM. Включаем через app.enableQE() — это легаси
// API, которое Adobe держит ещё с Pr CS5 и не выпиливает из-за множества
// production-панелей, на него полагающихся.

#target premierepro

function _ok(extra) {
  var o = { ok: true };
  for (var k in extra) if (extra.hasOwnProperty(k)) o[k] = extra[k];
  return JSON.stringify(o);
}
function _err(code, reason) {
  return JSON.stringify({ ok: false, error: code, reason: reason || null });
}

function _itemKind(pi) {
  // ProjectItem.type: 1=clip, 2=bin, 3=root, 4=file
  // Better: inspect getMediaPath + nodeId. Fall back to extension sniffing.
  // Расширения держим максимально полными — иначе клип возвращается как
  // 'unknown' и проскакивает мимо image/video-валидации на клиенте.
  try {
    if (pi.getMediaPath) {
      var p = String(pi.getMediaPath() || '');
      var ext = p.split('.').pop().toLowerCase();
      if (['mp4','mov','avi','mkv','m4v','mxf','webm','flv','mts','m2ts','ts','3gp','3g2','wmv','asf','vob','hevc','h264'].indexOf(ext) >= 0) return 'video';
      if (['jpg','jpeg','png','tif','tiff','psd','heic','webp','bmp','gif','exr','dpx','tga'].indexOf(ext) >= 0) return 'image';
      if (['wav','mp3','aac','aiff','flac','ogg','m4a','wma'].indexOf(ext) >= 0) return 'audio';
    }
  } catch (e) {}
  return 'unknown';
}

function _walkItems(root, out) {
  for (var i = 0; i < root.children.numItems; i++) {
    var c = root.children[i];
    if (c.type === ProjectItemType.BIN || c.type === 2) _walkItems(c, out);
    else out.push(c);
  }
}

// Кэш ProjectItem по nodeId. Раньше revealInBin / importToBin делали O(N)
// tree walk на каждый вызов — на проекте с ~500 клипами одно "Show in bin"
// становилось заметным (десятки ms на каждом клике). Стратегия:
//   1) cache hit → быстро вернуть закэшированный ProjectItem;
//   2) проверить, что pi всё ещё жив (Pr мог удалить элемент). pi.nodeId
//      бросает после удаления — try/catch ловит это и инвалидирует запись;
//   3) cache miss → walk tree, по дороге заполняя ВСЕ встреченные nodeId
//      в кэш (батч-стиль, дешевле чем lazy populate).
//
// Инвалидация — мягкая: на importToBin сбрасываем кэш, потому что новый
// nodeId может конфликтнуть с переиспользованным id Pr (теоретический риск).
// Других триггеров не нужно: проверка живости в (2) ловит удаления.
var _piCache = {};

function _piCacheClear() { _piCache = {}; }

function _piIsAlive(pi) {
  if (!pi) return false;
  try {
    // Любой доступ — если item мёртв, ExtendScript кинет; иначе строка ok.
    var _ = String(pi.nodeId);
    return true;
  } catch (e) { return false; }
}

function _findProjectItemById(id) {
  var key = String(id);
  var hit = _piCache[key];
  if (hit && _piIsAlive(hit)) return hit;
  if (hit) delete _piCache[key];  // мёртвая запись

  var stack = [app.project.rootItem];
  while (stack.length) {
    var n = stack.pop();
    for (var i = 0; i < n.children.numItems; i++) {
      var c = n.children[i];
      try { _piCache[String(c.nodeId)] = c; } catch (e) {}
      if (String(c.nodeId) === key) return c;
      if (c.type === 2 /* bin */) stack.push(c);
    }
  }
  return null;
}

// Cобираем selection из всех доступных API. legacy `app.project.getSelection()`
// возвращает пустой массив когда фокус ушёл из Project-панели (юзер кликнул
// в CEP-кнопку — фокус ушёл — selection "сбросился"). В Pr 22+ есть
// `app.getProjectViewSelection(viewID)` который держит селекцию независимо
// от фокуса. Плюс fallback на `app.project.activeItem` (одиночный focused item)
// и `app.sourceMonitor.getProjectItem()` (последний открытый клип).
function _gatherBinSelection(attempts) {
  // 1) Modern multi-view API (Pr 22+).
  try {
    if (typeof app.getProjectViewIDs === 'function') {
      var ids = app.getProjectViewIDs() || [];
      attempts.push('projectViewIDs=' + ids.length);
      for (var i = 0; i < ids.length; i++) {
        try {
          var sel = app.getProjectViewSelection(ids[i]);
          if (sel && sel.length) {
            attempts.push('viewSel[' + i + ']=' + sel.length);
            return sel;
          }
        } catch (e1) { attempts.push('viewSel[' + i + ']:' + String(e1)); }
      }
    } else { attempts.push('no_getProjectViewIDs'); }
  } catch (e) { attempts.push('viewIDs:' + String(e)); }

  // 2) Legacy `app.project.getSelection()`.
  try {
    if (app.project.getSelection) {
      var legacy = app.project.getSelection();
      attempts.push('legacy=' + (legacy ? legacy.length : 'null'));
      if (legacy && legacy.length) return legacy;
    } else { attempts.push('no_legacy_getSelection'); }
  } catch (e) { attempts.push('legacy:' + String(e)); }

  // 3) Single focused item (`app.project.activeItem`).
  try {
    var act = app.project.activeItem;
    if (act) { attempts.push('activeItem=' + String(act.name)); return [act]; }
    attempts.push('no_activeItem');
  } catch (e) { attempts.push('activeItem:' + String(e)); }

  // 4) Source Monitor — последний "открытый" клип. Иногда юзер
  // double-click'ает в бине → клип попадает в Source Monitor, но
  // селекция сбрасывается. Полезный fallback.
  try {
    if (app.sourceMonitor && app.sourceMonitor.getProjectItem) {
      var smi = app.sourceMonitor.getProjectItem();
      if (smi) { attempts.push('sourceMonitor=' + String(smi.name)); return [smi]; }
      attempts.push('no_sourceMonitor_item');
    }
  } catch (e) { attempts.push('sourceMonitor:' + String(e)); }

  return null;
}

function getBinSelection() {
  var attempts = [];
  try {
    var sel = _gatherBinSelection(attempts);
    if (!sel || sel.length === 0) {
      return _err('no_selection', 'attempts=' + attempts.join(' | '));
    }
    var items = [];
    var skipped = [];
    for (var i = 0; i < sel.length; i++) {
      var pi = sel[i];
      var kind = _itemKind(pi);
      if (['video','image','audio'].indexOf(kind) < 0) {
        try { skipped.push(String(pi.name) + ':' + kind); } catch (e) {}
        continue;
      }
      items.push({
        projectItemId: String(pi.nodeId),
        path: _mediaPath(pi),
        name: String(pi.name),
        kind: kind,
      });
    }
    if (items.length === 0) {
      return _err('unsupported_kind',
        'attempts=' + attempts.join(' | ') + ' | skipped=' + skipped.join(','));
    }
    return _ok({ items: items, attempts: attempts });
  } catch (e) {
    return _err('exception', String(e) + ' | attempts=' + attempts.join(' | '));
  }
}

function getTimelineSelection(playheadOnly) {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return _err('no_active_sequence');
    var items = [];
    var phTicks = seq.getPlayerPosition ? seq.getPlayerPosition() : null;
    function clipAt(track, clip) {
      var inSec = clip.start.seconds;
      var outSec = clip.end.seconds;
      if (playheadOnly && phTicks) {
        var phSec = phTicks.seconds;
        if (phSec < inSec || phSec > outSec) return false;
      }
      var pi = clip.projectItem;
      if (!pi) return false;
      var kind = _itemKind(pi);
      // Adjustment layers / color mattes / generators / transitions возвращают
      // ProjectItem без mediaPath → kind='unknown'. На клиенте такой clip всё
      // равно отвергается image/video-валидацией слота, но успевает занять
      // место в списке и сбивает auto-fill. Фильтруем здесь.
      if (kind === 'unknown') return false;
      items.push({
        projectItemId: String(pi.nodeId),
        path: _mediaPath(pi),
        name: String(clip.name),
        kind: kind,
        in_sec: inSec,
        out_sec: outSec,
      });
      return true;
    }
    var sawAny = false;
    for (var t = 0; t < seq.videoTracks.numTracks; t++) {
      var trk = seq.videoTracks[t];
      for (var c = 0; c < trk.clips.numItems; c++) {
        var clip = trk.clips[c];
        if (playheadOnly || clip.isSelected()) { sawAny = true; clipAt(trk, clip); }
      }
    }
    if (items.length === 0) {
      if (sawAny) return _err('unsupported_kind');
      return _err(playheadOnly ? 'no_clip_at_playhead' : 'no_selection');
    }
    return _ok({ items: items });
  } catch (e) { return _err('exception', String(e)); }
}

function getSourceMonitorItem() {
  try {
    var sm = app.sourceMonitor;
    if (!sm) return _err('no_source_monitor_clip');
    var proj = sm.getProjectItem ? sm.getProjectItem() : null;
    if (!proj) return _err('no_source_monitor_clip');
    var pi = proj;
    return _ok({ item: {
      projectItemId: String(pi.nodeId),
      path: _mediaPath(pi),
      name: String(pi.name),
      kind: _itemKind(pi),
    }});
  } catch (e) { return _err('exception', String(e)); }
}

// QE DOM legacy на Windows работает через MBCS — если путь содержит non-ASCII
// (типичный кейс: имя юзера на кириллице, тогда Folder.temp = C:\Users\<имя>\
// AppData\Local\Temp), методы exportFrameJPEG/PNG/TIFF/Targa/DPX молча
// возвращаются БЕЗ создания файла и БЕЗ exception. Поэтому выбираем
// ASCII-safe директорию в первую очередь.
function _isWin() {
  try { return ($.os || '').toLowerCase().indexOf('windows') >= 0; } catch (e) { return true; }
}

// $.os на Mac обычно "Macintosh OS" / "Mac OS X". Linux — "Linux". Если
// детект не сработал, считаем что НЕ Mac (false-safe для linux ext4).
function _isMac() {
  try {
    var o = ($.os || '').toLowerCase();
    return o.indexOf('mac') >= 0 || o.indexOf('darwin') >= 0;
  } catch (e) { return false; }
}

function _nativeSep() { return _isWin() ? '\\' : '/'; }

// Нормализуем path → native separators. QE на Windows требует backslashes.
function _nativePath(p) {
  if (!p) return p;
  if (_isWin()) return String(p).replace(/\//g, '\\');
  return String(p).replace(/\\/g, '/');
}

// На Mac часть билдов Pr (особенно при включённом AppleScript bridge или
// старых проектах) возвращает HFS-форму "Macintosh HD:Users:user:file.mov"
// вместо POSIX "/Users/user/file.mov". Node fs / sidecar этот формат не
// понимают. Используем ExtendScript File API — у File есть .fsName,
// который на Mac ВСЕГДА POSIX (валидно и для HFS-input, и для POSIX-input).
// Если File не существует — fallback ручное преобразование (HFS → /Volumes/X/...).
function _macToPosix(p) {
  if (!p || !_isMac()) return p;
  var s = String(p);
  // Уже POSIX (начинается с / и нет двоеточий в первом сегменте) — возвращаем.
  var firstSeg = s.split('/')[0];
  if (s.charAt(0) === '/' && firstSeg.indexOf(':') < 0) return s;
  // Пробуем File.fsName — самый надёжный путь.
  try {
    var f = new File(s);
    if (f && f.fsName) return String(f.fsName);
  } catch (e) {}
  // Fallback ручной HFS→POSIX. "Macintosh HD:Users:..." → "/Users/..."
  // на загрузочном томе; иначе "/Volumes/<vol>/...".
  if (s.indexOf(':') >= 0) {
    var parts = s.split(':');
    var vol = parts.shift();
    var rest = parts.join('/');
    if (/^Macintosh HD$/i.test(vol)) return '/' + rest;
    return '/Volumes/' + vol + (rest ? '/' + rest : '');
  }
  return s;
}

// Безопасно дергаем pi.getMediaPath() и нормализуем HFS→POSIX на Mac.
// Возвращает строку (возможно пустую) — никогда не undefined.
function _mediaPath(pi) {
  try {
    var raw = pi && pi.getMediaPath ? String(pi.getMediaPath()) : '';
    return _macToPosix(raw);
  } catch (e) { return ''; }
}

function _isAscii(s) { return !/[^\x00-\x7F]/.test(String(s || '')); }

// Проверяем что в директорию реально можем писать (создаём тестовый файл).
function _canWrite(dir) {
  try {
    var probePath = dir + _nativeSep() + '.probe_' + (new Date().getTime());
    var pf = new File(_nativePath(probePath));
    if (!pf.open('w')) return false;
    pf.write('1'); pf.close();
    var ok = pf.exists && pf.length > 0;
    try { pf.remove(); } catch (e) {}
    return ok;
  } catch (e) { return false; }
}

function _tmpDir() {
  var candidates = [];
  if (_isWin()) {
    // ProgramData всегда ASCII и world-writable на всех Windows билдах.
    candidates.push('C:\\ProgramData\\PhygitalStudio\\frames');
    candidates.push('C:\\Temp\\PhygitalStudio_frames');
    candidates.push('C:\\Windows\\Temp\\PhygitalStudio_frames');
  } else {
    candidates.push('/tmp/PhygitalStudio_frames');
    candidates.push('/var/tmp/PhygitalStudio_frames');
  }
  // Последний шанс — Folder.temp (может содержать Cyrillic, для QE плохо,
  // но если ASCII-варианты вообще недоступны — лучше чем ничего).
  try {
    candidates.push(Folder.temp.fsName + _nativeSep() + 'PhygitalStudio_frames');
  } catch (e) {}

  // Сначала ищем ASCII-путь который можно создать И в который можно писать.
  for (var i = 0; i < candidates.length; i++) {
    var p = _nativePath(candidates[i]);
    if (!_isAscii(p)) continue;
    try {
      var f = new Folder(p);
      if (!f.exists) f.create();
      if (f.exists && _canWrite(p)) return p;
    } catch (e) {}
  }
  // Деградация: любой путь, который удалось создать.
  for (var j = 0; j < candidates.length; j++) {
    var p2 = _nativePath(candidates[j]);
    try {
      var f2 = new Folder(p2);
      if (!f2.exists) f2.create();
      if (f2.exists) return p2;
    } catch (e) {}
  }
  // Совсем крайний случай.
  return _nativePath(_isWin() ? 'C:\\ProgramData\\PhygitalStudio\\frames' : '/tmp/PhygitalStudio_frames');
}

// Безопасно включает QE DOM. Возвращает true если qe.project доступен.
function _ensureQE() {
  try {
    if (typeof app.enableQE === 'function') app.enableQE();
    return (typeof qe !== 'undefined') && qe && qe.project;
  } catch (e) { return false; }
}

// FPS активной sequence — нужен для построения корректной timecode-строки.
// Пробуем несколько источников: getSettings().videoFrameRate, потом timebase.
// Падаем на 30 если ничего не известно.
function _seqFps(seq) {
  try {
    if (typeof seq.getSettings === 'function') {
      var s = seq.getSettings();
      if (s && s.videoFrameRate) {
        var d = Number(s.videoFrameRate.seconds != null ? s.videoFrameRate.seconds : s.videoFrameRate);
        if (d > 0) return 1 / d;
      }
    }
  } catch (e) {}
  try {
    // Pr internal: 254016000000 ticks/sec. timebase = ticks/frame.
    if (seq.timebase) {
      var tb = Number(seq.timebase);
      if (tb > 0) return 254016000000 / tb;
    }
  } catch (e) {}
  return 30;
}

function _pad2(n) { return (n < 10 ? '0' : '') + n; }

// "HH:MM:SS:FF" timecode из секунд. Drop-frame не различаем — для экспорта
// единичного кадра достаточно non-drop-формы.
function _toTimecode(sec, fps) {
  var fpsInt = Math.max(1, Math.round(fps));
  var tf = Math.round(sec * fpsInt);
  var f = tf % fpsInt;
  var totalSec = Math.floor(tf / fpsInt);
  var s = totalSec % 60;
  var m = Math.floor(totalSec / 60) % 60;
  var h = Math.floor(totalSec / 3600);
  return _pad2(h) + ':' + _pad2(m) + ':' + _pad2(s) + ':' + _pad2(f);
}

// Экспортирует кадр из активной sequence на текущей позиции playhead'а.
//
// Проблема: QE DOM `exportFrameJPEG` имеет легаси-сигнатуру с ОБЯЗАТЕЛЬНЫМ
// вторым аргументом — timecode. Разные билды Pr принимают этот аргумент в
// разных форматах: "HH:MM:SS:FF" / ticks как строка / секунды как строка /
// иногда пустая строка трактуется как "playhead position". Поэтому
// перебираем (метод × формат_времени) пока не получим непустой файл.
//
// Порядок методов: JPEG → PNG → TIFF → Targa → DPX → стабильный seq.* (1-arg).
// Все попытки попадают в attempts log — клиент пишет его в console.error,
// чтобы было видно, какой именно вариант сработал/упал.
function exportTimelineFrame() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return _err('no_active_sequence');
    var ph = seq.getPlayerPosition && seq.getPlayerPosition();
    var phSec = ph ? Number(ph.seconds) : 0;
    var phTicks = '';
    try { if (ph && ph.ticks != null) phTicks = String(ph.ticks); } catch (e) {}
    var fps = _seqFps(seq);
    var tc = _toTimecode(phSec, fps);
    var baseDir = _tmpDir();
    var stamp = (new Date().getTime()) + '_' + Math.floor(Math.random() * 1e6);

    var attempts = [];
    var attemptIdx = 0;

    // baseDir уже native, но всё равно прогоняем через _nativePath для уверенности.
    function freshPath(ext) {
      return _nativePath(baseDir + _nativeSep() + 'frame_' + stamp + '_' + (attemptIdx++) + '.' + ext);
    }

    // Диагностика: если все QE-попытки потом упадут — поможет видеть состояние dir.
    attempts.push('baseDir=' + baseDir);
    attempts.push('baseDir.ascii=' + _isAscii(baseDir));
    attempts.push('baseDir.writable=' + _canWrite(baseDir));

    // Разные QE-билды Pr ждут разный 2nd arg. Перебираем все варианты.
    var timeArgs = [
      { tag: 'tc',    val: tc },
      { tag: 'ticks', val: phTicks },
      { tag: 'secs',  val: String(phSec) },
      { tag: 'empty', val: '' }
    ];

    var qeSeq = null;
    if (_ensureQE()) {
      try { qeSeq = qe.project.getActiveSequence(); }
      catch (e) { attempts.push('qe.getActiveSequence:' + String(e)); }
      if (!qeSeq) attempts.push('qe.getActiveSequence:null');
    } else {
      attempts.push('qe:unavailable');
    }

    // Бывает что QE пишет файл не туда куда мы попросили (например меняет
     // расширение jpg→jpeg, или скидывает рядом). Сканируем директорию по
    // нашему stamp'у — если что-то с правильным prefix'ом появилось.
    function scanForOutput() {
      try {
        var folder = new Folder(baseDir);
        if (!folder.exists) return null;
        var prefix = 'frame_' + stamp;
        var files = folder.getFiles(function (f) {
          return (f instanceof File) && String(f.name).indexOf(prefix) === 0;
        });
        if (files && files.length) {
          for (var k = 0; k < files.length; k++) {
            if (files[k].length > 0) return files[k].fsName;
          }
        }
      } catch (e) {}
      return null;
    }

    function tryQEMethod(methodName, ext) {
      if (!qeSeq) return null;
      if (typeof qeSeq[methodName] !== 'function') {
        attempts.push('qe.' + methodName + ':not_function');
        return null;
      }
      for (var i = 0; i < timeArgs.length; i++) {
        var ta = timeArgs[i];
        if (ta.tag === 'ticks' && !ta.val) continue;
        var outPath = freshPath(ext);
        var label = 'qe.' + methodName + '[' + ta.tag + '=' + ta.val + ']';
        try {
          var rv = qeSeq[methodName](outPath, ta.val);
          var f = new File(outPath);
          var rvHint = (typeof rv === 'boolean' || typeof rv === 'number') ? (',rv=' + rv) : '';
          if (f.exists && f.length > 0) {
            attempts.push(label + ':ok' + rvHint);
            return outPath;
          }
          // QE мог записать рядом с другим расширением — сканируем.
          var scanned = scanForOutput();
          if (scanned) {
            attempts.push(label + ':ok_scanned=' + scanned + rvHint);
            return scanned;
          }
          attempts.push(label + ':no_file' + rvHint + ',path=' + outPath);
        } catch (e) {
          attempts.push(label + ':' + String(e).replace(/[\r\n]+/g, ' ').slice(0, 80));
        }
      }
      return null;
    }

    var result = tryQEMethod('exportFrameJPEG', 'jpg');
    if (!result) result = tryQEMethod('exportFramePNG',  'png');
    if (!result) result = tryQEMethod('exportFrameTIFF', 'tif');
    if (!result) result = tryQEMethod('exportFrameTarga', 'tga');
    if (!result) result = tryQEMethod('exportFrameDPX',  'dpx');

    // Резерв: стабильный Sequence DOM (на некоторых билдах есть с 1-arg).
    if (!result) {
      if (typeof seq.exportFrameJPEG === 'function') {
        var outPath = freshPath('jpg');
        try {
          seq.exportFrameJPEG(outPath);
          var f2 = new File(outPath);
          if (f2.exists && f2.length > 0) {
            attempts.push('seq.exportFrameJPEG:ok');
            result = outPath;
          } else {
            attempts.push('seq.exportFrameJPEG:no_file');
          }
        } catch (e) {
          attempts.push('seq.exportFrameJPEG:' + String(e).replace(/[\r\n]+/g, ' ').slice(0, 80));
        }
      } else {
        attempts.push('seq.exportFrameJPEG:not_function');
      }
    }

    if (!result) {
      return _err('export_failed', 'attempts=' + attempts.join(' | '));
    }

    return _ok({
      framePath: result,
      timecode: tc,
      playheadSec: phSec,
      fps: fps,
      sequenceName: String(seq.name),
      attempts: attempts,
    });
  } catch (e) { return _err('export_failed', String(e)); }
}

// Source Monitor → клип + его In/Out marks (как секунды).
// Если In/Out не выставлены — отдаём 0..duration (весь клип).
//
// Идём по нескольким API, потому что на разных билдах Pr доступны разные:
//   1) Стабильный ProjectItem: getInPoint(1)/getOutPoint(1)/getDuration()
//   2) QE DOM clip.getInPoint()/getOutPoint() (TickTime)
//   3) QE source monitor: sm.player.getInPoint()/getOutPoint() в тиках
//
// Источник правды для duration — сначала pi.getDuration, потом метаданные
// через ffprobe на стороне sidecar если ничего не дало.
function getSourceInOut() {
  var attempts = [];
  try {
    var sm = app.sourceMonitor;
    if (!sm) return _err('no_source_monitor');
    var pi = sm.getProjectItem ? sm.getProjectItem() : null;
    if (!pi) return _err('no_source_monitor_clip');

    var inSec = NaN, outSec = NaN, durSec = NaN;

    // ── duration ──
    try {
      if (pi.getDuration) {
        var dur = pi.getDuration();
        var d = dur ? Number(dur.seconds != null ? dur.seconds : dur) : NaN;
        if (!isNaN(d) && d > 0) { durSec = d; attempts.push('dur:pi.getDuration=' + d); }
      } else { attempts.push('dur:pi.getDuration:not_function'); }
    } catch (e) { attempts.push('dur:pi.getDuration:' + String(e)); }

    // ── in/out от стабильного DOM ──
    try {
      if (pi.getInPoint) {
        var t1 = pi.getInPoint(1);
        if (t1 && typeof t1.seconds !== 'undefined') { inSec = Number(t1.seconds); attempts.push('in:pi.getInPoint=' + inSec); }
      }
    } catch (e) { attempts.push('in:pi.getInPoint:' + String(e)); }
    try {
      if (pi.getOutPoint) {
        var t2 = pi.getOutPoint(1);
        if (t2 && typeof t2.seconds !== 'undefined') { outSec = Number(t2.seconds); attempts.push('out:pi.getOutPoint=' + outSec); }
      }
    } catch (e) { attempts.push('out:pi.getOutPoint:' + String(e)); }

    // ── QE DOM fallback (для in/out и duration) ──
    if (isNaN(inSec) || isNaN(outSec) || isNaN(durSec)) {
      if (_ensureQE()) {
        try {
          // QE source monitor имеет player с getPosition/getInPoint/getOutPoint
          var qsm = qe.source;
          if (qsm) {
            if (isNaN(inSec) && typeof qsm.getInPoint === 'function') {
              var qi = qsm.getInPoint();
              // QE возвращает TickTime-обёртку с .ticks или строку "HH:MM:SS:FF"
              var qiSec = _qeTimeToSec(qi);
              if (!isNaN(qiSec)) { inSec = qiSec; attempts.push('in:qe.source.getInPoint=' + inSec); }
            }
            if (isNaN(outSec) && typeof qsm.getOutPoint === 'function') {
              var qo = qsm.getOutPoint();
              var qoSec = _qeTimeToSec(qo);
              if (!isNaN(qoSec)) { outSec = qoSec; attempts.push('out:qe.source.getOutPoint=' + outSec); }
            }
          } else { attempts.push('qe.source:unavailable'); }
        } catch (e) { attempts.push('qe.source:' + String(e)); }
      } else {
        attempts.push('qe:unavailable');
      }
    }

    // ── Sanity: если марки не выставлены — берём весь клип ──
    var hadMarks = !isNaN(inSec) && !isNaN(outSec) && outSec > inSec;
    if (!hadMarks) {
      if (isNaN(inSec)) inSec = 0;
      if (!(outSec > inSec)) outSec = !isNaN(durSec) && durSec > 0 ? durSec : NaN;
    }

    if (isNaN(inSec) || isNaN(outSec) || !(outSec > inSec)) {
      return _err('invalid_range',
        'in=' + inSec + ' out=' + outSec + ' dur=' + durSec +
        ' | attempts=' + attempts.join(' / ')
      );
    }

    return _ok({
      projectItemId: String(pi.nodeId),
      path: _mediaPath(pi),
      name: String(pi.name),
      kind: _itemKind(pi),
      inSec: inSec,
      outSec: outSec,
      durationSec: isNaN(durSec) ? null : durSec,
      hadMarks: hadMarks,
      attempts: attempts,
    });
  } catch (e) { return _err('exception', String(e) + ' | attempts=' + attempts.join(' / ')); }
}

// Преобразовать значение времени (TickTime/число/строка) в секунды или NaN.
// Объединённая логика для seq.getInPoint/getOutPoint/playerPosition и QE-аналогов.
function _ptToSec(t) {
  if (t == null) return NaN;
  if (typeof t === 'number') return t;
  if (typeof t === 'string') {
    if (/^-?\d+(\.\d+)?$/.test(t)) { var n = Number(t); if (!isNaN(n)) return n; }
    return NaN;
  }
  if (typeof t === 'object') {
    try {
      if (t.seconds != null) {
        var s = Number(t.seconds);
        if (!isNaN(s)) return s;
      }
    } catch (e) {}
    try {
      if (t.ticks != null) {
        var ticks = Number(t.ticks);
        if (!isNaN(ticks)) return ticks / 254016000000;
      }
    } catch (e) {}
  }
  return NaN;
}

// Найти ТОПОВЫЙ видео-clip в активной sequence, перекрывающий заданную
// секунду на таймлайне. Идём по trackcs сверху вниз: videoTracks[n-1] = верхний
// V_n, videoTracks[0] = V1. Возвращаем {trackIdx, clip} или null.
function _findTopmostVideoClipAt(seq, atSec, attempts) {
  try {
    var n = seq.videoTracks.numTracks;
    for (var t = n - 1; t >= 0; t--) {
      var trk = seq.videoTracks[t];
      if (!trk) continue;
      try { if (trk.isMuted && trk.isMuted()) continue; } catch (e) {}
      for (var c = 0; c < trk.clips.numItems; c++) {
        var cl = trk.clips[c];
        var s = Number(cl.start.seconds);
        var e2 = Number(cl.end.seconds);
        if (atSec >= s && atSec < e2) {
          attempts.push('found:V' + (t+1) + ':' + String(cl.name) + '[' + s.toFixed(3) + '..' + e2.toFixed(3) + ']');
          return { trackIdx: t, clip: cl };
        }
      }
    }
  } catch (ex) { attempts.push('find_clip:' + String(ex)); }
  attempts.push('no_clip_at_sec=' + atSec);
  return null;
}

// Возвращает source-relative секунду playhead'а активной sequence + путь
// к исходному медиа-файлу клипа под playhead'ом. Клиент потом дёргает
// sidecar /extract-frame чтобы извлечь кадр через ffmpeg — это надёжнее
// чем QE DOM, который на части билдов Pr молча возвращает false без файла.
function getTimelineFrameSource() {
  var attempts = [];
  try {
    var seq = app.project.activeSequence;
    if (!seq) return _err('no_active_sequence');
    var ph = seq.getPlayerPosition && seq.getPlayerPosition();
    if (!ph) return _err('no_playhead');
    var phSec = Number(ph.seconds);
    attempts.push('phSec=' + phSec);

    var found = _findTopmostVideoClipAt(seq, phSec, attempts);
    if (!found) return _err('no_clip_at_playhead', 'attempts=' + attempts.join(' | '));

    var pi = found.clip.projectItem;
    if (!pi) return _err('no_project_item');
    var srcPath = _mediaPath(pi);
    if (!srcPath) return _err('no_media_path');

    var clipStart = Number(found.clip.start.seconds);
    var clipInSrc = found.clip.inPoint ? _ptToSec(found.clip.inPoint) : 0;
    if (isNaN(clipInSrc)) clipInSrc = 0;
    var atSec = clipInSrc + Math.max(0, phSec - clipStart);

    return _ok({
      path: srcPath,
      atSec: atSec,
      clipName: String(found.clip.name || pi.name),
      kind: _itemKind(pi),
      attempts: attempts,
    });
  } catch (e) { return _err('exception', String(e) + ' | ' + attempts.join(' | ')); }
}

// Возвращает source-relative in/out + путь к исходнику для клипа на ТАЙМЛАЙНЕ
// под In/Out марками активной sequence. Если марок нет — fallback: целиком
// клип под playhead'ом как он лежит на таймлайне (его in/out на исходнике).
function getTimelineInOutSource() {
  var attempts = [];
  try {
    var seq = app.project.activeSequence;
    if (!seq) return _err('no_active_sequence');

    var seqIn = NaN, seqOut = NaN;

    // Стабильный DOM: seq.getInPoint/getOutPoint (могут вернуть строку timecode
    // или TickTime). Доступно не на всех билдах.
    try {
      if (typeof seq.getInPoint === 'function') {
        var ip = seq.getInPoint();
        seqIn = _ptToSec(ip);
        if (!isNaN(seqIn)) attempts.push('seq.getInPoint=' + seqIn);
      }
    } catch (e) { attempts.push('seq.getInPoint:' + String(e)); }
    try {
      if (typeof seq.getOutPoint === 'function') {
        var op = seq.getOutPoint();
        seqOut = _ptToSec(op);
        if (!isNaN(seqOut)) attempts.push('seq.getOutPoint=' + seqOut);
      }
    } catch (e) { attempts.push('seq.getOutPoint:' + String(e)); }

    // QE fallback — у qe.project.getActiveSequence() обычно тоже есть getInPoint.
    if ((isNaN(seqIn) || isNaN(seqOut)) && _ensureQE()) {
      try {
        var qSeq = qe.project.getActiveSequence();
        if (qSeq) {
          if (isNaN(seqIn) && typeof qSeq.getInPoint === 'function') {
            var qi = qSeq.getInPoint();
            var qis = _ptToSec(qi);
            if (!isNaN(qis)) { seqIn = qis; attempts.push('qe.seq.getInPoint=' + qis); }
          }
          if (isNaN(seqOut) && typeof qSeq.getOutPoint === 'function') {
            var qo = qSeq.getOutPoint();
            var qos = _ptToSec(qo);
            if (!isNaN(qos)) { seqOut = qos; attempts.push('qe.seq.getOutPoint=' + qos); }
          }
        }
      } catch (e) { attempts.push('qe.seq.io:' + String(e)); }
    }

    var hadMarks = !isNaN(seqIn) && !isNaN(seqOut) && seqOut > seqIn;
    var pivotSec;
    if (hadMarks) {
      pivotSec = seqIn + 0.001;
    } else {
      var ph = seq.getPlayerPosition && seq.getPlayerPosition();
      pivotSec = ph ? Number(ph.seconds) : 0;
      attempts.push('no_marks:fallback_to_playhead=' + pivotSec);
    }

    var found = _findTopmostVideoClipAt(seq, pivotSec, attempts);
    if (!found) return _err('no_clip_at_range', 'attempts=' + attempts.join(' | '));

    var pi = found.clip.projectItem;
    if (!pi) return _err('no_project_item');
    var srcPath = _mediaPath(pi);
    if (!srcPath) return _err('no_media_path');

    var clipStart = Number(found.clip.start.seconds);
    var clipEnd = Number(found.clip.end.seconds);
    var clipInSrc = found.clip.inPoint ? _ptToSec(found.clip.inPoint) : 0;
    if (isNaN(clipInSrc)) clipInSrc = 0;
    var clipOutSrc;
    if (found.clip.outPoint) {
      clipOutSrc = _ptToSec(found.clip.outPoint);
      if (isNaN(clipOutSrc)) clipOutSrc = clipInSrc + (clipEnd - clipStart);
    } else {
      clipOutSrc = clipInSrc + (clipEnd - clipStart);
    }

    var rangeIn, rangeOut;
    if (hadMarks) {
      var startInClipSeq = Math.max(seqIn, clipStart);
      var endInClipSeq   = Math.min(seqOut, clipEnd);
      if (endInClipSeq <= startInClipSeq) {
        return _err('marks_outside_clip',
          'seq=[' + seqIn + ',' + seqOut + '] clip=[' + clipStart + ',' + clipEnd + ']');
      }
      rangeIn  = clipInSrc + (startInClipSeq - clipStart);
      rangeOut = clipInSrc + (endInClipSeq   - clipStart);
    } else {
      rangeIn  = clipInSrc;
      rangeOut = clipOutSrc;
    }

    if (!(rangeOut > rangeIn)) {
      return _err('invalid_range', 'in=' + rangeIn + ' out=' + rangeOut);
    }

    return _ok({
      path: srcPath,
      inSec: rangeIn,
      outSec: rangeOut,
      clipName: String(found.clip.name || pi.name),
      kind: _itemKind(pi),
      hadMarks: hadMarks,
      seqIn: seqIn,
      seqOut: seqOut,
      attempts: attempts,
    });
  } catch (e) { return _err('exception', String(e) + ' | ' + attempts.join(' | ')); }
}

// Возвращает source-relative in/out + путь к исходнику для ВЫДЕЛЕННОГО
// видео-клипа на таймлайне (Higgsfield-паттерн "process selected clip").
// В отличие от getTimelineInOutSource не требует выставленных In/Out марок —
// диапазон = ровно тот отрезок исходника, который лежит на таймлайне.
// Если выделено несколько — берём самый верхний (track-wise), затем самый
// ранний. Выделение читаем через clip.isSelected() — оно живёт независимо
// от фокуса панели (в отличие от bin-селекции).
function getSelectedClipSource() {
  var attempts = [];
  try {
    var seq = app.project.activeSequence;
    if (!seq) return _err('no_active_sequence');

    var found = null;
    // Сверху вниз: videoTracks[n-1] = верхний V_n. Первый найденный на более
    // верхнем треке побеждает; внутри трека — более ранний start.
    for (var t = seq.videoTracks.numTracks - 1; t >= 0 && !found; t--) {
      var trk = seq.videoTracks[t];
      if (!trk) continue;
      for (var c = 0; c < trk.clips.numItems; c++) {
        var cl = trk.clips[c];
        try { if (!cl.isSelected()) continue; } catch (e) { continue; }
        if (!found || Number(cl.start.seconds) < Number(found.clip.start.seconds)) {
          found = { trackIdx: t, clip: cl };
        }
      }
    }
    if (!found) return _err('no_selection', 'select a clip on the timeline first');
    attempts.push('selected:V' + (found.trackIdx + 1) + ':' + String(found.clip.name));

    var pi = found.clip.projectItem;
    if (!pi) return _err('no_project_item');
    var srcPath = _mediaPath(pi);
    if (!srcPath) return _err('no_media_path');

    var clipStart = Number(found.clip.start.seconds);
    var clipEnd = Number(found.clip.end.seconds);
    var inSrc = found.clip.inPoint ? _ptToSec(found.clip.inPoint) : 0;
    if (isNaN(inSrc)) inSrc = 0;
    var outSrc;
    if (found.clip.outPoint) {
      outSrc = _ptToSec(found.clip.outPoint);
      if (isNaN(outSrc)) outSrc = inSrc + (clipEnd - clipStart);
    } else {
      outSrc = inSrc + (clipEnd - clipStart);
    }
    if (!(outSrc > inSrc)) return _err('invalid_range', 'in=' + inSrc + ' out=' + outSrc);

    return _ok({
      path: srcPath,
      inSec: inSrc,
      outSec: outSrc,
      clipName: String(found.clip.name || pi.name),
      kind: _itemKind(pi),
      timelineStartSec: clipStart,
      trackIdx: found.trackIdx,
      attempts: attempts,
    });
  } catch (e) { return _err('exception', String(e) + ' | ' + attempts.join(' | ')); }
}

// Вставка ProjectItem на таймлайн активной sequence (Higgsfield-паттерн
// "result drops onto the timeline"). Кладём на первый СВОБОДНЫЙ трек НАД
// самым верхним занятым в точке вставки — это UX «тестируй на дубль-треке»:
// исходник остаётся нетронутым, результат ложится сверху. atSec < 0 (или
// не число) → playhead.
//
// overwriteClip предпочтительнее insertClip: insert сдвигает последующие
// клипы трека (ripple), overwrite — нет. Трек выбираем заранее свободный,
// так что overwrite ничего не затирает. Сигнатуры разнятся по билдам Pr
// (Time object vs seconds number) — перебираем оба варианта с attempts-логом.
function insertToTimeline(projectItemId, atSec) {
  var attempts = [];
  try {
    var seq = app.project.activeSequence;
    if (!seq) return _err('no_active_sequence');
    var pi = _findProjectItemById(projectItemId);
    if (!pi) return _err('not_found', 'projectItemId=' + projectItemId);

    var t0 = Number(atSec);
    if (isNaN(t0) || t0 < 0) {
      var ph = seq.getPlayerPosition && seq.getPlayerPosition();
      t0 = ph ? Number(ph.seconds) : 0;
      attempts.push('at=playhead:' + t0);
    } else {
      attempts.push('at=' + t0);
    }

    // Audio-результаты (Voice TTS) кладём на audioTracks, остальное — на video.
    var kind = _itemKind(pi);
    var lanes = (kind === 'audio') ? seq.audioTracks : seq.videoTracks;

    // Длительность вставляемого медиа — чтобы проверять перекрытие диапазоном,
    // а не точкой. Для статичных картинок Pr подставит default still duration,
    // у ProjectItem.getDuration() в этом случае обычно 0 → берём 5s допуск.
    var durSec = 0;
    try {
      if (pi.getDuration) {
        var d = pi.getDuration();
        durSec = d ? Number(d.seconds != null ? d.seconds : d) : 0;
        if (isNaN(durSec)) durSec = 0;
      }
    } catch (e) { attempts.push('dur:' + String(e)); }
    if (!(durSec > 0)) durSec = 5;
    var t1 = t0 + durSec;

    function trackFreeAt(trk) {
      try {
        for (var c = 0; c < trk.clips.numItems; c++) {
          var cl = trk.clips[c];
          var s = Number(cl.start.seconds);
          var e2 = Number(cl.end.seconds);
          if (s < t1 && e2 > t0) return false;  // overlap
        }
        return true;
      } catch (e) { return false; }
    }

    // Самый верхний занятый трек в точке вставки.
    var topUsed = -1;
    for (var t = lanes.numTracks - 1; t >= 0; t--) {
      if (!trackFreeAt(lanes[t])) { topUsed = t; break; }
    }
    // Первый свободный НАД ним.
    var target = -1;
    for (var u = topUsed + 1; u < lanes.numTracks; u++) {
      var cand = lanes[u];
      var locked = false;
      try { locked = cand.isLocked && cand.isLocked(); } catch (e) {}
      if (!locked && trackFreeAt(cand)) { target = u; break; }
    }
    if (target < 0) {
      return _err('no_free_track',
        'all ' + lanes.numTracks + ' ' + kind + '-tracks busy/locked at ' +
        t0.toFixed(2) + 's — add a track (Sequence > Add Tracks) or move the playhead');
    }
    attempts.push('target=' + (kind === 'audio' ? 'A' : 'V') + (target + 1));

    var trk2 = lanes[target];
    // (method × time-form) перебор. Только НЕдвусмысленные формы: Time-объект
    // (канонический документированный тип) и seconds number. Ticks-СТРОКУ
    // сознательно не используем: билд, трактующий её как секунды, молча
    // вставил бы клип на позицию ~80000 часов.
    var timeForms = [{ tag: 'sec', val: t0 }];
    try {
      var tObj = new Time();
      tObj.seconds = t0;
      timeForms.unshift({ tag: 'Time', val: tObj });
    } catch (e) { attempts.push('Time_ctor:' + String(e)); }

    // После вставки верифицируем позицию: новый клип обязан накрывать t0
    // (с допуском в 0.5s на frame-snapping). Если клип появился, но улетел
    // не туда — формат времени истолкован неверно; откатываем и пробуем
    // следующую форму.
    function newClipNear(trk, before) {
      if (trk.clips.numItems <= before) return null;
      var cl = trk.clips[trk.clips.numItems - 1];
      var s = Number(cl.start.seconds);
      var e2 = Number(cl.end.seconds);
      if (s - 0.5 <= t0 && t0 < e2 + 0.5) return cl;
      return cl ? { misplaced: true, clip: cl, at: s } : null;
    }

    var methods = ['overwriteClip', 'insertClip'];
    for (var m = 0; m < methods.length; m++) {
      var meth = methods[m];
      if (typeof trk2[meth] !== 'function') {
        attempts.push(meth + ':not_function');
        continue;
      }
      for (var f = 0; f < timeForms.length; f++) {
        var tf = timeForms[f];
        var label = meth + '[' + tf.tag + ']';
        try {
          var before = trk2.clips.numItems;
          trk2[meth](pi, tf.val);
          var got = newClipNear(trk2, before);
          if (got && !got.misplaced) {
            attempts.push(label + ':ok');
            return _ok({
              trackLabel: (kind === 'audio' ? 'A' : 'V') + (target + 1),
              atSec: t0,
              attempts: attempts,
            });
          }
          if (got && got.misplaced) {
            attempts.push(label + ':misplaced_at=' + got.at.toFixed(2));
            try { got.clip.remove(false, false); attempts.push(label + ':rolled_back'); }
            catch (er) { attempts.push(label + ':rollback_failed:' + String(er).slice(0, 60)); }
            continue;
          }
          attempts.push(label + ':no_new_clip');
        } catch (e) {
          attempts.push(label + ':' + String(e).replace(/[\r\n]+/g, ' ').slice(0, 80));
        }
      }
    }
    return _err('insert_failed', 'attempts=' + attempts.join(' | '));
  } catch (e) { return _err('exception', String(e) + ' | ' + attempts.join(' | ')); }
}

// QE time может прийти как объект {ticks: "..."}, "HH:MM:SS:FF" строка
// или просто число секунд. Превращаем в секунды (NaN если не получилось).
function _qeTimeToSec(t) {
  if (t == null) return NaN;
  if (typeof t === 'number') return t;
  if (typeof t === 'object') {
    if (typeof t.seconds === 'number') return t.seconds;
    if (typeof t.ticks !== 'undefined') {
      // 1 sec = 254016000000 ticks (Pr internal)
      var ticks = Number(t.ticks);
      if (!isNaN(ticks)) return ticks / 254016000000;
    }
  }
  if (typeof t === 'string') {
    // try "HH:MM:SS:FF" — без знания fps вернём NaN, иначе число
    if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  }
  return NaN;
}

function _binByName(name) {
  for (var i = 0; i < app.project.rootItem.children.numItems; i++) {
    var c = app.project.rootItem.children[i];
    if (c.type === 2 /* bin */ && c.name === name) return c;
  }
  return app.project.rootItem.createBin(name);
}

// NB: ранее тут был ASCII-staging (File.copy кириллических путей в ProgramData).
// Удалён в пользу JS-side sniff'а в saveBlobToDisk: на Windows ExtendScript
// File.copy в бинарном режиме на кириллическом ИСТОЧНИКЕ молча портил байты
// (возвращал true, размер > 0, но содержимое битое), и Pr отбивал
// "Unsupported format or damaged file". При правильном расширении (выставленном
// по magic-байтам на JS-стороне) Pr.importFiles прекрасно ест кириллические
// пути напрямую — staging оказался не нужен.

// Pr's app.project.importFiles is dispatched on the main thread but the actual
// ingest happens asynchronously: the call returns BEFORE the new ProjectItem
// shows up in bin.children. На быстрых машинах задержка ~50-200ms, на медленных
// (особенно при первом импорте PNG в свежем проекте) — до 2-3 секунд. Поэтому
// проверка `bin.children.numItems > before` сразу после вызова даёт ложное
// "no new item" в ~30% случаев. Решение: poll'им с $.sleep до 8 секунд.
//
// Дополнительно: на части билдов Pr игнорирует bin-arg и кладёт импорт в
// rootItem. Поэтому при отсутствии новинки в нашем бине идём по всему дереву
// и ищем ProjectItem чей getMediaPath равен staged-пути.
// Нормализуем путь для сравнения с getMediaPath().
//   Windows: NTFS case-insensitive → toLowerCase + backslash separator.
//   macOS: APFS по умолчанию case-INsensitive (noncasefolding API даёт
//          case-preserving поведение, но сравнение должно игнорировать
//          регистр — иначе при разном casing'е, который Pr приводит
//          непредсказуемо, _findImportedByPath даёт false-negative и
//          выпадает в "import_failed: no new item after 8s poll").
//          На редких case-sensitive APFS-volumes конфликт по case-only
//          именам (Photo.png vs photo.png) даст false-positive, но это
//          гораздо реже, чем дефолтный setup.
//   Linux: ext4 case-sensitive — оставляем как есть (separator only).
function _normPathForCompare(p) {
  if (!p) return '';
  // На Mac getMediaPath() части билдов Pr (AppleScript bridge / старые проекты)
  // возвращает HFS-форму "Macintosh HD:Users:user:file.mov", а targetPath из
  // importToBin приходит POSIX-формой "/Users/...". Без нормализации needle
  // не совпадал с p и _findImportedByPath давал false-negative → "no new item
  // after 8s poll" при успешном на самом деле импорте.
  p = _macToPosix(p);
  if (_isWin()) return String(p).toLowerCase().replace(/\//g, '\\');
  if (_isMac()) return String(p).toLowerCase().replace(/\\/g, '/');
  return String(p).replace(/\\/g, '/');
}

function _findImportedByPath(targetPath) {
  var needle = _normPathForCompare(targetPath);
  if (!needle) return null;
  var stack = [app.project.rootItem];
  while (stack.length) {
    var n = stack.pop();
    for (var i = 0; i < n.children.numItems; i++) {
      var c = n.children[i];
      try {
        if (c.getMediaPath) {
          var p = _normPathForCompare(c.getMediaPath());
          if (p && p === needle) return { item: c, parent: n };
        }
      } catch (e) {}
      if (c.type === 2 /* bin */) stack.push(c);
    }
  }
  return null;
}

// Poll до timeoutMs: ждём пока import материализуется либо в нашем bin'е
// (numItems вырос), либо где угодно в дереве (Pr иногда игнорирует bin-arg).
// Шаг адаптивный: первые ~1.2s каждые 60ms (обычный случай — импорт быстрый),
// дальше 250ms, чтобы не жечь CPU на долгих сетевых/RAW файлах.
function _pollImported(bin, before, path, timeoutMs) {
  var deadline = (new Date().getTime()) + timeoutMs;
  var i = 0;
  while ((new Date().getTime()) < deadline) {
    if (bin.children.numItems > before) {
      return { item: bin.children[bin.children.numItems - 1], binName: 'PhygitalStudio' };
    }
    var hit = _findImportedByPath(path);
    if (hit) {
      return { item: hit.item, binName: String(hit.parent.name || 'root') };
    }
    $.sleep(i < 20 ? 60 : 250);
    i++;
  }
  return null;
}

function importToBin(path) {
  try {
    var bin = _binByName('PhygitalStudio');
    var before = bin.children.numItems;
    app.project.importFiles([path], true, bin, false);

    // importFiles asynchronous-ish: возвращается до того как ProjectItem
    // появится в bin.children. Первая попытка — до 8s. Если пусто —
    // повторяем importFiles (Pr изредка молча дропает вызов, особенно
    // сразу после открытия проекта) и ждём ещё до 7s.
    var found = _pollImported(bin, before, path, 8000);
    if (!found) {
      before = bin.children.numItems;
      app.project.importFiles([path], true, bin, false);
      found = _pollImported(bin, before, path, 7000);
    }
    var pi = found ? found.item : null;
    var foundIn = found ? found.binName : null;

    if (pi) {
      // Прогреваем кэш «по пути» новой записью + сбрасываем мёртвые
      // (importFiles мог переиспользовать какие-то nodeId).
      _piCacheClear();
      try { _piCache[String(pi.nodeId)] = pi; } catch (e) {}
      return _ok({
        projectItemId: String(pi.nodeId),
        binName: foundIn || 'PhygitalStudio',
      });
    }
    return _err('import_failed',
      'no new item after 2 import attempts (8s+7s poll); path=' + path +
      ' bin_before=' + before + ' bin_after=' + bin.children.numItems);
  } catch (e) { return _err('import_failed', String(e) + ' | path=' + path); }
}

// Диагностика API: что реально доступно в этом билде Pr. Возвращаем большой
// JSON с типами методов — клиент рендерит как preformatted текст в toast или
// debug-overlay. Используется для расследования "X is not a function" ошибок.
function diagApis() {
  var info = {};
  try { info.pr_version = String(app.version); } catch (e) { info.pr_version = 'unknown'; }
  try { info.pr_build = String(app.build); } catch (e) {}

  // ── activeSequence ──
  try {
    var s = app.project.activeSequence;
    info.has_active_sequence = !!s;
    if (s) {
      info.seq_apis = {
        exportFrameJPEG: typeof s.exportFrameJPEG,
        exportFramePNG: typeof s.exportFramePNG,
        exportFrameTIFF: typeof s.exportFrameTIFF,
        getPlayerPosition: typeof s.getPlayerPosition,
        getInPoint: typeof s.getInPoint,
        getOutPoint: typeof s.getOutPoint,
      };
      info.seq_name = String(s.name);
    }
  } catch (e) { info.seq_err = String(e); }

  // ── QE DOM ──
  info.has_enableQE = typeof app.enableQE === 'function';
  try {
    var qeOK = _ensureQE();
    info.qe_available = qeOK;
    if (qeOK) {
      try {
        var qs = qe.project.getActiveSequence();
        info.qe_seq = !!qs;
        if (qs) info.qe_seq_apis = {
          exportFrameJPEG: typeof qs.exportFrameJPEG,
          exportFramePNG: typeof qs.exportFramePNG,
          exportFrameTIFF: typeof qs.exportFrameTIFF,
          exportFrameTarga: typeof qs.exportFrameTarga,
          exportFrameDPX: typeof qs.exportFrameDPX,
        };
      } catch (e) { info.qe_seq_err = String(e); }
      try {
        var qsrc = qe.source;
        info.qe_source = !!qsrc;
        if (qsrc) info.qe_source_apis = {
          getInPoint: typeof qsrc.getInPoint,
          getOutPoint: typeof qsrc.getOutPoint,
          getPosition: typeof qsrc.getPosition,
        };
      } catch (e) { info.qe_source_err = String(e); }
    }
  } catch (e) { info.qe_err = String(e); }

  // ── Source Monitor ──
  try {
    var sm = app.sourceMonitor;
    info.has_source_monitor = !!sm;
    if (sm) {
      info.sm_apis = {
        getProjectItem: typeof sm.getProjectItem,
        getPosition: typeof sm.getPosition,
        openProjectItem: typeof sm.openProjectItem,
      };
      var pi = null;
      try { pi = sm.getProjectItem(); } catch (e) {}
      info.sm_has_clip = !!pi;
      if (pi) {
        info.sm_pi_apis = {
          getInPoint: typeof pi.getInPoint,
          getOutPoint: typeof pi.getOutPoint,
          getDuration: typeof pi.getDuration,
          getMediaPath: typeof pi.getMediaPath,
          nodeId: typeof pi.nodeId,
        };
        try { info.sm_pi_name = String(pi.name); } catch (e) {}
      }
    }
  } catch (e) { info.sm_err = String(e); }

  return _ok(info);
}

// Pr has no first-class "reveal in bin" API. Best-effort:
//   1. Find the project item by nodeId.
//   2. Select it (pi.select(true)) — this highlights it in the Project panel.
//   3. The Project panel still needs to be the active view for the user to see
//      the highlight. We can't programmatically switch panels, so we return the
//      bin name so the panel UI can hint the user where to look.
function revealInBin(projectItemId) {
  try {
    var pi = _findProjectItemById(projectItemId);
    if (!pi) return _err('not_found');
    if (pi.select) {
      try { pi.select(true); } catch (e2) { /* select API absent in older Pr */ }
    }
    var binName = null;
    try {
      // Walk up by treeNodeID — there's no parent ref, so search the tree.
      var stack = [app.project.rootItem];
      while (stack.length) {
        var n = stack.pop();
        for (var i = 0; i < n.children.numItems; i++) {
          var c = n.children[i];
          if (String(c.nodeId) === String(projectItemId)) { binName = String(n.name); break; }
          if (c.type === 2 /* bin */) stack.push(c);
        }
        if (binName) break;
      }
    } catch (e3) {}
    return _ok({ projectItemId: String(pi.nodeId), binName: binName, name: String(pi.name) });
  } catch (e) { return _err('reveal_failed', String(e)); }
}
