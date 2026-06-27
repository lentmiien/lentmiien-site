const mockCookingCalendarService = {
  formatDate: jest.fn(),
  getCalendarRange: jest.fn(),
};

jest.mock('../../database', () => {
  const saveMock = jest.fn();
  const Task = jest.fn().mockImplementation(function Task(payload) {
    Object.assign(this, payload);
    this.save = saveMock;
  });
  Task.find = jest.fn();
  Task.__saveMock = saveMock;
  return { Task };
});

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
  notice: jest.fn(),
}));

jest.mock('../../utils/publicTobuyList', () => ({
  PUBLIC_TOBUY_LIST_OWNER: 'Lennart',
  consumePublicTobuyAddQuota: jest.fn(),
}));

jest.mock('../../services/deviceUsageService', () => {
  class DeviceUsageSettingsError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.name = 'DeviceUsageSettingsError';
      this.status = status;
    }
  }

  const DEVICE_USAGE_CATEGORIES = ['learning', 'management', 'entertainment'];
  const DEVICE_USAGE_CATEGORY_LABELS = {
    learning: {
      color: '#2BC8A4',
      en: 'Learning',
      ja: '学習',
      ruleEn: '',
      ruleJa: '',
    },
    management: {
      color: '#62A8FF',
      en: 'Management',
      ja: '管理',
      ruleEn: '',
      ruleJa: '',
    },
    entertainment: {
      color: '#FFB84D',
      en: 'Entertainment',
      ja: '娯楽',
      ruleEn: '',
      ruleJa: '',
    },
  };

  return {
    COMMENT_MAX_LENGTH: 1000,
    DEVICE_USAGE_CATEGORIES,
    DEVICE_USAGE_CATEGORY_LABELS,
    DEVICE_USAGE_TEXT: {
      en: {
        actions: {
          allow: 'Allow',
          learn_first: 'Learn first',
          wait: 'Wait',
        },
      },
      ja: {
        actions: {
          allow: '許可',
          learn_first: '先に学習',
          wait: '待機',
        },
      },
    },
    DeviceUsageSettingsError,
    REWARD_TITLE_MAX_LENGTH: 160,
    addDeviceUsageReward: jest.fn(),
    getDeviceUsageDashboard: jest.fn(),
    normalizeDeviceUsageCategory: jest.fn((value) => {
      const normalized = String(value ?? '').trim().toLowerCase();
      return DEVICE_USAGE_CATEGORIES.includes(normalized) ? normalized : 'entertainment';
    }),
  };
});

jest.mock('../../services/minuteLoggerService', () => ({
  getMinuteLoggerLastKnownLocation: jest.fn(),
}));

jest.mock('../../services/cookingCalendarService', () => jest.fn(() => mockCookingCalendarService));

const { Task } = require('../../database');
const { consumePublicTobuyAddQuota } = require('../../utils/publicTobuyList');
const {
  addDeviceUsageReward,
  getDeviceUsageDashboard,
} = require('../../services/deviceUsageService');
const {
  getMinuteLoggerLastKnownLocation,
} = require('../../services/minuteLoggerService');
const controller = require('../../controllers/publicTobuyListController');

function createFindQuery(payload) {
  return {
    sort: jest.fn().mockReturnValue({
      lean: jest.fn().mockResolvedValue(payload),
    }),
  };
}

