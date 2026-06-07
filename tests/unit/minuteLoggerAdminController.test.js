jest.mock('../../services/minuteLoggerService', () => ({
  MinuteLoggerLocationGroupSettingsError: class MinuteLoggerLocationGroupSettingsError extends Error {},
  MINUTE_LOGGER_RAW_RETENTION_DAYS: 60,
  MINUTE_LOGGER_RECENT_LIMIT: 50,
  MINUTE_LOGGER_REQUEST_COLLECTION_NAME: 'minute_logger_requests',
  MINUTE_LOGGER_STAT_COLLECTION_NAME: 'minute_logger_stats',
  MINUTE_LOGGER_STATS_RETENTION_YEARS: 10,
  getMinuteLoggerDashboard: jest.fn(),
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
  getMinuteLoggerDashboard,
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
        ip: '203.0.113.50',
        requestPath: '/secret-minute-logger',
        userAgent: 'minute-client/1.0',
        body: { package: 'com.example.app', deviceId: 'tablet-01' },
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
            label: 'Location Groups',
            value: '1',
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
          }),
        ],
      })
    );
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
