const mockVectorEmbedding = {
  collection: { name: 'vector_embeddings' },
  countDocuments: jest.fn(),
  deleteMany: jest.fn(),
};

const mockVectorEmbeddingHighQuality = {
  collection: { name: 'vector_embeddings_high_quality' },
  countDocuments: jest.fn(),
  deleteMany: jest.fn(),
};

jest.mock('../../database', () => ({
  VectorEmbedding: mockVectorEmbedding,
  VectorEmbeddingHighQuality: mockVectorEmbeddingHighQuality,
}));

jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: () => jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const EmbeddingApiService = require('../../services/embeddingApiService');

describe('EmbeddingApiService standard embedding cleanup', () => {
  const originalFetch = global.fetch;
  const now = new Date('2026-06-11T00:00:00.000Z');
  const cutoff = new Date('2026-03-13T00:00:00.000Z');
  const expectedFilter = {
    $or: [
      { updatedAt: { $lt: cutoff } },
      {
        updatedAt: { $exists: false },
        createdAt: { $lt: cutoff },
      },
    ],
  };

  beforeAll(() => {
    if (typeof global.fetch !== 'function') {
      global.fetch = jest.fn();
    }
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('dry-runs old default embeddings without deleting', async () => {
    mockVectorEmbedding.countDocuments.mockResolvedValue(42);
    const service = new EmbeddingApiService();

    const result = await service.cleanupOldDefaultEmbeddings({
      retentionDays: 90,
      dryRun: true,
      now,
    });

    expect(mockVectorEmbedding.countDocuments).toHaveBeenCalledWith(expectedFilter);
    expect(mockVectorEmbedding.deleteMany).not.toHaveBeenCalled();
    expect(mockVectorEmbeddingHighQuality.countDocuments).not.toHaveBeenCalled();
    expect(mockVectorEmbeddingHighQuality.deleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      collectionName: 'vector_embeddings',
      retentionDays: 90,
      cutoff,
      dryRun: true,
      matchedCount: 42,
      deletedCount: 0,
    });
  });

  test('deletes old default embeddings without touching high quality embeddings', async () => {
    mockVectorEmbedding.deleteMany.mockResolvedValue({ deletedCount: 7 });
    const service = new EmbeddingApiService();

    const result = await service.cleanupOldDefaultEmbeddings({
      retentionDays: 90,
      dryRun: false,
      now,
    });

    expect(mockVectorEmbedding.countDocuments).not.toHaveBeenCalled();
    expect(mockVectorEmbedding.deleteMany).toHaveBeenCalledWith(expectedFilter);
    expect(mockVectorEmbeddingHighQuality.countDocuments).not.toHaveBeenCalled();
    expect(mockVectorEmbeddingHighQuality.deleteMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      collectionName: 'vector_embeddings',
      retentionDays: 90,
      cutoff,
      dryRun: false,
      matchedCount: 7,
      deletedCount: 7,
    });
  });
});
