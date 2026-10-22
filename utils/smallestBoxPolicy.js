const CAPABILITIES = {
  read: 'packing.container.read',
  write: 'packing.container.write',
  run: 'packing.search.run',
  api: 'packing.api.manage',
};
const ROLE_BUNDLES = { admin: Object.values(CAPABILITIES), family: [CAPABILITIES.read, CAPABILITIES.run], user: [CAPABILITIES.read, CAPABILITIES.run] };
module.exports = { CAPABILITIES, ROLE_BUNDLES };
