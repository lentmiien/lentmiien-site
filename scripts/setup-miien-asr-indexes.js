#!/usr/bin/env node
'use strict';

// Standalone operator CLI. Never import app.js, database.js, setup.js or models.
const { createHash } = require('crypto');
const { mongo: { MongoClient } } = require('mongoose');
const { validAdmissionIndexes } = require('../utils/miienAsrAdmission');
const logger = require('../utils/logger');
const COLLECTION = 'miien_asr_slots';
const READ_OPTIONS = { maxTimeMS: 5000, timeoutMS: 5000 };
const WRITE_OPTIONS = { maxTimeMS: 60000, timeoutMS: 65000, writeConcern: { w: 'majority' } };
const DATABASE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$/;
const HELP = 'Use --check (default), --runtime-check, or --apply --expected-db NAME. Optional: --expected-db NAME, --env-file PATH. Run from the app checkout. Quiesce ASR workers and independently confirm the service database before apply.';
const MESSAGES = {
  arguments: HELP,
  configuration: 'MONGOOSE_URL is required; check the selected configuration privately.',
  target: 'Database confirmation failed. Use the independently confirmed service database name; do not change app configuration to match this command.',
  topology: 'This command supports ordinary collections on standalone MongoDB or unsharded replica sets. A mongos target requires separate review; no DDL was attempted.',
  schema: 'Incompatible collection or index metadata. Stop for separate operator review; nothing will be replaced or dropped.',
  populated: 'The principal index is missing on a populated collection. Stop for separate lock/data review after proving Gateway settlement; no records were read out or changed.',
  changed: 'Metadata changed during provisioning. Keep ASR quiesced and run --check; no automatic repair was attempted.',
  verify: 'Provisioning did not verify ready. Keep ASR quiesced and rerun --check; partial additions are retained safely.',
};
class ProvisionError extends Error {
  constructor(code, indexes) { super(MESSAGES[code]); this.code = code; this.indexes = indexes; }
}
const exactKey = (index, field) => index?.key && Object.keys(index.key).length === 1 && index.key[field] === 1;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);

function targetIdentity(client, source) {
  const options = client.options;
  return {
    database: client.db().databaseName,
    configurationSource: source,
    // Never hash passwords or emit hosts, URI options, usernames or auth source.
    targetFingerprint: hash([options.srvHost || options.hosts.map(host => host.toString()).sort(), options.replicaSet || '', options.dbName]),
    configuredAccountFingerprint: options.credentials
      ? hash([options.credentials.username, options.credentials.source, options.credentials.mechanism]) : null,
  };
}

function indexSummary(index) {
  // Custom names/keys and option payloads can contain private values. Only emit
  // known names/key shapes and booleans, never raw server metadata.
  return {
    name: ['_id_', 'principalId_1'].includes(index?.name) ? index.name : '[other index]',
    key: exactKey(index, '_id') ? { _id: 1 } : exactKey(index, 'principalId') ? { principalId: 1 } : '[other key]',
    unique: index?.name === '_id_' && exactKey(index, '_id') && index.unique !== false ? true : index?.unique === true,
    uniqueness: index?.name === '_id_' ? 'inherent' : 'explicit',
    sparse: index?.sparse === true,
    hasPartialFilter: Object.hasOwn(index || {}, 'partialFilterExpression'),
    hasTTL: Object.hasOwn(index || {}, 'expireAfterSeconds'),
    hasNonstandardOptions: Object.keys(index || {}).some(option => !['v', 'ns', 'name', 'key', 'unique', 'sparse', 'background'].includes(option)),
  };
}

async function readIndexes(collection) {
  try { return await collection.listIndexes(READ_OPTIONS).toArray(); }
  catch (error) { if (error.code === 26) return null; throw error; }
}

