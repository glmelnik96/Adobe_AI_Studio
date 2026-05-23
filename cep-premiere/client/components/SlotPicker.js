import { html } from '../lib/html.js';

function thumbFor(item) {
  if (item.thumb) return html`<img class="slot-thumb" src=${item.thumb} alt="" />`;
  return html`<div class="slot-thumb placeholder"></div>`;
}

// Видео-слоты: ref_vid (Seedance), video (Omni / Motion).
// Всё остальное обрабатываем как image-слот.
function isVideoSlot(name) {
  return /^(ref_vid|video)$/.test(name);
}

export function SlotPicker({ name, kind, value, onPick, onClear }) {
  const items = kind === 'array' ? (value || []) : (value ? [value] : []);
  const canAddMore = kind === 'array' || items.length === 0;
  const videoSlot = isVideoSlot(name);

  return html`
    <div class="slot">
      <div class="slot-head">
        <span class="slot-name">${name}</span>
        <span class="slot-kind">(${videoSlot ? 'video' : 'image'} ${kind})</span>
      </div>
      <div class="slot-sources">
        <button title=${videoSlot ? 'Browse video file (mp4/mov/mkv/…)' : 'Browse image file (jpg/png/tif/…)'}
                onClick=${() => onPick && onPick('disk')} disabled=${!canAddMore}>Browse...</button>
        <button title=${videoSlot ? 'Pick selected video from Project bin' : 'Pick selected image from Project bin'}
                onClick=${() => onPick && onPick('bin')}>Bin</button>
        <button title=${videoSlot ? 'Pick video clip at playhead from active sequence' : 'Pick image clip at playhead from active sequence'}
                onClick=${() => onPick && onPick('timeline')}>Timeline clip</button>
        ${videoSlot
          ? html`<button title="Use Timeline In/Out marks on the active sequence; ffmpeg clips the topmost video clip locally"
                          onClick=${() => onPick && onPick('timeline_io')}>Timeline In/Out</button>`
          : html`<button title="Grab the still under the playhead from the topmost clip in the active sequence (via ffmpeg)"
                          onClick=${() => onPick && onPick('timeline_frame')}>Timeline frame</button>`}
      </div>
      ${items.length === 0
        ? html`<div class="slot-empty">No file</div>`
        : items.map(it => html`
          <div class="slot-item">
            ${thumbFor(it)}
            <div class="slot-item-meta">
              <div class="slot-item-name">${it.name}</div>
              <div class="slot-item-sub">
                ${it.asset && it.asset.width ? `${it.asset.width}×${it.asset.height}` : ''}
                ${it.cached ? html`<span class="slot-cached">cached</span>` : ''}
              </div>
            </div>
            <button onClick=${() => onClear && onClear(it)}>×</button>
          </div>
        `)}
    </div>
  `;
}
