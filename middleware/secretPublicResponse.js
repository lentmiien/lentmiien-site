function secretPublicResponse(req, res, next) {
  res.locals.gtag = false;
  res.set({
    'Cache-Control': 'private, no-store, max-age=0',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow, noarchive',
  });
  next();
}

module.exports = secretPublicResponse;
