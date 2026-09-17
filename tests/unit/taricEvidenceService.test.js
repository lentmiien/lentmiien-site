const { createTaricEvidenceService } = require('../../services/taricEvidenceService');

const request = { item_code: 'FIGURE-0001', descriptive_name: 'Not a source name', input_hs_code: '123456' };
const details = { gcode: request.item_code, itemName: 'Source figure', janCode: '00123456', specifications: 'PVC' };
function local(changes = {}) {
  return { _id: 'row1', updatedAt: new Date(1000), gcode: request.item_code,
    listing: { gcode: request.item_code, itemName: 'Listing figure' }, details, detailStatus: 'fetched', ...changes };
}
function setup(rows = [], fetchFactual = null) {
  let stored = rows;
  const model = {
    aggregate: jest.fn((pipeline) => ({ option: jest.fn().mockReturnValue({ exec: async () => {
      const filter = pipeline[0].$match;
      if (filter['details.janCode']) return [...new Set(stored.filter((r) => r.details?.janCode === filter['details.janCode'])
        .map((r) => r.gcode))].slice(0, 2).map((gcode) => ({ gcode }));
      return stored.filter((r) => r.gcode === filter.gcode).slice(0, 2);
    } }) })),
    updateOne: jest.fn((filter, update) => ({ exec: async () => {
      const row = stored.find((r) => r.gcode === filter.gcode);
      if (update.$setOnInsert && !row) stored.push(update.$setOnInsert);
      if (update.$set && row && row.updatedAt === filter.updatedAt) {
        for (const [key, value] of Object.entries(update.$set)) {
          if (key.startsWith('details.')) row.details[key.slice(8)] = value;
          else row[key] = value;
        }
      }
    } })),
  };
  let time = 2000;
  const serviceLogger = { warning: jest.fn() };
  return { model, serviceLogger, service: createTaricEvidenceService({ itemModel: model, fetchFactual,
    serviceLogger, now: () => time }), rows: () => stored, setRows: (value) => { stored = value; },
  advance: () => { time += 60001; } };
}
describe('TARIC factual resolver (synthetic database and fetch only)', () => {
  test('direct local lookup is bounded and never scrapes when a credible name exists', async () => {
    const fetcher = jest.fn();
    const { service, model } = setup([local({ details: { gcode: request.item_code } })], fetcher);
    const evidence = await service.resolve(request);
    expect(evidence.facts.name).toBe('Listing figure');
    expect(evidence.warnings).toContain('specifications_missing');
    expect(fetcher).not.toHaveBeenCalled();
    const pipeline = model.aggregate.mock.calls[0][0];
    expect(pipeline[1]).toEqual({ $limit: 2 });
    expect(JSON.stringify(pipeline[2])).toContain('$substrCP');
    expect(JSON.stringify(pipeline[2])).not.toContain('raw');
    expect(model.aggregate.mock.results[0].value.option).toHaveBeenCalledWith({ maxTimeMS: 2000 });
  });
  test('JAN-only requires uniqueness; an agreeing item code disambiguates', async () => {
    const a = local();
    const b = local({ gcode: 'FIGURE-2', listing: { gcode: 'FIGURE-2' }, details: { ...details, gcode: 'FIGURE-2' } });
    const { service } = setup([a, b]);
    const { item_code, ...withoutCode } = request;
    await expect(service.resolve({ ...withoutCode, jan: '00123456' })).rejects.toMatchObject({ code: 'JAN_AMBIGUOUS' });
    expect((await service.resolve({ ...request, jan: '00123456' })).provenance.identity).toBe('both_agree');
    const unique = setup([a]).service;
    expect((await unique.resolve({ ...withoutCode, jan: '00123456' })).provenance.resolution).toBe('local_jan');
  });
  test('JAN-only miss never searches online', async () => {
    const fetcher = jest.fn();
    const { service } = setup([], fetcher);
    const { item_code, ...withoutCode } = request;
    await expect(service.resolve({ ...withoutCode, jan: '00123456' })).rejects.toMatchObject({ code: 'EVIDENCE_NOT_FOUND' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  test.each([
    { listing: { gcode: 'OTHER' } }, { details: { ...details, gcode: 'OTHER' } },
    { details: { ...details, janCode: '12345678' } },
  ])('rejects inconsistent stored identities without repair %j', async (changes) => {
    const fetcher = jest.fn();
    const { service } = setup([local(changes)], fetcher);
    await expect(service.resolve({ ...request, jan: '00123456' })).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  test('keeps differing scode as provenance while enforcing selected gcode and JAN', async () => {
    const fetcher = jest.fn();
    const state = setup([local({ details: { ...details, scode: 'separate_upstream_code' } })], fetcher);
    const evidence = await state.service.resolve({ ...request, jan: '00123456' });
    expect(evidence).toMatchObject({ gcode: request.item_code, jan: '00123456',
      provenance: { identity: 'both_agree', scode: 'separate_upstream_code' } });
    expect(evidence.facts).not.toHaveProperty('scode');
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.model.updateOne).not.toHaveBeenCalled();
  });
  test('persists a fetched differing scode without treating it as identity or a fact', async () => {
    const state = setup([], jest.fn().mockResolvedValue({ ...details, scode: 'separate_upstream_code' }));
    const evidence = await state.service.resolve({ ...request, jan: '00123456' });
    expect(evidence.provenance).toMatchObject({ resolution: 'online_item_code',
      identity: 'both_agree', scode: 'separate_upstream_code' });
    expect(state.rows()[0].details).toMatchObject({ gcode: request.item_code, scode: 'separate_upstream_code' });
    expect(evidence.facts).not.toHaveProperty('scode');
  });
  test('missing JAN cannot assert both identifiers agree', async () => {
    const { service } = setup([local({ details: { ...details, janCode: null } })]);
    await expect(service.resolve({ ...request, jan: '00123456' })).rejects.toMatchObject({ code: 'IDENTITY_UNVERIFIABLE' });
  });
  test.each([{ rows: [] }, { rows: [local({ detailStatus: 'error', details: null })] },
    { rows: [local({ details: null, listing: { gcode: request.item_code, itemName: request.item_code } })] }])(
    'fetches and persists only validated factual allowlist for missing/incomplete/error rows', async ({ rows }) => {
      const fetcher = jest.fn().mockResolvedValue({ ...details, raw: { secret: 'not persisted' }, sourceUrl: 'https://evil.test' });
      const { service, model } = setup(rows, fetcher);
      const result = await service.resolve({ ...request, jan: '00123456' });
      expect(result.facts.name).toBe('Source figure');
      expect(result.provenance.identity).toBe('both_agree');
      expect(model.updateOne).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(model.updateOne.mock.calls)).not.toContain('evil.test');
      expect(JSON.stringify(model.updateOne.mock.calls)).not.toContain('secret');
    });
  test.each([{ ...details, gcode: 'WRONG', scode: request.item_code }, { ...details, janCode: '12345678' },
    { ...details, janCode: null }, { ...details, itemName: request.item_code }])(
    'does not persist mismatched, unverifiable or code-as-name responses', async (response) => {
      const { service, model } = setup([], jest.fn().mockResolvedValue(response));
      await expect(service.resolve({ ...request, jan: '00123456' })).rejects.toThrow();
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  test('failed attempts do not insert failed evidence and are retried only after the cooldown', async () => {
    const fetcher = jest.fn().mockRejectedValue(new Error('sensitive raw body'));
    const state = setup([], fetcher);
    await expect(state.service.resolve(request)).rejects.toMatchObject({ code: 'FETCH_FAILED' });
    await expect(state.service.resolve(request)).rejects.toMatchObject({ code: 'FETCH_LIMITED' });
    expect(state.model.updateOne).not.toHaveBeenCalled();
    expect(JSON.stringify(state.serviceLogger.warning.mock.calls)).not.toContain('sensitive');
    state.advance();
    fetcher.mockResolvedValue(details);
    expect((await state.service.resolve(request)).facts.name).toBe('Source figure');
  });
  test('successful refresh preserves legacy fields outside the allowlist', async () => {
    const source = local({ detailStatus: 'error', details: { ...details, price: { currentJpy: 1200 },
      flags: { preOwned: true }, imageLinks: ['https://img.amiami.com/test.jpg'] } });
    const state = setup([source], jest.fn().mockResolvedValue({ ...details, itemName: 'Fresh figure' }));
    expect((await state.service.resolve(request)).facts.name).toBe('Fresh figure');
    expect(source.details).toMatchObject({ price: { currentJpy: 1200 }, flags: { preOwned: true },
      imageLinks: ['https://img.amiami.com/test.jpg'] });
    expect(state.model.updateOne.mock.calls[0][1].$set).not.toHaveProperty('details');
  });
  test('default fetching is disabled and never invents a factual name from the request', async () => {
    const state = setup();
    await expect(state.service.resolve(request)).rejects.toMatchObject({ code: 'FETCH_DISABLED' });
    expect(state.model.updateOne).not.toHaveBeenCalled();
  });
  test('persisted race winner is validated, including duplicate-key races', async () => {
    const state = setup([], jest.fn().mockResolvedValue(details));
    state.model.updateOne.mockImplementation(() => ({ exec: async () => {
      state.setRows([local({ details: { ...details, janCode: '12345678' } })]);
      throw Object.assign(new Error('duplicate'), { code: 11000 });
    } }));
    await expect(state.service.resolve({ ...request, jan: '00123456' })).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
  });
  test('returns a valid race winner, not discarded fetched facts', async () => {
    const state = setup([], jest.fn().mockResolvedValue(details));
    state.model.updateOne.mockImplementation(() => ({ exec: async () => {
      state.setRows([local({ details: { ...details, itemName: 'Winner name' } })]);
    } }));
    expect((await state.service.resolve(request)).facts.name).toBe('Winner name');
  });
  test('legacy rows without CAS metadata cannot be overwritten', async () => {
    const fetcher = jest.fn();
    const state = setup([local({ updatedAt: null, detailStatus: 'error' })], fetcher);
    await expect(state.service.resolve(request)).rejects.toMatchObject({ code: 'EVIDENCE_RACE' });
    expect(fetcher).not.toHaveBeenCalled();
  });
  test('same-code concurrency is bounded', async () => {
    let finish;
    const fetcher = jest.fn(() => new Promise((resolve) => { finish = resolve; }));
    const state = setup([], fetcher);
    const first = state.service.resolve(request);
    await new Promise(setImmediate);
    await expect(state.service.resolve(request)).rejects.toMatchObject({ code: 'FETCH_LIMITED' });
    finish(details);
    await first;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  test('two active fetches and twenty attempts per minute bound distinct-code work', async () => {
    const pending = [];
    const fetcher = jest.fn((gcode) => new Promise((resolve) => pending.push(() => resolve({ ...details, gcode }))));
    const state = setup([], fetcher);
    const first = state.service.resolve(request);
    const second = state.service.resolve({ ...request, item_code: 'FIGURE-2' });
    await new Promise(setImmediate);
    await expect(state.service.resolve({ ...request, item_code: 'FIGURE-3' })).rejects.toMatchObject({ code: 'FETCH_LIMITED' });
    pending.forEach((finish) => finish());
    await Promise.all([first, second]);
    fetcher.mockImplementation(async (gcode) => ({ ...details, gcode }));
    for (let index = 3; index <= 20; index += 1) {
      await state.service.resolve({ ...request, item_code: `FIGURE-${index}` });
    }
    await expect(state.service.resolve({ ...request, item_code: 'FIGURE-21' })).rejects.toMatchObject({ code: 'FETCH_LIMITED' });
    expect(fetcher).toHaveBeenCalledTimes(20);
    state.advance();
    await expect(state.service.resolve({ ...request, item_code: 'FIGURE-21' })).resolves.toMatchObject({ gcode: 'FIGURE-21' });
  });
  test('a failed CAS preserves and validates the concurrently refreshed winner', async () => {
    const state = setup([local({ detailStatus: 'error' })], jest.fn().mockResolvedValue(details));
    state.model.updateOne.mockImplementation((filter) => ({ exec: async () => {
      expect(filter).toEqual({ _id: 'row1', gcode: request.item_code, updatedAt: new Date(1000) });
      state.setRows([local({ updatedAt: new Date(3000), details: { ...details, gcode: 'MISMATCH' } })]);
      return { matchedCount: 0 };
    } }));
    await expect(state.service.resolve(request)).rejects.toMatchObject({ code: 'IDENTITY_MISMATCH' });
  });
});
