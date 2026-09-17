const MANAGE = 'taric.tool.manage';
// Explicitly admin-managed shared tool. No family/user default authority.
const ROLE_BUNDLES = Object.freeze({ admin: [MANAGE], family: [], user: [] });
module.exports = { MANAGE, ROLE_BUNDLES };
