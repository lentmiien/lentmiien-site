jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  error: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
}));


jest.mock('../../services/messageService', () => jest.fn().mockImplementation(() => ({})));

jest.mock('../../database', () => ({
  AudioWorkflowJob: {},
  AudioWorkflowTrigger: {},
  AsrJob: {},
  Conversation5Model: {},
  Chat5Model: {},
  PendingRequests: {},
  Chat4Model: {},
  FileMetaModel: {},
}));

const fs = require('fs/promises');
const path = require('path');
const AudioWorkflowService = require('../../services/audioWorkflowService');

function createFindChain(items) {
  return {
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(items),
    }),
  };
}

describe('AudioWorkflowService', () => {
  test('findBestTrigger picks the most specific matching trigger', async () => {
    const triggers = [
      {
        _id: 'generic',
        enabled: true,
        name: 'Generic assistant',
        shouldInclude: ['assistant'],
        shouldNotInclude: [],
      },
      {
        _id: 'weather',
        enabled: true,
        name: 'Weather assistant',
        shouldInclude: ['assistant', 'weather'],
        shouldNotInclude: ['ignore'],
      },
    ];
    const triggerModel = {
      find: jest.fn().mockReturnValue(createFindChain(triggers)),
    };
    const service = new AudioWorkflowService({
      triggerModel,
      ttsService: {},
      asrApiService: {},
      messageService: {},
      jobModel: {},
      asrJobModel: {},
      conversationModel: {},
      chatModel: {},
      pendingModel: {},
    });

    const match = await service.findBestTrigger('Assistant, please check the weather.');

    expect(match._id).toBe('weather');
  });

  test('findBestTrigger excludes blocked phrases', async () => {
    const triggers = [
      {
        _id: 'blocked',
        enabled: true,
        name: 'Blocked',
        shouldInclude: ['assistant', 'weather'],
        shouldNotInclude: ['ignore'],
      },
      {
        _id: 'fallback',
        enabled: true,
        name: 'Fallback',
        shouldInclude: ['assistant'],
        shouldNotInclude: [],
      },
    ];
    const triggerModel = {
      find: jest.fn().mockReturnValue(createFindChain(triggers)),
    };
    const service = new AudioWorkflowService({
      triggerModel,
      ttsService: {},
      asrApiService: {},
      messageService: {},
      jobModel: {},
      asrJobModel: {},
      conversationModel: {},
      chatModel: {},
      pendingModel: {},
    });

    const match = await service.findBestTrigger('Assistant, ignore the weather request.');

    expect(match._id).toBe('fallback');
  });

  test('renderTemplate replaces transcript and job placeholders', () => {
    const output = AudioWorkflowService.renderTemplate(
      'Job {{job_id}} from {device_id}: {{transcript}}',
      { job_id: 'job-1', device_id: 'room-pi-01', transcript: 'hello' },
    );

    expect(output).toBe('Job job-1 from room-pi-01: hello');
  });

  test('resolveTtsVoiceId uses supported detected-language defaults', () => {
    expect(AudioWorkflowService.resolveTtsVoiceId({
      detectedLanguage: 'en',
      triggerVoiceId: 'piper_en_amy',
    })).toBe('piper_en_amy');
    expect(AudioWorkflowService.resolveTtsVoiceId({
      detectedLanguage: 'jp',
      triggerVoiceId: 'piper_en_amy',
    })).toBe('ja_shikoku_metan_amaama');
    expect(AudioWorkflowService.resolveTtsVoiceId({
      detectedLanguage: 'ja',
      triggerVoiceId: '',
    })).toBe('ja_shikoku_metan_amaama');
    expect(AudioWorkflowService.resolveTtsVoiceId({
      detectedLanguage: 'sv',
      triggerVoiceId: null,
    })).toBe('piper_sv');
    expect(AudioWorkflowService.resolveTtsVoiceId({
      detectedLanguage: 'unknown',
      triggerVoiceId: null,
    })).toBe('piper_en_amy');
  });

  test('resolveTtsVoiceId keeps a custom trigger voice override', () => {
    expect(AudioWorkflowService.resolveTtsVoiceId({
      detectedLanguage: 'jp',
      triggerVoiceId: 'custom_voice',
    })).toBe('custom_voice');
  });

  test('isSupportedTranscriptionLanguage only allows English, Japanese, and Swedish', () => {
    expect(AudioWorkflowService.isSupportedTranscriptionLanguage('en')).toBe(true);
    expect(AudioWorkflowService.isSupportedTranscriptionLanguage('en-US')).toBe(true);
    expect(AudioWorkflowService.isSupportedTranscriptionLanguage('ja')).toBe(true);
    expect(AudioWorkflowService.isSupportedTranscriptionLanguage('ja-JP')).toBe(true);
    expect(AudioWorkflowService.isSupportedTranscriptionLanguage('jp')).toBe(true);
    expect(AudioWorkflowService.isSupportedTranscriptionLanguage('sv-SE')).toBe(true);
    expect(AudioWorkflowService.isSupportedTranscriptionLanguage('de')).toBe(false);
    expect(AudioWorkflowService.isSupportedTranscriptionLanguage('unknown')).toBe(false);
    expect(AudioWorkflowService.isSupportedTranscriptionLanguage(null)).toBe(false);
  });

  test('finalizeLlmText uses detected-language default voice for legacy trigger defaults', async () => {
    const job = {
      _id: 'job-tts',
      detectedLanguage: 'jp',
      llm: {},
      matchedTriggerId: 'trigger-1',
      save: jest.fn().mockResolvedValue(),
    };
    const jobModel = {
      findById: jest.fn().mockResolvedValue(job),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };
    const triggerModel = {
      findById: jest.fn().mockResolvedValue({
        _id: 'trigger-1',
        ttsEnabled: true,
        ttsVoiceId: 'piper_en_amy',
        ttsFormat: 'wav',
      }),
    };
    const ttsService = {
      synthesize: jest.fn().mockResolvedValue({
        fileName: 'output.wav',
        contentType: 'audio/wav',
        voiceId: 'ja_shikoku_metan_amaama',
        format: 'wav',
        size: 123,
      }),
    };
    const service = new AudioWorkflowService({
      jobModel,
      triggerModel,
      ttsService,
      asrApiService: {},
      messageService: {},
      asrJobModel: {},
      conversationModel: {},
      chatModel: {},
      pendingModel: {},
    });
    service.kickQueue = jest.fn();

    await service.finalizeLlmText('job-tts', 'hello', 'message-1');

    expect(ttsService.synthesize).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello',
      voiceId: 'ja_shikoku_metan_amaama',
      format: 'wav',
    }));
    const finalUpdate = jobModel.updateOne.mock.calls[jobModel.updateOne.mock.calls.length - 1][1];
    expect(finalUpdate.$set.status).toBe('completed');
    expect(finalUpdate.$set.outputAudio.voiceId).toBe('ja_shikoku_metan_amaama');
  });

  test('processClaimedJob deletes empty-transcript jobs, ASR records, and uploaded audio', async () => {
    const storedFileName = `audio-workflow-empty-${Date.now()}.webm`;
    const storedPath = path.resolve(__dirname, '..', '..', 'public', 'audio', storedFileName);
    await fs.mkdir(path.dirname(storedPath), { recursive: true });
    await fs.writeFile(storedPath, Buffer.from('noise'));

    const job = {
      _id: 'empty-job',
      inputAudio: {
        originalName: 'noise.webm',
        storedFileName,
        storedPath,
        publicUrl: `/audio/${storedFileName}`,
        mimeType: 'audio/webm',
        sizeBytes: 5,
      },
      owner: {},
      sampleRate: null,
      save: jest.fn().mockResolvedValue(),
    };
    const asrJob = {
      _id: 'asr-empty',
      storedFileName,
      storedPath,
    };
    const jobModel = {
      findById: jest.fn().mockResolvedValue(job),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      updateOne: jest.fn(),
    };
    const asrJobModel = {
      create: jest.fn().mockResolvedValue(asrJob),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    const asrApiService = {
      transcribeBuffer: jest.fn().mockResolvedValue({
        data: { text: '', language: 'jp', duration: 0 },
        request: { options: { task: 'transcribe' } },
      }),
    };
    const service = new AudioWorkflowService({
      jobModel,
      asrJobModel,
      asrApiService,
      triggerModel: {},
      ttsService: {},
      messageService: {},
      conversationModel: {},
      chatModel: {},
      pendingModel: {},
    });
    service.kickQueue = jest.fn();

    try {
      await service.processClaimedJob('empty-job');

      expect(asrJobModel.create).toHaveBeenCalled();
      expect(asrJobModel.deleteOne).toHaveBeenCalledWith({ _id: 'asr-empty' });
      expect(jobModel.deleteOne).toHaveBeenCalledWith({ _id: 'empty-job' });
      await expect(fs.stat(storedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.unlink(storedPath).catch(() => {});
    }
  });

  test('processClaimedJob deletes unsupported-language jobs, ASR records, and uploaded audio', async () => {
    const storedFileName = `audio-workflow-unsupported-${Date.now()}.webm`;
    const storedPath = path.resolve(__dirname, '..', '..', 'public', 'audio', storedFileName);
    await fs.mkdir(path.dirname(storedPath), { recursive: true });
    await fs.writeFile(storedPath, Buffer.from('voice'));

    const job = {
      _id: 'unsupported-job',
      inputAudio: {
        originalName: 'voice.webm',
        storedFileName,
        storedPath,
        publicUrl: `/audio/${storedFileName}`,
        mimeType: 'audio/webm',
        sizeBytes: 5,
      },
      owner: {},
      sampleRate: null,
      save: jest.fn().mockResolvedValue(),
    };
    const asrJob = {
      _id: 'asr-unsupported',
      storedFileName,
      storedPath,
    };
    const jobModel = {
      findById: jest.fn().mockResolvedValue(job),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      updateOne: jest.fn(),
    };
    const asrJobModel = {
      create: jest.fn().mockResolvedValue(asrJob),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    const asrApiService = {
      transcribeBuffer: jest.fn().mockResolvedValue({
        data: { text: 'Guten Tag', language: 'de', duration: 1 },
        request: { options: { task: 'transcribe' } },
      }),
    };
    const triggerModel = {
      find: jest.fn(),
    };
    const service = new AudioWorkflowService({
      jobModel,
      asrJobModel,
      asrApiService,
      triggerModel,
      ttsService: {},
      messageService: {},
      conversationModel: {},
      chatModel: {},
      pendingModel: {},
    });
    service.kickQueue = jest.fn();

    try {
      await service.processClaimedJob('unsupported-job');

      expect(job.detectedLanguage).toBe('de');
      expect(asrJobModel.create).toHaveBeenCalled();
      expect(asrJobModel.deleteOne).toHaveBeenCalledWith({ _id: 'asr-unsupported' });
      expect(jobModel.deleteOne).toHaveBeenCalledWith({ _id: 'unsupported-job' });
      expect(triggerModel.find).not.toHaveBeenCalled();
      await expect(fs.stat(storedPath)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await fs.unlink(storedPath).catch(() => {});
    }
  });

  test('getJobStatus returns completed for missing jobs', async () => {
    const jobModel = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(null),
      }),
    };
    const service = new AudioWorkflowService({
      jobModel,
      triggerModel: {},
      ttsService: {},
      asrApiService: {},
      messageService: {},
      asrJobModel: {},
      conversationModel: {},
      chatModel: {},
      pendingModel: {},
    });

    const status = await service.getJobStatus('deleted-job');

    expect(status).toMatchObject({
      job_id: 'deleted-job',
      status: 'completed',
      transcribed_text: '',
      output_audio_id: null,
      error: null,
    });
  });

  test('drainQueue does not start another job while a workflow is active', async () => {
    const jobModel = {
      exists: jest.fn().mockResolvedValue({ _id: 'active-job' }),
      findOneAndUpdate: jest.fn(),
    };
    const service = new AudioWorkflowService({
      jobModel,
      triggerModel: {},
      ttsService: {},
      asrApiService: {},
      messageService: {},
      asrJobModel: {},
      conversationModel: {},
      chatModel: {},
      pendingModel: {},
    });

    await service.drainQueue();

    expect(jobModel.exists).toHaveBeenCalledWith({
      status: { $in: ['processing_asr', 'waiting_for_llm', 'processing_tts'] },
    });
    expect(jobModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
