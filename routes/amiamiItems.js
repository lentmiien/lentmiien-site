const express = require('express');
const Role = require('../models/role');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../middleware/requireCapabilities');
const controller = require('../controllers/amiamiItemsController');

function createAmiAmiItemsRouter({ roleModel = Role } = {}) {
  const router = express.Router();
  const requireCatalogRead = createRequireCapabilities({
    capabilities: ['amiami.items.read'],
    roleModel,
    // This capability reads any entry in the admin-managed catalog.
    roleCapabilityBundles: { admin: ['amiami.items.read'], family: [], user: [] },
  });

  router.get('/:id', (req, res, next) => {
    res.set('Cache-Control', PRIVATE_NO_STORE);
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !/^[a-f\d]{24}$/i.test(String(req.user?._id || ''))) {
      return res.status(401).send('Sign in to view saved AmiAmi items.');
    }
    return next();
  }, requireCatalogRead, controller.detail);

  return router;
}

module.exports = { createAmiAmiItemsRouter };
