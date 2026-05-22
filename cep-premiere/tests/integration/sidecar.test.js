import { describe, it, expect } from 'vitest';
import { createApi } from '../../client/lib/api.js';

describe.skipIf(!process.env.PHYGITAL_INTEGRATION)('sidecar integration', () => {
  const api = createApi({ fetch, baseUrl: 'http://127.0.0.1:8765' });
  it('GET /health', async () => {
    const h = await api.getHealth();
    expect(h).toBeTruthy();
  });
  it('GET /nodes/video', async () => {
    const r = await api.listVideoNodes();
    expect(r.nodes.length).toBeGreaterThan(0);
  });
});
