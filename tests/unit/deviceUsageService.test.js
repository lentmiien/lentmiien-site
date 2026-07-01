const {
  CATEGORY_ENTERTAINMENT,
  CATEGORY_LEARNING,
  CATEGORY_MANAGEMENT,
  DEVICE_USAGE_DEFAULT_MAX_VOLUME,
  addManualStudyMinutes,
  calculateDeviceUsageLimitTiming,
  getDeviceUsageSettings,
  normalizeDevicePackageName,
  normalizeDeviceUsageCategory,
  recordAndEvaluateDeviceUsage,
  updateDeviceUsageSettings,
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
  gateState = null,
} = {}) {
  const existingMinuteChain = createFindOneChain(existingMinute);
  const countedChain = createFindChain(countedRows);
  const resolvedGateState = gateState || null;

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
    gateStateModel: {
      findOne: jest.fn().mockReturnValue(createLeanQuery(resolvedGateState)),
      findOneAndUpdate: jest.fn(),
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
  homeworkGateEnabled: false,
  maxVolume: 100,
};

describe('device usage service', () => {
  test('normalizes packages and unknown categories', () => {
    expect(normalizeDevicePackageName('  COM.Example.App  ')).toBe('com.example.app');
    expect(normalizeDevicePackageName('')).toBe('unknown');
    expect(normalizeDeviceUsageCategory('not-real')).toBe(CATEGORY_ENTERTAINMENT);
  });

  test('blocks entertainment until the daily learning requirement is complete', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel, gateStateModel } = buildModels({
      learningMinutes: 29,
      countedRows: [],
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest(), {
      requestModel,
      packageRuleModel,
      rewardModel,
      gateStateModel,
      now,
      settings,
    });

    expect(result.responsePayload).toMatchObject({
      status: 'NG',
      allowed: false,
      action: 'learn_first',
      reasonCode: 'learning_required',
      maxVolume: 100,
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

  test('counts manual study minutes toward the learning gate', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel, gateStateModel } = buildModels({
      learningMinutes: 20,
      countedRows: [],
      gateState: {
        localDateKey: '2026-05-27',
        manualStudyMinutes: 10,
      },
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest(), {
      requestModel,
      packageRuleModel,
      rewardModel,
      gateStateModel,
      now,
      settings,
    });

    expect(result.responsePayload).toMatchObject({
      status: 'OK',
      allowed: true,
      action: 'allow',
      reasonCode: 'allowed',
      usage: {
        countsTowardLimit: true,
        learning: {
          todayMinutesBefore: 30,
          todayMinutes: 30,
          loggedMinutesBefore: 20,
          loggedMinutes: 20,
          manualStudyMinutes: 10,
          remainingMinutes: 0,
          entertainmentUnlocked: true,
        },
      },
    });
    expect(requestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      allowed: true,
      countsTowardLimit: true,
      learningMinutesTodayBefore: 30,
      learningMinutesTodayAfter: 30,
    }));
  });

  test('blocks entertainment on homework gate after study minutes are complete', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel, gateStateModel } = buildModels({
      learningMinutes: 30,
      countedRows: [],
      gateState: {
        localDateKey: '2026-05-27',
        manualStudyMinutes: 0,
        homeworkCleared: false,
      },
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest(), {
      requestModel,
      packageRuleModel,
      rewardModel,
      gateStateModel,
      now,
      settings: {
        ...settings,
        homeworkGateEnabled: true,
      },
    });

    expect(result.responsePayload).toMatchObject({
      status: 'NG',
      allowed: false,
      action: 'finish_homework',
      reasonCode: 'homework_required',
      usage: {
        learning: {
          todayMinutes: 30,
          remainingMinutes: 0,
          entertainmentUnlocked: false,
        },
        homework: {
          gateEnabled: true,
          cleared: false,
          remaining: true,
        },
      },
    });
    expect(requestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      allowed: false,
      countsTowardLimit: false,
      reasonCode: 'homework_required',
    }));
  });

  test('allows entertainment when homework gate is enabled and cleared', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel, gateStateModel } = buildModels({
      learningMinutes: 30,
      countedRows: [],
      gateState: {
        localDateKey: '2026-05-27',
        homeworkCleared: true,
        homeworkClearedAt: new Date('2026-05-27T00:00:00.000Z'),
      },
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest(), {
      requestModel,
      packageRuleModel,
      rewardModel,
      gateStateModel,
      now,
      settings: {
        ...settings,
        homeworkGateEnabled: true,
      },
    });

    expect(result.responsePayload).toMatchObject({
      status: 'OK',
      allowed: true,
      action: 'allow',
      reasonCode: 'allowed',
      usage: {
        learning: {
          entertainmentUnlocked: true,
        },
        homework: {
          gateEnabled: true,
          cleared: true,
          remaining: false,
        },
      },
    });
  });

  test('returns the configured max volume in device usage responses', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel, gateStateModel } = buildModels({
      learningMinutes: 30,
      countedRows: [],
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest(), {
      requestModel,
      packageRuleModel,
      rewardModel,
      gateStateModel,
      now,
      settings: {
        ...settings,
        maxVolume: 70,
      },
    });

    expect(result.responsePayload.maxVolume).toBe(70);
    expect(requestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      maxVolume: 70,
      responsePayload: expect.objectContaining({
        maxVolume: 70,
      }),
    }));
  });

  test('allows the first 30 learning minutes outside the rolling limit', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const { requestModel, packageRuleModel, rewardModel, gateStateModel } = buildModels({
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
      gateStateModel,
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
    const { requestModel, packageRuleModel, rewardModel, gateStateModel } = buildModels({
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
      gateStateModel,
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
    const { requestModel, packageRuleModel, rewardModel, gateStateModel } = buildModels({
      learningMinutes: 30,
      countedRows: buildCountedRows(60, now),
    });

    const result = await recordAndEvaluateDeviceUsage(createRequest(), {
      requestModel,
      packageRuleModel,
      rewardModel,
      gateStateModel,
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
    const { requestModel, packageRuleModel, rewardModel, gateStateModel } = buildModels({
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
      gateStateModel,
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
    const { requestModel, packageRuleModel, rewardModel, gateStateModel } = buildModels({
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
      gateStateModel,
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
    expect(result.responsePayload.maxVolume).toBe(100);
    expect(requestModel.countDocuments).not.toHaveBeenCalled();
    expect(requestModel.create).not.toHaveBeenCalled();
  });

  test('normalizes and updates max volume settings in 10 step increments', async () => {
    expect((await getDeviceUsageSettings({
      settings: {
        ...settings,
        maxVolume: 75,
      },
    })).maxVolume).toBe(DEVICE_USAGE_DEFAULT_MAX_VOLUME);

    const settingsModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(createLeanQuery({
        ...settings,
        key: 'default',
        maxVolume: 80,
        updatedBy: 'admin-user',
      })),
    };

    const result = await updateDeviceUsageSettings({
      rollingLimitMinutes: '60',
      rollingWindowMinutes: '90',
      learningRequiredMinutes: '30',
      learningFreeMinutes: '30',
      homeworkGateEnabled: 'on',
      maxVolume: '80',
    }, {
      settingsModel,
      updatedBy: 'admin-user',
    });

    expect(result.maxVolume).toBe(80);
    expect(settingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      { key: 'default' },
      {
        $set: expect.objectContaining({
          maxVolume: 80,
          homeworkGateEnabled: true,
          updatedBy: 'admin-user',
        }),
        $setOnInsert: { key: 'default' },
      },
      expect.objectContaining({
        new: true,
        upsert: true,
      })
    );

    await expect(updateDeviceUsageSettings({
      rollingLimitMinutes: '60',
      rollingWindowMinutes: '90',
      learningRequiredMinutes: '30',
      learningFreeMinutes: '30',
      maxVolume: '85',
    }, { settingsModel })).rejects.toThrow('Max volume must use 10 step increments.');
  });

  test('adds manual study minutes to the current local day', async () => {
    const now = new Date('2026-05-27T00:00:00.000Z');
    const gateStateModel = {
      findOne: jest.fn().mockReturnValue(createLeanQuery({
        localDateKey: '2026-05-27',
        manualStudyMinutes: 5,
      })),
      findOneAndUpdate: jest.fn().mockReturnValue(createLeanQuery({
        localDateKey: '2026-05-27',
        manualStudyMinutes: 15,
        manualStudyNote: 'Reading',
        manualStudyUpdatedAt: now,
        manualStudyUpdatedBy: 'admin-user',
      })),
    };

    const result = await addManualStudyMinutes({
      minutes: '10',
      note: 'Reading',
    }, {
      gateStateModel,
      now,
      updatedBy: 'admin-user',
    });

    expect(result.manualStudyMinutes).toBe(15);
    expect(gateStateModel.findOneAndUpdate).toHaveBeenCalledWith(
      { localDateKey: '2026-05-27' },
      {
        $set: expect.objectContaining({
          manualStudyMinutes: 15,
          manualStudyNote: 'Reading',
          manualStudyUpdatedBy: 'admin-user',
        }),
        $setOnInsert: {
          localDateKey: '2026-05-27',
        },
      },
      expect.objectContaining({
        new: true,
        upsert: true,
      })
    );
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
