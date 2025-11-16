const path = require('path');
const axios = require('axios');
const Mailgun = require('mailgun.js');
const FormData = require('form-data');
const mongoose = require('mongoose');
const checkDiskSpaceLib = require('check-disk-space').default || require('check-disk-space');
const logger = require('./logger');

const DEFAULT_REQUIRED_ENV_VARS = ['MONGOOSE_URL', 'SESSION_SECRET', 'OPENAI_API_KEY'];
const DEFAULT_MIN_DISK_MB = parseInt(process.env.STARTUP_MIN_DISK_MB || '200', 10);
const MIN_DISK_BYTES = Number.isNaN(DEFAULT_MIN_DISK_MB)
  ? 200 * 1024 * 1024
  : DEFAULT_MIN_DISK_MB * 1024 * 1024;

function normalizeList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return String(value)
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function validateEnvVars(requiredVars = DEFAULT_REQUIRED_ENV_VARS, options = {}) {
  const envSource = options.env || process.env || {};
  const checks = Array.from(new Set(requiredVars));
  const missing = [];

  checks.forEach((key) => {
    const value = envSource[key];
    if (value === undefined || value === null || String(value).trim() === '') {
      missing.push(key);
    }
  });

  const result = {
    ok: missing.length === 0,
    missing,
    checked: checks,
  };

  if (options.log !== false) {
    if (result.ok) {
      logger.notice(`Env validation passed (${checks.length} vars).`, { category: 'startup:env' });
    } else {
      logger.error('Env validation failed', {
        category: 'startup:env',
        metadata: { missing },
      });
    }
  }

  return result;
}

async function checkDiskSpaceForPath(targetPath = process.cwd(), minBytes = MIN_DISK_BYTES, options = {}) {
  const diskInfoProvider = options.diskInfoProvider || checkDiskSpaceLib;
  const resolvedPath = path.resolve(targetPath);
  const rootPath = path.parse(resolvedPath).root || resolvedPath;

  try {
    const info = await diskInfoProvider(rootPath);
    const available = info.free ?? info.available ?? 0;
    const ok = available >= minBytes;

    const result = {
      ok,
      availableBytes: available,
      requiredBytes: minBytes,
      path: rootPath,
    };

    if (!ok) {
      logger.warning('Disk space check failed', {
        category: 'startup:disk',
        metadata: result,
      });
    } else {
      logger.notice('Disk space check passed', {
        category: 'startup:disk',
        metadata: result,
      });
    }

    return result;
  } catch (error) {
    logger.error('Unable to determine disk space', {
      category: 'startup:disk',
      metadata: { error: error.message, path: rootPath },
    });
    return {
      ok: false,
      error: error.message,
      path: rootPath,
    };
  }
}

async function verifyMongoConnection(uri, options = {}) {
  const { timeoutMs = 10000, mongooseLib = mongoose } = options;

  if (!uri) {
    const result = { ok: false, error: 'Missing MongoDB connection string' };
    logger.error('Mongo preflight failed: missing MONGOOSE_URL', {
      category: 'startup:mongo',
    });
    return result;
  }

  const start = Date.now();
  try {
    await mongooseLib.connect(uri, {
      serverSelectionTimeoutMS: timeoutMs,
      connectTimeoutMS: timeoutMs,
    });
    const durationMs = Date.now() - start;
    await mongooseLib.disconnect();
    const result = { ok: true, durationMs };
    logger.notice('Mongo preflight succeeded', {
      category: 'startup:mongo',
      metadata: result,
    });
    return result;
  } catch (error) {
    logger.error('Mongo preflight failed', {
      category: 'startup:mongo',
      metadata: { error: error.message },
    });
    try {
      if (typeof mongooseLib.disconnect === 'function') {
        await mongooseLib.disconnect();
      }
    } catch (_) {
      // ignore cleanup errors
    }
    return { ok: false, error: error.message };
  }
}

