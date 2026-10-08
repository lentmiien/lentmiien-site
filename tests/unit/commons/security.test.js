jest.mock('../../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { authorize } = require('../../../socket_io/commons');
const { PLAY, TALK, OPERATIONS } = require('../../../utils/commonsAuthorizationPolicy');
const { portal } = require('../../../services/commons/registry');
const { config } = require('../../../services/commons/config');
const { CommonsRepository } = require('../../../services/commons/repository');
const user = { _id: '111111111111111111111111', name: 'synthetic', type_user: 'user' };
function authFixture() {
  const session = { passport: { user: user._id }, cookie: { expires: new Date(Date.now() + 10000) }, csrfToken: 'a'.repeat(43), reload: cb => cb() };
  const socket = { request: { session }, handshake: { auth: { csrf: session.csrfToken }, headers: { origin: 'https://example.test' } }, data: {} };
  const deps = { config: { enabled: true, origins: ['https://example.test'] }, userModel: { findOne: jest.fn(async () => user) }, roleModel: { findOne: jest.fn(async () => ({ permissions: [PLAY] })) } };
  return { socket, deps, session };
}
test.each(['missing-user', 'missing-grant', 'wrong-origin', 'missing-origin', 'wrong-csrf', 'expired', 'invalid-expiry', 'revoked', 'principal-switch', 'disabled'])('socket rejects %s', async mode => {
  const { socket, deps, session } = authFixture();
  if (mode === 'missing-user') deps.userModel.findOne.mockResolvedValue(null);
  if (mode === 'missing-grant') deps.roleModel.findOne.mockResolvedValue(null);
  if (mode === 'wrong-origin') socket.handshake.headers.origin = 'https://attacker.test';
  if (mode === 'missing-origin') delete socket.handshake.headers.origin;
  if (mode === 'wrong-csrf') socket.handshake.auth.csrf = 'b'.repeat(43);
  if (mode === 'expired') session.cookie.expires = new Date(0);
  if (mode === 'invalid-expiry') session.cookie.expires = 'invalid';
  if (mode === 'revoked') session.reload = cb => cb(new Error('gone'));
  if (mode === 'principal-switch') socket.data.userId = '222222222222222222222222';
  if (mode === 'disabled') deps.config.enabled = false;
  await expect(authorize(socket, deps)).rejects.toThrow();
});
test('play does not require chat; revoking grant or passport denies the next command', async () => {
  const { socket, deps, session } = authFixture();
  expect((await authorize(socket, deps)).userId).toBe(user._id);
  await expect(authorize(socket, deps, TALK)).rejects.toThrow();
  deps.roleModel.findOne.mockResolvedValue(null); await expect(authorize(socket, deps)).rejects.toThrow();
  delete session.passport; await expect(authorize(socket, deps)).rejects.toThrow();
});
test('portals have fixed authorized destinations and no household data', async () => {
  const model = { findOne: jest.fn(async () => null) };
  expect(await portal('chat', user, model)).not.toHaveProperty('href');
  expect(await portal('hall', user, model)).not.toHaveProperty('href');
  model.findOne.mockResolvedValue({ permissions: ['chat5', OPERATIONS] });
  expect(await portal('chat', user, model)).toHaveProperty('href', '/chat5/top');
  expect(await portal('hall', user, model)).not.toHaveProperty('href');
  expect(await portal('hall', { ...user, type_user: 'admin' }, model)).toHaveProperty('href', '/commons/diagnostics');
  for (const id of ['shelter', 'https://attacker.test', '__proto__']) expect(await portal(id, user, model)).not.toHaveProperty('href');
});
test.each([{ COMMONS_MAX_ONLINE: '11' }, { COMMONS_MAX_ONLINE: 'NaN' }, { COMMONS_ALLOWED_ORIGINS: 'https://a.test/path' }, { COMMONS_ENABLED: 'yes' }])('bad configuration fails closed %#', env => expect(() => config(env)).toThrow());
test('repository save fences revision, owner and unexpired lease using single-document atomic writes', async () => {
  const model = { updateOne: jest.fn(async () => ({ modifiedCount: 1 })) };
  const repo = new CommonsRepository({ model, now: () => 10000 });
  const state = { version: 1, revision: 3, players: [], blooms: 5 };
  expect((await repo.save(state)).revision).toBe(4);
  expect(model.updateOne.mock.calls[0][0]).toMatchObject({ revision: 3, leaseOwner: repo.owner, leaseUntil: { $gt: new Date(10000) } });
  expect(model.updateOne.mock.calls[0][2]).toMatchObject({ writeConcern: { w: 'majority' }, maxTimeMS: 2000 });
  model.updateOne.mockResolvedValue({ modifiedCount: 0 }); await expect(repo.save(state)).rejects.toThrow('ownership lost');
});
test('lease acquisition refuses contention and unknown schema', async () => {
  const query = { lean: jest.fn().mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 })) };
  const model = { findOneAndUpdate: jest.fn(() => query) };
  const repo = new CommonsRepository({ model });
  await expect(repo.acquire()).rejects.toMatchObject({ code: 11000 });
  query.lean.mockResolvedValue({ version: 2, players: [] }); await expect(repo.acquire()).rejects.toThrow('Unsupported');
});
test('corrupt or unsupported persisted state fails closed before exposing residents', () => {
  const { validState } = require('../../../services/commons/state');
  expect(validState({ version: 1, revision: 0, players: [], blooms: 0 })).toBe(true);
  for (const value of [null, { version: 2 }, { version: 1, revision: 0, players: [{ userId: user._id }], blooms: 0 }]) expect(validState(value)).toBe(false);
});
test('slow authorization cannot renew stale grants or outlive cookie expiry', async () => {
  for (const expiry of [100000, 3000]) {
    const { socket, deps, session } = authFixture();
    let time = 1000;
    deps.now = () => time;
    session.cookie.expires = new Date(expiry);
    deps.userModel.findOne.mockImplementation(async () => { time += 6000; return user; });
    await expect(authorize(socket, deps)).rejects.toThrow('UNAUTHORIZED');
  }
});
test('actual Mongoose save casting retains immutable account IDs in resident subdocuments', async () => {
  const model = require('../../../models/commons_world');
  expect(model.collection.name).toBe('commonsworlds');
  expect(model.schema.path('players').schema.path('userId').options.immutable).toBe(true);
  const update = jest.spyOn(model.collection, 'updateOne').mockResolvedValue({ modifiedCount: 1 });
  try {
    const repo = new CommonsRepository({ model });
    await repo.save({ version: 1, revision: 0, blooms: 0, players: [{ userId: user._id, plot: 0, x: 32, y: 25, facing: 'down', scene: 'village' }] });
    expect(update.mock.calls[0][1].$set.players[0].userId).toBe(user._id);
    expect(update.mock.calls[0][0]).toMatchObject({ _id: 'lantern-commons-v1', revision: 0, leaseOwner: repo.owner });
  } finally { update.mockRestore(); }
});
test('HTTP server shutdown clears all room timers without relying on an Engine.IO close event', () => {
  jest.useFakeTimers();
  try {
    const { EventEmitter } = require('events');
    const { registerCommons } = require('../../../socket_io/commons');
    const httpServer = new EventEmitter();
    const namespace = { use: jest.fn(), on: jest.fn(), sockets: new Map() };
    const io = { of: () => namespace, httpServer };
    const registration = registerCommons(io, jest.fn(), { room: {}, npc: {}, config: { checkpointMs: 5000 } });
    expect(jest.getTimerCount()).toBe(3);
    httpServer.emit('close');
    expect(jest.getTimerCount()).toBe(0); expect(httpServer.listenerCount('close')).toBe(0);
    registration.stop(); expect(jest.getTimerCount()).toBe(0);
  } finally { jest.useRealTimers(); }
});
