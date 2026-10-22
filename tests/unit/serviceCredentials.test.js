const { createHash } = require('crypto');
const { createServiceCredentials } = require('../../services/serviceCredentialService');
const { CAPABILITIES: CAP, ROLE_BUNDLES } = require('../../utils/smallestBoxPolicy');
const owner = 'a'.repeat(24), foreign = 'b'.repeat(24);
let records, user, model, service, sequence;
const chain = value => ({ select() { return this; }, limit() { return this; }, lean: async () => value });
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
  if (key === 'expiresAt') return +doc.expiresAt > +value.$gt;
  return doc[key] === value;
});
beforeEach(() => {
  records = []; sequence = 0; user = { _id: owner, name: 'issuer', type_user: 'admin' };
  model = {
    createIndexes: jest.fn().mockResolvedValue(),
    deleteMany: jest.fn(async () => { records = records.filter(doc => !doc.revokedAt && +doc.expiresAt > Date.now()); }),
    create: jest.fn(async data => {
      if (records.some(doc => doc.ownerId === data.ownerId && doc.namespace === data.namespace && doc.slot === data.slot)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      const doc = { ...data, _id: String(++sequence).padStart(24, '0'), revokedAt: null }; records.push(doc); return doc;
    }),
    findOne: jest.fn(filter => chain(records.find(doc => matches(doc, filter)))),
    find: jest.fn(filter => chain(records.filter(doc => matches(doc, filter)))),
    findOneAndUpdate: jest.fn(async (filter, update) => {
      const doc = records.find(doc => matches(doc, filter)); if (doc) Object.assign(doc, update.$set); return doc;
    }),
  };
  const users = { findById: jest.fn(() => chain(user)) };
  service = createServiceCredentials({ namespace: 'packing', capabilities: [CAP.read, CAP.run], ownerCapabilities: [CAP.read, CAP.run, CAP.api],
    roleCapabilityBundles: ROLE_BUNDLES, model, users, roleModel: { findOne: async () => null } });
});
test('issues only hashed secrets and authenticates a scoped key tied to its issuer', async () => {
  const key = await service.issue(owner, 'Client app', 30);
  const secret = key.secret.split('_').slice(2).join('_');
  expect(records[0].hash).toBe(createHash('sha256').update(secret).digest('hex'));
  expect(JSON.stringify(records)).not.toContain(key.secret);
  expect(await service.authenticate('Bearer ' + key.secret)).toMatchObject({ ownerId: owner, id: key.id });
  const listed = await service.list(owner);
  expect(listed).toEqual([{ id: key.id, label: 'Client app', expiresAt: key.expiresAt, revokedAt: null }]);
  expect(JSON.stringify(listed)).not.toMatch(/hash|secret|capabilities/);
});
test.each(['revoked', 'expired', 'scope', 'namespace', 'owner-missing', 'owner-revoked'])('rejects %s credentials', async failure => {
  const key = await service.issue(owner, 'client', 30);
  if (failure === 'revoked') records[0].revokedAt = new Date();
  if (failure === 'expired') records[0].expiresAt = new Date(0);
  if (failure === 'scope') records[0].capabilities = [CAP.read];
  if (failure === 'namespace') records[0].namespace = 'other';
  if (failure === 'owner-missing') user = null;
  if (failure === 'owner-revoked') user.type_user = 'user';
  await expect(service.authenticate('Bearer ' + key.secret)).rejects.toMatchObject({ status: 401 });
});
test('wrong secret, missing bearer header and legacy global key are denied', async () => {
  const key = await service.issue(owner, 'client', 30);
  for (const header of [undefined, key.secret, 'Bearer legacy-key', 'Bearer svc_' + key.id + '_' + 'A'.repeat(43)]) {
    await expect(service.authenticate(header)).rejects.toMatchObject({ status: 401 });
  }
});
test('foreign and missing keys cannot be listed or revoked; revocation takes effect immediately', async () => {
  const key = await service.issue(owner, 'client', 30);
  expect(await service.list(foreign)).toEqual([]);
  expect(await service.revoke(foreign, key.id)).toBe(false);
  expect(await service.revoke(owner, 'f'.repeat(24))).toBe(false);
  expect(await service.revoke(owner, key.id)).toBe(true);
  await expect(service.authenticate('Bearer ' + key.secret)).rejects.toMatchObject({ status: 401 });
});
test('ten active slots bound concurrent issuance; revoked slots can be replaced without restoring old keys', async () => {
  const issued = await Promise.all(Array.from({ length: 10 }, (_, i) => service.issue(owner, 'client ' + i, 30)));
  await expect(service.issue(owner, 'extra', 30)).rejects.toMatchObject({ status: 409 });
  await service.revoke(owner, issued[0].id);
  const replacement = await service.issue(owner, 'new client', 30);
  await expect(service.authenticate('Bearer ' + issued[0].secret)).rejects.toMatchObject({ status: 401 });
  expect(await service.authenticate('Bearer ' + replacement.secret)).toMatchObject({ ownerId: owner });
});

test('credential issuance fails closed if the active-slot index cannot be ensured', async () => {
  model.createIndexes.mockRejectedValueOnce(new Error('index unavailable'));
  await expect(service.issue(owner, 'client', 30)).rejects.toThrow('index unavailable');
  expect(model.create).not.toHaveBeenCalled();
  expect((await service.issue(owner, 'retry', 30)).secret).toMatch(/^svc_/);
});
