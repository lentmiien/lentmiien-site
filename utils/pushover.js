const axios = require('axios');

const PUSHOVER_API_URL = 'https://api.pushover.net/1/messages.json';
const PUSHOVER_TIMEOUT_MS = 10_000;

const PUSHOVER_PRIORITIES = Object.freeze({
  LOWEST: -2,
  LOW: -1,
  MEDIUM: 0,
  HIGH: 1,
  EMERGENCY: 2,
});

const VALID_PRIORITIES = new Set(Object.values(PUSHOVER_PRIORITIES));

function getRequiredCredential(name) {
  const value = process.env[name];

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Pushover is not configured: set ${name}`);
  }

  return value.trim();
}

function validateNotification({ message, title, priority, retry, expire }) {
  if (typeof message !== 'string' || message.trim() === '') {
    throw new TypeError('Pushover notification message must be a non-empty string');
  }

  if (title !== undefined && typeof title !== 'string') {
    throw new TypeError('Pushover notification title must be a string');
  }

  if (!VALID_PRIORITIES.has(priority)) {
    throw new RangeError('Pushover notification priority must be between -2 and 2');
  }

  if (priority === PUSHOVER_PRIORITIES.EMERGENCY) {
    if (!Number.isInteger(retry) || retry < 30) {
      throw new RangeError('Emergency Pushover retry must be at least 30 seconds');
    }

    if (!Number.isInteger(expire) || expire < 1 || expire > 10_800) {
      throw new RangeError('Emergency Pushover expiry must be between 1 and 10800 seconds');
    }
  }
}

async function sendPushoverNotification({
  message,
  title,
  priority = PUSHOVER_PRIORITIES.MEDIUM,
  retry = 60,
  expire = 3_600,
} = {}) {
  validateNotification({ message, title, priority, retry, expire });

  const token = getRequiredCredential('PUSHOVER_APP_TOKEN');
  const user = getRequiredCredential('PUSHOVER_USER_KEY');
  const body = new URLSearchParams({
    token,
    user,
    message: message.trim(),
    priority: String(priority),
  });

  if (title && title.trim()) {
    body.set('title', title.trim());
  }

  if (priority === PUSHOVER_PRIORITIES.EMERGENCY) {
    body.set('retry', String(retry));
    body.set('expire', String(expire));
  }

  const response = await axios.post(PUSHOVER_API_URL, body, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    timeout: PUSHOVER_TIMEOUT_MS,
  });

  if (!response.data || response.data.status !== 1) {
    throw new Error('Pushover rejected the notification');
  }

  return response.data;
}

module.exports = {
  PUSHOVER_PRIORITIES,
  sendPushoverNotification,
};
