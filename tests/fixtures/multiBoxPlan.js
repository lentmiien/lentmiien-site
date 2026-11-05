const jobId = '70d2a9fb-4092-452e-bc50-4c974ffa2974';
const owner = 'a'.repeat(24);
const box = { id: 'Medium', w: 400, h: 300, d: 200, maxLoadWeight: 10, emptyWeight: .5, tags: ['carton'] };
const item = { id: 'Rigid', width: 10, height: 5, depth: 2, weight: 1 };
const result = () => ({ version: 1, units: { dimensions: 'cm', weight: 'kg' }, coordinates: 'X width, Y height, Z depth; cm',
  options: { approach: 'boxes', margin: 1 }, unplaced: [], stats: { inputItems: 2, packedItems: 2, boxCount: 1, fill: .1 },
  boxes: [{ id: 'box-1', type: 'Medium', dimensions: [40, 30, 20], innerDimensions: [38, 28, 18],
    boxVolume: 24000, usableVolume: 19152, contentVolume: 1000, reservedVolume: 1500, weight: 1.2, value: 5,
    fallback: false, fallbackReasons: [], items: [
      { uid: 'item-1-1', id: 'Rigid', copy: 1, dimensions: [10, 5, 2], center: [6, 3.5, 2], position: [1,1,1],
        orientation: { matrix: [1,0,0,0,1,0,0,0,1] }, weight: 1, value: 5, rotation: 'orthogonal', soft: false },
      { uid: 'item-2-1', id: 'Soft', copy: 1, dimensions: [10, 9, 10], weight: .2, value: 0, soft: true, shrink: 20 },
    ] }],
});
const job = status => ({ jobId, status, queuePosition: status === 'queued' ? 1 : null, createdAt: '2026-11-05T08:00:00Z',
  startedAt: null, finishedAt: null, expiresAt: null, attempts: 0, progress: null,
  ...(status === 'completed' ? { result: result() } : {}) });
module.exports = { jobId, owner, box, item, result, job };
