const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const sharp = require('sharp');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const logger = require('../../utils/logger');
const { LabStore } = require('../../services/experimentalModels/storage');
const { LIMITS } = require('../../services/experimentalModels/policy');
const owner = 'a'.repeat(24), binding = randomUUID();
let root, store;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function hold() {
  const entered = deferred(), release = deferred();
  const done = store.exclusive(async () => { entered.resolve(); await release.promise; });
  await entered.promise;
  return { release: release.resolve, done };
}
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-contention-')); store = new LabStore({ root }); });
afterEach(async () => { jest.restoreAllMocks(); await fs.rm(root, { recursive: true, force: true }); });

test('normal same-owner read overlap settles automatically (c9f71aa returned storage_busy)', async () => {
  const s = await store.create(owner, binding);
  const [detail, list] = await Promise.all([store.get(owner, binding, s.id), store.list(owner, binding)]);
  expect(detail.id).toBe(s.id); expect(list.map(value => value.id)).toEqual([s.id]);
});
test('FIFO hands ownership directly to every waiter, including arrivals during handoff', async () => {
  const active = await hold(), order = [];
  const first = store.exclusive(async () => { order.push(1); });
  const second = store.exclusive(async () => { order.push(2); });
  active.release(); await active.done;
  const third = store.exclusive(async () => { order.push(3); });
  await Promise.all([first, second, third]);
  expect(order).toEqual([1, 2, 3]); expect(store.busy).toBe(false); expect(store.waiters).toEqual([]);
});
test('count and timeout bounds reject before work starts; removed waiters never run later', async () => {
  store = new LabStore({ root, maxWaiters: 1, lockTimeoutMs: 30 });
  const active = await hold(), work = jest.fn();
  const waiting = store.exclusive(work);
  const timedOut = expect(waiting).rejects.toMatchObject({ code: 'storage_busy', status: 429, safeHeaders: { 'Retry-After': '1' } });
  await expect(store.exclusive(work)).rejects.toMatchObject({ code: 'storage_busy' });
  await timedOut;
  active.release(); await active.done;
  await store.exclusive(async () => {});
  expect(work).not.toHaveBeenCalled(); expect(store.waiters).toEqual([]);
  expect(logger.warning.mock.calls.map(([, options]) => options.metadata.reason)).toEqual(['queue_limit', 'wait_timeout']);
  expect(JSON.stringify(logger.warning.mock.calls)).not.toMatch(new RegExp(`${owner}|${binding}|${root}`));
});
test('nested acquisition fails promptly; failures release ownership for later work', async () => {
  let later;
  await expect(store.exclusive(async () => {
    later = () => store.list(owner, binding);
    await store.list(owner, binding);
  })).rejects.toThrow('Nested lab storage acquisition');
  await expect(later()).resolves.toEqual([]);
  const active = await hold();
  const failing = store.exclusive(async () => { throw new Error('synthetic'); });
  const caught = expect(failing).rejects.toThrow('synthetic');
  const next = store.list(owner, binding);
  active.release(); await active.done; await caught;
  await expect(next).resolves.toEqual([]);
});
test('queued operations revalidate private root and ownership after waiting', async () => {
  const s = await store.create(owner, binding), active = await hold();
  const read = store.get(owner, binding, s.id);
  const denied = expect(read).rejects.toThrow();
  await fs.chmod(root, 0o777); active.release(); await active.done; await denied;
  await fs.chmod(root, 0o700);
  const closing = store.clear(owner, binding, s.id);
  const stale = store.get(owner, binding, s.id);
  const foreign = store.get('b'.repeat(24), binding, s.id);
  await Promise.all([closing, expect(stale).rejects.toMatchObject({ status: 404 }), expect(foreign).rejects.toMatchObject({ status: 404 })]);
});
test.each(['clear', 'ttl'])('decode does not hold lock; %s wins before upload commit without recreating data', async kind => {
  let now = 1000; store.now = () => now;
  const s = await store.create(owner, binding), decoding = deferred(), release = deferred();
  const decode = store.decodeUpload.bind(store);
  jest.spyOn(store, 'decodeUpload').mockImplementation(async (...args) => { decoding.resolve(); await release.promise; return decode(...args); });
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#f60' } }).png().toBuffer();
  const uploading = store.upload(owner, binding, s.id, { buffer: png, mimetype: 'image/png', originalname: 'synthetic.png' });
  await decoding.promise;
  expect((await store.list(owner, binding))[0].assets).toEqual([]);
  const purge = jest.spyOn(store, 'purgeDirectory');
  if (kind === 'clear') await store.clear(owner, binding, s.id);
  else { now = s.expiresAt; await store.sweep(); }
  release.resolve();
  await expect(uploading).rejects.toMatchObject({ status: 404 });
  await store.sweep(); expect(purge).toHaveBeenCalledTimes(1); expect(await fs.readdir(root)).toEqual([]);
});
test.each(['files', 'bytes'])('parallel decoded uploads recheck %s reservations atomically', async limit => {
  store = new LabStore({ root, limits: { ...LIMITS, sessionFiles: limit === 'files' ? 1 : LIMITS.sessionFiles } });
  const s = await store.create(owner, binding);
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#f60' } }).png().toBuffer();
  if (limit === 'bytes') store.limits.sessionBytes = store.usage(store.sessions.get(s.id)) + png.length + 512;
  const file = { buffer: png, mimetype: 'image/png', originalname: 'synthetic.png' };
  const results = await Promise.allSettled([store.upload(owner, binding, s.id, file), store.upload(owner, binding, s.id, file)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.find(r => r.status === 'rejected').reason.code).toBe(limit === 'files' ? 'file_count' : 'storage_limit');
  expect((await store.get(owner, binding, s.id)).assets).toHaveLength(1);
  expect(await fs.readdir(path.join(root, s.id))).toHaveLength(2);
});
