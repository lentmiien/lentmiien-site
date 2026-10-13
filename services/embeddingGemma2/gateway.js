const axios = require('axios');
const { response, fail } = require('./contract');
function gateway(config, client = axios) {
  return async (source, bytes, search) => {
    const role = search ? 'query' : 'document';
    const media = source.kind !== 'text';
    const body = media ? bytes : { dimensions: 768, items: [{ text: source.text, role, ...(source.title ? { title: source.title } : {}) }] };
    if (!media && Buffer.byteLength(JSON.stringify(body)) > 65536) fail('Encoded text exceeds 64 KiB.', 413);
    try {
      const result = await client.post(`${config.base}/embed/embeddinggemma2${media ? `/media?kind=${source.kind}&dimensions=768` : ''}`, body, {
        headers: { 'Content-Type': media ? 'application/octet-stream' : 'application/json' },
        timeout: config.timeout, signal: AbortSignal.timeout(config.timeout), maxRedirects: 0,
        maxBodyLength: 8388608, maxContentLength: 131072, proxy: false,
      });
      return response(result.data, source, role);
    } catch (error) {
      if (error.status && !error.isAxiosError) throw error;
      const status = error.response?.status;
      if ([408, 413, 422, 429].includes(status)) fail(`Gateway rejected the input or admission (HTTP ${status}). Check input limits; do not automatically retry.`, status);
      fail('Gateway unavailable or timed out. The job may still be reclaiming; check Gateway monitoring before retrying.', 502);
    }
  };
}
module.exports = { gateway };
