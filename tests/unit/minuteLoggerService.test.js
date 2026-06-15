const {
  MinuteLoggerLocationGroupSettingsError,
  MINUTE_LOGGER_UNUSED_PACKAGE,
  MINUTE_LOGGER_RESPONSE_BODY,
  buildRequestRecord,
  fetchDailyMinuteStats,
  fetchLastKnownNamedLocation,
  getRequestActive,
  getMinuteLoggerBatteryDashboard,
  getMinuteLoggerDailyAnalytics,
  getMinuteLoggerNamedLocationAnalytics,
  getPackageName,
  parseActiveInput,
  parseLocationValue,
  recordMinuteLoggerRequest,
  summarizeBatteryReadings,
  summarizeLocationGroups,
  summarizeTimeBuckets,
  updateMinuteLoggerLocationGroupSettings,
} = require('../../services/minuteLoggerService');

function createLeanQuery(result) {
  const exec = jest.fn().mockResolvedValue(result);
  const lean = jest.fn().mockReturnValue({ exec });
  return { lean, exec };
}

function createChainQuery(result) {
  const exec = jest.fn().mockResolvedValue(result);
  const query = {
    sort: jest.fn(() => query),
    select: jest.fn(() => query),
    limit: jest.fn(() => query),
    lean: jest.fn(() => ({ exec })),
    exec,
  };

  return query;
}

function createRequest(overrides = {}) {
  return {
    baseUrl: '/secret-minute-logger',
    originalUrl: '/secret-minute-logger?source=unit',
    method: 'POST',
    ip: '203.0.113.50',
    ips: ['203.0.113.50'],
    query: { source: 'unit' },
    body: {
      package: 'com.example.app',
      deviceId: 'tablet-01',
      location: '35.4602514,139.54049637',
      battery: '72',
      battery_temp: '32.2',
      extra: { value: 42 },
    },
    headers: {
      'user-agent': 'minute-client/1.0',
      referer: 'https://example.test/',
    },
    get: jest.fn((name) => {
      const headers = {
        'user-agent': 'minute-client/1.0',
        referer: 'https://example.test/',
        'x-package': 'header.package',
        'x-device-id': 'header-device',
      };
      return headers[name.toLowerCase()];
    }),
    ...overrides,
  };
}

