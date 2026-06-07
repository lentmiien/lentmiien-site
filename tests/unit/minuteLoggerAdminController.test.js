jest.mock('../../services/minuteLoggerService', () => ({
  MinuteLoggerLocationGroupSettingsError: class MinuteLoggerLocationGroupSettingsError extends Error {},
  MINUTE_LOGGER_RAW_RETENTION_DAYS: 60,
  MINUTE_LOGGER_RECENT_LIMIT: 50,
  MINUTE_LOGGER_REQUEST_COLLECTION_NAME: 'minute_logger_requests',
  MINUTE_LOGGER_STAT_COLLECTION_NAME: 'minute_logger_stats',
  MINUTE_LOGGER_STATS_RETENTION_YEARS: 10,
  getMinuteLoggerDailyAnalytics: jest.fn(),
  getMinuteLoggerDashboard: jest.fn(),
  getMinuteLoggerNamedLocationAnalytics: jest.fn(),
  parseBatteryPercent: jest.fn((value) => {
    const candidate = Array.isArray(value)
      ? value.find((entry) => entry !== undefined && entry !== null && String(entry).trim() !== '')
      : value;
    const match = String(candidate ?? '').replace(',', '.').match(/[-+]?\d+(?:\.\d+)?/u);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isFinite(number) && number >= 0 && number <= 100 ? number : null;
  }),
  parseBatteryTempC: jest.fn((value) => {
    const candidate = Array.isArray(value)
      ? value.find((entry) => entry !== undefined && entry !== null && String(entry).trim() !== '')
      : value;
    const match = String(candidate ?? '').replace(',', '.').match(/[-+]?\d+(?:\.\d+)?/u);
    if (!match) return null;
    const number = Number(match[0]);
    return Number.isFinite(number) && number >= -50 && number <= 120 ? number : null;
  }),
  updateMinuteLoggerLocationGroupSettings: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
}));

jest.mock('../../services/incomingRequestCounterService', () => ({
  UNKNOWN_REQUEST_CATEGORY: 'unknown',
  normalizeRequestCategory: jest.fn((value) => {
    const normalized = String(value ?? '').trim();
    return normalized || 'unknown';
  }),
}));

const {
  getMinuteLoggerDailyAnalytics,
  getMinuteLoggerDashboard,
  getMinuteLoggerNamedLocationAnalytics,
  updateMinuteLoggerLocationGroupSettings,
} = require('../../services/minuteLoggerService');
const controller = require('../../controllers/minuteLoggerAdminController');

function createResponse() {
  return {
    render: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn().mockReturnThis(),
  };
}

