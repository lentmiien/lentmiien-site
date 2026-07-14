const {
  hasDatePassed,
  parseOptionalDateOnly,
  toDateOnlyString,
} = require('../../utils/dateOnly');

describe('date-only helpers', () => {
  test('keeps an omitted date empty', () => {
    expect(parseOptionalDateOnly('')).toBeNull();
    expect(parseOptionalDateOnly(undefined)).toBeNull();
    expect(toDateOnlyString(null)).toBe('');
  });

  test('parses a valid calendar date without a timezone shift', () => {
    const date = parseOptionalDateOnly('2026-07-15');

    expect(date.toISOString()).toBe('2026-07-15T00:00:00.000Z');
    expect(toDateOnlyString(date)).toBe('2026-07-15');
  });

  test('rejects malformed and impossible dates', () => {
    expect(() => parseOptionalDateOnly('07/15/2026')).toThrow('YYYY-MM-DD');
    expect(() => parseOptionalDateOnly('2026-02-30')).toThrow('valid calendar date');
  });

  test('marks a date only after its calendar day has passed', () => {
    const now = new Date(2026, 6, 15, 12, 0, 0);

    expect(hasDatePassed(parseOptionalDateOnly('2026-07-14'), now)).toBe(true);
    expect(hasDatePassed(parseOptionalDateOnly('2026-07-15'), now)).toBe(false);
    expect(hasDatePassed(parseOptionalDateOnly('2026-07-16'), now)).toBe(false);
    expect(hasDatePassed(null, now)).toBe(false);
  });
});
