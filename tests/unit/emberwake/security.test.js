const { authorize, trusted } = require('../../../socket_io/emberwake');
const { verificationReceipt } = require('../../../utils/twoFactorSession');
const { PLAY, BUNDLES } = require('../../../services/emberwake/policy');
const { hasCapabilities } = require('../../../utils/authorization');
const now = 100000,
  origin = 'http://127.0.0.1:7500',
  csrf = 'u'.repeat(43),
  userId = 'e'.repeat(24);
function setup() {
  const user = { _id: userId, name: 'Synthetic', type_user: 'user' },
    session = {
      passport: { user: userId },
      cookie: { expires: new Date(now + 60000) },
      csrfToken: csrf,
      reload: done => done()
    };
  const socket = {
    data: {},
    handshake: { auth: { csrf } },
    request: { headers: { origin, host: '127.0.0.1:7500' }, session }
  };
  const deps = {
    now: () => now,
    ready: () => true,
    allowed: new Set([origin]),
    userModel: { findOne: async () => user },
    roleModel: { findOne: async () => null }
  };
  return { user, session, socket, deps };
}
test('only an authenticated, freshly reloaded principal gets a short grant, capped by actual session expiry', async () => {
  const { socket, deps, session } = setup();
  session.reload = jest.fn(cb => cb());
  expect(await authorize(socket, deps)).toEqual({ user: userId, validUntil: now + 12000 });
  expect(session.reload).toHaveBeenCalled();
  session.cookie.expires = new Date(now + 600);
  expect((await authorize(socket, deps)).validUntil).toBe(now + 600);
});
test.each([
  'anonymous',
  'expired',
  'missing-token',
  'wrong-token',
  'different-user',
  'revoked',
  'untrusted-origin',
  'different-host',
  'no-database',
  'no-role',
  'lost-session'
])('denies %s without authorizing any game action', async kind => {
  const { socket, deps, session, user } = setup();
  if (kind === 'anonymous') delete session.passport.user;
  if (kind === 'expired') session.cookie.expires = new Date(now);
  if (kind === 'missing-token') delete session.csrfToken;
  if (kind === 'wrong-token') socket.handshake.auth.csrf = 'v'.repeat(43);
  if (kind === 'different-user') socket.data.user = 'a'.repeat(24);
  if (kind === 'revoked') deps.userModel.findOne = async () => null;
  if (kind === 'untrusted-origin') socket.request.headers.origin = 'https://outside.invalid';
  if (kind === 'different-host') socket.request.headers.host = 'localhost:7500';
  if (kind === 'no-database') deps.ready = () => false;
  if (kind === 'no-role') user.type_user = 'unassigned';
  if (kind === 'lost-session') session.reload = done => done(Error('Session ended'));
  await expect(authorize(socket, deps)).rejects.toThrow(kind === 'lost-session' ? 'Session ended' : 'Denied');
});
test('admin and opted-in account factors follow the web app verification receipt, including subsequent credential changes', async () => {
  const { socket, deps, session, user } = setup();
  user.type_user = 'admin';
  user.two_factor = { enabled: true, version: 'one' };
  await expect(authorize(socket, deps)).rejects.toThrow('Denied');
  session.twoFactor = verificationReceipt(user, now);
  await expect(authorize(socket, deps)).resolves.toHaveProperty('user', userId);
  user.hash_password = 'changed-synthetic-fingerprint';
  await expect(authorize(socket, deps)).rejects.toThrow('Denied');
});
test('an explicit play grant may authorize another logged-in role, without granting maintenance', async () => {
  const { user, deps, socket } = setup();
  user.type_user = 'crew-only';
  deps.roleModel.findOne = async () => ({ permissions: [PLAY] });
  await expect(authorize(socket, deps)).resolves.toHaveProperty('user', userId);
  expect(
    await hasCapabilities(user, ['emberwake.world.manage'], {
      roleModel: deps.roleModel,
      roleCapabilityBundles: BUNDLES
    })
  ).toBe(false);
  for (const value of [undefined, 'null', 'file:///tmp/game', 'http://127.0.0.1:7500/'])
    expect(trusted({ headers: { origin: value, host: '127.0.0.1:7500' } }, deps.allowed)).toBe(false);
});
