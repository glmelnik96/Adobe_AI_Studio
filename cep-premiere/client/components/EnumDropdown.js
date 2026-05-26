import { html } from '../lib/html.js';
import { useState, useEffect, useRef, useLayoutEffect } from '../vendor/preact-hooks.module.js';

// Кастомный enum dropdown для CEP-панелей.
//
// Why custom: нативный <select> в Chromium внутри CEP рендерит popup
// OS-level, и при маленьком окне панели popup обрезается её границами —
// пользователь не может выбрать опцию (issue #1).
//
// Решение: popup живёт в DOM панели (`position: fixed`, координаты
// считаем от getBoundingClientRect триггера), не выходит за viewport,
// при overflow внутри popup'а — внутренний скролл (max-height).
//
// Контракт:
//   options: array of { value, label } | array of primitives (auto-wrapped)
//   value:   currently selected value (compared via Object.is)
//   onChange: (newValue) => void
//   placeholder: string (когда value не матчится ни с одной опцией)
export function EnumDropdown({ options, value, onChange, placeholder = '— select —' }) {
  const normalized = (options || []).map(o =>
    (typeof o === 'object' && o !== null && 'value' in o)
      ? { value: o.value, label: o.label != null ? String(o.label) : String(o.value) }
      : { value: o, label: String(o)}
  );

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState({ left: 0, top: 0, width: 100 });
  const triggerRef = useRef(null);
  const popupRef = useRef(null);

  const selected = normalized.find(o => Object.is(o.value, value));
  const currentLabel = selected ? selected.label : placeholder;

  // Пересчитываем координаты popup'a относительно триггера в момент открытия
  // и при resize. position: fixed позволяет popup'у не зависеть от ancestor
  // overflow:hidden (например, .tab-body со скроллом).
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return undefined;
    function place() {
      const rect = triggerRef.current.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      // По умолчанию popup открывается ВНИЗ. Если снизу <120px, флипаем вверх.
      const spaceBelow = vh - rect.bottom;
      const spaceAbove = rect.top;
      const flipUp = spaceBelow < 120 && spaceAbove > spaceBelow;
      const maxH = Math.min(240, Math.max(80, flipUp ? spaceAbove - 8 : spaceBelow - 8));
      setCoords({
        left: rect.left,
        top: flipUp ? rect.top - maxH - 2 : rect.bottom + 2,
        width: rect.width,
        maxHeight: maxH,
      });
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true); // true = capture, ловим скролл любых ancestor'ов
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Закрытие по клику вне popup'а и Esc.
  useEffect(() => {
    if (!open) return undefined;
    function onMouseDown(e) {
      if (popupRef.current && popupRef.current.contains(e.target)) return;
      if (triggerRef.current && triggerRef.current.contains(e.target)) return;
      setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function pick(v) {
    setOpen(false);
    if (!Object.is(v, value)) onChange(v);
  }

  const popupStyle = {
    left: `${coords.left}px`,
    top: `${coords.top}px`,
    width: `${coords.width}px`,
    maxHeight: `${coords.maxHeight || 200}px`,
  };

  return html`
    <div class="edrop">
      <button type="button" class=${`edrop-trigger${open ? ' open' : ''}`}
              ref=${triggerRef}
              onClick=${() => setOpen(o => !o)}>
        <span class="edrop-label">${currentLabel}</span>
        <span class="edrop-caret">${open ? '▲' : '▼'}</span>
      </button>
      ${open ? html`
        <div class="edrop-popup" ref=${popupRef} style=${popupStyle}>
          ${normalized.length === 0
            ? html`<div class="edrop-empty">No options</div>`
            : normalized.map(o => html`
                <div class=${`edrop-item${Object.is(o.value, value) ? ' selected' : ''}`}
                     onClick=${() => pick(o.value)}>${o.label}</div>
              `)}
        </div>
      ` : null}
    </div>
  `;
}
