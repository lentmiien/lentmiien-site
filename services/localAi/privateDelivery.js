const { problem } = require('./policy');
function deliver(req, res, bytes, descriptor) {
  const etag = `"${descriptor.sha256}"`;
  res.set({ 'Content-Type': descriptor.media_type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', ETag: etag, 'Accept-Ranges': 'bytes' });
  let start = 0, end = bytes.length - 1;
  const range = req.get('Range');
  if (range && (!req.get('If-Range') || req.get('If-Range') === etag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match && (match[1] || match[2])) {
      if (!match[1]) start = Math.max(0, bytes.length - Number(match[2]));
      else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
    } else start = NaN;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start < 0 || start >= bytes.length) {
      res.set('Content-Range', `bytes */${bytes.length}`); throw problem('invalid_range', 416);
    }
    res.status(206).set('Content-Range', `bytes ${start}-${end}/${bytes.length}`);
  }
  res.set('Content-Length', String(end - start + 1));
  if (req.method === 'HEAD') res.end(); else res.send(bytes.subarray(start, end + 1));
}
let readers = 0;
async function readAndDeliver(req, res, load, descriptor) {
  if (readers >= 2) throw problem('private_media_delivery_busy', 503);
  readers++;
  let released = false;
  const release = () => { if (!released) { released = true; readers--; } };
  res.once('finish', release); res.once('close', release);
  try { deliver(req, res, await load(), descriptor); } catch (error) { release(); throw error; }
}
module.exports = { deliver, readAndDeliver };
