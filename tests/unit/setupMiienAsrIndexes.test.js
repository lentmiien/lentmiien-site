const mongoose = require('mongoose');
const { COLLECTION, setupMiienAsrIndexes, main, targetIdentity } = require('../../scripts/setup-miien-asr-indexes');
const { validAdmissionIndexes, requireAsrAdmission } = require('../../utils/miienAsrAdmission');
const idIndex = () => ({ v: 2, key: { _id: 1 }, name: '_id_' });
const principalIndex = () => ({ v: 2, key: { principalId: 1 }, name: 'principalId_1', unique: true });
const safeIndexes = () => [idIndex(), principalIndex()];
const secret = 'mongodb://private-user:private-password@private-host/private-db private-record';

function fixture({ exists = false, indexes = safeIndexes(), options = {}, type = 'collection', count = 0 } = {}) {
  const state = { exists, indexes, options, type, count };
  const collection = {
    listIndexes: jest.fn(() => ({ toArray: async () => {
      if (!state.exists) throw Object.assign(new Error(secret), { code: 26 });
      return state.indexes;
    } })),
    countDocuments: jest.fn(async () => state.count),
    createIndex: jest.fn(async (key, options) => { state.indexes.push({ key, name: options.name, unique: options.unique }); }),
  };
  const db = {
    databaseName: 'miien_test',
    command: jest.fn().mockResolvedValue({}),
    collection: jest.fn(name => { expect(name).toBe(COLLECTION); return collection; }),
    listCollections: jest.fn((filter, options) => {
      expect(filter).toEqual({ name: COLLECTION });
      expect(options).toMatchObject({ nameOnly: false, maxTimeMS: 5000, timeoutMS: 5000 });
      return { toArray: async () => state.exists ? [{ name: COLLECTION, type: state.type, options: state.options }] : [] };
    }),
    createCollection: jest.fn(async name => {
      expect(name).toBe(COLLECTION); state.exists = true; state.indexes = [idIndex()];
    }),
  };
  return { state, collection, db };
}
const apply = db => setupMiienAsrIndexes(db, { apply: true, expectedDb: 'miien_test' });
function noWrites(f) {
  expect(f.db.createCollection).not.toHaveBeenCalled();
  expect(f.collection.createIndex).not.toHaveBeenCalled();
}

test('default check reports absent collection without creating anything or reading records', async () => {
  const f = fixture();
  await expect(setupMiienAsrIndexes(f.db)).resolves.toMatchObject({ mode: 'check', state: 'missing_collection', ready: false });
  noWrites(f); expect(f.collection.countDocuments).not.toHaveBeenCalled();
});

test('apply creates only the named collection and exact principal index, then runtime accepts real metadata', async () => {
  const f = fixture();
  const result = await apply(f.db);
  expect(result).toMatchObject({ before: 'missing_collection', state: 'ready', ready: true });
  expect(f.db.createCollection).toHaveBeenCalledWith(COLLECTION, {
    maxTimeMS: 60000, timeoutMS: 65000, writeConcern: { w: 'majority' },
  });
  expect(f.collection.createIndex).toHaveBeenCalledTimes(1);
  expect(f.collection.createIndex).toHaveBeenCalledWith({ principalId: 1 }, {
    name: 'principalId_1', unique: true, maxTimeMS: 60000, timeoutMS: 65000, writeConcern: { w: 'majority' },
  });
  expect(validAdmissionIndexes(f.state.indexes)).toBe(true);
  await expect(requireAsrAdmission({ db: { readyState: 1, db: f.db }, collection: f.collection })).resolves.toBeUndefined();
  expect(result.indexes[0]).toMatchObject({ unique: true, uniqueness: 'inherent' });
});

test.each([undefined, true])('already-correct metadata with inherent _id unique=%s is a no-op even with records', async unique => {
  const f = fixture({ exists: true, indexes: [{ ...idIndex(), ...(unique === undefined ? {} : { unique }) }, principalIndex()], count: 2 });
  await expect(apply(f.db)).resolves.toMatchObject({ ready: true, before: 'ready' });
  noWrites(f); expect(f.collection.countDocuments).not.toHaveBeenCalled();
});

