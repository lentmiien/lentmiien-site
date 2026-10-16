const axios = require('axios');
const { ID, problem } = require('./policy');
function config() {
  return { enabled: process.env.LOCAL_AI_BATCH_ENABLED === 'true', auto: process.env.LOCAL_AI_BATCH_AUTO_DISPATCH === 'true',
    origin: process.env.AI_GATEWAY_BASE_URL || 'http://192.168.0.20:8080',
    token: process.env.BATCH_SERVER_TOKEN || '', client: process.env.BATCH_CLIENT_ID || '' };
}
class Gateway {
  constructor({ http = axios, getConfig = config } = {}) { this.http = http; this.getConfig = getConfig; }
  configured() { const c = this.getConfig(); return c.token.length >= 32 && ID.test(c.client); }
  async request(method, path, data, binary = false) {
    const c = this.getConfig();
    if (!this.configured()) throw problem('batch_auth_unconfigured', 503);
    let url;
    try { url = new URL(c.origin); } catch (_) { throw problem('invalid_gateway_origin', 503); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw problem('invalid_gateway_origin', 503);
    try {
      const response = await this.http.request({ method, url: new URL(path, url).href, data,
        headers: { Authorization: `Bearer ${c.token}`, 'X-Batch-Client': c.client },
        timeout: 15000, maxRedirects: 0, maxBodyLength: 1048576,
        maxContentLength: binary ? 33554432 : 20 * 1024 * 1024,
        responseType: binary ? 'arraybuffer' : 'json',
      });
      return binary ? response : response.data;
    } catch (error) {
      const raw = error.response?.data?.detail?.code;
      throw problem(typeof raw === 'string' && /^[a-z0-9_]{1,80}$/.test(raw) ? raw : 'gateway_unreachable', error.response?.status || 502);
    }
  }
  capabilities() { return this.request('GET', '/batch/capabilities'); }
  readiness() { return this.request('GET', '/batch/readiness'); }
  catalog() { return this.request('GET', '/llm/models'); }
  run(id) { return this.request('GET', `/batch/runs/${id}`); }
  putRun(id, body) { return this.request('PUT', `/batch/runs/${id}`, body); }
  putOperation(run, id, body) { return this.request('PUT', `/batch/runs/${run}/operations/${id}`, body); }
  start(id) { return this.request('POST', `/batch/runs/${id}/start`); }
  stop(id, mode) { return this.request('POST', `/batch/runs/${id}/stop`, { mode }); }
  ack(id, result_digest) { return this.request('POST', `/batch/operations/${id}/ack`, { result_digest }); }
  output(id) { return this.request('GET', `/batch/operations/${id}/output`, undefined, true); }
}
module.exports = { Gateway, config };
