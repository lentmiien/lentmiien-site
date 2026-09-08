// Instantiated only for an authorized, explicit search. Reuse the existing search
// algorithms with bounded local reads and a transport that never logs query text.
const axios = require('axios');
function createAccountEmbeddingAdapter() {
  const EmbeddingApiService = require('./embeddingApiService');
  const service = new EmbeddingApiService();
  const originalModel = service.getModelForMode.bind(service);
  const targets = new WeakMap();
  service.getModelForMode = mode => {
    const model = originalModel(mode);
    const wrapper = new Proxy(model, { get(target, key) {
      if (key !== 'find') return Reflect.get(target, key);
      return (filter, projection) => ({ lean: async () => {
        const rows = await target.find(filter, projection).sort({ updatedAt: -1, _id: -1 }).limit(500).maxTimeMS(2000).lean().exec();
        return rows.map(row => ({ ...row, previewText: String(row.previewText || '').slice(0, 2000) }));
      } });
    } });
    targets.set(wrapper, model); return wrapper;
  };
  const buildUrl = service.buildEmbedRequestUrl.bind(service);
  service.embedWithApi = async (texts, options, _metadata, { apiBase, model, task } = {}) => {
    if (!Array.isArray(texts) || texts.length > 50 || texts.some(t => typeof t !== 'string' || t.length > 2000)) throw new Error('Search request limit');
    const url = new URL(buildUrl(apiBase, targets.get(model) || model));
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid search provider');
    const response = await axios.post(url.href, { texts, auto_chunk: false, ...(task ? { task } : {}) }, {
      timeout: 5000, maxRedirects: 0, maxBodyLength: 120000, maxContentLength: 4 * 1024 * 1024,
    });
    const vectors = response.data?.vectors;
    if (!Array.isArray(vectors) || vectors.length > 50 || vectors.some(v => !Array.isArray(v) || v.length > 8192 || !v.every(Number.isFinite))) throw new Error('Invalid search vectors');
    return response.data;
  };
  return service;
}
module.exports = { createAccountEmbeddingAdapter };
