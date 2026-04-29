jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/OpenAI_API', () => ({
  retrieveResponse: jest.fn(),
}));

jest.mock('../../database', () => {
  const PendingRequests = jest.fn(function pendingCtor(doc) {
    Object.assign(this, doc);
    this._id = 'pending-generated';
    this.save = jest.fn().mockResolvedValue(this);
    return this;
  });
  PendingRequests.find = jest.fn();
  PendingRequests.findOneAndUpdate = jest.fn();
  PendingRequests.updateOne = jest.fn();
  PendingRequests.deleteOne = jest.fn();

  const Chat5Model = jest.fn(function chat5Ctor(doc) {
    Object.assign(this, doc);
    this._id = { toString: () => 'chat5-generated' };
    this.save = jest.fn().mockResolvedValue(this);
    return this;
  });
  Chat5Model.deleteOne = jest.fn().mockResolvedValue({ deletedCount: 1 });

  return {
    Conversation5Model: {
      findById: jest.fn(),
    },
    PendingRequests,
    Chat5Model,
  };
});

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

  test('processCompletedResponse executes function calls and queues follow-up response', async () => {
    const pending = {
      _id: 'pending-tools',
      response_id: 'resp-tools',
      conversation_id: 'conv-tools',
      placeholder_id: 'ph-old',
    };
    const conversation = {
      _id: { toString: () => 'conv-tools' },
      category: 'Chat5',
      tags: ['chat5'],
      members: ['Lennart'],
      messages: ['user-1', 'ph-old'],
      save: jest.fn().mockResolvedValue(),
    };
    const functionCallMessage = {
      _id: { toString: () => 'fc-msg' },
      contentType: 'function_call',
      content: {
        toolCallId: 'fc_123',
        callId: 'call_123',
        toolName: 'demo_tool',
        raw: {
          type: 'function_call',
          id: 'fc_123',
          call_id: 'call_123',
          name: 'demo_tool',
          arguments: '{"prompt":"hello"}',
        },
      },
    };
    const followUpPlaceholder = {
      _id: { toString: () => 'ph-next' },
      contentType: 'text',
      content: { text: 'Pending response' },
    };

    PendingRequests.findOneAndUpdate.mockResolvedValue(pending);
    Conversation5Model.findById.mockResolvedValue(conversation);

    const messageService = {
      processCompletedResponse: jest.fn().mockResolvedValue([functionCallMessage]),
      generateAIMessage: jest.fn().mockResolvedValue({
        response_id: 'resp-follow',
        msg: followUpPlaceholder,
      }),
    };
    const service = new ConversationService({}, messageService, {});
    service.toolManagerService = {
      executeToolCall: jest.fn().mockResolvedValue({
        ok: true,
        tool: 'demo_tool',
        toolCallId: 'fc_123',
        callId: 'call_123',
        result: { ok: true, answer: 42 },
      }),
      formatToolResultForOpenAI: jest.fn((toolCall, result) => ({
        type: 'function_call_output',
        call_id: toolCall.call_id,
        output: JSON.stringify(result),
      })),
    };

    const result = await service.processCompletedResponse('resp-tools');

    expect(service.toolManagerService.executeToolCall).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'demo_tool', call_id: 'call_123' }),
      expect.objectContaining({ conversationId: 'conv-tools', userName: 'Lennart' })
    );
    expect(messageService.generateAIMessage).toHaveBeenCalledWith({
      conversation: expect.objectContaining({ messages: ['user-1', 'fc-msg', 'chat5-generated'] }),
      includeLastToolBatch: true,
    });
    expect(PendingRequests).toHaveBeenCalledWith({
      response_id: 'resp-follow',
      conversation_id: 'conv-tools',
      placeholder_id: 'ph-next',
    });
    expect(conversation.messages).toEqual(['user-1', 'fc-msg', 'chat5-generated', 'ph-next']);
    expect(result.messages.map(m => m.contentType)).toEqual(['function_call', 'function_call_output', 'text']);
    expect(PendingRequests.deleteOne).toHaveBeenCalledWith({ _id: 'pending-tools' });
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
