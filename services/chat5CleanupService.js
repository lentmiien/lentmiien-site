const mongoose = require('mongoose');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CONVERSATION_BATCH_SIZE = 100;
const DEFAULT_MESSAGE_LOOKUP_BATCH_SIZE = 2000;
const DEFAULT_MESSAGE_DELETE_BATCH_SIZE = 500;
const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

function getDefaultModels() {
  const { Conversation5Model, Chat5Model } = require('../database');
  return { conversationModel: Conversation5Model, chatModel: Chat5Model };
}

function deletedCountFromResult(result) {
  return Number(result?.deletedCount || result?.n || 0);
}

function matchedCountFromResult(result) {
  return Number(result?.matchedCount || result?.nMatched || 0);
}

function modifiedCountFromResult(result) {
  return Number(result?.modifiedCount || result?.nModified || 0);
}

function subtractDays(date, days) {
  return new Date(date.getTime() - days * DAY_MS);
}

function normalizeMessageId(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value.toString === 'function') return value.toString();
  return '';
}

function isObjectIdString(value) {
  return typeof value === 'string' && OBJECT_ID_PATTERN.test(value);
}

function objectIdFromString(value) {
  return new mongoose.Types.ObjectId(value);
}

function buildConversationCleanupQuery(cleanupAgeCutoff) {
  return {
    $or: [
      {
        $and: [
          {
            $or: [
              { lastCleanupAt: { $exists: false } },
              { lastCleanupAt: null },
            ],
          },
          { createdAt: { $lt: cleanupAgeCutoff } },
        ],
      },
      {
        $and: [
          { lastCleanupAt: { $type: 'date', $lt: cleanupAgeCutoff } },
          { $expr: { $gt: ['$updatedAt', '$lastCleanupAt'] } },
        ],
      },
    ],
  };
}

function buildUpdateFilter(conversation) {
  const filter = { _id: conversation._id };
  if (conversation.updatedAt instanceof Date) {
    filter.updatedAt = conversation.updatedAt;
  } else {
    filter.$or = [
      { updatedAt: { $exists: false } },
      { updatedAt: null },
    ];
  }
  return filter;
}

function buildPullValues(hiddenIds) {
  const values = [];
  hiddenIds.forEach((id) => {
    values.push(id);
    if (isObjectIdString(id)) {
      values.push(objectIdFromString(id));
    }
  });
  return values;
}

function collectConversationMessageIds(conversation) {
  if (!Array.isArray(conversation.messages)) return [];
  return conversation.messages
    .map(normalizeMessageId)
    .filter((id) => id.length > 0);
}

async function findHiddenMessageIds(chatModel, messageIds) {
  const uniqueIds = Array.from(new Set(messageIds.filter(isObjectIdString)));
  if (uniqueIds.length === 0) return new Set();

  const docs = [];
  for (let i = 0; i < uniqueIds.length; i += DEFAULT_MESSAGE_LOOKUP_BATCH_SIZE) {
    const chunk = uniqueIds.slice(i, i + DEFAULT_MESSAGE_LOOKUP_BATCH_SIZE);
    const chunkDocs = await chatModel
      .find({
        _id: { $in: chunk.map(objectIdFromString) },
        hideFromBot: true,
      })
      .select('_id')
      .lean()
      .exec();
    docs.push(...(chunkDocs || []));
  }

  return new Set(docs.map((doc) => normalizeMessageId(doc._id)).filter(Boolean));
}

async function processConversationBatch({ conversationModel, chatModel, conversations, checkedAt }) {
  if (conversations.length === 0) {
    return {
      checked: 0,
      matched: 0,
      modified: 0,
      skipped: 0,
      withHiddenReferences: 0,
      hiddenReferencesRemoved: 0,
    };
  }

  const messageIds = conversations.flatMap(collectConversationMessageIds);
  const hiddenIds = await findHiddenMessageIds(chatModel, messageIds);
  const operations = conversations.map((conversation) => {
    const conversationMessageIds = collectConversationMessageIds(conversation);
    const hiddenInConversation = conversationMessageIds.filter((id) => hiddenIds.has(id));
    const update = {
      $set: { lastCleanupAt: checkedAt },
    };

    if (hiddenInConversation.length > 0) {
      update.$pull = {
        messages: { $in: buildPullValues(new Set(hiddenInConversation)) },
      };
    }

    return {
      operation: {
        updateOne: {
          filter: buildUpdateFilter(conversation),
          update,
        },
      },
      hiddenReferenceCount: hiddenInConversation.length,
    };
  });

  const result = await conversationModel.collection.bulkWrite(
    operations.map((entry) => entry.operation),
    { ordered: false },
  );

  const hiddenReferencesRemoved = operations.reduce((sum, entry) => sum + entry.hiddenReferenceCount, 0);
  const withHiddenReferences = operations.filter((entry) => entry.hiddenReferenceCount > 0).length;
  const matched = matchedCountFromResult(result);

  return {
    checked: conversations.length,
    matched,
    modified: modifiedCountFromResult(result),
    skipped: Math.max(0, conversations.length - matched),
    withHiddenReferences,
    hiddenReferencesRemoved,
  };
}

