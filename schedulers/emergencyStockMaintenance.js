'use strict';

const mongoose = require('mongoose');
const {
  ESCategory,
  ESItem,
  ESProfile,
  ESShoppingRequirement,
} = require('../database');
const logger = require('../utils/logger');
const { runEmergencyStockMaintenance } = require('../services/emergencyStockMaintenanceService');

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

function getIntervalMs(value = process.env.ES_MAINTENANCE_INTERVAL_MS) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 60_000 ? parsed : DEFAULT_INTERVAL_MS;
}

function createRunner(dependencies = {}) {
  const models = {
    CategoryModel: dependencies.CategoryModel || ESCategory,
    ItemModel: dependencies.ItemModel || ESItem,
    ProfileModel: dependencies.ProfileModel || ESProfile,
    RequirementModel: dependencies.RequirementModel || ESShoppingRequirement,
    logger: dependencies.logger || logger,
  };
  return async function run() {
    try {
      return await runEmergencyStockMaintenance(models);
    } catch (error) {
      await models.logger.warning('Emergency stock maintenance failed', {
        category: 'emergency-stock',
        metadata: { error: error.message },
      });
      return null;
    }
  };
}

function scheduleEmergencyStockMaintenance() {
  const start = () => {
    const run = createRunner();
    const runWhenReady = () => {
      if (mongoose.connection.readyState !== 1) return;
      run().catch(() => {});
    };
    runWhenReady();
    const handle = setInterval(runWhenReady, getIntervalMs());
    handle.unref?.();
    logger.notice('Emergency stock maintenance scheduler started', {
      category: 'emergency-stock',
      metadata: { intervalMs: getIntervalMs() },
    });
    return handle;
  };

  if (mongoose.connection.readyState === 1) return start();
  mongoose.connection.once('connected', start);
  return null;
}

module.exports = scheduleEmergencyStockMaintenance;
module.exports.createRunner = createRunner;
module.exports.getIntervalMs = getIntervalMs;
