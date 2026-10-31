const { hasCapabilities } = require('./authorization');
const Role = require('../models/role');

const MANAGE = 'batch.prompts.manage';
// Explicitly admin-managed queue: this capability may retry any retained failure.
const ROLE_BUNDLES = Object.freeze({ admin: [MANAGE], family: [], user: [] });
const canManageBatch = (principal, roleModel = Role) => Boolean(principal?._id)
  && hasCapabilities(principal, [MANAGE], { roleModel, roleCapabilityBundles: ROLE_BUNDLES });

module.exports = { MANAGE, ROLE_BUNDLES, canManageBatch };
