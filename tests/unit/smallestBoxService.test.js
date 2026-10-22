const { findSmallestBox } = require('../../services/smallestBoxService');
const { searchSchema, catalogSchema } = require('../../utils/smallestBoxValidation');
const item = { id: 'item', w: 2, d: 3, h: 4, weight: 1, qty: 1 };
const box = (id, w = 10, d = 10, h = 10) => ({ id, w, d, h, emptyWeight: 0, maxLoadWeight: 10 });
const placed = (items = [item]) => ({ success: true, containersUsed: 1, notPlaced: [], pallets: [{ placements:
  items.flatMap(entry => Array.from({ length: entry.qty }, (_, i) => ({ itemId: entry.id,
    x: i * entry.w, y: 0, z: 0, w: entry.w, d: entry.d, h: entry.h }))) }] });

test('filters by rotation-aware dimensions, total quantity volume and weight, then sorts by volume', async () => {
  const packer = jest.fn().mockImplementation(async () => placed());
  const result = await findSmallestBox([
    box('large'), box('thin', 1, 100, 100), box('small', 2, 3, 4),
    { ...box('overweight'), maxLoadWeight: 0 },
  ], { items: [item] }, { packer });
  expect(result.success).toBe(true);
  expect(result.container.id).toBe('small');
  expect(result.meta).toMatchObject({ attempts: 1, filteredContainers: 2, eligibleContainers: 2 });
  expect(packer).toHaveBeenCalledTimes(1);
  expect(packer.mock.calls[0][0]).toMatchObject({ maxContainers: 1, minimizeContainers: true,
    items: [{ ...item, rotate3D: true }] });
});
test('retains containers that fit only after rotation', async () => {
  const packer = jest.fn().mockResolvedValue({ ...placed(), pallets: [{ placements: [
    { itemId: 'item', x: 0, y: 0, z: 0, w: 4, d: 2, h: 3 },
  ] }] });
  const result = await findSmallestBox([box('rotated', 4, 2, 3)], { items: [item] }, { packer });
  expect(result.success).toBe(true);
});
test('total quantity volume and weight filter before calling worker', async () => {
  const packer = jest.fn();
  const result = await findSmallestBox([box('one-only', 2, 3, 4), { ...box('light'), maxLoadWeight: 1 }],
    { items: [{ ...item, qty: 2 }] }, { packer });
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
  const result = await findSmallestBox([box('big'), box('small', 4, 4, 4)], { items: [item] }, { packer });
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
    const result = await findSmallestBox([box('box')], { items }, { packer: async () => data });
    expect(result.success).toBe(false);
  }
});
test('stops on worker errors rather than recommending a larger box', async () => {
  const packer = jest.fn().mockRejectedValue(new Error('offline'));
  await expect(findSmallestBox([box('small', 4, 4, 4), box('large')], { items: [item] }, { packer })).rejects.toThrow('offline');
  expect(packer).toHaveBeenCalledTimes(1);
});
test('supports empty/exhausted catalogs and deterministic equal-volume ordering', async () => {
  const packer = jest.fn().mockResolvedValue({ success: false });
  expect((await findSmallestBox([], { items: [item] }, { packer })).message).toContain('Save at least');
  const result = await findSmallestBox([box('b'), box('a')], { items: [item] }, { packer });
  expect(result.success).toBe(false);
  expect(result.meta.attempts).toBe(2);
  expect(packer.mock.calls.map(([payload]) => payload.container.id)).toEqual(['a', 'b']);
});
test('cancellation prevents further attempts', async () => {
  const controller = new AbortController();
  const packer = jest.fn().mockImplementation(async () => { controller.abort(); return { success: false }; });
  await expect(findSmallestBox([box('a'), box('b')], { items: [item] }, { packer, signal: controller.signal })).rejects.toThrow();
  expect(packer).toHaveBeenCalledTimes(1);
});
test('rejects unbounded, malformed, duplicate and privileged input', () => {
  for (const body of [{ items: [] }, { items: [item], ownerId: 'foreign' }, { items: [item, item] },
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
    expect((await findSmallestBox([box('box')], { items: [item] })).success).toBe(true);
    expect(post).toHaveBeenCalledWith(worker.apiUrl, expect.objectContaining({ maxContainers: 1 }),
      expect.objectContaining({ timeout: 15000, maxRedirects: 0, maxContentLength: 2097152,
        maxBodyLength: 65536, signal: expect.any(AbortSignal) }));
  } finally { post.mockRestore(); }
});


test('50 tagged boxes are accepted; exclusions win and unmatched/untagged boxes stay eligible', async () => {
  const packer = jest.fn().mockResolvedValue({ success: false });
  const containers = Array.from({ length: 50 }, (_, i) => ({ ...box(String(i)), tags: i === 0 ? ['tube', 'fold-box'] : i === 1 ? ['other'] : [] }));
  const result = await findSmallestBox(containers, { items: [item], tagFilter: { require: [' FOLD-BOX '], requireNot: ['TUBE'] } }, { packer });
  expect(result.meta).toMatchObject({ totalContainers: 50, tagFilteredContainers: 1, eligibleContainers: 49, attempts: 49 });
  expect(packer.mock.calls.map(([payload]) => payload.container.id)).not.toContain('0');
  expect(packer.mock.calls.map(([payload]) => payload.container.id)).toContain('1');
  expect(packer.mock.calls[0][0].container).not.toHaveProperty('tags');
});
test.each([undefined, {}, { require: ['tube'] }, { requireNot: ['unknown'] }])('empty, positive-only and unmatched filters include all boxes: %j', async tagFilter => {
  const packer = jest.fn().mockResolvedValue({ success: false });
  const result = await findSmallestBox([{ ...box('tube'), tags: ['tube'] }, box('untagged')], { items: [item], tagFilter }, { packer });
  expect(result.meta.eligibleContainers).toBe(2);
});
test('invalid tags and privileged tag-filter fields fail validation', () => {
  for (const tagFilter of [{ requireNot: ['<script>'] }, { require: ['a'.repeat(41)] }, { requireNot: Array(21).fill('tube') }, { owner: 'foreign' }]) {
    expect(searchSchema.safeParse({ items: [item], tagFilter }).success).toBe(false);
  }
  expect(catalogSchema.parse({ containers: [box('legacy')] }).containers[0].tags).toEqual([]);
});
