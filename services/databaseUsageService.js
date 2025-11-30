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
    const stats = await db.collection(collectionName).stats();
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

module.exports = {
  fetchDatabaseUsage,
};
