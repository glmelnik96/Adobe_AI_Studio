/*
 * Phygital Studio — After Effects ExtendScript host.
 * SCAFFOLD ONLY. Реализация — Phase 3 (см. ../../docs/ROADMAP.md).
 *
 * Контракт — ../../docs/ARCHITECTURE.md, "ExtendScript-контракт (panel → host)".
 *
 * TODO Phase 3:
 *   function phygitalStudio_importAndAdd(argsJSON) {
 *     var args = JSON.parse(argsJSON);  // { filePath, compName, timeSec, duration }
 *     var io = new ImportOptions(File(args.filePath));
 *     var footage = app.project.importFile(io);
 *     var comp = args.compName ? findCompByName(args.compName) : app.project.activeItem;
 *     if (!(comp instanceof CompItem)) throw new Error("No active composition");
 *     var layer = comp.layers.add(footage, args.duration || footage.duration);
 *     layer.startTime = (args.timeSec < 0) ? comp.time : args.timeSec;
 *     return JSON.stringify({ ok: true, footageId: footage.id, layerIndex: layer.index });
 *   }
 *
 * Подводные камни:
 *   - importFile может бросить если файл не поддерживается AE (rare для MP4/PNG).
 *   - activeItem может быть FolderItem / FootageItem, проверять instanceof CompItem.
 *   - Для image footage у item.duration === 0; задавать duration явно (например 5с).
 *   - app.beginUndoGroup / endUndoGroup чтобы вся операция была одним Ctrl+Z.
 */

function phygitalStudio_ping() {
    return JSON.stringify({ ok: true, scaffold: true, host: "AEFT" });
}
