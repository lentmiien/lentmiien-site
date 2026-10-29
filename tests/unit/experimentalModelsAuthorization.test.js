jest.mock('../../database', () => ({ UseraccountModel: { findById: jest.fn() } }));
const { UseraccountModel } = require('../../database');
const { dispatchAuthorization } = require('../../services/experimentalModels/authorization');
const owner = 'a'.repeat(24), binding = '11111111-1111-4111-8111-111111111111';
function request(session) {
  return { labOwner: owner, labBinding: binding, sessionID: 'opaque-sid', sessionStore: { get: jest.fn((id, callback) => callback(null, session)) } };
}
const valid = () => ({ passport: { user: owner }, experimentalModelsBinding: binding, cookie: { expires: new Date(Date.now() + 60000) } });
beforeEach(() => {
  UseraccountModel.findById.mockImplementation(() => ({ select: () => ({ maxTimeMS: () => ({ lean: async () => ({ _id: owner, name: 'synthetic', type_user: 'admin' }) }) }) }));
});
test('reads authoritative account and live browser session at delayed dispatch', async () => {
  const req = request(valid()), check = dispatchAuthorization(req);
  req.user = { type_user: 'user' }; // Request snapshot is not the authority.
  expect(await check()).toBe(true); expect(UseraccountModel.findById).toHaveBeenCalledWith(owner);
  req.sessionStore.get.mockImplementation((_, callback) => callback(null, null));
  expect(await check()).toBe(false);
});
test.each(['missing', 'foreign', 'binding', 'expired', 'logout'])('denies %s session before account lookup', async kind => {
  let session = valid();
  if (kind === 'missing') session = null; if (kind === 'foreign') session.passport.user = 'b'.repeat(24);
  if (kind === 'binding') session.experimentalModelsBinding = 'different'; if (kind === 'expired') session.cookie.expires = new Date(0);
  if (kind === 'logout') delete session.passport;
  expect(await dispatchAuthorization(request(session))()).toBe(false); expect(UseraccountModel.findById).not.toHaveBeenCalled();
});
test.each(['family', 'user', null])('denies revoked account %s even if queued as admin', async type => {
  UseraccountModel.findById.mockImplementation(() => ({ select: () => ({ maxTimeMS: () => ({ lean: async () => type ? { name: 'synthetic', type_user: type } : null }) }) }));
  expect(await dispatchAuthorization(request(valid()))()).toBe(false);
});