async function cleanupConversationReferences({ conversationModel, chatModel, checkedAt, cleanupAgeCutoff, batchSize }) {
  const totals = {
    conversationsChecked: 0,
    conversationUpdatesMatched: 0,
    conversationUpdatesModified: 0,
    conversationUpdatesSkipped: 0,
    conversationsWithHiddenReferences: 0,
    hiddenMessageReferencesRemoved: 0,
  };

  const cursor = conversationModel
    .find(buildConversationCleanupQuery(cleanupAgeCutoff))
    .select('_id messages updatedAt')
    .lean()
    .cursor();

  let batch = [];
  for await (const conversation of cursor) {
    batch.push(conversation);
    if (batch.length >= batchSize) {
      const result = await processConversationBatch({ conversationModel, chatModel, conversations: batch, checkedAt });
      totals.conversationsChecked += result.checked;
      totals.conversationUpdatesMatched += result.matched;
      totals.conversationUpdatesModified += result.modified;
      totals.conversationUpdatesSkipped += result.skipped;
      totals.conversationsWithHiddenReferences += result.withHiddenReferences;
      totals.hiddenMessageReferencesRemoved += result.hiddenReferencesRemoved;
      batch = [];
    }
  }

  if (batch.length > 0) {
    const result = await processConversationBatch({ conversationModel, chatModel, conversations: batch, checkedAt });
    totals.conversationsChecked += result.checked;
    totals.conversationUpdatesMatched += result.matched;
    totals.conversationUpdatesModified += result.modified;
    totals.conversationUpdatesSkipped += result.skipped;
    totals.conversationsWithHiddenReferences += result.withHiddenReferences;
    totals.hiddenMessageReferencesRemoved += result.hiddenReferencesRemoved;
  }

  return totals;
}

async function deleteUnreferencedMessages({ conversationModel, chatModel, batchSize }) {
  const conversationCollectionName = conversationModel.collection.collectionName;
  const cursor = chatModel.collection.aggregate([
    { $addFields: { __cleanupMessageId: { $toString: '$_id' } } },
    {
      $lookup: {
        from: conversationCollectionName,
        localField: '__cleanupMessageId',
        foreignField: 'messages',
        as: '__cleanupRefs',
      },
    },
    { $match: { __cleanupRefs: { $size: 0 } } },
    { $project: { _id: 1 } },
  ], { allowDiskUse: true });

  let deleted = 0;
  let batch = [];
  for await (const message of cursor) {
    batch.push(message._id);
    if (batch.length >= batchSize) {
      const result = await chatModel.collection.deleteMany({ _id: { $in: batch } });
      deleted += deletedCountFromResult(result);
      batch = [];
    }
  }

  if (batch.length > 0) {
    const result = await chatModel.collection.deleteMany({ _id: { $in: batch } });
    deleted += deletedCountFromResult(result);
  }

  return deleted;
}

async function cleanupChat5Databases(options = {}) {
  const defaults = (!options.conversationModel || !options.chatModel) ? getDefaultModels() : {};
  const conversationModel = options.conversationModel || defaults.conversationModel;
  const chatModel = options.chatModel || defaults.chatModel;
  const checkedAt = options.now instanceof Date ? options.now : new Date();
  const cleanupAgeCutoff = subtractDays(checkedAt, 30);
  const staleConversationCutoff = subtractDays(checkedAt, 365);
  const conversationBatchSize = Number.isInteger(options.conversationBatchSize) && options.conversationBatchSize > 0
    ? options.conversationBatchSize
    : DEFAULT_CONVERSATION_BATCH_SIZE;
  const messageDeleteBatchSize = Number.isInteger(options.messageDeleteBatchSize) && options.messageDeleteBatchSize > 0
    ? options.messageDeleteBatchSize
    : DEFAULT_MESSAGE_DELETE_BATCH_SIZE;

  const startedAt = new Date();
  const deletedTestConversations = await conversationModel.collection.deleteMany({ category: 'Test' });
  const deletedOldChat5Conversations = await conversationModel.collection.deleteMany({
    category: 'Chat5',
    updatedAt: { $lt: staleConversationCutoff },
  });

  const referenceCleanup = await cleanupConversationReferences({
    conversationModel,
    chatModel,
    checkedAt,
    cleanupAgeCutoff,
    batchSize: conversationBatchSize,
  });
  const unreferencedMessagesDeleted = await deleteUnreferencedMessages({
    conversationModel,
    chatModel,
    batchSize: messageDeleteBatchSize,
  });
  const completedAt = new Date();

  return {
    startedAt,
    completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
    checkedAt,
    cleanupAgeCutoff,
    staleConversationCutoff,
    deletedTestConversations: deletedCountFromResult(deletedTestConversations),
    deletedOldChat5Conversations: deletedCountFromResult(deletedOldChat5Conversations),
    unreferencedMessagesDeleted,
    ...referenceCleanup,
  };
}

module.exports = {
  cleanupChat5Databases,
  buildConversationCleanupQuery,
};
