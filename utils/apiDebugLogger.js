const ApiDebugLog = require('../models/api_debug_log');
const logger = require('./logger');

// --- Tunable limits --------------------------------------------------------
const MAX_STRING_BYTES = 64 * 1024; // Replace huge strings beyond this size
const MAX_BUFFER_BYTES = 64 * 1024; // Replace Buffers larger than this many bytes
const MAX_ARRAY_LENGTH = 200; // Replace arrays longer than this many elements
const MAX_ARRAY_BYTES = 256 * 1024; // Replace arrays whose serialized size exceeds this
const MAX_OBJECT_KEYS = 200; // Replace objects with too many keys
const MAX_OBJECT_BYTES = 256 * 1024; // Replace objects whose serialized size is huge

// Custom path-based redactions. Extend this list as needed.
const CUSTOM_PATH_REDACTIONS = [
  {
    path: ['data', 'data'],
    replacement: 'Custom redact string',
  },
];

const createApiDebugLogger = (jsFileName) => (payload) =>
  recordApiDebugLog({ jsFileName, ...payload });

const recordApiDebugLog = async ({
  jsFileName = 'unknown',
  requestUrl = 'unknown',
  requestHeaders = null,
  requestBody = null,
  responseHeaders = null,
  responseBody = null,
  functionName = 'unknown',
}) => {
  try {
    await ApiDebugLog.create({
      requestUrl,
      requestHeaders: sanitizePayload(requestHeaders),
      requestBody: sanitizePayload(requestBody),
      responseHeaders: sanitizePayload(responseHeaders),
      responseBody: sanitizePayload(responseBody),
      jsFileName,
      functionName,
    });
  } catch (err) {
    logger.error('Failed to record API debug log entry', {
      category: 'api-debug',
      metadata: {
        requestUrl,
        functionName,
        jsFileName,
        message: err?.message || err,
      },
    });
  }
};

const sanitizePayload = (payload) =>
  sanitizeValue(payload, [], {
    seen: new WeakSet(),
  });

const sanitizeValue = (value, path, context) => {
  const customReplacement = getCustomReplacement(path, value);
  if (customReplacement !== null && customReplacement !== undefined) {
    return typeof customReplacement === 'function'
      ? customReplacement(value, path)
      : customReplacement;
  }

  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return summarizeString(value, path);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return summarizeBuffer(value, path);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (Array.isArray(value)) {
    return sanitizeArray(value, path, context);
  }

  if (ArrayBuffer.isView(value)) {
    return sanitizeArray(Array.from(value), path, context);
  }

  if (value instanceof ArrayBuffer) {
    return summarizeBuffer(Buffer.from(value), path);
  }

  if (typeof value === 'function') {
    return `[function ${value.name || 'anonymous'}]`;
  }

  if (typeof value === 'object') {
    return sanitizeObject(value, path, context);
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
};

const sanitizeArray = (arr, path, context) => {
  if (arr.length > MAX_ARRAY_LENGTH) {
    return `[redacted array ${formatPath(path)}: ${arr.length} elements]`;
  }

  const sanitized = arr.map((item, index) =>
    sanitizeValue(item, path.concat(String(index)), context)
  );

  if (MAX_ARRAY_BYTES) {
    const byteSize = getByteSize(sanitized);
    if (byteSize > MAX_ARRAY_BYTES) {
      return `[redacted array ${formatPath(path)}: ${byteSize} bytes]`;
    }
  }

  return sanitized;
};

const sanitizeObject = (obj, path, context) => {
  if (context.seen.has(obj)) {
    return '[circular reference]';
  }

  context.seen.add(obj);

  if (obj instanceof Map) {
    const entries = {};
    for (const [key, val] of obj.entries()) {
      entries[String(key)] = sanitizeValue(val, path.concat(String(key)), context);
    }
    context.seen.delete(obj);
    return enforceObjectSize(entries, path);
  }

  if (obj instanceof Set) {
    const values = Array.from(obj);
    context.seen.delete(obj);
    return sanitizeArray(values, path, context);
  }

  const keys = Object.keys(obj);
  if (keys.length > MAX_OBJECT_KEYS) {
    context.seen.delete(obj);
    return `[redacted object ${formatPath(path)}: ${keys.length} keys]`;
  }

  const sanitized = {};
  for (const key of keys) {
    sanitized[key] = sanitizeValue(obj[key], path.concat(key), context);
  }

  context.seen.delete(obj);
  return enforceObjectSize(sanitized, path);
};

const summarizeString = (str, path) => {
  const bytes = Buffer.byteLength(str, 'utf8');
  if (bytes > MAX_STRING_BYTES) {
    return `[redacted string ${formatPath(path)}: ${bytes} bytes]`;
  }
  return str;
};

const summarizeBuffer = (buffer, path) => {
  if (buffer.length > MAX_BUFFER_BYTES) {
    return `[redacted buffer ${formatPath(path)}: ${buffer.length} bytes]`;
  }

  const base64 = buffer.toString('base64');
  if (Buffer.byteLength(base64, 'utf8') > MAX_STRING_BYTES) {
    return `[redacted buffer ${formatPath(path)}: ${buffer.length} bytes]`;
  }

  return {
    type: 'Buffer',
    encoding: 'base64',
    size: buffer.length,
    data: base64,
  };
};

const enforceObjectSize = (value, path) => {
  if (!MAX_OBJECT_BYTES) {
    return value;
  }

  const byteSize = getByteSize(value);
  if (byteSize > MAX_OBJECT_BYTES) {
    return `[redacted object ${formatPath(path)}: ${byteSize} bytes]`;
  }

  return value;
};

const getCustomReplacement = (path, value) => {
  for (const rule of CUSTOM_PATH_REDACTIONS) {
    if (pathsEqual(path, rule.path)) {
      if (typeof rule.replacement === 'function') {
        return rule.replacement(value, path);
      }
      return rule.replacement;
    }
  }
  return null;
};

const pathsEqual = (current, target) => {
  if (!Array.isArray(current) || !Array.isArray(target)) {
    return false;
  }
  if (current.length !== target.length) {
    return false;
  }
  return current.every((segment, index) => segment === target[index]);
};

const formatPath = (path) =>
  Array.isArray(path) && path.length > 0 ? path.join('.') : 'root';

const getByteSize = (value) => {
  try {
    const stringified = JSON.stringify(value);
    if (!stringified) {
      return 0;
    }
    return Buffer.byteLength(stringified, 'utf8');
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
};

module.exports = {
  createApiDebugLogger,
  recordApiDebugLog,
  sanitizePayload,
  REDACTION_LIMITS: {
    MAX_STRING_BYTES,
    MAX_BUFFER_BYTES,
    MAX_ARRAY_LENGTH,
    MAX_ARRAY_BYTES,
    MAX_OBJECT_KEYS,
    MAX_OBJECT_BYTES,
  },
  CUSTOM_PATH_REDACTIONS,
};
