const mongoose = require('mongoose');

const {
  cleanupChat5Databases,
  buildConversationCleanupQuery,
} = require('../../services/chat5CleanupService');

function asyncCursor(items) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) {
        yield item;
      }
    },
  };
}

function createFindChain(items) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnValue(asyncCursor(items)),
  };
}

function createMessageFindChain(items) {
  return {
    select: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(items),
  };
}

function objectId(hex) {
  return new mongoose.Types.ObjectId(hex);
}

function createCleanupModels({ conversations = [], hiddenMessageIds = [], orphanMessageIds = [] } = {}) {
  const conversationFindChain = createFindChain(conversations);
  const hiddenDocs = hiddenMessageIds.map((id) => ({ _id: objectId(id) }));
  const chatFindChain = createMessageFindChain(hiddenDocs);
  const conversationModel = {
    collection: {
      collectionName: 'conversation5',
      deleteMany: jest
        .fn()
        .mockResolvedValueOnce({ deletedCount: 0 })
        .mockResolvedValueOnce({ deletedCount: 0 }),
      bulkWrite: jest.fn().mockImplementation((operations) => Promise.resolve({
        matchedCount: operations.length,
        modifiedCount: operations.length,
      })),
    },
    find: jest.fn().mockReturnValue(conversationFindChain),
  };
  const chatModel = {
    collection: {
      aggregate: jest.fn().mockReturnValue(asyncCursor(orphanMessageIds.map((id) => ({ _id: objectId(id) })))),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: orphanMessageIds.length }),
    },
    find: jest.fn().mockReturnValue(chatFindChain),
  };

  return {
    conversationModel,
    chatModel,
    conversationFindChain,
    chatFindChain,
  };
}

