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

function createReplacer() {
  const seen = new WeakSet();
  return (key, value) => {
    if (value instanceof Error) {
      const errorData = {
        name: value.name,
        message: value.message,
        stack: value.stack,
      };
      Object.getOwnPropertyNames(value).forEach((prop) => {
        if (!Object.prototype.hasOwnProperty.call(errorData, prop)) {
          errorData[prop] = value[prop];
        }
      });
      return errorData;
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

function formatMessage(message) {
  if (typeof message === 'string') {
    return message;
  }
  if (message instanceof Error) {
    return message.message;
  }
  return util.inspect(message, { depth: 5, breakLength: 80 });
}

function shouldLog(level) {
  return LEVEL_PRIORITY[level] >= MIN_LEVEL_PRIORITY;
}

function logToConsole(entry) {
  const { level, message, category, metadata } = entry;
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
    case 'notice':
      console.info(...args);
      break;
    default:
      if (console.debug) {
        console.debug(...args);
      } else {
        console.log(...args);
      }
  }
}

async function writeLog(level, message, options = {}) {
  const normalizedLevel = level.toLowerCase();

  if (!LEVEL_PRIORITY[normalizedLevel]) {
    throw new Error(`Unknown log level: ${level}`);
  }

  if (!shouldLog(normalizedLevel)) {
    return;
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level: normalizedLevel,
    message: formatMessage(message),
  };

  if (options && options.category) {
    entry.category = options.category;
  }

  if (options && options.metadata !== undefined) {
    entry.metadata = options.metadata;
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
  log(level, message, options) {
    return writeLog(level, message, options);
  },
  notice(message, options) {
    return writeLog('notice', message, options);
  },
  warning(message, options) {
    return writeLog('warning', message, options);
  },
  error(message, options) {
    return writeLog('error', message, options);
  },
  debug(message, options) {
    return writeLog('debug', message, options);
  },
  levels: LOG_LEVELS.reduce((acc, level) => {
    acc[level.toUpperCase()] = level;
    return acc;
  }, {}),
};

module.exports = logger;
