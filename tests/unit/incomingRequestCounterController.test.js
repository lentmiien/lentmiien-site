jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
}));

jest.mock('../../services/incomingRequestCounterService', () => ({
  getCurrentRequestCounterStatus: jest.fn(),
  recordAndEvaluateRequest: jest.fn(),
}));

const counterService = require('../../services/incomingRequestCounterService');
const controller = require('../../controllers/incomingRequestCounterController');

function createResponse() {
  return {
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    send: jest.fn(),
  };
}

describe('incomingRequestCounterController.status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns the same plain OK format as the counting endpoint without JSON', async () => {
    counterService.getCurrentRequestCounterStatus.mockResolvedValue({
      status: 'OK',
      wouldReturnStatusCode: 200,
    });
    const req = { baseUrl: '/secret-counter' };
    const res = createResponse();

    await controller.status(req, res);

    expect(counterService.getCurrentRequestCounterStatus).toHaveBeenCalledWith('/secret-counter');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('OK');
  });

  test('returns plain NG with 429 when the current count is over the limit', async () => {
    counterService.getCurrentRequestCounterStatus.mockResolvedValue({
      status: 'NG',
      wouldReturnStatusCode: 429,
    });
    const req = { baseUrl: '/secret-counter' };
    const res = createResponse();

    await controller.status(req, res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(res.type).toHaveBeenCalledWith('text/plain');
    expect(res.send).toHaveBeenCalledWith('NG');
  });
});
