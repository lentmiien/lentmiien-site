const mongoose = require('mongoose');
const models = require('../../models/taric_tool');
const AmiAmiItem = require('../../models/amiami_item');
const Role = require('../../models/role');
const User = require('../../models/useraccount');
const { hasCapabilities } = require('../../utils/authorization');
const { MANAGE, ROLE_BUNDLES } = require('../../utils/taricAuthorizationPolicy');
const { createTaricEvidenceService } = require('../taricEvidenceService');
const { createTransport } = require('./transport');
const { createService } = require('./service');
const { createWorker } = require('./worker');
const transport = createTransport();
const { hash } = require('../../utils/taricProtocol');
const { fail } = require('../../utils/taricContracts');
// Called only under the global inference lease. Persist cooldowns across workers.
async function fetchFactual(code) {
  const budget = await models.Control.findById('fetch-budget').maxTimeMS(2000).lean().exec();
  if (!budget) fail('CONFIG_NOT_READY');
  const now = Date.now();
  const attempts = (budget.attempts || []).filter(a => a.at > now - 60000);
  if (attempts.length >= 20 || attempts.some(a => a.code === hash(code))) fail('FETCH_LIMITED');
  attempts.push({ at: now, code: hash(code) });
  await models.Control.updateOne({ _id: 'fetch-budget' }, { $set: { attempts } }).exec();
  return transport.fetchFactual(code);
}
const evidence = createTaricEvidenceService({ itemModel: AmiAmiItem, fetchFactual });
const authorizeAdmin = async actor => {
  if (!/^[a-f0-9]{24}$/.test(actor || '')) return false;
  const user = await User.findById(actor).maxTimeMS(2000).lean().exec();
  return hasCapabilities(user, [MANAGE], { roleModel: Role, roleCapabilityBundles: ROLE_BUNDLES });
};
const service = createService({ models, transport, evidence, authorizeAdmin });
const worker = createWorker(service, { ready: () => mongoose.connection.readyState === 1, authorizeAdmin });
module.exports = { service, worker };
