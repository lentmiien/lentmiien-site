jest.mock('../../services/codexToolService', () => ({
  listTurnEvents: jest.fn(),
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

describe('codexController.getTurnEvents', () => {
  test('adds focused presentation data while preserving the raw event payload', async () => {
    const event = {
      id: 'event-1',
      seq: 3,
      eventType: 'item.completed',
      payload: {
        item: {
          type: 'agent_message',
          text: 'Finished **successfully**.',
        },
      },
    };
    codexToolService.listTurnEvents.mockResolvedValue([event]);
    const req = {
      params: { turnId: 'turn-1' },
      query: { afterSeq: '2', limit: 'all' },
      user: { _id: 'user-1', type_user: 'user' },
    };
    const res = {
      json: jest.fn((payload) => payload),
    };

    await codexController.getTurnEvents(req, res);

    expect(codexToolService.listTurnEvents).toHaveBeenCalledWith('turn-1', {
      afterSeq: '2',
      limit: 'all',
      user: req.user,
    });
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      events: [{
        ...event,
        presentation: {
          itemType: 'agent_message',
          html: '<p>Finished <strong>successfully</strong>.</p>\n',
        },
      }],
    });
    expect(event).not.toHaveProperty('presentation');
  });

  test('adds Markdown presentation data for reasoning events', async () => {
    const event = {
      id: 'event-2',
      seq: 4,
      eventType: 'item.completed',
      payload: {
        item: {
          type: 'reasoning',
          text: 'Inspecting **local-model output**.',
        },
      },
    };
    codexToolService.listTurnEvents.mockResolvedValue([event]);
    const req = {
      params: { turnId: 'turn-1' },
      query: {},
    };
    const res = {
      json: jest.fn((payload) => payload),
    };

    await codexController.getTurnEvents(req, res);

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      events: [{
        ...event,
        presentation: {
          itemType: 'reasoning',
          html: '<p>Inspecting <strong>local-model output</strong>.</p>\n',
        },
      }],
    });
  });

  test('adds normalized file changes for the edited-files summary', async () => {
    const event = {
      id: 'event-3',
      seq: 5,
      eventType: 'item.started',
      payload: {
        item: {
          type: 'file_change',
          changes: [
            { path: '/workspace/app.js', kind: { type: 'update', move_path: null } },
            { path: '/workspace/models/item.js', kind: { type: 'add' } },
          ],
        },
      },
    };
    codexToolService.listTurnEvents.mockResolvedValue([event]);
    const req = {
      params: { turnId: 'turn-1' },
      query: {},
    };
    const res = {
      json: jest.fn((payload) => payload),
    };

    await codexController.getTurnEvents(req, res);

    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      events: [{
        ...event,
        presentation: {
          itemType: 'file_change',
          changes: [
            { path: '/workspace/app.js', kind: 'update' },
            { path: '/workspace/models/item.js', kind: 'add' },
          ],
        },
      }],
    });
  });
});

describe('codexController.addTurnMessage', () => {
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
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn((payload) => payload),
    };

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
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn((payload) => payload),
    };

    await codexController.addTurnMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('Private correction text');
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('Private Account Name');
  });
});
