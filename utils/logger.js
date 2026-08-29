const fs = require('fs');
const path = require('path');
const util = require('util');

const LOG_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_LEVELS = ['debug', 'notice', 'warning', 'error'];
const LEVEL_PRIORITY = {
  debug: 10,
  notice: 20,
  warning: 30,
  error: 40,
};

const minLevelName = (process.env.LOG_LEVEL || 'debug').toLowerCase();
const MIN_LEVEL_PRIORITY = LEVEL_PRIORITY[minLevelName] || LEVEL_PRIORITY.debug;

let ensureDirPromise;

function ensureLogDir() {
  if (!ensureDirPromise) {
    ensureDirPromise = fs.promises.mkdir(LOG_DIR, { recursive: true }).catch((err) => {
      ensureDirPromise = null;
      throw err;
    });
  }
  return ensureDirPromise;
}

function getLogFilePath(date = new Date()) {
  const isoDate = date.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `app-${isoDate}.log`);
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isOptionsObject(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  return Object.prototype.hasOwnProperty.call(value, 'category') ||
    Object.prototype.hasOwnProperty.call(value, 'metadata');
}

function normalizeOptions(args) {
  if (!args || args.length === 0) {
    return {};
  }

  if (args.length === 1) {
    const candidate = args[0];

    if (candidate instanceof Error) {
      return { metadata: candidate };
    }

    if (isOptionsObject(candidate)) {
      return candidate;
    }

    if (typeof candidate === 'object' && candidate !== null) {
      return { metadata: candidate };
    }

    return { metadata: candidate };
  }

  return { metadata: args };
}

function isSensitiveKey(key) {
  const normalized = String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['authorization', 'proxyauthorization', 'cookie', 'setcookie'].includes(normalized)
    || normalized.endsWith('apikey')
    || normalized.endsWith('password')
    || normalized.endsWith('passwd')
    || normalized.endsWith('secret')
    || normalized.endsWith('token');
}

function createReplacer() {
  const seen = new WeakSet();
  return (key, value) => {
    if (isSensitiveKey(key)) {
      return '[redacted secret]';
    }
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
        code: value.code || null,
        status: value.status || value.statusCode || null,
      };
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }

    return value;
  };
}

function sanitizeLogMetadata(value) {
  try {
    return JSON.parse(JSON.stringify(value, createReplacer()));
  } catch (error) {
    return '[Unable to serialize log metadata safely]';
  }
}

function formatMessage(message) {
  if (typeof message === 'string') {
    return message;
  }
  if (message instanceof Error) {
    return message.message;
  }
  return util.inspect(sanitizeLogMetadata(message), { depth: 5, breakLength: 80 });
}

function shouldLog(level) {
  return LEVEL_PRIORITY[level] >= MIN_LEVEL_PRIORITY;
}

function logToConsole(entry) {
  const { level, message, category, metadata } = entry;

  if (level !== 'warning' && level !== 'error') {
    return;
  }

  const prefix = `[${entry.timestamp}] ${level.toUpperCase()}${category ? `(${category})` : ''}`;
  const args = [prefix, message];

  if (metadata !== undefined) {
    args.push(util.inspect(metadata, { depth: 4, breakLength: 80 }));
  }

  switch (level) {
    case 'error':
      console.error(...args);
      break;
    case 'warning':
      console.warn(...args);
      break;
    default:
      console.log(...args);
  }
}

async function writeLog(level, message, ...args) {
  const normalizedLevel = level.toLowerCase();

  if (!LEVEL_PRIORITY[normalizedLevel]) {
    throw new Error(`Unknown log level: ${level}`);
  }

  if (!shouldLog(normalizedLevel)) {
    return;
  }

  const options = normalizeOptions(args);

  const entry = {
    timestamp: new Date().toISOString(),
    level: normalizedLevel,
    message: formatMessage(message),
  };

  if (options.category) {
    entry.category = options.category;
  }

  let metadataSet = false;

  if (Object.prototype.hasOwnProperty.call(options, 'metadata')) {
    entry.metadata = sanitizeLogMetadata(options.metadata);
    metadataSet = true;
  }

  if (!metadataSet && typeof message === 'object' && message !== null) {
    entry.metadata = sanitizeLogMetadata(message);
  }

  logToConsole(entry);

  try {
    await ensureLogDir();
    const filePath = getLogFilePath();
    const serialized = `${JSON.stringify(entry, createReplacer())}\n`;
    await fs.promises.appendFile(filePath, serialized, 'utf8');
  } catch (err) {
    const fallbackEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: 'Failed to write log entry',
      metadata: { originalError: err },
    };
    console.error('[LOGGER]', fallbackEntry);
  }
}

const logger = {
  log(level, message, ...args) {
    return writeLog(level, message, ...args);
  },
  notice(message, ...args) {
    return writeLog('notice', message, ...args);
  },
  warning(message, ...args) {
    return writeLog('warning', message, ...args);
  },
  warn(message, ...args) {
    return writeLog('warning', message, ...args);
  },
  error(message, ...args) {
    return writeLog('error', message, ...args);
  },
  debug(message, ...args) {
    return writeLog('debug', message, ...args);
  },
  levels: LOG_LEVELS.reduce((acc, level) => {
    acc[level.toUpperCase()] = level;
    return acc;
  }, {}),
};

module.exports = logger;
