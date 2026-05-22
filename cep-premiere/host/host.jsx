// Phygital Studio — Pr ExtendScript host.
// Public API (all return JSON.stringify({ok, ...})):
//   getBinSelection()
//   getTimelineSelection(playheadOnly)
//   getSourceMonitorItem()
//   exportTimelineFrame()        — JPG из активной sequence на playhead'е
//   getSourceInOut()              — клип в Source Monitor + его In/Out marks
//   importToBin(path)
//   revealInBin(projectItemId)
//
// All paths are absolute. Functions never throw — wrap in try/catch and
// return {ok:false, error}.

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
  try {
    if (pi.getMediaPath) {
      var p = String(pi.getMediaPath() || '');
      var ext = p.split('.').pop().toLowerCase();
      if (['mp4','mov','avi','mkv','m4v','mxf'].indexOf(ext) >= 0) return 'video';
      if (['jpg','jpeg','png','tif','tiff','psd','heic'].indexOf(ext) >= 0) return 'image';
      if (['wav','mp3','aac','aiff'].indexOf(ext) >= 0) return 'audio';
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

function _findProjectItemById(id) {
  // ProjectItem doesn't expose stable id. Use nodeId.
  var stack = [app.project.rootItem];
  while (stack.length) {
    var n = stack.pop();
    for (var i = 0; i < n.children.numItems; i++) {
      var c = n.children[i];
      if (String(c.nodeId) === String(id)) return c;
      if (c.type === 2 /* bin */) stack.push(c);
    }
  }
  return null;
}

function getBinSelection() {
  try {
    var sel = app.project.getSelection ? app.project.getSelection() : null;
    if (!sel || sel.length === 0) return _err('no_selection');
    var items = [];
    for (var i = 0; i < sel.length; i++) {
      var pi = sel[i];
      var kind = _itemKind(pi);
      if (['video','image','audio'].indexOf(kind) < 0) continue;
      items.push({
        projectItemId: String(pi.nodeId),
        path: String(pi.getMediaPath()),
        name: String(pi.name),
        kind: kind,
      });
    }
    if (items.length === 0) return _err('unsupported_kind');
    return _ok({ items: items });
  } catch (e) { return _err('exception', String(e)); }
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
      items.push({
        projectItemId: String(pi.nodeId),
        path: String(pi.getMediaPath ? pi.getMediaPath() : ''),
        name: String(clip.name),
        kind: kind,
        in_sec: inSec,
        out_sec: outSec,
      });
      return true;
    }
    for (var t = 0; t < seq.videoTracks.numTracks; t++) {
      var trk = seq.videoTracks[t];
      for (var c = 0; c < trk.clips.numItems; c++) {
        var clip = trk.clips[c];
        if (playheadOnly || clip.isSelected()) clipAt(trk, clip);
      }
    }
    if (items.length === 0) {
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
      path: String(pi.getMediaPath()),
      name: String(pi.name),
      kind: _itemKind(pi),
    }});
  } catch (e) { return _err('exception', String(e)); }
}

function _tmpDir() {
  // %TEMP% or system temp. CEP exposes via Folder.temp.
  var d = Folder.temp.fsName + '/PhygitalStudio_frames';
  var f = new Folder(d);
  if (!f.exists) f.create();
  return d;
}

// Экспортирует кадр из активной sequence на текущей позиции playhead'а.
// Это и есть «то что юзер видит в превью таймлайна».
// API: Sequence.exportFrameJPEG(outputPath) — единственный аргумент (Time
// объекта быть НЕ должно, иначе Pr бросает "Not Enough Parameters").
function exportTimelineFrame() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return _err('no_active_sequence');
    var ph = seq.getPlayerPosition();
    var phSec = ph ? Number(ph.seconds) : 0;
    var outPath = _tmpDir() + '/frame_' + (new Date().getTime()) + '_' + Math.floor(Math.random() * 1e6) + '.jpg';
    seq.exportFrameJPEG(outPath);
    var f = new File(outPath);
    if (!f.exists) return _err('export_failed', 'file_not_created');
    return _ok({ framePath: outPath, timecode: String(phSec), sequenceName: String(seq.name) });
  } catch (e) { return _err('export_failed', String(e)); }
}

// Source Monitor → клип + его In/Out marks (как секунды).
// Если In/Out не выставлены — отдаём 0..duration (весь клип).
function getSourceInOut() {
  try {
    var sm = app.sourceMonitor;
    if (!sm) return _err('no_source_monitor');
    var pi = sm.getProjectItem ? sm.getProjectItem() : null;
    if (!pi) return _err('no_source_monitor_clip');

    // ProjectItem.getInPoint(mediaType)/getOutPoint(mediaType) — Pr 22+.
    // mediaType: 1=video, 2=audio. Возвращают TickTime (.seconds).
    var inSec = 0;
    var outSec = 0;
    var durSec = 0;
    try {
      if (pi.getDuration) {
        var dur = pi.getDuration();
        durSec = dur ? Number(dur.seconds || dur) : 0;
      }
    } catch (_e1) {}
    try {
      if (pi.getInPoint) {
        var t1 = pi.getInPoint(1);
        if (t1 && typeof t1.seconds !== 'undefined') inSec = Number(t1.seconds);
      }
    } catch (_e2) {}
    try {
      if (pi.getOutPoint) {
        var t2 = pi.getOutPoint(1);
        if (t2 && typeof t2.seconds !== 'undefined') outSec = Number(t2.seconds);
      }
    } catch (_e3) {}

    // Sanity: если In==Out или Out<=In — считаем что marks не выставлены, берём весь клип
    if (!(outSec > inSec)) {
      inSec = 0;
      outSec = durSec > 0 ? durSec : 0;
    }
    if (!(outSec > inSec)) {
      return _err('invalid_range', 'in=' + inSec + ' out=' + outSec + ' dur=' + durSec);
    }

    return _ok({
      projectItemId: String(pi.nodeId),
      path: String(pi.getMediaPath ? pi.getMediaPath() : ''),
      name: String(pi.name),
      kind: _itemKind(pi),
      inSec: inSec,
      outSec: outSec,
      durationSec: durSec,
    });
  } catch (e) { return _err('exception', String(e)); }
}

function _binByName(name) {
  for (var i = 0; i < app.project.rootItem.children.numItems; i++) {
    var c = app.project.rootItem.children[i];
    if (c.type === 2 /* bin */ && c.name === name) return c;
  }
  return app.project.rootItem.createBin(name);
}

function importToBin(path) {
  try {
    var bin = _binByName('PhygitalStudio');
    var before = bin.children.numItems;
    app.project.importFiles([path], true, bin, false);
    if (bin.children.numItems > before) {
      var pi = bin.children[bin.children.numItems - 1];
      return _ok({ projectItemId: String(pi.nodeId), binName: 'PhygitalStudio' });
    }
    return _err('import_failed', 'no new item');
  } catch (e) { return _err('import_failed', String(e)); }
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
