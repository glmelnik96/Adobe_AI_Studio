export function createToastManager({ max = 3 } = {}) {
  const toasts = [];
  const listeners = new Set();
  let nextId = 1;

  function notify() {
    const snap = toasts.slice();
    for (const l of listeners) l(snap);
  }

  function add(level, message, duration) {
    const t = { id: nextId++, level, message, duration };
    toasts.push(t);
    while (toasts.length > max) toasts.shift();
    notify();
    if (duration > 0) {
      setTimeout(() => {
        const i = toasts.findIndex(x => x.id === t.id);
        if (i >= 0) { toasts.splice(i, 1); notify(); }
      }, duration);
    }
    return t.id;
  }

  return {
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    success(msg, duration = 3000) { return add('success', msg, duration); },
    warning(msg, duration = 5000) { return add('warning', msg, duration); },
    error(msg, duration = 8000) { return add('error', msg, duration); },
    dismiss(id) {
      const i = toasts.findIndex(x => x.id === id);
      if (i >= 0) { toasts.splice(i, 1); notify(); }
    },
  };
}

export const toast = createToastManager();
