jest.mock('axios');
jest.mock('../../utils/logger', () => ({ warning: jest.fn() }));
const axios = require('axios');
const { MODEL_DEFINITIONS, DEFAULT_PROMPT, validateOptions, getCatalog } = require('../../services/ocrModelService');
const catalog = { models: MODEL_DEFINITIONS };

test('omitted selector retains the exact Hunyuan prompt and token defaults', () => {
  expect(validateOptions({}, catalog)).toEqual({ model: 'hunyuanocr', options: { prompt: DEFAULT_PROMPT, max_new_tokens: 2048 } });
});
test.each(['teleocr', 'lightonocr-2', 'unlimited-ocr'])('%s omits native prompt and unset numeric fields', model => {
  expect(validateOptions({ model, prompt: '  ' }, catalog)).toEqual({ model, options: {} });
});
test.each([
  { model: 'typo' }, { model: ['teleocr'] }, { model: '__proto__' },
  { model: 'teleocr', task: 'invalid' }, { model: 'teleocr', max_pixels: '3135' },
  { model: 'teleocr', max_pixels: '4014081' }, { model: 'teleocr', max_new_tokens: '8193' },
  { model: 'teleocr', max_new_tokens: '1.5' }, { model: 'teleocr', prompt: 'x'.repeat(4097) },
  { model: 'teleocr', task: 'layout', max_pixels: '1000000' },
  { model: 'teleocr', task: 'layout_distorted', max_pixels: '1000000' },
  { model: 'unlimited-ocr', max_new_tokens: '100' }, { model: 'unlimited-ocr', image_mode: 'bad' },
  { model: 'unlimited-ocr', max_length: '32769' }, { model: 'unlimited-ocr', no_repeat_ngram_size: '-1' },
  { model: 'unlimited-ocr', ngram_window: '4097' }, { model: 'teleocr', owner: 'another-user' },
])('rejects malformed or inapplicable settings %j', body => {
  expect(() => validateOptions(body, catalog)).toThrow();
});
test('accepts TeleOCR layout minimum and Unlimited zero repetition controls', () => {
  expect(validateOptions({ model: 'teleocr', task: 'layout', max_pixels: '1073296' }, catalog).options).toEqual({ task: 'layout', max_pixels: 1073296 });
  expect(validateOptions({ model: 'unlimited-ocr', image_mode: 'gundam', no_repeat_ngram_size: '0', ngram_window: '0' }, catalog).options).toEqual({ image_mode: 'gundam', no_repeat_ngram_size: 0, ngram_window: 0 });
});
test('discovers live defaults, merges backend bounds, caches and preserves warnings on failure', async () => {
  const now = jest.spyOn(Date, 'now').mockReturnValue(100000);
  axios.get.mockResolvedValue({ data: { models: {
    ...MODEL_DEFINITIONS,
    teleocr: { parameters: { ...MODEL_DEFINITIONS.teleocr.parameters, max_new_tokens: { type: 'integer', default: 1234, minimum: 1, maximum: 4096 } } },
    'lightonocr-2': { ...MODEL_DEFINITIONS['lightonocr-2'], warning: 'Quarantined' },
    'unlimited-ocr': { parameters: { max_length: { type: 'integer', default: 32768 }, prompt: { type: 'string', default: null } } },
  } } });
  const first = await getCatalog();
  expect(first.models.teleocr.parameters.max_new_tokens.default).toBe(1234);
  expect(first.models['unlimited-ocr'].parameters.max_length.maximum).toBe(32768);
  expect(first.models['lightonocr-2'].warning).toBe('Quarantined');
  expect(await getCatalog()).toBe(first);
  expect(axios.get).toHaveBeenCalledTimes(1);
  now.mockReturnValue(200000);
  axios.get.mockRejectedValue(new Error('offline'));
  const offline = await getCatalog();
  expect(offline.models).toBe(first.models);
  expect(offline.warning).toMatch(/unavailable/);
  now.mockRestore();
});
