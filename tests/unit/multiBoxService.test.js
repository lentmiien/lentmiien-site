const { createMultiBoxService, convertBoxes, addWeightEstimates, configuredOrigin } = require('../../services/multiBoxService');
const { requestSchema } = require('../../utils/multiBoxValidation');
const { jobId, owner, box, item, result, job } = require('../fixtures/multiBoxPlan');
let catalog, jobs, http, service, records, log;
beforeEach(() => {
  records = new Map();
  catalog = { read: jest.fn().mockResolvedValue({ containers: [box, { ...box, id: 'Disabled', maxLoadWeight: 0 }], revision: 7 }) };
  jobs = { create: jest.fn(async data => { records.set(data._id, data); }),
    findOne: jest.fn(query => ({ lean: async () => {
      const record = records.get(query._id);
      return record && record.ownerId === query.ownerId && record.expiresAt > query.expiresAt.$gt ? record : null;
    } })) };
  http = { request: jest.fn().mockResolvedValue({ data: job('queued') }) };
  log = { warning: jest.fn(), error: jest.fn() };
  service = createMultiBoxService({ catalog, jobs, http, log, origin: () => 'http://worker.test:8094' });
});
test('converts mm to cm, excludes zero loads, and supplies a non-limiting value capacity', async () => {
  expect(await service.containers()).toMatchObject({ revision: 7, excludedContainers: 1,
    containers: [{ id: 'Medium', width: 40, height: 30, depth: 20, max_weight: 10, max_value: 1e12, emptyWeight: .5 }] });
  const input = { items: [{ ...item, rotation: 'free', soft: true, fragile: true, shrink: 20 }], options: { approach: 'space', margin: .5, maxWeight: 5 } };
  expect(await service.submit(owner, input)).toMatchObject({ jobId, status: 'queued' });
  const call = http.request.mock.calls[0][0];
  expect(call).toMatchObject({ method: 'POST', url: 'http://worker.test:8094/api/jobs', timeout: 15000, maxRedirects: 0,
    maxContentLength: 8 * 1024 * 1024, maxBodyLength: 256 * 1024 });
  expect(call.data.boxes).toEqual([{ id: 'Medium', width: 40, height: 30, depth: 20, max_weight: 10, max_value: 1e12 }]);
  expect(call.data.items[0]).toMatchObject(input.items[0]);
  expect(records.get(jobId)).toMatchObject({ ownerId: owner, boxes: [{ id: 'Medium', emptyWeight: .5, maxLoadWeight: 10 }] });
});
test('polls only owner-scoped unexpired jobs and uses saved weights after catalog changes', async () => {
  await service.submit(owner, { items: [item] });
  http.request.mockResolvedValue({ data: job('completed') });
  catalog.read.mockResolvedValue({ containers: [{ ...box, emptyWeight: 50 }], revision: 8 });
  const data = await service.poll(owner, jobId);
  expect(data.result.boxes[0].weightEstimate).toEqual({ itemWeight: 1.2, emptyBoxWeight: .5,
    emptyVolumeCm3: 23000, estimatedCushionWeight: expect.closeTo(.18906, 8), estimatedShipmentWeight: 1.88906,
    maxLoadWeight: 10, exceedsMaxLoadWeight: false });
  expect(data.result.boxes[0].items[1]).not.toHaveProperty('center');
  const calls = http.request.mock.calls.length;
  await expect(service.poll('b'.repeat(24), jobId)).rejects.toMatchObject({ status: 404 });
  await expect(service.poll(owner, '../api/jobs')).rejects.toMatchObject({ status: 404 });
  records.get(jobId).expiresAt = new Date(0);
  await expect(service.poll(owner, jobId)).rejects.toMatchObject({ status: 404 });
  expect(http.request).toHaveBeenCalledTimes(calls);
});
test('weights use content, not reserved envelopes, include soft volume, and flag overloaded boxes', () => {
  const plan = result(); plan.boxes.push({ ...plan.boxes[0], id: 'box-2', contentVolume: 24000 });
  const data = addWeightEstimates(plan, [{ id: 'Medium', emptyWeight: .5, maxLoadWeight: 1.3 }]);
  expect(data.boxes[0].weightEstimate.exceedsMaxLoadWeight).toBe(true);
  expect(data.boxes[1].weightEstimate).toMatchObject({ estimatedCushionWeight: 0, estimatedShipmentWeight: 1.7, exceedsMaxLoadWeight: false });
});
test('malformed provider manifests are rejected before they reach result rendering', () => {
  const plan = result(); delete plan.boxes[0].items[1].dimensions;
  expect(() => addWeightEstimates(plan, [box])).toThrow('Invalid packed box');
});
test('box selection rejects disabled, missing, or unrepresentable catalog boxes', async () => {
  for (const boxIds of [['Disabled'], ['Missing'], ['Medium', 'Missing']]) {
    await expect(service.submit(owner, { items: [item], boxIds })).rejects.toMatchObject({ status: 400 });
  }
  catalog.read.mockResolvedValue({ containers: [{ ...box, w: .01 }], revision: 1 });
  await expect(service.submit(owner, { items: [item] })).rejects.toMatchObject({ status: 400 });
  expect(http.request).not.toHaveBeenCalled();
});
test.each([
  { items: [{ ...item, width: '10' }] }, { items: [{ ...item, soft: 'true' }] },
  { items: [{ ...item, quantity: 501 }] }, { items: [item, item] },
  { items: [{ ...item, quantity: 500 }, { ...item, id: 'extra' }] },
  { items: [{ ...item, shrink: 96 }] }, { items: [{ ...item, value: 2e9 + 1 }] },
  { items: [item], options: { margin: -1 } }, { items: [item], options: { maxSide: 0 } },
  { items: [item], ownerId: owner }, { items: [item], boxes: [] }, { items: [item], boxIds: [] },
])('rejects invalid inputs before provider work %#', async input => {
  await expect(service.submit(owner, input)).rejects.toThrow(); expect(http.request).not.toHaveBeenCalled();
});
test('permits exactly 500 items, zero preferred loads, defaults and null preferences', () => {
  expect(requestSchema.parse({ items: [{ ...item, quantity: 500 }], options: { maxWeight: 0, maxValue: 0, maxSide: null } })).toMatchObject({ options: { approach: 'boxes', margin: 0, maxWeight: 0 } });
  expect(requestSchema.parse({ items: [item] }).items[0]).toMatchObject({ rotation: 'orthogonal', soft: false, quantity: 1 });
});
test.each(['file:///tmp', 'http://u:p@worker.test', 'http://worker.test/other', 'http://worker.test/?x=1', 'http://worker.test/#x'])('rejects non-origin configuration %s', value => {
  expect(() => configuredOrigin(value)).toThrow();
});
test('sanitizes provider failure and refuses invalid/mismatched job responses', async () => {
  await service.submit(owner, { items: [item] });
  http.request.mockResolvedValue({ data: { ...job('failed'), error: { message: 'private payload' }, statusUrl: 'http://evil.test' } });
  const data = await service.poll(owner, jobId);
  expect(JSON.stringify(data)).not.toContain('private payload'); expect(data.statusUrl).toBeUndefined();
  expect(log.warning).toHaveBeenCalled(); expect(JSON.stringify(log.warning.mock.calls)).not.toContain('private payload');
  await service.poll(owner, jobId); expect(log.warning).toHaveBeenCalledTimes(1);
  http.request.mockResolvedValue({ data: { ...job('queued'), jobId: '80d2a9fb-4092-452e-bc50-4c974ffa2974' } });
  await expect(service.poll(owner, jobId)).rejects.toThrow('Invalid packing job');
  http.request.mockRejectedValue({ response: { status: 404 } });
  await expect(service.poll(owner, jobId)).rejects.toMatchObject({ status: 404 });
});
test('bounds concurrent upstream requests and releases capacity after failure', async () => {
  const rejects = [];
  http.request.mockImplementation(() => new Promise((_, fail) => { rejects.push(fail); }));
  // Polling known jobs avoids creating unobserved records during this check.
  records.set(jobId, { ownerId: owner, expiresAt: new Date(Date.now() + 10000), boxes: [] });
  const pending = Array.from({ length: 4 }, () => service.poll(owner, jobId).catch(error => error));
  await new Promise(resolve => setImmediate(resolve));
  await expect(service.poll(owner, jobId)).rejects.toMatchObject({ status: 429 });
  rejects.forEach(reject => reject(new Error('timeout'))); await Promise.all(pending);
  http.request.mockResolvedValue({ data: job('queued') });
  expect(await service.poll(owner, jobId)).toMatchObject({ status: 'queued' });
});