function createDashboard(overrides = {}) {
  return {
    endpointPath: '/secret-minute-logger',
    generatedAt: new Date('2026-06-07T03:00:00.000Z'),
    rawRetentionDays: 60,
    statsRetentionYears: 10,
    totalRawRequests: 321,
    requestsLast24h: 42,
    activeDevicesLast24h: 3,
    packageCountLast60d: 5,
    recentLimit: 50,
    lastKnownLocation: {
      name: 'Home',
      groupKey: '35.460,139.540',
      hideCoordinates: false,
      deviceId: 'tablet-01',
      package: 'com.example.app',
      receivedAt: new Date('2026-06-07T02:59:00.000Z'),
      latitude: 35.4602514,
      longitude: 139.54049637,
    },
    recentRequests: [
      {
        _id: 'request-1',
        receivedAt: new Date('2026-06-07T02:59:00.000Z'),
        method: 'POST',
        deviceId: 'tablet-01',
        package: 'com.example.app',
        location: {
          latitude: 35.4602514,
          longitude: 139.54049637,
          groupKey: '35.460,139.540',
        },
        battery: 72,
        batteryTempC: 32.2,
        ip: '203.0.113.50',
        requestPath: '/secret-minute-logger',
        userAgent: 'minute-client/1.0',
        body: {
          package: 'com.example.app',
          deviceId: 'tablet-01',
          battery: '72',
          battery_temp: '32.2',
        },
      },
    ],
    packageStats: [
      {
        package: 'com.example.app',
        minutes: 100,
        deviceCount: 2,
        lastSeen: new Date('2026-06-07T02:59:00.000Z'),
      },
    ],
    deviceStats: [
      {
        deviceId: 'tablet-01',
        minutes: 90,
        packageCount: 3,
        lastSeen: new Date('2026-06-07T02:58:00.000Z'),
      },
    ],
    batteryStats: {
      battery: {
        count: 42,
        average: 68.2,
        min: 41,
        max: 90,
        latest: 72,
        latestAt: new Date('2026-06-07T02:59:00.000Z'),
        latestDeviceId: 'tablet-01',
      },
      batteryTempC: {
        count: 42,
        average: 32.4,
        min: 28.9,
        max: 36.1,
        latest: 32.2,
        latestAt: new Date('2026-06-07T02:59:00.000Z'),
        latestDeviceId: 'tablet-01',
      },
      deviceStats: [],
    },
    locationStats: {
      groups: [
        {
          groupKey: '35.460,139.540',
          latitude: 35.4602514,
          longitude: 139.54049637,
          minutes: 24,
          deviceCount: 1,
          packageCount: 2,
          firstSeen: new Date('2026-06-06T04:00:00.000Z'),
          lastSeen: new Date('2026-06-07T02:58:00.000Z'),
          name: 'Home',
          hideCoordinates: false,
          pointSamples: [
            { latitude: 35.4601, longitude: 139.5399 },
            { latitude: 35.4604, longitude: 139.5402 },
          ],
        },
      ],
      totalLocationMinutes: 26,
      groupedLocationMinutes: 24,
      noiseLocationMinutes: 2,
      noiseGroupCount: 1,
      totalGroupCount: 1,
      noiseThresholdMinutes: 3,
      precisionDecimals: 3,
    },
    hourlySpread: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      minutes: hour === 18 ? 20 : 0,
    })),
    timeBucketStats: [
      { key: 'morning', label: 'Morning', minutes: 10, averagePerDay: 0.2 },
      { key: 'afternoon', label: 'Afternoon', minutes: 12, averagePerDay: 0.2 },
      { key: 'evening', label: 'Evening', minutes: 60, averagePerDay: 1 },
      { key: 'night', label: 'Night', minutes: 6, averagePerDay: 0.1 },
    ],
    busiestTimeBucket: {
      key: 'evening',
      label: 'Evening',
      minutes: 60,
      averagePerDay: 1,
    },
    dailyMinuteStats: [
      {
        dateKey: '2026-06-06',
        totalMinutes: 12,
        categories: [{ name: 'com.example.app', minutes: 12 }],
      },
    ],
    monthlyMinuteStats: [
      {
        monthKey: '2026-06',
        totalMinutes: 42,
        deviceCount: 3,
        packageCount: 5,
      },
    ],
    ...overrides,
  };
}

