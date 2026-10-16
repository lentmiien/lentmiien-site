jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('mongoose', () => ({ connect: jest.fn(), disconnect: jest.fn() }));
jest.mock('../../models/role', () => ({ updateOne: jest.fn() }));
jest.mock('../../models/useraccount', () => ({ findById: jest.fn(), find: jest.fn() }));
jest.mock('../../models/codex_turn', () => ({ findById: jest.fn(), updateOne: jest.fn() }));
jest.mock('../../services/localAi', () => ({ service: { initialize: jest.fn(), reconcileCapacity: jest.fn(), principal: jest.fn(), gateway: { request: jest.fn() } } }));
jest.mock('../../utils/logger', () => ({ notice: jest.fn(), error: jest.fn() }));
const { service } = require('../../services/localAi');
const Turn = require('../../models/codex_turn');
const { main, reportFailure } = require('../../scripts/local-ai-admin');
const User = require('../../models/useraccount');
const mongoose = require('mongoose');
const logger = require('../../utils/logger');
describe('trusted initialize-by-name', () => {
  const adminId = 'a'.repeat(24);
  let query;
  beforeEach(() => {
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
    query = { collation: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), lean: jest.fn().mockResolvedValue([{ _id: adminId }]) };
    User.find.mockReturnValue(query);
    service.principal.mockResolvedValue({ _id: adminId, name: 'Example Admin', type_user: 'admin' });
  });
  afterEach(() => {
    service.principal.mockReset();
    jest.restoreAllMocks();
  });
  test('resolves an exact unique login and checks the existing capability before migration', async () => {
    await main(['initialize-by-name', 'Example Admin']);
    expect(User.find).toHaveBeenCalledWith({ name: 'Example Admin' });
    expect(query.collation).toHaveBeenCalledWith({ locale: 'simple' });
    expect(query.select).toHaveBeenCalledWith('_id');
    expect(query.limit).toHaveBeenCalledWith(2);
    expect(service.principal).toHaveBeenCalledWith(adminId, null, 'local_ai.scheduler.manage');
    expect(service.principal.mock.invocationCallOrder[0]).toBeLessThan(service.initialize.mock.invocationCallOrder[0]);
    expect(service.initialize.mock.invocationCallOrder[0]).toBeLessThan(service.reconcileCapacity.mock.invocationCallOrder[0]);
    expect(service.reconcileCapacity).toHaveBeenCalledTimes(1);
    expect(service.gateway.request).not.toHaveBeenCalled();
    expect(process.stdout.write).toHaveBeenCalledWith('Local AI indexes ready; safe terminal admission slots reconciled; all history retained.\n');
    expect(JSON.stringify(logger.notice.mock.calls)).not.toContain('Example Admin');
  });
  test.each([undefined, '', '   ', 'a'.repeat(101), 'line\nbreak', { $ne: null }])('rejects invalid input before connecting (%p)', async name => {
    await expect(main(['initialize-by-name', name])).rejects.toMatchObject({ code: 'invalid_admin_name' });
    expect(mongoose.connect).not.toHaveBeenCalled();
    expect(service.initialize).not.toHaveBeenCalled();
  });
  test('rejects extra arguments', async () => {
    await expect(main(['initialize-by-name', 'Example Admin', 'extra'])).rejects.toMatchObject({ code: 'invalid_admin_name' });
    expect(mongoose.connect).not.toHaveBeenCalled();
  });
  test.each([{ users: [] }, { users: [{ _id: adminId }, { _id: 'b'.repeat(24) }] }])('rejects absent or ambiguous names without migration ($users)', async ({ users }) => {
    query.lean.mockResolvedValue(users);
    await expect(main(['initialize-by-name', 'Example Admin'])).rejects.toMatchObject({ code: 'admin_name_not_unique' });
    expect(service.principal).not.toHaveBeenCalled();
    expect(service.initialize).not.toHaveBeenCalled();
  });
  test.each(['user', 'family', undefined])('rejects non-admins even if granted scheduler capability (%p)', async type => {
    service.principal.mockResolvedValue({ name: 'Example Admin', type_user: type });
    await expect(main(['initialize-by-name', 'Example Admin'])).rejects.toMatchObject({ code: 'validated_admin_required' });
    expect(service.initialize).not.toHaveBeenCalled();
  });
  test('rejects a renamed principal between lookup and authorization', async () => {
    service.principal.mockResolvedValue({ name: 'Changed', type_user: 'admin' });
    await expect(main(['initialize-by-name', 'Example Admin'])).rejects.toMatchObject({ code: 'validated_admin_required' });
    expect(service.initialize).not.toHaveBeenCalled();
  });
  test('does not bypass the principal capability check', async () => {
    service.principal.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'forbidden' }));
    await expect(main(['initialize-by-name', 'Example Admin'])).rejects.toMatchObject({ code: 'forbidden' });
    expect(service.initialize).not.toHaveBeenCalled();
    expect(service.reconcileCapacity).not.toHaveBeenCalled();
  });
  test.each(['mongodb://user:secret@host/private', 'secret_in_a_valid_looking_code', 11000, undefined, 'forbidden'])('prints and logs only allowlisted error codes (%p)', code => {
    const previousExitCode = process.exitCode;
    try {
      reportFailure(Object.assign(new Error('private account and connection details'), { code }));
      const expected = code === 'forbidden' ? 'forbidden' : 'administration_failed';
      expect(process.stderr.write).toHaveBeenCalledWith(`${expected}\n`);
      expect(logger.error).toHaveBeenCalledWith('Local AI administration failed', { category: 'local_ai', metadata: { code: expected } });
      expect(process.exitCode).toBe(1);
    } finally { process.exitCode = previousExitCode; }
  });
});
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
