const { hasCapabilities, loadAssignedCapabilities, hasCompletePrincipal } = require('./authorization');
const CAPABILITIES = Object.freeze({ read: 'music.library.read', write: 'music.library.write', generate: 'music.generation.create', admin: 'music.gateway.manage' });
const shared = [CAPABILITIES.read, CAPABILITIES.write, CAPABILITIES.generate];
const ROLE_BUNDLES = Object.freeze({ admin: [...shared, CAPABILITIES.admin], family: [], user: [] });
// The existing music grant is the membership grant for this shared library.
// Preserve it through the shared evaluator; do not infer owners of old tracks.
async function musicCapabilities(user, roleModel) {
  if (!hasCompletePrincipal(user) || !user._id) return [];
  const assigned = await loadAssignedCapabilities(user, roleModel);
  return [...new Set([...(ROLE_BUNDLES[user.type_user] || []), ...assigned,
    ...(assigned.includes('music') ? shared : [])])];
}
async function canMusic(user, capability, roleModel) {
  const capabilities = await musicCapabilities(user, roleModel);
  return hasCapabilities(user, [capability], { roleCapabilityBundles: { [user?.type_user]: capabilities } });
}
module.exports = { CAPABILITIES, ROLE_BUNDLES, musicCapabilities, canMusic };
