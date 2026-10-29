const mockFetch = jest.fn();

jest.mock('@anthropic-ai/sdk', () => {
  const Anthropic = jest.requireActual('@anthropic-ai/sdk');
  return jest.fn().mockImplementation(() => new Anthropic({
    apiKey: 'synthetic-test-key',
    fetch: mockFetch,
    maxRetries: 0,
  }));
});
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));

const logger = require('../../utils/logger');
let api;

function jsonResponse(body) {
  return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
}

beforeAll(async () => {
  mockFetch.mockResolvedValue(jsonResponse({ data: [], has_more: false }));
  api = require('../../utils/anthropic');
  await api.RefreshAnthropicModels();
});

beforeEach(() => mockFetch.mockReset());

test('streams text using the installed SDK without removed sampling parameters', async () => {
  const events = [
    { type: 'message_start', message: { id: 'msg_test', type: 'message', role: 'assistant', content: [], model: 'claude-test', usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  mockFetch.mockResolvedValue(new Response(
    events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'Content-Type': 'text/event-stream' } },
  ));

  const result = await api.anthropic([
    { role: 'system', content: [{ type: 'text', text: 'Be helpful.' }] },
    { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
  ], 'claude-test');

  expect(result.choices[0].message.content).toBe('Hello');
  const [url, options] = mockFetch.mock.calls[0];
  expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
  expect(new Headers(options.headers).get('anthropic-version')).toBe('2026-10-21');
  expect(JSON.parse(options.body)).toEqual({
    system: 'Be helpful.',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    model: 'claude-test',
    max_tokens: 32000,
    stream: true,
  });
});

test('submits batch messages with the installed SDK', async () => {
  mockFetch.mockResolvedValue(jsonResponse({ id: 'batch_test' }));
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }];
  await expect(api.anthropic_batch_start([
    { custom_id: 'test', model: 'claude-test', max_tokens: 100, messages },
  ])).resolves.toMatchObject({ id: 'batch_test' });
  expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
    requests: [{ custom_id: 'test', params: { model: 'claude-test', max_tokens: 100, messages } }],
  });
});

test('reports failed streaming requests without returning a successful message', async () => {
  mockFetch.mockResolvedValue(new Response(JSON.stringify({
    type: 'error', error: { type: 'invalid_request_error', message: 'Synthetic invalid request' },
  }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
  await expect(api.anthropic([
    { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
  ], 'claude-test')).resolves.toBeNull();
  expect(logger.error).toHaveBeenCalled();
});
