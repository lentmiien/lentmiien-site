#!/usr/bin/env node
'use strict';

require('dotenv').config();
const mongoose = require('mongoose');
const ESCategory = require('../models/es_category');
const ESItem = require('../models/es_item');
const ESProfile = require('../models/es_profile');
const ESShoppingRequirement = require('../models/es_shopping_requirement');
const logger = require('../utils/logger');
const { runEmergencyStockMaintenance } = require('../services/emergencyStockMaintenanceService');

async function main() {
  if (!process.env.MONGOOSE_URL) {
    throw new Error('MONGOOSE_URL is required. No maintenance was attempted.');
  }
  await mongoose.connect(process.env.MONGOOSE_URL);
  try {
    const result = await runEmergencyStockMaintenance({
      CategoryModel: ESCategory,
      ItemModel: ESItem,
      ProfileModel: ESProfile,
      RequirementModel: ESShoppingRequirement,
      logger,
    });
    const persistedActive = await ESShoppingRequirement.countDocuments({
      status: { $in: ['needed', 'planned', 'purchased'] },
    });
    const summary = {
      calculatedActive: result.shopping.active,
      persistedActive,
      staleRequirementsResolved: result.shopping.resolved,
      resolvedItemsRemoved: result.cleanup.removed,
      countsMatch: persistedActive === result.shopping.active,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.countsMatch) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`Emergency Stock maintenance failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
