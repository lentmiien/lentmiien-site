const http = require('http');
const { BASE_MODEL, TEST_ADAPTER } = require('../../utils/taricProtocol');
const contract = require('../fixtures/gateway-inference-sessions.json');
// Non-private fixture copied verbatim from ai-services 689c68a. Assert every wire
// field against its exported contract; this is deliberately NOT the old adapter mock.
const operation = id => ({ operation_id: id, state: 'terminal', http_status: 200,
  outcome_code: 'completed', resolution: 'completed', submitted_at: 1, started_at: 1, finished_at: 2 });
const status = (id = 'session-1') => ({ session_id: id, client_id: 'synthetic', state: 'idle',
  server_time: 1, created_at: 1, hard_expires_at: 901, hard_remaining_sec: 900, idle_remaining_sec: 120,
  idle_timeout_sec: 120, max_duration_sec: 900, idle_proven: true, reclaim_verified: false,
  close_reason: null, operations: [], operation_limit: 256, retention_sec: 900 });
const content = '{"taric_code":"0000000001","description":"Synthetic description"}';
const envelope = () => ({ model: BASE_MODEL, adapter_name: TEST_ADAPTER, content, raw_content: content,
  tool_calls: [], usage: { prompt_tokens: 200, completion_tokens: 30, total_tokens: 230 } });
// Minimal projection of the published FastAPI operations in Gateway app.py.
// Dict/Request handler signatures do not publish owner-token or status schemas.
function openapi() {
  const paths = {};
  for (const [path, method, code] of [
    ['/qwen3-lora/inference-sessions', 'post', '201'],
    ['/qwen3-lora/inference-sessions/{session_id}', 'get', '200'],
    ['/qwen3-lora/inference-sessions/{session_id}', 'delete', '200'],
    ['/qwen3-lora/inference-sessions/{session_id}/heartbeat', 'post', '200'],
    ['/qwen3-lora/{path}', 'post', '200'],
  ]) {
    paths[path] ||= {};
    paths[path][method] = { operationId: `${method}_${path}`, responses: { [code]: { description: 'Successful Response', content: { 'application/json': { schema: {} } } } } };
  }
  return { openapi: '3.1.0', info: { title: 'Synthetic Gateway', version: '1' }, paths };
}
async function gatewayFixture() {
  const fixture = { document: openapi(), discoveryStatus: 200, requests: [], sessions: [], generateCount: 0, dropAt: null, busy: false, cleanup: true, closePending: false, statusPatch: null };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
    fixture.requests.push({ path: req.url, method: req.method, headers: req.headers, body });
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.headers['x-admin-token'] !== 'synthetic-admin' || req.headers.authorization !== 'Bearer synthetic-proxy') return send(401, { detail: 'private-error-must-not-leak' });
    if (req.url === '/openapi.json') return send(fixture.discoveryStatus, fixture.document);
    if (req.url === '/qwen3-lora/adapters') return send(200, { adapters: [{ adapter_name: TEST_ADAPTER }] });
    const base = contract.endpoints.create.path;
    if (req.url === base && req.method === 'POST') {
      if (fixture.busy || fixture.sessions.some(s => !s.reclaim_verified)) return send(409, { detail: 'private operator reservation' });
      const session = { ...status(`session-${fixture.sessions.length + 1}`), client_id: body.client_id };
      fixture.sessions.push(session);
      return send(201, { ...session, owner_token: 'synthetic-owner-capability' });
    }
    const selected = req.url === contract.endpoints.generate.path ? req.headers['x-inference-session'] : req.url.split('/')[3];
    const session = fixture.sessions.find(s => s.session_id === selected);
    if (!session) return send(404, { detail: 'unknown' });
    if (req.headers['x-inference-session-token'] !== 'synthetic-owner-capability') return send(403, { detail: 'wrong capability' });
    if (req.url === contract.endpoints.generate.path) {
      const id = req.headers['x-inference-operation'];
      if (session.operations.some(op => op.operation_id === id)) return send(409, { detail: 'duplicate' });
      fixture.generateCount++;
      session.operations.push(operation(id));
      if (fixture.onGenerate) await fixture.onGenerate(session, req);
      if (fixture.generateCount === fixture.dropAt) { req.socket.destroy(); return; }
      return send(200, envelope());
    }
    if (req.method === 'DELETE') {
      if (fixture.onClose) await fixture.onClose(session);
      session.state = fixture.cleanup ? 'closed' : 'uncertain'; session.idle_proven = false;
      session.reclaim_verified = fixture.cleanup; session.close_reason = 'released';
      return send(fixture.closePending || !fixture.cleanup ? 202 : 200, session);
    }
    if (fixture.onStatus) await fixture.onStatus(session, req);
    return send(200, fixture.statusPatch ? fixture.statusPatch(session) : session);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  fixture.env = { TARIC_GATEWAY_ORIGIN: `http://127.0.0.1:${server.address().port}`, TARIC_GATEWAY_ALLOWED_ORIGINS: `http://127.0.0.1:${server.address().port}`,
    TARIC_GATEWAY_TOKEN: 'synthetic-proxy', TARIC_GATEWAY_ADMIN_TOKEN: 'synthetic-admin' };
  fixture.close = async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return fixture;
}
module.exports = { openapi, contract, operation, status, envelope, gatewayFixture };
