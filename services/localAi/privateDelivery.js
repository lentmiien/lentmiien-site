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
function createDelivery({ concurrency = 2, maxPending = 32, waitMs = 15000 } = {}) {
  let readers = 0;
  const pending = [];
  const drain = () => {
    while (readers < concurrency && pending.length) pending.shift()();
  };
  return function readAndDeliver(req, res, load, descriptor) {
    return new Promise((resolve, reject) => {
      if (res.destroyed || req.aborted) return resolve();
      if (readers >= concurrency && pending.length >= maxPending) {
        res.set('Retry-After', '2');
        return reject(problem('private_media_delivery_busy', 503));
      }
      let started = false, loading = false, finished = false, released = false, timer;
      const cleanup = () => {
        clearTimeout(timer);
        res.removeListener('finish', complete); res.removeListener('close', complete);
        req.removeListener?.('aborted', complete);
      };
      const release = () => {
        // A disconnect cannot free a buffer slot while its disk read is still pending.
        if (released || loading) return;
        released = true;
        cleanup();
        if (started) readers--;
        drain();
      };
      const complete = () => {
        finished = true;
        if (!started) {
          const index = pending.indexOf(start);
          if (index >= 0) pending.splice(index, 1);
          resolve();
        }
        release();
      };
      const start = async () => {
        started = true; readers++; loading = true; clearTimeout(timer);
        try {
          const bytes = await load();
          if (!finished && !res.destroyed && !req.aborted) deliver(req, res, bytes, descriptor);
          else finished = true;
          resolve();
        } catch (error) {
          finished = true;
          reject(error);
        } finally {
          loading = false;
          if (finished) release();
        }
      };
      res.once('finish', complete); res.once('close', complete);
      req.once?.('aborted', complete);
      if (readers < concurrency) start();
      else {
        pending.push(start);
        timer = setTimeout(() => {
          const index = pending.indexOf(start);
          if (index >= 0) pending.splice(index, 1);
          cleanup();
          res.set('Retry-After', '2');
          reject(problem('private_media_delivery_busy', 503));
        }, waitMs);
        timer.unref?.();
      }
    });
  };
}
module.exports = { deliver, createDelivery, readAndDeliver: createDelivery() };
