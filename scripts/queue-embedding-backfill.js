#!/usr/bin/env node

require('dotenv').config({ quiet: true });

const mongoose = require('mongoose');

function printUsage() {
  console.log(`
Usage:
  node scripts/queue-embedding-backfill.js --inbox-ids=<id,...> [--chat-ids=<id,...>] [--execute]

Options:
  --inbox-ids  Comma-separated message_inbox document IDs to queue.
  --chat-ids   Comma-separated chat_message document IDs to queue.
  --dry-run    Validate and count the exact source IDs without changing data. Default.
  --execute    Mark the exact sources pending and create durable queue intents.
  --help       Show this help text.

The command reports counts only and does not print source IDs or message content.
`);
}

function readOptionValue(argv, index, raw) {
  const equalIndex = raw.indexOf('=');
  if (equalIndex !== -1) {
    return { value: raw.slice(equalIndex + 1), nextIndex: index };
  }
  return { value: argv[index + 1], nextIndex: index + 1 };
}

function parseIdList(value, optionName) {
  const ids = String(value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!ids.length) throw new Error(`${optionName} requires at least one document ID.`);
  return [...new Set(ids)];
}

function parseArgs(argv) {
  const options = {
    chatIds: [],
    inboxIds: [],
    dryRun: true,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (raw === '--help' || raw === '-h') {
      options.help = true;
      continue;
    }
    if (raw === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (raw === '--execute') {
      options.dryRun = false;
      continue;
    }
    if (raw === '--chat-ids' || raw.startsWith('--chat-ids=')) {
      const { value, nextIndex } = readOptionValue(argv, index, raw);
      options.chatIds = parseIdList(value, '--chat-ids');
      index = nextIndex;
      continue;
    }
    if (raw === '--inbox-ids' || raw.startsWith('--inbox-ids=')) {
      const { value, nextIndex } = readOptionValue(argv, index, raw);
      options.inboxIds = parseIdList(value, '--inbox-ids');
      index = nextIndex;
      continue;
    }
    throw new Error(`Unknown option: ${raw}`);
  }

  if (!options.help && !options.chatIds.length && !options.inboxIds.length) {
    throw new Error('Provide at least one exact source ID with --chat-ids or --inbox-ids.');
  }
  return options;
}

async function waitForMongooseConnection() {
  if (mongoose.connection.readyState === 1) return;
  if (mongoose.connection.readyState === 2) {
    await mongoose.connection.asPromise();
    return;
  }
  await mongoose.connect(process.env.MONGOOSE_URL);
}

function inboxText(message) {
  const candidates = [message.text, message.textAsHtml, message.html, message.subject];
  return candidates.find((value) => typeof value === 'string' && value.trim()) || '';
}

async function backfillExactSources(options, dependencies = {}) {
  const database = dependencies.database || require('../database');
  const {
    Chat5Model,
    Conversation5Model,
    MessageInboxEntry,
  } = database;
  const embeddingQueueService = dependencies.embeddingQueueService
    || require('../services/embeddingQueueService');
  const result = {
    requested: options.chatIds.length + options.inboxIds.length,
    found: 0,
    eligible: 0,
    queued: 0,
    missing: 0,
  };

  for (const id of options.chatIds) {
    const message = await Chat5Model.findById(id).lean().exec();
    if (!message) {
      result.missing += 1;
      continue;
    }
    result.found += 1;
    const text = message.contentType === 'text' && typeof message.content?.text === 'string'
      ? message.content.text
      : '';
    const conversation = await Conversation5Model.findOne({ messages: id }, { _id: 1 }).lean().exec();
    if (!text.trim() || !conversation?._id) continue;
    result.eligible += 1;
    if (options.dryRun) continue;

    await Chat5Model.updateOne(
      { _id: id },
      { $set: { embeddingStatus: 'pending' } },
    );
    await embeddingQueueService.enqueue(text, {}, [{
      collectionName: 'chat_message',
      documentId: String(id),
      contentType: 'chat_message_text',
      parentCollection: 'conversation',
      parentId: String(conversation._id),
    }], { mode: 'default', force: true });
    result.queued += 1;
  }

  for (const id of options.inboxIds) {
    const message = await MessageInboxEntry.findById(id).lean().exec();
    if (!message) {
      result.missing += 1;
      continue;
    }
    result.found += 1;
    const text = inboxText(message);
    if (!text.trim()) continue;
    result.eligible += 1;
    if (options.dryRun) continue;

    await MessageInboxEntry.updateOne(
      { _id: id },
      {
        $set: {
          embeddingRequested: true,
          embeddingStatus: 'pending',
        },
      },
    );
    await embeddingQueueService.enqueue(text, { autoChunk: true }, [{
      collectionName: 'message_inbox',
      documentId: String(id),
      contentType: 'message',
      parentCollection: message.threadId ? 'message_thread' : null,
      parentId: message.threadId || null,
    }], { mode: 'default', force: true });
    result.queued += 1;
  }

  return result;
}

function formatResult(result, dryRun) {
  return [
    'Embedding source backfill',
    `Mode: ${dryRun ? 'dry-run' : 'execute'}`,
    `Requested: ${result.requested}`,
    `Found: ${result.found}`,
    `Eligible: ${result.eligible}`,
    `Queued: ${result.queued}`,
    `Missing: ${result.missing}`,
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }
  if (!process.env.MONGOOSE_URL) {
    throw new Error('MONGOOSE_URL is required.');
  }

  require('../database');
  await waitForMongooseConnection();
  const result = await backfillExactSources(options);
  console.log(formatResult(result, options.dryRun));
  if (options.dryRun) console.log('Run again with --execute to create the queue intents.');
}

if (require.main === module) {
  main()
    .catch((error) => {
      const message = error?.message || String(error);
      require('../utils/logger').error('Embedding source backfill failed', {
        category: 'embedding_queue_backfill',
        metadata: { message },
      });
      console.error(message);
      process.exitCode = 1;
    })
    .finally(async () => {
      if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    });
}

module.exports = {
  backfillExactSources,
  formatResult,
  parseArgs,
};
