const mockVectorEmbedding = {
  insertMany: jest.fn(),
  deleteMany: jest.fn(),
  findOne: jest.fn(),
};
const mockVectorEmbeddingHighQuality = {
  insertMany: jest.fn(),
  deleteMany: jest.fn(),
  findOne: jest.fn(),
};

jest.mock('../../database', () => ({
  VectorEmbedding: mockVectorEmbedding,
  VectorEmbeddingHighQuality: mockVectorEmbeddingHighQuality,
}));
jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: () => jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const EmbeddingApiService = require('../../services/embeddingApiService');

const metadata = [{
  collectionName: 'chat_message',
  documentId: 'message-1',
  contentType: 'chat_message_text',
  parentCollection: 'conversation',
  parentId: 'conversation-1',
}];
const response = {
  vectors: [[0.1, 0.2]],
  chunks: [{ text_index: 0, chunk_index: 0, text: 'Current text' }],
  dim: 2,
  model: 'mpnet',
};

describe('EmbeddingApiService vector replacement', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockVectorEmbedding.insertMany.mockResolvedValue([]);
    mockVectorEmbedding.deleteMany.mockResolvedValue({ deletedCount: 1 });
    mockVectorEmbedding.findOne.mockImplementation(async () => {
      const inserted = mockVectorEmbedding.insertMany.mock.calls.at(-1)?.[0] || [];
      return inserted[0]
        ? { generationId: inserted[0].generationId, createdAt: inserted[0].createdAt }
        : null;
    });
  });

  test('inserts a complete version before removing the previous vectors', async () => {
    const service = new EmbeddingApiService();

    await service.persistEmbeddings(['Current text'], metadata, response, mockVectorEmbedding);

    expect(mockVectorEmbedding.insertMany).toHaveBeenCalledTimes(1);
    const inserted = mockVectorEmbedding.insertMany.mock.calls[0][0];
    expect(inserted).toHaveLength(1);
    expect(inserted[0].generationId).toEqual(expect.any(String));
    expect(mockVectorEmbedding.deleteMany).toHaveBeenCalledWith({
      'source.collectionName': 'chat_message',
      'source.documentId': 'message-1',
      'source.contentType': 'chat_message_text',
      'source.parentCollection': 'conversation',
      'source.parentId': 'conversation-1',
      generationId: { $ne: inserted[0].generationId },
      $or: [
        { createdAt: { $lt: inserted[0].createdAt } },
        {
          createdAt: inserted[0].createdAt,
          generationId: { $lt: inserted[0].generationId },
        },
        { createdAt: { $exists: false } },
      ],
    });
    expect(mockVectorEmbedding.insertMany.mock.invocationCallOrder[0])
      .toBeLessThan(mockVectorEmbedding.deleteMany.mock.invocationCallOrder[0]);
  });

  test('keeps the previous generation when insertion fails', async () => {
    mockVectorEmbedding.insertMany.mockRejectedValue(new Error('insert failed'));
    const service = new EmbeddingApiService();

    await expect(service.persistEmbeddings(
      ['Current text'],
      metadata,
      response,
      mockVectorEmbedding,
    )).rejects.toThrow('insert failed');

    expect(mockVectorEmbedding.deleteMany).toHaveBeenCalledTimes(1);
    const cleanupFilter = mockVectorEmbedding.deleteMany.mock.calls[0][0];
    expect(cleanupFilter.generationId).toEqual(expect.any(String));
    expect(cleanupFilter.generationId).not.toEqual(expect.objectContaining({ $ne: expect.anything() }));
  });

  test('keeps one complete winner when two generations persist concurrently', async () => {
    const documents = [{
      ...metadata[0],
      generationId: 'legacy',
      createdAt: new Date(0),
    }];
    let insertCount = 0;
    let releaseInserts;
    const bothInserted = new Promise((resolve) => {
      releaseInserts = resolve;
    });
    const model = {
      insertMany: jest.fn(async (docs) => {
        documents.push(...docs.map((doc) => ({ ...doc })));
        insertCount += 1;
        if (insertCount === 2) releaseInserts();
        await bothInserted;
        return docs;
      }),
      findOne: jest.fn(async () => [...documents].sort((left, right) => {
        const timeDifference = new Date(right.createdAt).getTime()
          - new Date(left.createdAt).getTime();
        if (timeDifference) return timeDifference;
        return String(right.generationId).localeCompare(String(left.generationId));
      })[0]),
      deleteMany: jest.fn(async (filter) => {
        const before = documents.length;
        for (let index = documents.length - 1; index >= 0; index -= 1) {
          const document = documents[index];
          let remove = false;
          if (typeof filter.generationId === 'string') {
            remove = document.generationId === filter.generationId;
          } else if (filter.generationId?.$ne !== undefined) {
            const winnerId = filter.generationId.$ne;
            const cutoff = filter.$or[0].createdAt.$lt;
            const documentTime = new Date(document.createdAt).getTime();
            const cutoffTime = new Date(cutoff).getTime();
            remove = document.generationId !== winnerId && (
              documentTime < cutoffTime
              || (documentTime === cutoffTime
                && String(document.generationId).localeCompare(String(winnerId)) < 0)
            );
          }
          if (remove) documents.splice(index, 1);
        }
        return { deletedCount: before - documents.length };
      }),
    };
    const service = new EmbeddingApiService();

    await Promise.all([
      service.persistEmbeddings(['First text'], metadata, response, model),
      service.persistEmbeddings(['Second text'], metadata, response, model),
    ]);

    expect(documents).toHaveLength(1);
    expect(documents[0].generationId).not.toBe('legacy');
    expect(documents[0].embedding).toEqual([0.1, 0.2]);
  });
});
