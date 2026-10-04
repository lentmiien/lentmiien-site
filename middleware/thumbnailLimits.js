const { rateLimit } = require('express-rate-limit');
const thumbnailLimit = rateLimit({ windowMs: 60 * 1000, limit: 240,
  keyGenerator: req => String(req.user._id || req.user.name),
  standardHeaders: 'draft-8', legacyHeaders: false });
let activeThumbnails = 0;
function boundThumbnails(_req, res, next) {
  if (activeThumbnails >= 32) return res.status(503).json({ error: 'Thumbnail service busy.' });
  activeThumbnails += 1;
  let released = false;
  const release = () => { if (!released) { released = true; activeThumbnails -= 1; } };
  res.once('finish', release);
  res.once('close', release);
  return next();
}
module.exports = { thumbnailLimit, boundThumbnails };