async function runPreflightChecks(options = {}) {
  const requiredEnv = normalizeList(process.env.STARTUP_REQUIRED_ENV_VARS)
    .concat(options.additionalEnv || []);
  const envList = requiredEnv.length > 0 ? requiredEnv : DEFAULT_REQUIRED_ENV_VARS;

  const results = [];
  const envResult = validateEnvVars(envList, { log: false, env: options.env });
  results.push({
    name: 'Environment variables',
    status: envResult.ok ? 'ok' : 'failed',
    details: envResult,
  });

  if (envResult.ok) {
    logger.notice('Env preflight passed', { category: 'startup:preflight' });
  } else {
    logger.error('Env preflight failed', {
      category: 'startup:preflight',
      metadata: { missing: envResult.missing },
    });
  }

  const diskResult = await checkDiskSpaceForPath(
    options.diskPath || process.cwd(),
    options.minDiskBytes || MIN_DISK_BYTES,
    { diskInfoProvider: options.diskInfoProvider }
  );
  results.push({
    name: 'Disk space',
    status: diskResult.ok ? 'ok' : 'failed',
    details: diskResult,
  });

  let mongoResult = { ok: true };
  const skipMongo = options.skipMongo || process.env.STARTUP_SKIP_MONGO_CHECK === 'true';
  if (!skipMongo) {
    mongoResult = await verifyMongoConnection(options.mongoUri || process.env.MONGOOSE_URL, {
      timeoutMs: options.mongoTimeoutMs,
    });
    results.push({
      name: 'MongoDB connectivity',
      status: mongoResult.ok ? 'ok' : 'failed',
      details: mongoResult,
    });
  } else {
    results.push({
      name: 'MongoDB connectivity',
      status: 'skipped',
      details: { reason: 'STARTUP_SKIP_MONGO_CHECK=true' },
    });
  }

  const ok = envResult.ok && diskResult.ok && mongoResult.ok;
  return { ok, results };
}

async function sendSlackAlert(subject, message) {
  const webhook = process.env.STARTUP_SLACK_WEBHOOK_URL;
  if (!webhook) {
    return { delivered: false, reason: 'slack-not-configured' };
  }
  try {
    await axios.post(webhook, {
      text: `*${subject}*\n${message}`,
    });
    return { delivered: true, transport: 'slack' };
  } catch (error) {
    logger.error('Failed to send Slack alert', {
      category: 'startup:alert',
      metadata: { error: error.message },
    });
    return { delivered: false, transport: 'slack', error: error.message };
  }
}

async function sendMailgunAlert(subject, message) {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const recipients = normalizeList(process.env.STARTUP_ALERT_EMAIL);
  if (!apiKey || !domain || recipients.length === 0) {
    return { delivered: false, reason: 'mailgun-not-configured' };
  }

  const from =
    process.env.STARTUP_ALERT_FROM || `Startup Diagnostics <postmaster@${domain}>`;
  const mailgun = new Mailgun(FormData);
  const client = mailgun.client({ username: 'api', key: apiKey });

  try {
    await client.messages.create(domain, {
      from,
      to: recipients,
      subject,
      text: message,
    });
    return { delivered: true, transport: 'mailgun' };
  } catch (error) {
    logger.error('Failed to send Mailgun alert', {
      category: 'startup:alert',
      metadata: { error: error.message },
    });
    return { delivered: false, transport: 'mailgun', error: error.message };
  }
}

async function notifyStartupAlert(payload = {}) {
  const { subject = 'Startup diagnostics alert', severity = 'warning' } = payload;
  const bodyParts = [
    `Severity: ${severity.toUpperCase()}`,
    payload.message || 'No additional context provided.',
  ];

  if (payload.summary) {
    bodyParts.push(`Summary: ${JSON.stringify(payload.summary, null, 2)}`);
  }

  const body = bodyParts.join('\n\n');

  const transports = [];
  transports.push(sendSlackAlert(subject, body));
  transports.push(sendMailgunAlert(subject, body));

  const settled = await Promise.all(transports);
  const delivered = settled.filter((result) => result.delivered);

  if (delivered.length === 0) {
    logger.warning('No startup alert transports delivered the message', {
      category: 'startup:alert',
      metadata: settled,
    });
  } else {
    logger.notice('Startup alert delivered', {
      category: 'startup:alert',
      metadata: delivered,
    });
  }

  return settled;
}

module.exports = {
  DEFAULT_REQUIRED_ENV_VARS,
  validateEnvVars,
  checkDiskSpaceForPath,
  verifyMongoConnection,
  runPreflightChecks,
  notifyStartupAlert,
};