describe('minuteLoggerService', () => {
  test('buildRequestRecord stores package, device id, battery, query, and body data', () => {
    const now = new Date('2026-06-07T03:00:00.000Z');
    const record = buildRequestRecord(createRequest(), {
      now,
      endpointPath: '/secret-minute-logger',
    });

    expect(record).toMatchObject({
      endpointPath: '/secret-minute-logger',
      requestPath: '/secret-minute-logger?source=unit',
      method: 'POST',
      ip: '203.0.113.50',
      userAgent: 'minute-client/1.0',
      referer: 'https://example.test/',
      deviceId: 'tablet-01',
      package: 'com.example.app',
      active: true,
      battery: 72,
      batteryTempC: 32.2,
      location: {
        raw: '35.4602514,139.54049637',
        latitude: 35.4602514,
        longitude: 139.54049637,
        groupKey: '35.460,139.540',
      },
      query: { source: 'unit' },
      body: {
        package: 'com.example.app',
        deviceId: 'tablet-01',
        location: '35.4602514,139.54049637',
        battery: '72',
        battery_temp: '32.2',
        extra: { value: 42 },
      },
      receivedAt: now,
      responseStatusCode: 200,
      responseBody: MINUTE_LOGGER_RESPONSE_BODY,
    });
  });

  test('uses package from the body before the header fallback', () => {
    expect(getPackageName(createRequest({
      body: {
        unrelated: 'not-a-package',
      },
      query: {},
    }))).toBe('header.package');

    expect(getPackageName(createRequest({
      body: {
        package: 'correct-package',
      },
    }))).toBe('correct-package');
  });

  test('defaults active to true and parses inactive inputs', () => {
    expect(getRequestActive(createRequest())).toBe(true);
    expect(getRequestActive(createRequest({
      body: {
        active: 'True',
      },
    }))).toBe(true);
    expect(parseActiveInput(undefined)).toBe(true);
    expect(parseActiveInput('True')).toBe(true);
    expect(parseActiveInput('true')).toBe(true);
    expect(parseActiveInput('false')).toBe(false);
    expect(parseActiveInput('0')).toBe(false);
    expect(parseActiveInput(false)).toBe(false);
  });

  test('active false stores an unused package while retaining location and battery data', () => {
    const now = new Date('2026-06-07T03:01:00.000Z');
    const record = buildRequestRecord(createRequest({
      body: {
        active: 'false',
        package: 'com.example.foreground',
        deviceId: 'tablet-01',
        location: '35.4602514,139.54049637',
        battery: '72',
        battery_temp: '32.2',
      },
    }), {
      now,
      endpointPath: '/secret-minute-logger',
    });

    expect(record).toMatchObject({
      endpointPath: '/secret-minute-logger',
      deviceId: 'tablet-01',
      package: MINUTE_LOGGER_UNUSED_PACKAGE,
      active: false,
      battery: 72,
      batteryTempC: 32.2,
      location: {
        latitude: 35.4602514,
        longitude: 139.54049637,
        groupKey: '35.460,139.540',
      },
      body: {
        active: 'false',
        package: 'com.example.foreground',
      },
      receivedAt: now,
    });
  });

  test('parses location strings and ignores invalid coordinates', () => {
    expect(parseLocationValue('35.4602514,139.54049637')).toMatchObject({
      raw: '35.4602514,139.54049637',
      latitude: 35.4602514,
      longitude: 139.54049637,
      groupKey: '35.460,139.540',
    });

    expect(parseLocationValue('not-a-location')).toBeNull();
    expect(parseLocationValue('95,139')).toBeNull();
  });

  test('summarizeBatteryReadings combines normalized and body-only readings', () => {
    const summary = summarizeBatteryReadings([
      {
        deviceId: 'tablet-01',
        battery: 71,
        batteryTempC: 31.8,
        receivedAt: new Date('2026-06-07T02:58:00.000Z'),
      },
      {
        deviceId: 'tablet-01',
        body: {
          battery: '72%',
          battery_temp: '32.2 C',
        },
        receivedAt: new Date('2026-06-07T02:59:00.000Z'),
      },
      {
        deviceId: 'phone-01',
        body: {
          battery: 'not-a-number',
          battery_temp: '999',
        },
        receivedAt: new Date('2026-06-07T03:00:00.000Z'),
      },
    ]);

    expect(summary.battery).toMatchObject({
      count: 2,
      average: 71.5,
      min: 71,
      max: 72,
      latest: 72,
      latestDeviceId: 'tablet-01',
    });
    expect(summary.batteryTempC).toMatchObject({
      count: 2,
      average: 32,
      min: 31.8,
      max: 32.2,
      latest: 32.2,
    });
    expect(summary.deviceStats).toEqual([
      expect.objectContaining({
        deviceId: 'tablet-01',
        battery: expect.objectContaining({ count: 2 }),
        batteryTempC: expect.objectContaining({ count: 2 }),
      }),
    ]);
  });

  test('getMinuteLoggerBatteryDashboard maps retained rows to package-colored chart points', async () => {
    const firstPointAt = new Date('2026-06-07T01:00:00.000Z');
    const inactivePointAt = new Date('2026-06-07T01:01:00.000Z');
    const bodyPointAt = new Date('2026-06-07T01:02:00.000Z');
    const rows = [
      {
        receivedAt: firstPointAt,
        active: true,
        deviceId: 'tablet-01',
        package: 'com.example.app',
        battery: 80,
        batteryTempC: 31.5,
      },
      {
        receivedAt: inactivePointAt,
        active: false,
        deviceId: 'tablet-01',
        package: MINUTE_LOGGER_UNUSED_PACKAGE,
        battery: 79,
        batteryTempC: 31.7,
      },
      {
        receivedAt: bodyPointAt,
        active: true,
        deviceId: 'phone-01',
        package: 'com.example.other',
        body: {
          battery: '68%',
          battery_temp: '33 C',
        },
      },
    ];
    const requestModel = {
      find: jest.fn().mockReturnValue(createChainQuery(rows)),
    };
    const now = new Date('2026-06-07T03:00:00.000Z');

    const result = await getMinuteLoggerBatteryDashboard({
      requestModel,
      endpointPath: '/secret-minute-logger',
      now,
    });

    expect(requestModel.find).toHaveBeenCalledWith({
      endpointPath: '/secret-minute-logger',
      receivedAt: {
        $gte: new Date('2026-04-08T03:00:00.000Z'),
        $lte: now,
      },
    });
    const query = requestModel.find.mock.results[0].value;
    expect(query.sort).toHaveBeenCalledWith({ receivedAt: 1 });
    expect(query.select).toHaveBeenCalledWith(expect.objectContaining({
      package: 1,
      active: 1,
      battery: 1,
      batteryTempC: 1,
      body: 1,
      receivedAt: 1,
    }));
    expect(result).toMatchObject({
      endpointPath: '/secret-minute-logger',
      generatedAt: now,
      rawRetentionDays: 60,
      retentionStart: new Date('2026-04-08T03:00:00.000Z'),
      retentionEnd: now,
      windowHours: 12,
      pointCount: 3,
      noActivePointCount: 0,
    });
    expect(result.packages).toEqual([
      expect.objectContaining({
        name: 'com.example.app',
        count: 1,
        color: expect.any(String),
      }),
      expect.objectContaining({
        name: 'com.example.other',
        count: 1,
        color: expect.any(String),
      }),
      expect.objectContaining({
        name: MINUTE_LOGGER_UNUSED_PACKAGE,
        count: 1,
        color: expect.any(String),
      }),
    ]);
    expect(result.points).toEqual([
      { t: firstPointAt.getTime(), b: 80, c: 31.5, p: 0 },
      { t: inactivePointAt.getTime(), b: 79, c: 31.7, p: 2 },
      { t: bodyPointAt.getTime(), b: 68, c: 33, p: 1 },
    ]);
    expect(result.batteryStats.battery).toMatchObject({
      count: 3,
      min: 68,
      max: 80,
      latest: 68,
      latestDeviceId: 'phone-01',
    });
    expect(result.batteryAnalytics).toMatchObject({
      inferredUnusedMinutes: 0,
      totalChargeDropPercent: 1,
      chargeDropSamples: 1,
      charging: {
        intervalCount: 0,
      },
    });
    expect(result.batteryAnalytics.packageStats).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: MINUTE_LOGGER_UNUSED_PACKAGE,
        observedPoints: 1,
        inferredMinutes: 0,
        chargeDropPercent: 1,
      }),
      expect.objectContaining({
        name: 'com.example.app',
        observedPoints: 1,
        batteryTempC: expect.objectContaining({ average: 31.5 }),
      }),
    ]));
  });

  test('getMinuteLoggerBatteryDashboard infers empty minutes before unused without adding chart points', async () => {
    const firstPointAt = new Date('2026-06-07T01:00:00.000Z');
    const inactivePointAt = new Date('2026-06-07T01:10:00.000Z');
    const rows = [
      {
        receivedAt: firstPointAt,
        active: true,
        deviceId: 'tablet-01',
        package: 'com.example.app',
        battery: 80,
        batteryTempC: 31,
      },
      {
        receivedAt: inactivePointAt,
        active: false,
        deviceId: 'tablet-01',
        package: MINUTE_LOGGER_UNUSED_PACKAGE,
        battery: 78,
        batteryTempC: 32,
      },
    ];
    const requestModel = {
      find: jest.fn().mockReturnValue(createChainQuery(rows)),
    };

    const result = await getMinuteLoggerBatteryDashboard({
      requestModel,
      endpointPath: '/secret-minute-logger',
      now: new Date('2026-06-07T03:00:00.000Z'),
    });

    expect(result.points).toEqual([
      { t: firstPointAt.getTime(), b: 80, c: 31, p: 0 },
      { t: inactivePointAt.getTime(), b: 78, c: 32, p: 1 },
    ]);
    expect(result.pointCount).toBe(2);
    expect(result.inferredUnusedMinutes).toBe(9);
    expect(result.batteryAnalytics).toMatchObject({
      inferredUnusedMinutes: 9,
      totalChargeDropPercent: 2,
      chargeDropSamples: 1,
    });
    expect(result.batteryAnalytics.packageStats).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: MINUTE_LOGGER_UNUSED_PACKAGE,
        observedPoints: 1,
        inferredMinutes: 9,
        totalMinutes: 10,
        chargeDropPercent: 2,
        chargeDropMinutes: 10,
        drainRatePercentPerHour: 12,
      }),
    ]));
  });

  test('getMinuteLoggerBatteryDashboard summarizes charging intervals', async () => {
    const firstPointAt = new Date('2026-06-07T01:00:00.000Z');
    const chargingPointAt = new Date('2026-06-07T01:30:00.000Z');
    const rows = [
      {
        receivedAt: firstPointAt,
        active: true,
        deviceId: 'tablet-01',
        package: 'com.example.app',
        battery: 50,
        batteryTempC: 30,
      },
      {
        receivedAt: chargingPointAt,
        active: true,
        deviceId: 'tablet-01',
        package: 'com.example.app',
        battery: 55,
        batteryTempC: 35,
      },
    ];
    const requestModel = {
      find: jest.fn().mockReturnValue(createChainQuery(rows)),
    };

    const result = await getMinuteLoggerBatteryDashboard({
      requestModel,
      endpointPath: '/secret-minute-logger',
      now: new Date('2026-06-07T03:00:00.000Z'),
    });

    expect(result.batteryAnalytics.charging).toMatchObject({
      intervalCount: 1,
      totalGainPercent: 5,
      totalMinutes: 30,
      averageSpeedPercentPerHour: 10,
      maxSpeedPercentPerHour: 10,
      batteryTempC: expect.objectContaining({
        count: 1,
        average: 35,
        max: 35,
      }),
      packageStats: [
        expect.objectContaining({
          name: 'com.example.app',
          totalGainPercent: 5,
          totalMinutes: 30,
          averageSpeedPercentPerHour: 10,
        }),
      ],
    });
  });

  test('records a raw request and increments day and month rollups', async () => {
    const requestModel = {
      create: jest.fn().mockResolvedValue({ _id: 'request-1' }),
    };
    const statModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(createLeanQuery({})),
    };
    const now = new Date('2026-06-07T03:04:00.000Z');

    const result = await recordMinuteLoggerRequest(createRequest(), {
      requestModel,
      statModel,
      endpointPath: '/secret-minute-logger',
      now,
    });

    expect(result).toMatchObject({
      logged: true,
      responseBody: { message: 'OK' },
    });
    expect(requestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      endpointPath: '/secret-minute-logger',
      deviceId: 'tablet-01',
      package: 'com.example.app',
      active: true,
      battery: 72,
      batteryTempC: 32.2,
      location: expect.objectContaining({
        latitude: 35.4602514,
        longitude: 139.54049637,
        groupKey: '35.460,139.540',
      }),
      body: expect.objectContaining({
        package: 'com.example.app',
        deviceId: 'tablet-01',
      }),
    }));
    expect(statModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(statModel.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      {
        endpointPath: '/secret-minute-logger',
        periodType: 'day',
        periodKey: '2026-06-07',
        deviceId: 'tablet-01',
        package: 'com.example.app',
      },
      expect.objectContaining({
        $inc: { minutes: 1 },
        $setOnInsert: expect.objectContaining({
          periodStart: expect.any(Date),
          expiresAt: expect.any(Date),
        }),
      }),
      expect.objectContaining({
        upsert: true,
      })
    );
    expect(statModel.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        periodType: 'month',
        periodKey: '2026-06',
        package: 'com.example.app',
      }),
      expect.objectContaining({
        $inc: { minutes: 1 },
      }),
      expect.objectContaining({
        upsert: true,
      })
    );
  });

  test('records inactive raw requests without incrementing usage rollups', async () => {
    const requestModel = {
      create: jest.fn().mockResolvedValue({ _id: 'request-2' }),
    };
    const statModel = {
      findOneAndUpdate: jest.fn(),
    };
    const now = new Date('2026-06-07T03:05:00.000Z');

    const result = await recordMinuteLoggerRequest(createRequest({
      body: {
        active: 'false',
        package: 'com.example.app',
        deviceId: 'tablet-01',
        location: '35.4602514,139.54049637',
        battery: '72',
      },
    }), {
      requestModel,
      statModel,
      endpointPath: '/secret-minute-logger',
      now,
    });

    expect(result).toMatchObject({
      logged: true,
      active: false,
    });
    expect(requestModel.create).toHaveBeenCalledWith(expect.objectContaining({
      endpointPath: '/secret-minute-logger',
      deviceId: 'tablet-01',
      package: MINUTE_LOGGER_UNUSED_PACKAGE,
      active: false,
      battery: 72,
      location: expect.objectContaining({
        groupKey: '35.460,139.540',
      }),
    }));
    expect(statModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  test('fetchDailyMinuteStats groups rollups by package', async () => {
    const statModel = {
      aggregate: jest.fn().mockResolvedValue([
        { _id: { periodKey: '2026-06-05', package: 'com.example.app' }, minutes: 12 },
        { _id: { periodKey: '2026-06-05', package: 'com.example.other' }, minutes: 3 },
      ]),
    };

    const rows = await fetchDailyMinuteStats('/secret-minute-logger', {
      statModel,
      now: new Date('2026-06-06T10:00:00.000Z'),
      days: 1,
    });

    expect(statModel.aggregate).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        $match: expect.objectContaining({
          endpointPath: '/secret-minute-logger',
          periodType: 'day',
        }),
      }),
    ]));
    expect(rows).toEqual([
      {
        dateKey: '2026-06-05',
        totalMinutes: 15,
        categories: [
          { name: 'com.example.app', minutes: 12 },
          { name: 'com.example.other', minutes: 3 },
        ],
      },
    ]);
  });

  test('summarizeLocationGroups filters low-count location noise', () => {
    const summary = summarizeLocationGroups([
      {
        groupKey: '35.460,139.540',
        latitude: 35.4602,
        longitude: 139.5404,
        minutes: 8,
        deviceCount: 1,
        packageCount: 2,
      },
      {
        groupKey: '35.461,139.541',
        latitude: 35.461,
        longitude: 139.541,
        minutes: 2,
        deviceCount: 1,
        packageCount: 1,
      },
    ], {
      minMinutes: 3,
    });

    expect(summary).toMatchObject({
      totalLocationMinutes: 10,
      groupedLocationMinutes: 8,
      noiseLocationMinutes: 2,
      noiseGroupCount: 1,
      totalGroupCount: 1,
      noiseThresholdMinutes: 3,
    });
    expect(summary.groups).toEqual([
      expect.objectContaining({
        groupKey: '35.460,139.540',
        minutes: 8,
      }),
    ]);
  });

  test('fetchLastKnownNamedLocation returns the named group for the newest request', async () => {
    const receivedAt = new Date('2026-06-07T02:59:00.000Z');
    const settingsModel = {
      find: jest.fn().mockReturnValue(createLeanQuery([
        {
          endpointPath: '/secret-minute-logger',
          groupKey: '35.460,139.540',
          name: 'Home',
          hideCoordinates: true,
        },
      ])),
    };

    const result = await fetchLastKnownNamedLocation('/secret-minute-logger', [
      {
        deviceId: 'tablet-01',
        package: 'com.example.app',
        receivedAt,
        location: {
          latitude: 35.4602514,
          longitude: 139.54049637,
          groupKey: '35.460,139.540',
        },
      },
      {
        deviceId: 'tablet-01',
        package: 'com.example.app',
        receivedAt: new Date('2026-06-07T02:58:00.000Z'),
        location: {
          latitude: 35.461,
          longitude: 139.541,
          groupKey: '35.461,139.541',
        },
      },
    ], {
      settingsModel,
    });

    expect(settingsModel.find).toHaveBeenCalledWith({
      endpointPath: '/secret-minute-logger',
      groupKey: { $in: ['35.460,139.540'] },
    });
    expect(result).toEqual({
      name: 'Home',
      groupKey: '35.460,139.540',
      hideCoordinates: true,
      deviceId: 'tablet-01',
      package: 'com.example.app',
      receivedAt,
      latitude: 35.4602514,
      longitude: 139.54049637,
    });
  });

  test('fetchLastKnownNamedLocation returns the nearest named group for outside locations', async () => {
    const receivedAt = new Date('2026-06-07T02:59:00.000Z');
    const namedSettingsQuery = createChainQuery([
      {
        endpointPath: '/secret-minute-logger',
        groupKey: '35.460,139.540',
        name: 'Home',
        hideCoordinates: true,
      },
      {
        endpointPath: '/secret-minute-logger',
        groupKey: '35.470,139.550',
        name: 'Office',
        hideCoordinates: false,
      },
    ]);
    const settingsModel = {
      find: jest.fn()
        .mockReturnValueOnce(createLeanQuery([]))
        .mockReturnValueOnce(namedSettingsQuery),
    };

    const result = await fetchLastKnownNamedLocation('/secret-minute-logger', [
      {
        deviceId: 'tablet-01',
        package: 'com.example.app',
        receivedAt,
        location: {
          latitude: 35.461,
          longitude: 139.541,
          groupKey: '35.461,139.541',
        },
      },
    ], {
      settingsModel,
    });

    expect(settingsModel.find).toHaveBeenNthCalledWith(1, {
      endpointPath: '/secret-minute-logger',
      groupKey: { $in: ['35.461,139.541'] },
    });
    expect(settingsModel.find).toHaveBeenNthCalledWith(2, {
      endpointPath: '/secret-minute-logger',
      name: { $type: 'string', $ne: '' },
    });
    expect(namedSettingsQuery.sort).toHaveBeenCalledWith({ name: 1, groupKey: 1 });
    expect(result).toMatchObject({
      name: 'Home',
      groupKey: '35.461,139.541',
      hideCoordinates: true,
      isApproximate: true,
      nearestGroupKey: '35.460,139.540',
      nearestLatitude: 35.46,
      nearestLongitude: 139.54,
      deviceId: 'tablet-01',
      package: 'com.example.app',
      receivedAt,
      latitude: 35.461,
      longitude: 139.541,
    });
    expect(result.nearestDistanceMeters).toBeGreaterThan(100);
    expect(result.nearestDistanceMeters).toBeLessThan(200);
  });

  test('fetchLastKnownNamedLocation ignores older located requests when the newest request is unlocated', async () => {
    const settingsModel = {
      find: jest.fn(),
    };

    const result = await fetchLastKnownNamedLocation('/secret-minute-logger', [
      {
        deviceId: 'tablet-01',
        package: 'com.example.app',
        receivedAt: new Date('2026-06-07T02:59:00.000Z'),
        location: null,
      },
      {
        deviceId: 'tablet-01',
        package: 'com.example.app',
        receivedAt: new Date('2026-06-07T02:58:00.000Z'),
        location: {
          latitude: 35.4602514,
          longitude: 139.54049637,
          groupKey: '35.460,139.540',
        },
      },
    ], {
      settingsModel,
    });

    expect(result).toBeNull();
    expect(settingsModel.find).not.toHaveBeenCalled();
  });

  test('getMinuteLoggerDailyAnalytics builds raw daily timeline and breakdowns', async () => {
    const requestRows = [
      {
        receivedAt: new Date('2026-06-06T09:00:00.000Z'),
        deviceId: 'tablet-01',
        package: 'com.example.app',
        location: {
          latitude: 35.4602,
          longitude: 139.5404,
          groupKey: '35.460,139.540',
        },
        battery: 80,
        batteryTempC: 31.5,
      },
      {
        receivedAt: new Date('2026-06-06T09:01:00.000Z'),
        deviceId: 'tablet-01',
        package: 'com.example.other',
        location: {
          latitude: 35.4603,
          longitude: 139.5405,
          groupKey: '35.460,139.540',
        },
        battery: 79,
        batteryTempC: 31.7,
      },
      {
        receivedAt: new Date('2026-06-06T10:15:00.000Z'),
        deviceId: 'phone-01',
        package: 'com.example.app',
        location: null,
        body: {
          battery: '68',
          battery_temp: '33.0',
        },
      },
    ];
    const requestModel = {
      find: jest.fn().mockReturnValue(createChainQuery(requestRows)),
      aggregate: jest.fn().mockResolvedValue([
        {
          groupKey: '35.460,139.540',
          count: 2,
          latitude: 35.46025,
          longitude: 139.54045,
        },
        {
          groupKey: '35.461,139.541',
          count: 2,
          latitude: 35.46125,
          longitude: 139.54145,
        },
      ]),
    };
    const settingsModel = {
      find: jest.fn()
        .mockReturnValueOnce(createLeanQuery([
          {
            endpointPath: '/secret-minute-logger',
            groupKey: '35.460,139.540',
            name: 'Home',
            hideCoordinates: false,
          },
        ]))
        .mockReturnValueOnce(createChainQuery([
          {
            endpointPath: '/secret-minute-logger',
            groupKey: '35.460,139.540',
            name: 'Home',
            hideCoordinates: false,
          },
          {
            endpointPath: '/secret-minute-logger',
            groupKey: '35.461,139.541',
            name: 'Home',
            hideCoordinates: false,
          },
        ])),
    };

    const result = await getMinuteLoggerDailyAnalytics('2026-06-06', {
      requestModel,
      locationGroupSettingsModel: settingsModel,
      endpointPath: '/secret-minute-logger',
      now: new Date('2026-06-07T03:00:00.000Z'),
    });

    expect(requestModel.find).toHaveBeenCalledWith({
      endpointPath: '/secret-minute-logger',
      receivedAt: expect.objectContaining({
        $gte: expect.any(Date),
        $lt: expect.any(Date),
      }),
    });
    expect(result).toMatchObject({
      dateKey: '2026-06-06',
      totalMinutes: 3,
      locatedMinutes: 2,
      unlocatedMinutes: 1,
      namedLocationMinutes: 2,
      deviceCount: 2,
      packageCount: 2,
    });
    expect(result.batteryStats).toMatchObject({
      battery: {
        count: 3,
        min: 68,
        max: 80,
        latest: 68,
        latestDeviceId: 'phone-01',
      },
      batteryTempC: {
        count: 3,
        min: 31.5,
        max: 33,
        latest: 33,
      },
    });
    expect(result.packageStats).toEqual([
      expect.objectContaining({ name: 'com.example.app', minutes: 2 }),
      expect.objectContaining({ name: 'com.example.other', minutes: 1 }),
    ]);
    expect(result.locationGroups).toEqual([
      expect.objectContaining({
        groupKey: '35.460,139.540',
        name: 'Home',
        minutes: 2,
        deviceCount: 1,
        packageCount: 2,
      }),
    ]);
    expect(result.locationTimeline.points).toEqual([
      expect.objectContaining({
        name: 'Home',
        minuteOfDay: expect.any(Number),
      }),
      expect.objectContaining({
        name: 'Home',
        minuteOfDay: expect.any(Number),
      }),
    ]);
    expect(result.locationTimeline.labels).toEqual([
      expect.objectContaining({ name: 'Home', pointCount: 4 }),
    ]);
    expect(result.locationTimeline.labels[0].latitude).toBeCloseTo(35.46075);
    expect(result.locationTimeline.labels[0].longitude).toBeCloseTo(139.54095);
  });

  test('getMinuteLoggerDailyAnalytics excludes inactive rows from usage while retaining location and battery points', async () => {
    const requestRows = [
      {
        receivedAt: new Date('2026-06-06T09:00:00.000Z'),
        active: true,
        deviceId: 'tablet-01',
        package: 'com.example.app',
        location: {
          latitude: 35.4602,
          longitude: 139.5404,
          groupKey: '35.460,139.540',
        },
        battery: 80,
      },
      {
        receivedAt: new Date('2026-06-06T09:01:00.000Z'),
        active: false,
        deviceId: 'tablet-01',
        package: MINUTE_LOGGER_UNUSED_PACKAGE,
        location: {
          latitude: 35.4603,
          longitude: 139.5405,
          groupKey: '35.460,139.540',
        },
        battery: 79,
      },
      {
        receivedAt: new Date('2026-06-06T09:02:00.000Z'),
        active: true,
        deviceId: 'tablet-01',
        package: 'com.example.other',
        location: null,
        battery: 78,
      },
    ];
    const requestModel = {
      find: jest.fn().mockReturnValue(createChainQuery(requestRows)),
      aggregate: jest.fn(),
    };
    const settingsModel = {
      find: jest.fn()
        .mockReturnValueOnce(createLeanQuery([
          {
            endpointPath: '/secret-minute-logger',
            groupKey: '35.460,139.540',
            name: 'Home',
            hideCoordinates: false,
          },
        ]))
        .mockReturnValueOnce(createChainQuery([])),
    };

    const result = await getMinuteLoggerDailyAnalytics('2026-06-06', {
      requestModel,
      locationGroupSettingsModel: settingsModel,
      endpointPath: '/secret-minute-logger',
      now: new Date('2026-06-07T03:00:00.000Z'),
    });

    expect(result).toMatchObject({
      totalMinutes: 2,
      totalRawRequests: 3,
      inactiveRequests: 1,
      locatedMinutes: 2,
      activeLocatedMinutes: 1,
      namedLocationMinutes: 2,
      deviceCount: 1,
      packageCount: 2,
    });
    expect(result.packageStats.map((row) => row.name)).toEqual([
      'com.example.app',
      'com.example.other',
    ]);
    const activeHour = new Date('2026-06-06T09:00:00.000Z').getHours();
    expect(result.hourlySpread[activeHour].minutes).toBe(2);
    expect(result.batteryStats.battery).toMatchObject({
      count: 3,
      min: 78,
      max: 80,
      latest: 78,
    });
    expect(result.locationGroups).toEqual([
      expect.objectContaining({
        groupKey: '35.460,139.540',
        minutes: 2,
        packageCount: 2,
      }),
    ]);
    expect(result.locationTimeline.points).toEqual([
      expect.objectContaining({ package: 'com.example.app' }),
      expect.objectContaining({ package: MINUTE_LOGGER_UNUSED_PACKAGE }),
    ]);
    expect(result.recentRequests).toHaveLength(3);
  });

  test('getMinuteLoggerDailyAnalytics returns null for invalid dates', async () => {
    const result = await getMinuteLoggerDailyAnalytics('2026-99-99', {
      requestModel: {},
      endpointPath: '/secret-minute-logger',
    });

    expect(result).toBeNull();
  });

  test('getMinuteLoggerNamedLocationAnalytics groups saved locations by shared name', async () => {
    const settingsModel = {
      find: jest.fn().mockReturnValue(createChainQuery([
        {
          endpointPath: '/secret-minute-logger',
          groupKey: '35.460,139.540',
          name: 'Home',
          hideCoordinates: false,
        },
        {
          endpointPath: '/secret-minute-logger',
          groupKey: '35.461,139.541',
          name: 'Home',
          hideCoordinates: false,
        },
        {
          endpointPath: '/secret-minute-logger',
          groupKey: '35.470,139.550',
          name: 'Office',
          hideCoordinates: false,
        },
      ])),
    };
    const requestModel = {
      find: jest.fn().mockReturnValue(createChainQuery([
        {
          receivedAt: new Date('2026-06-06T09:00:00.000Z'),
          deviceId: 'tablet-01',
          package: 'com.example.app',
          location: {
            latitude: 35.4602,
            longitude: 139.5404,
            groupKey: '35.460,139.540',
          },
        },
        {
          receivedAt: new Date('2026-06-06T10:00:00.000Z'),
          deviceId: 'tablet-01',
          package: 'com.example.other',
          location: {
            latitude: 35.4612,
            longitude: 139.5414,
            groupKey: '35.461,139.541',
          },
        },
        {
          receivedAt: new Date('2026-06-06T12:00:00.000Z'),
          deviceId: 'phone-01',
          package: 'com.example.work',
          location: {
            latitude: 35.4702,
            longitude: 139.5504,
            groupKey: '35.470,139.550',
          },
        },
        {
          receivedAt: new Date('2026-06-06T12:30:00.000Z'),
          deviceId: 'phone-01',
          package: 'com.example.maps',
          location: {
            latitude: 35.4652,
            longitude: 139.5454,
            groupKey: '35.465,139.545',
          },
        },
      ])),
    };

    const result = await getMinuteLoggerNamedLocationAnalytics({
      requestModel,
      locationGroupSettingsModel: settingsModel,
      endpointPath: '/secret-minute-logger',
      now: new Date('2026-06-07T03:00:00.000Z'),
    });

    expect(settingsModel.find).toHaveBeenCalledWith({
      endpointPath: '/secret-minute-logger',
      name: { $type: 'string', $ne: '' },
    });
    expect(requestModel.find).toHaveBeenCalledWith({
      endpointPath: '/secret-minute-logger',
      receivedAt: { $gte: new Date('2026-04-08T03:00:00.000Z') },
      'location.latitude': { $gte: -90, $lte: 90 },
      'location.longitude': { $gte: -180, $lte: 180 },
    });
    const query = requestModel.find.mock.results[0].value;
    expect(query.select).toHaveBeenCalledWith(expect.objectContaining({
      active: 1,
      location: 1,
      receivedAt: 1,
    }));
    expect(result).toMatchObject({
      namedLocationCount: 2,
      namedLocationGroupCount: 3,
      activeNamedLocationCount: 2,
      totalMinutes: 3,
      locationPointCount: 4,
      namedLocationPointCount: 3,
      deviceCount: 2,
      packageCount: 3,
    });
    expect(result.locationMap.points).toHaveLength(4);
    expect(result.locationMap.points).toEqual(expect.arrayContaining([
      expect.objectContaining({
        groupKey: '35.465,139.545',
        name: '',
      }),
    ]));
    expect(result.locationMap.labels.map((label) => label.name)).toEqual(['Home', 'Office']);
    expect(result.groups.map((group) => group.name)).toEqual(['Home', 'Office']);
    expect(result.groups[0]).toMatchObject({
      name: 'Home',
      groupKeys: ['35.460,139.540', '35.461,139.541'],
      totalMinutes: 2,
      deviceCount: 1,
      packageCount: 2,
    });
    expect(result.groups[0].locationGroups).toHaveLength(2);
    expect(result.groups[0].pointCloud.points).toEqual([
      expect.objectContaining({ groupKey: '35.460,139.540' }),
      expect.objectContaining({ groupKey: '35.461,139.541' }),
    ]);
    expect(result.groups[0].pointCloud.labels).toHaveLength(1);
    expect(result.groups[0].pointCloud.labels[0]).toMatchObject({
      name: 'Home',
      pointCount: 2,
    });
    expect(result.groups[0].pointCloud.labels[0].latitude).toBeCloseTo(35.4606);
    expect(result.groups[0].pointCloud.labels[0].longitude).toBeCloseTo(139.5409);
  });

  test('updateMinuteLoggerLocationGroupSettings validates and persists display names', async () => {
    const settingsModel = {
      findOneAndUpdate: jest.fn().mockReturnValue(createLeanQuery({
        endpointPath: '/secret-minute-logger',
        groupKey: '35.460,139.540',
        name: 'Home',
        hideCoordinates: true,
        updatedBy: 'admin-user',
      })),
    };

    const result = await updateMinuteLoggerLocationGroupSettings({
      groupKey: '35.460,139.540',
      name: '  Home  ',
      hideCoordinates: 'on',
    }, {
      settingsModel,
      endpointPath: '/secret-minute-logger',
      updatedBy: 'admin-user',
    });

    expect(settingsModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        endpointPath: '/secret-minute-logger',
        groupKey: '35.460,139.540',
      },
      {
        $set: {
          name: 'Home',
          hideCoordinates: true,
          updatedBy: 'admin-user',
        },
        $setOnInsert: {
          endpointPath: '/secret-minute-logger',
          groupKey: '35.460,139.540',
        },
      },
      {
        new: true,
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
    expect(result).toMatchObject({
      groupKey: '35.460,139.540',
      name: 'Home',
      hideCoordinates: true,
      updatedBy: 'admin-user',
    });
  });

  test('updateMinuteLoggerLocationGroupSettings rejects invalid group keys', async () => {
    await expect(updateMinuteLoggerLocationGroupSettings({
      groupKey: 'not-a-location',
      name: 'Home',
    }, {
      settingsModel: {},
      endpointPath: '/secret-minute-logger',
    })).rejects.toBeInstanceOf(MinuteLoggerLocationGroupSettingsError);
  });

  test('summarizeTimeBuckets identifies the busiest local period', () => {
    const summary = summarizeTimeBuckets([
      { hour: 9, minutes: 5 },
      { hour: 18, minutes: 20 },
      { hour: 23, minutes: 6 },
    ], 5);

    expect(summary.busiest).toMatchObject({
      key: 'evening',
      label: 'Evening',
      minutes: 20,
      averagePerDay: 4,
    });
  });
});
