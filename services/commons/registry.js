const { hasCapabilities, hasPermission } = require('../../utils/authorization');
const { OPERATIONS, ROLE_BUNDLES } = require('../../utils/commonsAuthorizationPolicy');
// Destinations are fixed and returned only after authorization; facades carry no URLs/status.
async function portal(id, principal, roleModel) {
  if (id === 'chat' && await hasPermission(principal, 'chat5', { roleModel })) {
    return { message: 'Continue in your normal Chat5 page.', href: '/chat5/top', label: 'Open Chat5' };
  }
  if (id === 'hall' && principal.type_user === 'admin'
    && await hasCapabilities(principal, [OPERATIONS], { roleModel, roleCapabilityBundles: ROLE_BUNDLES })) {
    return { message: 'Village operations are available in a private report.', href: '/commons/diagnostics', label: 'Open diagnostics' };
  }
  return { message: 'This doorway is quiet. No connected tools are available here for your account.' };
}
module.exports = { portal };