function assertCompatibleIndexes(indexes) {
  const conflict = () => new ProvisionError('schema', indexes);
  const allowedOptions = ['v', 'ns', 'name', 'key', 'unique', 'sparse', 'background'];
  if (!Array.isArray(indexes) || !indexes.length || indexes.some(index => !index?.key ||
    Object.keys(index).some(option => !allowedOptions.includes(option)) || index.sparse === true ||
    Object.values(index.key).some(direction => direction !== 1 && direction !== -1))) throw conflict();
  const id = indexes.find(index => index.name === '_id_');
  if (!id || !exactKey(id, '_id') || id.unique === false) throw conflict();
  for (const index of indexes) {
    if (index.name === 'principalId_1' && (!exactKey(index, 'principalId') || index.unique !== true)) throw conflict();
    if (Object.hasOwn(index.key, 'principalId') && index.name !== 'principalId_1') throw conflict();
    if (Object.hasOwn(index.key, '_id') && index.name !== '_id_') throw conflict();
    // Additional nonunique ordinary indexes do not change admission semantics.
    if (!['_id_', 'principalId_1'].includes(index.name) && index.unique === true) throw conflict();
  }
}

async function inspect(db, { runtimeOnly = false } = {}) {
  const collection = db.collection(COLLECTION);
  if (runtimeOnly) {
    const indexes = await readIndexes(collection);
    return { state: !indexes ? 'missing_collection' : validAdmissionIndexes(indexes) ? 'ready' : 'unsafe_indexes', indexes: indexes || [] };
  }
  const metadata = await db.listCollections({ name: COLLECTION }, { ...READ_OPTIONS, nameOnly: false }).toArray();
  if (!metadata.length) {
    // Distinguish absence from inconsistent metadata; permissions are never absence.
    if (await readIndexes(collection) !== null) throw new ProvisionError('changed');
    return { state: 'missing_collection', indexes: [] };
  }
  if (metadata.length !== 1 || metadata[0].type !== 'collection' || Object.keys(metadata[0].options || {}).length) throw new ProvisionError('schema');
  const indexes = await readIndexes(collection);
  assertCompatibleIndexes(indexes);
  if (validAdmissionIndexes(indexes)) return { state: 'ready', indexes };
  // Conservative preflight: no data repair or duplicate values read into the CLI.
  // A bounded existence count rejects ALL populated incomplete collections.
  if (await collection.countDocuments({}, { ...READ_OPTIONS, limit: 1 }) !== 0) throw new ProvisionError('populated');
  return { state: 'missing_principal_index', indexes };
}

async function setupMiienAsrIndexes(db, { apply = false, expectedDb, runtimeOnly = false } = {}) {
  if (!DATABASE_NAME.test(db.databaseName) || (expectedDb !== undefined && expectedDb !== db.databaseName) ||
    (apply && (!expectedDb || runtimeOnly))) throw new ProvisionError('target');
  let current = await inspect(db, { runtimeOnly });
  const before = current.state;
  if (apply && current.state !== 'ready') {
    if (current.state === 'missing_collection') {
      await db.createCollection(COLLECTION, WRITE_OPTIONS);
      // MongoDB creates _id_ itself. Never request unique:false (or a second _id index).
      current = await inspect(db);
      if (current.state !== 'missing_principal_index') throw new ProvisionError('changed');
    }
    await db.collection(COLLECTION).createIndex({ principalId: 1 }, {
      name: 'principalId_1', unique: true, ...WRITE_OPTIONS,
    });
    current = await inspect(db);
    if (current.state !== 'ready') throw new ProvisionError('verify');
  }
  return { collection: COLLECTION, mode: apply ? 'apply' : runtimeOnly ? 'runtime-check' : 'check',
    before, state: current.state, ready: current.state === 'ready', indexes: current.indexes.map(indexSummary) };
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (['--check', '--runtime-check', '--apply', '--help'].includes(arg)) {
      if (parsed.mode) throw new ProvisionError('arguments');
      parsed.mode = arg;
    } else if (['--expected-db', '--env-file'].includes(arg)) {
      if (parsed[arg] || !args[i + 1] || args[i + 1].startsWith('--')) throw new ProvisionError('arguments');
      parsed[arg] = args[++i];
    } else throw new ProvisionError('arguments');
  }
  if ((parsed['--expected-db'] !== undefined && !DATABASE_NAME.test(parsed['--expected-db'])) ||
    (parsed.mode === '--apply' && !parsed['--expected-db'])) throw new ProvisionError('target');
  return parsed;
}

