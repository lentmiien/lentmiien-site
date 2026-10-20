jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../services/localAi/coordinator', () => ({
  ownerIdentity: async () => ({ ownerHost: 'test', ownerPid: 1, ownerProcessStart: '1' }),
  previousCoordinatorTerminated: async () => false,
}));
jest.mock('../../services/localAi/codexActivity', () => ({ CodexActivity: class { async reconcileProven() {} } }));
const { Worker } = require('../../services/localAi/worker');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture() {
  const now = new Date('2026-10-20T00:00:00Z');
  const row = { _id: 'scheduler', fence: 10, leaseUntil: new Date(+now + 90000), ownershipEpoch: 1 };
  let blocked = null;
  const Control = {
    updateOne: jest.fn(async () => ({ matchedCount: 1 })),
    findById: jest.fn(() => ({ lean: async () => ({ ...row }) })),
    findOneAndUpdate: jest.fn((filter, update) => ({ lean: async () => {
      const match = filter.holder === row.holder && filter.fence === row.fence
        && (!filter.leaseUntil || +row.leaseUntil > +filter.leaseUntil.$gt);
      if (match) {
        Object.assign(row, update.$set);
        for (const [key, value] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + value;
      }
      const result = match ? { ...row } : null;
      const delay = blocked; blocked = null;
      if (delay) await delay.promise;
      return result;
    } })),
  };
  const service = { db: { Control }, gateway: { configured: () => true },
    initialize: async () => {}, reconcileCapacity: jest.fn(async () => {}) };
  const worker = new Worker(service, { ready: () => true, now: () => now, terminated: jest.fn(async () => false) });
  row.holder = worker.id; worker.running = true; worker.fence = 10;
  worker.warn = jest.fn();
  worker.repairClaims = async () => {};
  worker.reconcileDetached = async () => {};
  worker.dispatchSession = async () => {};
  worker.sessions.sync = jest.fn(async () => null);
  return { worker, row, Control, service, block: () => { blocked = deferred(); return blocked; } };
}

test.each(['tick', 'heartbeat'])('overlapping %s and renewal cannot invalidate the same worker', async first => {
  const f = fixture(), delay = f.block();
  const initial = f.worker[first]();
  await flush();
  const second = f.worker[first === 'tick' ? 'heartbeat' : 'tick']();
  await flush();
  expect(f.Control.findOneAndUpdate).toHaveBeenCalledTimes(1);
  delay.resolve();
  await Promise.all([initial, second]);
  expect(f.worker.fence).toBe(11);
  expect(f.worker.warn).not.toHaveBeenCalled();
  await expect(f.worker.guard()).resolves.toMatchObject({ fence: 11 });
});
test('independent heartbeat renews authority while tick performs long work', async () => {
  const f = fixture(), work = deferred();
  f.service.reconcileCapacity.mockImplementation(() => work.promise);
  const tick = f.worker.tick(); await flush();
  await f.worker.heartbeat();
  expect(f.worker.sessions.sync).toHaveBeenCalledTimes(1);
  expect(f.Control.findOneAndUpdate.mock.calls.at(-1)[0].fence).toBe(11);
  work.resolve(); await tick;
});
test.each(['expired', 'foreign'])('a genuine %s lease fails closed', async kind => {
  const f = fixture();
  if (kind === 'expired') f.row.leaseUntil = new Date(0);
  else f.row.holder = 'foreign';
  await expect(f.worker.guard()).rejects.toMatchObject({ code: 'coordinator_fenced' });
  expect(f.worker.fence).toBeNull();
});
test('restart requires lease expiry and proof of termination', async () => {
  const f = fixture(); f.row.holder = 'old'; f.worker.fence = null;
  expect(await f.worker.acquire()).toBeNull();
  f.row.leaseUntil = new Date(0);
  expect(await f.worker.acquire()).toBeNull();
  f.worker.terminated.mockResolvedValue(true);
  expect(await f.worker.acquire()).toMatchObject({ holder: f.worker.id, fence: 11, ownershipEpoch: 2 });
});
test('a stopped worker cannot install a late acquisition result', async () => {
  const f = fixture(), delay = f.block();
  const acquisition = f.worker.acquire(); await flush();
  f.worker.stop(); delay.resolve();
  expect(await acquisition).toBeNull();
  expect(f.worker.fence).toBeNull();
});
test('an obsolete failed guard never clears a newer in-memory fence', async () => {
  const f = fixture(); f.row.fence = 11;
  const delay = f.block();
  const guard = f.worker.guard(); await flush();
  f.worker.fence = 11; delay.resolve();
  await expect(guard).rejects.toMatchObject({ code: 'coordinator_fenced' });
  expect(f.worker.fence).toBe(11);
});
