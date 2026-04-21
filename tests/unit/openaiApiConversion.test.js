process.env.OPENAI_API_KEY_PRIVATE = 'test-key';

jest.mock('sharp', () =>
  jest.fn(() => ({
    jpeg: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('jpg')),
  }))
);

jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: jest.fn(() => jest.fn().mockResolvedValue()),
}));

jest.mock('openai', () => ({
  OpenAI: jest.fn().mockImplementation(() => ({
    responses: { retrieve: jest.fn() },
    embeddings: { create: jest.fn() },
    files: {
      create: jest.fn(),
      content: jest.fn(),
      delete: jest.fn(),
    },
    batches: {
      create: jest.fn(),
      retrieve: jest.fn(),
    },
    videos: {
      create: jest.fn(),
      retrieve: jest.fn(),
      downloadContent: jest.fn(),
    },
  })),
  toFile: jest.fn(),
}));

const { convertResponseBody } = require('../../utils/OpenAI_API');

describe('OpenAI_API response conversion', () => {
  test('converts image items without result into a tool fallback instead of throwing', async () => {
    const converted = await convertResponseBody({
      id: 'resp-old',
      status: 'completed',
      output: [
        {
          id: 'out-1',
          type: 'image_generation_call',
          status: 'completed',
          revised_prompt: 'A castle on a hill',
        },
      ],
      error: null,
    });

    expect(converted).toEqual([
      {
        contentType: 'tool',
        content: {
          text: null,
          image: null,
          audio: null,
          tts: null,
          transcript: null,
          revisedPrompt: 'A castle on a hill',
          imageQuality: null,
          toolOutput: 'image_generation_call: status: completed, revised_prompt: A castle on a hill',
        },
        hideFromBot: true,
      },
      { error: null },
    ]);
  });
});
