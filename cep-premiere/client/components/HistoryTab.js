import { html } from '../lib/html.js';
import { useState, useMemo, useEffect } from '../vendor/preact-hooks.module.js';
import { toast } from '../lib/toast.js';
import { JobFilter } from './JobFilter.js';
import { JobList } from './JobList.js';

// Compact byte formatter: 1024 → "1.0 KB", 1.5e6 → "1.4 MB".
function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

// Кнопка очистки disk-cache живёт в History (а не в Header) по запросу:
// в Header только один значок без подписи был неочевиден; в History
// рядом со списком job'ов уместен подробный label с количеством и размером.
function DiskCacheButton({ api }) {
  const [usage, setUsage] = useState(null); // {count, total_bytes} | null
  const [clearing, setClearing] = useState(false);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try {
      const u = await api.getDiskUsage();
      setUsage(u);
    } catch (_) {
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }

  // Загружаем статистику один раз при mount: пользователь должен сразу
  // видеть «сколько занято», иначе непонятно, есть ли смысл чистить.
  useEffect(() => { refresh(); }, []);

  async function onClear() {
    if (clearing) return;
    let stats = usage;
    try {
      stats = await api.getDiskUsage();
      setUsage(stats);
    } catch (_) { /* fallback на кэш */ }

    if (!stats || stats.count === 0) {
      toast.success('Asset cache is already empty');
      return;
    }
    const summary = `${stats.count} files (${fmtBytes(stats.total_bytes)})`;
    if (!confirm(`Delete ${summary} from asset_uploads/?\n\nThis removes temporary uploaded source files (images, videos) cached by the sidecar. Generated results in History are NOT affected.`)) {
      return;
    }

    setClearing(true);
    try {
      const r = await api.clearDiskCache();
      toast.success(`Cleared ${r.cleared_count} files (${fmtBytes(r.freed_bytes)})`);
      setUsage({ count: 0, total_bytes: 0 });
    } catch (e) {
      const msg = (e && (e.body && e.body.detail || e.message)) || 'unknown';
      toast.error('Clear failed: ' + msg);
    } finally {
      setClearing(false);
    }
  }

  const sizeLabel = usage && usage.count > 0
    ? `${usage.count} files · ${fmtBytes(usage.total_bytes)}`
    : (loading ? 'checking…' : 'empty');
  const disabled = clearing || (usage && usage.count === 0);

  return html`
    <div class="disk-cache-row">
      <button class="disk-cache-btn" onClick=${onClear} disabled=${disabled}
              title="Removes temporary uploaded source files cached at asset_uploads/. Generated results are preserved.">
        🗑 Delete uploaded source cache (asset_uploads)
      </button>
      <span class="disk-cache-size" title="Files currently in asset_uploads/">${sizeLabel}</span>
    </div>
  `;
}

export function HistoryTab({ snap, api, videoNodes, onAction }) {
  const [filter, setFilter] = useState('all');
  const counts = useMemo(() => {
    const c = { all: snap.jobs.length };
    for (const j of snap.jobs) c[j.status] = (c[j.status] || 0) + 1;
    return c;
  }, [snap.jobs]);
  const jobs = filter === 'all' ? snap.jobs : snap.jobs.filter(j => j.status === filter);
  return html`
    <div class="history">
      <${DiskCacheButton} api=${api} />
      <${JobFilter} value=${filter} counts=${counts} onChange=${setFilter} />
      <${JobList} jobs=${jobs} api=${api} videoNodes=${videoNodes} onAction=${onAction} />
    </div>
  `;
}
