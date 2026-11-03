jest.mock('../../models/ai_model_card', () => ({
  find: jest.fn(() => ({
    maxTimeMS: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('sharp', () => jest.fn());
jest.mock('../../database', () => ({}));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: jest.fn(() => jest.fn()),
}));
jest.mock('../../services/toolManagerService', () => jest.fn());
jest.mock('openai/helpers/zod', () => ({ zodTextFormat: jest.fn(() => 'schema') }));
jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    models: { list: jest.fn().mockResolvedValue([]) },
    chat: { completions: { create: jest.fn().mockResolvedValue({ id: 'chat-result' }) } },
    responses: { parse: jest.fn().mockResolvedValue({ id: 'parsed-result' }), create: jest.fn() },
    embeddings: { create: jest.fn() },
    images: { generate: jest.fn(), edit: jest.fn() },
    audio: { speech: { create: jest.fn() }, transcriptions: { create: jest.fn() } },
    moderations: { create: jest.fn() },
    files: { content: jest.fn().mockResolvedValue({ text: async () => JSON.stringify({ body: { model: 'test-model' } }) }) },
    batches: { create: jest.fn().mockResolvedValue({ id: 'batch-result' }) },
  })),
}));

const originalKey = process.env.OPENAI_API_KEY;

beforeEach(() => {
  jest.resetModules();
  process.env.OPENAI_API_KEY = 'synthetic-shared-key';
});

test.each([
  ['chatGPT', [[], 'test-model', true], 'chat.completions.create'],
  ['chatGPTaudio', [[], 'test-model', true], 'chat.completions.create'],
  ['chatGPT_beta', [[], 'test-model', true, { object: {}, title: 'Test' }], 'responses.parse'],
  ['chatGPT_o1', [[], 'o1-pro-2025-03-19'], 'responses.create'],
  ['chatGPT_o1', [[], 'o1', 'high', true], 'chat.completions.create'],
  ['chatGPT_Tool', [[], 'test-model', [], 'auto', true], 'chat.completions.create'],
  ['embedding', ['private', 'test-model', true], 'embeddings.create'],
  ['tts', ['tts-1', 'private', 'alloy', true], 'audio.speech.create'],
  ['ig', ['private', 'standard', '1024x1024', 'test', true], 'images.generate'],
  ['ig2', ['private', 'gpt-image-1', 'high', 'square'], 'images.generate'],
  ['imageEdit', [[], 'private', 'gpt-image-1', 'high', 'square'], 'images.edit'],
  ['whisper', ['/unused-test-file', true], 'audio.transcriptions.create'],
  ['mod', ['private'], 'moderations.create'],
  ['start_batch', ['file-test', true], 'batches.create'],
])('legacy %s blocks deprecated models before SDK submission', async (method, args, sdkMethod) => {
  const api = require('../../utils/ChatGPT');
  require('../../models/ai_model_card').find.mockReturnValueOnce({
    maxTimeMS: jest.fn().mockReturnThis(),
    lean: jest.fn().mockResolvedValue([{ deprecation_date: '2000-01-01' }]),
  });
  // Legacy helpers either return null or propagate a safe error, preserving their contracts.
  const result = await api[method](...args).catch(error => error);
  expect(result === null || result.code === 'OPENAI_MODEL_DEPRECATED').toBe(true);
  const client = require('openai').OpenAI.mock.results[0].value;
  expect(sdkMethod.split('.').reduce((value, key) => value[key], client)).not.toHaveBeenCalled();
  expect(require('../../utils/logger').error).toHaveBeenCalledWith(
    expect.stringContaining('model is deprecated'), expect.objectContaining({ category: 'openai_model_deprecation' })
  );
});

afterAll(() => {
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

test.each(['ChatGPT', 'OpenAI_API'])('%s uses the shared key for its only hosted client', (moduleName) => {
  require(`../../utils/${moduleName}`);
  const { OpenAI } = require('openai');
  const hostedClients = OpenAI.mock.calls.filter(([options]) => !options.baseURL);
  expect(hostedClients).toEqual([[{ apiKey: 'synthetic-shared-key' }]]);
});

test.each([false, true])('legacy private_msg=%s uses the shared client and preserves positional options', async (privateMsg) => {
  const { chatGPT, chatGPT_beta, start_batch } = require('../../utils/ChatGPT');
  const { OpenAI } = require('openai');
  const client = OpenAI.mock.results[0].value;
  const messages = [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }];

  await expect(chatGPT(messages, 'test-model', privateMsg)).resolves.toEqual({ id: 'chat-result' });
  expect(client.chat.completions.create).toHaveBeenCalledWith({ model: 'test-model', messages });

  const schema = { object: {}, title: 'Test' };
  await expect(chatGPT_beta(messages, 'test-model', privateMsg, schema)).resolves.toEqual({ id: 'parsed-result' });
  expect(require('openai/helpers/zod').zodTextFormat).toHaveBeenCalledWith(schema.object, schema.title);
  expect(client.responses.parse).toHaveBeenCalledWith(expect.objectContaining({
    model: 'test-model', text: { format: 'schema' },
  }));

  await expect(start_batch('file-test', privateMsg, '/v1/embeddings')).resolves.toEqual({ id: 'batch-result' });
  expect(client.batches.create).toHaveBeenCalledWith({
    input_file_id: 'file-test', endpoint: '/v1/embeddings', completion_window: '24h',
  });
});
