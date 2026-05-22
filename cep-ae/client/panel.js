/*
 * Phygital Studio — After Effects CEP panel.
 * SCAFFOLD ONLY. Реализация — Phase 3 (см. docs/ROADMAP.md).
 *
 * Контракт sidecar HTTP — docs/ARCHITECTURE.md.
 * Контракт ExtendScript — docs/ARCHITECTURE.md, секция "ExtendScript-контракт".
 */

(function () {
  'use strict';

  // TODO Phase 3:
  //   - new CSInterface() и evalScript для phygitalStudio_importAndAdd
  //   - fetch('http://127.0.0.1:8765/health') на старте
  //   - UI: пресеты (Sora/VEO/Runway/Nano Banana), prompt, кнопка Generate
  //   - on completed → GET /jobs/{id}/download → temp → evalScript на host
  //   - очередь + persistence в localStorage

  console.log('[PhygitalStudio AE] panel.js loaded (scaffold)');
})();
