const CAPABILITIES = ['account.profile.read', 'account.email.write', 'account.password.write'];
const ROLE_BUNDLES = { admin: CAPABILITIES, family: CAPABILITIES, user: CAPABILITIES, other: CAPABILITIES };

module.exports = { CAPABILITIES, ROLE_BUNDLES };
