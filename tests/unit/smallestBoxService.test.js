const { findSmallestBox } = require('../../services/smallestBoxService');
const { searchSchema, catalogSchema } = require('../../utils/smallestBoxValidation');
const item = { id: 'item', w: 2, d: 3, h: 4, weight: 1, qty: 1 };
const box = (id, w = 10, d = 10, h = 10) => ({ id, w, d, h, emptyWeight: 0, maxLoadWeight: 10 });
const placed = (items = [item]) => ({ success: true, containersUsed: 1, notPlaced: [], pallets: [{ placements:
  items.flatMap(entry => Array.from({ length: entry.qty }, (_, i) => ({ itemId: entry.id,
    x: i * entry.w, y: 0, z: 0, w: entry.w, d: entry.d, h: entry.h }))) }] });

test('default margin shrinks the worker box and offsets placements while retaining full box dimensions', async () => {
  const packer = jest.fn().mockResolvedValue(placed());
  const container = { ...box('margin', 22, 23, 24), emptyWeight: 0.2 };
  const result = await findSmallestBox([container], { items: [item] }, { packer });
  expect(packer.mock.calls[0][0].container).toMatchObject({ w: 2, d: 3, h: 4 });
  expect(result.container).toMatchObject(container);
  expect(result.data.pallets[0]).toMatchObject({ w: 22, d: 23, h: 24, placements: [
    { itemId: 'item', x: 10, y: 10, z: 10, w: 2, d: 3, h: 4 },
  ] });
  expect(result.meta).toMatchObject({ safetyMarginMm: 10, emptyVolume: 12120, usableDimensions: { w: 2, d: 3, h: 4 } });
  expect(result.estimatedCushionWeight).toBeCloseTo(12120 * 8.22e-9, 12);
  expect(result.estimatedShipmentWeight).toBeCloseTo(1.2 + result.estimatedCushionWeight, 12);
  expect(packer.mock.calls[0][0].container.maxLoadWeight).toBeCloseTo(10 - result.estimatedCushionWeight, 12);
  expect(result.alternatives).toEqual([]);
});
test('zero margin permits an exact fit with zero cushion and counts quantity in shipment weight', async () => {
  const items = [{ ...item, qty: 2 }];
  const result = await findSmallestBox([{ ...box('exact', 4, 3, 4), emptyWeight: 0.2 }],
    { items, safetyMarginMm: 0 }, { packer: async () => placed(items) });
  expect(result.success).toBe(true);
  expect(result.estimatedCushionWeight).toBe(0);
  expect(result.estimatedShipmentWeight).toBe(2.2);
  expect(result.data.pallets[0].placements[1].x).toBe(2);
});
test('returns only three solutions in full volume order, skipping failed candidates', async () => {
  const packer = jest.fn(async payload => payload.container.id === 'b' ? { success: false } : placed());
  const result = await findSmallestBox([box('e', 60, 60, 60), box('c', 40, 40, 40), box('a', 24, 24, 24),
    box('d', 50, 50, 50), box('b', 30, 30, 30)], { items: [item] }, { packer });
  expect([result, ...result.alternatives].map(solution => solution.container.id)).toEqual(['a', 'c', 'd']);
  expect(packer.mock.calls.map(([payload]) => payload.container.id)).toEqual(['a', 'b', 'c', 'd']);
  for (const solution of [result, ...result.alternatives]) {
    expect(solution.meta.attempts).toBe(4);
    expect(solution.estimatedCushionWeight).toBeCloseTo((solution.container.w ** 3 - 24) * 8.22e-9, 12);
    expect(solution.data.pallets).toHaveLength(1);
    expect(solution.meta.alternativesSearchComplete).toBe(true);
  }
});
test('margin excludes nonpositive usable dimensions and insufficient usable volume before packing', async () => {
  const packer = jest.fn();
  const result = await findSmallestBox([box('zero', 20, 100, 100), box('negative', 19, 100, 100), box('small', 21, 21, 21)],
    { items: [item] }, { packer });
  expect(result.success).toBe(false);
  expect(packer).not.toHaveBeenCalled();
});
test('worker placements must fit within the reduced dimensions', async () => {
  const data = placed(); data.pallets[0].placements[0].x = 1;
  const result = await findSmallestBox([box('margin', 22, 23, 24)], { items: [item] }, { packer: async () => data });
  expect(result.success).toBe(false);
});
test('estimated cushion uses full empty volume and prevents exceeding the contents weight limit', async () => {
  const largeItem = { ...item, w: 500, d: 500, h: 500 };
  const packer = jest.fn().mockResolvedValue(placed([largeItem]));
  const result = await findSmallestBox([{ ...box('too-heavy', 1000, 1000, 1000), maxLoadWeight: 8 },
    { ...box('heavy-ok', 1000, 1000, 1000), maxLoadWeight: 9 }],
  { items: [largeItem] }, { packer });
  expect(packer).toHaveBeenCalledTimes(1);
  expect(result.container.id).toBe('heavy-ok');
  expect(result.estimatedCushionWeight).toBeCloseTo(7.1925, 8);
});
test('preserves completed solutions if a later worker fails and logs the incomplete search', async () => {
  const packer = jest.fn().mockResolvedValueOnce(placed()).mockRejectedValueOnce(new Error('private upstream text'));
  const log = { warning: jest.fn() };
  const result = await findSmallestBox([box('a', 30, 30, 30), box('b', 40, 40, 40)], { items: [item] }, { packer, log });
  expect(result.success).toBe(true);
  expect(result.meta.alternativesSearchComplete).toBe(false);
  expect(result.alternatives).toEqual([]);
  expect(log.warning).toHaveBeenCalled();
  expect(JSON.stringify(log.warning.mock.calls)).not.toContain('private upstream text');
});
test('cancellation during alternative search still aborts the request', async () => {
  const controller = new AbortController();
  const packer = jest.fn().mockResolvedValueOnce(placed()).mockImplementationOnce(async () => { controller.abort(); return placed(); });
  await expect(findSmallestBox([box('a', 30, 30, 30), box('b', 40, 40, 40)], { items: [item] },
    { packer, signal: controller.signal })).rejects.toThrow();
});
test('deadline during alternative search returns completed solutions with an incomplete-search flag', async () => {
  const deadline = new AbortController();
  const timeout = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
  const packer = jest.fn().mockResolvedValueOnce(placed()).mockImplementationOnce(async () => {
    deadline.abort(new DOMException('Deadline reached', 'TimeoutError')); return placed();
  });
  const log = { warning: jest.fn() };
  try {
    const result = await findSmallestBox([box('a', 30, 30, 30), box('b', 40, 40, 40)], { items: [item] }, { packer, log });
    expect(result.container.id).toBe('a');
    expect(result.meta.alternativesSearchComplete).toBe(false);
    expect(log.warning).toHaveBeenCalled();
  } finally { timeout.mockRestore(); }
});
test.each([-1, 500001, Infinity, NaN, '10', null])('rejects invalid margin %p', safetyMarginMm => {
  expect(searchSchema.safeParse({ items: [item], safetyMarginMm }).success).toBe(false);
});

