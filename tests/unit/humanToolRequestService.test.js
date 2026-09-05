const crypto = require('crypto');
const HumanToolRequestService = require('../../services/humanToolRequestService');
const { sendPushoverNotification } = require('../../utils/pushover');

jest.mock('../../utils/pushover', () => ({
  ...jest.requireActual('../../utils/pushover'),
  sendPushoverNotification: jest.fn().mockResolvedValue({ status: 1 }),
}));

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
      appLogger: { error: jest.fn(), warning: jest.fn().mockResolvedValue() },
      env: {},
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
    harness.requestModel.findOneAndUpdate.mockReturnValue(query({
      value: pending,
      lastErrorObject: { updatedExisting: false, upserted: pending._id },
    }));
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
      expect.objectContaining({ upsert: true, includeResultMetadata: true })
    );
    expect(harness.pendingModel.updateOne).toHaveBeenCalledWith(
      { response_id: 'response-1', recoveryState: 'pending' },
      { $set: { recoveryState: 'tool_wait' } }
    );
    expect(sendPushoverNotification).toHaveBeenCalledTimes(1);
    expect(sendPushoverNotification).toHaveBeenCalledWith({
      title: 'New Ask Lennart request',
      message: `Codex workflow request is pending your response. Open Ask Lennart to review and respond: https://my.lentmiien.com/admin/ask-lennart#request-${pending._id}`,
      priority: 1,
    });
    expect(result).toMatchObject({
      status: 'responded',
      response: 'Deployed successfully; the live check passed.',
      request_url: `/admin/ask-lennart#request-${pending._id}`,
    });
  });

  test.each(['general', 'codex'])('notifies once after saving a new %s request with safe context', async (variant) => {
    const pending = pendingRequest({ variant, toolName: `ask_lennart${variant === 'codex' ? '_for_codex' : ''}` });
    const harness = createHarness({ options: { env: { PUBLIC_APP_BASE_URL: 'https://example.com/base?private=value' } } });
    let finishSave;
    const saved = new Promise((resolve) => { finishSave = resolve; });
    harness.requestModel.findOne.mockReturnValue(query(null));
    harness.requestModel.findOneAndUpdate.mockReturnValue(saved);
    const creation = harness.instance.createOrFindRequest({
      prompt: pending.prompt, variant, toolName: pending.toolName,
      identity: { originKey: pending.originKey }, principal: context.user,
    });
    await new Promise(setImmediate);
    expect(sendPushoverNotification).not.toHaveBeenCalled();
    finishSave({ value: pending, lastErrorObject: { updatedExisting: false, upserted: pending._id } });
    await expect(creation).resolves.toBe(pending);
    expect(sendPushoverNotification).toHaveBeenCalledTimes(1);
    expect(sendPushoverNotification).toHaveBeenCalledWith({
      title: 'New Ask Lennart request',
      message: `${variant === 'codex' ? 'Codex workflow' : 'General'} request is pending your response. Open Ask Lennart to review and respond: https://example.com/admin/ask-lennart#request-${pending._id}`,
      priority: 1,
    });
    const payload = JSON.stringify(sendPushoverNotification.mock.calls);
    for (const privateValue of [pending.prompt, pending.conversationId, pending.responseId, pending.toolCallId, pending.createdBy.name, 'private=value']) {
      expect(payload).not.toContain(privateValue);
    }
  });

  test.each(['existing', 'matched upsert', 'duplicate key'])('resumes a pending wait without notifying: %s', async (scenario) => {
    const pending = pendingRequest();
    const harness = createHarness({ options: { now: () => pending.createdAt } });
    harness.requestModel.findOne.mockReturnValue(query(pending));
    if (scenario !== 'existing') {
      harness.requestModel.findOne.mockReturnValueOnce(query(null));
      if (scenario === 'duplicate key') {
        harness.requestModel.findOneAndUpdate.mockRejectedValue({ code: 11000 });
      } else {
        harness.requestModel.findOneAndUpdate.mockReturnValue(query({
          value: pending, lastErrorObject: { updatedExisting: true },
        }));
      }
    }
    harness.requestModel.findById
      .mockReturnValueOnce(query(pending))
      .mockReturnValue(query({ ...pending, status: 'responded', response: 'Done.' }));
    await expect(harness.instance.execute({ prompt: pending.prompt }, context, 'codex'))
      .resolves.toMatchObject({ status: 'responded', response: 'Done.' });
    expect(harness.requestModel.updateOne).toHaveBeenCalled();
    expect(sendPushoverNotification).not.toHaveBeenCalled();
  });

  test.each(['rejection', 'synchronous throw', 'logger failure'])('preserves saved request and answer delivery after notification %s', async (failure) => {
    const pending = pendingRequest();
    const notificationSender = jest.fn(() => {
      const error = new Error('private provider payload and credentials');
      if (failure === 'synchronous throw') throw error;
      return Promise.reject(error);
    });
    const warning = failure === 'logger failure'
      ? jest.fn().mockRejectedValue(new Error('logger unavailable'))
      : jest.fn().mockResolvedValue();
    const harness = createHarness({ options: {
      now: () => pending.createdAt, notificationSender, appLogger: { warning },
    } });
    harness.requestModel.findOne.mockReturnValue(query(null));
    harness.requestModel.findOneAndUpdate.mockReturnValue(query({
      value: pending, lastErrorObject: { updatedExisting: false, upserted: pending._id },
    }));
    harness.requestModel.findById.mockReturnValue(query({ ...pending, status: 'responded', response: 'Done.' }));
    await expect(harness.instance.execute({ prompt: pending.prompt }, context, 'codex'))
      .resolves.toMatchObject({ status: 'responded', response: 'Done.' });
    expect(harness.pendingModel.updateOne).toHaveBeenCalledWith(
      { response_id: pending.responseId, recoveryState: 'pending' },
      { $set: { recoveryState: 'tool_wait' } }
    );
    expect(warning).toHaveBeenCalledWith(
      'Saved a human tool request but could not send its Pushover notification',
      { category: 'human_tool_request', metadata: { requestId: pending._id, errorName: 'Error' } }
    );
    // Replaying the saved request after failure does not retry the notification.
    harness.requestModel.findOne.mockReturnValue(query(pending));
    await harness.instance.execute({ prompt: pending.prompt }, context, 'codex');
    expect(notificationSender).toHaveBeenCalledTimes(1);
  });

  test('only the winning concurrent creator notifies', async () => {
    const pending = pendingRequest();
    const harness = createHarness();
    harness.requestModel.findOne.mockReturnValue(query(null));
    harness.requestModel.findOneAndUpdate
      .mockReturnValueOnce(query({
        value: pending, lastErrorObject: { updatedExisting: false, upserted: pending._id },
      }))
      .mockReturnValueOnce(query({
        value: pending, lastErrorObject: { updatedExisting: true },
      }));
    const args = {
      prompt: pending.prompt, variant: pending.variant, toolName: pending.toolName,
      identity: { originKey: pending.originKey }, principal: context.user,
    };
    await expect(Promise.all([
      harness.instance.createOrFindRequest(args),
      harness.instance.createOrFindRequest(args),
    ])).resolves.toEqual([pending, pending]);
    expect(harness.requestModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(sendPushoverNotification).toHaveBeenCalledTimes(1);
  });

  test('does not notify when saving fails', async () => {
    const harness = createHarness();
    harness.requestModel.findOne.mockReturnValue(query(null));
    harness.requestModel.findOneAndUpdate.mockRejectedValue(new Error('database unavailable'));
    await expect(harness.instance.execute({ prompt: 'Question' }, context, 'general'))
      .rejects.toThrow('database unavailable');
    expect(sendPushoverNotification).not.toHaveBeenCalled();
    expect(harness.pendingModel.updateOne).not.toHaveBeenCalled();
  });

  test.each(['not a URL', 'javascript:alert(1)', 'https://username:secret@example.com'])('keeps invalid link configuration out of notifications: %s', async (baseUrl) => {
    const pending = pendingRequest();
    const harness = createHarness({ options: { env: { PUBLIC_APP_BASE_URL: baseUrl }, now: () => pending.createdAt } });
    harness.requestModel.findOne.mockReturnValue(query(null));
    harness.requestModel.findOneAndUpdate.mockReturnValue(query({
      value: pending, lastErrorObject: { updatedExisting: false, upserted: pending._id },
    }));
    harness.requestModel.findById.mockReturnValue(query({ ...pending, status: 'responded' }));
    await expect(harness.instance.execute({ prompt: pending.prompt }, context, 'codex'))
      .resolves.toMatchObject({ status: 'responded' });
    expect(sendPushoverNotification).not.toHaveBeenCalled();
    expect(harness.instance.logger.warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(harness.instance.logger.warning.mock.calls)).not.toContain(baseUrl);
  });

  test('refreshing the admin inbox does not notify', async () => {
    const harness = createHarness();
    harness.requestModel.find = jest.fn(() => ({
      sort: jest.fn().mockReturnThis(), limit: jest.fn().mockReturnThis(), ...query([]),
    }));
    await harness.instance.listForAdmin({ user: context.user });
    await harness.instance.listForAdmin({ user: context.user });
    expect(sendPushoverNotification).not.toHaveBeenCalled();
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
    expect(sendPushoverNotification).not.toHaveBeenCalled();
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
    expect(sendPushoverNotification).not.toHaveBeenCalled();
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
    expect(sendPushoverNotification).not.toHaveBeenCalled();
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
    expect(sendPushoverNotification).not.toHaveBeenCalled();
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
