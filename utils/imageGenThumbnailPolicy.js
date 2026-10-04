const { createRequireCapabilities } = require('../middleware/requireCapabilities');

// These capabilities grant read access to the entire admin-managed library.
// No ownership can be inferred for legacy GoodImage records or Gateway inputs.
const CAPABILITIES = Object.freeze({
  input: 'comfy.inputs.read',
  gallery: 'comfy.gallery.read',
  bulk: 'comfy.bulk.read',
});
const ROLE_BUNDLES = Object.freeze({ admin: Object.values(CAPABILITIES), family: [], user: [] });
const ROUTES = Object.freeze([
  { path: '/api/bulk/jobs/:id/prompts/:promptId/thumbnail', capability: CAPABILITIES.bulk, scope: 'admin-managed', handler: 'getBulkThumbnail' },
  { path: '/api/files/input/thumbnail', capability: CAPABILITIES.input, scope: 'admin-managed', handler: 'getInputThumbnail' },
  { path: '/api/good-images/:id/thumbnail', capability: CAPABILITIES.gallery, scope: 'admin-managed', handler: 'getGoodImageThumbnail' },
]);
function authorizeThumbnail(capability, roleModel) {
  const check = createRequireCapabilities({ capabilities: [capability], roleModel, roleCapabilityBundles: ROLE_BUNDLES });
  return (req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    if (!req.isAuthenticated?.() || !req.user) return res.status(401).json({ error: 'Login required.' });
    return check(req, res, next);
  };
}
module.exports = { CAPABILITIES, ROLE_BUNDLES, ROUTES, authorizeThumbnail };
