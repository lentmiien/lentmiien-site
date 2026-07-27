const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const DEFAULT_MAX_AGE_MS = 2 * DAY_MS;
const DEFAULT_MAX_ATTEMPTS = 50;

const BACKOFF_STAGES = Object.freeze([
  { untilAgeMs: 10 * MINUTE_MS, delayMs: MINUTE_MS },
  { untilAgeMs: HOUR_MS, delayMs: 5 * MINUTE_MS },
  { untilAgeMs: DAY_MS, delayMs: HOUR_MS },
  { untilAgeMs: Number.POSITIVE_INFINITY, delayMs: 6 * HOUR_MS },
]);

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getRecoveryPolicy(env = process.env) {
  return {
    maxAgeMs: parsePositiveInteger(env.OPENAI_PENDING_MAX_AGE_MS, DEFAULT_MAX_AGE_MS),
    maxAttempts: parsePositiveInteger(env.OPENAI_PENDING_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS),
  };
}

function getRecoveryDelayMs(ageMs) {
  const normalizedAgeMs = Number.isFinite(ageMs) ? Math.max(0, ageMs) : 0;
  const stage = BACKOFF_STAGES.find(({ untilAgeMs }) => normalizedAgeMs < untilAgeMs);
  return stage.delayMs;
}

function getInitialRecoveryCheckAt(now = new Date()) {
  return new Date(now.getTime() + MINUTE_MS);
}

function getNextRecoveryCheckAt({ createdAt, checkedAt = new Date(), maxAgeMs = DEFAULT_MAX_AGE_MS }) {
  const normalizedCreatedAt = createdAt instanceof Date && Number.isFinite(createdAt.getTime())
    ? createdAt
    : checkedAt;
  const ageMs = Math.max(0, checkedAt.getTime() - normalizedCreatedAt.getTime());
  const nextCheckAt = new Date(checkedAt.getTime() + getRecoveryDelayMs(ageMs));
  const expiresAt = new Date(normalizedCreatedAt.getTime() + maxAgeMs);

  return nextCheckAt < expiresAt ? nextCheckAt : expiresAt;
}

module.exports = {
  BACKOFF_STAGES,
  DAY_MS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_MAX_ATTEMPTS,
  HOUR_MS,
  MINUTE_MS,
  getInitialRecoveryCheckAt,
  getNextRecoveryCheckAt,
  getRecoveryDelayMs,
  getRecoveryPolicy,
};
