const crypto = require('crypto');
const HumanToolRequestService = require('../../services/humanToolRequestService');

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function query(value) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function pendingRequest(overrides = {}) {
  const prompt = overrides.prompt || 'Please deploy and test the change.';
  const toolName = overrides.toolName || 'ask_lennart_for_codex';
  const variant = overrides.variant || 'codex';
  return {
    _id: 'd9428888-122b-4e1b-9bc0-3df042f22d44',
    originKey: 'a'.repeat(64),
    requestHash: hash([toolName, variant, prompt].join('\n')),
    toolName,
    variant,
    prompt,
    response: '',
    status: 'pending',
    conversationId: 'conversation-1',
    responseId: 'response-1',
    toolCallId: 'call-1',
    createdBy: { id: 'admin-1', name: 'Admin' },
    createdAt: new Date('2026-09-05T00:00:00.000Z'),
    ...overrides,
  };
}

function createHarness(overrides = {}) {
  const requestModel = overrides.requestModel || {
    findOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findById: jest.fn(),
    distinct: jest.fn(() => query([])),
    updateOne: jest.fn(() => ({ exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) })),
    updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    countDocuments: jest.fn(() => ({ exec: jest.fn().mockResolvedValue(0) })),
  };
  const pendingModel = overrides.pendingModel || {
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 }),
  };
  return {
    requestModel,
    pendingModel,
    instance: new HumanToolRequestService({
      requestModel,
      pendingModel,
      roleModel: { findOne: jest.fn().mockResolvedValue(null) },
      userModel: {
        findById: jest.fn(() => query({ _id: 'admin-1', name: 'Admin', type_user: 'admin' })),
      },
      appLogger: { error: jest.fn() },
      sleep: jest.fn().mockResolvedValue(),
      ...overrides.options,
    }),
  };
}

const context = {
  user: { _id: 'admin-1', name: 'Admin', type_user: 'admin' },
  toolName: 'ask_lennart_for_codex',
  conversationId: 'conversation-1',
  responseId: 'response-1',
  callId: 'call-1',
};

