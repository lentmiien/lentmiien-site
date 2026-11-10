const { resolveAuthorizedToolPrincipal } = require('./toolExecutionPrincipalService');
const { CAPABILITY, BUNDLES } = require('../utils/decisionsAuthorizationPolicy');
const { service, object } = require('./decisionsService');

async function execute(type, args = {}, context = {}) {
  const principal = await resolveAuthorizedToolPrincipal(context, CAPABILITY, { roleCapabilityBundles: BUNDLES });
  if (type === 'models') {
    object(args, [], 'model discovery');
    return service.models();
  }
  let payload = args;
  if (type !== 'batch') {
    const extra = type === 'choice' ? ['choices'] : type === 'score' ? ['levels'] : [];
    object(args, ['model', 'input', 'image_data_url', 'name', 'instructions', ...extra], 'decision tool');
    const { model, input, image_data_url, ...question } = args;
    payload = { model, input, questions: [{ ...question, type }], ...(image_data_url !== undefined ? { image_data_url } : {}) };
  }
  return service.evaluate(payload, principal._id);
}
module.exports = { execute };
