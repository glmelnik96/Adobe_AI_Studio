import { html } from '../lib/html.js';
import { useEffect } from '../vendor/preact-hooks.module.js';
import { ModelPicker } from './ModelPicker.js';
import { ScenarioPicker } from './ScenarioPicker.js';
import { PromptInput } from './PromptInput.js';
import { SlotList } from './SlotList.js';
import { ParamsAccordion } from './ParamsAccordion.js';
import { CostBar } from './CostBar.js';
import { SubmitButton } from './SubmitButton.js';
import { listAllNodes, getNodeMeta, getSlotsForScenario } from '../lib/slot_schema.js';
import { saveDraftToStorage, createUploadActions } from '../lib/state.js';
import { pickFilesFromDisk, readFileAsBlob, makeThumbDataURL } from '../lib/disk.js';
import { host, hostQueued } from '../lib/host.js';
import { toast } from '../lib/toast.js';

const uploadActions = createUploadActions(null);

function isImageSlotName(name) {
  // Heuristic by spec §3.3 slot map. Image slots are: init_img, image_tail,
  // element_*, start_img, end_frame, ref_img, first_frame, last_frame, char_ref.
  // Non-image: ref_vid, ref_audio, video.
  return !/^(ref_vid|ref_audio|video)$/.test(name);
}

function isVideoSlotName(name) {
  return /^(ref_vid|video)$/.test(name);
}

