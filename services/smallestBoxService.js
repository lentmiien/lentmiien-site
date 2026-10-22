const axios = require('axios');
const binPackingService = require('./binPackingService');
const { catalogSchema, searchSchema } = require('../utils/smallestBoxValidation');

const volume = box => box.w * box.d * box.h;
const sides = box => [box.w, box.d, box.h].sort((a, b) => a - b);

async function pack(payload, signal) {
  const response = await axios.post(binPackingService.apiUrl, payload, {
    signal, timeout: 15000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024,
    maxBodyLength: 64 * 1024,
  });
  return response.data;
}

function completeSingleBox(data, items, container) {
  if (!data || typeof data.success !== 'boolean') throw new Error('Invalid packing response');
  if (!data.success) return false;
  if (!Array.isArray(data.pallets)) throw new Error('Invalid packing response');
  if (data.pallets.length !== 1 || (data.containersUsed !== undefined && data.containersUsed !== 1)
    || (Array.isArray(data.notPlaced) && data.notPlaced.length > 0)) return false;
  const placements = data.pallets[0].placements;
  if (!Array.isArray(placements) || placements.length !== items.reduce((sum, item) => sum + item.qty, 0)) return false;
  const remaining = new Map(items.map(item => [item.id, item.qty]));
  const byId = new Map(items.map(item => [item.id, item]));
  // The worker must actually return every requested item, including each quantity.
  for (const placement of placements) {
    const item = byId.get(placement.itemId);
    if (!item || !remaining.get(item.id)) return false;
    remaining.set(item.id, remaining.get(item.id) - 1);
    const expected = sides(item);
    if (!sides(placement).every((side, i) => Number.isFinite(side) && Math.abs(side - expected[i]) <= 1e-6)) return false;
    for (const [axis, dimension] of [['x', 'w'], ['y', 'd'], ['z', 'h']]) {
      if (!Number.isFinite(placement[axis]) || placement[axis] < -1e-6
        || placement[axis] + placement[dimension] > container[dimension] + 1e-6) return false;
    }
  }
  for (let i = 0; i < placements.length; i += 1) {
    for (let j = i + 1; j < placements.length; j += 1) {
      const a = placements[i];
      const b = placements[j];
      if ([['x', 'w'], ['y', 'd'], ['z', 'h']].every(([axis, dimension]) =>
        Math.min(a[axis] + a[dimension], b[axis] + b[dimension]) - Math.max(a[axis], b[axis]) > 1e-6)) return false;
    }
  }
  return true;
}

async function findSmallestBox(containers, request, { packer = pack, signal } = {}) {
  const { items, algorithm, tagFilter } = searchSchema.parse(request);
  containers = catalogSchema.parse({ containers }).containers;
  const totalVolume = items.reduce((sum, item) => sum + volume(item) * item.qty, 0);
  const totalWeight = items.reduce((sum, item) => sum + item.weight * item.qty, 0);
  // An exclusion wins over an inclusion; unmatched boxes are included by default.
  const selected = containers.filter(container => !container.tags.some(tag => tagFilter?.requireNot.includes(tag)));
  const candidates = selected.filter(container => {
    const available = sides(container);
    return volume(container) >= totalVolume && container.maxLoadWeight >= totalWeight
      && items.every(item => sides(item).every((side, i) => side <= available[i]));
  }).sort((a, b) => volume(a) - volume(b) || a.id.localeCompare(b.id));
  const meta = { algorithm, totalItemCount: items.reduce((sum, item) => sum + item.qty, 0),
    uniqueItems: items.length, totalContainers: containers.length, tagFilteredContainers: containers.length - selected.length, eligibleContainers: candidates.length,
    filteredContainers: containers.length - candidates.length, attempts: 0 };
  const boundedSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(60000)]) : AbortSignal.timeout(60000);
  for (const container of candidates) {
    boundedSignal.throwIfAborted();
    const { tags, ...packingContainer } = container;
    const data = await packer({ algorithm, maxContainers: 1, minimizeContainers: true,
      container: packingContainer, items: items.map(item => ({ ...item, rotate3D: true })) }, boundedSignal);
    boundedSignal.throwIfAborted();
    meta.attempts += 1;
    if (completeSingleBox(data, items, container)) {
      return { success: true, container, data: { ...data,
        pallets: [{ ...data.pallets[0], containerId: container.id, w: container.w, d: container.d, h: container.h }] },
      meta: { ...meta, containerId: container.id, containerVolume: volume(container) } };
    }
  }
  return { success: false, meta, message: containers.length === 0
    ? 'Save at least one available box before searching.'
    : 'No single-box solution was found in the shared boxes with this algorithm. Try another algorithm or add a larger box.' };
}
module.exports = { findSmallestBox, completeSingleBox };