describe('minuteLoggerAdminController.dashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders package and device activity on the dashboard', async () => {
    getMinuteLoggerDashboard.mockResolvedValue(createDashboard());
    const res = createResponse();

    await controller.dashboard({ query: {} }, res);

    expect(res.render).toHaveBeenCalledWith(
      'admin_minute_logger',
      expect.objectContaining({
        endpointPath: '/secret-minute-logger',
        rawRetentionDays: 60,
        statsRetentionYears: 10,
        overviewCards: expect.arrayContaining([
          expect.objectContaining({
            label: 'Packages',
            value: '5',
          }),
          expect.objectContaining({
            label: 'Busiest Time',
            value: 'Evening',
          }),
          expect.objectContaining({
            label: 'Last Known Location',
            value: 'Home',
            helper: expect.stringContaining('Device tablet-01'),
          }),
          expect.objectContaining({
            label: 'Location Groups',
            value: '1',
          }),
          expect.objectContaining({
            label: 'Battery Left',
            value: '72%',
            helper: expect.stringContaining('Avg 68%'),
          }),
          expect.objectContaining({
            label: 'Battery Temp',
            value: '32.2 C',
            helper: expect.stringContaining('max 36.1 C'),
          }),
        ]),
        locationStats: expect.objectContaining({
          totalLocationMinutesDisplay: '26 min',
          noiseLocationMinutesDisplay: '2 min',
          precisionDetails: {
            summary: '3 decimals = 0.001 degrees. Near latitude 35.46, one group cell is about 111 m x 91 m.',
            coverage: 'Rounded groups cover about +/-56 m north/south and +/-45 m east/west from center; corner-to-corner is about 140 m.',
          },
          groups: [
            expect.objectContaining({
              groupKey: '35.460,139.540',
              name: 'Home',
              hideCoordinates: false,
              titleDisplay: 'Home (35.460,139.540)',
              minutes: 24,
              coordinateDisplay: '35.46025, 139.54050',
              pointSampleCountDisplay: '2',
              preview: expect.objectContaining({
                width: 160,
                height: 120,
                pointCount: 2,
                points: expect.arrayContaining([
                  expect.objectContaining({
                    x: expect.any(Number),
                    y: expect.any(Number),
                  }),
                ]),
              }),
            }),
          ],
        }),
        packageStats: [
          expect.objectContaining({
            packageName: 'com.example.app',
            minutes: 100,
            deviceCountDisplay: '2',
          }),
        ],
        deviceStats: [
          expect.objectContaining({
            deviceId: 'tablet-01',
            packageCountDisplay: '3',
          }),
        ],
        recentRequests: [
          expect.objectContaining({
            deviceId: 'tablet-01',
            packageName: 'com.example.app',
            locationDisplay: '35.46025, 139.54050',
            batteryDisplay: '72%',
            batteryTempDisplay: '32.2 C',
          }),
        ],
      })
    );
  });

  test('renders daily minute stats newest first', async () => {
    getMinuteLoggerDashboard.mockResolvedValue(createDashboard({
      dailyMinuteStats: [
        {
          dateKey: '2026-06-04',
          totalMinutes: 5,
          categories: [{ name: 'com.example.old', minutes: 5 }],
        },
        {
          dateKey: '2026-06-05',
          totalMinutes: 8,
          categories: [{ name: 'com.example.new', minutes: 8 }],
        },
      ],
    }));
    const res = createResponse();

    await controller.dashboard({ query: {} }, res);

    const viewModel = res.render.mock.calls[0][1];
    expect(viewModel.dailyMinuteStats.map((day) => day.dateKey)).toEqual([
      '2026-06-05',
      '2026-06-04',
    ]);
    expect(viewModel.dailyMinuteStats[0].detailsUrl).toBe('/admin/minute-logger/daily/2026-06-05');
  });

  test('saves a location group display name', async () => {
    updateMinuteLoggerLocationGroupSettings.mockResolvedValue({
      groupKey: '35.460,139.540',
      name: 'Home',
      hideCoordinates: true,
    });
    const res = createResponse();

    await controller.updateLocationGroupSettings({
      body: {
        groupKey: '35.460,139.540',
        name: 'Home',
        hideCoordinates: 'on',
      },
      user: { name: 'admin-user' },
    }, res);

    expect(updateMinuteLoggerLocationGroupSettings).toHaveBeenCalledWith(
      {
        groupKey: '35.460,139.540',
        name: 'Home',
        hideCoordinates: 'on',
      },
      {
        updatedBy: 'admin-user',
      }
    );
    expect(res.redirect).toHaveBeenCalledWith(
      '/admin/minute-logger?status=success&message=Location%20group%20saved.'
    );
  });
});