test('missing principal on an empty ordinary collection adds only that index', async () => {
  const f = fixture({ exists: true, indexes: [idIndex()] });
  await expect(setupMiienAsrIndexes(f.db)).resolves.toMatchObject({ state: 'missing_principal_index' });
  noWrites(f);
  await expect(apply(f.db)).resolves.toMatchObject({ ready: true });
  expect(f.db.createCollection).not.toHaveBeenCalled();
  expect(f.collection.countDocuments).toHaveBeenCalledWith({}, { limit: 1, maxTimeMS: 5000, timeoutMS: 5000 });
});

const conflicts = [
  ['missing _id', [principalIndex()]], ['empty index list', []],
  ['nonunique _id', [{ ...idIndex(), unique: false }, principalIndex()]],
  ['wrong _id shape', [{ ...idIndex(), key: { _id: -1 } }, principalIndex()]],
  ...[
    ['missing unique', { unique: undefined }], ['nonunique', { unique: false }],
    ['wrong name', { name: 'custom' }], ['wrong key', { key: { jobId: 1 } }],
    ['descending', { key: { principalId: -1 } }], ['compound', { key: { principalId: 1, jobId: 1 } }],
    ['sparse', { sparse: true }], ['partial', { partialFilterExpression: { privateValue: secret } }],
    ['TTL', { expireAfterSeconds: 0 }], ['hidden', { hidden: true }],
    ['collation', { collation: { locale: 'en', strength: 2 } }], ['unfinished conversion', { prepareUnique: true }],
  ].map(([name, options]) => [name, [idIndex(), { ...principalIndex(), ...options }]]),
  ['extra TTL', [...safeIndexes(), { name: 'ttl', key: { startedAt: 1 }, expireAfterSeconds: 60 }]],
  ['extra sparse', [...safeIndexes(), { name: 'sparse', key: { jobId: 1 }, sparse: true }]],
  ['extra unique', [idIndex(), { name: 'other', key: { jobId: 1 }, unique: true }]],
  ['alternate principal key shape', [idIndex(), { name: 'other', key: { principalId: -1 } }]],
];
test.each(conflicts)('%s conflicts before any write', async (_, indexes) => {
  const f = fixture({ exists: true, indexes });
  await expect(apply(f.db)).rejects.toMatchObject({ code: 'schema' });
  noWrites(f); expect(f.collection.countDocuments).not.toHaveBeenCalled();
});

test.each([{ capped: true }, { validator: { privateValue: secret } }, { collation: { locale: 'en' } }, { timeseries: {} }, { clusteredIndex: {} }])('collection options %j refuse before writes', async options => {
  const f = fixture({ exists: true, options });
  await expect(apply(f.db)).rejects.toMatchObject({ code: 'schema' }); noWrites(f);
});

test('views are refused', async () => {
  const f = fixture({ exists: true, type: 'view' });
  await expect(apply(f.db)).rejects.toMatchObject({ code: 'schema' }); noWrites(f);
});

test.each(['duplicate principals', 'missing principal values', 'valid outstanding lock'])('%s on incomplete schema refuses without exporting or changing data', async () => {
  const f = fixture({ exists: true, indexes: [idIndex()], count: 1 });
  await expect(apply(f.db)).rejects.toMatchObject({ code: 'populated' }); noWrites(f);
});

test.each([{ apply: true }, { apply: true, expectedDb: 'wrong' }, { expectedDb: 'wrong' }, { apply: true, expectedDb: 'miien_test', runtimeOnly: true }])('target guard %j runs before any DB operation', async options => {
  const f = fixture();
  await expect(setupMiienAsrIndexes(f.db, options)).rejects.toMatchObject({ code: 'target' });
  expect(f.db.collection).not.toHaveBeenCalled(); noWrites(f);
});

test('ordinary unrelated nonunique index stays untouched; names and option payloads are not printed', async () => {
  const f = fixture({ exists: true, indexes: [...safeIndexes(), { name: secret, key: { [secret]: 1 } }] });
  const result = await apply(f.db);
  expect(result.ready).toBe(true); expect(JSON.stringify(result)).not.toContain(secret); noWrites(f);
});

