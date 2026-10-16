const { windowAt, runWire, safeReplacement, parseSubmission, digest, affinity } = require('../../services/localAi/policy');
const qwen = require('../fixtures/local-ai/qwen.json');
const clone = x => JSON.parse(JSON.stringify(x));
describe('durable batch policy', () => {
  test.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])('window is independent of host TZ %s', tz => {
    const old = process.env.TZ; process.env.TZ = tz;
    expect(windowAt(new Date('2026-10-15T15:59:59Z')).inside).toBe(false);
    expect(windowAt(new Date('2026-10-15T16:00:00Z')).inside).toBe(true);
    expect(windowAt(new Date('2026-10-15T20:59:59Z')).inside).toBe(true);
    expect(windowAt(new Date('2026-10-15T21:00:00Z')).inside).toBe(false);
    expect(windowAt(new Date('2026-10-15T21:00:00Z')).next.toISOString()).toBe('2026-10-16T16:00:00.000Z');
    process.env.TZ = old;
  });
  test('automatic and manual deadlines are finite, including midnight and exact cutoff', () => {
    expect(runWire('automatic', new Date('2026-10-15T17:00:00Z')).deadline).toBe('2026-10-15T21:00:00.000Z');
    expect(() => runWire('automatic', new Date('2026-10-15T21:00:00Z'))).toThrow('outside_window');
    expect(runWire('manual', new Date('2026-10-15T20:00:00Z')).deadline).toBe('2026-10-15T21:00:00.000Z');
    expect(runWire('manual', new Date('2026-10-15T21:00:00Z')).deadline).toBe('2026-10-16T02:00:00.000Z');
  });
  test.each(['queued', 'dispatching', 'succeeded', 'outcome_unknown'])('never replace %s even with termination assertion', status => {
    expect(safeReplacement({ status, termination_proven: true, cleanup: 'verified' })).toBe(false);
  });
  test('replacement needs both termination and cleanup proof', () => {
    for (const status of ['failed', 'interrupted', 'deferred']) {
      expect(safeReplacement({ status, termination_proven: true, cleanup: 'verified' })).toBe(true);
      expect(safeReplacement({ status, termination_proven: false, cleanup: 'verified' })).toBe(false);
      expect(safeReplacement({ status, termination_proven: true, cleanup: 'uncertain' })).toBe(false);
    }
  });
  test('strict text request retains optional presence and rejects tools, images and arbitrary options', () => {
    const request = { model: 'model-a', messages: [{ role: 'user', content: 'hello' }], max_tokens: 10 };
    expect(parseSubmission({ type: 'llm.chat', request }).request).toEqual(request);
    for (const extra of [{ tools: [] }, { options: {} }, { images: [] }]) expect(() => parseSubmission({ type: 'llm.chat', request: { ...request, ...extra } })).toThrow();
    expect(() => parseSubmission({ type: 'llm.chat', request: { ...request, messages: [{ role: 'tool', content: 'x' }] } })).toThrow();
    expect(digest({ a: 1, b: 2 })).toBe(digest({ b: 2, a: 1 }));
    expect(digest(request)).not.toBe(digest({ ...request, seed: 0 }));
  });
  test('exact workflow, seed and all loader objects participate in validation and affinity', () => {
    expect(parseSubmission({ type: 'comfy.image', request: { prompt: qwen } }).request.prompt).toEqual(qwen);
    const changed = clone(qwen); changed['1'].inputs.unet_name = 'qwen-image-2.1-UC-int8_convrot.safetensors';
    expect(affinity('comfy.image', { prompt: changed })).not.toBe(affinity('comfy.image', { prompt: qwen }));
    for (const mutate of [g => { g['9'] = g['8']; }, g => { g['1'].inputs.unet_name = '../secret'; }, g => { g['6'].inputs.seed = Number.MAX_SAFE_INTEGER + 1; }, g => { g['5'].inputs.batch_size = 2; }, g => { g['5'].inputs.width = 257; }, g => { g['6'].inputs.sampler_name = 'other'; }]) {
      const g = clone(qwen); mutate(g); expect(() => parseSubmission({ type: 'comfy.image', request: { prompt: g } })).toThrow();
    }
  });
});
