jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { getConnectivityConfig } = require('../../utils/connectivityConfig');
const { advance, createConnectivityMonitor, repository, DB_OPTIONS } = require('../../services/connectivityMonitorService');
const Sample = require('../../models/connectivity_sample');

const config = getConnectivityConfig({});
const start = new Date('2026-09-05T00:00:00Z');
const result = (degraded = true, name = 'internet') => ({ name, outcome: degraded ? 'timeout' : 'ok', latencyMs: 5000, degraded });

function harness() {
  let time = +start;
  const saved = [];
  const store = {
    ready: jest.fn(() => true), latest: jest.fn(async () => saved.at(-1) || null),
    save: jest.fn(async (sample) => { saved.push(structuredClone(sample)); return { insertedId: 'id' }; }),
    mark: jest.fn(async () => {}),
  };
  const send = jest.fn(async () => {});
  const runProbe = jest.fn(async (target) => result(true, target.name));
  const log = { warning: jest.fn() };
  const options = { config, store, send, runProbe, log, clock: () => new Date(time) };
  const monitor = createConnectivityMonitor(options);
  return { ...options, saved, monitor, options, setTime: (ms) => { time = +start + ms; },
    tickAt: async (ms) => { time = +start + ms; return monitor.tick(); } };
}

test('configuration defaults, bounded overrides and TTL schema', () => {
  expect(config).toMatchObject({ intervalMs: 120000, retentionDays: 3, sustainedMs: 600000,
    cooldownMs: 3600000, timeoutMs: 5000, slowMs: 1500, maxGapMs: 180000 });
  const custom = getConnectivityConfig({ CONNECTIVITY_RETENTION_DAYS: '5' });
  expect(+advance(null, [result()], start, custom).expiresAt - start).toBe(5 * 86400000);
  expect(Sample.schema.indexes()).toContainEqual([{ expiresAt: 1 }, { expireAfterSeconds: 0 }]);
  expect(Sample.schema.options.bufferCommands).toBe(false);
  expect(DB_OPTIONS).toEqual({ timeoutMS: 3000, maxTimeMS: 2000 });
});

test.each([
  { CONNECTIVITY_INTERVAL_MS: '0' }, { CONNECTIVITY_RETENTION_DAYS: '8' },
  { CONNECTIVITY_MONITOR_ENABLED: 'yes' }, { CONNECTIVITY_SLOW_MS: '5000' },
  ...['http://example.com', 'https://user:pass@example.com', 'https://example.com/path',
    'https://example.com?secret=x', 'https://example.com/#x', 'https://127.0.0.1',
    'https://example.com:8080', 'https://[::1]'].map((url) => ({ CONNECTIVITY_PUBLIC_ORIGIN: url })),
])('rejects invalid config %j', (env) => expect(() => getConnectivityConfig(env)).toThrow());

test('single blips recover; consecutive samples reach ten minutes; failed sends consume cooldown across restart', async () => {
  const h = harness();
  h.send.mockRejectedValue(new Error('secret upstream payload'));
  await h.tickAt(0);
  expect(h.send).not.toHaveBeenCalled();
  for (let minute = 2; minute <= 10; minute += 2) await h.tickAt(minute * 60000);
  expect(h.send).toHaveBeenCalledTimes(1);
  expect(h.saved.at(-1).notification).toBe('attempted');
  expect(h.store.mark).toHaveBeenCalledWith('id', 'failed');
  expect(h.store.save.mock.invocationCallOrder.at(-1)).toBeLessThan(h.send.mock.invocationCallOrder[0]);
  h.setTime(12 * 60000);
  const restarted = createConnectivityMonitor(h.options);
  expect((await restarted.tick()).probes[0].degradedSince).toEqual(start);
  expect(h.send).toHaveBeenCalledTimes(1);
  for (let minute = 14; minute <= 70; minute += 2) {
    h.setTime(minute * 60000);
    await restarted.tick();
  }
  expect(h.send).toHaveBeenCalledTimes(2);
  expect(JSON.stringify(h.log.warning.mock.calls)).not.toContain('secret upstream');
});

