// Only bounded numeric/date/cache policy observations; never raw headers or URLs.
function feedHttpDiagnostics(response, retrievedAt = new Date()) {
  const headers = response?.headers || {};
  const header = name => {
    const value = typeof headers.get === 'function' ? headers.get(name)
      : headers[Object.keys(headers).find(key => key.toLowerCase() === name)];
    return typeof value === 'string' && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value) ? value : '';
  };
  const date = value => {
    if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) return null;
    const parsed = new Date(value);
    return Number.isFinite(+parsed) ? parsed.toISOString() : null;
  };
  const seconds = value => /^\d{1,10}$/.test(value || '') ? Number(value) : null;
  const cache = header('cache-control').toLowerCase();
  const cacheStatus = header('cf-cache-status').toUpperCase();
  return {
    retrievedAt: retrievedAt.toISOString(),
    httpStatus: Number.isInteger(response?.status) ? response.status : null,
    httpDate: date(header('date')), lastModified: date(header('last-modified')),
    ageSeconds: seconds(header('age')),
    maxAgeSeconds: seconds(cache.match(/(?:^|,)\s*max-age=(\d+)\s*(?:,|$)/)?.[1]),
    sharedMaxAgeSeconds: seconds(cache.match(/(?:^|,)\s*s-maxage=(\d+)\s*(?:,|$)/)?.[1]),
    noCache: /(?:^|,)\s*no-cache\s*(?:,|$)/.test(cache),
    noStore: /(?:^|,)\s*no-store\s*(?:,|$)/.test(cache),
    cacheStatus: ['HIT', 'MISS', 'EXPIRED', 'STALE', 'BYPASS', 'DYNAMIC', 'REVALIDATED', 'UPDATING'].includes(cacheStatus) ? cacheStatus : null,
  };
}

module.exports = { feedHttpDiagnostics };