test('partial completion and rerun preserve collection and never recreate _id', async () => {
  const f = fixture();
  f.collection.createIndex.mockRejectedValueOnce(Object.assign(new Error(secret), { code: 13 }));
  await expect(apply(f.db)).rejects.toMatchObject({ code: 13 });
  expect(f.state.exists).toBe(true); expect(f.state.indexes).toEqual([idIndex()]);
  await expect(apply(f.db)).resolves.toMatchObject({ ready: true });
  await expect(apply(f.db)).resolves.toMatchObject({ before: 'ready' });
  expect(f.db.createCollection).toHaveBeenCalledTimes(1); expect(f.collection.createIndex).toHaveBeenCalledTimes(2);
});

test('write that completes despite timeout is recognized on rerun without duplicate DDL', async () => {
  const f = fixture();
  f.collection.createIndex.mockImplementationOnce(async () => { f.state.indexes.push(principalIndex()); throw new Error(secret); });
  await expect(apply(f.db)).rejects.toThrow(secret);
  await expect(apply(f.db)).resolves.toMatchObject({ ready: true });
  expect(f.collection.createIndex).toHaveBeenCalledTimes(1);
});

test('namespace race after creating a collection does not continue to create an index', async () => {
  const f = fixture();
  f.db.createCollection.mockImplementationOnce(async () => { f.state.exists = true; f.state.indexes = safeIndexes(); });
  await expect(apply(f.db)).rejects.toMatchObject({ code: 'changed' });
  expect(f.collection.createIndex).not.toHaveBeenCalled();
});

test('runtime check uses only listIndexes and exact existing admission policy', async () => {
  const f = fixture({ exists: true });
  await expect(setupMiienAsrIndexes(f.db, { runtimeOnly: true })).resolves.toMatchObject({ ready: true, mode: 'runtime-check' });
  expect(f.db.listCollections).not.toHaveBeenCalled(); expect(f.collection.countDocuments).not.toHaveBeenCalled(); noWrites(f);
});

function cli(f = fixture()) {
  const client = { db: () => f.db, options: { hosts: ['private-host'], dbName: 'miien_test', credentials: { username: 'private-user', source: 'private-auth' } },
    connect: jest.fn(), close: jest.fn().mockResolvedValue() };
  const dependencies = { env: { MONGOOSE_URL: secret }, Client: jest.fn(() => client),
    loadConfig: jest.fn(), output: jest.fn(), log: { error: jest.fn(), warning: jest.fn() } };
  return { ...f, client, dependencies };
}

test.each([['--apply'], ['--apply', '--expected-db', 'wrong'], ['--apply', '--check'], ['--drop'], ['--expected-db'], ['--expected-db', 'mongodb://secret'], ['--env-file'], ['--apply', '--apply']])('CLI invalid arguments %j never connect or write', async (...args) => {
  const f = cli();
  expect(await main(args, f.dependencies)).toBe(1);
  expect(f.client.connect).not.toHaveBeenCalled(); noWrites(f);
});

test('default CLI is read-only, returns exit 2 and follows dotenv precedence without printing secrets', async () => {
  const f = cli();
  expect(await main([], f.dependencies)).toBe(2); noWrites(f);
  expect(f.dependencies.loadConfig).toHaveBeenCalledWith({ quiet: true, override: false, processEnv: f.dependencies.env });
  expect(f.dependencies.output.mock.calls[0][0].target.configurationSource).toBe('inherited MONGOOSE_URL');
  expect(JSON.stringify(f.dependencies.output.mock.calls)).not.toMatch(/private-user|private-password|private-host|private-auth|private-record/);
  expect(f.client.close).toHaveBeenCalled();
});

test('CLI explicit apply requires matching database and reports ready', async () => {
  const f = cli();
  expect(await main(['--apply', '--expected-db', 'miien_test'], f.dependencies)).toBe(0);
  expect(f.dependencies.output).toHaveBeenLastCalledWith(expect.objectContaining({ ready: true, mode: 'apply' }));
});

test.each([13, 18, 26, 48, 85, 86, 11000, 50, undefined])('database error %s is sanitized in stdout AND shared logger, then connection closes', async code => {
  const f = cli();
  f.client.connect.mockRejectedValueOnce(Object.assign(new Error(secret), { code, name: secret }));
  expect(await main([], f.dependencies)).toBe(1);
  expect(JSON.stringify([f.dependencies.output.mock.calls, f.dependencies.log.error.mock.calls])).not.toMatch(/private-user|private-password|private-host|private-record/);
  expect(f.dependencies.log.error).toHaveBeenCalled(); expect(f.client.close).toHaveBeenCalled(); noWrites(f);
});

