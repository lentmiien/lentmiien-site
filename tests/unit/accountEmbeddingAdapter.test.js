jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../utils/logger', () => ({ notice: jest.fn(), warning: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/apiDebugLogger', () => ({ createApiDebugLogger: () => jest.fn() }));
jest.mock('../../database', () => ({ VectorEmbedding: { find: jest.fn() }, VectorEmbeddingHighQuality: { find: jest.fn() } }));
const axios = require('axios');
const { VectorEmbedding, VectorEmbeddingHighQuality } = require('../../database');
const { createAccountEmbeddingAdapter } = require('../../services/accountEmbeddingAdapter');
let chains;
beforeEach(() => {
  chains = [];
  for (const model of [VectorEmbedding, VectorEmbeddingHighQuality]) model.find.mockImplementation(() => {
    const chain = { sort: jest.fn(() => chain), limit: jest.fn(() => chain), maxTimeMS: jest.fn(() => chain), lean: jest.fn(() => chain), exec: jest.fn(async () => [{ _id: 'fixture', embedding: [1, 0], source: { collectionName: 'fixture', documentId: 'one' }, previewText: 'synthetic', updatedAt: new Date() }]) };
    chains.push(chain); return chain;
  });
  axios.post.mockResolvedValue({ data: { vectors: [[1, 0]], dim: 2 } });
});
test.each(['similaritySearch', 'similaritySearchHighQuality', 'combinedSimilaritySearch'])('%s preserves ranking with bounded reads and transport', async method => {
  const result = await createAccountEmbeddingAdapter()[method]('synthetic', { topK: 5 });
  expect(result.results).toHaveLength(1);
  expect(result.results[0].similarity).toBe(1);
  for (const chain of chains) {
    expect(chain.limit).toHaveBeenCalledWith(500); expect(chain.maxTimeMS).toHaveBeenCalledWith(2000);
  }
  for (const [, body, options] of axios.post.mock.calls) {
    expect(body.texts.length).toBeLessThanOrEqual(50);
    expect(options).toMatchObject({ timeout: 5000, maxRedirects: 0, maxBodyLength: 120000 });
  }
  if (method === 'similaritySearchHighQuality') expect(axios.post.mock.calls[0][0]).toContain('/embed/nomic');
  if (method === 'combinedSimilaritySearch') expect(axios.post).toHaveBeenCalledTimes(3);
});
test('rejects oversized provider vectors before local candidate scans', async () => {
  axios.post.mockResolvedValue({ data: { vectors: [Array(8193).fill(1)] } });
  await expect(createAccountEmbeddingAdapter().similaritySearch('synthetic')).rejects.toThrow();
  expect(VectorEmbedding.find).not.toHaveBeenCalled();
});
