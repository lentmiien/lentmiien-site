jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  warning: jest.fn(),
}));

const { CodexQueueWorker } = require('../../services/codexQueueWorker');
const CodexTurn = require('../../models/codex_turn');
const CodexEvent = require('../../models/codex_event');
const CodexTurnMessage = require('../../models/codex_turn_message');
const logger = require('../../utils/logger');

function createFindQuery(value) {
  return {
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createFindOneAndUpdateQuery(value) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createUpdateQuery(value = { modifiedCount: 1 }) {
  return {
    exec: jest.fn().mockResolvedValue(value),
  };
}

describe('CodexQueueWorker additional messages', () => {
  let runner;
  let worker;
  let active;

  beforeEach(() => {
    jest.clearAllMocks();
    runner = {
      sendAdditionalMessage: jest.fn().mockResolvedValue({ accepted: true }),
    };
    worker = new CodexQueueWorker({
      runner,
      ollamaReservation: {
        getStatus: jest.fn().mockReturnValue({ held: false }),
      },
    });
    worker.getConfig = jest.fn().mockReturnValue({
      maxAdditionalMessagesPerTurn: 20,
    });
    active = {
      turn: {
        _id: 'turn-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
        modelProvider: 'openai',
        createdBy: { id: 'user-1' },
      },
      workspace: { rootPath: '/workspace/project' },
      target: { type: 'local-linux' },
      onEvent: jest.fn().mockResolvedValue({ stored: true, count: 4 }),
      codexThreadId: 'thread-1',
      codexTurnId: 'codex-turn-1',
      processStarted: true,
      acceptingMessages: true,
      deliveryPromise: null,
    };
    worker.activeTurns.set('turn-1', active);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('delivers a queued message and records it as a user-message detail event', async () => {
    const queuedMessage = {
      _id: 'message-1',
      turnId: 'turn-1',
      message: 'Check the forgotten edge case.',
      status: 'queued',
    };
    jest.spyOn(CodexTurnMessage, 'find').mockReturnValue(createFindQuery([queuedMessage]));
    jest.spyOn(CodexTurnMessage, 'findOneAndUpdate')
      .mockReturnValue(createFindOneAndUpdateQuery({ ...queuedMessage, status: 'delivering' }));
    jest.spyOn(CodexTurnMessage, 'updateOne').mockReturnValue(createUpdateQuery());
    jest.spyOn(CodexTurn, 'updateOne').mockReturnValue(createUpdateQuery());

    await expect(worker.deliverPendingAdditionalMessages('turn-1')).resolves.toBe(true);

    expect(runner.sendAdditionalMessage).toHaveBeenCalledWith({
      turn: active.turn,
      workspace: active.workspace,
      target: active.target,
      threadId: 'thread-1',
      expectedTurnId: 'codex-turn-1',
      messageId: 'message-1',
      message: 'Check the forgotten edge case.',
    });
    expect(active.onEvent).toHaveBeenCalledWith({
      stream: 'system',
      eventType: 'user.message.sent',
      payload: {
        item: {
          type: 'user_message',
          text: 'Check the forgotten edge case.',
        },
        deliveryStatus: 'delivered',
        ownerId: 'user-1',
      },
      text: '',
      severity: 'info',
      hiddenByDefault: false,
    });
    expect(CodexTurn.updateOne).toHaveBeenCalledWith(
      { _id: 'turn-1' },
      { $set: { eventCount: 4 } }
    );
  });

  test('marks a rejected message failed without logging its contents', async () => {
    const queuedMessage = {
      _id: 'message-private',
      turnId: 'turn-1',
      message: 'Private correction text',
      status: 'queued',
    };
    runner.sendAdditionalMessage.mockRejectedValue(new Error('Private correction text leaked'));
    jest.spyOn(CodexTurnMessage, 'find').mockReturnValue(createFindQuery([queuedMessage]));
    jest.spyOn(CodexTurnMessage, 'findOneAndUpdate')
      .mockReturnValue(createFindOneAndUpdateQuery({ ...queuedMessage, status: 'delivering' }));
    jest.spyOn(CodexTurnMessage, 'updateOne').mockReturnValue(createUpdateQuery());
    jest.spyOn(CodexTurn, 'updateOne').mockReturnValue(createUpdateQuery());

    await expect(worker.deliverPendingAdditionalMessages('turn-1')).resolves.toBe(false);

    expect(CodexTurnMessage.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'message-private', status: 'delivering' }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'failed',
          errorMessage: 'Codex did not accept the additional message.',
        }),
      })
    );
    expect(active.onEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'user.message.failed',
      severity: 'error',
    }));
    expect(logger.warning).toHaveBeenCalledWith(
      'Codex additional message delivery failed',
      expect.objectContaining({
        category: 'codex_tool',
        metadata: expect.objectContaining({ messageId: 'message-private' }),
      })
    );
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('Private correction text');
  });

  test('waits until the running process has reported the active Codex turn id', async () => {
    active.codexTurnId = '';
    const findSpy = jest.spyOn(CodexTurnMessage, 'find');

    await expect(worker.deliverPendingAdditionalMessages('turn-1')).resolves.toBe(false);

    expect(findSpy).not.toHaveBeenCalled();
    expect(runner.sendAdditionalMessage).not.toHaveBeenCalled();
  });

  test('keeps oversized user-message details structured when clipping their text', async () => {
    worker.getConfig.mockReturnValue({ maxEventTextChars: 1000 });
    const createSpy = jest.spyOn(CodexEvent, 'create').mockResolvedValue({});

    await worker.recordEvent(active.turn, 7, {
      stream: 'system',
      eventType: 'user.message.sent',
      payload: {
        item: { type: 'user_message', text: 'x'.repeat(2000) },
        deliveryStatus: 'delivered',
        ownerId: 'user-1',
      },
      severity: 'info',
      hiddenByDefault: false,
    });

    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
      seq: 7,
      payload: expect.objectContaining({
        item: expect.objectContaining({
          type: 'user_message',
          text: expect.stringContaining('[output truncated]'),
        }),
        deliveryStatus: 'delivered',
        ownerId: 'user-1',
      }),
    }));
  });
});
