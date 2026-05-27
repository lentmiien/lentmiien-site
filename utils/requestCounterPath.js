const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const logger = require('./logger');
const { buildEnvContent, normalizeHiddenPath } = require('./publicTobuyList');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_ENV_PATH = path.join(ROOT_DIR, '.env');
const REQUEST_COUNTER_PATH_ENV_KEY = 'REQUEST_COUNTER_PATH';

function persistRequestCounterPath(value, envPath = DEFAULT_ENV_PATH) {
  const currentContent = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8')
    : '';

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(
    envPath,
    buildEnvContent(currentContent, REQUEST_COUNTER_PATH_ENV_KEY, value),
    'utf8'
  );
}

function ensureRequestCounterPath(options = {}) {
  const envPath = options.envPath || DEFAULT_ENV_PATH;
  const processValue = normalizeHiddenPath(process.env[REQUEST_COUNTER_PATH_ENV_KEY]);

  let fileValue = '';
  if (fs.existsSync(envPath)) {
    try {
      const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
      fileValue = normalizeHiddenPath(parsed[REQUEST_COUNTER_PATH_ENV_KEY]);
    } catch (error) {
      logger.warning('Unable to parse .env while checking request counter path', {
        category: 'incoming-request-counter',
        metadata: { error: error.message, envKey: REQUEST_COUNTER_PATH_ENV_KEY },
      });
    }
  }

  if (fileValue) {
    process.env[REQUEST_COUNTER_PATH_ENV_KEY] = fileValue;
    return fileValue;
  }

  const nextValue = processValue || `/${crypto.randomBytes(24).toString('hex')}`;
  persistRequestCounterPath(nextValue, envPath);
  process.env[REQUEST_COUNTER_PATH_ENV_KEY] = nextValue;

  logger.notice('Prepared hidden request counter path', {
    category: 'incoming-request-counter',
    metadata: {
      envKey: REQUEST_COUNTER_PATH_ENV_KEY,
      created: !processValue,
    },
  });

  return nextValue;
}

module.exports = {
  REQUEST_COUNTER_PATH_ENV_KEY,
  ensureRequestCounterPath,
  persistRequestCounterPath,
};
