const {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  getInitialRecoveryCheckAt,
  getNextRecoveryCheckAt,
  getRecoveryDelayMs,
  getRecoveryPolicy,
} = require('../../services/openaiResponseRecoveryPolicy');

describe('OpenAI response recovery policy', () => {
  test.each([
    ['at creation', 0, MINUTE_MS],
    ['within the first ten minutes', (10 * MINUTE_MS) - 1, MINUTE_MS],
    ['after ten minutes', 10 * MINUTE_MS, 5 * MINUTE_MS],
    ['within the first hour', HOUR_MS - 1, 5 * MINUTE_MS],
    ['after one hour', HOUR_MS, HOUR_MS],
    ['within the first day', DAY_MS - 1, HOUR_MS],
    ['after one day', DAY_MS, 6 * HOUR_MS],
  ])('uses the expected delay %s', (label, ageMs, expectedDelayMs) => {
    expect(getRecoveryDelayMs(ageMs)).toBe(expectedDelayMs);
  });

  test('schedules the first recovery check one minute after creation', () => {
    const createdAt = new Date('2026-07-27T01:00:00.000Z');
    expect(getInitialRecoveryCheckAt(createdAt)).toEqual(
      new Date('2026-07-27T01:01:00.000Z'),
    );
  });

  test('does not schedule a check later than the abandonment deadline', () => {
    const createdAt = new Date('2026-07-27T00:00:00.000Z');
    const checkedAt = new Date('2026-07-28T20:00:00.000Z');

    expect(getNextRecoveryCheckAt({
      createdAt,
      checkedAt,
      maxAgeMs: 2 * DAY_MS,
    })).toEqual(new Date('2026-07-29T00:00:00.000Z'));
  });

  test('uses a 48-hour and 50-attempt default hard limit', () => {
    expect(getRecoveryPolicy({})).toEqual({
      maxAgeMs: 2 * DAY_MS,
      maxAttempts: 50,
    });
  });

  test('accepts positive environment overrides and rejects invalid ones', () => {
    expect(getRecoveryPolicy({
      OPENAI_PENDING_MAX_AGE_MS: '3600000',
      OPENAI_PENDING_MAX_ATTEMPTS: '12',
    })).toEqual({
      maxAgeMs: HOUR_MS,
      maxAttempts: 12,
    });

    expect(getRecoveryPolicy({
      OPENAI_PENDING_MAX_AGE_MS: '0',
      OPENAI_PENDING_MAX_ATTEMPTS: 'not-a-number',
    })).toEqual({
      maxAgeMs: 2 * DAY_MS,
      maxAttempts: 50,
    });
  });
});
