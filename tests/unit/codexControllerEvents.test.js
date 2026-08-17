jest.mock('../../services/codexToolService', () => ({
  listTurnEvents: jest.fn(),
}));
jest.mock('../../services/codexQueueWorker', () => ({
  getStatus: jest.fn(),
}));
jest.mock('../../utils/logger', () => ({
  warning: jest.fn(),
}));

const codexToolService = require('../../services/codexToolService');
const codexController = require('../../controllers/codexController');

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
    };
    const res = {
      json: jest.fn((payload) => payload),
    };

    await codexController.getTurnEvents(req, res);

    expect(codexToolService.listTurnEvents).toHaveBeenCalledWith('turn-1', {
      afterSeq: '2',
      limit: 'all',
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
            { path: '/workspace/app.js', kind: 'update' },
            { path: '/workspace/models/item.js', kind: 'add' },
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
