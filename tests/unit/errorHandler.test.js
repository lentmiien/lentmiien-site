const createErrorHandler = require('../../middleware/errorHandler');

function createResponse() {
  const res = {
    headersSent: false,
    status: jest.fn(),
    json: jest.fn(),
    render: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

describe('errorHandler', () => {
  test('returns a generic JSON response for unhandled API failures', () => {
    const logger = { error: jest.fn() };
    const handler = createErrorHandler(logger);
    const res = createResponse();

    handler(
      new Error('database password leaked in a failure'),
      { method: 'GET', originalUrl: '/api/private', get: jest.fn() },
      res,
      jest.fn()
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'An unexpected server error occurred.' });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('database password');
  });

  test('delegates errors after response headers have been sent', () => {
    const next = jest.fn();
    const error = new Error('stream failed');
    const handler = createErrorHandler({ error: jest.fn() });

    handler(error, {}, { headersSent: true }, next);

    expect(next).toHaveBeenCalledWith(error);
  });
});
