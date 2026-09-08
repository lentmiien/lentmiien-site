const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Only scripts that transport session CSRF tokens or load those scripts belong here.
const FORM_SCRIPTS = ['account_dashboard.js', 'my_life_log.js', 'mypage_tasks.js', 'codex.js', 'tool_manager.js'];

function createFormAssets(publicRoot = path.join(__dirname, '../public')) {
  const assets = new Map();
  try {
    for (const name of FORM_SCRIPTS) {
      const body = fs.readFileSync(path.join(publicRoot, 'js', name));
      const revision = crypto.createHash('sha256').update(body).digest('hex');
      assets.set(name, { body, url: `/assets/forms/${revision}/${name}` });
    }
  } catch (_) {
    logger.error('Required form script unavailable; restore public/js before starting', { category: 'form_assets' });
    throw new Error('Required form script unavailable');
  }
  return {
    url(name) {
      if (!assets.has(name)) throw new Error('Unknown form script');
      return assets.get(name).url;
    },
    serve(req, res) {
      const asset = assets.get(req.params.filename);
      if (!asset || asset.url !== `/assets/forms/${req.params.revision}/${req.params.filename}`) {
        return res.status(404).set('Cache-Control', 'no-store').end();
      }
      // Serve the exact bytes hashed at startup, including during an in-place deployment.
      return res.type('application/javascript').set('Cache-Control', 'public, max-age=31536000, immutable').send(asset.body);
    },
  };
}

module.exports = { createFormAssets, FORM_SCRIPTS };
