const READ = 'disaster.local.read';
const REFRESH = 'disaster.sources.refresh';
const ROLE_BUNDLES = { admin: [READ, REFRESH], family: [], user: [] };
module.exports = { READ, REFRESH, ROLE_BUNDLES };