test('filters by rotation-aware dimensions, total quantity volume and weight, then sorts by volume', async () => {
  const packer = jest.fn().mockImplementation(async () => placed());
  const result = await findSmallestBox([
    box('large'), box('thin', 1, 100, 100), box('small', 2, 3, 4),
    { ...box('overweight'), maxLoadWeight: 0 },
  ], { safetyMarginMm: 0, items: [item] }, { packer });
  expect(result.success).toBe(true);
  expect(result.container.id).toBe('small');
  expect(result.meta).toMatchObject({ attempts: 2, filteredContainers: 2, eligibleContainers: 2 });
  expect(packer).toHaveBeenCalledTimes(2);
  expect(result.alternatives.map(solution => solution.container.id)).toEqual(['large']);
  expect(packer.mock.calls[0][0]).toMatchObject({ maxContainers: 1, minimizeContainers: true,
    items: [{ ...item, rotate3D: true }] });
});
test('retains containers that fit only after rotation', async () => {
  const packer = jest.fn().mockResolvedValue({ ...placed(), pallets: [{ placements: [
    { itemId: 'item', x: 0, y: 0, z: 0, w: 4, d: 2, h: 3 },
  ] }] });
  const result = await findSmallestBox([box('rotated', 4, 2, 3)], { safetyMarginMm: 0, items: [item] }, { packer });
  expect(result.success).toBe(true);
});
test('total quantity volume and weight filter before calling worker', async () => {
  const packer = jest.fn();
  const result = await findSmallestBox([box('one-only', 2, 3, 4), { ...box('light'), maxLoadWeight: 1 }],
    { safetyMarginMm: 0, items: [{ ...item, qty: 2 }] }, { packer });
  expect(result.success).toBe(false);
  expect(packer).not.toHaveBeenCalled();
});
test.each([
  { success: false },
  { ...placed(), containersUsed: 2 },
  { ...placed(), pallets: [...placed().pallets, ...placed().pallets] },
  { ...placed(), notPlaced: [{ id: 'item' }] },
  { ...placed(), pallets: [{ placements: [] }] },
  { ...placed(), pallets: [{ placements: [{ ...placed().pallets[0].placements[0], itemId: 'wrong' }] }] },
])('tries the next larger box after incomplete/multiple-container result %#', async first => {
  const packer = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(placed());
  const result = await findSmallestBox([box('big'), box('small', 4, 4, 4)], { safetyMarginMm: 0, items: [item] }, { packer });
  expect(result.container.id).toBe('big');
  expect(result.meta.attempts).toBe(2);
  expect(packer.mock.calls.map(([payload]) => payload.container.id)).toEqual(['small', 'big']);
});
test('rejects missing copies, overlapping and out-of-bounds placements', async () => {
  const items = [{ ...item, qty: 2 }];
  for (const data of [placed(), { ...placed(items), pallets: [{ placements: [
    placed().pallets[0].placements[0], placed().pallets[0].placements[0],
  ] }] }, { ...placed(items), pallets: [{ placements: [
    placed().pallets[0].placements[0], { ...placed().pallets[0].placements[0], x: 99 },
  ] }] }]) {
    const result = await findSmallestBox([box('box')], { safetyMarginMm: 0, items }, { packer: async () => data });
    expect(result.success).toBe(false);
  }
});
test('stops on worker errors rather than recommending a larger box', async () => {
  const packer = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(findSmallestBox([box('small', 4, 4, 4), box('large')], { safetyMarginMm: 0, items: [item] }, { packer })).rejects.toThrow('offline');
  expect(packer).toHaveBeenCalledTimes(1);
});
test('supports empty/exhausted catalogs and deterministic equal-volume ordering', async () => {
  const packer = jest.fn().mockResolvedValue({ success: false });
  expect((await findSmallestBox([], { safetyMarginMm: 0, items: [item] }, { packer })).message).toContain('Save at least');
  const result = await findSmallestBox([box('b'), box('a')], { safetyMarginMm: 0, items: [item] }, { packer });
  expect(result.success).toBe(false);
  expect(result.meta.attempts).toBe(2);
  expect(packer.mock.calls.map(([payload]) => payload.container.id)).toEqual(['a', 'b']);
});
test('cancellation prevents further attempts', async () => {
  const controller = new AbortController();
  const packer = jest.fn().mockImplementation(async () => { controller.abort(); return { success: false }; });
  await expect(findSmallestBox([box('a'), box('b')], { safetyMarginMm: 0, items: [item] }, { packer, signal: controller.signal })).rejects.toThrow();
  expect(packer).toHaveBeenCalledTimes(1);
});
test('rejects unbounded, malformed, duplicate and privileged input', () => {
  for (const body of [{ items: [] }, { safetyMarginMm: 0, items: [item], ownerId: 'foreign' }, { items: [item, item] },
    { items: [{ ...item, qty: 201 }] }, { items: [{ ...item, w: Infinity }] },
    { items: [{ ...item, weight: -1 }] }, { items: [{ ...item, w: '2' }] },
    { items: [{ ...item, qty: 1.5 }] }, { items: [{ ...item, id: 'x'.repeat(101) }] },
    { items: [{ ...item, qty: 8 }], algorithm: 'bruteforce' }]) {
    expect(searchSchema.safeParse(body).success).toBe(false);
  }
  expect(catalogSchema.safeParse({ containers: Array.from({ length: 51 }, (_, i) => box(String(i))) }).success).toBe(false);
  expect(catalogSchema.safeParse({ containers: [box('same'), box('same')] }).success).toBe(false);
  expect(catalogSchema.safeParse({ containers: [] }).success).toBe(true);
});

