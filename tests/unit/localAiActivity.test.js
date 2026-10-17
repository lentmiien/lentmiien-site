jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { CodexActivity } = require('../../services/localAi/codexActivity');
const { previousCoordinatorTerminated } = require('../../services/localAi/coordinator');
const os = require('os');
describe('durable Codex activity ownership', () => {
  let env, gateway, turnModel, activity;
  beforeEach(() => {
    env = process.env.LOCAL_AI_BATCH_ENABLED; process.env.LOCAL_AI_BATCH_ENABLED = 'true';
    gateway = { request: jest.fn(async (method, path, body) => ({ id: path.split('/').at(-1), coordinator_id: body?.coordinator_id, generation: 1, status: 'active' })), configured: () => true };
    turnModel = { findOneAndUpdate: jest.fn(() => ({ lean: async () => ({ _id: 'turn' }) })), updateOne: jest.fn(async () => ({ matchedCount: 1 })) };
    activity = new CodexActivity({ gateway, turnModel });
  });
  afterEach(() => { process.env.LOCAL_AI_BATCH_ENABLED = env; jest.useRealTimers(); });
  test('persists ownership before registration and heartbeats through tool gaps', async () => {
    jest.useFakeTimers(); const state = await activity.begin('turn', 'coordinator');
    expect(turnModel.findOneAndUpdate.mock.invocationCallOrder[0]).toBeLessThan(gateway.request.mock.invocationCallOrder[0]);
    await jest.advanceTimersByTimeAsync(30000);
    expect(gateway.request).toHaveBeenLastCalledWith('POST', `/batch/activities/${state.id}/heartbeat`, { coordinator_id: 'coordinator', generation: 1 });
    await activity.finish(state, true);
    expect(gateway.request).toHaveBeenLastCalledWith('POST', `/batch/activities/${state.id}/release`, { coordinator_id: 'coordinator', generation: 1, agent_terminated: true });
  });
  test('registration failure fails closed and no guessed release follows', async () => {
    gateway.request.mockRejectedValueOnce(new Error('batch_active'));
    await expect(activity.begin('turn', 'coordinator')).rejects.toThrow('batch_active');
    expect(turnModel.findOneAndUpdate).toHaveBeenCalledTimes(1); expect(gateway.request).toHaveBeenCalledTimes(2);
    expect(gateway.request).toHaveBeenLastCalledWith('GET', '/batch/activities');
  });
  test('SSH loss or unproven children retain ownership; heartbeat expiry never releases', async () => {
    jest.useFakeTimers(); const state = await activity.begin('turn', 'coordinator');
    gateway.request.mockRejectedValueOnce(new Error('timeout')); await jest.advanceTimersByTimeAsync(30000);
    await activity.finish(state, false);
    expect(gateway.request.mock.calls.some(c => c[1].endsWith('/release'))).toBe(false);
    expect(turnModel.updateOne).toHaveBeenLastCalledWith(expect.any(Object), { $set: { 'batchActivity.state': 'needs_review' } }, expect.any(Object));
  });
  test('definitive session busy leaves no ghost active activity or guessed release', async () => {
    gateway.request.mockRejectedValueOnce(Object.assign(new Error('busy'), { code: 'gpu_batch_session_busy', httpStatus: 409 }));
    await expect(activity.begin('turn', 'coordinator')).rejects.toThrow('GPU is reserved');
    expect(turnModel.updateOne).toHaveBeenCalledWith(expect.objectContaining({ 'batchActivity.state': 'registering' }), { $set: { 'batchActivity.state': 'not_admitted', 'batchActivity.terminationProven': true } }, expect.any(Object));
    expect(gateway.request).toHaveBeenCalledTimes(1);
  });
  test('disabled feature leaves existing launch path alone', async () => {
    process.env.LOCAL_AI_BATCH_ENABLED = 'false'; expect(await activity.begin('turn', 'coordinator')).toBeNull(); expect(gateway.request).not.toHaveBeenCalled();
  });
  test('coordinator never takes ownership from a live or foreign host process', async () => {
    expect(await previousCoordinatorTerminated({ holder: 'x', ownerHost: os.hostname(), ownerPid: process.pid })).toBe(false);
    expect(await previousCoordinatorTerminated({ holder: 'x', ownerHost: 'different-host', ownerPid: 9999999 })).toBe(false);
    expect(await previousCoordinatorTerminated({ holder: 'x', ownerHost: os.hostname(), ownerPid: 2147483647 })).toBe(true);
  });
});
