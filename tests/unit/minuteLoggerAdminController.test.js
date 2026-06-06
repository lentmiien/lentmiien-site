jest.mock('../../services/minuteLoggerService', () => ({
  MINUTE_LOGGER_RAW_RETENTION_DAYS: 60,
  MINUTE_LOGGER_RECENT_LIMIT: 50,
  MINUTE_LOGGER_REQUEST_COLLECTION_NAME: 'minute_logger_requests',
  MINUTE_LOGGER_STAT_COLLECTION_NAME: 'minute_logger_stats',
  MINUTE_LOGGER_STATS_RETENTION_YEARS: 10,
  getMinuteLoggerDashboard: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
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
} = require('../../services/minuteLoggerService');
const controller = require('../../controllers/minuteLoggerAdminController');

function createResponse() {
  return {
    render: jest.fn(),
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
        ]),
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
          }),
        ],
      })
    );
  });
});
