#!/usr/bin/env node
/* No application import, dotenv loading, database connection, or writes in preview mode. */
const fs = require('fs');
const { preview } = require('../services/taric/importer');
const { TEMPLATE } = require('../utils/taricProtocol');
async function main(args = process.argv.slice(2)) {
  const flags = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!['--bootstrap', '--execute', '--allow-database-write', '--file', '--version', '--review-file', '--owner'].includes(key) || flags.has(key)) throw new Error('Invalid arguments');
    flags.set(key, ['--file', '--version', '--review-file', '--owner'].includes(key) ? args[++i] : true);
  }
  const models = require('../models/taric_tool');
  let bytes; let report;
  if (flags.has('--file')) {
    const fd = fs.openSync(flags.get('--file'), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 2097152) throw new Error('Invalid import file');
      bytes = fs.readFileSync(fd);
    } finally { fs.closeSync(fd); }
    report = (await preview(bytes)).manifest;
  }
  const output = { dryRun: !flags.has('--execute'), collections: Object.values(models).map(m => ({ name: m.collection.name, indexes: m.schema.indexes() })),
    template: TEMPLATE, ...(report ? { import: report } : {}) };
  if (!flags.has('--execute')) { process.stdout.write(`${JSON.stringify(output, null, 2)}\n`); return; }
  if (!flags.has('--allow-database-write') || !process.env.MONGOOSE_URL) throw new Error('Explicit database write flag and MONGOOSE_URL required');
  if (!flags.has('--bootstrap') && !bytes) throw new Error('Choose bootstrap or import');
  const mongoose = require('mongoose');
  const { createService } = require('../services/taric/service');
  try {
    await mongoose.connect(process.env.MONGOOSE_URL, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 5000 });
    if (flags.has('--bootstrap')) {
      for (const model of Object.values(models)) { await model.createCollection(); await model.createIndexes(); }
      // Foundation evidence upserts rely on this source identity uniqueness.
      await mongoose.connection.collection('amiamiitems').createIndex({ gcode: 1 }, { unique: true, name: 'gcode_1' });
      const owner = flags.get('--owner') || 'taric-tool';
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(owner)) throw new Error('Invalid tool owner');
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
        const stat = fs.lstatSync(flags.get('--review-file'));
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8192) throw new Error('Invalid review sidecar');
        review = JSON.parse(fs.readFileSync(flags.get('--review-file'), 'utf8'));
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
module.exports = { main };
