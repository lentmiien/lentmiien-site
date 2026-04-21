jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/OpenAI_API', () => ({
  retrieveResponse: jest.fn(),
}));

jest.mock('../../database', () => ({
  Conversation5Model: {
    findById: jest.fn(),
  },
  PendingRequests: {
    find: jest.fn(),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn(),
    deleteOne: jest.fn(),
  },
  Chat5Model: jest.fn(function chat5Ctor(doc) {
    this._id = { toString: () => 'chat5-generated' };
    this.save = jest.fn().mockResolvedValue({ _id: this._id, ...doc });
    return this;
  }),
}));

const ConversationService = require('../../services/conversationService');
const ai = require('../../utils/OpenAI_API');
const { Conversation5Model, PendingRequests } = require('../../database');

describe('ConversationService response recovery', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('reconcilePendingResponses processes completed and failed responses', async () => {
    const pendingItems = [
      { response_id: 'resp-complete', conversation_id: 'conv-1', placeholder_id: 'ph-1' },
      { response_id: 'resp-failed', conversation_id: 'conv-2', placeholder_id: 'ph-2' },
      { response_id: 'resp-waiting', conversation_id: 'conv-3', placeholder_id: 'ph-3' },
    ];

    PendingRequests.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        limit: jest.fn().mockResolvedValue(pendingItems),
      }),
    });

    ai.retrieveResponse
      .mockResolvedValueOnce({ status: 'completed' })
      .mockResolvedValueOnce({ status: 'failed' })
      .mockResolvedValueOnce({ status: 'in_progress' });

    const service = new ConversationService({}, {}, {});
    service.processCompletedResponse = jest.fn().mockResolvedValue({
      conversation: { _id: { toString: () => 'conv-1' }, members: [] },
      messages: [{ _id: { toString: () => 'msg-1' } }],
      placeholder_id: 'ph-1',
    });
    service.processFailedResponse = jest.fn().mockResolvedValue('model error');

    const updates = await service.reconcilePendingResponses({ limit: 5 });

    expect(service.processCompletedResponse).toHaveBeenCalledWith('resp-complete');
    expect(service.processFailedResponse).toHaveBeenCalledWith('resp-failed');
    expect(updates).toEqual([
      {
        type: 'completed',
        response_id: 'resp-complete',
        conversation: { _id: { toString: expect.any(Function) }, members: [] },
        messages: [{ _id: { toString: expect.any(Function) } }],
        placeholder_id: 'ph-1',
      },
      {
        type: 'failed',
        response_id: 'resp-failed',
        conversation_id: 'conv-2',
        placeholder_id: 'ph-2',
        error_msg: 'model error',
        status: 'failed',
      },
    ]);
  });

  test('processCompletedResponse claims and removes pending request after saving messages', async () => {
    const pending = {
      _id: 'pending-1',
      response_id: 'resp-1',
      conversation_id: 'conv-1',
      placeholder_id: 'ph-1',
    };
    const conversation = {
      messages: ['user-1', 'ph-1'],
      save: jest.fn().mockResolvedValue(),
    };
    const savedMessage = {
      _id: { toString: () => 'msg-1' },
    };

    PendingRequests.findOneAndUpdate.mockResolvedValue(pending);
    Conversation5Model.findById.mockResolvedValue(conversation);

    const messageService = {
      processCompletedResponse: jest.fn().mockResolvedValue([savedMessage]),
    };
    const service = new ConversationService({}, messageService, {});

    const result = await service.processCompletedResponse('resp-1');

    expect(PendingRequests.findOneAndUpdate).toHaveBeenCalledTimes(1);
    expect(PendingRequests.deleteOne).toHaveBeenCalledWith({ _id: 'pending-1' });
    expect(conversation.messages).toEqual(['user-1', 'msg-1']);
    expect(result).toEqual({
      conversation,
      messages: [savedMessage],
      placeholder_id: 'ph-1',
    });
  });

  test('processCompletedResponse releases claim when persistence fails', async () => {
    const pending = {
      _id: 'pending-2',
      response_id: 'resp-2',
      conversation_id: 'conv-2',
      placeholder_id: 'ph-2',
    };
    const conversation = {
      messages: ['ph-2'],
      save: jest.fn().mockResolvedValue(),
    };

    PendingRequests.findOneAndUpdate.mockResolvedValue(pending);
    Conversation5Model.findById.mockResolvedValue(conversation);

    const messageService = {
      processCompletedResponse: jest.fn().mockRejectedValue(new Error('persist failed')),
    };
    const service = new ConversationService({}, messageService, {});

    await expect(service.processCompletedResponse('resp-2')).rejects.toThrow('persist failed');
    expect(PendingRequests.updateOne).toHaveBeenCalledWith(
      { _id: 'pending-2' },
      { $set: { processingStartedAt: null } },
    );
  });
});
