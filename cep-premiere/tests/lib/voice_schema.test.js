import { describe, it, expect } from 'vitest';
import {
  VOICE_TTS_META,
  getNodeMeta,
  getNodeFamily,
  getSlotsForScenario,
  nodeHasPrompt,
  nodeSupportsEnhancer,
  listNodesByFamily,
} from '../../client/lib/slot_schema.js';
import { isAudioPath } from '../../client/lib/disk_save.js';

// Bit-for-bit-инварианты, которые должны соответствовать sidecar's
// app/workflows/voice_tts.py VOICE_PRESETS / DEFAULT_VOICE — расхождение
// = silent UI-bug (запрос уйдёт с несуществующим voice).
describe('VOICE_TTS_META', () => {
  it('points at sidecar node 89', () => {
    expect(VOICE_TTS_META.node_id).toBe(89);
  });

  it('has single tts scenario and no file slots', () => {
    expect(VOICE_TTS_META.scenarios).toEqual(['tts']);
    expect(VOICE_TTS_META.scenario_slots.tts).toEqual([]);
    expect(Object.keys(VOICE_TTS_META.slots)).toEqual([]);
  });

  it('lists exactly 6 voices — 3 female + 3 male', () => {
    const opts = VOICE_TTS_META.param_options.voice.options;
    expect(opts).toHaveLength(6);
    const females = VOICE_TTS_META.voice_presets.filter(p => p.gender === 'female');
    const males = VOICE_TTS_META.voice_presets.filter(p => p.gender === 'male');
    expect(females).toHaveLength(3);
    expect(males).toHaveLength(3);
    // preset.id list совпадает с param_options.voice.options
    expect(VOICE_TTS_META.voice_presets.map(p => p.id).sort())
      .toEqual([...opts].sort());
  });

  it('default voice is one of the 6 presets', () => {
    const opts = VOICE_TTS_META.param_options.voice.options;
    expect(opts).toContain(VOICE_TTS_META.default_params.voice);
  });

  it('hardcoded preset IDs match sidecar VOICE_PRESETS (do not drift)', () => {
    // Эти ID — связка с custom_voice_id в HAR (sidecar's VOICE_PRESETS).
    // Если поменяешь здесь — поменяй и в voice_tts.py, иначе submit упадёт
    // UnknownVoiceError.
    expect(VOICE_TTS_META.param_options.voice.options.sort()).toEqual([
      '5XtIMNJwnXd6fKINOwVx',
      '7yMNQpvLyzVR4bsoniZg',
      'JThzojXplQThwzu1NRgA',
      'VywPjF0ZYksZDGdTC7uq',
      'ZCDuYlmjTQwFnocCyTs2',
      'rv5jQF81clh7R2mBDAEQ',
    ]);
  });
});

describe('voice family routing', () => {
  it('getNodeMeta(89) returns VOICE_TTS_META', () => {
    expect(getNodeMeta({ videoNodes: [], nodeId: 89 })).toBe(VOICE_TTS_META);
  });

  it('getNodeFamily(VOICE_TTS_META) === voice', () => {
    expect(getNodeFamily(VOICE_TTS_META)).toBe('voice');
  });

  it('listNodesByFamily(voice) returns [VOICE_TTS_META]', () => {
    expect(listNodesByFamily({ videoNodes: [], family: 'voice' }))
      .toEqual([VOICE_TTS_META]);
  });

  it('getSlotsForScenario(tts) returns [] — no file inputs', () => {
    expect(getSlotsForScenario({ videoNodes: [], nodeId: 89, scenario: 'tts' }))
      .toEqual([]);
  });
});

describe('voice prompt + enhancer behavior', () => {
  it('nodeHasPrompt(voice) === true — text input нужен', () => {
    expect(nodeHasPrompt(VOICE_TTS_META)).toBe(true);
  });

  it('nodeSupportsEnhancer(voice) === false — enhancer обучен под image/video', () => {
    expect(nodeSupportsEnhancer(VOICE_TTS_META)).toBe(false);
  });

  it('Topaz remains: no prompt, no enhancer (regression)', () => {
    const topaz = getNodeMeta({ videoNodes: [], nodeId: 87 });
    expect(nodeHasPrompt(topaz)).toBe(false);
    expect(nodeSupportsEnhancer(topaz)).toBe(false);
  });

  it('Nano Banana keeps both prompt + enhancer (regression)', () => {
    const nb = getNodeMeta({ videoNodes: [], nodeId: 94 });
    expect(nodeHasPrompt(nb)).toBe(true);
    expect(nodeSupportsEnhancer(nb)).toBe(true);
  });
});

describe('isAudioPath', () => {
  it('detects mp3/wav/aac/m4a/ogg/flac/aiff/wma', () => {
    for (const ext of ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'aiff', 'wma']) {
      expect(isAudioPath(`/x/y/file.${ext}`)).toBe(true);
      expect(isAudioPath(`C:\\X\\Y\\file.${ext.toUpperCase()}`)).toBe(true);
    }
  });

  it('does NOT match images / videos / null', () => {
    expect(isAudioPath('/x/y/a.png')).toBe(false);
    expect(isAudioPath('/x/y/a.mp4')).toBe(false);
    expect(isAudioPath('')).toBe(false);
    expect(isAudioPath(null)).toBe(false);
    expect(isAudioPath(undefined)).toBe(false);
  });
});