describe('HumanToolRequestService', () => {
  test('stores a request, marks the outer response as a human wait, and returns the answer', async () => {
    const pending = pendingRequest();
    const responded = pendingRequest({
      status: 'responded',
      response: 'Deployed successfully; the live check passed.',
      respondedAt: new Date('2026-09-05T00:05:00.000Z'),
    });
    const harness = createHarness({
      options: { now: () => new Date('2026-09-05T00:00:00.000Z') },
    });
    harness.requestModel.findOne.mockReturnValue(query(null));
    harness.requestModel.findOneAndUpdate.mockReturnValue(query(pending));
    harness.requestModel.findById.mockReturnValue(query(responded));

    const result = await harness.instance.execute(
      { prompt: pending.prompt },
      context,
      'codex'
    );

    expect(harness.requestModel.findOneAndUpdate).toHaveBeenCalledWith(
      { originKey: expect.stringMatching(/^[a-f0-9]{64}$/) },
      { $setOnInsert: expect.objectContaining({
        prompt: pending.prompt,
        variant: 'codex',
        responseId: 'response-1',
        createdBy: { id: 'admin-1', name: 'Admin' },
      }) },
      expect.objectContaining({ upsert: true })
    );
    expect(harness.pendingModel.updateOne).toHaveBeenCalledWith(
      { response_id: 'response-1', recoveryState: 'pending' },
      { $set: { recoveryState: 'tool_wait' } }
    );
    expect(result).toMatchObject({
      status: 'responded',
      response: 'Deployed successfully; the live check passed.',
      request_url: `/admin/ask-lennart#request-${pending._id}`,
    });
  });

  test('replays the same durable request instead of inserting a duplicate', async () => {
    const responded = pendingRequest({
      status: 'responded',
      response: 'Done.',
      respondedAt: new Date('2026-09-05T00:05:00.000Z'),
    });
    const harness = createHarness();
    harness.requestModel.findOne.mockReturnValue(query(responded));

    await expect(harness.instance.execute(
      { prompt: responded.prompt },
      context,
      'codex'
    )).resolves.toMatchObject({ status: 'responded', response: 'Done.' });
    expect(harness.requestModel.countDocuments).not.toHaveBeenCalled();
    expect(harness.requestModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('rejects a replay whose arguments differ from the stored request', async () => {
    const harness = createHarness();
    harness.requestModel.findOne.mockReturnValue(query(pendingRequest({ prompt: 'Original prompt' })));

    await expect(harness.instance.execute(
      { prompt: 'Changed prompt' },
      context,
      'codex'
    )).rejects.toMatchObject({ statusCode: 409 });
  });

  test('rejects a replay attributed to a different authenticated principal', async () => {
    const foreignAdmin = { _id: 'admin-2', name: 'Other Admin', type_user: 'admin' };
    const harness = createHarness({
      options: {
        userModel: { findById: jest.fn(() => query(foreignAdmin)) },
      },
    });
    harness.requestModel.findOne.mockReturnValue(query(pendingRequest()));

    await expect(harness.instance.execute(
      { prompt: 'Please deploy and test the change.' },
      { ...context, user: foreignAdmin },
      'codex'
    )).rejects.toMatchObject({ statusCode: 409 });
  });

  test('rejects unknown fields and unauthorized users before writing', async () => {
    const harness = createHarness();

    await expect(harness.instance.execute(
      { prompt: 'Question', owner: 'someone-else' },
      context,
      'general'
    )).rejects.toMatchObject({ statusCode: 400 });

    await expect(harness.instance.execute(
      { prompt: 'Question' },
      {
        ...context,
        user: { _id: 'user-1', name: 'User', type_user: 'user' },
      },
      'general'
    )).rejects.toMatchObject({ statusCode: 403 });
    expect(harness.requestModel.findOne).not.toHaveBeenCalled();
  });

  test('answers only a pending UUID request and schedules restart-safe recovery', async () => {
    const respondedAt = new Date('2026-09-05T01:00:00.000Z');
    const request = pendingRequest({
      status: 'responded',
      response: 'Production is updated.',
      respondedAt,
    });
    const harness = createHarness({ options: { now: () => respondedAt } });
    harness.requestModel.findOneAndUpdate.mockReturnValue(query(request));

    await expect(harness.instance.respond(
      request._id,
      ' Production is updated. ',
      { user: context.user }
    )).resolves.toBe(request);

    expect(harness.requestModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: request._id, status: 'pending' },
      { $set: expect.objectContaining({
        response: 'Production is updated.',
        status: 'responded',
        respondedBy: { id: 'admin-1', name: 'Admin' },
      }) },
      { new: true, runValidators: true }
    );
    expect(harness.pendingModel.updateOne).toHaveBeenCalledWith(
      { response_id: 'response-1', recoveryState: 'tool_wait' },
      { $set: {
        recoveryState: 'pending',
        processingStartedAt: null,
        nextCheckAt: new Date('2026-09-05T01:01:00.000Z'),
      } }
    );
  });

  test('conceals malformed and non-pending request ids', async () => {
    const harness = createHarness();

    await expect(harness.instance.respond(
      '../../private',
      'Done.',
      { user: context.user }
    )).rejects.toMatchObject({ statusCode: 404, message: 'Pending request not found.' });
    expect(harness.requestModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('keeps a saved answer successful when the immediate chat wake-up must retry', async () => {
    const request = pendingRequest({ status: 'responded', response: 'Done.' });
    const warning = jest.fn().mockResolvedValue();
    const harness = createHarness({
      pendingModel: {
        updateOne: jest.fn().mockRejectedValue(new Error('temporary database write failure')),
        updateMany: jest.fn(),
      },
      options: { appLogger: { error: jest.fn(), warning } },
    });
    harness.requestModel.findOneAndUpdate.mockReturnValue(query(request));

    await expect(harness.instance.respond(
      request._id,
      'Done.',
      { user: context.user }
    )).resolves.toBe(request);
    expect(warning).toHaveBeenCalledWith(
      'Saved a human tool response but could not wake the waiting chat immediately',
      expect.objectContaining({
        category: 'human_tool_request',
        metadata: expect.objectContaining({ requestId: request._id }),
      })
    );
  });

  test('requeues answered tool waits on startup without touching unanswered waits', async () => {
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([
        { responseId: 'response-answered' },
        { responseId: 'response-answered' },
      ]),
    };
    const harness = createHarness();
    harness.requestModel.find = jest.fn(() => findQuery);

    await expect(harness.instance.recoverInterruptedResponses()).resolves.toEqual({
      expiredCount: 0,
      matchedCount: 1,
      modifiedCount: 1,
    });
    expect(harness.requestModel.updateMany).toHaveBeenCalledWith(
      {
        status: 'pending',
        createdAt: { $lte: expect.any(Date) },
      },
      { $set: expect.objectContaining({
        status: 'timed_out',
        timedOutAt: expect.any(Date),
        deleteAfter: expect.any(Date),
      }) }
    );
    expect(harness.requestModel.find).toHaveBeenCalledWith({
      status: { $in: ['responded', 'timed_out'] },
      responseId: { $nin: ['', null] },
    });
    expect(harness.pendingModel.updateMany).toHaveBeenCalledWith(
      {
        response_id: { $in: ['response-answered'] },
        recoveryState: 'tool_wait',
      },
      { $set: expect.objectContaining({
        recoveryState: 'pending',
        processingStartedAt: null,
      }) }
    );
  });

  test('does not requeue a response while another human call in it is still waiting', async () => {
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ responseId: 'response-shared' }]),
    };
    const harness = createHarness();
    harness.requestModel.find = jest.fn(() => findQuery);
    harness.requestModel.distinct.mockReturnValue(query(['response-shared']));

    await expect(harness.instance.recoverInterruptedResponses()).resolves.toEqual({
      expiredCount: 0,
      matchedCount: 0,
      modifiedCount: 0,
    });
    expect(harness.pendingModel.updateMany).not.toHaveBeenCalled();
  });
});
