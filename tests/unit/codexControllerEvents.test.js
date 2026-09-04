jest.mock('../../services/codexToolService', () => ({
  getTurnDetail: jest.fn(),
  listTurnEventPage: jest.fn(),
  queueAdditionalTurnMessage: jest.fn(),
}));
jest.mock('../../services/codexQueueWorker', () => ({
  getStatus: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  warning: jest.fn(),
}));

const codexToolService = require('../../services/codexToolService');
const codexController = require('../../controllers/codexController');
const logger = require('../../utils/logger');

function responseDouble() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn((payload) => payload),
    render: jest.fn(),
  };
}

describe('Codex turn event APIs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns only the curated activity contract from the default endpoint', async () => {
    codexToolService.listTurnEventPage.mockResolvedValue({
      events: [{
        id: 'event-1',
        seq: 3,
        eventType: 'item.completed',
        stream: 'stdout-json',
        severity: 'info',
        createdAt: '2026-09-04T01:00:03.000Z',
        payload: {
          item: {
            id: 'message-1',
            type: 'agent_message',
            text: 'Finished **successfully**.',
          },
        },
      }],
      total: 42,
      turnStartedAt: '2026-09-04T01:00:00.000Z',
      workspaceRoot: '/workspace',
    });
    const req = {
      params: { turnId: 'turn-1' },
      query: { afterSeq: '2' },
      user: { _id: 'user-1', type_user: 'user' },
    };
    const res = responseDouble();

    await codexController.getTurnEvents(req, res);

    expect(codexToolService.listTurnEventPage).toHaveBeenCalledWith('turn-1', {
      afterSeq: '2',
      limit: undefined,
      user: req.user,
    });
    const payload = res.json.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      ok: true,
      lastSeq: 3,
      counts: {
        activity: 1,
        issues: 0,
        messages: 1,
        actions: 0,
        raw: 42,
      },
    }));
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toEqual(expect.objectContaining({
      id: 'event-1',
      seq: 3,
      category: 'message',
      kind: 'agent_message',
      summary: 'Finished **successfully**.',
    }));
    expect(payload.events[0].details.html).toContain('<strong>successfully</strong>');
    expect(payload.events[0]).not.toHaveProperty('payload');
    expect(payload.events[0]).not.toHaveProperty('text');
    expect(JSON.stringify(payload)).not.toContain('/workspace');
  });

  test('keeps raw payloads behind the separate paginated inspector endpoint', async () => {
    codexToolService.listTurnEventPage.mockResolvedValue({
      events: [{
        id: 'event-raw',
        seq: 80,
        eventType: 'command.output',
        stream: 'stdout-json',
        severity: 'warning',
        text: '/workspace/app.js token=private',
        payload: {
          cwd: '/workspace',
          apiKey: 'private',
          output: 'bounded output',
        },
        createdAt: '2026-09-04T01:01:00.000Z',
      }],
      total: 2001,
      hasMore: true,
      nextBeforeSeq: 80,
      workspaceRoot: '/workspace',
    });
    const req = {
      params: { turnId: 'turn-1' },
      query: { beforeSeq: '100', limit: '50' },
      user: { _id: 'user-1', type_user: 'user' },
    };
    const res = responseDouble();

    await codexController.getRawTurnEvents(req, res);

    expect(codexToolService.listTurnEventPage).toHaveBeenCalledWith('turn-1', {
      beforeSeq: '100',
      limit: '50',
      order: 'desc',
      user: req.user,
    });
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      events: [expect.objectContaining({
        id: 'event-raw',
        seq: 80,
        text: './app.js token=[redacted]',
        payload: {
          cwd: '.',
          apiKey: '[redacted]',
          output: 'bounded output',
        },
      })],
      page: {
        hasMore: true,
        nextBeforeSeq: 80,
        total: 2001,
      },
    });
  });

  test('does not log the account name when an owner-scoped activity read fails', async () => {
    const error = new Error('Turn not found.');
    error.statusCode = 404;
    codexToolService.listTurnEventPage.mockRejectedValueOnce(error);
    const req = {
      params: { turnId: 'turn-private' },
      query: {},
      user: { _id: 'user-1', name: 'Private Account Name', type_user: 'user' },
      originalUrl: '/codex/api/turns/turn-private/events',
    };
    const res = responseDouble();

    await codexController.getTurnEvents(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('Private Account Name');
  });

  test('does not expose or log unexpected infrastructure details', async () => {
    codexToolService.listTurnEventPage.mockRejectedValueOnce(
      new Error('mongodb://private-host/codex?token=private')
    );
    const req = {
      params: { turnId: 'turn-private' },
      query: {},
      user: { _id: 'user-1', name: 'Private Account Name', type_user: 'user' },
      originalUrl: '/codex/api/turns/turn-private/events',
    };
    const res = responseDouble();

    await codexController.getTurnEvents(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      ok: false,
      error: 'Unable to load Codex events.',
    });
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('private-host');
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('Private Account Name');
  });
});

describe('codexController.addTurnMessage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('queues a validated message for the authenticated principal', async () => {
    const result = {
      accepted: true,
      message: { id: 'message-1', status: 'queued' },
    };
    codexToolService.queueAdditionalTurnMessage.mockResolvedValue(result);
    const req = {
      params: { turnId: 'turn-1' },
      body: { message: 'Check the forgotten edge case.' },
      user: { _id: 'user-1', name: 'Lennart', type_user: 'user' },
    };
    const res = responseDouble();

    await codexController.addTurnMessage(req, res);

    expect(codexToolService.queueAdditionalTurnMessage).toHaveBeenCalledWith(
      'turn-1',
      req.body,
      req.user
    );
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).toHaveBeenCalledWith({ ok: true, ...result });
  });

  test('does not put message text or the account name in failure logs', async () => {
    const error = new Error('Message is required.');
    error.statusCode = 400;
    codexToolService.queueAdditionalTurnMessage.mockRejectedValueOnce(error);
    const req = {
      params: { turnId: 'turn-1' },
      body: { message: 'Private correction text' },
      user: { _id: 'user-1', name: 'Private Account Name', type_user: 'user' },
      originalUrl: '/codex/api/turns/turn-1/messages',
    };
    const res = responseDouble();

    await codexController.addTurnMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('Private correction text');
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('Private Account Name');
  });
});
