const { randomBytes, createHash, timingSafeEqual } = require('crypto');
const Credential = require('../models/service_credential');
const User = require('../models/useraccount');
const Role = require('../models/role');
const { hasCapabilities } = require('../utils/authorization');

const hashSecret = value => createHash('sha256').update(value).digest('hex');
const denied = () => Object.assign(new Error('Invalid service credential.'), { status: 401, code: 'INVALID_CREDENTIAL', publicMessage: 'Invalid or expired API key.' });
const publicKey = doc => ({ id: String(doc._id), label: doc.label, expiresAt: doc.expiresAt, revokedAt: doc.revokedAt });
// Shared credential primitive: callers choose a fixed namespace and server-declared capabilities.
function createServiceCredentials({ namespace, capabilities, ownerCapabilities = capabilities, roleCapabilityBundles,
  model = Credential, users = User, roleModel = Role } = {}) {
  if (!namespace || !Array.isArray(capabilities) || !capabilities.length) throw new TypeError('Credential policy required.');
  let indexesReady;
  async function ensureIndexes() {
    if (!indexesReady) indexesReady = model.createIndexes().catch(error => { indexesReady = null; throw error; });
    await indexesReady;
  }
  async function authorizedOwner(ownerId) {
    const user = await users.findById(ownerId).select('_id name type_user').lean();
    if (!user || !await hasCapabilities(user, ownerCapabilities, { roleModel, roleCapabilityBundles })) throw denied();
    return user;
  }
  async function authenticate(header) {
    const match = /^Bearer svc_([a-f0-9]{24})_([A-Za-z0-9_-]{43})$/.exec(header || '');
    if (!match) throw denied();
    const doc = await model.findOne({ _id: match[1], namespace, revokedAt: null, expiresAt: { $gt: new Date() } }).select('+hash').lean();
    if (!doc || !/^[a-f0-9]{64}$/.test(doc.hash || '')
      || !timingSafeEqual(Buffer.from(doc.hash, 'hex'), Buffer.from(hashSecret(match[2]), 'hex'))
      || !Array.isArray(doc.capabilities) || !capabilities.every(capability => doc.capabilities.includes(capability))) throw denied();
    const user = await authorizedOwner(doc.ownerId);
    return { id: String(doc._id), ownerId: String(doc.ownerId), user };
  }
  async function issue(ownerId, label, days) {
    await authorizedOwner(ownerId);
    if (typeof label !== 'string' || !label.trim() || label.length > 80 || !Number.isInteger(days) || days < 1 || days > 365) throw new TypeError('Invalid credential options.');
    // Reclaim inactive slots only. The compound unique index bounds concurrent issuance.
    await ensureIndexes();
    await model.deleteMany({ ownerId, namespace, $or: [{ revokedAt: { $ne: null } }, { expiresAt: { $lte: new Date() } }] });
    for (let slot = 0; slot < 10; slot += 1) {
      const secret = randomBytes(32).toString('base64url');
      try {
        const doc = await model.create({ ownerId, namespace, slot, label: label.trim(), hash: hashSecret(secret), capabilities,
          expiresAt: new Date(Date.now() + days * 86400000) });
        return { ...publicKey(doc), secret: `svc_${doc._id}_${secret}` };
      } catch (error) { if (error.code !== 11000) throw error; }
    }
    throw Object.assign(new Error('Credential limit reached.'), { status: 409, publicMessage: 'Revoke an API key before creating another (maximum 10 active keys).' });
  }
  async function list(ownerId) {
    return (await model.find({ ownerId, namespace, revokedAt: null, expiresAt: { $gt: new Date() } })
      .select('_id label expiresAt revokedAt').limit(10).lean()).map(publicKey);
  }
  async function revoke(ownerId, id) {
    if (!/^[a-f0-9]{24}$/.test(id)) return false;
    return Boolean(await model.findOneAndUpdate({ _id: id, ownerId, namespace, revokedAt: null }, { $set: { revokedAt: new Date() } }));
  }
  return { authenticate, issue, list, revoke };
}
module.exports = { createServiceCredentials };
