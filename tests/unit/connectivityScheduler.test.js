jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../services/connectivityMonitorService', () => ({
  createConnectivityMonitor: jest.fn(() => ({ tick: jest.fn().mockResolvedValue({}) })),
}));

afterEach(() => {
  jest.useRealTimers();
  delete process.env.CONNECTIVITY_MONITOR_ENABLED;
});

test('one timer per process, immediate probe, interval and explicit disabling', async () => {
  jest.useFakeTimers();
  jest.resetModules();
  const schedule = require('../../schedulers/connectivityMonitor');
  const { createConnectivityMonitor } = require('../../services/connectivityMonitorService');
  process.env.CONNECTIVITY_MONITOR_ENABLED = 'false';
  expect(schedule()).toBeNull();
  expect(createConnectivityMonitor).not.toHaveBeenCalled();
  process.env.CONNECTIVITY_MONITOR_ENABLED = 'true';
  const handle = schedule();
  expect(schedule()).toBe(handle);
  const monitor = createConnectivityMonitor.mock.results[0].value;
  expect(monitor.tick).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(120000);
  expect(monitor.tick).toHaveBeenCalledTimes(2);
  expect(createConnectivityMonitor).toHaveBeenCalledTimes(1);
  clearInterval(handle);
});

test('invalid configuration disables scheduler with a safe actionable error', () => {
  jest.resetModules();
  process.env.CONNECTIVITY_MONITOR_ENABLED = 'invalid secret';
  const schedule = require('../../schedulers/connectivityMonitor');
  const log = require('../../utils/logger');
  expect(schedule()).toBeNull();
  expect(log.error).toHaveBeenCalledWith(expect.stringContaining('invalid CONNECTIVITY'), { category: 'connectivity_monitor' });
  expect(JSON.stringify(log.error.mock.calls)).not.toContain('invalid secret');
});


test('scheduler records monotonic lateness separately from wall-clock labels and passes actual listener supplier', async () => {
  jest.useFakeTimers();
  jest.resetModules();
  let monotonic = 0;
  jest.doMock('perf_hooks', () => ({ performance: { now: () => monotonic } }));
  try {
    const schedule = require('../../schedulers/connectivityMonitor');
    const { createConnectivityMonitor } = require('../../services/connectivityMonitorService');
    const localPort = () => 8080;
    const handle = schedule({ localPort });
    expect(createConnectivityMonitor).toHaveBeenCalledWith(expect.objectContaining({ localPort }));
    const monitor = createConnectivityMonitor.mock.results[0].value;
    monotonic = 120075;
    await jest.advanceTimersByTimeAsync(120000);
    expect(monitor.tick.mock.calls[1][0]).toMatchObject({ schedulerLatenessMs: 75, scheduledAt: expect.any(Date) });
    expect(+monitor.tick.mock.calls[1][0].scheduledAt).toBe(Date.now() - 75);
    clearInterval(handle);
  } finally { jest.dontMock('perf_hooks'); }
});
