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
