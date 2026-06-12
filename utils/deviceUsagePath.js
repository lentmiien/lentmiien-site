const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const logger = require('./logger');
const { buildEnvContent, normalizeHiddenPath } = require('./publicTobuyList');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_ENV_PATH = path.join(ROOT_DIR, '.env');
const DEVICE_USAGE_PATH_ENV_KEY = 'DEVICE_USAGE_PATH';

function persistDeviceUsagePath(value, envPath = DEFAULT_ENV_PATH) {
  const currentContent = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8')
    : '';

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(
    envPath,
    buildEnvContent(currentContent, DEVICE_USAGE_PATH_ENV_KEY, value),
    'utf8'
  );
}

function ensureDeviceUsagePath(options = {}) {
  const envPath = options.envPath || DEFAULT_ENV_PATH;
  const processValue = normalizeHiddenPath(process.env[DEVICE_USAGE_PATH_ENV_KEY]);

  let fileValue = '';
  if (fs.existsSync(envPath)) {
    try {
      const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
      fileValue = normalizeHiddenPath(parsed[DEVICE_USAGE_PATH_ENV_KEY]);
    } catch (error) {
      logger.warning('Unable to parse .env while checking device usage path', {
        category: 'device-usage',
        metadata: { error: error.message, envKey: DEVICE_USAGE_PATH_ENV_KEY },
      });
    }
  }

  if (fileValue) {
    process.env[DEVICE_USAGE_PATH_ENV_KEY] = fileValue;
    return fileValue;
  }

  const nextValue = processValue || `/${crypto.randomBytes(24).toString('hex')}`;
  persistDeviceUsagePath(nextValue, envPath);
  process.env[DEVICE_USAGE_PATH_ENV_KEY] = nextValue;

  logger.notice('Prepared hidden device usage path', {
    category: 'device-usage',
    metadata: {
      envKey: DEVICE_USAGE_PATH_ENV_KEY,
      created: !processValue,
    },
  });

  return nextValue;
}

module.exports = {
  DEVICE_USAGE_PATH_ENV_KEY,
  ensureDeviceUsagePath,
  persistDeviceUsagePath,
};
