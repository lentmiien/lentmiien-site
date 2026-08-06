const mockCheckBatchStatus = jest.fn();
const mockProcessBatchResponses = jest.fn();
const mockSendPushoverNotification = jest.fn();
const mockUnwrapOpenAIWebhook = jest.fn();

jest.mock('../../services/messageService', () => jest.fn());
jest.mock('../../services/conversationService', () => jest.fn());
jest.mock('../../services/knowledgeService', () => jest.fn());
jest.mock('../../services/batchService', () => jest.fn().mockImplementation(() => ({
  checkBatchStatus: mockCheckBatchStatus,
  processBatchResponses: mockProcessBatchResponses,
})));
jest.mock('../../services/audioWorkflowInstance', () => ({
  handleOpenAiResponseCompleted: jest.fn(),
  handleOpenAiResponseFailed: jest.fn(),
}));
jest.mock('../../database', () => ({
  Chat4Model: {},
  Conversation4Model: {},
  Chat4KnowledgeModel: {},
  FileMetaModel: {},
  BatchPromptModel: {},
  BatchRequestModel: {},
  SoraVideo: { findOne: jest.fn() },
}));
jest.mock('../../utils/logger', () => ({
  debug: jest.fn(),
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));
jest.mock('../../utils/chat5Realtime', () => ({
  emitConversationMessages: jest.fn(),
  toClientMessage: jest.fn(),
}));
jest.mock('../../utils/openaiWebhook', () => ({
  unwrapOpenAIWebhook: mockUnwrapOpenAIWebhook,
}));
jest.mock('../../utils/pushover', () => ({
  PUSHOVER_PRIORITIES: { MEDIUM: 0 },
  sendPushoverNotification: mockSendPushoverNotification,
}));
jest.mock('../../utils/OpenAI_API', () => ({
  fetchVideo: jest.fn(),
  checkVideoProgress: jest.fn(),
}));
jest.mock('openai', () => {
  class MockOpenAI {}
  MockOpenAI.InvalidWebhookSignatureError = class InvalidWebhookSignatureError extends Error {};
  return { OpenAI: MockOpenAI };
});

const logger = require('../../utils/logger');
const controller = require('../../controllers/webhook');

function createResponse() {
  const res = {
    send: jest.fn(),
    status: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('OpenAI webhook batch notifications', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUnwrapOpenAIWebhook.mockResolvedValue({
      type: 'batch.completed',
      data: { id: 'batch_123' },
    });
    mockSendPushoverNotification.mockResolvedValue({ status: 1 });
    mockCheckBatchStatus.mockResolvedValue();
    mockProcessBatchResponses.mockResolvedValue({ conversations: [] });
  });

  test('sends a medium-priority Pushover notification for a completed batch', async () => {
    const res = createResponse();
    const req = {
      app: { get: jest.fn(() => undefined) },
      body: '{}',
      headers: {},
    };

    await controller.openai(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockSendPushoverNotification).toHaveBeenCalledWith({
      title: 'OpenAI batch completed',
      message: 'Batch batch_123 completed.',
      priority: 0,
    });
    expect(mockCheckBatchStatus).toHaveBeenCalledWith('batch_123');
    expect(mockProcessBatchResponses).toHaveBeenCalledTimes(1);
  });

  test('continues processing the batch when Pushover delivery fails', async () => {
    mockSendPushoverNotification.mockRejectedValue(new Error('network unavailable'));

    await controller.openai({
      app: { get: jest.fn(() => undefined) },
      body: '{}',
      headers: {},
    }, createResponse());

    expect(logger.error).toHaveBeenCalledWith(
      'Failed to send Pushover notification for completed batch',
      {
        batchId: 'batch_123',
        error: 'network unavailable',
      },
    );
    expect(mockCheckBatchStatus).toHaveBeenCalledWith('batch_123');
    expect(mockProcessBatchResponses).toHaveBeenCalledTimes(1);
  });
});
