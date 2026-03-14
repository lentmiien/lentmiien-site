const {
  DEFAULT_HISTORY_VALUE,
  HISTORY_MONTH_LIMIT,
  buildReceiptHistoryOptions,
  resolveReceiptHistorySelection,
  getReceiptHistoryConfig,
  buildReceiptHistoryReturnUrl,
} = require('../../utils/receiptHistory');

describe('receiptHistory utils', () => {
  const now = new Date('2026-03-14T00:00:00.000Z');

  test('builds the last-30 option plus 36 monthly options', () => {
    const options = buildReceiptHistoryOptions(now);

    expect(options).toHaveLength(HISTORY_MONTH_LIMIT + 1);
    expect(options[0]).toEqual({ value: DEFAULT_HISTORY_VALUE, label: 'Last 30 days' });
    expect(options[1]).toEqual({ value: '2026-03', label: 'March 2026' });
    expect(options[options.length - 1]).toEqual({ value: '2023-04', label: 'April 2023' });
  });

  test('resolves invalid or out-of-range values back to the default option', () => {
    const options = buildReceiptHistoryOptions(now);

    expect(resolveReceiptHistorySelection('2025-12', options)).toBe('2025-12');
    expect(resolveReceiptHistorySelection('2022-12', options)).toBe(DEFAULT_HISTORY_VALUE);
    expect(resolveReceiptHistorySelection('not-a-month', options)).toBe(DEFAULT_HISTORY_VALUE);
    expect(resolveReceiptHistorySelection('', options)).toBe(DEFAULT_HISTORY_VALUE);
  });

  test('builds monthly date boundaries for a selected month', () => {
    const result = getReceiptHistoryConfig('2025-12', now);

    expect(result.selectedHistory).toBe('2025-12');
    expect(result.historyLabel).toBe('December 2025');
    expect(result.historyEmptyMessage).toBe('No receipts found for December 2025.');
    expect(result.query.date.$gte.toISOString()).toBe('2025-12-01T00:00:00.000Z');
    expect(result.query.date.$lt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  test('builds the default last-30-days window when no month is selected', () => {
    const result = getReceiptHistoryConfig(undefined, now);

    expect(result.selectedHistory).toBe(DEFAULT_HISTORY_VALUE);
    expect(result.historyLabel).toBe('Last 30 days');
    expect(result.historyEmptyMessage).toBe('No receipts found in the last 30 days.');
    expect(result.query.date.$gte.toISOString()).toBe('2026-02-12T00:00:00.000Z');
    expect(result.query.date.$lt).toBeUndefined();
  });

  test('builds return URLs that preserve a selected month', () => {
    expect(buildReceiptHistoryReturnUrl(DEFAULT_HISTORY_VALUE)).toBe('/receipt');
    expect(buildReceiptHistoryReturnUrl('2025-12')).toBe('/receipt?history=2025-12');
    expect(buildReceiptHistoryReturnUrl('2022-12')).toBe('/receipt');
  });
});
