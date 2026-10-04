const mockGet = jest.fn();
const mockPost = jest.fn();
const mockRecordApiDebugLog = jest.fn().mockResolvedValue();
jest.mock('axios', () => ({ create: () => ({ get: mockGet, post: mockPost }) }));
jest.mock('../../utils/logger', () => ({ notice: jest.fn(), warning: jest.fn(), error: jest.fn() }));
jest.mock('../../utils/apiDebugLogger', () => ({ createApiDebugLogger: () => mockRecordApiDebugLog }));
jest.mock('../../services/toolManagerService', () => jest.fn().mockImplementation(() => ({})));

const fs = require('fs');
const path = require('path');
const api = require('../../utils/Ollama_API');
const logger = require('../../utils/logger');
const images = ['Zmlyc3Q=', 'c2Vjb25k', 'dGhpcmQ='];
const card = { api_model: 'gemma4:12b', in_modalities: ['text', 'image'] };
const conversation = { contextPrompt: 'Private system prompt', metadata: {} };
const userMessage = (selectedImages, text = 'Compare these images', id = 'image-message') => ({
  _id: id, user_id: 'test-user', contentType: 'text', content: { text, images: selectedImages },
});
const job = { job_id: '02d58123-b2da-4412-8df5-1fbb47bb07cd', status: 'queued' };
const entries = ['submitChatJob', 'chat', 'chatWithThinkingAndTools', 'chatGemma4'];

async function discover(entry = {}) {
  mockGet.mockResolvedValue({ data: { models: [{ id: card.api_model, allow_images: true,
    limits: { max_images: 3, max_image_bytes: 6000000 }, ...entry }] } });
  await api.loadModelList();
  mockGet.mockClear();
  mockRecordApiDebugLog.mockClear();
}

