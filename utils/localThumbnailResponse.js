const logger = require('./logger');

// Authorization and record/source resolution happen before conditional handling.
function sendThumbnail(req, res, thumbnail) {
  if (req.aborted || res.destroyed) return;
  res.set({ 'Cache-Control': 'private, no-cache', ETag: thumbnail.etag,
    'Last-Modified': thumbnail.lastModified, 'Content-Type': 'image/webp',
    'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff' });
  if (req.fresh) return res.status(304).end();
  return res.send(thumbnail.buffer); // Express provides bodyless HEAD with length.
}
function thumbnailFailure(req, res, error) {
  if (req.aborted || res.destroyed) return;
  if (!error.status) logger.error('Local thumbnail record lookup failed', {
    category: 'image-gen-thumbnail', metadata: { errorName: error.name || 'Error' },
  });
  return res.status(error.status || 500).set('Cache-Control', 'private, no-store')
    .json({ error: 'Thumbnail unavailable.' });
}
const unavailable = () => Object.assign(new Error('Thumbnail unavailable.'), { status: 404 });
module.exports = { sendThumbnail, thumbnailFailure, unavailable };
