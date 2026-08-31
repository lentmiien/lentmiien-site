const {
  createDatabaseHealthHandler,
  createDatabaseReadinessMiddleware,
  isDatabaseReady,
} = require('../../middleware/databaseReadiness');

function createResponse() {
  return {
    headers: {},
    status: jest.fn(function status(code) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function json(body) {
      this.body = body;
      return this;
    }),
    setHeader: jest.fn(function setHeader(name, value) {
      this.headers[name] = value;
    }),
  };
}

describe('database readiness middleware', () => {
  test.each([
    [0, false],
    [1, true],
    [2, false],
    [3, false],
  ])('maps Mongoose readyState %i to readiness %s', (readyState, expected) => {
    expect(isDatabaseReady({ connection: { readyState } })).toBe(expected);
  });

  test('returns a no-store 503 health response without exposing connection details', () => {
    const handler = createDatabaseHealthHandler({
      mongooseLib: { connection: { readyState: 0 } },
    });
    const res = createResponse();

    handler({}, res);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.body).toEqual({ status: 'unavailable', database: 'unavailable' });
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(JSON.stringify(res.body)).not.toContain('Mongo');
  });

  test('returns 200 only when the database is ready', () => {
    const handler = createDatabaseHealthHandler({
      mongooseLib: { connection: { readyState: 1 } },
    });
    const res = createResponse();

    handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.body).toEqual({ status: 'ok', database: 'ready' });
  });

  test('fails application traffic fast with a generic retriable response', () => {
    const middleware = createDatabaseReadinessMiddleware({
      mongooseLib: { connection: { readyState: 0 } },
    });
    const res = createResponse();
    const next = jest.fn();

    middleware({}, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.headers).toMatchObject({
      'Cache-Control': 'no-store',
      'Retry-After': '5',
    });
    expect(res.body).toEqual({
      status: 'unavailable',
      message: 'Service temporarily unavailable.',
    });
  });

  test('passes through immediately when MongoDB is ready', () => {
    const middleware = createDatabaseReadinessMiddleware({
      mongooseLib: { connection: { readyState: 1 } },
    });
    const next = jest.fn();

    middleware({}, createResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