function safeFailure(error) {
  if (error instanceof ProvisionError) return { code: error.code, message: MESSAGES[error.code],
    ...(Array.isArray(error.indexes) ? { indexes: error.indexes.map(indexSummary) } : {}) };
  const code = Number.isInteger(error?.code) ? error.code : null;
  const message = [13, 18].includes(code) ? 'Database authentication/authorization failed. Check the selected account and scoped permissions.'
    : code === 11000 ? 'Unique index creation found conflicting data. Stop for separate review; never delete locks automatically.'
      : [48, 85, 86].includes(code) ? 'Collection/index conflict or concurrent DDL. Keep ASR quiesced and run --check; do not drop or replace anything.'
        : 'Database operation failed or timed out. Confirm target/access privately and rerun --check; a timed-out write may have completed. Do not delete locks or undo indexes.';
  return { code: 'database_operation_failed', mongoCode: code, message };
}

async function main(args = process.argv.slice(2), {
  env = process.env, loadConfig = options => require('dotenv').config(options), Client = MongoClient,
  output = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`), log = logger,
} = {}) {
  let client;
  try {
    const parsed = parseArgs(args);
    if (parsed.mode === '--help') { output({ usage: HELP }); return 0; }
    const inherited = Object.hasOwn(env, 'MONGOOSE_URL');
    const config = loadConfig({ quiet: true, override: false, processEnv: env,
      ...(parsed['--env-file'] ? { path: parsed['--env-file'] } : {}) });
    if ((parsed['--env-file'] && config?.error) || !env.MONGOOSE_URL) throw new ProvisionError('configuration');
    client = new Client(env.MONGOOSE_URL, {
      serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, timeoutMS: 65000,
      maxPoolSize: 1, readPreference: 'primary', retryWrites: false,
    });
    const db = client.db();
    if (!DATABASE_NAME.test(db.databaseName) || (parsed['--expected-db'] && parsed['--expected-db'] !== db.databaseName)) throw new ProvisionError('target');
    output({ target: targetIdentity(client, inherited ? 'inherited MONGOOSE_URL' : parsed['--env-file'] ? 'selected env file' : 'working-directory .env') });
    await client.connect();
    if ((await db.command({ hello: 1 }, READ_OPTIONS)).msg === 'isdbgrid') throw new ProvisionError('topology');
    const result = await setupMiienAsrIndexes(db, {
      apply: parsed.mode === '--apply', runtimeOnly: parsed.mode === '--runtime-check', expectedDb: parsed['--expected-db'],
    });
    output(result);
    if (!result.ready) await log.warning('Miien ASR provisioning check found missing or unsafe admission indexes', {
      category: 'chat5_miien_asr', metadata: { code: result.state, mode: result.mode },
    });
    return result.ready ? 0 : 2;
  } catch (error) {
    const failure = safeFailure(error);
    output({ error: failure });
    await log.error('Miien ASR provisioning/check failed; follow the sanitized diagnostic before retrying', {
      category: 'chat5_miien_asr', metadata: failure,
    });
    return 1;
  } finally {
    if (client) await client.close().catch(async () => {
      await log.warning('Miien ASR provisioning connection close failed', { category: 'chat5_miien_asr' });
    });
  }
}

if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { COLLECTION, setupMiienAsrIndexes, parseArgs, main, safeFailure, targetIdentity };
