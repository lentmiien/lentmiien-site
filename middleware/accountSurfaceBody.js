const express = require('express');
const json = express.json({ limit: '40kb' });
const form = express.urlencoded({ extended: false, limit: '40kb', parameterLimit: 200 });
// Run before the application's larger legacy parsers, including chunked bodies.
function accountSurfaceBody(req, res, next) {
  if (!/^\/mypage\/(?:api\/|icon-settings(?:\/|$)|embedding-search(?:\/|$))/i.test(req.path)) return next();
  const failed = error => res.status(error.status === 413 ? 413 : 400)
    .set('Cache-Control', 'private, no-store').json({ ok: false, error: 'Invalid account request body.' });
  json(req, res, error => {
    if (error) return failed(error);
    form(req, res, error => error ? failed(error) : next());
  });
}
module.exports = accountSurfaceBody;