function createDeviceUsageDashboard(overrides = {}) {
  return {
    endpointPath: '/secret-device-usage',
    generatedAt: new Date('2026-05-28T00:00:00.000Z'),
    localDateKey: '2026-05-28',
    settings: {
      rollingLimitMinutes: 60,
      rollingWindowMinutes: 90,
      rollingWindowMs: 90 * 60 * 1000,
      learningRequiredMinutes: 30,
      learningFreeMinutes: 30,
      maxVolume: 100,
      updatedAt: null,
      updatedBy: null,
    },
    currentWindowStart: new Date('2026-05-27T22:30:00.000Z'),
    currentCountedMinutes: 42,
    currentLearningMinutes: 12,
    learningRemainingMinutes: 18,
    rollingRemainingMinutes: 18,
    totalStored: 100,
    blockedToday: 0,
    limitTiming: { mode: 'until_limit', minutes: 18 },
    entertainmentUnlocked: false,
    nextEntertainmentAction: 'learn_first',
    nextEntertainmentStatus: 'NG',
    todayStats: {
      totalMinutes: 17,
      countedMinutes: 4,
      blockedMinutes: 1,
      learningMinutes: 12,
      categories: [],
    },
    todayPackageStats: [],
    chartSeries: [],
    dailyStats: [
      {
        dateKey: '2026-05-28',
        isToday: true,
        totalMinutes: 17,
        countedMinutes: 4,
        blockedMinutes: 1,
        learningMinutes: 12,
        categories: [
          {
            category: 'learning',
            totalMinutes: 12,
            allowedMinutes: 12,
            countedMinutes: 0,
            blockedMinutes: 0,
            freeLearningMinutes: 12,
          },
          {
            category: 'entertainment',
            totalMinutes: 5,
            allowedMinutes: 4,
            countedMinutes: 4,
            blockedMinutes: 1,
            freeLearningMinutes: 0,
          },
        ],
      },
    ],
    packageRules: [],
    rewardSuggestions: [],
    recentRewards: [],
    rewardSummary: { points: 5, count: 2 },
    recentRequests: [],
    ...overrides,
  };
}

