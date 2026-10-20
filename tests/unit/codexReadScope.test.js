jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../services/appSettingsService', () => ({
  APP_SETTING_KEYS: { CODEX_LOCAL_MODELS: 'codex.local_models' }, appSettingsService: { getValue: async () => 'fixture-model' },
}));
const query = value => ({
  lean() { return this; }, exec: async () => value, sort() { return this; },
  limit() { return this; }, select() { return this; },
});
const models = {};
for (const name of ['session', 'turn', 'event', 'workspace', 'workspace_lock', 'execution_target', 'token_price', 'request_profile']) {
  models[name] = {
    find: jest.fn(() => query([])), findOne: jest.fn(() => query(null)), findById: jest.fn(() => query(null)),
    countDocuments: jest.fn(() => query(1)), create: jest.fn(async row => row),
    findOneAndUpdate: jest.fn(() => query(null)), deleteMany: jest.fn(() => query({})),
    collection: { indexes: async () => [], dropIndex: async () => {}, createIndex: async () => {} },
  };
  jest.doMock(`../../models/codex_${name}`, () => models[name]);
}
jest.doMock('../../models/runpod_pod', () => ({ find: () => query([]) }));
const role = { findOne: jest.fn(async () => null) };
jest.doMock('../../models/role', () => role);
const service = require('../../services/codexToolService');
const user = { _id: 'owner', name: 'Owner', type_user: 'user' };
const session = { _id: 'session', createdBy: { id: 'owner' }, workspaceId: 'workspace', targetId: 'target' };
beforeEach(() => {
  jest.clearAllMocks();
  role.findOne.mockResolvedValue(null);
  models.execution_target.findOne.mockReturnValue(query({ _id: 'target', type: 'local' }));
  models.session.findOne.mockImplementation(filter => query(filter['createdBy.id'] && filter['createdBy.id'] !== 'owner' ? null : session));
  models.session.findOneAndUpdate.mockImplementation(filter => query(filter['createdBy.id'] && filter['createdBy.id'] !== 'owner' ? null : session));
});
test.each(['user', 'family', 'admin'])('%s dashboard, queue, lists and statistics use the same declared owner scope', async type_user => {
  const principal = { ...user, type_user };
  await service.getDashboardState({ user: principal });
  await service.getQueueState({ user: principal });
  const scope = type_user === 'admin' ? {} : { 'createdBy.id': 'owner' };
  expect(models.turn.find).toHaveBeenCalledWith({ ...scope, status: 'running' });
  expect(models.turn.find).toHaveBeenCalledWith({ ...scope, status: 'queued' });
  expect(models.session.find).toHaveBeenCalledWith({ ...scope, status: { $ne: 'archived' } });
  for (const [filter] of [...models.turn.find.mock.calls, ...models.session.find.mock.calls]) {
    if (type_user === 'admin') expect(filter).not.toHaveProperty('createdBy.id');
    else expect(filter['createdBy.id']).toBe('owner');
  }
  expect(models.workspace_lock.find).toHaveBeenCalledTimes(type_user === 'admin' ? 1 : 0);
});
test('session detail is owner-scoped and filters child turns before serialization', async () => {
  await service.getSessionDetail('session', { user });
  expect(models.session.findOne).toHaveBeenCalledWith({ _id: 'session', 'createdBy.id': 'owner' });
  expect(models.turn.find).toHaveBeenCalledWith({ sessionId: 'session', 'createdBy.id': 'owner' });
});
test('foreign session reads, followups and archives fail with the same 404 before child access or mutation', async () => {
  const other = { ...user, _id: 'other' };
  await expect(service.getSessionDetail('session', { user: other })).rejects.toMatchObject({ statusCode: 404 });
  await expect(service.createFollowupTurn('session', { prompt: 'foreign' }, other)).rejects.toMatchObject({ statusCode: 404 });
  await expect(service.archiveSession('session', other)).rejects.toMatchObject({ statusCode: 404 });
  expect(models.turn.find).not.toHaveBeenCalled();
  expect(models.turn.create).not.toHaveBeenCalled();
});
test('admin can read and archive foreign sessions using capability-checked scope', async () => {
  const admin = { ...user, _id: 'admin', type_user: 'admin' };
  await service.getSessionDetail('session', { user: admin });
  await service.archiveSession('session', admin);
  expect(models.session.findOneAndUpdate).toHaveBeenCalledWith({ _id: 'session' },
    { $set: { status: 'archived', archivedAt: expect.any(Date) } }, { new: true });
});
test.each([undefined, { ...user, type_user: 'other' }])('missing principal/capability cannot query read surfaces', async principal => {
  for (const read of ['getDashboardState', 'getQueueState', 'listSessions', 'getDashboardStats']) {
    await expect(service[read]({ user: principal })).rejects.toMatchObject({ statusCode: 403 });
  }
  expect(models.turn.find).not.toHaveBeenCalled();
  expect(models.session.find).not.toHaveBeenCalled();
});
test('an explicit read grant stays owner-scoped and does not grant archiving', async () => {
  role.findOne.mockResolvedValue({ permissions: ['codex.session.read'] });
  const principal = { ...user, type_user: 'other' };
  await service.getSessionDetail('session', { user: principal });
  expect(models.session.findOne).toHaveBeenCalledWith({ _id: 'session', 'createdBy.id': 'owner' });
  await expect(service.archiveSession('session', principal)).rejects.toMatchObject({ statusCode: 403 });
  expect(models.session.findOneAndUpdate).not.toHaveBeenCalled();
});
