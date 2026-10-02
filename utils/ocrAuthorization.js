const { hasCapabilities } = require('./authorization');
const { RoleModel } = require('../database');

const MODEL_TEST_CAPABILITY = 'ocr.jobs.test_models';
const ROLE_BUNDLES = { admin: [MODEL_TEST_CAPABILITY], family: [], user: [] };
const capabilityOptions = { roleModel: RoleModel, roleCapabilityBundles: ROLE_BUNDLES };
const canTestModels = user => hasCapabilities(user, [MODEL_TEST_CAPABILITY], capabilityOptions);
const isAlternativeJob = job => Boolean(job.model && job.model !== 'hunyuanocr');
function visibleJobs(req) {
  const legacy = [{ model: { $exists: false } }, { model: null }, { model: 'hunyuanocr' }];
  if (req.ocrCanTestModels && req.user?._id) legacy.push({ 'owner.id': String(req.user._id) });
  return { $or: legacy };
}
module.exports = { MODEL_TEST_CAPABILITY, capabilityOptions, canTestModels, isAlternativeJob, visibleJobs };