describe('chat5CleanupService', () => {
  test('buildConversationCleanupQuery targets stale missing and stale changed cleanup dates', () => {
    const cutoff = new Date('2026-05-30T00:00:00.000Z');
    const query = buildConversationCleanupQuery(cutoff);

    expect(query.$or).toHaveLength(2);
    expect(query.$or[0].$and).toContainEqual({ createdAt: { $lt: cutoff } });
    expect(query.$or[1].$and).toContainEqual({ lastCleanupAt: { $type: 'date', $lt: cutoff } });
    expect(query.$or[1].$and).toContainEqual({ $expr: { $gt: ['$updatedAt', '$lastCleanupAt'] } });
  });

  test('uses narrow filters for destructive conversation deletes', async () => {
    const checkedAt = new Date('2026-06-29T12:00:00.000Z');
    const { conversationModel, chatModel } = createCleanupModels();

    await cleanupChat5Databases({
      conversationModel,
      chatModel,
      now: checkedAt,
    });

    expect(conversationModel.collection.deleteMany).toHaveBeenCalledTimes(2);
    expect(conversationModel.collection.deleteMany).toHaveBeenNthCalledWith(1, { category: 'Test' });
    expect(conversationModel.collection.deleteMany).toHaveBeenNthCalledWith(2, {
      category: 'Chat5',
      updatedAt: { $lt: new Date('2025-06-29T12:00:00.000Z') },
    });
  });

  test('only checks conversations selected by the cleanup eligibility query', async () => {
    const checkedAt = new Date('2026-06-29T12:00:00.000Z');
    const { conversationModel, chatModel } = createCleanupModels();

    const result = await cleanupChat5Databases({
      conversationModel,
      chatModel,
      now: checkedAt,
    });

    expect(conversationModel.find).toHaveBeenCalledWith(buildConversationCleanupQuery(new Date('2026-05-30T12:00:00.000Z')));
    expect(conversationModel.collection.bulkWrite).not.toHaveBeenCalled();
    expect(chatModel.find).not.toHaveBeenCalled();
    expect(result.conversationsChecked).toBe(0);
    expect(result.hiddenMessageReferencesRemoved).toBe(0);
  });

  test('removes only hideFromBot message references and keeps visible references', async () => {
    const checkedAt = new Date('2026-06-29T12:00:00.000Z');
    const hiddenId = '507f1f77bcf86cd799439011';
    const visibleId = '507f1f77bcf86cd799439012';
    const invalidLegacyId = 'legacy-message-id';
    const conversation = {
      _id: objectId('507f1f77bcf86cd799439015'),
      messages: [hiddenId, visibleId, hiddenId],
      updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    };
    const secondConversation = {
      _id: objectId('507f1f77bcf86cd799439016'),
      messages: [visibleId, invalidLegacyId],
      updatedAt: new Date('2026-06-02T00:00:00.000Z'),
    };
    const { conversationModel, chatModel } = createCleanupModels({
      conversations: [conversation, secondConversation],
      hiddenMessageIds: [hiddenId],
    });

    const result = await cleanupChat5Databases({
      conversationModel,
      chatModel,
      now: checkedAt,
      conversationBatchSize: 10,
      messageDeleteBatchSize: 10,
    });

    expect(result).toMatchObject({
      deletedTestConversations: 0,
      deletedOldChat5Conversations: 0,
      conversationsChecked: 2,
      hiddenMessageReferencesRemoved: 2,
      conversationsWithHiddenReferences: 1,
      unreferencedMessagesDeleted: 0,
    });
    expect(chatModel.find).toHaveBeenCalledWith({
      _id: { $in: [objectId(hiddenId), objectId(visibleId)] },
      hideFromBot: true,
    });
    expect(conversationModel.collection.bulkWrite).toHaveBeenCalledTimes(1);
    const operations = conversationModel.collection.bulkWrite.mock.calls[0][0];
    expect(operations).toHaveLength(2);
    expect(operations[0].updateOne.filter).toEqual({
      _id: conversation._id,
      updatedAt: conversation.updatedAt,
    });
    expect(operations[0].updateOne.update.$set).toEqual({ lastCleanupAt: checkedAt });
    expect(operations[0].updateOne.update.$pull.messages.$in).toEqual(expect.arrayContaining([hiddenId]));
    expect(operations[0].updateOne.update.$pull.messages.$in).not.toContain(visibleId);
    expect(operations[0].updateOne.update.$set.updatedAt).toBeUndefined();
    expect(operations[0].updateOne.update.updatedAt).toBeUndefined();
    expect(operations[1].updateOne.filter).toEqual({
      _id: secondConversation._id,
      updatedAt: secondConversation.updatedAt,
    });
    expect(operations[1].updateOne.update).toEqual({
      $set: { lastCleanupAt: checkedAt },
    });
  });

  test('does not mutate updatedAt when marking checked conversations', async () => {
    const checkedAt = new Date('2026-06-29T12:00:00.000Z');
    const conversation = {
      _id: objectId('507f1f77bcf86cd799439017'),
      messages: [],
      updatedAt: new Date('2026-05-31T00:00:00.000Z'),
    };
    const { conversationModel, chatModel } = createCleanupModels({
      conversations: [conversation],
    });

    await cleanupChat5Databases({
      conversationModel,
      chatModel,
      now: checkedAt,
    });

    const operation = conversationModel.collection.bulkWrite.mock.calls[0][0][0].updateOne;
    expect(operation.filter).toEqual({
      _id: conversation._id,
      updatedAt: conversation.updatedAt,
    });
    expect(operation.update).toEqual({
      $set: { lastCleanupAt: checkedAt },
    });
    expect(operation.update.updatedAt).toBeUndefined();
    expect(operation.update.$set.updatedAt).toBeUndefined();
  });

  test('deletes only chat5 messages yielded by the orphan lookup', async () => {
    const checkedAt = new Date('2026-06-29T12:00:00.000Z');
    const orphanOne = '507f1f77bcf86cd799439013';
    const orphanTwo = '507f1f77bcf86cd799439014';
    const { conversationModel, chatModel } = createCleanupModels({
      orphanMessageIds: [orphanOne, orphanTwo],
    });

    const result = await cleanupChat5Databases({
      conversationModel,
      chatModel,
      now: checkedAt,
      messageDeleteBatchSize: 10,
    });

    expect(result.unreferencedMessagesDeleted).toBe(2);
    expect(chatModel.collection.aggregate).toHaveBeenCalledWith([
      { $addFields: { __cleanupMessageId: { $toString: '$_id' } } },
      {
        $lookup: {
          from: 'conversation5',
          localField: '__cleanupMessageId',
          foreignField: 'messages',
          as: '__cleanupRefs',
        },
      },
      { $match: { __cleanupRefs: { $size: 0 } } },
      { $project: { _id: 1 } },
    ], { allowDiskUse: true });
    const deleteFilter = chatModel.collection.deleteMany.mock.calls[0][0];
    expect(deleteFilter._id.$in.map((id) => id.toString())).toEqual([orphanOne, orphanTwo]);
  });

  test('does not issue a chat5 delete when no orphan messages are found', async () => {
    const { conversationModel, chatModel } = createCleanupModels();

    const result = await cleanupChat5Databases({
      conversationModel,
      chatModel,
      now: new Date('2026-06-29T12:00:00.000Z'),
    });

    expect(result.unreferencedMessagesDeleted).toBe(0);
    expect(chatModel.collection.deleteMany).not.toHaveBeenCalled();
  });
});
