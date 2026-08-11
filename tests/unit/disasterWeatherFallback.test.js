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

describe('DisasterIngestionService OpenWeather integration', () => {
  const originalEnv = { ...process.env };
  const location = {
    name: 'Yokohama Asahi',
    latitude: 35.4759,
    longitude: 139.5443,
  };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function createService(logger = { warning: jest.fn() }) {
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
    service.saveWeatherObservation = jest.fn(async (value) => value);
    return { service, snapshotModel };
  }

  test('uses the standard forecast and current endpoints and parses both response shapes', async () => {
    process.env.DISASTER_WEATHER_ENABLED = 'true';
    process.env.DISASTER_WEATHER_LOCATION_NAME = location.name;
    process.env.DISASTER_WEATHER_LATITUDE = String(location.latitude);
    process.env.DISASTER_WEATHER_LONGITUDE = String(location.longitude);
    process.env.OPENWEATHER_API_KEY = 'weather-key';
    process.env.OPENWEATHER_USE_ONECALL = 'true';

    const firstForecastAt = Math.floor(Date.now() / 1000) + 60 * 60;
    const forecast = {
      cod: '200',
      city: {
        name: 'Yokohama',
        country: 'JP',
        timezone: 32400,
        sunrise: firstForecastAt - 60 * 60,
        sunset: firstForecastAt + 10 * 60 * 60,
      },
      list: [
        {
          dt: firstForecastAt,
          main: { temp: 28.4, feels_like: 31.2, humidity: 78, pressure: 1008 },
          weather: [{ id: 500, description: 'light rain' }],
          wind: { speed: 4.1, gust: 7.3 },
          rain: { '3h': 1.2 },
          snow: { '3h': 0.3 },
          pop: 0.67,
        },
      ],
    };
    const current = {
      cod: 200,
      dt: firstForecastAt - 30 * 60,
      main: { temp: 27.8, feels_like: 30.1, humidity: 80, pressure: 1007 },
      weather: [{ id: 501, description: 'moderate rain' }],
      wind: { speed: 3.9, gust: 6.8 },
      rain: { '1h': 0.7 },
      snow: { '1h': 0.1 },
    };
    const logger = { warning: jest.fn() };
    const { service, snapshotModel } = createService(logger);
    service.fetchJson = jest.fn()
      .mockResolvedValueOnce(forecast)
      .mockResolvedValueOnce(current);

    const snapshot = await service.refreshWeatherSnapshot();

    expect(service.fetchJson.mock.calls.map(([url]) => url)).toEqual([
      'https://api.openweathermap.org/data/2.5/forecast',
      'https://api.openweathermap.org/data/2.5/weather',
    ]);
    expect(service.fetchJson).toHaveBeenNthCalledWith(1, expect.any(String), {
      params: expect.objectContaining({
        lat: location.latitude,
        lon: location.longitude,
        appid: 'weather-key',
        units: 'metric',
      }),
    });
    expect(snapshot).toMatchObject({
      source: 'openweathermap',
      locationName: location.name,
      current: {
        cityName: 'Yokohama',
        country: 'JP',
        timezoneOffsetSeconds: 32400,
      },
      hourly: [{
        temperatureC: 28.4,
        feelsLikeC: 31.2,
        precipitationMm: 1.5,
        precipitationProbability: 67,
        windSpeedMs: 4.1,
        windGustMs: 7.3,
        humidityPercent: 78,
        pressureHpa: 1008,
        weatherCode: '500',
        description: 'light rain',
      }],
    });
    expect(snapshot.current.sunriseAt).toEqual(new Date(forecast.city.sunrise * 1000));
    expect(snapshot.current.sunsetAt).toEqual(new Date(forecast.city.sunset * 1000));
    expect(snapshotModel.create).toHaveBeenCalledTimes(1);
    const savedObservation = service.saveWeatherObservation.mock.calls[0][0];
    expect(savedObservation).toMatchObject({
      source: 'openweathermap-current',
      observedAt: new Date(current.dt * 1000),
      temperatureC: 27.8,
      feelsLikeC: 30.1,
      precipitationProbability: null,
      windSpeedMs: 3.9,
      windGustMs: 6.8,
      humidityPercent: 80,
      pressureHpa: 1007,
      weatherCode: '501',
      description: 'moderate rain',
    });
    expect(savedObservation.precipitationMm).toBeCloseTo(0.8);
    expect(logger.warning).not.toHaveBeenCalled();
  });

  test('rejects a malformed forecast response instead of saving an empty snapshot', () => {
    const { service } = createService();

    expect(() => service.parseOpenWeatherForecast({ cod: '200' }, location))
      .toThrow('OpenWeather forecast response did not include forecast entries');
  });

  test('falls back to the forecast observation when current weather is malformed', async () => {
    process.env.DISASTER_WEATHER_ENABLED = 'true';
    process.env.OPENWEATHER_API_KEY = 'weather-key';

    const logger = { warning: jest.fn() };
    const { service } = createService(logger);
    const forecastTime = new Date();
    const snapshot = {
      source: 'openweathermap',
      locationName: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      hourly: [{
        time: forecastTime,
        temperatureC: 25,
        precipitationMm: 0,
        description: 'clear sky',
      }],
    };
    service.fetchJson = jest.fn().mockResolvedValue({ cod: 200, message: 'missing weather data' });

    const observation = await service.refreshWeatherObservation(location, snapshot);

    expect(observation).toMatchObject({
      source: 'openweathermap-hourly',
      temperatureC: 25,
      precipitationMm: 0,
      description: 'clear sky',
    });
    expect(logger.warning).toHaveBeenCalledWith(
      'OpenWeather current weather refresh failed, using forecast fallback',
      expect.objectContaining({
        category: 'disaster_ingestion',
        metadata: { error: 'OpenWeather current weather response was malformed' },
      })
    );
  });
});
