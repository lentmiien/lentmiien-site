jest.mock('../../database', () => ({
  DisasterAlert: {},
  DisasterIngestionState: {},
  DisasterWeatherObservation: {},
  DisasterWeatherSnapshot: {},
}));

jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));

const { DisasterIngestionService } = require('../../services/disasterIngestionService');

describe('DisasterIngestionService weather provider fallback', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test('disables One Call after a permanent authorization failure and uses standard forecast', async () => {
    process.env.DISASTER_WEATHER_ENABLED = 'true';
    process.env.OPENWEATHER_API_KEY = 'weather-key';
    process.env.OPENWEATHER_USE_ONECALL = 'true';

    const logger = { warning: jest.fn() };
    const snapshotModel = {
      create: jest.fn(async (value) => ({ _id: 'snapshot-id', ...value })),
    };
    const service = new DisasterIngestionService({
      logger,
      models: {
        DisasterWeatherSnapshot: snapshotModel,
        DisasterWeatherObservation: {},
      },
    });
    service.refreshWeatherObservation = jest.fn().mockResolvedValue(null);

    const authError = Object.assign(new Error('One Call 3.0 subscription required'), {
      response: { status: 401, data: { message: 'One Call 3.0 subscription required' } },
    });
    const forecast = { list: [], city: { name: 'Yokohama', country: 'JP' } };
    service.fetchJson = jest.fn()
      .mockRejectedValueOnce(authError)
      .mockResolvedValueOnce(forecast)
      .mockResolvedValueOnce(forecast);

    await expect(service.refreshWeatherSnapshot()).resolves.toMatchObject({ source: 'openweathermap' });
    await expect(service.refreshWeatherSnapshot()).resolves.toMatchObject({ source: 'openweathermap' });

    expect(service.fetchJson.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openweathermap.org/data/3.0/onecall',
      'https://api.openweathermap.org/data/2.5/forecast',
      'https://api.openweathermap.org/data/2.5/forecast',
    ]);
    expect(logger.warning).toHaveBeenCalledTimes(1);
    expect(logger.warning).toHaveBeenCalledWith(
      'OpenWeather One Call authorization failed; disabling One Call until restart',
      expect.objectContaining({ metadata: expect.objectContaining({ status: 401 }) })
    );
  });
});
