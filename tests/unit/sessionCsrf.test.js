const {
  TOKEN_PATTERN,
  createSessionCsrf,
  normalizeOrigin,
  safeEqual,
} = require('../../middleware/sessionCsrf');

function response() {
  return {
    locals: {},
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    render: jest.fn().mockReturnThis(),
  };
}

function request({
  token,
  origin = 'https://admin.example.test',
  host = 'admin.example.test',
  session = {},
} = {}) {
  const headers = { origin, host };
  return {
    body: token === undefined ? {} : { _csrf: token },
    protocol: 'https',
    route: { path: '/pods' },
    session,
    user: { name: 'admin' },
    get: jest.fn((name) => headers[String(name).toLowerCase()] || null),
  };
}

describe('session CSRF middleware', () => {
  test('issues a high-entropy session token once and exposes it to the view', () => {
    const randomBytes = jest.fn().mockReturnValue(Buffer.alloc(32, 7));
    const csrf = createSessionCsrf({ randomBytes, appLogger: { error: jest.fn() } });
    const req = request();
    const res = response();
    const next = jest.fn();

    csrf.issueToken(req, res, next);
    csrf.issueToken(req, res, next);

    expect(req.session.csrfToken).toMatch(TOKEN_PATTERN);
    expect(res.locals.csrfToken).toBe(req.session.csrfToken);
    expect(randomBytes).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(2);
  });

  test('accepts a valid token from the current browser origin', () => {
    const token = Buffer.alloc(32, 4).toString('base64url');
    const csrf = createSessionCsrf({ appLogger: { warning: jest.fn() } });
    const req = request({ token, session: { csrfToken: token } });
    const next = jest.fn();

    csrf.requireToken(req, response(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('rejects a cross-origin form even when its token is valid', () => {
    const token = Buffer.alloc(32, 4).toString('base64url');
    const appLogger = { warning: jest.fn() };
    const csrf = createSessionCsrf({ appLogger });
    const req = request({
      token,
      origin: 'https://attacker.example',
      session: { csrfToken: token },
    });
    const res = response();
    const next = jest.fn();

    csrf.requireToken(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store, max-age=0');
    expect(appLogger.warning).toHaveBeenCalledWith(
      'Rejected browser mutation from an untrusted origin',
      expect.objectContaining({ category: 'csrf' })
    );
  });

  test('rejects a missing or malformed token without logging token data', () => {
    const secret = 'not-a-valid-secret-token';
    const appLogger = { warning: jest.fn() };
    const csrf = createSessionCsrf({ appLogger });
    const req = request({ token: secret, session: { csrfToken: Buffer.alloc(32, 1).toString('base64url') } });
    const res = response();

    csrf.requireToken(req, res, jest.fn());

    expect(res.render).toHaveBeenCalledWith('accessDenied', expect.objectContaining({
      title: 'Request Rejected',
    }));
    expect(JSON.stringify(appLogger.warning.mock.calls)).not.toContain(secret);
  });

  test('fails closed when session middleware is unavailable', () => {
    const appLogger = { error: jest.fn() };
    const csrf = createSessionCsrf({ appLogger });
    const req = request();
    delete req.session;
    const res = response();

    csrf.issueToken(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(appLogger.error).toHaveBeenCalledWith(
      'Session unavailable while issuing CSRF token',
      { category: 'csrf' }
    );
  });

  test('normalizes only HTTP origins and compares only canonical tokens', () => {
    const token = Buffer.alloc(32, 8).toString('base64url');
    expect(normalizeOrigin('https://example.test/path?q=1')).toBe('https://example.test');
    expect(normalizeOrigin('file:///tmp/example')).toBeNull();
    expect(safeEqual(token, token)).toBe(true);
    expect(safeEqual(token, 'bad')).toBe(false);
  });
});
