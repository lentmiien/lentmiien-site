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

  test('handles an error object without a name', () => {
    const logger = { error: jest.fn() };
    const res = createResponse();
    createErrorHandler(logger)({ status: 500 }, { method: 'GET' }, res, jest.fn());
    expect(logger.error.mock.calls[0][1].metadata.errorName).toBe('Error');
    expect(res.status).toHaveBeenCalledWith(500);
  });

  test('logs only registered route patterns and project stack locations', () => {
    const logger = { error: jest.fn() };
    const error = new Error('PRIVATE request content');
    const filename = require('path').resolve(__dirname, '../../controllers/chat5QuickSettingsController.js');
    error.stack = `Error: PRIVATE request content\n    at list (${filename}:63:7)`;
    createErrorHandler(logger)(error, {
      method: 'GET', originalUrl: '/chat5/private-value?token=PRIVATE', baseUrl: '/mounted/PRIVATE',
      route: { path: '/quick-settings/:id' }, get: () => '',
    }, createResponse(), jest.fn());
    expect(logger.error.mock.calls[0][1].metadata).toMatchObject({
      route: '/quick-settings/:id', location: { file: 'controllers/chat5QuickSettingsController.js', line: 63, column: 7 },
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/PRIVATE|private-value|\/home\/|token=/);
  });

  test('extracts the Pug location without logging source excerpts or template data', () => {
    const logger = { error: jest.fn() };
    const filename = require('path').resolve(__dirname, '../../views/chat5_quick_settings.pug');
    const error = Object.assign(new TypeError(`${filename}:81\n > 81| PRIVATE template source\nPRIVATE data`), { path: filename });
    createErrorHandler(logger)(error, { method: 'GET', route: { path: '/quick-settings' } }, createResponse(), jest.fn());
    expect(logger.error.mock.calls[0][1].metadata.location).toEqual({ file: 'views/chat5_quick_settings.pug', line: 81, column: null });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('PRIVATE');
  });

  test('redacts secret-public route registrations and excludes external stack paths', () => {
    const previous = process.env.REQUEST_COUNTER_PATH;
    process.env.REQUEST_COUNTER_PATH = '/PRIVATE-BEARER';
    try {
      const logger = { error: jest.fn() };
      const error = Object.assign(new Error('PRIVATE'), { stack: 'Error: PRIVATE\n    at load (/outside/PRIVATE.js:2:3)' });
      createErrorHandler(logger)(error, { method: 'GET', route: { path: '/PRIVATE-BEARER' } }, createResponse(), jest.fn());
      expect(logger.error.mock.calls[0][1].metadata).toMatchObject({ route: '/secret-public/request-counter', location: null });
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain('PRIVATE');
    } finally {
      if (previous === undefined) delete process.env.REQUEST_COUNTER_PATH;
      else process.env.REQUEST_COUNTER_PATH = previous;
    }
  });
});
