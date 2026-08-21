jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const { MessageInboxService } = require('../../services/messageInboxService');

function resolvedQuery(value) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function filterQuery(value) {
  return {
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(value),
    }),
  };
}

function createModels({ existing = null, filter = null } = {}) {
  class MessageModel {
    constructor(payload) {
      Object.assign(this, payload, { _id: payload._id || 'inbox-1' });
      this.save = jest.fn().mockResolvedValue(this);
    }
  }
  MessageModel.findOne = jest.fn().mockReturnValue(resolvedQuery(existing));
  MessageModel.findById = jest.fn().mockReturnValue(resolvedQuery(existing));
  MessageModel.deleteOne = jest.fn().mockReturnValue(resolvedQuery({ deletedCount: 1 }));
  const FilterModel = {
    findOne: jest.fn().mockReturnValue(filterQuery(filter)),
  };
  return { MessageModel, FilterModel };
}

function createQueue() {
  return {
    enqueue: jest.fn().mockResolvedValue({ status: 'pending' }),
    enqueueDelete: jest.fn().mockResolvedValue({ status: 'pending' }),
  };
}

describe('MessageInboxService embedding queue integration', () => {
  test('returns after a durable queue write and keeps actual embedding state false until completion', async () => {
    const { MessageModel, FilterModel } = createModels({
      filter: {
        _id: 'filter-1',
        retentionDays: 90,
        generateEmbedding: true,
        generateHighQualityEmbedding: false,
        labelRules: [],
      },
    });
    const directEmbeddingApi = {
      embed: jest.fn(),
      embedHighQuality: jest.fn(),
      deleteEmbeddings: jest.fn(),
    };
    const queue = createQueue();
    const service = new MessageInboxService(
      MessageModel,
      FilterModel,
      directEmbeddingApi,
      queue,
    );

    const result = await service.saveIncomingMessage({
      id: 'provider-id-1',
      from: 'person@example.com',
      text: 'Store this message',
      date: '2026-08-20T00:00:00.000Z',
    });

    expect(result.status).toBe('saved');
    expect(result.message).toMatchObject({
      embeddingRequested: true,
      hasEmbedding: false,
      embeddingStatus: 'pending',
      highQualityEmbeddingRequested: false,
      hasHighQualityEmbedding: false,
      highQualityEmbeddingStatus: 'disabled',
    });
    expect(queue.enqueue).toHaveBeenCalledWith(
      'Store this message',
      { autoChunk: true },
      [{
        collectionName: 'message_inbox',
        documentId: 'inbox-1',
        contentType: 'message',
        parentCollection: null,
        parentId: null,
      }],
      { mode: 'default', force: false },
    );
    expect(directEmbeddingApi.embed).not.toHaveBeenCalled();
  });

  test('repairs a legacy duplicate whose filter still requests an embedding', async () => {
    const existing = {
      _id: 'inbox-legacy',
      messageId: 'provider-id-2',
      from: 'person@example.com',
      labels: [],
      text: 'Legacy message',
      threadId: null,
      hasEmbedding: false,
      hasHighQualityEmbedding: false,
      save: jest.fn().mockResolvedValue(),
    };
    const { MessageModel, FilterModel } = createModels({
      existing,
      filter: {
        _id: 'filter-1',
        retentionDays: 90,
        generateEmbedding: true,
        generateHighQualityEmbedding: false,
        labelRules: [],
      },
    });
    const queue = createQueue();
    const service = new MessageInboxService(MessageModel, FilterModel, {}, queue);

    const result = await service.saveIncomingMessage({ id: 'provider-id-2' });

    expect(result).toMatchObject({ status: 'ignored', reason: 'duplicate' });
    expect(existing).toMatchObject({
      embeddingRequested: true,
      embeddingStatus: 'pending',
      highQualityEmbeddingRequested: false,
    });
    expect(existing.save).toHaveBeenCalledTimes(1);
    expect(queue.enqueue).toHaveBeenCalledTimes(1);
  });

  test('disabling an embedding records a durable delete intent', async () => {
    const existing = {
      _id: 'inbox-3',
      threadId: 'thread-3',
      text: 'Existing message',
      hasEmbedding: true,
      hasHighQualityEmbedding: false,
      embeddingRequested: true,
      highQualityEmbeddingRequested: false,
      embeddingStatus: 'completed',
      highQualityEmbeddingStatus: 'disabled',
      save: jest.fn().mockResolvedValue(),
    };
    const { MessageModel, FilterModel } = createModels({ existing });
    const queue = createQueue();
    const service = new MessageInboxService(MessageModel, FilterModel, {}, queue);

    await service.updateMessageSettings('inbox-3', {
      hasEmbedding: false,
      hasHighQualityEmbedding: false,
    });

    expect(existing).toMatchObject({
      embeddingRequested: false,
      hasEmbedding: true,
      embeddingStatus: 'delete_pending',
    });
    expect(queue.enqueueDelete).toHaveBeenCalledWith(
      {
        collectionName: 'message_inbox',
        documentId: 'inbox-3',
        contentType: 'message',
        parentCollection: 'message_thread',
        parentId: 'thread-3',
      },
      { mode: 'default', force: true, verifySourceState: true },
    );
  });
});
