const mongoose = require('mongoose');
const logger = require('../utils/logger');

const SYSTEM_COLLECTION_PREFIX = 'system.';

function assertConnectionReady() {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('MongoDB connection is not ready.');
  }
  if (!mongoose.connection.db) {
    throw new Error('MongoDB database handle is unavailable.');
  }
  return mongoose.connection.db;
}

async function getCollectionStats(db, collectionName) {
  try {
    const stats = await db.command({ collStats: collectionName, scale: 1 });
    return {
      name: collectionName,
      count: stats.count || 0,
      sizeBytes: stats.size || 0,
      storageSizeBytes: stats.storageSize || 0,
      totalIndexSizeBytes: stats.totalIndexSize || 0,
      avgObjSizeBytes: stats.avgObjSize || 0,
      capped: Boolean(stats.capped),
    };
  } catch (error) {
    logger.warning('Failed to read MongoDB collection stats', {
      category: 'database_usage',
      metadata: { collection: collectionName, error: error.message },
    });
    return {
      name: collectionName,
      error: error.message,
    };
  }
}

async function fetchDatabaseUsage({ includeSystemCollections = false } = {}) {
  const db = assertConnectionReady();
  const collectionsCursor = db.listCollections({}, { nameOnly: true });
  const [dbStats, collections] = await Promise.all([
    db.stats(),
    collectionsCursor.toArray(),
  ]);
  const visibleCollections = collections
    .map((item) => item.name)
    .filter((name) => typeof name === 'string' && (includeSystemCollections || !name.startsWith(SYSTEM_COLLECTION_PREFIX)));

  const collectionStats = await Promise.all(visibleCollections.map((name) => getCollectionStats(db, name)));

  return {
    generatedAt: new Date(),
    dbStats: {
      name: db.databaseName,
      collections: dbStats.collections || visibleCollections.length,
      objects: dbStats.objects || 0,
      dataSizeBytes: dbStats.dataSize || 0,
      storageSizeBytes: dbStats.storageSize || 0,
      indexSizeBytes: dbStats.indexSize || 0,
      avgObjSizeBytes: dbStats.avgObjSize || 0,
    },
    collectionStats,
  };
}

const DEFAULT_ALERT_THRESHOLDS = {
  totalStorageBytes: 10 * 1024 * 1024 * 1024,
  apiDebugBytes: 500 * 1024 * 1024,
  apiDebugNamePattern: /api[_-]?debug/i,
};

function findCollectionMatch(collectionStats = [], targetName, fallbackPattern) {
  if (!Array.isArray(collectionStats) || collectionStats.length === 0) {
    return null;
  }
  if (targetName) {
    const direct = collectionStats.find((collection) => collection.name === targetName);
    if (direct) {
      return direct;
    }
  }
  if (fallbackPattern instanceof RegExp) {
    return collectionStats.find((collection) => typeof collection.name === 'string' && fallbackPattern.test(collection.name));
  }
  return null;
}

function evaluateAlerts(usage, options = {}) {
  if (!usage) {
    return [];
  }
  const { thresholds = {}, collectionHints = {} } = options;
  const config = {
    ...DEFAULT_ALERT_THRESHOLDS,
    ...thresholds,
  };
  const alerts = [];
  const totalStorageBytes = usage.dbStats?.storageSizeBytes || 0;

  if (config.totalStorageBytes && totalStorageBytes > config.totalStorageBytes) {
    alerts.push({
      type: 'totalStorage',
      level: 'warning',
      actualBytes: totalStorageBytes,
      thresholdBytes: config.totalStorageBytes,
    });
  }

  const collectionStats = Array.isArray(usage.collectionStats)
    ? usage.collectionStats.filter((collection) => collection && !collection.error)
    : [];
  const apiDebugCollection = findCollectionMatch(
    collectionStats,
    collectionHints.apiDebugCollectionName,
    config.apiDebugNamePattern,
  );

  if (apiDebugCollection && config.apiDebugBytes && (apiDebugCollection.storageSizeBytes || 0) > config.apiDebugBytes) {
    alerts.push({
      type: 'apiDebug',
      level: 'info',
      actualBytes: apiDebugCollection.storageSizeBytes || 0,
      thresholdBytes: config.apiDebugBytes,
      collectionName: apiDebugCollection.name,
      documentCount: apiDebugCollection.count || 0,
      totalStorageBytes,
    });
  }

  return alerts;
}

module.exports = {
  fetchDatabaseUsage,
  evaluateAlerts,
  DEFAULT_ALERT_THRESHOLDS,
};
