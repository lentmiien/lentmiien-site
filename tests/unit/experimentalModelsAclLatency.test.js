const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../services/gptImageStorageService', () => {
  const actual = jest.requireActual('../../services/gptImageStorageService');
  return { ...actual, assertTrustedStorage: jest.fn(actual.assertTrustedStorage) };
});
const { assertTrustedStorage } = require('../../services/gptImageStorageService');
const actualTrust = jest.requireActual('../../services/gptImageStorageService').assertTrustedStorage;
const { LabStore } = require('../../services/experimentalModels/storage');
const { LabJobs } = require('../../services/experimentalModels/jobs');
const logger = require('../../utils/logger');
const owner = 'a'.repeat(24), binding = randomUUID();
let root, store;
async function until(predicate) {
  for (let i = 0; i < 10000; i += 1) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Synthetic operation did not settle');
}
beforeEach(async () => {
  assertTrustedStorage.mockImplementation(actualTrust);
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-acl-latency-'));
  store = new LabStore({ root });
});
afterEach(async () => {
  jest.useRealTimers(); jest.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

test('existing root gets one fresh ACL/ancestor check each operation, including after ready', async () => {
  const mkdir = jest.spyOn(fs, 'mkdir');
  await store.list(owner, binding); await store.list(owner, binding);
  expect(assertTrustedStorage.mock.calls).toEqual([[root, false], [root, false]]);
  expect(mkdir).not.toHaveBeenCalled();
  assertTrustedStorage.mockRejectedValueOnce(new Error('Synthetic ACL changed'));
  await expect(store.list(owner, binding)).rejects.toThrow('Synthetic ACL changed');
  expect(store.busy).toBe(false);
});

test('missing root retains pre-creation ancestor and post-creation root validation', async () => {
  store = new LabStore({ root: path.join(root, 'new') });
  assertTrustedStorage.mockImplementation(async (value, sticky) => {
    if (value === root) await expect(fs.stat(store.root)).rejects.toMatchObject({ code: 'ENOENT' });
    else expect((await fs.stat(store.root)).isDirectory()).toBe(true);
    return actualTrust(value, sticky);
  });
  await store.list(owner, binding);
  expect(assertTrustedStorage.mock.calls).toEqual([[root, true], [store.root, undefined]]);
});

test.each([5000, 10000])('%i ms ACL checks recover concurrent poll, mutation, cleanup and dispatch without replay', async aclMs => {
  const session = await store.create(owner, binding);
  assertTrustedStorage.mockClear();
  // Keep real filesystem operations and security checks; only native ACL latency
  // is synthetic. Never sleep for Windows-sized delays or call a live Gateway.
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  let aclWaiting = false;
  assertTrustedStorage.mockImplementation(async (...args) => {
    await actualTrust(...args);
    aclWaiting = true;
    await new Promise(resolve => setTimeout(resolve, aclMs));
    aclWaiting = false;
  });
  const gateway = { config: jest.fn(), sanitize: value => value,
    run: jest.fn(async () => ({ bytes: Buffer.from('{}'), mime: 'application/json', headers: {} })) };
  const jobs = new LabJobs({ store, gateway });
  const poll = store.list(owner, binding);
  const mutation = jobs.submit(owner, binding, session.id, 'ming-tts',
    { task: 'VOICE_DESIGN', text: 'Synthetic', language: 'en', controls: { style: 'Calm' } }, async () => true);
  const cleanup = store.sweep();
  let settled = false;
  const results = Promise.allSettled([poll, mutation, cleanup]).then(value => { settled = true; return value; });
  let steps = 0, peakWaiters = store.waiters.length;
  while (!settled || store.busy || jobs.running) {
    await until(() => aclWaiting || (settled && !store.busy && !jobs.running));
    if (!aclWaiting) break;
    peakWaiters = Math.max(peakWaiters, store.waiters.length);
    expect(++steps).toBeLessThanOrEqual(6);
    await jest.advanceTimersByTimeAsync(aclMs);
  }
  expect((await results).map(value => value.status)).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
  expect(steps).toBe(6); // poll, submit, cleanup, dispatch, result commit, final cleanup
  expect(assertTrustedStorage).toHaveBeenCalledTimes(6);
  expect(peakWaiters).toBeLessThanOrEqual(2);
  expect(gateway.run).toHaveBeenCalledTimes(1);
  expect(store.sessions.get(session.id).jobs[0]).toMatchObject({ state: 'succeeded', reservedBytes: 0 });
  expect(store.waiters).toEqual([]); expect(jobs.pending).toEqual([]);
  expect(logger.warning).not.toHaveBeenCalled(); expect(logger.error).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('default queue admits only 32 pending operations and removes all expired work at 30 seconds', async () => {
  await store.list(owner, binding);
  jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
  let release;
  const active = store.exclusive(() => new Promise(resolve => { release = resolve; }));
  await until(() => release);
  const work = jest.fn();
  const pending = Promise.allSettled(Array.from({ length: 33 }, () => store.exclusive(work)));
  expect(store.waiters).toHaveLength(32);
  await jest.advanceTimersByTimeAsync(29999); expect(store.waiters).toHaveLength(32);
  await jest.advanceTimersByTimeAsync(1);
  expect((await pending).every(value => value.status === 'rejected' && value.reason.code === 'storage_busy')).toBe(true);
  expect(store.waiters).toEqual([]); expect(work).not.toHaveBeenCalled();
  release(); await active; await store.list(owner, binding);
  expect(store.busy).toBe(false); expect(jest.getTimerCount()).toBe(0);
});