describe('minuteLoggerAdminController.dailyAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders daily analytics with timeline data', async () => {
    getMinuteLoggerDailyAnalytics.mockResolvedValue({
      endpointPath: '/secret-minute-logger',
      generatedAt: new Date('2026-06-07T03:00:00.000Z'),
      dateKey: '2026-06-06',
      totalMinutes: 3,
      locatedMinutes: 2,
      unlocatedMinutes: 1,
      namedLocationMinutes: 2,
      deviceCount: 1,
      packageCount: 2,
      firstSeen: new Date('2026-06-06T09:00:00.000Z'),
      lastSeen: new Date('2026-06-06T09:02:00.000Z'),
      quietGap: {
        longestGapMinutes: 0,
        longestGapStart: null,
        longestGapEnd: null,
      },
      packageStats: [
        { name: 'com.example.app', minutes: 2, deviceCount: 1, packageCount: 1, locatedMinutes: 2 },
      ],
      deviceStats: [
        { name: 'tablet-01', minutes: 3, deviceCount: 1, packageCount: 2, locatedMinutes: 2 },
      ],
      devicePackageMatrix: [
        {
          deviceId: 'tablet-01',
          minutes: 3,
          packages: [{ name: 'com.example.app', minutes: 2 }],
        },
      ],
      batteryStats: {
        battery: {
          count: 3,
          average: 71,
          min: 70,
          max: 72,
          latest: 72,
          latestAt: new Date('2026-06-06T09:02:00.000Z'),
          latestDeviceId: 'tablet-01',
        },
        batteryTempC: {
          count: 3,
          average: 32.2,
          min: 32,
          max: 32.5,
          latest: 32.5,
          latestAt: new Date('2026-06-06T09:02:00.000Z'),
          latestDeviceId: 'tablet-01',
        },
      },
      locationGroups: [
        {
          groupKey: '35.460,139.540',
          latitude: 35.4602,
          longitude: 139.5404,
          minutes: 2,
          deviceCount: 1,
          packageCount: 1,
          name: 'Home',
          hideCoordinates: false,
          pointSamples: [
            { latitude: 35.4602, longitude: 139.5404 },
          ],
        },
      ],
      hourlySpread: Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: hour === 9 ? 3 : 0 })),
      timeBucketStats: [
        { key: 'morning', label: 'Morning', minutes: 3, averagePerDay: 3 },
      ],
      busiestTimeBucket: { key: 'morning', label: 'Morning', minutes: 3, averagePerDay: 3 },
      packageTransitions: [{ from: 'com.example.app', to: 'com.example.other', count: 1 }],
      namedLocationTransitions: [],
      locationTimeline: {
        bounds: {
          minLatitude: 35.4602,
          maxLatitude: 35.4603,
          minLongitude: 139.5404,
          maxLongitude: 139.5405,
        },
        labels: [{ name: 'Home', latitude: 35.4602, longitude: 139.5404 }],
        points: [
          {
            latitude: 35.4602,
            longitude: 139.5404,
            minuteOfDay: 540,
            name: 'Home',
            package: 'com.example.app',
            deviceId: 'tablet-01',
            receivedAt: new Date('2026-06-06T09:00:00.000Z'),
          },
        ],
        defaultMinute: 540,
      },
      recentRequests: [],
    });
    const res = createResponse();

    await controller.dailyAnalytics({ params: { dateKey: '2026-06-06' } }, res);

    expect(getMinuteLoggerDailyAnalytics).toHaveBeenCalledWith('2026-06-06');
    expect(res.render).toHaveBeenCalledWith(
      'admin_minute_logger_daily',
      expect.objectContaining({
        dateKey: '2026-06-06',
        overviewCards: expect.arrayContaining([
          expect.objectContaining({ label: 'Total Minutes', value: '3 min' }),
          expect.objectContaining({ label: 'Named Locations', value: '2 min' }),
          expect.objectContaining({ label: 'Battery Left', value: '72%' }),
          expect.objectContaining({ label: 'Battery Temp', value: '32.5 C' }),
        ]),
        packageStats: [
          expect.objectContaining({
            name: 'com.example.app',
            minutesDisplay: '2 min',
          }),
        ],
        timelinePointCountDisplay: '1',
        timelineJson: expect.stringContaining('"name":"Home"'),
      })
    );
  });

  test('returns 404 for invalid daily date keys', async () => {
    getMinuteLoggerDailyAnalytics.mockResolvedValue(null);
    const res = createResponse();

    await controller.dailyAnalytics({ params: { dateKey: 'invalid' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.render).toHaveBeenCalledWith(
      'admin_minute_logger_daily',
      expect.objectContaining({
        dateKey: 'invalid',
        loadError: 'Daily analytics date must use YYYY-MM-DD.',
      })
    );
  });
});

