const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const logger = require('./logger');
const { buildEnvContent, normalizeHiddenPath } = require('./publicTobuyList');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_ENV_PATH = path.join(ROOT_DIR, '.env');
const MINUTE_LOGGER_PATH_ENV_KEY = 'MINUTE_LOGGER_PATH';

function persistMinuteLoggerPath(value, envPath = DEFAULT_ENV_PATH) {
  const currentContent = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8')
    : '';

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(
    envPath,
    buildEnvContent(currentContent, MINUTE_LOGGER_PATH_ENV_KEY, value),
    'utf8'
  );
}

function ensureMinuteLoggerPath(options = {}) {
  const envPath = options.envPath || DEFAULT_ENV_PATH;
  const processValue = normalizeHiddenPath(process.env[MINUTE_LOGGER_PATH_ENV_KEY]);

  let fileValue = '';
  if (fs.existsSync(envPath)) {
    try {
      const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
      fileValue = normalizeHiddenPath(parsed[MINUTE_LOGGER_PATH_ENV_KEY]);
    } catch (error) {
      logger.warning('Unable to parse .env while checking minute logger path', {
        category: 'minute-logger',
        metadata: { error: error.message, envKey: MINUTE_LOGGER_PATH_ENV_KEY },
      });
    }
  }

  if (fileValue) {
    process.env[MINUTE_LOGGER_PATH_ENV_KEY] = fileValue;
    return fileValue;
  }

  const nextValue = processValue || `/${crypto.randomBytes(24).toString('hex')}`;
  persistMinuteLoggerPath(nextValue, envPath);
  process.env[MINUTE_LOGGER_PATH_ENV_KEY] = nextValue;

  logger.notice('Prepared hidden minute logger path', {
    category: 'minute-logger',
    metadata: {
      envKey: MINUTE_LOGGER_PATH_ENV_KEY,
      created: !processValue,
    },
  });

  return nextValue;
}

module.exports = {
  MINUTE_LOGGER_PATH_ENV_KEY,
  ensureMinuteLoggerPath,
  persistMinuteLoggerPath,
};
