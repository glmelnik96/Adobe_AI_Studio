// Пресеты («только форма», V1.3): применение пресета к draft'у и
// сериализация /presets-вызовов через api factory.
import { describe, it, expect, vi } from 'vitest';
import { applyPresetToDraft } from '../../client/lib/state.js';
import { createApi } from '../../client/lib/api.js';

const VIDEO_NODES = [
  {
    node_id: 74, model: 'Kling v3', family: 'video',
    scenarios: ['start_prompt', 'start_end_prompt'],
    scenario_slots: { start_prompt: ['init_img'], start_end_prompt: ['init_img', 'image_tail'] },
    slots: { init_img: 'array', image_tail: 'single' },
    default_params: {}, param_options: {},
  },
];

const PRESET = {
  id: 'p1', name: 'Kling cinematic',
  family: 'video', model_id: 74, scenario: 'start_end_prompt',
  prompt: 'cinematic dolly shot',
  params: { duration: 10, model_name: 'kling-v3' },
};

describe('applyPresetToDraft', () => {
  it('fills form fields, clears slots, resets enhancer state', () => {
    const r = applyPresetToDraft(PRESET, { videoNodes: VIDEO_NODES });
    expect(r.ok).toBe(true);
    expect(r.draft.model_id).toBe(74);
    expect(r.draft.family).toBe('video');
    expect(r.draft.scenario).toBe('start_end_prompt');
    expect(r.draft.prompt).toBe('cinematic dolly shot');
    expect(r.draft.params).toEqual({ duration: 10, model_name: 'kling-v3' });
    expect(r.draft.slots).toEqual({});
    expect(r.draft.enhance_prompt).toBe(false);
    expect(r.draft.enhanced_prompt).toBeNull();
  });

  it('params are copied, not aliased — later edits must not mutate the preset', () => {
    const r = applyPresetToDraft(PRESET, { videoNodes: VIDEO_NODES });
    r.draft.params.duration = 5;
    expect(PRESET.params.duration).toBe(10);
  });

  it('falls back to first scenario when preset scenario vanished from meta', () => {
    const stale = { ...PRESET, scenario: 'removed_scenario' };
    const r = applyPresetToDraft(stale, { videoNodes: VIDEO_NODES });
    expect(r.ok).toBe(true);
    expect(r.draft.scenario).toBe('start_prompt');
  });

  it('rejects preset whose model is unknown (node gone from /nodes/video)', () => {
    const r = applyPresetToDraft({ ...PRESET, model_id: 9999 }, { videoNodes: VIDEO_NODES });
    expect(r).toEqual({ ok: false, error: 'unknown_model' });
  });

  it('static image nodes (94) resolve without videoNodes', () => {
    const r = applyPresetToDraft(
      { id: 'p2', name: 't2i', model_id: 94, scenario: 'generate', prompt: 'a cat', params: {} },
      { videoNodes: null },
    );
    expect(r.ok).toBe(true);
    expect(r.draft.family).toBe('image');
  });

  it('rejects malformed preset (no model_id)', () => {
    expect(applyPresetToDraft({ name: 'x' }, { videoNodes: VIDEO_NODES }).ok).toBe(false);
    expect(applyPresetToDraft(null, { videoNodes: VIDEO_NODES }).ok).toBe(false);
  });
});

describe('api presets methods', () => {
  function mkFetch(json) {
    return vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: () => 'application/json' },
      json: async () => json,
    }));
  }

  it('listPresets GETs /presets', async () => {
    const f = mkFetch({ presets: [] });
    const api = createApi({ fetch: f, baseUrl: 'http://x' });
    await api.listPresets();
    expect(f.mock.calls[0][0]).toBe('http://x/presets');
  });

  it('savePreset POSTs the form-only payload', async () => {
    const f = mkFetch({ preset: { id: 'p1' }, created: true });
    const api = createApi({ fetch: f, baseUrl: 'http://x' });
    await api.savePreset({
      name: 'n', family: 'video', model_id: 74,
      scenario: 's', prompt: 'p', params: { a: 1 },
    });
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe('http://x/presets');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({
      name: 'n', family: 'video', model_id: 74, scenario: 's', prompt: 'p', params: { a: 1 },
    });
  });

  it('deletePreset DELETEs by encoded id', async () => {
    const f = mkFetch({ ok: true });
    const api = createApi({ fetch: f, baseUrl: 'http://x' });
    await api.deletePreset('a/b');
    const [url, opts] = f.mock.calls[0];
    expect(url).toBe('http://x/presets/a%2Fb');
    expect(opts.method).toBe('DELETE');
  });
});
