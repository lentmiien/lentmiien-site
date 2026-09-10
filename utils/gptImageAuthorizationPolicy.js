const { hasCompletePrincipal } = require('./authorization');
const GPT_IMAGE_CAPABILITIES = Object.freeze({
  read: 'gpt_image.library.read',
  like: 'gpt_image.library.like',
  generate: 'gpt_image.generate',
});
const sharedCapabilities = Object.freeze(Object.values(GPT_IMAGE_CAPABILITIES));
const GPT_IMAGE_ROLE_CAPABILITY_BUNDLES = Object.freeze({
  admin: sharedCapabilities,
  family: sharedCapabilities,
  user: sharedCapabilities,
  other: sharedCapabilities,
});
// Lennart explicitly approved the library for ALL logged-in users. Custom role
// names get this same narrow feature bundle, never unrelated site capabilities.
function gptImageRoleBundles(principal) {
  return hasCompletePrincipal(principal)
    ? { ...GPT_IMAGE_ROLE_CAPABILITY_BUNDLES, [principal.type_user]: sharedCapabilities }
    : GPT_IMAGE_ROLE_CAPABILITY_BUNDLES;
}
module.exports = { GPT_IMAGE_CAPABILITIES, GPT_IMAGE_ROLE_CAPABILITY_BUNDLES, gptImageRoleBundles };
