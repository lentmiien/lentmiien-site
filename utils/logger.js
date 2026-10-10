const fs = require('fs');
const path = require('path');
const util = require('util');
const { execFileSync } = require('child_process');
const { validRevision, readGitRevision } = require('./runtimeRevision');

// Jest can be invoked with NODE_ENV=production. Neither form may write app logs.
const isTestRuntime = () => process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined;
const processStartedAt = new Date(Date.now() - process.uptime() * 1000).toISOString();
let runtimeIdentity;

function getRuntimeIdentity() {
  if (!runtimeIdentity) {
    let revision = isTestRuntime() ? null : validRevision(process.env.APP_REVISION);
    if (!isTestRuntime()) {
      try {
        if (!revision) {
          const head = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], {
            cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 1000,
            stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
          }).trim();
          revision = validRevision(head);
        }
      } catch (_) { /* Packaged deployments may not contain Git metadata. */ }
      if (!revision) revision = readGitRevision(path.resolve(__dirname, '..'));
    }
    runtimeIdentity = Object.freeze({
      pid: process.pid,
      startedAt: processStartedAt,
      environment: isTestRuntime() ? 'test'
        : ['production', 'development'].includes(process.env.NODE_ENV) ? process.env.NODE_ENV : 'unspecified',
      revision,
    });
  }
  return runtimeIdentity;
}

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

const PAYLOAD_KEYS = new Set([
  'config', 'request', 'response', 'headers', 'body', 'data', 'payload',
  'requestbody', 'responsebody', 'requestdata', 'responsedata',
  'messages', 'prompt', 'text', 'content', 'images', 'image', 'audio',
]);

function sanitizeLogText(value) {
  // Oversized strings can contain whole serialized requests. Do not retain a prefix.
  if (value.length > 4096) return '[oversized log value omitted]';
  if (/^\s*[\[{]/.test(value)) return '[serialized payload omitted]';
  return value.replace(/https?:\/\/[^\s<>"']+/gi, raw => {
    try {
      const url = new URL(raw);
      url.username = ''; url.password = ''; url.search = ''; url.hash = '';
      return url.toString();
    } catch (_) { return '[invalid URL omitted]'; }
  }).replace(/(^|[\s("'])(\/[^\s<>"'?#]*)(?:\?[^\s<>"']*|#[^\s<>"']*)/g, '$1$2')
    .replace(/data:[^\s;,]+;base64,[a-z\d+/=]+/gi, '[binary data omitted]')
    .slice(0, 2048);
}

function sanitizeLogMetadata(value) {
  const seen = new WeakSet();
  let nodes = 0;
  let remainingText = 12000;
  const text = raw => {
    const safe = sanitizeLogText(raw);
    if (safe.length > remainingText) return '[log size limit]';
    remainingText -= safe.length;
    return safe;
  };
  const visit = (item, depth = 0, key = '') => {
    if (++nodes > 250 || depth > 6) return '[log size limit]';
    if (isSensitiveKey(key)) return '[redacted secret]';
    if (PAYLOAD_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return '[payload omitted]';
    if (typeof item === 'string') return text(item);
    if (typeof item === 'bigint') return text(String(item));
    if (item === null || typeof item === 'boolean' || typeof item === 'number') return item;
    if (typeof item !== 'object') return undefined;
    if (seen.has(item)) return '[Circular]';
    seen.add(item);
    if (Buffer.isBuffer(item) || ArrayBuffer.isView(item)) return '[binary data omitted]';
    if (util.types.isDate(item)) return Date.prototype.toISOString.call(item);
    // Walk the original object BEFORE JSON serialization: AxiosError.toJSON() includes
    // config.data, which can contain credentials and private JSON-string bodies.
    if (item instanceof Error || util.types.isNativeError(item)) {
      const status = item.status ?? item.statusCode ?? item.response?.status;
      return {
        name: text(String(item.name || 'Error')),
        message: text(String(item.message || '')),
        stack: typeof item.stack === 'string' ? text(item.stack) : undefined,
        code: typeof item.code === 'string' || typeof item.code === 'number' ? visit(item.code, depth + 1) : null,
        status: Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
        ...(item.cause ? { cause: visit(item.cause, depth + 1) } : {}),
      };
    }
    const result = Array.isArray(item) ? [] : Object.create(null);
    let count = 0;
    // Never call user-supplied toJSON, inspect hooks or accessors.
    for (const name in item) {
      if (!Object.hasOwn(item, name) || name === 'toJSON') continue;
      if (++count > 40 || nodes >= 250) break;
      const property = Object.getOwnPropertyDescriptor(item, name);
      const safe = property && Object.hasOwn(property, 'value')
        ? visit(property.value, depth + 1, name) : '[accessor omitted]';
      if (Array.isArray(result)) result.push(safe);
      else result[text(name).slice(0, 100)] = safe;
    }
    return result;
  };
  try {
    const safe = visit(value);
    return Buffer.byteLength(JSON.stringify(safe) || '') <= 32768 ? safe : '[log size limit]';
  } catch (error) {
    return '[Unable to serialize log metadata safely]';
  }
}

function formatMessage(message) {
  if (typeof message === 'string') {
    return sanitizeLogText(message);
  }
  if (message instanceof Error) {
    return sanitizeLogText(String(message.message));
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
    runtime: getRuntimeIdentity(),
  };

  if (options.category) {
    entry.category = typeof options.category === 'string' ? sanitizeLogText(options.category).slice(0, 100) : 'unspecified';
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

  if (isTestRuntime()) return;

  try {
    await ensureLogDir();
    const filePath = getLogFilePath();
    const serialized = `${JSON.stringify(entry)}\n`;
    await fs.promises.appendFile(filePath, serialized, 'utf8');
  } catch (err) {
    const fallbackEntry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message: 'Failed to write log entry',
      metadata: sanitizeLogMetadata({ originalError: err }),
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
