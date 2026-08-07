jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../utils/OpenAI_API', () => ({
  retrieveResponse: jest.fn(),
}));

jest.mock('../../utils/Ollama_API', () => ({
  retrieveChatJob: jest.fn(),
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
  Chat5Model.exists = jest.fn();
  Chat5Model.findOne = jest.fn();

  return {
    Conversation5Model: {
      findById: jest.fn(),
      exists: jest.fn(),
    },
    PendingRequests,
    Chat5Model,
  };
});

const ConversationService = require('../../services/conversationService');
const ai = require('../../utils/OpenAI_API');
const ollama = require('../../utils/Ollama_API');
const { Conversation5Model, PendingRequests, Chat5Model } = require('../../database');

describe('ConversationService response recovery', () => {
  beforeEach(() => {
    Conversation5Model.exists.mockResolvedValue({ _id: 'conversation-reference' });
    Chat5Model.exists.mockResolvedValue({ _id: 'placeholder' });
    Chat5Model.findOne.mockResolvedValue(null);
    PendingRequests.updateOne.mockResolvedValue({ modifiedCount: 1 });
    PendingRequests.deleteOne.mockResolvedValue({ deletedCount: 1 });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('reconcilePendingResponses processes completed and failed responses', async () => {
    const pendingItems = [
      { response_id: 'resp-complete', conversation_id: 'conv-1', placeholder_id: 'ph-1' },
      { response_id: 'resp-failed', conversation_id: 'conv-2', placeholder_id: 'ph-2' },
      { response_id: 'resp-waiting', conversation_id: 'conv-3', placeholder_id: 'ph-3' },
    ];

    PendingRequests.findOneAndUpdate
      .mockResolvedValueOnce(pendingItems[0])
      .mockResolvedValueOnce(pendingItems[1])
      .mockResolvedValueOnce(pendingItems[2])
      .mockResolvedValueOnce(null);

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

    expect(service.processCompletedResponse).toHaveBeenCalledWith('resp-complete', {
      claimedPending: pendingItems[0],
      retrievedResponse: { status: 'completed' },
    });
    expect(service.processFailedResponse).toHaveBeenCalledWith('resp-failed', {
      claimedPending: pendingItems[1],
      retrievedResponse: { status: 'failed' },
    });
    expect(PendingRequests.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        $and: expect.arrayContaining([
          expect.objectContaining({
            $or: expect.arrayContaining([
              { nextCheckAt: { $lte: expect.any(Date) } },
            ]),
          }),
        ]),
      }),
      { $set: { processingStartedAt: expect.any(Date) } },
      expect.objectContaining({
        new: true,
        sort: {
          lastCheckedAt: 1,
          createdAt: -1,
          _id: -1,
        },
      }),
    );
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

  test('reconcilePendingResponses retrieves Ollama jobs with the Gateway client', async () => {
    const pending = {
      _id: 'pending-ollama',
      response_id: '02d58123-b2da-4412-8df5-1fbb47bb07cd',
      provider: 'Ollama',
      conversation_id: 'conv-ollama',
      placeholder_id: 'ph-ollama',
    };
    const retrievedJob = {
      job_id: pending.response_id,
      status: 'completed',
      result: { message: { role: 'assistant', content: 'Local result' } },
    };
    PendingRequests.findOneAndUpdate
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(null);
    ollama.retrieveChatJob.mockResolvedValue(retrievedJob);

    const service = new ConversationService({}, {}, {});
    service.processCompletedResponse = jest.fn().mockResolvedValue({
      conversation: { _id: { toString: () => 'conv-ollama' }, members: [] },
      messages: [],
      placeholder_id: 'ph-ollama',
    });

    const updates = await service.reconcilePendingResponses({ limit: 2 });

    expect(ollama.retrieveChatJob).toHaveBeenCalledWith(pending.response_id);
    expect(ai.retrieveResponse).not.toHaveBeenCalled();
    expect(service.processCompletedResponse).toHaveBeenCalledWith(pending.response_id, {
      claimedPending: pending,
      retrievedResponse: retrievedJob,
    });
    expect(updates).toEqual([
      expect.objectContaining({
        type: 'completed',
        response_id: pending.response_id,
        response_provider: 'Ollama',
      }),
    ]);
  });

  test('reconcilePendingResponses schedules nonterminal responses with persisted backoff state', async () => {
    const now = new Date('2026-07-27T01:00:00.000Z');
    const pending = {
      _id: 'pending-waiting',
      response_id: 'resp-waiting',
      conversation_id: 'conv-waiting',
      placeholder_id: 'ph-waiting',
      createdAt: new Date('2026-07-27T00:40:00.000Z'),
      recoveryAttemptCount: 3,
      lastResponseStatus: 'queued',
    };
    PendingRequests.findOneAndUpdate.mockResolvedValueOnce(pending);
    ai.retrieveResponse.mockResolvedValue({ status: 'in_progress', output: [] });

    const service = new ConversationService({}, {}, {});
    const updates = await service.reconcilePendingResponses({
      limit: 1,
      now,
      policy: { maxAgeMs: 48 * 60 * 60 * 1000, maxAttempts: 50 },
    });

    expect(updates).toEqual([]);
    expect(ai.retrieveResponse).toHaveBeenCalledWith('resp-waiting');
    expect(PendingRequests.updateOne).toHaveBeenCalledWith(
      { _id: 'pending-waiting' },
      {
        $set: expect.objectContaining({
          recoveryState: 'pending',
          recoveryAttemptCount: 4,
          lastCheckedAt: now,
          nextCheckAt: new Date('2026-07-27T01:05:00.000Z'),
          lastResponseStatus: 'in_progress',
          lastRetrievalError: null,
          processingStartedAt: null,
        }),
        $unset: {
          abandonedAt: 1,
          abandonReason: 1,
        },
      },
    );
  });

  test('reconcilePendingResponses backs off retrieval failures instead of immediately retrying them', async () => {
    const now = new Date('2026-07-27T01:00:00.000Z');
    const pending = {
      _id: 'pending-network-error',
      response_id: 'resp-network-error',
      conversation_id: 'conv-network-error',
      placeholder_id: 'ph-network-error',
      createdAt: new Date('2026-07-27T00:55:00.000Z'),
      recoveryAttemptCount: 0,
    };
    PendingRequests.findOneAndUpdate.mockResolvedValueOnce(pending);
    ai.retrieveResponse.mockResolvedValue(null);

    const service = new ConversationService({}, {}, {});
    await service.reconcilePendingResponses({ limit: 1, now });

    expect(PendingRequests.updateOne).toHaveBeenCalledWith(
      { _id: 'pending-network-error' },
      expect.objectContaining({
        $set: expect.objectContaining({
          recoveryAttemptCount: 1,
          nextCheckAt: new Date('2026-07-27T01:01:00.000Z'),
          lastResponseStatus: 'retrieval_error',
          lastRetrievalError: 'OpenAI response retrieval returned no result',
          processingStartedAt: null,
        }),
      }),
    );
  });

  test('reconcilePendingResponses dead-letters an orphan without calling OpenAI', async () => {
    const now = new Date('2026-07-27T01:00:00.000Z');
    const pending = {
      _id: 'pending-orphan',
      response_id: 'resp-orphan',
      conversation_id: 'conv-orphan',
      placeholder_id: 'ph-orphan',
      createdAt: new Date('2026-07-27T00:55:00.000Z'),
      recoveryAttemptCount: 2,
    };
    PendingRequests.findOneAndUpdate.mockResolvedValueOnce(pending);
    Conversation5Model.exists.mockResolvedValue(null);
    Conversation5Model.findById.mockResolvedValue(null);

    const service = new ConversationService({}, {}, {});
    const updates = await service.reconcilePendingResponses({ limit: 1, now });

    expect(ai.retrieveResponse).not.toHaveBeenCalled();
    expect(PendingRequests.updateOne).toHaveBeenCalledWith(
      { _id: 'pending-orphan' },
      {
        $set: expect.objectContaining({
          recoveryState: 'abandoned',
          recoveryAttemptCount: 2,
          nextCheckAt: null,
          abandonedAt: now,
          abandonReason: 'placeholder_missing',
          processingStartedAt: null,
        }),
      },
    );
    expect(updates).toEqual([
      expect.objectContaining({
        type: 'failed',
        response_id: 'resp-orphan',
        status: 'abandoned',
        reason: 'placeholder_missing',
      }),
    ]);
  });

  test('reconcilePendingResponses abandons work older than the age limit and removes its placeholder reference', async () => {
    const now = new Date('2026-07-27T01:00:00.000Z');
    const pending = {
      _id: 'pending-expired',
      response_id: 'resp-expired',
      conversation_id: 'conv-expired',
      placeholder_id: 'ph-expired',
      createdAt: new Date('2026-07-24T23:00:00.000Z'),
      recoveryAttemptCount: 8,
    };
    const conversation = {
      messages: ['user-message', 'ph-expired'],
      save: jest.fn().mockResolvedValue(),
    };
    PendingRequests.findOneAndUpdate.mockResolvedValueOnce(pending);
    Conversation5Model.findById.mockResolvedValue(conversation);

    const service = new ConversationService({}, {}, {});
    const updates = await service.reconcilePendingResponses({
      limit: 1,
      now,
      policy: { maxAgeMs: 48 * 60 * 60 * 1000, maxAttempts: 50 },
    });

    expect(ai.retrieveResponse).not.toHaveBeenCalled();
    expect(conversation.messages).toEqual(['user-message']);
    expect(conversation.save).toHaveBeenCalledTimes(1);
    expect(updates[0]).toEqual(expect.objectContaining({
      status: 'abandoned',
      reason: 'max_age_exceeded',
    }));
  });

  test('reconcilePendingResponses enforces the recovery attempt limit', async () => {
    const now = new Date('2026-07-27T01:00:00.000Z');
    const pending = {
      _id: 'pending-attempt-limit',
      response_id: 'resp-attempt-limit',
      conversation_id: 'conv-attempt-limit',
      placeholder_id: 'ph-attempt-limit',
      createdAt: new Date('2026-07-27T00:58:00.000Z'),
      recoveryAttemptCount: 0,
    };
    PendingRequests.findOneAndUpdate.mockResolvedValueOnce(pending);
    Conversation5Model.findById.mockResolvedValue(null);
    ai.retrieveResponse.mockResolvedValue({ status: 'queued', output: [] });

    const service = new ConversationService({}, {}, {});
    const updates = await service.reconcilePendingResponses({
      limit: 1,
      now,
      policy: { maxAgeMs: 48 * 60 * 60 * 1000, maxAttempts: 1 },
    });

    expect(ai.retrieveResponse).toHaveBeenCalledTimes(1);
    expect(PendingRequests.updateOne).toHaveBeenCalledWith(
      { _id: 'pending-attempt-limit' },
      {
        $set: expect.objectContaining({
          recoveryState: 'abandoned',
          recoveryAttemptCount: 1,
          abandonReason: 'max_attempts_exceeded',
        }),
      },
    );
    expect(updates[0]).toEqual(expect.objectContaining({
      status: 'abandoned',
      reason: 'max_attempts_exceeded',
    }));
  });

  test('fetchPending returns only active pending conversation IDs', async () => {
    PendingRequests.find.mockResolvedValue([
      { conversation_id: 'conv-active-1' },
      { conversation_id: null },
      { conversation_id: 'conv-active-2' },
    ]);

    const service = new ConversationService({}, {}, {});
    const conversationIds = await service.fetchPending();

    expect(PendingRequests.find).toHaveBeenCalledWith({
      $or: [
        { recoveryState: 'pending' },
        { recoveryState: null },
        { recoveryState: { $exists: false } },
      ],
    });
    expect(conversationIds).toEqual(['conv-active-1', 'conv-active-2']);
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

  test('processCompletedResponse reuses a response already retrieved by recovery', async () => {
    const pending = {
      _id: 'pending-retrieved',
      response_id: 'resp-retrieved',
      conversation_id: 'conv-retrieved',
      placeholder_id: 'ph-retrieved',
    };
    const conversation = {
      messages: ['ph-retrieved'],
      save: jest.fn().mockResolvedValue(),
    };
    const retrievedResponse = {
      status: 'completed',
      output: [{ type: 'message' }],
    };
    const messageService = {
      processCompletedResponse: jest.fn().mockResolvedValue([]),
    };
    Conversation5Model.findById.mockResolvedValue(conversation);

    const service = new ConversationService({}, messageService, {});
    await service.processCompletedResponse('resp-retrieved', {
      claimedPending: pending,
      retrievedResponse,
    });

    expect(PendingRequests.findOneAndUpdate).not.toHaveBeenCalled();
    expect(messageService.processCompletedResponse).toHaveBeenCalledWith(
      conversation,
      'resp-retrieved',
      retrievedResponse,
    );
  });

  test('processCompletedResponse claims and converts an Ollama job with its provider context', async () => {
    const jobId = '02d58123-b2da-4412-8df5-1fbb47bb07cd';
    const pending = {
      _id: 'pending-local-complete',
      response_id: jobId,
      provider: 'Ollama',
      conversation_id: 'conv-local-complete',
      placeholder_id: 'ph-local-complete',
      toolRound: 1,
    };
    const conversation = {
      messages: ['ph-local-complete'],
      save: jest.fn().mockResolvedValue(),
    };
    const savedMessage = {
      _id: { toString: () => 'local-answer' },
      contentType: 'text',
    };
    const job = {
      job_id: jobId,
      status: 'completed',
      result: { message: { role: 'assistant', content: 'Local answer' } },
    };
    PendingRequests.findOneAndUpdate.mockResolvedValue(pending);
    Conversation5Model.findById.mockResolvedValue(conversation);
    const messageService = {
      processCompletedResponse: jest.fn().mockResolvedValue([savedMessage]),
    };
    const service = new ConversationService({}, messageService, {});

    await service.processCompletedResponse(jobId, {
      retrievedResponse: job,
      responseProvider: 'Ollama',
    });

    expect(PendingRequests.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      response_id: jobId,
      provider: 'Ollama',
    });
    expect(messageService.processCompletedResponse).toHaveBeenCalledWith(
      conversation,
      jobId,
      job,
      'Ollama',
    );
    expect(conversation.messages).toEqual(['local-answer']);
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
      metadata: { tools: ['demo_tool'] },
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

  test('Ollama tool follow-ups remain background jobs and increment the round guard', async () => {
    const jobId = '22d58123-b2da-4412-8df5-1fbb47bb07cd';
    const pending = {
      _id: 'pending-local-tools',
      response_id: jobId,
      provider: 'Ollama',
      conversation_id: 'conv-local-tools',
      placeholder_id: 'ph-local-old',
      toolRound: 1,
    };
    const conversation = {
      _id: { toString: () => 'conv-local-tools' },
      category: 'Chat5',
      tags: ['chat5'],
      members: ['Lennart'],
      messages: ['user-local', 'ph-local-old'],
      save: jest.fn().mockResolvedValue(),
    };
    const functionCallMessage = {
      _id: { toString: () => 'fc-local' },
      contentType: 'function_call',
      content: { toolName: 'demo_tool', toolCallId: 'call-local' },
    };
    const functionOutputMessage = {
      _id: { toString: () => 'output-local' },
      contentType: 'function_call_output',
    };
    const nextPlaceholder = {
      _id: { toString: () => 'ph-local-next' },
      contentType: 'text',
      content: { text: 'Pending response' },
    };
    PendingRequests.findOneAndUpdate.mockResolvedValue(pending);
    Conversation5Model.findById.mockResolvedValue(conversation);
    const messageService = {
      processCompletedResponse: jest.fn().mockResolvedValue([functionCallMessage]),
      generateAIMessage: jest.fn().mockResolvedValue({
        response_id: '32d58123-b2da-4412-8df5-1fbb47bb07cd',
        response_provider: 'Ollama',
        msg: nextPlaceholder,
      }),
    };
    const service = new ConversationService({}, messageService, {});
    service.executeFunctionCallsForConversation = jest.fn().mockResolvedValue([functionOutputMessage]);

    await service.processCompletedResponse(jobId, { responseProvider: 'Ollama' });

    expect(messageService.generateAIMessage).toHaveBeenCalledWith({
      conversation: expect.objectContaining({
        messages: ['user-local', 'fc-local', 'output-local'],
      }),
      includeLastToolBatch: true,
    });
    expect(PendingRequests).toHaveBeenCalledWith({
      response_id: '32d58123-b2da-4412-8df5-1fbb47bb07cd',
      conversation_id: 'conv-local-tools',
      placeholder_id: 'ph-local-next',
      provider: 'Ollama',
      toolRound: 2,
    });
  });

  test('function calls cannot execute tools that were not selected for the conversation', async () => {
    const conversation = {
      _id: { toString: () => 'conv-tool-safety' },
      category: 'Chat5',
      tags: ['chat5'],
      members: ['Lennart'],
      metadata: { tools: [] },
    };
    const functionCallMessage = {
      contentType: 'function_call',
      content: {
        toolCallId: 'call-unselected',
        callId: 'call-unselected',
        toolName: 'dangerous_tool',
        arguments: '{}',
      },
    };
    const service = new ConversationService({}, {}, {});
    service.toolManagerService = {
      executeToolCall: jest.fn(),
      formatToolResultForOpenAI: jest.fn((toolCall, result) => ({
        type: 'function_call_output',
        call_id: toolCall.call_id,
        output: JSON.stringify(result),
      })),
    };

    const outputs = await service.executeFunctionCallsForConversation(conversation, [functionCallMessage]);

    expect(service.toolManagerService.executeToolCall).not.toHaveBeenCalled();
    expect(outputs[0]).toMatchObject({
      contentType: 'function_call_output',
      content: expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('was not selected'),
      }),
    });
  });

  test('a retried callback reuses a saved tool output instead of repeating the side effect', async () => {
    const existingOutput = {
      _id: { toString: () => 'existing-function-output' },
      contentType: 'function_call_output',
    };
    Chat5Model.findOne.mockResolvedValue(existingOutput);
    const service = new ConversationService({}, {}, {});
    service.toolManagerService = {
      executeToolCall: jest.fn(),
      formatToolResultForOpenAI: jest.fn(),
    };

    const outputs = await service.executeFunctionCallsForConversation({
      _id: { toString: () => 'conv-tool-retry' },
      members: ['Lennart'],
      metadata: { tools: ['demo_tool'] },
    }, [{
      contentType: 'function_call',
      content: {
        responseId: '72d58123-b2da-4412-8df5-1fbb47bb07cd',
        toolCallId: 'call-retry',
        callId: 'call-retry',
        toolName: 'demo_tool',
        arguments: '{}',
      },
    }]);

    expect(Chat5Model.findOne).toHaveBeenCalledWith({
      contentType: 'function_call_output',
      'content.responseId': '72d58123-b2da-4412-8df5-1fbb47bb07cd',
      'content.callId': 'call-retry',
    });
    expect(service.toolManagerService.executeToolCall).not.toHaveBeenCalled();
    expect(outputs).toEqual([existingOutput]);
  });

  test('Ollama tool execution stops before a fifth background round', async () => {
    const jobId = '42d58123-b2da-4412-8df5-1fbb47bb07cd';
    const pending = {
      _id: 'pending-local-limit',
      response_id: jobId,
      provider: 'Ollama',
      conversation_id: 'conv-local-limit',
      placeholder_id: 'ph-local-limit',
      toolRound: 4,
    };
    const conversation = {
      _id: { toString: () => 'conv-local-limit' },
      category: 'Chat5',
      tags: ['chat5'],
      members: ['Lennart'],
      messages: ['ph-local-limit'],
      save: jest.fn().mockResolvedValue(),
    };
    const functionCallMessage = {
      _id: { toString: () => 'fc-local-limit' },
      contentType: 'function_call',
      content: { toolName: 'demo_tool', toolCallId: 'call-limit' },
    };
    PendingRequests.findOneAndUpdate.mockResolvedValue(pending);
    Conversation5Model.findById.mockResolvedValue(conversation);
    const messageService = {
      processCompletedResponse: jest.fn().mockResolvedValue([functionCallMessage]),
      generateAIMessage: jest.fn(),
    };
    const service = new ConversationService({}, messageService, {});
    service.executeFunctionCallsForConversation = jest.fn();

    const result = await service.processCompletedResponse(jobId, { responseProvider: 'Ollama' });

    expect(service.executeFunctionCallsForConversation).not.toHaveBeenCalled();
    expect(messageService.generateAIMessage).not.toHaveBeenCalled();
    expect(result.toolLoopLimited).toBe(true);
    expect(result.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        contentType: 'text',
        content: expect.objectContaining({ text: expect.stringContaining('4 consecutive tool rounds') }),
      }),
    ]));
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
