jest.mock('axios', () => ({
  get: jest.fn(),
  post: jest.fn(),
}));
jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: jest.fn(() => jest.fn().mockResolvedValue(undefined)),
}));
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const axios = require('axios');
const TtsService = require('../../services/ttsService');

describe('TtsService shared voice cache', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    TtsService.clearSharedVoiceCaches();
    axios.get.mockResolvedValue({
      data: {
        voices: [{ voice_id: 'voice-1', display_name: 'Voice One', language: 'en' }],
        default_voice: 'voice-1',
      },
      headers: {},
    });
  });

  test('warms a shared API base only once across service instances', async () => {
    const services = Array.from({ length: 5 }, () => new TtsService({ apiBase: 'http://tts.test' }));

    const results = await Promise.all(services.map((service) => service.getVoices()));

    expect(axios.get).toHaveBeenCalledTimes(1);
    expect(results.every((result) => result.defaultVoiceId === 'voice-1')).toBe(true);
    expect(services[0].voiceCache).toBe(services[4].voiceCache);
  });

  test('coalesces simultaneous explicit refresh requests', async () => {
    const first = new TtsService({ apiBase: 'http://tts.test', warmCache: false });
    const second = new TtsService({ apiBase: 'http://tts.test', warmCache: false });

    await Promise.all([
      first.getVoices({ forceRefresh: true }),
      second.getVoices({ forceRefresh: true }),
    ]);

    expect(axios.get).toHaveBeenCalledTimes(1);
  });
});
