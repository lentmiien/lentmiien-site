const CAPABILITIES = {
  read: 'packing.container.read',
  write: 'packing.container.write',
  run: 'packing.search.run',
};
const ROLE_BUNDLES = { admin: Object.values(CAPABILITIES), family: [], user: [] };
module.exports = { CAPABILITIES, ROLE_BUNDLES };
