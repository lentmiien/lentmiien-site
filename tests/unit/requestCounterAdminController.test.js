jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
}));

jest.mock('../../services/incomingRequestCounterService', () => ({
  RequestCounterSettingsError: class RequestCounterSettingsError extends Error {},
  getRequestCounterDashboard: jest.fn(),
  updateRequestCounterSettings: jest.fn(),
}));

const counterService = require('../../services/incomingRequestCounterService');
const controller = require('../../controllers/requestCounterAdminController');

function createResponse() {
  return {
    render: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
}

function createDashboard(overrides = {}) {
  return {
    endpointPath: '/secret-counter',
    generatedAt: new Date('2026-05-28T00:00:00.000Z'),
    settings: {
      maxRequests: 120,
      windowMinutes: 90,
      windowMs: 90 * 60 * 1000,
      updatedAt: new Date('2026-05-27T23:00:00.000Z'),
      updatedBy: 'admin-user',
    },
    currentWindowStart: new Date('2026-05-27T22:30:00.000Z'),
    currentCount: 42,
    totalStored: 100,
    blockedInWindow: 3,
    remaining: 78,
    limitTiming: { mode: 'until_max', minutes: 78 },
    nextDecision: 'OK',
    chartSeries: [],
    dailyMinuteStats: [],
    recentRequests: [],
    ...overrides,
  };
}

describe('requestCounterAdminController.dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('formats daily minute stats as hours and minutes', async () => {
    counterService.getRequestCounterDashboard.mockResolvedValue(createDashboard({
      dailyMinuteStats: [
        {
          dateKey: '2026-05-27',
          totalMinutes: 63,
          okMinutes: 60,
          ngMinutes: 3,
        },
      ],
    }));
    const res = createResponse();

    await controller.dashboard({ query: {} }, res);

    expect(res.render).toHaveBeenCalledWith(
      'admin_request_counter',
      expect.objectContaining({
        dailyMinuteStats: [
          expect.objectContaining({
            totalDurationDisplay: '1 hour 3 minutes',
            okDurationDisplay: '1 hour',
            ngDurationDisplay: '3 minutes',
          }),
        ],
      })
    );
  });

  test('uses projected limit timing in the Current Minutes card', async () => {
    counterService.getRequestCounterDashboard.mockResolvedValue(createDashboard({
      limitTiming: { mode: 'until_max', minutes: 84 },
    }));
    const res = createResponse();

    await controller.dashboard({ query: {} }, res);

    expect(res.render).toHaveBeenCalledWith(
      'admin_request_counter',
      expect.objectContaining({
        overviewCards: expect.arrayContaining([
          expect.objectContaining({
            label: 'Current Minutes',
            helper: '84 min until max',
          }),
        ]),
      })
    );
  });

  test('formats infinite Current Minutes timing when max exceeds the window', async () => {
    counterService.getRequestCounterDashboard.mockResolvedValue(createDashboard({
      limitTiming: { mode: 'infinite', minutes: null },
    }));
    const res = createResponse();

    await controller.dashboard({ query: {} }, res);

    expect(res.render).toHaveBeenCalledWith(
      'admin_request_counter',
      expect.objectContaining({
        overviewCards: expect.arrayContaining([
          expect.objectContaining({
            label: 'Current Minutes',
            helper: '∞ until max',
          }),
        ]),
      })
    );
  });

  test('formats Current Minutes timing below max while blocked', async () => {
    counterService.getRequestCounterDashboard.mockResolvedValue(createDashboard({
      currentCount: 121,
      remaining: 0,
      limitTiming: { mode: 'until_below_max', minutes: 7 },
      nextDecision: 'NG',
    }));
    const res = createResponse();

    await controller.dashboard({ query: {} }, res);

    expect(res.render).toHaveBeenCalledWith(
      'admin_request_counter',
      expect.objectContaining({
        overviewCards: expect.arrayContaining([
          expect.objectContaining({
            label: 'Current Minutes',
            helper: '7 min until below max',
            tone: 'danger',
          }),
        ]),
      })
    );
  });
});