describe('minuteLoggerAdminController.namedLocationAnalytics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders grouped named location analytics', async () => {
    getMinuteLoggerNamedLocationAnalytics.mockResolvedValue({
      endpointPath: '/secret-minute-logger',
      generatedAt: new Date('2026-06-07T03:00:00.000Z'),
      since: new Date('2026-04-08T03:00:00.000Z'),
      rawRetentionDays: 60,
      namedLocationCount: 1,
      namedLocationGroupCount: 2,
      activeNamedLocationCount: 1,
      totalMinutes: 12,
      locatedMinutes: 12,
      deviceCount: 1,
      packageCount: 2,
      busiestLocation: { name: 'Home', totalMinutes: 12 },
      groups: [
        {
          name: 'Home',
          groupKeys: ['35.460,139.540', '35.461,139.541'],
          totalMinutes: 12,
          locatedMinutes: 12,
          deviceCount: 1,
          packageCount: 2,
          firstSeen: new Date('2026-06-06T09:00:00.000Z'),
          lastSeen: new Date('2026-06-06T10:00:00.000Z'),
          packageStats: [{ name: 'com.example.app', minutes: 9, deviceCount: 1, packageCount: 1 }],
          deviceStats: [{ name: 'tablet-01', minutes: 12, deviceCount: 1, packageCount: 2 }],
          locationGroups: [
            {
              groupKey: '35.460,139.540',
              latitude: 35.4602,
              longitude: 139.5404,
              minutes: 9,
              deviceCount: 1,
              packageCount: 2,
              name: 'Home',
              hideCoordinates: false,
              pointSamples: [{ latitude: 35.4602, longitude: 139.5404 }],
            },
          ],
          hourlySpread: Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: hour === 9 ? 12 : 0 })),
          dailyTrend: [{ dateKey: '2026-06-06', minutes: 12 }],
          busiestTimeBucket: { key: 'morning', label: 'Morning', minutes: 12, averagePerDay: 0.2 },
          pointCloud: {
            bounds: {
              minLatitude: 35.4602,
              maxLatitude: 35.461,
              minLongitude: 139.5404,
              maxLongitude: 139.541,
            },
            points: [{ latitude: 35.4602, longitude: 139.5404, package: 'com.example.app', deviceId: 'tablet-01' }],
            labels: [{ name: 'Home', latitude: 35.460, longitude: 139.540 }],
          },
        },
      ],
    });
    const res = createResponse();

    await controller.namedLocationAnalytics({}, res);

    expect(res.render).toHaveBeenCalledWith(
      'admin_minute_logger_locations',
      expect.objectContaining({
        overviewCards: expect.arrayContaining([
          expect.objectContaining({ label: 'Named Locations', value: '1' }),
          expect.objectContaining({ label: 'Busiest Location', value: 'Home' }),
        ]),
        groups: [
          expect.objectContaining({
            name: 'Home',
            totalMinutesDisplay: '12 min',
            groupCountDisplay: '2',
            pointCloud: expect.objectContaining({
              points: expect.arrayContaining([
                expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
              ]),
            }),
          }),
        ],
      })
    );
  });
});