test('permission error in metadata is never treated as absent', async () => {
  const f = cli();
  f.collection.listIndexes.mockImplementation(() => ({ toArray: async () => { throw Object.assign(new Error(secret), { code: 13 }); } }));
  expect(await main(['--apply', '--expected-db', 'miien_test'], f.dependencies)).toBe(1); noWrites(f);
});

test('selected env file does not override inherited configuration and read failure stops before connect', async () => {
  const f = cli();
  f.dependencies.loadConfig.mockReturnValue({ error: new Error(secret) });
  expect(await main(['--env-file', 'operator.env'], f.dependencies)).toBe(1);
  expect(f.client.connect).not.toHaveBeenCalled(); noWrites(f);
});

test('help neither loads configuration nor connects', async () => {
  const f = cli();
  expect(await main(['--help'], f.dependencies)).toBe(0);
  expect(f.dependencies.loadConfig).not.toHaveBeenCalled(); expect(f.dependencies.Client).not.toHaveBeenCalled();
});

test('mongos target refuses before inspecting or changing the collection', async () => {
  const f = cli();
  f.db.command.mockResolvedValue({ msg: 'isdbgrid' });
  expect(await main(['--apply', '--expected-db', 'miien_test'], f.dependencies)).toBe(1);
  expect(f.db.listCollections).not.toHaveBeenCalled(); noWrites(f);
});

test('real driver target fingerprint separates clusters/databases/accounts without hashing passwords', () => {
  const make = uri => targetIdentity(new mongoose.mongo.MongoClient(uri), 'synthetic');
  const a = make('mongodb://testuser:password1@127.0.0.1:27099/miien_test');
  expect(make('mongodb://testuser:password2@127.0.0.1:27099/miien_test')).toEqual(a);
  expect(make('mongodb://testuser:password1@127.0.0.1:27098/miien_test').targetFingerprint).not.toBe(a.targetFingerprint);
  expect(make('mongodb://testuser:password1@127.0.0.1:27099/other').targetFingerprint).not.toBe(a.targetFingerprint);
  expect(make('mongodb://other:password1@127.0.0.1:27099/miien_test').configuredAccountFingerprint).not.toBe(a.configuredAccountFingerprint);
});

test('conflict diagnostics omit partial-filter values and custom index names in output and logs', async () => {
  const f = cli(fixture({ exists: true, indexes: [idIndex(), {
    ...principalIndex(), name: secret, partialFilterExpression: { privateValue: secret },
  }] }));
  expect(await main(['--apply', '--expected-db', 'miien_test'], f.dependencies)).toBe(1);
  const reported = JSON.stringify([f.dependencies.output.mock.calls, f.dependencies.log.error.mock.calls]);
  expect(reported).toContain('hasPartialFilter');
  expect(reported).not.toMatch(/private-user|private-password|private-host|private-record|privateValue/);
  noWrites(f);
});

test('explicit file supplies configuration when no inherited MONGOOSE_URL exists', async () => {
  const f = cli(fixture({ exists: true }));
  f.dependencies.env = {};
  f.dependencies.loadConfig.mockImplementation(options => { options.processEnv.MONGOOSE_URL = secret; return {}; });
  expect(await main(['--check', '--env-file', 'operator.env'], f.dependencies)).toBe(0);
  expect(f.dependencies.loadConfig).toHaveBeenCalledWith(expect.objectContaining({ path: 'operator.env', override: false }));
  expect(f.dependencies.output.mock.calls[0][0].target.configurationSource).toBe('selected env file');
  noWrites(f);
});

test('standalone import loads no app, database, setup, models, dotenv or schedulers', () => {
  const { execFileSync } = require('child_process');
  const script = `
    const path = require('path');
    require('./scripts/setup-miien-asr-indexes');
    const root = process.cwd() + path.sep;
    const loaded = Object.keys(require.cache).filter(p => p.startsWith(root)).map(p => p.slice(root.length));
    if (loaded.some(p => /^(app\\.js|database\\.js|setup\\.js|models[\\\\/]|schedulers[\\\\/]|node_modules[\\\\/]dotenv[\\\\/])/.test(p))) process.exit(1);
  `;
  expect(() => execFileSync(process.execPath, ['-e', script], { cwd: require('path').resolve(__dirname, '../..') })).not.toThrow();
});
