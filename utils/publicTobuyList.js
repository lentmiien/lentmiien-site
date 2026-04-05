const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const logger = require('./logger');

const ROOT_DIR = path.join(__dirname, '..');
const DEFAULT_ENV_PATH = path.join(ROOT_DIR, '.env');
const DEFAULT_LIMIT_FILE_PATH = path.join(ROOT_DIR, 'cache', 'public_tobuy_add_limit.json');

const PUBLIC_TOBUY_LIST_OWNER = 'Lennart';
const PUBLIC_TOBUY_LIST_PATH_ENV_KEY = 'PUBLIC_TOBUY_LIST_PATH';
const PUBLIC_TOBUY_ADD_INTERVAL_MS = 1000;
const PUBLIC_TOBUY_DAILY_ADD_LIMIT = 10;

function normalizeHiddenPath(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  const normalized = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return /^\/[A-Za-z0-9_-]+$/.test(normalized) ? normalized : '';
}

function buildEnvContent(existingContent, key, value) {
  const nextLine = `${key}=${value}`;
  if (!existingContent) {
    return `${nextLine}\n`;
  }

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyPattern = new RegExp(`^${escapedKey}=.*$`, 'm');
  const updated = keyPattern.test(existingContent)
    ? existingContent.replace(keyPattern, nextLine)
    : `${existingContent}${existingContent.endsWith('\n') ? '' : '\n'}${nextLine}\n`;

  return updated.endsWith('\n') ? updated : `${updated}\n`;
}

function persistHiddenPath(value, envPath = DEFAULT_ENV_PATH) {
  const currentContent = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8')
    : '';

  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(
    envPath,
    buildEnvContent(currentContent, PUBLIC_TOBUY_LIST_PATH_ENV_KEY, value),
    'utf8'
  );
}

function ensurePublicTobuyListPath(options = {}) {
  const envPath = options.envPath || DEFAULT_ENV_PATH;
  const processValue = normalizeHiddenPath(process.env[PUBLIC_TOBUY_LIST_PATH_ENV_KEY]);

  let fileValue = '';
  if (fs.existsSync(envPath)) {
    try {
      const parsed = dotenv.parse(fs.readFileSync(envPath, 'utf8'));
      fileValue = normalizeHiddenPath(parsed[PUBLIC_TOBUY_LIST_PATH_ENV_KEY]);
    } catch (error) {
      logger.warning('Unable to parse .env while checking public to-buy path', {
        category: 'public-tobuy',
        metadata: { error: error.message, envKey: PUBLIC_TOBUY_LIST_PATH_ENV_KEY },
      });
    }
  }

  if (fileValue) {
    process.env[PUBLIC_TOBUY_LIST_PATH_ENV_KEY] = fileValue;
    return fileValue;
  }

  const nextValue = processValue || `/${crypto.randomBytes(24).toString('hex')}`;
  persistHiddenPath(nextValue, envPath);
  process.env[PUBLIC_TOBUY_LIST_PATH_ENV_KEY] = nextValue;

  logger.notice('Prepared hidden public to-buy path', {
    category: 'public-tobuy',
    metadata: {
      envKey: PUBLIC_TOBUY_LIST_PATH_ENV_KEY,
      created: !processValue,
    },
  });

  return nextValue;
}

function formatDayKey(date) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getMsUntilNextLocalDay(date) {
  const value = new Date(date);
  const nextMidnight = new Date(value.getFullYear(), value.getMonth(), value.getDate() + 1);
  return Math.max(0, nextMidnight.getTime() - value.getTime());
}

function loadLimitState(filePath = DEFAULT_LIMIT_FILE_PATH) {
  if (!fs.existsSync(filePath)) {
    return {
      dayKey: null,
      count: 0,
      lastRequestAt: 0,
    };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      dayKey: typeof raw.dayKey === 'string' ? raw.dayKey : null,
      count: Number.isFinite(raw.count) ? raw.count : 0,
      lastRequestAt: Number.isFinite(raw.lastRequestAt) ? raw.lastRequestAt : 0,
    };
  } catch (error) {
    logger.warning('Unable to read public to-buy rate limit state, resetting it', {
      category: 'public-tobuy',
      metadata: { error: error.message, filePath },
    });
    return {
      dayKey: null,
      count: 0,
      lastRequestAt: 0,
    };
  }
}

function saveLimitState(state, filePath = DEFAULT_LIMIT_FILE_PATH) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function consumePublicTobuyAddQuota(now = new Date(), options = {}) {
  const filePath = options.filePath || DEFAULT_LIMIT_FILE_PATH;
  const nowDate = new Date(now);
  const nowMs = nowDate.getTime();
  const dayKey = formatDayKey(nowDate);
  const state = loadLimitState(filePath);

  if (state.dayKey !== dayKey) {
    state.dayKey = dayKey;
    state.count = 0;
    state.lastRequestAt = 0;
  }

  const elapsedMs = nowMs - state.lastRequestAt;
  if (state.lastRequestAt && elapsedMs < PUBLIC_TOBUY_ADD_INTERVAL_MS) {
    return {
      allowed: false,
      reason: 'too_fast',
      retryAfterMs: PUBLIC_TOBUY_ADD_INTERVAL_MS - elapsedMs,
      remainingToday: Math.max(0, PUBLIC_TOBUY_DAILY_ADD_LIMIT - state.count),
    };
  }

  if (state.count >= PUBLIC_TOBUY_DAILY_ADD_LIMIT) {
    return {
      allowed: false,
      reason: 'daily_limit',
      retryAfterMs: getMsUntilNextLocalDay(nowDate),
      remainingToday: 0,
    };
  }

  state.lastRequestAt = nowMs;
  state.count += 1;
  saveLimitState(state, filePath);

  return {
    allowed: true,
    reason: null,
    retryAfterMs: 0,
    remainingToday: Math.max(0, PUBLIC_TOBUY_DAILY_ADD_LIMIT - state.count),
  };
}

module.exports = {
  PUBLIC_TOBUY_ADD_INTERVAL_MS,
  PUBLIC_TOBUY_DAILY_ADD_LIMIT,
  PUBLIC_TOBUY_LIST_OWNER,
  PUBLIC_TOBUY_LIST_PATH_ENV_KEY,
  buildEnvContent,
  consumePublicTobuyAddQuota,
  ensurePublicTobuyListPath,
  formatDayKey,
  loadLimitState,
  normalizeHiddenPath,
  saveLimitState,
};
