import { describe, it, expect } from 'vitest';
import {
  getNodeMeta, getSlotsForScenario, getVersionParam,
  NANO_BANANA_META, GPT_IMAGE_META, TOPAZ_META,
} from '../../client/lib/slot_schema.js';

const VIDEO_NODES_FIXTURE = [
  {
    node_id: 74, model: 'Kling v3 pro',
    slots: { init_img: 'array', image_tail: 'scalar', element_1: 'array', element_2: 'array', element_3: 'array' },
    scenarios: ['start_prompt', 'start_end_prompt', 'elements_prompt', 'elements_prompt_video'],
    scenario_slots: {
      start_prompt: ['init_img'],
      start_end_prompt: ['init_img', 'image_tail'],
      elements_prompt: ['element_1'],
      elements_prompt_video: ['element_1', 'image_tail'],
    },
    default_params: {},
  },
];

describe('slot_schema', () => {
  it('NANO_BANANA_META has node 94 + init_img array slot', () => {
    expect(NANO_BANANA_META.node_id).toBe(94);
    expect(NANO_BANANA_META.slots.init_img).toBe('array');
    expect(NANO_BANANA_META.scenario_slots.edit).toEqual(['init_img']);
  });

  it('getNodeMeta(94) returns Nano Banana even without /nodes/video', () => {
    const m = getNodeMeta({ videoNodes: [], nodeId: 94 });
    expect(m.node_id).toBe(94);
  });

  it('getNodeMeta(74) reads from videoNodes payload', () => {
    const m = getNodeMeta({ videoNodes: VIDEO_NODES_FIXTURE, nodeId: 74 });
    expect(m.model).toBe('Kling v3 pro');
  });

  it('getSlotsForScenario returns names with kind annotation', () => {
    const slots = getSlotsForScenario({ videoNodes: VIDEO_NODES_FIXTURE, nodeId: 74, scenario: 'start_end_prompt' });
    expect(slots).toEqual([
      { name: 'init_img', kind: 'array' },
      { name: 'image_tail', kind: 'scalar' },
    ]);
  });

  it('getSlotsForScenario for Nano Banana edit returns init_img array', () => {
    const slots = getSlotsForScenario({ videoNodes: [], nodeId: 94, scenario: 'edit' });
    expect(slots).toEqual([{ name: 'init_img', kind: 'array' }]);
  });

  it('getSlotsForScenario returns [] for unknown scenario', () => {
    const slots = getSlotsForScenario({ videoNodes: VIDEO_NODES_FIXTURE, nodeId: 74, scenario: 'nonsense' });
    expect(slots).toEqual([]);
  });
});

describe('getVersionParam', () => {
  it('picks model_name for Kling-style video nodes', () => {
    const meta = {
      node_id: 74, model: 'Kling',
      default_params: { model_name: 'kling_v3', mode: 'pro' },
      param_options: {
        model_name: { kind: 'enum', options: ['kling_v2_6', 'kling_v3'] },
        mode: { kind: 'enum', options: ['std', 'pro'] },
      },
    };
    expect(getVersionParam(meta)).toEqual({
      name: 'model_name', options: ['kling_v2_6', 'kling_v3'],
    });
  });

  it('picks model for Seedance-style nodes (no model_name)', () => {
    const meta = {
      node_id: 100, model: 'Seedance',
      default_params: { model: 'v_2_0' },
      param_options: { model: { kind: 'enum', options: ['lite', 'pro', 'v_2_0'] } },
    };
    expect(getVersionParam(meta).name).toBe('model');
  });

  it('Nano Banana (94) promotes model_name', () => {
    expect(getVersionParam(NANO_BANANA_META).name).toBe('model_name');
  });

  it('single-option enum is NOT a version choice (GPT Image version=[v2])', () => {
    expect(getVersionParam(GPT_IMAGE_META)).toBeNull();
  });

  it('nodes without version-like params return null (Topaz)', () => {
    expect(getVersionParam(TOPAZ_META)).toBeNull();
  });

  it('null meta returns null', () => {
    expect(getVersionParam(null)).toBeNull();
  });
});
