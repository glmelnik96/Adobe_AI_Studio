// visibleParamKeys — фильтр Advanced settings (UI-аудит, фиксы 1+3):
//  - версия движка (model_name/model) исключается через `exclude` —
//    у неё свой Version-дропдаун под Model;
//  - enum'ы с <=1 опцией прячутся (мёртвый дропдаун, GPT Image version=['v2']).
// Дефолты скрытых параметров всё равно уходят в payload (SubmitButton
// мержит {...defaults, ...draft.params}) — скрытие чисто визуальное.
import { describe, it, expect } from 'vitest';
import { visibleParamKeys } from '../../client/components/ParamsAccordion.js';

const DEFAULTS = {
  model_name: 'kling_v3',
  version: 'v2',
  ratio: 'r_16_9',
  cfg_scale: 0.5,
};
const OPTIONS = {
  model_name: { kind: 'enum', options: ['kling_v2_6', 'kling_v3'] },
  version: { kind: 'enum', options: ['v2'] },
  ratio: { kind: 'enum', options: ['r_16_9', 'r_9_16'] },
  cfg_scale: { kind: 'number', min: 0, max: 1, step: 0.1 },
};

describe('visibleParamKeys', () => {
  it('hides single-option enums', () => {
    expect(visibleParamKeys(DEFAULTS, OPTIONS, [])).toEqual(['model_name', 'ratio', 'cfg_scale']);
  });

  it('excludes promoted version param', () => {
    expect(visibleParamKeys(DEFAULTS, OPTIONS, ['model_name'])).toEqual(['ratio', 'cfg_scale']);
  });

  it('keeps params without widget hints (unknown → text input)', () => {
    expect(visibleParamKeys({ seed: 42 }, {}, [])).toEqual(['seed']);
  });

  it('empty defaults → empty list', () => {
    expect(visibleParamKeys({}, OPTIONS, [])).toEqual([]);
    expect(visibleParamKeys(null, null, null)).toEqual([]);
  });
});
