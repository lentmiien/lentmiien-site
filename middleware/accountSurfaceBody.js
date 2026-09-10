const express = require('express');
const json = express.json({ limit: '40kb' });
const form = express.urlencoded({ extended: false, limit: '40kb', parameterLimit: 200 });
const closeForm = express.urlencoded({ extended: false, limit: '4kb', parameterLimit: 5 });
const closeJson = express.json({ limit: '4kb' });
// Run before the application's larger legacy parsers, including chunked bodies.
function accountSurfaceBody(req, res, next) {
  if (/^\/(?:accounting|budget)\/close-month(?:\/|$)/i.test(req.path)) {
    const failed = error => res.status(error.status === 413 ? 413 : 400).set('Cache-Control', 'private, no-store').send('Invalid accounting request body.');
    return closeJson(req, res, error => {
      if (error) return failed(error);
      closeForm(req, res, error => error ? failed(error) : next());
    });
  }
  if (!/^\/mypage\/(?:api\/|icon-settings(?:\/|$)|embedding-search(?:\/|$))/i.test(req.path)) return next();
  const failed = error => res.status(error.status === 413 ? 413 : 400)
    .set('Cache-Control', 'private, no-store').json({ ok: false, error: 'Invalid account request body.' });
  json(req, res, error => {
    if (error) return failed(error);
    form(req, res, error => error ? failed(error) : next());
  });
}
module.exports = accountSurfaceBody;
