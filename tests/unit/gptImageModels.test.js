jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { MODEL_NAME, STUDIO_MODEL_NAME, MODEL_CONTRACTS, modelMetadata } = require('../../services/gptImageModels');
const { normalizeGenerationForm, normalizeToolImageArguments, buildToolImageRequest, formatGeneratedImageDoc } = require('../../services/gptImageService');
const seeds = require('../../services/data/toolSeeds');
const ToolManagerService = require('../../services/toolManagerService');

test('service default stays original; Studio default is independently Sunburst', () => {
  expect(normalizeGenerationForm({ prompt: 'Test' }).requestOptions.model).toBe(MODEL_NAME);
  expect(STUDIO_MODEL_NAME).toBe('gpt-image-2.5-sunburst');
});
test.each(Object.keys(MODEL_CONTRACTS))('%s validates each advertised quality/background', model => {
  for (const quality of MODEL_CONTRACTS[model].qualities) {
    for (const background of MODEL_CONTRACTS[model].backgrounds) {
      expect(normalizeGenerationForm({ model, prompt: 'Test', quality, background }).ok).toBe(true);
    }
  }
  for (const outputFormat of ['png', 'jpeg', 'webp']) {
    expect(normalizeGenerationForm({ model, prompt: 'Test', outputFormat }).ok).toBe(true);
  }
  for (const n of [1, 10]) expect(normalizeGenerationForm({ model, prompt: 'Test', n }).ok).toBe(true);
  for (const quality of ['standard', 'hd', 'unknown']) expect(normalizeGenerationForm({ model, prompt: 'Test', quality }).ok).toBe(false);
  for (const size of ['1024x1024', '1536x864', '3840x2160', '2160x3840', 'auto']) {
    expect(normalizeGenerationForm({ ...normalizeToolImageArguments({ prompt: 'Test', size }), model }).ok).toBe(true);
  }
  for (const size of ['1024x1040', '512x512', '4096x2048', '3840x3840', '3072x512', '1025x1024']) {
    // 1024x1040 is a valid arbitrary size, distinct from a preset.
    expect(normalizeGenerationForm({ ...normalizeToolImageArguments({ prompt: 'Test', size }), model }).ok).toBe(size === '1024x1040');
  }
});
test.each(['xhigh', 'max'])('original rejects %s', quality => {
  expect(normalizeGenerationForm({ prompt: 'Test', quality }).ok).toBe(false);
});
test.each(['gpt-image-2.5-sunburst', 'gpt-image-2.5-flare'])('%s enforces format/compression combinations', model => {
  expect(normalizeGenerationForm({ model, prompt: 'Test', background: 'transparent', outputFormat: 'jpeg' }).ok).toBe(false);
  expect(normalizeGenerationForm({ model, prompt: 'Test', outputCompression: 100 }).ok).toBe(false);
  for (const outputFormat of ['jpeg', 'webp']) for (const outputCompression of [0, 100]) {
    expect(normalizeGenerationForm({ model, prompt: 'Test', outputFormat, outputCompression }).ok).toBe(true);
  }
});
test.each([{ model: 'unknown' }, { model: '__proto__' }, { n: '2oops' }, { n: [] }, { n: 11 }, { n: 0 }, { n: 1.5 }, { outputCompression: 101 }, { outputFormat: 'svg' }, { moderation: 'none' }, { sizePreset: 'invalid' }, { customWidth: '1024x', customHeight: 1024, sizeMode: 'custom' }, { user: 'spoofed' }, { input_fidelity: 'high' }])('rejects malformed/unsupported request %j', bad => {
  expect(normalizeGenerationForm({ prompt: 'Test', ...bad }).ok).toBe(false);
});
test('prompt bound and tool overrides fail before execution', () => {
  expect(normalizeGenerationForm({ prompt: 'x'.repeat(32001) }).ok).toBe(false);
  expect(() => normalizeToolImageArguments({ prompt: 'Test', model: STUDIO_MODEL_NAME })).toThrow();
  expect(() => normalizeToolImageArguments({ size: 'bad' })).toThrow();
  expect(() => buildToolImageRequest({ selected_image_ids: [{ $ne: null }] })).toThrow();
});
test('missing historical model gets a read-time fallback without changing URL', () => {
  const old = { outputUrl: '/img/Existing%20Image.PNG' };
  expect(formatGeneratedImageDoc(old)).toMatchObject({ model: MODEL_NAME, modelLabel: 'GPT Image 2', outputUrl: old.outputUrl });
  expect(old.model).toBeUndefined();
  expect(modelMetadata('gpt-image-2.5-flare').modelLabel).toContain('Flare');
});
test('three distinct schemas keep original defaults and startup uses insert-only seeding', async () => {
  const images = seeds.filter(seed => seed.handlerKey.startsWith('gptImage.'));
  expect(images).toHaveLength(3);
  expect(new Set(images.map(seed => seed.name)).size).toBe(3);
  const original = images.find(seed => seed.handlerKey === 'gptImage.generate');
  expect(original.metadata.model).toBe(MODEL_NAME);
  expect(original.toolDefinition.parameters.properties.quality.enum).toEqual(['auto', 'low', 'medium', 'high']);
  expect(original.toolDefinition.parameters.properties.background.enum).toEqual(['auto', 'opaque']);
  expect(original.toolDefinition.parameters.properties.output_compression.default).toBe(100);
  const stored = new Map([[original.name, { custom: 'keep', enabled: false }]]);
  const updateOne = jest.fn((query, update) => ({ exec: async () => {
    expect(Object.keys(update)).toEqual(['$setOnInsert']);
    if (stored.has(query.name)) return { matchedCount: 1, upsertedCount: 0 };
    stored.set(query.name, update.$setOnInsert);
    return { matchedCount: 0, upsertedCount: 1 };
  } }));
  const service = new ToolManagerService({ seeds: images, toolModel: { updateOne } });
  expect((await service.seedMissingDefaultTools()).upsertedCount).toBe(2);
  expect((await service.seedMissingDefaultTools()).upsertedCount).toBe(0);
  expect(stored.get(original.name)).toEqual({ custom: 'keep', enabled: false });
});

test('numeric normalization matches validation and rejects compound model/dimensions', () => {
  expect(normalizeGenerationForm({ prompt: 'Test', n: '1e1', outputFormat: 'webp', outputCompression: '1e2' }).requestOptions).toMatchObject({ n: 10, outputCompression: 100 });
  expect(normalizeGenerationForm({ prompt: 'Test', model: ['gpt-image-2'] }).ok).toBe(false);
  expect(normalizeGenerationForm({ prompt: 'Test', sizeMode: 'custom', customWidth: [1024], customHeight: 1024 }).ok).toBe(false);
});
