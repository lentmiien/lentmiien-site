jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const { MusicError } = require('../../services/musicGatewayService');
let jobs;
beforeEach(() => { jest.resetModules(); jest.useFakeTimers(); jobs = require('../../services/musicJobService'); });
afterEach(() => jest.useRealTimers());
const setup = () => ({ request: { model: { id: 'yue2-3b' }, payload: { seed: 0 } }, gateway: { generate: jest.fn().mockResolvedValue({ job_id: 'gateway-job', seed: '9223372036854775807' }), jobOutputs: jest.fn().mockResolvedValue([{ path: 'file' }]) }, authorize: jest.fn().mockResolvedValue(true), persist: jest.fn().mockResolvedValue([{ id: 'saved' }]) });
test('owner scopes jobs, admin override is explicit, foreign and missing are identical', () => {
  const job = jobs.reserve({ ownerId: 'one' });
  expect(jobs.get(job.id, 'one')).toBe(job);
  expect(jobs.get(job.id, 'two')).toBeNull();
  expect(jobs.get('missing', 'two')).toBeNull();
  expect(jobs.get(job.id, 'two', true)).toBe(job);
  expect(jobs.serialize(job)).not.toHaveProperty('ownerId');
});
test('admission reserves synchronously, per-user/global/background duplicates are bounded', () => {
  jobs.reserve({ ownerId: 'one', background: true });
  expect(() => jobs.reserve({ ownerId: 'one' })).toThrow('already active');
  expect(() => jobs.reserve({ ownerId: 'two', background: true })).toThrow('already active');
  jobs.reserve({ ownerId: 'two' }); jobs.reserve({ ownerId: 'three' });
  expect(() => jobs.reserve({ ownerId: 'four' })).toThrow('already active');
});
test('active jobs survive beyond one hour and terminal retention starts at completion', async () => {
  const job = jobs.reserve({ ownerId: 'one' });
  await jest.advanceTimersByTimeAsync(jobs.RETENTION_MS * 2);
  expect(jobs.get(job.id, 'one')).toBe(job);
  jobs.finish(job);
  await jest.advanceTimersByTimeAsync(jobs.RETENTION_MS - 1);
  expect(jobs.get(job.id, 'one')).toBe(job);
  await jest.advanceTimersByTimeAsync(2);
  expect(jobs.get(job.id, 'one')).toBeNull();
});
test('completion waits for output lookup and all persistence', async () => {
  const job = jobs.reserve({ ownerId: 'one' });
  const options = setup(); let complete;
  options.persist.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  jobs.run(job, options); await jest.advanceTimersByTimeAsync(0);
  expect(job.status).toBe('processing'); expect(job.stage).toBe('persist');
  expect(job.result.seed).toBe('9223372036854775807');
  complete([{ id: 'saved' }]); await jest.advanceTimersByTimeAsync(0);
  expect(job.status).toBe('completed'); expect(job.completedAt).toEqual(expect.any(Number));
});
test.each(['generate', 'jobOutputs', 'persist'])('%s failure stays failed, logged and is never replayed', async operation => {
  const job = jobs.reserve({ ownerId: 'one', background: true }); const options = setup();
  (options.gateway[operation] || options[operation]).mockRejectedValue({ code: 'ECONNABORTED' });
  jobs.run(job, options); await jest.advanceTimersByTimeAsync(0);
  expect(job.status).toBe('failed'); expect(job.error).toContain('uncertain');
  expect(options.gateway.generate).toHaveBeenCalledTimes(1);
  expect(() => jobs.reserve({ ownerId: 'one', background: true })).toThrow('paused');
  await jest.advanceTimersByTimeAsync(30000);
  expect(options.gateway.generate).toHaveBeenCalledTimes(1);
  expect(require('../../utils/logger').error).toHaveBeenCalled();
});
test('revocation before dispatch prevents work', async () => {
  const job = jobs.reserve({ ownerId: 'one' }); const options = setup(); options.authorize.mockResolvedValue(false);
  jobs.run(job, options); await jest.advanceTimersByTimeAsync(0);
  expect(job.status).toBe('failed'); expect(options.gateway.generate).not.toHaveBeenCalled();
});
test('partial persistence cannot become completed', async () => {
  const job = jobs.reserve({ ownerId: 'one' }); const options = setup(); options.persist.mockResolvedValue([]);
  jobs.run(job, options); await jest.advanceTimersByTimeAsync(0);
  expect(job.status).toBe('failed'); expect(job.error).toContain('persistence');
});
