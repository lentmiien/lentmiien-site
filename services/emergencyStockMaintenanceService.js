'use strict';

const {
  buildEmergencyStockSnapshot,
  buildShoppingRequirements,
} = require('./emergencyStockService');

const DAY_MS = 24 * 60 * 60 * 1000;
const RESOLVED_ITEM_RETENTION_DAYS = 30;

async function cleanupResolvedItems({
  ItemModel,
  now = new Date(),
  retentionDays = RESOLVED_ITEM_RETENTION_DAYS,
} = {}) {
  if (!ItemModel || typeof ItemModel.deleteMany !== 'function') {
    throw new TypeError('ItemModel with deleteMany is required');
  }
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const result = await ItemModel.deleteMany({
    status: { $in: ['consumed', 'discarded', 'replaced'] },
    resolvedAt: { $type: 'date', $lte: cutoff },
  });
  return {
    cutoff,
    removed: Number(result?.deletedCount) || 0,
  };
}

async function syncShoppingRequirements({
  RequirementModel,
  categories = [],
  items = [],
  profile = {},
  existingRequirements = [],
  now = new Date(),
} = {}) {
  if (!RequirementModel || typeof RequirementModel.updateOne !== 'function') {
    throw new TypeError('RequirementModel with updateOne is required');
  }
  const calculated = buildShoppingRequirements({
    categories,
    items,
    profile,
    existingRequirements,
    now,
  });
  const existingByFingerprint = new Map(existingRequirements.map(requirement => [requirement.fingerprint, requirement]));
  const activeFingerprints = calculated.map(requirement => requirement.fingerprint);

  await Promise.all(calculated.map(requirement => {
    const { status: _calculatedStatus, ...fields } = requirement;
    const prior = existingByFingerprint.get(requirement.fingerprint);
    const update = { $set: fields };
    if (prior?.status === 'resolved') {
      update.$set.status = 'needed';
      update.$unset = { resolvedAt: 1, plannedAt: 1, purchasedAt: 1 };
    } else if (!prior) {
      update.$setOnInsert = { status: 'needed' };
    }
    return RequirementModel.updateOne(
      { fingerprint: requirement.fingerprint },
      update,
      { upsert: true, runValidators: true },
    );
  }));

  const staleQuery = {
    status: { $in: ['needed', 'planned', 'purchased'] },
    trigger: { $ne: 'manual' },
  };
  if (activeFingerprints.length > 0) {
    staleQuery.fingerprint = { $nin: activeFingerprints };
  }
  const staleResult = await RequirementModel.updateMany(staleQuery, {
    $set: { status: 'resolved', resolvedAt: now },
  });

  return {
    active: calculated.length,
    resolved: Number(staleResult?.modifiedCount) || 0,
    requirements: calculated,
  };
}

async function runEmergencyStockMaintenance({
  CategoryModel,
  ItemModel,
  ProfileModel,
  RequirementModel,
  logger,
  now = new Date(),
} = {}) {
  const [categories, items, profile, existingRequirements] = await Promise.all([
    CategoryModel.find({}).lean(),
    ItemModel.find({}).lean(),
    ProfileModel.findOne({ key: 'household' }).lean(),
    RequirementModel.find({ status: { $in: ['needed', 'planned', 'purchased', 'resolved'] } }).lean(),
  ]);

  const shopping = await syncShoppingRequirements({
    RequirementModel,
    categories,
    items,
    profile: profile || {},
    existingRequirements,
    now,
  });
  const snapshot = buildEmergencyStockSnapshot({ categories, items, profile: profile || {}, now });
  const cleanup = await cleanupResolvedItems({ ItemModel, now });
  const categoryIds = new Set(categories.map(category => String(category._id || category.id || '')));
  const orphanItems = items.filter(item => !categoryIds.has(String(item.categoryId || '')));

  if (orphanItems.length > 0 && logger?.warning) {
    await logger.warning('Emergency stock contains items whose category is missing', {
      category: 'emergency-stock',
      metadata: {
        count: orphanItems.length,
        itemIds: orphanItems.slice(0, 10).map(item => String(item._id || item.id || '')),
      },
    });
  }

  if (snapshot.sanityWarnings.length > 0 && logger?.warning) {
    await logger.warning('Emergency stock readiness calculation failed a sanity check', {
      category: 'emergency-stock',
      metadata: {
        warnings: snapshot.sanityWarnings.map(warning => ({
          code: warning.code,
          domain: warning.domain,
          value: warning.value,
        })),
      },
    });
  }

  if (snapshot.unitConversionIssues.length > 0 && logger?.error) {
    await logger.error('Emergency stock has an interrupted unit conversion that requires recovery', {
      category: 'emergency-stock',
      metadata: {
        conversions: snapshot.unitConversionIssues.map(issue => ({
          categoryId: issue.categoryId,
          operationId: issue.operationId,
          startedAt: issue.startedAt,
        })),
      },
    });
  }

  if (cleanup.removed > 0 && logger?.notice) {
    await logger.notice('Emergency stock cleanup removed resolved records', {
      category: 'emergency-stock',
      metadata: { removed: cleanup.removed, cutoff: cleanup.cutoff },
    });
  }
  return { shopping, cleanup };
}

module.exports = {
  RESOLVED_ITEM_RETENTION_DAYS,
  cleanupResolvedItems,
  runEmergencyStockMaintenance,
  syncShoppingRequirements,
};