export function GenerateTab({ snap, actions, api, store, onSubmitted }) {
  const { draft, videoNodes, health } = snap;
  const allNodes = listAllNodes({ videoNodes });
  const meta = getNodeMeta({ videoNodes, nodeId: draft.model_id });
  const scenarios = meta ? meta.scenarios : [];
  const slots = getSlotsForScenario({ videoNodes, nodeId: draft.model_id, scenario: draft.scenario });

  useEffect(() => { saveDraftToStorage(draft); }, [JSON.stringify(draft)]);

  async function ingestPath(slot, path, source, displayName) {
    const name = displayName || path.split(/[\\/]/).pop();
    const blob = await readFileAsBlob(path);
    const thumb = await makeThumbDataURL(blob).catch(() => null);
    const item = { source, path, name, thumb };
    if (slot.kind === 'array') {
      const cur = store.get().draft.slots[slot.name] || [];
      actions.setSlot(slot.name, [...cur, item]);
    } else {
      actions.setSlot(slot.name, item);
    }
    try {
      const { entry, cached } = await uploadActions.upload({ api, blob, filename: name });
      const enriched = { ...item, asset: entry, cached };
      if (slot.kind === 'array') {
        const cur2 = (store.get().draft.slots[slot.name] || []).map(x => x.path === path ? enriched : x);
        actions.setSlot(slot.name, cur2);
      } else actions.setSlot(slot.name, enriched);
    } catch (e) {
      const err = { ...item, error: e.message };
      if (slot.kind === 'array') {
        const cur2 = (store.get().draft.slots[slot.name] || []).map(x => x.path === path ? err : x);
        actions.setSlot(slot.name, cur2);
      } else actions.setSlot(slot.name, err);
      toast.error('Upload failed: ' + e.message);
    }
  }

  async function onPick(slot, source) {
    const isImageSlot = isImageSlotName(slot.name);
    const isVideoSlot = isVideoSlotName(slot.name);
    try {
      // 1) Disk picker — общий для image и video.
      if (source === 'disk') {
        const paths = await pickFilesFromDisk({ multi: slot.kind === 'array' });
        if (!paths || paths.length === 0) return;
        for (const p of paths) await ingestPath(slot, p, 'disk');
        return;
      }

      // 2) Image-only: «Timeline frame» — экспорт кадра под playhead'ом активной sequence.
      if (source === 'timeline_frame') {
        if (!isImageSlot) {
          toast.warning('Timeline frame works only for image slots');
          return;
        }
        let fr;
        try {
          fr = await host.exportTimelineFrame();
        } catch (e) {
          const reason = (e.result && e.result.reason) || e.message;
          toast.error('Timeline frame export failed: ' + reason);
          return;
        }
        await ingestPath(slot, fr.framePath, 'timeline_frame', `frame_${Date.now()}.jpg`);
        return;
      }

      // 3) Video-only: «Source In/Out» — взять клип из Source Monitor с его I/O марками,
      //    локально через ffmpeg вырезать фрагмент, отдать в обычный upload flow.
      if (source === 'source_io') {
        if (!isVideoSlot) {
          toast.warning('Source In/Out works only for video slots');
          return;
        }
        let io;
        try {
          io = await host.getSourceInOut();
        } catch (e) {
          const reason = (e.result && e.result.reason) || e.message;
          toast.error('Source pick failed: ' + reason);
          return;
        }
        let clip;
        try {
          clip = await api.clipVideo({
            source_path: io.path,
            in_sec: Number(io.inSec),
            out_sec: Number(io.outSec),
          });
        } catch (e) {
          const detail = (e.body && e.body.detail) || {};
          const reason = detail.hint || detail.error || e.message || 'unknown';
          toast.error('ffmpeg clip failed: ' + reason);
          return;
        }
        const displayName = `${io.name || 'clip'}_${Number(io.inSec).toFixed(2)}-${Number(io.outSec).toFixed(2)}.mp4`;
        await ingestPath(slot, clip.path, 'source_io', displayName);
        return;
      }

      // 4) Generic bin / timeline / source_monitor picks. Auto-frame-extract убран —
      //    для image-слотов из видео-клипа теперь явный пункт «Timeline frame».
      let pickResult = null;
      if (source === 'bin')                   pickResult = await host.getBinSelection();
      else if (source === 'timeline')         pickResult = await host.getTimelineSelection(true);
      else if (source === 'source_monitor')   pickResult = await host.getSourceMonitorItem();
      if (!pickResult) return;

      const items = pickResult.items || (pickResult.item ? [pickResult.item] : []);
      for (const it of items) {
        if (isImageSlot && it.kind === 'video') {
          toast.warning('Video clip on image slot — use "Timeline frame" or "Browse..." for a still');
          continue;
        }
        if (isVideoSlot && it.kind !== 'video') {
          toast.warning(`Slot "${slot.name}" needs a video, got ${it.kind}`);
          continue;
        }
        await ingestPath(slot, it.path, source, it.name);
      }
    } catch (e) {
      toast.error('Source pick failed: ' + e.message);
    }
  }

  function onClear(slot, item) {
    if (slot.kind === 'array') {
      const cur = draft.slots[slot.name] || [];
      const next = cur.filter(x => x !== item);
      if (next.length === 0) actions.clearSlot(slot.name);
      else actions.setSlot(slot.name, next);
    } else {
      actions.clearSlot(slot.name);
    }
  }

  const disabled = health.status !== 'online';

  return html`
    <div class=${`generate ${disabled ? 'disabled' : ''}`}>
      <${ModelPicker} nodes=${allNodes} value=${draft.model_id}
        onChange=${id => actions.setModel(id, { videoNodes })} />
      <${ScenarioPicker} scenarios=${scenarios} value=${draft.scenario}
        onChange=${s => actions.setScenario(s, { videoNodes })} />
      <${PromptInput} value=${draft.prompt} onChange=${actions.setPrompt} />
      <${SlotList} slots=${slots} values=${draft.slots}
        onPick=${onPick} onClear=${onClear} />
      <${ParamsAccordion} defaults=${meta ? meta.default_params : {}}
        options=${meta ? meta.param_options : {}}
        values=${draft.params} onChange=${actions.setParam} />
      <${CostBar} snap=${snap} api=${api} store=${store} />
      <${SubmitButton} snap=${snap} api=${api} onSubmitted=${onSubmitted} />
    </div>
  `;
}
