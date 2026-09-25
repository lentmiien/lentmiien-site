#!/usr/bin/env node
/* No application import, dotenv loading, database connection, or writes in preview mode. */
const fs = require('fs');
const { preview } = require('../services/taric/importer');
const { TEMPLATE, strictJson } = require('../utils/taricProtocol');
// O_NOFOLLOW is not available on every supported platform (notably Windows).
// Check the path and the opened file as well; never accept a symlink or directory.
function readPrivateFile(filename, maxBytes) {
  const before = fs.lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maxBytes) throw new Error('Invalid private file');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.size > maxBytes || opened.dev !== before.dev || opened.ino !== before.ino) throw new Error('Invalid private file');
    // One extra byte detects growth without an unbounded readFile allocation.
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0; let count;
    while (size < buffer.length && (count = fs.readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += count;
    if (size > maxBytes) { buffer.fill(0); throw new Error('Invalid private file'); }
    return buffer.subarray(0, size);
  } finally { fs.closeSync(fd); }
}
async function main(args = process.argv.slice(2)) {
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--bootstrap', '--execute', '--allow-database-write', '--file', '--version', '--review-file', '--owner'].includes(key) || flags.has(key)) throw new Error('Invalid arguments');
    const value = ['--file', '--version', '--review-file', '--owner'].includes(key) ? args[++i] : true;
    if (value !== true && (typeof value !== 'string' || !value || value.startsWith('--'))) throw new Error('Missing argument');
    flags.set(key, value);
  }
  const owner = flags.get('--owner') || 'taric-tool';
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(owner)) throw new Error('Invalid tool owner');
  const models = require('../models/taric_tool');
  let bytes; let report;
  if (flags.has('--file')) {
    bytes = readPrivateFile(flags.get('--file'), 2097152);
    report = (await preview(bytes)).manifest;
  }
  const output = { dryRun: !flags.has('--execute'), collections: Object.values(models).map(m => ({ name: m.collection.name, indexes: m.schema.indexes() })),
    template: TEMPLATE, ...(report ? { import: report } : {}) };
  if (!flags.has('--execute')) { bytes?.fill(0); process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); return; }
  if (!flags.has('--allow-database-write') || !process.env.MONGOOSE_URL) throw new Error('Explicit database write flag and MONGOOSE_URL required');
  if (!flags.has('--bootstrap') && !bytes) throw new Error('Choose bootstrap or import');
  const mongoose = require('mongoose');
  const { createService } = require('../services/taric/service');
  try {
    await mongoose.connect(process.env.MONGOOSE_URL, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000 });
    if (flags.has('--bootstrap')) {
      const existing = await models.Settings.findById('tool').maxTimeMS(2000).lean().exec();
      if (flags.has('--owner') && existing && existing.owner !== owner) throw new Error('Existing tool owner differs');
      for (const model of Object.values(models)) { await model.createCollection(); await model.createIndexes(); }
      // Foundation evidence upserts rely on this source identity uniqueness.
      await mongoose.connection.collection('amiamiitems').createIndex({ gcode: 1 }, { unique: true, name: 'gcode_1' });
      await mongoose.connection.collection('amiamiitems').createIndex({ 'details.janCode': 1 }, { name: 'details.janCode_1' });
      await models.Settings.updateOne({ _id: 'tool' }, { $setOnInsert: { revision: 1, owner,
        enabled: false, maxTokens: 256, currentBenchmark: null, catalog: null, testCatalog: null, runtime: { adapters: [] } } }, { upsert: true });
      for (const name of ['management', 'inference', 'fetch-budget']) await models.Control.updateOne({ _id: name }, { $setOnInsert: { holder: '', until: new Date(0) } }, { upsert: true });
    }
    if (bytes) {
      const version = Number(flags.get('--version'));
      if (!flags.has('--version')) throw new Error('Explicit benchmark version required');
      const defaultReview = { targetsReviewed: false, independent: false, trainingExcluded: false,
        provenance: 'Training-derived source; diagnostic only', reviewer: 'operator import', sourceLineage: ['v0'], minExact: 1, maxInvalid: 0 };
      if (version > 0 && !flags.has('--review-file')) throw new Error('Independent benchmarks require a review sidecar');
      let review = defaultReview;
      if (flags.has('--review-file')) {
        const reviewBytes = readPrivateFile(flags.get('--review-file'), 8192);
        try { review = strictJson(new TextDecoder('utf-8', { fatal: true }).decode(reviewBytes), 'IMPORT_INVALID'); }
        finally { reviewBytes.fill(0); }
      }
      const service = createService({ models, transport: {}, evidence: {} });
      const imported = await service.importBenchmark(bytes, version, review, 'operator');
      output.importId = imported.id; output.alreadyImported = imported.alreadyImported;
      output.policy = imported.policy;
    }
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally { bytes?.fill(0); await mongoose.disconnect(); }
}
if (require.main === module) main().catch(() => { require('../utils/logger').error('TARIC bootstrap/import failed; inspect validation and database/index readiness', { category: 'taric', metadata: { code: 'OPERATOR_IMPORT_FAILED' } }); process.stderr.write('TARIC operation failed. Check arguments, file validation, database readiness, and existing version/index constraints. No payload details are logged.\n'); process.exitCode = 1; });
module.exports = { main, readPrivateFile };