test('recovery, gaps, clock rollback and config changes reset duration without clearing cooldown', () => {
  const previous = { ...advance(null, [result()], start, config), lastAttemptAt: start };
  for (const [ms, results, cfg] of [
    [120000, [result(false)], config], [180001, [result()], config],
    [-1, [result()], config], [120000, [result()], { ...config, signature: 'changed' }],
  ]) {
    const next = advance(previous, results, new Date(+start + ms), cfg);
    expect(next.probes[0].degradedSince).toEqual(results[0].degraded ? next.sampledAt : null);
    expect(next.lastAttemptAt).toEqual(start);
  }
});

test('alternating degraded probes never combine into sustained degradation', async () => {
  const h = harness();
  for (let minute = 0; minute <= 30; minute += 2) {
    h.runProbe.mockImplementation(async (target) => result(target.name === (minute % 4 ? 'internet' : 'cloudflare'), target.name));
    await h.tickAt(minute * 60000);
  }
  expect(h.send).not.toHaveBeenCalled();
});

test('DB unavailability continues bounded observations but defers alerts and throttles warnings', async () => {
  const h = harness();
  h.store.ready.mockReturnValue(false);
  for (let minute = 0; minute <= 12; minute += 2) await h.tickAt(minute * 60000);
  expect(h.runProbe).toHaveBeenCalledTimes(14);
  expect(h.store.save).not.toHaveBeenCalled();
  expect(h.send).not.toHaveBeenCalled();
  expect(h.log.warning).toHaveBeenCalledTimes(2); // DB + sustained degradation
  h.store.ready.mockReturnValue(true);
  await h.tickAt(14 * 60000);
  expect(h.send).toHaveBeenCalledTimes(1);
});

test('ambiguous write failure restores saved cooldown before considering another send', async () => {
  const h = harness();
  for (let minute = 0; minute < 10; minute += 2) await h.tickAt(minute * 60000);
  h.store.save.mockImplementationOnce(async (sample) => {
    h.saved.push(structuredClone(sample));
    throw new Error('write acknowledgement lost');
  });
  await h.tickAt(10 * 60000);
  await h.tickAt(12 * 60000);
  expect(h.send).not.toHaveBeenCalled();
  expect(h.saved.at(-1).lastAttemptAt).toEqual(new Date(+start + 600000));
});

test('restore and outcome-write failures are handled; successful delivery remains recorded in memory', async () => {
  const h = harness();
  h.store.latest.mockRejectedValueOnce(new Error('DB unavailable'));
  expect((await h.tickAt(0)).notification).toBe('none');
  expect(h.store.save).not.toHaveBeenCalled();
  for (let minute = 2; minute < 10; minute += 2) await h.tickAt(minute * 60000);
  h.store.mark.mockRejectedValueOnce(new Error('DB unavailable'));
  expect((await h.tickAt(600000)).notification).toBe('sent');
  await h.tickAt(720000);
  expect(h.send).toHaveBeenCalledTimes(1);
});

test('overlap is skipped and unexpected probe failure releases lock and breaks continuity', async () => {
  const h = harness();
  let finish;
  h.runProbe.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  // Use only one unresolved probe so all promises can be settled.
  h.runProbe.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce(result());
  const tick = h.monitor.tick();
  await Promise.resolve();
  expect(await h.monitor.tick()).toEqual({ skipped: true });
  finish(result());
  await tick;
  h.runProbe.mockRejectedValueOnce(new Error('unexpected')).mockResolvedValue(result());
  expect(await h.tickAt(120000)).toEqual({ failed: true });
  expect((await h.tickAt(240000)).probes[0].degradedSince).toEqual(new Date(+start + 240000));
});

test('repository uses retention, fixed projection, pagination and bounded database operations', async () => {
  const query = { select: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(), setOptions: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([]) };
  const spy = jest.spyOn(Sample, 'find').mockReturnValue(query);
  await repository.history(start, 360, new Date(+start + 120000));
  expect(spy).toHaveBeenCalledWith(expect.objectContaining({ sampledAt: { $gte: start, $lt: new Date(+start + 120000) } }));
  expect(query.setOptions).toHaveBeenCalledWith(DB_OPTIONS);
  expect(query.limit).toHaveBeenCalledWith(360);
  spy.mockRestore();
});
