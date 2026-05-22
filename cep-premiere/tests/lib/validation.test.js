import { describe, it, expect } from 'vitest';
import { validateDraft } from '../../client/lib/validation.js';

const VIDEO_FIXTURE = [{
  node_id: 74, model: 'Kling',
  slots: { init_img: 'array', image_tail: 'scalar' },
  scenarios: ['start_prompt', 'start_end_prompt'],
  scenario_slots: { start_prompt: ['init_img'], start_end_prompt: ['init_img', 'image_tail'] },
  default_params: {},
}];

function draft(overrides = {}) {
  return {
    model_id: 74,
    scenario: 'start_prompt',
    prompt: 'a beautiful scene',
    slots: { init_img: [{ path: '/x.jpg', name: 'x.jpg', source: 'disk' }] },
    params: {},
    ...overrides,
  };
}

describe('validateDraft', () => {
  it('passes a fully-formed draft', () => {
    const r = validateDraft({ videoNodes: VIDEO_FIXTURE, draft: draft() });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('fails when prompt is empty', () => {
    const r = validateDraft({ videoNodes: VIDEO_FIXTURE, draft: draft({ prompt: '   ' }) });
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual({ field: 'prompt', message: 'Prompt required' });
  });

  it('fails when required slot empty', () => {
    const r = validateDraft({ videoNodes: VIDEO_FIXTURE, draft: draft({ slots: {} }) });
    expect(r.ok).toBe(false);
    expect(r.errors).toContainEqual({ field: 'slot:init_img', message: 'Slot init_img required' });
  });

  it('fails when scenario incompatible with model', () => {
    const r = validateDraft({ videoNodes: VIDEO_FIXTURE, draft: draft({ scenario: 'char_video_prompt' }) });
    expect(r.ok).toBe(false);
    expect(r.errors[0].field).toBe('scenario');
  });

  it('handles Nano Banana without videoNodes loaded', () => {
    const d = { model_id: 94, scenario: 'edit', prompt: 'p', slots: { init_img: [{ path: '/x.jpg', name: 'x', source: 'disk' }] }, params: {} };
    const r = validateDraft({ videoNodes: null, draft: d });
    expect(r.ok).toBe(true);
  });
});
