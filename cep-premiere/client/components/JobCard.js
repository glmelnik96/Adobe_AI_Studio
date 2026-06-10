import { html } from '../lib/html.js';
import { useState, useEffect, useRef } from '../vendor/preact-hooks.module.js';
import { fmtDuration, jobAgeMs } from '../lib/format.js';
import { NANO_BANANA_META, GPT_IMAGE_META, TOPAZ_META, VOICE_TTS_META } from '../lib/slot_schema.js';
import { localPathToFileUrl, isRenderableImagePath, isAudioPath } from '../lib/disk_save.js';
import { toast } from '../lib/toast.js';

const STATUS_CLS = {
  queued: 'q', running: 'r', completed: 'ok', failed: 'fail', canceled: 'fail',
};

const SCENARIO_LABELS = {
  start_prompt:           'Start frame + prompt',
  start_end_prompt:       'Start + end frame',
  ref_prompt:             'Reference + prompt',
  ref_prompt_video:       'Reference image + reference video',
  elements_prompt:        'Elements + prompt',
  elements_prompt_video:  'Elements + driving video',
  char_video_prompt:      'Character + driving video',
  edit:                   'Image edit',
};

function modelLabel(node_id, videoNodes) {
  if (node_id === NANO_BANANA_META.node_id) return NANO_BANANA_META.model;
  if (node_id === GPT_IMAGE_META.node_id) return GPT_IMAGE_META.model;
  if (node_id === TOPAZ_META.node_id) return TOPAZ_META.model;
  if (node_id === VOICE_TTS_META.node_id) return VOICE_TTS_META.model;
  const m = (videoNodes || []).find(n => n.node_id === node_id);
  return m ? m.model : `node ${node_id}`;
}

// Lazy-load hook: ставим src миниатюре только когда карточка приближается к
// viewport (rootMargin 200px). History из 50 джобов иначе декодирует 50
// изображений сразу. Fallback: нет IntersectionObserver → грузим сразу.
export function useLazyVisible() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (visible) return undefined;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (en.isIntersecting) { setVisible(true); io.disconnect(); return; }
      }
    }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);
  return [ref, visible];
}

// Click-outside hook for the ⋯ overflow menu.
function useDismissOnOutside(open, onClose) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return ref;
}

export function JobCard({ job, videoNodes, onAction }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useDismissOnOutside(menuOpen, () => setMenuOpen(false));
  const [thumbRef, thumbVisible] = useLazyVisible();

  const cls = STATUS_CLS[job.status] || 'q';
  const age = fmtDuration(jobAgeMs(job));
  const prog = Math.round((job.progress || 0) * 100);
  const params = job.params || {};
  const scenario = params.scenario || params.scenario_value;
  const scenLabel = SCENARIO_LABELS[scenario] || scenario;
  // params.text — для node 89 (Voice TTS), хранится отдельно от prompt.
  const prompt = params.prompt || params.text_prompt || params.text || '';
  const model = modelLabel(job.node_id, videoNodes);
  const isDone = job.status === 'completed';
  const isFailed = job.status === 'failed' || job.status === 'canceled';
  // Retry показываем для completed/failed/canceled — любой завершённый job
  // (где есть сохранённые params) может быть переиспользован как шаблон.
  // Не показываем для queued/running/etc — там пользователь и так ждёт.
  const canRetry = (isDone || isFailed) && (params.prompt || params.text_prompt || params.text || params.scenario);
  const [promptExpanded, setPromptExpanded] = useState(false);

  async function copyPrompt() {
    if (!prompt) return;

    // CEP iframe — не secure context: navigator.clipboard.writeText() есть, но
    // бросает "Write permission denied". Поэтому сначала пробуем синхронный
    // execCommand (он работает в CEP без permission gate, хоть и deprecated),
    // и только если он не сработал — clipboard API. Так fallback реально нужен.
    function execCopy(text) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      const prevActive = document.activeElement;
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, text.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      document.body.removeChild(ta);
      if (prevActive && typeof prevActive.focus === 'function') {
        try { prevActive.focus(); } catch (_) {}
      }
      return ok;
    }

    if (execCopy(prompt)) {
      toast.success('Prompt copied');
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(prompt);
        toast.success('Prompt copied');
        return;
      }
    } catch (_) { /* clipboard API в CEP часто denied — это норма */ }
    toast.error('Copy failed — clipboard blocked in this CEP context');
  }

  return html`
    <div class=${`job-card ${cls}`}>
      <div class="job-head">
        <div class="job-title-row">
          <span class="job-title" title=${`node_id=${job.node_id}`}>${model}</span>
          ${scenLabel ? html`<span class="job-scenario">${scenLabel}</span>` : null}
        </div>
        <span class="job-age" title=${`job_id=${job.job_id}`}>${age}</span>
      </div>
      ${prompt ? html`
        <div class=${`job-prompt${promptExpanded ? ' expanded' : ''}`}
             title=${promptExpanded ? 'Click to collapse' : prompt}
             onClick=${() => setPromptExpanded(e => !e)}>${prompt}</div>
      ` : null}
      <div class="job-status">
        ${job.status}${job.status === 'running' ? ` · ${prog}%` : ''}
      </div>
      ${job.error ? html`<div class="job-error" title=${job.error}>${job.error}</div>` : null}
      ${(() => {
        // Приоритет blob > file://. После reload blob мёртв, но localPath из
        // persisted кэша → file://. Video-форматы не пытаемся отрендерить.
        // Audio (Voice TTS) — <audio controls>, плеер с tap-to-play.
        // Изображения лениво: src ставим только около viewport (useLazyVisible).
        if (job.localPath && isAudioPath(job.localPath)) {
          return html`<audio class="job-audio" controls preload="metadata"
                              src=${localPathToFileUrl(job.localPath)} />`;
        }
        const imgSrc = job.resultBlobUrl
          ? job.resultBlobUrl
          : (job.localPath && isRenderableImagePath(job.localPath)
              ? localPathToFileUrl(job.localPath) : null);
        if (imgSrc) {
          return html`<div class="job-thumb-wrap" ref=${thumbRef}>
            ${thumbVisible ? html`<img class="job-thumb" src=${imgSrc} alt="" />` : null}
          </div>`;
        }
        return null;
      })()}
      <div class="job-actions">
        ${isDone ? html`
          <button class="primary-soft" title="Drop the result onto a free track above at the playhead"
                  onClick=${() => onAction('insert', job)}>To timeline</button>
          <button onClick=${() => onAction('show', job)}>Show in bin</button>
          <button onClick=${() => onAction('download', job)}>Download</button>
        ` : null}
        ${canRetry
          ? html`<button class="primary-soft" title="Restore form with this job's params"
                         onClick=${() => onAction('retry', job)}>↻ Retry</button>`
          : null}
        ${prompt
          ? html`<button title="Copy prompt to clipboard" onClick=${copyPrompt}>📋 Copy prompt</button>`
          : null}
        <div class="job-menu" ref=${menuRef}>
          <button class="job-menu-btn" title="More" onClick=${() => setMenuOpen(o => !o)}>⋯</button>
          ${menuOpen ? html`
            <div class="job-menu-pop">
              <div class="job-menu-item danger" onClick=${() => { setMenuOpen(false); onAction('delete', job); }}>Delete</div>
            </div>
          ` : null}
        </div>
      </div>
    </div>
  `;
}