describe('publicTobuyListController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Task.__saveMock.mockReset();
    getDeviceUsageDashboard.mockResolvedValue(createDeviceUsageDashboard());
    addDeviceUsageReward.mockResolvedValue({});
    getMinuteLoggerLastKnownLocation.mockResolvedValue(null);
    mockCookingCalendarService.formatDate.mockReturnValue('2026-05-28');
    mockCookingCalendarService.getCalendarRange.mockResolvedValue({
      days: [
        {
          date: '2026-05-28',
          weekday: 'Thursday',
          entries: [],
        },
      ],
    });
  });

  test('renderPublicPage loads open Lennart to-buy tasks', async () => {
    Task.find.mockReturnValueOnce(createFindQuery([
      { _id: 'task-1', title: 'Milk' },
      { _id: 'task-2', title: 'Rice' },
    ]));

    const req = {
      query: {},
      baseUrl: '/hidden-path',
      path: '/',
    };
    const res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      render: jest.fn(),
    };

    await controller.renderPublicPage(req, res);

    expect(Task.find).toHaveBeenCalledWith({
      userId: 'Lennart',
      type: 'tobuy',
      done: false,
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.render).toHaveBeenCalledWith('public_tobuy_list', expect.objectContaining({
      pageHeading: '妻のページ',
      taskCount: 2,
      submitPath: '/hidden-path',
      tasks: [
        { id: 'task-1', title: 'Milk' },
        { id: 'task-2', title: 'Rice' },
      ],
      rewardSubmitPath: '/hidden-path/rewards',
      deviceUsageStats: expect.objectContaining({
        rollingUsageCard: expect.objectContaining({
          key: 'rollingUsage',
          value: '残り 18分',
          tone: 'ok',
        }),
        learningGateCard: expect.objectContaining({
          key: 'learningGate',
          value: '学習が残り 18分',
          tone: 'warning',
        }),
        rewardSummary: expect.objectContaining({
          pointsDisplay: '5点',
          countDisplay: '2件',
        }),
        dailyStats: [
          expect.objectContaining({
            dateKey: '2026-05-28',
            isToday: true,
            totalDurationDisplay: '17分',
            categories: expect.arrayContaining([
              expect.objectContaining({
                category: 'learning',
                label: '学習',
                durationDisplay: '12分',
              }),
              expect.objectContaining({
                category: 'entertainment',
                label: '娯楽',
                durationDisplay: '5分',
              }),
            ]),
          }),
        ],
      }),
      todayCooking: expect.objectContaining({
        date: '2026-05-28',
        weekdayDisplay: '木曜日',
        entries: [],
      }),
    }));
    expect(res.locals.pageLang).toBe('ja');
    expect(res.locals.pageTitle).toBe('妻のページ - Lennart\'s Website');
  });

  test('renderPublicPage includes today cooking entries with public image previews', async () => {
    Task.find.mockReturnValueOnce(createFindQuery([]));
    mockCookingCalendarService.getCalendarRange.mockResolvedValueOnce({
      days: [
        {
          date: '2026-05-28',
          weekday: 'Thursday',
          entries: [
            {
              entryId: 'entry-1',
              category: 'Dinner',
              recipe: {
                title: 'Curry',
                image: 'curry.jpg',
                viewPath: '/cooking/cookbook/recipe-1',
              },
            },
          ],
        },
      ],
    });

    const req = {
      query: {},
      baseUrl: '/hidden-path',
      path: '/',
    };
    const res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      render: jest.fn(),
    };

    await controller.renderPublicPage(req, res);

    expect(res.render).toHaveBeenCalledWith('public_tobuy_list', expect.objectContaining({
      todayCooking: expect.objectContaining({
        entries: [
          {
            entryId: 'entry-1',
            category: 'Dinner',
            title: 'Curry',
            imageSrc: '/img/curry.jpg',
          },
        ],
      }),
    }));
  });

  test('renderPublicPage includes only redacted last known location details', async () => {
    Task.find.mockReturnValueOnce(createFindQuery([]));
    getMinuteLoggerLastKnownLocation.mockResolvedValueOnce({
      name: 'Station',
      isApproximate: true,
      deviceId: 'phone-01',
      receivedAt: new Date('2026-05-28T00:00:00.000Z'),
      nearestDistanceMeters: 128,
    });

    const req = {
      query: {},
      baseUrl: '/hidden-path',
      path: '/',
    };
    const res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      render: jest.fn(),
    };

    await controller.renderPublicPage(req, res);

    const renderModel = res.render.mock.calls[0][1];
    expect(renderModel.lastKnownLocation).toEqual({
      name: 'Station',
      isApproximate: true,
      display: 'Stationの近く',
    });
    expect(renderModel.lastKnownLocation).not.toHaveProperty('deviceId');
    expect(renderModel.lastKnownLocation).not.toHaveProperty('receivedAt');
    expect(renderModel.lastKnownLocation).not.toHaveProperty('nearestDistanceMeters');
  });

  test('addPublicDeviceUsageReward saves a reward and redirects back', async () => {
    const body = {
      suggestionId: '',
      titleEn: 'Read aloud',
      points: '3',
      comment: 'Good effort',
    };
    const req = {
      body,
      baseUrl: '/hidden-path',
      path: '/rewards',
    };
    const res = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      render: jest.fn(),
      locals: {},
    };

    await controller.addPublicDeviceUsageReward(req, res);

    expect(addDeviceUsageReward).toHaveBeenCalledWith(body, {
      updatedBy: 'public-tobuy',
    });
    expect(res.redirect).toHaveBeenCalledWith('/hidden-path?reward=1');
  });

  test('addPublicTask saves a trimmed to-buy task for Lennart and redirects back', async () => {
    consumePublicTobuyAddQuota.mockReturnValue({
      allowed: true,
      reason: null,
      retryAfterMs: 0,
      remainingToday: 9,
    });
    Task.__saveMock.mockResolvedValueOnce();

    const req = {
      body: { title: '   Dish soap   ' },
      baseUrl: '/hidden-path',
      path: '/',
    };
    const res = {
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      render: jest.fn(),
      locals: {},
    };

    await controller.addPublicTask(req, res);

    expect(consumePublicTobuyAddQuota).toHaveBeenCalledTimes(1);
    expect(Task).toHaveBeenCalledWith({
      userId: 'Lennart',
      type: 'tobuy',
      title: 'Dish soap',
      description: '',
      start: null,
      end: null,
      done: false,
    });
    expect(Task.__saveMock).toHaveBeenCalledTimes(1);
    expect(res.redirect).toHaveBeenCalledWith('/hidden-path?added=1');
  });

  test('addPublicTask rerenders with rate limit error when quota is exhausted', async () => {
    consumePublicTobuyAddQuota.mockReturnValue({
      allowed: false,
      reason: 'daily_limit',
      retryAfterMs: 1000,
      remainingToday: 0,
    });
    Task.find.mockReturnValueOnce(createFindQuery([{ _id: 'task-1', title: 'Milk' }]));

    const req = {
      body: { title: 'Eggs' },
      query: {},
      baseUrl: '/hidden-path',
      path: '/',
    };
    const res = {
      locals: {},
      status: jest.fn().mockReturnThis(),
      render: jest.fn(),
      redirect: jest.fn(),
    };

    await controller.addPublicTask(req, res);

    expect(Task.__saveMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.render).toHaveBeenCalledWith('public_tobuy_list', expect.objectContaining({
      errorMessage: '今日の共有追加上限に達しました。',
      formTitle: 'Eggs',
    }));
  });
});