describe('Ollama selected-history image policy', () => {
  const previousSecret = process.env.OLLAMA_WEBHOOK_SECRET;
  beforeEach(async () => {
    process.env.OLLAMA_WEBHOOK_SECRET = 'unit-test-ollama-secret-with-enough-entropy';
    mockGet.mockReset();
    mockPost.mockReset().mockImplementation(async (endpoint) => ({ data: endpoint.endsWith('/jobs')
      ? job : { message: { role: 'assistant', content: 'Compared.' } } }));
    await discover();
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(() => {
    if (previousSecret === undefined) delete process.env.OLLAMA_WEBHOOK_SECRET;
    else process.env.OLLAMA_WEBHOOK_SECRET = previousSecret;
  });

  describe.each(entries)('%s', (method) => {
    test.each([1, 2, 3])('preserves %i separate image messages, text, and original order', async (count) => {
      const messages = images.slice(0, count).map((image, i) => userMessage([image], `Image ${i}`, String(i)));
      const original = JSON.parse(JSON.stringify(messages));
      await api[method](conversation, messages, card);
      expect(mockPost).toHaveBeenCalledTimes(1);
      expect(mockPost.mock.calls[0][0]).toBe(method === 'submitChatJob' ? '/llm/chat/jobs' : '/llm/chat');
      expect(mockPost.mock.calls[0][1].messages).toEqual([
        { role: 'system', content: conversation.contextPrompt },
        ...images.slice(0, count).map((image, i) => ({ role: 'user', content: `Image ${i}`, images: [image] })),
      ]);
      expect(messages).toEqual(original);
      expect(mockGet).not.toHaveBeenCalled();
    });

    test.each([2, 3])('normalizes %i inline images in one message without changing order', async (count) => {
      await api[method](conversation, [userMessage(images.slice(0, count).map((image) => `data:image/jpeg;base64,${image}`))], card);
      expect(mockPost.mock.calls[0][1].messages[1]).toEqual({
        role: 'user', content: 'Compare these images', images: images.slice(0, count),
      });
    });

    test('rejects excess images across history without submitting a partial request', async () => {
      await expect(api[method](conversation, [userMessage(images), userMessage([images[0]])], card))
        .rejects.toThrow('4 images; the request limit is 3 total, including history');
      expect(mockPost).not.toHaveBeenCalled();
    });

    test('honors the still-deployed one-image policy and a refreshed three-image policy', async () => {
      await discover({ limits: { max_images: 1, max_image_bytes: 6000000 } });
      await expect(api[method](conversation, [userMessage(images.slice(0, 2))], card)).rejects.toThrow('limit is 1');
      expect(mockPost).not.toHaveBeenCalled();
      await api[method](conversation, [userMessage([images[0]])], card);
      await discover();
      await api[method](conversation, [userMessage(images)], card);
      expect(mockPost.mock.calls[1][1].messages[1].images).toEqual(images);
    });

    test('provider vision declaration overrides an inaccurate Site model card', async () => {
      const nonvision = { ...card, api_model: 'muse-glimmer:30b-kquant-17gb' };
      await discover({ id: nonvision.api_model, allow_images: false });
      await expect(api[method](conversation, [userMessage(images)], nonvision)).rejects.toThrow('does not allow images');
      expect(mockPost).not.toHaveBeenCalled();
      await api[method](conversation, [userMessage([], 'Text still works')], nonvision);
      expect(mockPost).toHaveBeenCalledTimes(1);
    });

    test('provider vision declaration overrides missing Site image modality', async () => {
      await api[method](conversation, [userMessage(images)], { api_model: card.api_model, in_modalities: ['text'] });
      expect(mockPost.mock.calls[0][1].messages[1].images).toEqual(images);
    });

    test('applies count and byte policy only after start, hidden, role and message-count filters', async () => {
      await discover({ limits: { max_images: 1, max_image_bytes: 6 } });
      const excluded = ['https://must-not-be-fetched.invalid/image'];
      const messages = [
        userMessage(excluded, 'Before start', 'old'),
        userMessage(excluded, 'Before maxMessages window', 'start'),
        { ...userMessage(excluded, 'Hidden', 'hidden'), hideFromBot: true },
        { ...userMessage(excluded, 'Assistant text', 'assistant'), user_id: 'bot' },
        userMessage([images[0]], 'Selected', 'last'),
      ];
      await api[method]({ metadata: { startMessageId: 'start', maxMessages: 2 } }, messages, card);
      expect(mockPost.mock.calls[0][1].messages).toEqual([
        { role: 'assistant', content: 'Assistant text' },
        { role: 'user', content: 'Selected', images: [images[0]] },
      ]);
    });

    test('validates aggregate bytes across messages at the boundary without decoding copies', async () => {
      await discover({ limits: { max_images: 3, max_image_bytes: 12 } });
      await api[method](conversation, [userMessage(images.slice(0, 2))], card);
      mockPost.mockClear();
      await expect(api[method](conversation, [userMessage(images.slice(0, 2)), userMessage([images[2]])], card))
        .rejects.toThrow('aggregate 12-byte image budget, including history');
      expect(mockPost).not.toHaveBeenCalled();
    });

    test('preserves bare base64 from stored JPEG filenames and image-only messages', async () => {
      const read = jest.spyOn(fs, 'readFileSync').mockReturnValue(Buffer.from('stored-jpeg'));
      await api[method](conversation, [{ user_id: 'test-user', contentType: 'image', content: { image: 'test.jpg' } },
        userMessage(images.slice(0, 2), '')], card);
      expect(read).toHaveBeenCalledWith(path.resolve(__dirname, '../../public/img/test.jpg'));
      expect(mockPost.mock.calls[0][1].messages.slice(1)).toEqual([
        { role: 'user', content: '', images: [Buffer.from('stored-jpeg').toString('base64')] },
        { role: 'user', content: '', images: images.slice(0, 2) },
      ]);
    });

    test('keeps compatibility with discovery responses that have no policy fields', async () => {
      await discover({ allow_images: undefined, limits: undefined });
      await api[method](conversation, [userMessage([...images, images[0]])], card);
      expect(mockPost.mock.calls[0][1].messages[1].images).toHaveLength(4);
      expect(mockGet).not.toHaveBeenCalled();
    });
  });

  test.each(['submitChatJob', 'chatWithThinkingAndTools', 'chatGemma4'])('%s respects explicit maxImages as a rejecting cap', async (method) => {
    for (const limit of [0, 1, 2]) {
      await expect(api[method](conversation, [userMessage(images)], card, { maxImages: limit }))
        .rejects.toThrow(`limit is ${limit}`);
    }
    expect(mockPost).not.toHaveBeenCalled();
    await api[method](conversation, [userMessage(images)], card, { maxImages: 3 });
    await api[method](conversation, [userMessage(images)], card, { maxImages: null });
    await api[method](conversation, [userMessage([], 'Text')], card, { maxImages: 0 });
    await expect(api[method](conversation, [userMessage([...images, images[0]])], card, { maxImages: 10 }))
      .rejects.toThrow('limit is 3');
    for (const invalid of [-1, 1.5, '2', NaN, Infinity]) {
      await expect(api[method](conversation, [userMessage(images)], card, { maxImages: invalid }))
        .rejects.toThrow('maxImages must be');
    }
  });

  test.each(['gemma3:12b', 'qwen3.6:27b', 'qwen3.8:27b'])('%s uses provider policy without a family-specific quota', async (id) => {
    await discover({ id });
    await api.submitChatJob(conversation, [userMessage(images.slice(0, 2)), userMessage([images[2]])],
      { api_model: id, in_modalities: ['text'] });
    expect(mockPost.mock.calls[0][1].messages.flatMap((message) => message.images || [])).toEqual(images);
  });

  test.each(entries)('%s excludes images before start even without a message-count window', async (method) => {
    await api[method]({ metadata: { startMessageId: 'start' } }, [
      userMessage(['https://excluded.invalid'], 'Excluded', 'old'),
      userMessage(images, 'Selected', 'start'),
    ], card);
    expect(mockPost.mock.calls[0][1].messages).toEqual([
      { role: 'user', content: 'Selected', images },
    ]);
  });

  test.each(['https://example.invalid/image', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png,percent-encoded', 'data:image/jpeg;base64,????', '', null])('rejects unsupported inline input safely: %s', async (image) => {
    await expect(api.submitChatJob(conversation, [userMessage([image])], card)).rejects.toThrow('inline base64 raster images');
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockGet).not.toHaveBeenCalled();
    expect(logger.warning).toHaveBeenCalledWith('Ollama image request rejected before submission', {
      category: 'ollama_image_policy', metadata: { reason: 'invalid_inline_image' },
    });
  });

  test('unreadable stored images fail safely instead of silently dropping the attachment', async () => {
    jest.spyOn(fs, 'readFileSync').mockImplementation(() => { throw new Error('private path'); });
    await expect(api.submitChatJob(conversation, [{ contentType: 'image', content: { image: 'missing.jpg' } }], card))
      .rejects.toThrow('Unable to read an attached image');
    expect(mockPost).not.toHaveBeenCalled();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private path');
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('missing.jpg');
  });

  test.each(['submitChatJob', 'chat'])('%s logs no request prompt or image payload even when the Gateway echoes it in an error', async (method) => {
    const secretPrompt = 'private-user-prompt-sentinel';
    mockPost.mockRejectedValueOnce(Object.assign(new Error(secretPrompt), {
      response: { status: 413, data: { detail: secretPrompt, images } },
    }));
    await expect(api[method](conversation, [userMessage(images, secretPrompt)], card)).rejects.toThrow(secretPrompt);
    const logs = JSON.stringify([mockRecordApiDebugLog.mock.calls, logger.error.mock.calls, logger.warning.mock.calls]);
    for (const value of [secretPrompt, conversation.contextPrompt, ...images]) expect(logs).not.toContain(value);
  });

  test('sync tool rounds and tool-role compatibility retries retain each image exactly once', async () => {
    const tool = { type: 'function', function: { name: 'lookup', parameters: { type: 'object', properties: {} } } };
    mockPost.mockResolvedValueOnce({ data: { message: { role: 'assistant', content: '', tool_calls: [
      { id: 'call-1', type: 'function', function: { name: 'lookup', arguments: {} } },
    ] } } })
      .mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Invalid role: tool' } } })
      .mockResolvedValueOnce({ data: { message: { role: 'assistant', content: 'Done' } } });
    const response = await api.chatGemma4(conversation, [userMessage(images)], card, {
      tools: [tool], toolHandlers: { lookup: async () => 'result' }, maxImages: 3,
    });
    expect(response.rounds).toBe(2);
    expect(mockPost).toHaveBeenCalledTimes(3);
    for (const [, payload] of mockPost.mock.calls) {
      expect(payload.messages.flatMap((message) => message.images || [])).toEqual(images);
    }
    expect(response.message_history.flatMap((message) => message.images || [])).toEqual(images);
  });

  test('background continuation and tool-role fallback do not duplicate image budgets', async () => {
    mockPost.mockRejectedValueOnce({ response: { status: 400, data: { detail: 'Invalid role: tool' } } });
    await api.submitChatJob(conversation, [userMessage(images), {
      _id: 'call', contentType: 'function_call', hideFromBot: true,
      content: { toolName: 'lookup', toolCallId: 'call-1', arguments: {}, images: ['https://excluded.invalid'] },
    }, {
      _id: 'output', contentType: 'function_call_output', hideFromBot: true,
      content: { toolName: 'lookup', toolCallId: 'call-1', output: 'result', images: ['https://excluded.invalid'] },
    }], card, { includeLastToolBatch: true });
    expect(mockPost).toHaveBeenCalledTimes(2);
    for (const [, payload] of mockPost.mock.calls) {
      expect(payload.messages.flatMap((message) => message.images || [])).toEqual(images);
    }
  });

  test('a legacy nonvision card rejects images when discovery lacks a declaration', async () => {
    await discover({ id: 'text-model', allow_images: undefined, limits: undefined });
    await expect(api.chat(conversation, [userMessage(images)], { api_model: 'text-model', in_modalities: ['text'] }))
      .rejects.toThrow('does not allow images');
    expect(mockPost).not.toHaveBeenCalled();
  });
});
