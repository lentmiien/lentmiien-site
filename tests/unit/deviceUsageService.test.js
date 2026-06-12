const {
  CATEGORY_ENTERTAINMENT,
  CATEGORY_LEARNING,
  CATEGORY_MANAGEMENT,
  calculateDeviceUsageLimitTiming,
  normalizeDevicePackageName,
  normalizeDeviceUsageCategory,
  recordAndEvaluateDeviceUsage,
} = require('../../services/deviceUsageService');

function createLeanQuery(result) {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  return { lean, exec };
}

function createFindChain(result) {
  const leanQuery = createLeanQuery(result);
  const select = jest.fn().mockReturnValue(leanQuery);
  const sort = jest.fn().mockReturnValue({ select });
  return { sort, select, leanQuery };
}

function createFindOneChain(result) {
  const leanQuery = createLeanQuery(result);
  const sort = jest.fn().mockReturnValue(leanQuery);
  return { sort, leanQuery };
}

function createRequest(overrides = {}) {
  return {
    baseUrl: '/secret-device',
    originalUrl: '/secret-device?package=com.example.app',
    method: 'GET',
    ip: '203.0.113.20',
    ips: ['203.0.113.20'],
    query: { package: 'com.example.app' },
    get: jest.fn((name) => {
      const headers = {
        'user-agent': 'device-client/1.0',
        referer: 'https://example.test/',
      };
      return headers[name.toLowerCase()];
    }),
    ...overrides,
  };
}

function buildModels({
  packageRule = null,
  learningMinutes = 0,
  countedRows = [],
  existingMinute = null,
} = {}) {
  const existingMinuteChain = createFindOneChain(existingMinute);
  const countedChain = createFindChain(countedRows);

  return {
    requestModel: {
      findOne: jest.fn().mockReturnValue({ sort: existingMinuteChain.sort }),
      find: jest.fn().mockReturnValue({ sort: countedChain.sort }),
      countDocuments: jest.fn().mockResolvedValue(learningMinutes),
      create: jest.fn().mockResolvedValue({}),
    },
    packageRuleModel: {
      findOne: jest.fn().mockReturnValue(createLeanQuery(packageRule)),
    },
    rewardModel: {
      aggregate: jest.fn().mockResolvedValue([]),
    },
    chains: {
      countedChain,
      existingMinuteChain,
    },
  };
}

function buildCountedRows(count, now = new Date('2026-05-27T00:00:00.000Z')) {
  return Array.from({ length: count }, (_, index) => ({
    receivedAt: new Date(now.getTime() - ((count - index) * 60 * 1000)),
  }));
}

const settings = {
  rollingLimitMinutes: 60,
  rollingWindowMinutes: 90,
  learningRequiredMinutes: 30,
  learningFreeMinutes: 30,
};

