const axios = require('axios');

jest.mock('axios', () => ({
  post: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  error: jest.fn(),
}));
jest.mock('../../utils/apiDebugLogger', () => ({
  createApiDebugLogger: () => jest.fn(),
}));

const AsrApiService = require('../../services/asrApiService');
const {
  CRISPERWHISPER_MODEL,
  buildTranscriptionFormFields,
  normalizeOptions,
} = AsrApiService;

describe('AsrApiService CrisperWhisper support', () => {
  test('keeps the existing Whisper defaults', () => {
    expect(normalizeOptions({})).toEqual({
      model: 'whisper-api',
      language: 'auto',
      task: 'transcribe',
      vadFilter: true,
      beamSize: 5,
      temperature: 1,
      wordTimestamps: false,
    });
  });

  test('normalizes the documented CrisperWhisper options and drops incompatible fields', () => {
    expect(normalizeOptions({
      model: CRISPERWHISPER_MODEL,
      model_size: 'medium',
      language: 'auto',
      mode: 'intended',
      task: 'translate',
      word_timestamps: 'true',
      max_new_tokens: '512',
      hallucination_mitigation: 'false',
      vad_filter: 'true',
      beam_size: '8',
      temperature: '0.2',
      hotwords: 'unsupported',
      context: 'unsupported',
    })).toEqual({
      model: CRISPERWHISPER_MODEL,
      modelSize: 'medium',
      language: 'en',
      mode: 'intended',
      task: 'transcribe',
      wordTimestamps: true,
      maxNewTokens: 512,
      hallucinationMitigation: false,
    });
  });

  test('uses gateway defaults for invalid CrisperWhisper values', () => {
    expect(normalizeOptions({
      model: CRISPERWHISPER_MODEL,
      model_size: 'tiny',
      language: 'ja',
      mode: 'summary',
      max_new_tokens: '1025',
    })).toEqual({
      model: CRISPERWHISPER_MODEL,
      modelSize: 'large',
      language: 'ja',
      mode: 'verbatim',
      task: 'transcribe',
      wordTimestamps: false,
      maxNewTokens: 256,
      hallucinationMitigation: true,
    });
  });

  test('maps only supported CrisperWhisper fields to the gateway multipart contract', () => {
    expect(buildTranscriptionFormFields({
      model: CRISPERWHISPER_MODEL,
      model_size: 'small',
      language: 'sv',
      mode: 'intended',
      word_timestamps: 'true',
      max_new_tokens: '128',
      hallucination_mitigation: 'false',
      hotwords: 'must not be sent',
      context: 'must not be sent',
    })).toEqual({
      model: CRISPERWHISPER_MODEL,
      language: 'sv',
      task: 'transcribe',
      word_timestamps: true,
      model_size: 'small',
      mode: 'intended',
      max_new_tokens: 128,
      hallucination_mitigation: false,
    });
  });

  test('preserves VibeVoice optional fields', () => {
    expect(buildTranscriptionFormFields({
      model: 'vibevoice-asr',
      language: 'en',
      sampling_rate: '16000',
      max_new_tokens: '1024',
      hotwords: 'Lennart',
      context: 'Speaker interview',
    })).toEqual({
      model: 'vibevoice-asr',
      language: 'en',
      task: 'transcribe',
      word_timestamps: false,
      vad_filter: true,
      beam_size: 5,
      temperature: 1,
      sampling_rate: 16000,
      max_new_tokens: 1024,
      hotwords: 'Lennart',
      context: 'Speaker interview',
    });
  });

  test('uses the extended timeout for CrisperWhisper requests', async () => {
    axios.post.mockResolvedValue({ data: { text: 'hello' }, headers: {} });
    const service = new AsrApiService({
      apiBase: 'http://gateway.test',
      requestTimeoutMs: 1_000,
      crisperWhisperTimeoutMs: 2_000,
    });

    const response = await service.transcribeBuffer({
      buffer: Buffer.from('audio'),
      originalName: 'sample.wav',
      mimetype: 'audio/wav',
      options: { model: CRISPERWHISPER_MODEL },
    });

    expect(axios.post).toHaveBeenCalledWith(
      'http://gateway.test/transcribe',
      expect.anything(),
      expect.objectContaining({ timeout: 2_000 }),
    );
    expect(response.request.options).toEqual(expect.objectContaining({
      model: CRISPERWHISPER_MODEL,
      modelSize: 'large',
    }));
  });
});
