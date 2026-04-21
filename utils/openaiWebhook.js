const logger = require('./logger');

const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;
const DEFAULT_WEBHOOK_FALLBACK_TOLERANCE_SECONDS = 3600;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getHeaderValue(headers, name) {
  if (!headers || !name) return null;

  if (typeof headers.get === 'function') {
    return headers.get(name);
  }

  const key = name.toLowerCase();
  const value = headers[key] ?? headers[name];
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

function getWebhookTimestampAgeSeconds(headers, nowMs = Date.now()) {
  const timestamp = getHeaderValue(headers, 'webhook-timestamp');
  const parsed = Number.parseInt(timestamp, 10);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return Math.floor(nowMs / 1000) - parsed;
}

function isTimestampToleranceError(error) {
  if (!error || typeof error.message !== 'string') {
    return false;
  }
  return error.message === 'Webhook timestamp is too old' || error.message === 'Webhook timestamp is too new';
}

async function unwrapOpenAIWebhook({
  client,
  payload,
  headers,
  secret = process.env.OPENAI_WEBHOOK_SECRET,
  strictToleranceSeconds = parsePositiveInteger(
    process.env.OPENAI_WEBHOOK_TOLERANCE_SECONDS,
    DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  ),
  fallbackToleranceSeconds = parsePositiveInteger(
    process.env.OPENAI_WEBHOOK_FALLBACK_TOLERANCE_SECONDS,
    DEFAULT_WEBHOOK_FALLBACK_TOLERANCE_SECONDS,
  ),
  loggerInstance = logger,
}) {
  try {
    return await client.webhooks.unwrap(payload, headers, secret, strictToleranceSeconds);
  } catch (error) {
    if (!isTimestampToleranceError(error) || fallbackToleranceSeconds <= strictToleranceSeconds) {
      throw error;
    }

    const ageSeconds = getWebhookTimestampAgeSeconds(headers);
    loggerInstance.warning('OpenAI webhook timestamp outside strict tolerance, retrying with fallback window', {
      strictToleranceSeconds,
      fallbackToleranceSeconds,
      ageSeconds,
      message: error.message,
    });

    const event = await client.webhooks.unwrap(payload, headers, secret, fallbackToleranceSeconds);
    loggerInstance.warning('OpenAI webhook accepted with fallback timestamp tolerance', {
      strictToleranceSeconds,
      fallbackToleranceSeconds,
      ageSeconds,
      eventId: event?.id,
      type: event?.type,
    });

    return event;
  }
}

module.exports = {
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  DEFAULT_WEBHOOK_FALLBACK_TOLERANCE_SECONDS,
  getHeaderValue,
  getWebhookTimestampAgeSeconds,
  parsePositiveInteger,
  unwrapOpenAIWebhook,
};
