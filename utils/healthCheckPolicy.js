const { hasCompletePrincipal } = require('./authorization');
const READ = 'health.check.read';
const IMPORT = 'health.check.import';
const ROLE_BUNDLES = { admin: [READ, IMPORT], family: [READ, IMPORT], user: [READ, IMPORT] };
function isOwner(user, configured = process.env.DASHBOARD_PERSONAL_OWNER_USER_ID) {
  return hasCompletePrincipal(user) && /^[a-f\d]{24}$/i.test(configured || '')
    && String(user._id || '').toLowerCase() === configured.toLowerCase();
}
module.exports = { READ, IMPORT, ROLE_BUNDLES, isOwner };
