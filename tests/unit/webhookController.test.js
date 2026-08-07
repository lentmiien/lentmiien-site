const mockCheckBatchStatus = jest.fn();
const mockProcessBatchResponses = jest.fn();
const mockSendPushoverNotification = jest.fn();
const mockUnwrapOpenAIWebhook = jest.fn();
const mockHasPendingResponse = jest.fn();
const mockProcessCompletedResponse = jest.fn();
const mockProcessFailedResponse = jest.fn();
const mockVerifyOllamaWebhookToken = jest.fn();
const mockRetrieveChatJob = jest.fn();

jest.mock('../../services/messageService', () => jest.fn());
jest.mock('../../services/conversationService', () => jest.fn().mockImplementation(() => ({
  hasPendingResponse: mockHasPendingResponse,
  processCompletedResponse: mockProcessCompletedResponse,
  processFailedResponse: mockProcessFailedResponse,
})));
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
jest.mock('../../utils/Ollama_API', () => ({
  isValidChatJobId: jest.fn((value) => /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)),
  verifyWebhookToken: mockVerifyOllamaWebhookToken,
  retrieveChatJob: mockRetrieveChatJob,
}));
jest.mock('openai', () => {
  class MockOpenAI {}
  MockOpenAI.InvalidWebhookSignatureError = class InvalidWebhookSignatureError extends Error {};
  return { OpenAI: MockOpenAI };
});

const logger = require('../../utils/logger');
const { emitConversationMessages } = require('../../utils/chat5Realtime');
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

describe('Ollama Gateway webhook notifications', () => {
  const jobId = '02d58123-b2da-4412-8df5-1fbb47bb07cd';

  beforeEach(() => {
    jest.clearAllMocks();
    mockVerifyOllamaWebhookToken.mockReturnValue(true);
    mockHasPendingResponse.mockResolvedValue(true);
    mockRetrieveChatJob.mockResolvedValue({
      job_id: jobId,
      status: 'completed',
      status_url: `/llm/chat/jobs/${jobId}`,
      result: { message: { role: 'assistant', content: 'Local answer' } },
    });
  });

  function createRequest(overrides = {}) {
    return {
      app: { get: jest.fn(() => ({ conversationRoom: jest.fn(), userRoom: jest.fn() })) },
      body: {
        job_id: jobId,
        status: 'completed',
        status_url: `/llm/chat/jobs/${jobId}`,
        completed_at: 1786060814.8,
      },
      query: { token: 'derived-token' },
      ip: '192.0.2.10',
      ...overrides,
    };
  }

  test('rejects an invalid callback token before looking up a job', async () => {
    mockVerifyOllamaWebhookToken.mockReturnValue(false);
    const res = createResponse();

    await controller.ollama(createRequest(), res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockHasPendingResponse).not.toHaveBeenCalled();
    expect(mockRetrieveChatJob).not.toHaveBeenCalled();
  });

  test('rejects malformed callback metadata without retrieving a supplied URL', async () => {
    const res = createResponse();
    const req = createRequest({
      body: {
        job_id: jobId,
        status: 'completed',
        status_url: 'https://attacker.invalid/result',
      },
    });

    await controller.ollama(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockRetrieveChatJob).not.toHaveBeenCalled();
  });

  test('fetches, persists, and broadcasts a completed known job', async () => {
    const conversation = {
      _id: { toString: () => 'conv-local' },
      members: ['Lennart'],
    };
    const messages = [{ _id: { toString: () => 'answer-local' } }];
    mockProcessCompletedResponse.mockResolvedValue({
      conversation,
      messages,
      placeholder_id: 'placeholder-local',
    });
    const req = createRequest();
    const res = createResponse();

    await controller.ollama(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockHasPendingResponse).toHaveBeenCalledWith(jobId, 'Ollama');
    expect(mockRetrieveChatJob).toHaveBeenCalledWith(jobId);
    expect(mockProcessCompletedResponse).toHaveBeenCalledWith(jobId, {
      retrievedResponse: expect.objectContaining({ status: 'completed' }),
      responseProvider: 'Ollama',
    });
    expect(emitConversationMessages).toHaveBeenCalledWith(req.app.get.mock.results[0].value, {
      conversation,
      messages,
      placeholderId: 'placeholder-local',
    });
  });

  test('acknowledges duplicate or raced callbacks without fetching unknown jobs', async () => {
    mockHasPendingResponse.mockResolvedValue(false);
    const res = createResponse();

    await controller.ollama(createRequest(), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(mockRetrieveChatJob).not.toHaveBeenCalled();
    expect(mockProcessCompletedResponse).not.toHaveBeenCalled();
  });

  test('removes and broadcasts the placeholder for a failed job', async () => {
    const conversation = {
      _id: { toString: () => 'conv-failed' },
      members: ['Lennart'],
    };
    mockRetrieveChatJob.mockResolvedValue({
      job_id: jobId,
      status: 'failed',
      status_url: `/llm/chat/jobs/${jobId}`,
      error: { detail: 'The model failed.' },
    });
    mockProcessFailedResponse.mockResolvedValue({
      error_msg: 'The model failed.',
      conversation,
      placeholder_id: 'placeholder-failed',
    });
    const req = createRequest({
      body: {
        job_id: jobId,
        status: 'failed',
        status_url: `/llm/chat/jobs/${jobId}`,
      },
    });

    await controller.ollama(req, createResponse());

    expect(mockProcessFailedResponse).toHaveBeenCalledWith(jobId, {
      retrievedResponse: expect.objectContaining({ status: 'failed' }),
      responseProvider: 'Ollama',
      returnResult: true,
    });
    expect(emitConversationMessages).toHaveBeenCalledWith(req.app.get.mock.results[0].value, {
      conversation,
      messages: [],
      placeholderId: 'placeholder-failed',
    });
  });
});
