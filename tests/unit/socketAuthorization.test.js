const { authorizeSocketSession } = require('../../utils/socketAuthorization');

function models({ user = { name: 'work', type_user: 'user' }, permissions = ['chat5'] } = {}) {
  return {
    userModel: { findOne: jest.fn().mockResolvedValue(user) },
    roleModel: { findOne: jest.fn().mockResolvedValue({ permissions }) },
  };
}

describe('authorizeSocketSession', () => {
  const future = new Date('2026-08-29T00:00:00.000Z');
  const now = new Date('2026-08-28T00:00:00.000Z').getTime();

  test('accepts an existing user with the Chat5 permission', async () => {
    const dependencies = models();
    await expect(authorizeSocketSession({
      passport: { user: 'user-id' },
      cookie: { expires: future },
    }, { ...dependencies, now })).resolves.toEqual({
      ok: true,
      userName: 'work',
      sessionExpiresAt: future.getTime(),
      permissionGranted: true,
    });
  });

  test('rejects missing, malformed, and expired sessions before querying the user', async () => {
    const dependencies = models();
    await expect(authorizeSocketSession({}, { ...dependencies, now }))
      .resolves.toEqual({ ok: false, reason: 'Unauthorized' });
    await expect(authorizeSocketSession({
      passport: { user: 'user-id' },
      cookie: { expires: 'not-a-date' },
    }, { ...dependencies, now })).resolves.toEqual({ ok: false, reason: 'Unauthorized' });
    await expect(authorizeSocketSession({
      passport: { user: 'user-id' },
      cookie: { expires: new Date(now - 1) },
    }, { ...dependencies, now })).resolves.toEqual({ ok: false, reason: 'Unauthorized' });
    expect(dependencies.userModel.findOne).not.toHaveBeenCalled();
  });

  test('rejects deleted users but keeps non-Chat users on the authenticated base socket', async () => {
    await expect(authorizeSocketSession(
      { passport: { user: 'deleted-id' }, cookie: { expires: future } },
      { ...models({ user: null }), now }
    )).resolves.toEqual({ ok: false, reason: 'Unauthorized' });

    await expect(authorizeSocketSession(
      { passport: { user: 'user-id' }, cookie: { expires: future } },
      { ...models({ permissions: ['chat4'] }), now }
    )).resolves.toEqual({
      ok: true,
      userName: 'work',
      sessionExpiresAt: future.getTime(),
      permissionGranted: false,
    });
  });

  test('can authenticate a socket without requesting a capability', async () => {
    await expect(authorizeSocketSession({
      passport: { user: 'user-id' },
      cookie: { expires: future },
    }, { ...models({ permissions: [] }), permission: null, now })).resolves.toEqual({
      ok: true,
      userName: 'work',
      sessionExpiresAt: future.getTime(),
      permissionGranted: true,
    });
  });
});
