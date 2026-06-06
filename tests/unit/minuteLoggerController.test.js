jest.mock('../../services/minuteLoggerService', () => ({
  MINUTE_LOGGER_RESPONSE_BODY: { message: 'OK' },
  recordMinuteLoggerRequest: jest.fn(),
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
}));

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

  test('still returns JSON OK when persistence fails', async () => {
    recordMinuteLoggerRequest.mockRejectedValueOnce(new Error('database unavailable'));
    const req = {
      baseUrl: '/secret-minute-logger',
      method: 'POST',
      originalUrl: '/secret-minute-logger',
    };
    const res = createResponse();

    await controller.log(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'OK' });
  });
});
