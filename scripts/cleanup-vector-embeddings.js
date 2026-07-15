#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');

const DEFAULT_RETENTION_DAYS = 90;

function printUsage() {
  console.log(`
Usage:
  node scripts/cleanup-vector-embeddings.js [--days=90] [--dry-run|--execute]

Options:
  --days, --retention-days  Number of days of standard embeddings to keep.
  --dry-run                 Count matching documents without deleting. Default.
  --execute, --yes          Delete matching standard vector_embeddings documents.
  --help                    Show this help text.

Examples:
  npm run cleanup:vector-embeddings
  npm run cleanup:vector-embeddings:execute
  npm run cleanup:vector-embeddings -- --days=120
`);
}

function readOptionValue(argv, index, raw) {
  const equalIndex = raw.indexOf('=');
  if (equalIndex !== -1) {
    return { value: raw.slice(equalIndex + 1), nextIndex: index };
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

function parseArgs(argv) {
  const options = {
    retentionDays: DEFAULT_RETENTION_DAYS,
    dryRun: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];

    if (raw === '--help' || raw === '-h') {
      options.help = true;
      continue;
    }
    if (raw === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (raw === '--execute' || raw === '--yes') {
      options.dryRun = false;
      continue;
    }
    if (raw === '--days' || raw.startsWith('--days=') || raw === '--retention-days' || raw.startsWith('--retention-days=')) {
      const { value, nextIndex } = readOptionValue(argv, i, raw);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--days must be a positive integer.');
      }
      options.retentionDays = parsed;
      i = nextIndex;
      continue;
    }

    throw new Error(`Unknown option: ${raw}`);
  }

  return options;
}

async function waitForMongooseConnection() {
  if (mongoose.connection.readyState === 1) {
    return;
  }
  if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
    return;
  }
  await mongoose.connect(process.env.MONGOOSE_URL);
}

function formatResult(result) {
  const count = result.dryRun ? result.matchedCount : result.deletedCount;
  return [
    'Standard vector embedding cleanup',
    `Collection: ${result.collectionName}`,
    `Retention: ${result.retentionDays} days`,
    `Cutoff: ${result.cutoff.toISOString()}`,
    `Mode: ${result.dryRun ? 'dry-run' : 'execute'}`,
    `${result.dryRun ? 'Matched' : 'Deleted'}: ${count}`,
    'High-quality collection touched: no',
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printUsage();
    return;
  }

  if (!process.env.MONGOOSE_URL) {
    throw new Error('MONGOOSE_URL is required. Copy env_sample to .env and set the MongoDB connection string.');
  }

  const EmbeddingApiService = require('../services/embeddingApiService');
  await waitForMongooseConnection();

  const service = new EmbeddingApiService();
  const result = await service.cleanupOldDefaultEmbeddings({
    retentionDays: options.retentionDays,
    dryRun: options.dryRun,
  });

  console.log(formatResult(result));
  if (result.dryRun) {
    console.log('Run with --execute to delete the matching standard embeddings.');
  }
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  });
