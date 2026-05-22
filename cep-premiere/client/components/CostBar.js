import { html } from '../lib/html.js';
import { makeCostKey } from '../lib/state.js';

export function CostBar({ snap, api, store }) {
  const { draft } = snap;
  const key = makeCostKey(draft);
  const cost = snap.cost || { key: null };
  const stale = cost.key !== key;

  async function estimate() {
    store.set({ cost: { key, price: null, loading: true, error: null } });
    try {
      const out = await api.previewCost({ node_id: draft.model_id, params: { ...draft.params, prompt: draft.prompt } });
      store.set({ cost: { key, price: out.price ?? out.credits ?? null, loading: false, error: null } });
    } catch (e) {
      store.set({ cost: { key, price: null, loading: false, error: e.message || 'cost failed' } });
    }
  }

  return html`
    <div class="cost">
      <button onClick=${estimate} disabled=${cost.loading}>${cost.loading ? '...' : 'Estimate'}</button>
      ${!stale && cost.price != null
        ? html`<span class="cost-price">~${cost.price} credits</span>`
        : stale && cost.price != null
          ? html`<span class="cost-stale">stale, re-estimate</span>`
          : null}
      ${cost.error ? html`<span class="cost-err">${cost.error}</span>` : null}
      ${!stale && typeof cost.price === 'number' && cost.price > 100
        ? html`<div class="cost-warn">This generation will cost > 100 credits</div>`
        : null}
    </div>
  `;
}
