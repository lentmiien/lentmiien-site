const secretPublicResponse = require('../../middleware/secretPublicResponse');

describe('secretPublicResponse', () => {
  test('disables analytics, caching, referrers, and indexing', () => {
    const next = jest.fn();
    const res = {
      locals: { gtag: true },
      set: jest.fn(),
    };

    secretPublicResponse({}, res, next);

    expect(res.locals.gtag).toBe(false);
    expect(res.set).toHaveBeenCalledWith({
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
    expect(next).toHaveBeenCalledTimes(1);
  });
});
