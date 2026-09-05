#!/usr/bin/env node
'use strict';

// No application/database.js import: this CLI must not start workers, sync data or send alerts.
const { mongo: { MongoClient } } = require('mongoose');
const logger = require('../utils/logger');
const REQUIRED = [
  { key: { sampledAt: 1 }, name: 'sampledAt_1' },
  { key: { expiresAt: 1 }, name: 'expiresAt_1', expireAfterSeconds: 0 },
];
const sameKey = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function inspect(collection) {
  let indexes;
  try { indexes = await collection.listIndexes({ maxTimeMS: 10000 }).toArray(); }
  catch (error) { if (error.code === 26) indexes = []; else throw error; }
  return REQUIRED.map((required) => {
    const match = indexes.find((index) => sameKey(index.key, required.key));
    const conflict = indexes.find((index) => index.name === required.name && !sameKey(index.key, required.key));
    const usable = match && !match.unique && !match.sparse && !match.partialFilterExpression && !match.hidden
      && match.expireAfterSeconds === required.expireAfterSeconds;
    return { name: required.name, status: conflict || (match && !usable) ? 'conflict' : usable ? 'ready' : 'missing' };
  });
}

async function setupConnectivityIndexes(db, { execute = false } = {}) {
  const collection = db.collection('connectivity_samples');
  const before = await inspect(collection);
  // Fail before making any change if an operator must review incompatible options.
  if (before.some((index) => index.status === 'conflict')) throw new Error('Connectivity index conflict; operator review required');
  if (execute) {
    for (const [index, required] of REQUIRED.entries()) {
      if (before[index].status === 'ready') continue;
      const { key, ...options } = required;
      await collection.createIndex(key, { ...options, maxTimeMS: 60000 });
    }
  }
  const indexes = execute ? await inspect(collection) : before;
  return { collection: 'connectivity_samples', mode: execute ? 'execute' : 'verify',
    ready: indexes.every((index) => index.status === 'ready'), indexes };
}

async function main(args = process.argv.slice(2)) {
  if (args.some((arg) => !['--execute', '--verify'].includes(arg)) || args.length > 1) {
    throw new Error('Use --verify (default) or --execute');
  }
  require('dotenv').config({ quiet: true });
  if (!process.env.MONGOOSE_URL) throw new Error('MONGOOSE_URL required');
  const client = new MongoClient(process.env.MONGOOSE_URL, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, timeoutMS: 70000 });
  try {
    await client.connect();
    const result = await setupConnectivityIndexes(client.db(), { execute: args.includes('--execute') });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ready) process.exitCode = 2;
  } finally { await client.close(); }
}

if (require.main === module) main().catch(async () => {
  await logger.error('Connectivity index setup or verification failed; check database access and index definitions before retrying', {
    category: 'connectivity_monitor',
  });
  process.exitCode = 1;
});

module.exports = { setupConnectivityIndexes, inspect };
