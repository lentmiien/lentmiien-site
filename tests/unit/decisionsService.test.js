jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const sharp = require('sharp');
const { buildPayload, DecisionsService } = require('../../services/decisionsService');
const logger = require('../../utils/logger');
const request = () => ({ model: 'liquid-d1-2b-q8', input: 'Please refund the duplicate charge.', questions: [
  { type: 'predicate', name: 'refund', instructions: 'Is a refund requested?' },
  { type: 'choice', instructions: 'Classify.', choices: [{ value: true }, { value: 'true' }] },
  { type: 'score', instructions: 'Rate urgency.', levels: [{ label: 'low' }, { label: 'high' }] },
] });

test('builds all three types and preserves typed values and optional names', async () => {
  const raw = request();
  expect(await buildPayload(raw)).toEqual(raw);
  expect((await buildPayload({ ...raw, model: 'openai' })).model).toBe('gpt-6-luna');
});
test('treats an empty image field as omitted and still requires evidence', async () => {
  const raw = { ...request(), image_data_url: '' };
  expect(await buildPayload(raw)).toEqual(await buildPayload(request()));
  expect(raw.image_data_url).toBe('');
  await expect(buildPayload({ ...raw, input: '' })).rejects.toMatchObject({ status: 422, message: 'Provide evidence text or an image.' });
  await expect(buildPayload({ ...raw, input: '   ' })).rejects.toHaveProperty('status', 422);
});
test.each([
  raw => { raw.model = 'unknown'; },
  raw => { raw.model = 'toString'; },
  raw => { raw.owner = 'someone-else'; },
  raw => { raw.input = []; },
  raw => { raw.questions = []; },
  raw => { raw.questions = Array.from({ length: 33 }, () => ({ type: 'predicate', instructions: 'Yes?' })); },
  raw => { raw.questions[0].instructions = 'a'.repeat(2001); },
  raw => { raw.questions[0].type = 'unknown'; },
  raw => { raw.questions[1].name = 'refund'; },
  raw => { raw.questions[1].choices = [{ value: true }, { value: true }]; },
  raw => { raw.questions[1].choices[0].value = 1; },
  raw => { raw.questions[1].choices[0].url = 'http://example.test'; },
  raw => { raw.questions[2].levels = [{ label: 'one' }]; },
  raw => { raw.questions[2].levels = Array.from({ length: 11 }, () => ({ label: 'many' })); },
  raw => { raw.image_data_url = 'http://127.0.0.1/private'; },
  raw => { raw.image_data_url = 'data:image/png;base64,aGVsbG8='; },
  raw => { raw.image_data_url = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/7WQAAAAASUVORK5CYII='; },
  raw => { raw.image_data_url = 'data:image/gif;base64,aGVsbG8='; },
])('rejects invalid/unsupported input before inference %#', async mutate => {
  const raw = request(); mutate(raw);
  const client = { request: jest.fn() };
  const service = new DecisionsService({ client });
  await expect(service.evaluate(raw, 'owner')).rejects.toHaveProperty('status', 422);
  expect(client.request).not.toHaveBeenCalled();
  expect(service.active.size).toBe(0);
});
test('bounds combined UTF-8 text including keys and all question content', async () => {
  await expect(buildPayload({ ...request(), input: '語'.repeat(2000) })).rejects.toHaveProperty('status', 413);
  await expect(buildPayload({ ...request(), input: 'x'.repeat(5999) })).rejects.toHaveProperty('status', 413);
  await expect(buildPayload({ ...request(), image_data_url: 'x'.repeat(8 * 1024 * 1024) })).rejects.toHaveProperty('status', 413);
});
test('validates real image bytes and wraps text/image in one shared message', async () => {
  const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'white' } }).png().toBuffer();
  const image = `data:image/png;base64,${bytes.toString('base64')}`;
  const payload = await buildPayload({ ...request(), image_data_url: image });
  expect(payload.input).toEqual([{ role: 'user', content: [{ type: 'input_text', text: request().input }, { type: 'input_image', image_url: image }] }]);
  await expect(buildPayload({ ...request(), image_data_url: image.replace('image/png', 'image/jpeg') })).rejects.toHaveProperty('status', 422);
  const wide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: 'white' } }).png().toBuffer();
  await expect(buildPayload({ ...request(), image_data_url: `data:image/png;base64,${wide.toString('base64')}` })).rejects.toHaveProperty('status', 422);
  const large = await sharp({ create: { width: 2001, height: 2000, channels: 3, background: 'white' } }).png().toBuffer();
  await expect(buildPayload({ ...request(), image_data_url: `data:image/png;base64,${large.toString('base64')}` })).rejects.toHaveProperty('status', 422);
});
test('uses bounded fixed requests and returns refusals unchanged', async () => {
  const result = { model: request().model, answers: [{ type: 'refusal', refusal: 'Unable to assess' }, { type: 'choice', choice: true }, { type: 'score', score: 0.3 }], usage: {} };
  const client = { request: jest.fn().mockResolvedValue({ data: result }) };
  const service = new DecisionsService({ client, baseUrl: 'http://gateway.test/' });
  const abort = new AbortController();
  expect(await service.evaluate(request(), 'owner', { signal: abort.signal })).toEqual(result);
  expect(client.request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', url: 'http://gateway.test/decisions', timeout: 1200000, maxRedirects: 0, maxContentLength: 1048576, signal: abort.signal }));
});
test('redacts provider errors and preserves safe retry-after', async () => {
  const client = { request: jest.fn().mockRejectedValue({ response: { status: 429, data: 'PRIVATE_EVIDENCE secret-key', headers: { 'retry-after': '30' } } }) };
  const service = new DecisionsService({ client });
  await expect(service.evaluate(request(), 'owner')).rejects.toMatchObject({ status: 429, retryAfter: '30' });
  expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('PRIVATE_EVIDENCE');
  expect(service.active.size).toBe(0);
});
test('rejects a mismatched provider response and unknown model catalog', async () => {
  const service = new DecisionsService({ client: { request: jest.fn().mockResolvedValue({ data: { model: 'wrong', answers: [] } }) } });
  await expect(service.evaluate(request(), 'owner')).rejects.toHaveProperty('status', 502);
  await expect(service.models()).rejects.toHaveProperty('status', 502);
});
test('limits one active request per principal, two globally and six per minute', async () => {
  let resolve;
  const client = { request: jest.fn(() => new Promise(done => { resolve = done; })) };
  const service = new DecisionsService({ client });
  const first = service.evaluate(request(), 'owner');
  await expect(service.evaluate(request(), 'owner')).rejects.toHaveProperty('status', 429);
  await new Promise(done => setImmediate(done));
  resolve({ data: { model: request().model, answers: request().questions.map(q => ({ type: q.type })) } });
  await first;
  client.request.mockResolvedValue({ data: { model: request().model, answers: request().questions.map(q => ({ type: q.type })) } });
  for (let i = 0; i < 5; i += 1) await service.evaluate(request(), 'owner');
  await expect(service.evaluate(request(), 'owner')).rejects.toHaveProperty('status', 429);
  service.active.add('one'); service.active.add('two');
  await expect(service.evaluate(request(), 'another')).rejects.toHaveProperty('status', 429);
});
test('cancels before forwarding and releases request capacity', async () => {
  const client = { request: jest.fn() }; const service = new DecisionsService({ client });
  const abort = new AbortController(); abort.abort();
  await expect(service.evaluate(request(), 'owner', { signal: abort.signal })).rejects.toHaveProperty('status', 499);
  expect(client.request).not.toHaveBeenCalled(); expect(service.active.size).toBe(0);
});
