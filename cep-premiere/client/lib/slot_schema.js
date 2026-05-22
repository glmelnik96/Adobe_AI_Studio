// Node 94 (Nano Banana) is not in /nodes/video. Hard-code its slot map here.
// Video nodes (74/100/121/124) come from GET /nodes/video.

// Source: phygital.har → GET /api/v2/nodes/ schema for id=94 (Gemini Image API).
export const NANO_BANANA_META = {
  node_id: 94,
  model: 'Nano Banana',
  slots: { init_img: 'array' },
  scenarios: ['edit'],
  scenario_slots: { edit: ['init_img'] },
  default_params: {
    model_name: 'v3_1',
    ratio: 'default',
    resolution: 'k1',
  },
  param_options: {
    model_name: { kind: 'enum', options: ['v2', 'v2_5', 'v3', 'v3_1'] },
    ratio: { kind: 'enum', options: [
      'default', 'r_1_1', 'r_2_3', 'r_3_2', 'r_1_4', 'r_4_1',
      'r_1_8', 'r_8_1', 'r_3_4', 'r_4_3', 'r_4_5', 'r_5_4',
      'r_9_16', 'r_16_9', 'r_21_9',
    ] },
    resolution: { kind: 'enum', options: ['default', 'k1', 'k2', 'k4'] },
  },
};

export function getNodeMeta({ videoNodes, nodeId }) {
  if (videoNodes) {
    const found = videoNodes.find(n => n.node_id === nodeId);
    if (found) return found;
  }
  if (nodeId === 94) return NANO_BANANA_META;
  return null;
}

export function listAllNodes({ videoNodes }) {
  const out = [NANO_BANANA_META];
  if (videoNodes) out.push(...videoNodes);
  return out;
}

export function getSlotsForScenario({ videoNodes, nodeId, scenario }) {
  const meta = getNodeMeta({ videoNodes, nodeId });
  if (!meta) return [];
  const names = meta.scenario_slots[scenario];
  if (!names) return [];
  return names.map(name => ({ name, kind: meta.slots[name] || 'scalar' }));
}
