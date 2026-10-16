jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('mongoose', () => ({ connect: jest.fn(), disconnect: jest.fn() }));
jest.mock('../../models/role', () => ({ updateOne: jest.fn() }));
jest.mock('../../models/useraccount', () => ({ findById: jest.fn() }));
jest.mock('../../models/codex_turn', () => ({ findById: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../services/localAi', () => ({ service: { initialize: jest.fn(), reconcileCapacity: jest.fn(), principal: jest.fn(), gateway: { request: jest.fn() } } }));
jest.mock('../../utils/logger', () => ({ notice: jest.fn(), error: jest.fn() }));
const { service } = require('../../services/localAi');
const Turn = require('../../models/codex_turn');
const { main } = require('../../scripts/local-ai-admin');
describe('operator Codex activity recovery', () => {
  beforeEach(() => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    Turn.findById.mockReturnValue({ lean: async () => ({ batchActivity: { id: 'codex_test', coordinatorId: 'old', generation: 1 } }) });
  });
  afterEach(() => jest.restoreAllMocks());
  test('initialize reconciles safe admission releases after provisioning indexes and authorization', async () => {
    await main(['initialize', 'admin']);
    expect(service.initialize).toHaveBeenCalledTimes(1);
    expect(service.principal).toHaveBeenCalledWith('admin', null, 'local_ai.scheduler.manage');
    expect(service.reconcileCapacity).toHaveBeenCalledTimes(1);
    expect(service.initialize.mock.invocationCallOrder[0]).toBeLessThan(service.reconcileCapacity.mock.invocationCallOrder[0]);
    expect(service.principal.mock.invocationCallOrder[0]).toBeLessThan(service.reconcileCapacity.mock.invocationCallOrder[0]);
  });
  test('never recovers or releases merely because a heartbeat is stale', async () => {
    await expect(main(['reconcile-activity', 'admin', 'turn'])).rejects.toMatchObject({ code: 'operator_must_prove_old_coordinator_and_entire_agent_tree_terminated' });
    expect(service.gateway.request).not.toHaveBeenCalled();
  });
  test('lost recovery response is reconciled by current generation, not another ownership guess', async () => {
    const args = ['reconcile-activity', 'admin', 'turn', '--old-coordinator-and-agent-terminated', 'CONFIRMED'];
    service.gateway.request.mockResolvedValueOnce({ activities: [{ id: 'codex_test', coordinator_id: 'old', generation: 1, status: 'active' }] }).mockRejectedValueOnce(new Error('lost reply'));
    await expect(main(args)).rejects.toThrow('lost reply');
    service.gateway.request.mockResolvedValueOnce({ activities: [{ id: 'codex_test', coordinator_id: 'reconcile_codex_test', generation: 2, status: 'active' }] }).mockResolvedValueOnce({ status: 'released' });
    await main(args);
    expect(service.gateway.request.mock.calls.filter(call => call[1].endsWith('/recover'))).toHaveLength(1);
    expect(service.gateway.request).toHaveBeenLastCalledWith('POST', '/batch/activities/codex_test/release', { coordinator_id: 'reconcile_codex_test', generation: 2, agent_terminated: true });
    expect(Turn.updateOne).toHaveBeenLastCalledWith({ _id: 'turn' }, { $set: { 'batchActivity.state': 'released', 'batchActivity.terminationProven': true } }, expect.any(Object));
  });
  test('missing remote activity is not proof of release', async () => {
    service.gateway.request.mockResolvedValueOnce({ activities: [] });
    await expect(main(['reconcile-activity', 'admin', 'turn', '--old-coordinator-and-agent-terminated', 'CONFIRMED'])).rejects.toMatchObject({ code: 'activity_missing_do_not_assume_released' });
    expect(service.gateway.request).toHaveBeenCalledTimes(1);
  });
});
