jest.mock('axios', () => ({ get: jest.fn(), post: jest.fn() }));
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));

const axios = require('axios');
const logger = require('../../utils/logger');
const gateway = require('../../services/veniceGateway');

test('discovers only qualified Venice cards and preserves catalog limits', async () => {
  axios.get.mockResolvedValue({ data: { models: [
    { id: 'venice/test', provider: 'venice', allow_images: true, limits: { max_context_tokens: 1024, max_output_tokens: 256 } },
    { id: 'local', provider: 'ollama' }, { id: 'unqualified', provider: 'venice' },
    { id: 'venice/wrong-provider', provider: 'ollama' },
  ] } });
  expect(await gateway.listCards()).toEqual([expect.objectContaining({
    api_model: 'venice/test', provider: 'Venice', in_modalities: ['text', 'image'], max_tokens: 1024, max_out_tokens: 256,
  })]);
});

test('authenticates foreground requests and sanitizes transport failures', async () => {
  const before = process.env.VENICE_GATEWAY_CLIENT_TOKEN;
  process.env.VENICE_GATEWAY_CLIENT_TOKEN = 'test-client-credential';
  try {
    axios.get.mockResolvedValue({ data: { models: [{ id: 'venice/test', provider: 'venice' }] } });
    const payload = { model: 'venice/test', messages: [{ role: 'user', content: 'private message' }] };
    await expect(gateway.postChat({ ...payload, model: 'unlisted' })).rejects.toThrow('unavailable');
    expect(axios.post).not.toHaveBeenCalled();
    axios.post.mockResolvedValueOnce({ data: { message: { content: 'hello' } } });
    expect(await gateway.postChat(payload)).toBe('hello');
    expect(axios.post).toHaveBeenCalledWith('/llm/chat', payload, expect.objectContaining({
      headers: { Authorization: 'Bearer test-client-credential' }, maxRedirects: 0,
    }));
    axios.post.mockRejectedValueOnce(Object.assign(new Error('test-client-credential'), { response: { status: 401 } }));
    await expect(gateway.postChat(payload)).rejects.toThrow('Venice Gateway chat failed (HTTP 401).');
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/test-client-credential|private message/);
  } finally {
    if (before === undefined) delete process.env.VENICE_GATEWAY_CLIENT_TOKEN;
    else process.env.VENICE_GATEWAY_CLIENT_TOKEN = before;
  }
});

test('keeps Venice discoverable without chat credentials and reports the send failure safely', async () => {
  const { VENICE_GATEWAY_CLIENT_TOKEN: token, VENICE_GATEWAY_CLIENT_TOKEN_FILE: file } = process.env;
  delete process.env.VENICE_GATEWAY_CLIENT_TOKEN;
  delete process.env.VENICE_GATEWAY_CLIENT_TOKEN_FILE;
  try {
    axios.get.mockResolvedValue({ data: { models: [{ id: 'venice/test', provider: 'venice' }] } });
    await expect(gateway.listCards()).resolves.toContainEqual(expect.objectContaining({ api_model: 'venice/test' }));
    await expect(gateway.postChat({ model: 'venice/test' })).rejects.toMatchObject({ code: 'venice_credential_unavailable' });
    expect(axios.post).not.toHaveBeenCalled();
  } finally {
    if (token !== undefined) process.env.VENICE_GATEWAY_CLIENT_TOKEN = token;
    if (file !== undefined) process.env.VENICE_GATEWAY_CLIENT_TOKEN_FILE = file;
  }
});
