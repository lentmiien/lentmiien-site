jest.mock('../../services/minuteLoggerService', () => ({
  MINUTE_LOGGER_RESPONSE_BODY: { message: 'OK' },
  recordMinuteLoggerRequest: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
}));

const logger = require('../../utils/logger');
const {
  recordMinuteLoggerRequest,
} = require('../../services/minuteLoggerService');
const controller = require('../../controllers/minuteLoggerController');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
}

describe('minuteLoggerController.log', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    recordMinuteLoggerRequest.mockResolvedValue({
      logged: true,
      responseBody: { message: 'OK' },
    });
  });

  test('logs the POST request and returns JSON OK', async () => {
    const req = {
      baseUrl: '/secret-minute-logger',
      method: 'POST',
      originalUrl: '/secret-minute-logger',
    };
    const res = createResponse();

    await controller.log(req, res);

    expect(recordMinuteLoggerRequest).toHaveBeenCalledWith(req, {
      endpointPath: '/secret-minute-logger',
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.json).toHaveBeenCalledWith({ message: 'OK' });
  });

  test('returns a retriable failure without logging the secret route', async () => {
    const sentinelSecret = 'sentinel-secret-minute-logger-path';
    const persistenceError = new Error(
      `database unavailable while writing /${sentinelSecret}?token=also-secret`
    );
    persistenceError.code = sentinelSecret;
    persistenceError.name = sentinelSecret;
    recordMinuteLoggerRequest.mockRejectedValueOnce(persistenceError);
    const req = {
      baseUrl: `/${sentinelSecret}`,
      method: 'POST',
      originalUrl: `/${sentinelSecret}?token=also-secret`,
      route: { path: '/' },
    };
    const res = createResponse();

    await controller.log(req, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(res.set).toHaveBeenCalledWith('Retry-After', '60');
    expect(res.json).toHaveBeenCalledWith({ message: 'Service unavailable' });
    expect(logger.error).toHaveBeenCalledWith(
      'Minute logger request failed to persist',
      {
        category: 'minute-logger',
        metadata: {
          errorName: 'Error',
          errorCode: null,
          method: 'POST',
          route: '/',
        },
      }
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(sentinelSecret);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('also-secret');
  });
});
