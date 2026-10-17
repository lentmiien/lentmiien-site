const multer = require('multer');
const { problem } = require('../services/localAi/policy');
const { MAX_BYTES, assertSpace } = require('../services/localAi/inputStorage');
// One bounded multipart parser/decode pipeline per web process. No waiting queue
// retains request bodies. DB reservations independently bound multiple processes.
const { acquire } = require('../services/localAi/inputWork');
const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 0, parts: 2, headerPairs: 20 } }).single('file');
function createInputUpload(service) {
  return async (req, res, next) => {
    let timer, release;
    try {
      release = acquire();
      // Router has authenticated principal/capability/CSRF before reaching here.
      const record = await service.inputs.prepare(req.localAiActor, req.get('Idempotency-Key'), req.get('X-Content-SHA256'));
      if (record.state !== 'ready') await assertSpace();
      if (Number(req.get('content-length')) > MAX_BYTES + 65536) throw problem('input_too_large', 413);
      await new Promise((resolve, reject) => {
        let total = 0;
        const count = chunk => { total += chunk.length; if (total > MAX_BYTES + 65536) { req.destroy(); reject(problem('input_too_large', 413)); } };
        timer = setTimeout(() => { req.destroy(); reject(problem('input_upload_timeout', 408)); }, 60000);
        req.on('data', count);
        parser(req, res, error => { req.removeListener('data', count); clearTimeout(timer); error ? reject(problem(error.code === 'LIMIT_FILE_SIZE' ? 'input_too_large' : 'invalid_multipart', error.code === 'LIMIT_FILE_SIZE' ? 413 : 422)) : resolve(); });
      });
      if (!req.file || Object.keys(req.body || {}).length) throw problem('invalid_multipart');
      req.localAiInput = await service.inputs.accept(req.localAiActor, record, req.file.buffer);
      next();
    } catch (e) { next(e); }
    finally { clearTimeout(timer); release?.(); }
  };
}
module.exports = { createInputUpload };
