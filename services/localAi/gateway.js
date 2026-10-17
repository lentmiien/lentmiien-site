const axios = require('axios');
const { randomUUID } = require('crypto');
const { performance } = require('perf_hooks');
const { ID, problem } = require('./policy');
const { clockEvidence } = require('./clock');
function config() {
  return { media: process.env.LOCAL_AI_BATCH_MEDIA_ENABLED === 'true', enabled: process.env.LOCAL_AI_BATCH_ENABLED === 'true', auto: process.env.LOCAL_AI_BATCH_AUTO_DISPATCH === 'true',
    origin: process.env.AI_GATEWAY_BASE_URL || 'http://192.168.0.20:8080',
    token: process.env.BATCH_SERVER_TOKEN || '', client: process.env.BATCH_CLIENT_ID || '' };
}
class Gateway {
  constructor({ http = axios, getConfig = config, now = Date.now, monotonic = () => performance.now() } = {}) {
    this.http = http; this.getConfig = getConfig; this.now = now; this.monotonic = monotonic;
  }
  configured() { const c = this.getConfig(); return c.token.length >= 32 && ID.test(c.client); }
  async request(method, path, data, binary = false, clock = false, multipart = false) {
    const c = this.getConfig();
    if (!this.configured()) throw problem('batch_auth_unconfigured', 503);
    let url;
    try { url = new URL(c.origin); } catch (_) { throw problem('invalid_gateway_origin', 503); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw problem('invalid_gateway_origin', 503);
    const sent = this.now(), started = this.monotonic();
    let response;
    try {
      response = await this.http.request({ method, url: new URL(path, url).href, data,
        headers: { Authorization: `Bearer ${c.token}`, 'X-Batch-Client': c.client,
          ...(multipart ? data.getHeaders() : {}),
          ...(clock ? { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } : {}) },
        timeout: multipart || binary ? 65000 : 15000, maxRedirects: 0, maxBodyLength: multipart ? 33554432 + 65536 : 1048576,
        maxContentLength: binary ? 33554432 : 20 * 1024 * 1024,
        responseType: binary ? 'arraybuffer' : 'json',
      });
    } catch (error) {
      const raw = error.response?.data?.detail?.code;
      throw Object.assign(problem(typeof raw === 'string' && /^[a-z0-9_]{1,80}$/.test(raw) ? raw : 'gateway_unreachable', error.response?.status || 502),
        { httpStatus: error.response?.status, gatewayResponse: !!error.response });
    }
    if (clock) {
      const ended = this.monotonic();
      try {
        return { capabilities: response.data, clock: clockEvidence(response.headers, sent, this.now(), ended - started, ended) };
      } catch (error) { error.httpStatus = response.status; throw error; }
    }
    return binary ? response : response.data;
  }
  admissionClock() { return this.request('GET', `/batch/capabilities?clock_probe=${randomUUID()}`, undefined, false, true); }
  capabilities() { return this.request('GET', '/batch/capabilities'); }
  capacity() { return this.request('GET', '/batch/capacity'); }
  input(id) { return this.request('GET', `/batch/inputs/${this.inputId(id)}`); }
  inputContent(id) { return this.request('GET', `/batch/inputs/${this.inputId(id)}/content`, undefined, true); }
  importInput(id, body) { return this.request('PUT', `/batch/inputs/${this.inputId(id)}/import`, body); }
  putInput(id, bytes) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('manifest', JSON.stringify({ schema_version: 2 }));
    form.append('file', bytes, { filename: 'input', contentType: 'application/octet-stream' });
    return this.request('PUT', `/batch/inputs/${this.inputId(id)}`, form, false, false, true);
  }
  inputId(id) { if (!/^in_[a-f0-9]{32}$/.test(id)) throw problem('invalid_artifact_id'); return id; }
  readiness() { return this.request('GET', '/batch/readiness'); }
  catalog() { return this.request('GET', '/llm/models'); }
  run(id) { return this.request('GET', `/batch/runs/${id}`); }
  putRun(id, body) { return this.request('PUT', `/batch/runs/${id}`, body); }
  putOperation(run, id, body) { return this.request('PUT', `/batch/runs/${run}/operations/${id}`, body); }
  start(id, body) { return this.request('POST', `/batch/runs/${id}/start`, body); }
  stop(id, mode) { return this.request('POST', `/batch/runs/${id}/stop`, { mode }); }
  ack(id, result_digest) { return this.request('POST', `/batch/operations/${id}/ack`, { result_digest }); }
  output(id) { return this.request('GET', `/batch/operations/${id}/output`, undefined, true); }
}
module.exports = { Gateway, config };