describe('device usage service', () => {
  test('normalizes packages and unknown categories', () => {
    expect(normalizeDevicePackageName('  COM.Example.App  ')).toBe('com.example.app');
    expect(normalizeDevicePackageName('')).toBe('unknown');
    expect(normalizeDeviceUsageCategory('not-real')).toBe(CATEGORY_ENTERTAINMENT);
  });

  test('blocks entertainment until the daily learning requirement is complete', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel } = buildModels({
      learningMinutes: 29,
      countedRows: [],
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest(), {
      requestModel,
      packageRuleModel,
      rewardModel,
      now,
      settings,
    });

    expect(result.responsePayload).toMatchObject({
      status: 'NG',
      allowed: false,
      action: 'learn_first',
      reasonCode: 'learning_required',
      package: {
        name: 'com.example.app',
        category: CATEGORY_ENTERTAINMENT,
        known: false,
      },
      usage: {
        countsTowardLimit: false,
        learning: {
          todayMinutes: 29,
          remainingMinutes: 1,
          entertainmentUnlocked: false,
        },
      },
    });
    expect(requestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      packageName: 'com.example.app',
      packageCategory: CATEGORY_ENTERTAINMENT,
      countsTowardLimit: false,
      allowed: false,
      action: 'learn_first',
      reasonCode: 'learning_required',
    }));
  });

  test('allows the first 30 learning minutes outside the rolling limit', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel } = buildModels({
      packageRule: {
        packageName: 'com.learning.app',
        category: CATEGORY_LEARNING,
        active: true,
      },
      learningMinutes: 29,
      countedRows: buildCountedRows(60, now),
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest({
      originalUrl: '/secret-device?package=com.learning.app',
      query: { package: 'com.learning.app' },
    }), {
      requestModel,
      packageRuleModel,
      rewardModel,
      now,
      settings,
    });

    expect(result.responsePayload).toMatchObject({
      status: 'OK',
      allowed: true,
      action: 'allow',
      reasonCode: 'free_learning',
      usage: {
        countsTowardLimit: false,
        freeLearningMinute: true,
        learning: {
          todayMinutesBefore: 29,
          todayMinutes: 30,
          remainingMinutes: 0,
          entertainmentUnlocked: true,
        },
        rolling: {
          countedMinutesBefore: 60,
          countedMinutes: 60,
        },
      },
    });
    expect(requestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      packageCategory: CATEGORY_LEARNING,
      freeLearningMinute: true,
      countsTowardLimit: false,
      allowed: true,
    }));
  });

  test('counts learning after the free daily learning block', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel } = buildModels({
      packageRule: {
        packageName: 'com.learning.app',
        category: CATEGORY_LEARNING,
        active: true,
      },
      learningMinutes: 30,
      countedRows: buildCountedRows(59, now),
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest({
      originalUrl: '/secret-device?package=com.learning.app',
      query: { package: 'com.learning.app' },
    }), {
      requestModel,
      packageRuleModel,
      rewardModel,
      now,
      settings,
    });

    expect(result.responsePayload).toMatchObject({
      status: 'OK',
      reasonCode: 'allowed',
      usage: {
        countsTowardLimit: true,
        freeLearningMinute: false,
        rolling: {
          countedMinutesBefore: 59,
          countedMinutes: 60,
          remainingMinutes: 0,
        },
      },
    });
    expect(requestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      countsTowardLimit: true,
      allowed: true,
      countedMinutesInWindowAfter: 60,
    }));
  });

  test('blocks entertainment when the counted rolling window is full', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel } = buildModels({
      learningMinutes: 30,
      countedRows: buildCountedRows(60, now),
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest(), {
      requestModel,
      packageRuleModel,
      rewardModel,
      now,
      settings,
    });

    expect(result.responsePayload).toMatchObject({
      status: 'NG',
      allowed: false,
      action: 'wait',
      reasonCode: 'rolling_limit',
      usage: {
        countsTowardLimit: false,
        rolling: {
          countedMinutesBefore: 60,
          countedMinutes: 60,
          remainingMinutes: 0,
        },
      },
    });
    expect(requestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      allowed: false,
      countsTowardLimit: false,
      reasonCode: 'rolling_limit',
    }));
  });

  test('allows management packages regardless of learning and rolling limits', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel } = buildModels({
      packageRule: {
        packageName: 'com.parent.settings',
        category: CATEGORY_MANAGEMENT,
        active: true,
        labelEn: 'Settings',
      },
      learningMinutes: 0,
      countedRows: buildCountedRows(60, now),
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest({
      originalUrl: '/secret-device?package=com.parent.settings',
      query: { package: 'com.parent.settings' },
    }), {
      requestModel,
      packageRuleModel,
      rewardModel,
      now,
      settings,
    });

    expect(result.responsePayload).toMatchObject({
      status: 'OK',
      allowed: true,
      reasonCode: 'management_ignored',
      package: {
        category: CATEGORY_MANAGEMENT,
        known: true,
        labelEn: 'Settings',
      },
      usage: {
        countsTowardLimit: false,
        rolling: {
          countedMinutesBefore: 60,
          countedMinutes: 60,
        },
      },
    });
  });

  test('returns the first logged response without saving another same-minute report', async () => {
    const { requestModel, packageRuleModel, rewardModel } = buildModels({
      existingMinute: {
        allowed: false,
        responseStatusCode: 200,
        statusText: 'NG',
        responsePayload: {
          version: 1,
          status: 'NG',
          allowed: false,
          action: 'learn_first',
          reasonCode: 'learning_required',
        },
      },
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest(), {
      requestModel,
      packageRuleModel,
      rewardModel,
      now: new Date('2026-05-27T00:00:30.000Z'),
      settings,
    });

    expect(result).toMatchObject({
      allowed: false,
      responseStatusCode: 200,
      duplicate: true,
      logged: false,
    });
    expect(result.responsePayload.reasonCode).toBe('learning_required');
    expect(requestModel.countDocuments).not.toHaveBeenCalled();
    expect(requestModel.create).not.toHaveBeenCalled();
  });

  test('calculateDeviceUsageLimitTiming reports time until below the rolling limit', () => {
    const now = new Date('2026-05-27T00:10:00.000Z');
    const timing = calculateDeviceUsageLimitTiming(
      [
        new Date('2026-05-27T00:05:30.000Z'),
        new Date('2026-05-27T00:06:30.000Z'),
        new Date('2026-05-27T00:07:30.000Z'),
      ],
      { rollingLimitMinutes: 3, rollingWindowMinutes: 5 },
      now
    );

    expect(timing).toEqual({
      mode: 'until_below_limit',
      minutes: 1,
    });
  });
});