test('default transport uses the configured worker with bounded time, size and no redirects', async () => {
  const axios = require('axios');
  const worker = require('../../services/binPackingService');
  const post = jest.spyOn(axios, 'post').mockResolvedValue({ data: placed() });
  try {
    expect((await findSmallestBox([box('box')], { safetyMarginMm: 0, items: [item] })).success).toBe(true);
    expect(post).toHaveBeenCalledWith(worker.apiUrl, expect.objectContaining({ maxContainers: 1 }),
      expect.objectContaining({ timeout: 15000, maxRedirects: 0, maxContentLength: 2097152,
        maxBodyLength: 65536, signal: expect.any(AbortSignal) }));
  } finally { post.mockRestore(); }
});


test('50 tagged boxes are accepted; exclusions win and unmatched/untagged boxes stay eligible', async () => {
  const packer = jest.fn().mockResolvedValue({ success: false });
  const containers = Array.from({ length: 50 }, (_, i) => ({ ...box(String(i)), tags: i === 0 ? ['tube', 'fold-box'] : i === 1 ? ['other'] : [] }));
  const result = await findSmallestBox(containers, { safetyMarginMm: 0, items: [item], tagFilter: { require: [' FOLD-BOX '], requireNot: ['TUBE'] } }, { packer });
  expect(result.meta).toMatchObject({ totalContainers: 50, tagFilteredContainers: 1, eligibleContainers: 49, attempts: 49 });
  expect(packer.mock.calls.map(([payload]) => payload.container.id)).not.toContain('0');
  expect(packer.mock.calls.map(([payload]) => payload.container.id)).toContain('1');
  expect(packer.mock.calls[0][0].container).not.toHaveProperty('tags');
});
test.each([undefined, {}, { require: ['tube'] }, { requireNot: ['unknown'] }])('empty, positive-only and unmatched filters include all boxes: %j', async tagFilter => {
  const packer = jest.fn().mockResolvedValue({ success: false });
  const result = await findSmallestBox([{ ...box('tube'), tags: ['tube'] }, box('untagged')], { safetyMarginMm: 0, items: [item], tagFilter }, { packer });
  expect(result.meta.eligibleContainers).toBe(2);
});
test('invalid tags and privileged tag-filter fields fail validation', () => {
  for (const tagFilter of [{ requireNot: ['<script>'] }, { require: ['a'.repeat(41)] }, { requireNot: Array(21).fill('tube') }, { owner: 'foreign' }]) {
    expect(searchSchema.safeParse({ safetyMarginMm: 0, items: [item], tagFilter }).success).toBe(false);
  }
  expect(catalogSchema.parse({ containers: [box('legacy')] }).containers[0].tags).toEqual([]);
});
