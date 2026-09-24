const mongoose = require('mongoose');
const Job = require('../models/amiami_upload_job');
const Item = require('../models/amiami_item');
const User = require('../models/useraccount');
const Role = require('../models/role');
const logger = require('../utils/logger');
const { hasCapabilities } = require('../utils/authorization');
const { IMPORT, ROLE_BUNDLES } = require('../utils/amiamiUploadPolicy');
const { attemptMissingItemScrape } = require('./amiamiItemFallbackService');
const { createAmiAmiUploadService } = require('./amiamiUploadService');

async function authorizeCreator(id) {
  if (!/^[a-f\d]{24}$/i.test(id || '')) return false;
  const user = await User.findById(id).maxTimeMS(5000).lean().exec();
  return hasCapabilities(user, [IMPORT], { roleModel: Role, roleCapabilityBundles: ROLE_BUNDLES });
}

module.exports = createAmiAmiUploadService({ jobModel: Job, itemModel: Item,
  attemptMissingItemScrape, authorizeCreator, logger,
  ready: () => mongoose.connection.readyState === 1 });
