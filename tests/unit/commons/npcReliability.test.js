jest.mock('../../../utils/logger', () => ({ debug: jest.fn(), warning: jest.fn(), error: jest.fn() }));
const { CommonsNpc, gatewayProvider } = require('../../../services/commons/npc');
const { npcConfig } = require('../../../services/commons/config');
const env = { COMMONS_NPC_ENABLED: 'true', COMMONS_NPC_MODEL: 'gemma4:e4b', AI_GATEWAY_BASE_URL: 'http://gateway.test:8080' };
const makeLog = () => ({ debug: jest.fn(), warning: jest.fn(), error: jest.fn() });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
afterEach(() => jest.useRealTimers());
test('real config defaults and all bounds are finite integers with context headroom', () => {
  expect(npcConfig({})).toEqual({ timeoutMs: 90000, contextTokens: 16384, maxTokens: 512 });
  for (const [key, low, high] of [['COMMONS_NPC_TIMEOUT_MS', 60000, 120000], ['COMMONS_NPC_CONTEXT_TOKENS', 8192, 65536], ['COMMONS_NPC_MAX_TOKENS', 256, 1024]]) {
    for (const value of [String(low), String(high)]) expect(() => npcConfig({ [key]: value })).not.toThrow();
    for (const value of ['', ' ', 'NaN', 'Infinity', '-1', '1.5', '1e5', '0x10000', String(low - 1), String(high + 1), '9007199254740993', 90000, null]) {
      expect(() => npcConfig({ [key]: value })).toThrow('Invalid Commons NPC configuration');
    }
  }
  expect(gatewayProvider({ ...env, COMMONS_NPC_ENABLED: 'false', COMMONS_NPC_TIMEOUT_MS: 'secret-invalid' })).toBeNull();
});
test('exact Gateway contract uses configured budgets, no tools or retry, and existing URL precedence', async () => {
  const post = jest.fn().mockResolvedValue({ data: { choices: [{ message: { content: 'Hello', reasoning_content: 'private thought' }, finish_reason: 'stop' }] } });
  const provider = gatewayProvider({ ...env, OLLAMA_BASE_URL: 'https://preferred.test', COMMONS_NPC_TIMEOUT_MS: '120000', COMMONS_NPC_CONTEXT_TOKENS: '32768', COMMONS_NPC_MAX_TOKENS: '384' }, { post });
  const signal = new AbortController().signal, messages = [{ role: 'user', content: 'synthetic' }];
  expect(await provider(messages, signal)).toBe('Hello');
  expect(post).toHaveBeenCalledTimes(1);
  expect(post.mock.calls[0]).toEqual(['https://preferred.test/llm/chat', { model: 'gemma4:e4b', messages, stream: false, think: false, context_tokens: 32768, max_tokens: 384, temperature: 0.7 },
    { signal, timeout: 120000, maxRedirects: 0, maxContentLength: 32768, maxBodyLength: 32768, headers: { 'Content-Type': 'application/json' } }]);
});
test('reply after the old 12-second deadline succeeds while per-user/global work stays bounded', async () => {
  jest.useFakeTimers(); const first = deferred(), second = deferred(), log = makeLog();
  const provider = jest.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const npc = new CommonsNpc({ provider, log }), memory = [];
  const pending = npc.talk('one', 'a', 'hello', memory), other = npc.talk('two', 'b', 'hello', []);
  await jest.advanceTimersByTimeAsync(17000);
  expect(npc.active.size).toBe(2);
  expect(await npc.talk('one', 'a', 'again', [])).toEqual({ error: 'NPC_BUSY' });
  expect(await npc.talk('three', 'c', 'hello', [])).toEqual({ error: 'NPC_BUSY' });
  first.resolve('A short reply'); expect(await pending).toEqual({ text: 'A short reply', mode: 'llm' });
  second.resolve('Another reply'); await other;
  expect(memory).toHaveLength(2); expect(npc.active.size).toBe(0); expect(provider).toHaveBeenCalledTimes(2);
  const completed = log.debug.mock.calls.find(call => call[1].metadata.event === 'completed')[1].metadata;
  expect(completed).toMatchObject({ elapsed_ms: 17000, timeout_ms: 90000, context_tokens: 16384, max_tokens: 512 });
});
test('deadline frees slots, returns fallback once, and discards a late provider response', async () => {
  jest.useFakeTimers(); const work = deferred(), log = makeLog(), memory = [];
  const provider = jest.fn(() => work.promise), npc = new CommonsNpc({ provider, log });
  const reply = npc.talk('one', 'a', 'hello', memory);
  await jest.advanceTimersByTimeAsync(90000);
  expect(await reply).toHaveProperty('mode', 'fallback'); expect(npc.active.size).toBe(0);
  expect(provider.mock.calls[0][1].aborted).toBe(true);
  expect(log.warning.mock.calls[0][1].metadata).toMatchObject({ reason: 'timeout', elapsed_ms: 90000 });
  work.resolve('late'); await Promise.resolve(); expect(memory).toEqual([]);
  expect(log.warning).toHaveBeenCalledTimes(1); expect(provider).toHaveBeenCalledTimes(1);
});
test('cancellation frees slots even if upstream ignores abort; old connection cannot cancel replacement', async () => {
  jest.useFakeTimers(); const work = deferred(), log = makeLog(), memory = [];
  const npc = new CommonsNpc({ provider: () => work.promise, log });
  const reply = npc.talk('one', 'old', 'hello', memory);
  npc.cancel('one', 'wrong'); expect(npc.active.size).toBe(1);
  npc.cancel('one', 'old'); expect(await reply).toEqual({ error: 'CANCELLED' }); expect(npc.active.size).toBe(0);
  expect(log.warning).not.toHaveBeenCalled(); expect(log.debug.mock.calls.at(-1)[1].metadata.reason).toBe('cancelled');
  await jest.advanceTimersByTimeAsync(15000);
  const next = npc.talk('one', 'new', 'hello again', []);
  npc.cancel('one', 'old'); expect(npc.active.get('one').controller.signal.aborted).toBe(false);
  work.resolve('new answer'); await next; expect(memory).toEqual([]);
});
test.each([false, 'throw'])('authorization/scene validation %s prevents history mutation and warns no outage', async value => {
  const log = makeLog(), memory = [], npc = new CommonsNpc({ provider: async () => 'private answer', log });
  expect(await npc.talk('one', 'a', 'private question', memory, async () => { if (value === 'throw') throw new Error('private auth error'); return value; })).toEqual({ error: 'CANCELLED' });
  expect(memory).toEqual([]); expect(log.warning).not.toHaveBeenCalled();
});
test.each([
  [{ message: { content: '', thinking: 'hidden private thought' }, eval_count: 512, done_reason: 'length' }, 'empty_response'],
  [{ message: { content: '  ' } }, 'empty_response'],
  [{ message: { content: 123 } }, 'invalid_response'],
  [{ message: { content: [{ type: 'text', text: 'unsupported' }] } }, 'invalid_response'],
  ['malformed private body', 'invalid_response'],
  [{ message: { content: 'do not expose', tool_calls: [{}] } }, 'unexpected_tool_calls'],
  [{ message: { content: 'do not expose', tool_calls: 'malicious' } }, 'unexpected_tool_calls'],
  [{ choices: [{ message: { content: 'do not expose', function_call: {} } }] }, 'unexpected_tool_calls'],
])('response rejection has a sanitized distinct reason %#', async (data, reason) => {
  const log = makeLog(), post = jest.fn().mockResolvedValue({ data, status: 200 });
  const npc = new CommonsNpc({ provider: gatewayProvider(env, { post }), log });
  expect(await npc.talk('user-secret', 'connection-secret', 'private question', [])).toHaveProperty('mode', 'fallback');
  expect(log.warning.mock.calls[0][1].metadata).toMatchObject({ reason, http_status: 200, model_key: 'gemma4:e4b' });
  expect(JSON.stringify([...log.warning.mock.calls, ...log.debug.mock.calls])).not.toMatch(/hidden private|do not expose|malformed private|user-secret|connection-secret|private question/);
});
test.each([[400, 'ERR_BAD_REQUEST', 'upstream_http'], [503, 'ERR_BAD_RESPONSE', 'upstream_http'], [undefined, 'ECONNRESET', 'network'], [undefined, 'ENOTFOUND', 'network'], [undefined, 'ECONNABORTED', 'timeout'], [undefined, 'ETIMEDOUT', 'timeout'], [undefined, 'ERR_CANCELED', 'cancelled'], ['503 private', 'private-code', 'provider_error']])('transport failure %s/%s is classified without raw error data', async (status, code, reason) => {
  const log = makeLog();
  const error = Object.assign(new Error('private-error https://secret:password@upstream/private?secret'), { code, response: { status, data: 'private-body' }, config: { headers: { Authorization: 'private-auth' } } });
  const post = jest.fn().mockRejectedValue(error), npc = new CommonsNpc({ provider: gatewayProvider(env, { post }), log });
  await npc.talk('one', 'a', 'private-question', []);
  const output = [...log.warning.mock.calls, ...log.debug.mock.calls].find(call => call[1].metadata.reason === reason)[1].metadata;
  expect(output.reason).toBe(reason); expect(post).toHaveBeenCalledTimes(1);
  expect(JSON.stringify([...log.warning.mock.calls, ...log.debug.mock.calls])).not.toMatch(/private-|password|upstream\/|Authorization|gateway.test/);
  if (reason === 'cancelled') expect(log.warning).not.toHaveBeenCalled();
});
test('only numeric/allowlisted response metadata and a safe model key reach diagnostics', async () => {
  const log = makeLog(), post = jest.fn().mockResolvedValue({ status: 200, data: { message: { content: 'private-visible', thinking: 'private-reasoning' }, done_reason: 'private-reason', eval_count: '512 private', prompt_eval_count: -1, usage: { prompt_tokens: 42, completion_tokens: Infinity } } });
  const npc = new CommonsNpc({ provider: gatewayProvider({ ...env, COMMONS_NPC_MODEL: 'https://private-host/private-path' }, { post }), log });
  await npc.talk('one', 'a', 'private-question', []);
  const metadata = log.debug.mock.calls.at(-1)[1].metadata;
  expect(metadata).toMatchObject({ model_key: expect.stringMatching(/^sha256:[a-f0-9]{16}$/), visible_chars: 15, prompt_tokens: 42 });
  expect(metadata).not.toHaveProperty('completion_tokens'); expect(metadata).not.toHaveProperty('finish_reason');
  expect(JSON.stringify(log.debug.mock.calls)).not.toContain('private-');
});
test('distinct failures remain visible and repeated bursts produce bounded summaries with local IDs', async () => {
  jest.useFakeTimers(); const log = makeLog(), post = jest.fn().mockResolvedValue({ data: { message: { content: '' } } });
  const npc = new CommonsNpc({ provider: gatewayProvider(env, { post }), log });
  for (let i = 0; i < 9; i++) await npc.talk(String(i), 'a', 'hello', []);
  post.mockRejectedValue({ response: { status: 503 } }); await npc.talk('http', 'a', 'hello', []);
  expect(log.warning).toHaveBeenCalledTimes(6);
  await jest.advanceTimersByTimeAsync(60000);
  const summary = log.warning.mock.calls.at(-1)[1].metadata;
  expect(summary).toMatchObject({ reason: 'empty_response', suppressed_count: 4 });
  expect(summary.request_ids).toHaveLength(3);
  expect(summary.request_ids.every(id => /^[a-f0-9-]{36}$/.test(id))).toBe(true);
  expect(npc.logWindows.size).toBe(0);
});
test('real local HTTP adapter abort closes the client request without waiting for a reply', async () => {
  const http = require('http'); const arrived = deferred(), closed = deferred();
  const server = http.createServer((req, res) => { req.resume(); res.on('close', closed.resolve); arrived.resolve(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const provider = gatewayProvider({ ...env, AI_GATEWAY_BASE_URL: `http://127.0.0.1:${server.address().port}` });
    const controller = new AbortController(); const request = provider([], controller.signal);
    const check = expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    await arrived.promise; controller.abort(); await check; await closed.promise;
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('invalid optional NPC budgets disable Commons safely without throwing or logging config values', () => {
  const log = require('../../../utils/logger');
  const { installCommons } = require('../../../socket_io/commons');
  const replacement = jest.replaceProperty(process, 'env', { ...env, COMMONS_NPC_TIMEOUT_MS: 'private-invalid-value' });
  try {
    expect(installCommons({}, () => {})).toBeNull();
    expect(log.error).toHaveBeenCalledWith('Commons disabled: validate COMMONS configuration and NPC model settings', { category: 'commons.config' });
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('private-invalid-value');
  } finally { replacement.restore(); }
});
test('configured deadline covers delayed validation and cannot commit after cancellation', async () => {
  jest.useFakeTimers(); const validation = deferred(), log = makeLog(), memory = [];
  const post = jest.fn().mockResolvedValue({ data: { message: { content: 'Welcome' } } });
  const npc = new CommonsNpc({ provider: gatewayProvider({ ...env, COMMONS_NPC_TIMEOUT_MS: '60000' }, { post }), log });
  const reply = npc.talk('one', 'a', 'hello', memory, () => validation.promise);
  await jest.advanceTimersByTimeAsync(60000);
  expect(await reply).toHaveProperty('mode', 'fallback'); expect(npc.active.size).toBe(0);
  validation.resolve(true); await Promise.resolve(); await Promise.resolve();
  expect(memory).toEqual([]); expect(post).toHaveBeenCalledTimes(1);
  expect(log.warning.mock.calls[0][1].metadata).toMatchObject({ timeout_ms: 60000, reason: 'timeout' });
});
test('known finish/token metadata identifies empty budget exhaustion without exposing thinking', async () => {
  const log = makeLog(), post = jest.fn().mockResolvedValue({ status: 200,
    data: { message: { content: '', thinking: 'hidden synthetic reasoning' }, done_reason: 'length', prompt_eval_count: 70, eval_count: 512 } });
  const npc = new CommonsNpc({ provider: gatewayProvider(env, { post }), log });
  await npc.talk('one', 'a', 'hello', []);
  expect(log.warning.mock.calls[0][1].metadata).toMatchObject({ finish_reason: 'length', completion_tokens: 512, prompt_tokens: 70, visible_chars: 0, reason: 'empty_response' });
  expect(JSON.stringify(log.warning.mock.calls)).not.toContain('hidden synthetic reasoning');
});
