const { balances, period, decimal, decimalText, storedNumber, validDate, eligible } = require('../../utils/accountBalances');
const dates = period(new Date('2026-09-10T00:00:00Z'));
const account = { _id: 'a', balance: 100, balance_date: 20220101, currency: 'USD' };
const tx = (date, overrides = {}) => ({ date, from_account: 'a', to_account: 'EXT', amount: 10, from_fee: 1, to_fee: 2, ...overrides });
test('old baseline includes all intervening months, excludes baseline day and future entries', () => {
  const result = balances(account, [tx(20220101), tx(20220301), tx(20260831), tx(20260901), tx(20260910), tx(20260911)], dates);
  expect(result).toMatchObject({ closing: '78', currentMonth: '-22', current: '56' });
  const closed = { ...account, balance: Number(result.closing), balance_date: dates.closeDate };
  expect(balances(closed, [tx(20260901), tx(20260910)], dates).current).toBe(result.current);
});
test('incoming, negative/refund, transfer and self-transfer follow independent sides and fees', () => {
  const list = [tx(20260801, { from_account: 'EXT', to_account: 'a' }), tx(20260802, { amount: -10 }),
    tx(20260803, { to_account: 'b' }), tx(20260804, { to_account: 'a' })];
  expect(balances(account, list, dates).current).toBe('103');
  expect(balances({ ...account, _id: 'b' }, list, dates).current).toBe('108');
});
test('exact decimal sums retain currency precision and reject unsafe persistence', () => {
  expect(decimalText(decimal(0.1) + decimal(0.2))).toBe('0.3');
  expect(decimalText(decimal(-0.01))).toBe('-0.01');
  expect(decimalText(decimal(1e-7))).toBe('0.0000001');
  expect(storedNumber(decimal(0.1) + decimal(0.2))).toBe(0.3);
  expect(() => storedNumber(decimal(Number.MAX_SAFE_INTEGER) + decimal(0.1))).toThrow();
  expect(() => decimal(1e-21)).toThrow();
  expect(() => decimal(NaN)).toThrow();
  expect(() => decimal('10')).toThrow();
});
test.each([
  ['2026-12-31T15:00:00Z', 20270101, 20261231],
  ['2024-02-29T14:59:59Z', 20240229, 20240131],
  ['2024-02-29T15:00:00Z', 20240301, 20240229],
  ['2026-02-28T15:00:00Z', 20260301, 20260228],
])('Tokyo month boundaries %s', (instant, today, closeDate) => {
  expect(period(new Date(instant))).toMatchObject({ today, closeDate });
});
test('invalid, same-day and newer baseline handling', () => {
  expect(validDate(20260229)).toBe(false);
  expect(validDate(20261301)).toBe(false);
  expect(eligible({ ...account, balance_date: 20260831 }, dates)).toBe(false);
  expect(eligible({ ...account, balance_date: 20260901 }, dates)).toBe(false);
  expect(() => balances({ ...account, balance_date: 20260911 }, [], dates)).toThrow();
  expect(() => balances(account, [tx(20260230)], dates)).toThrow();
  expect(balances({ ...account, balance_date: 20260905 }, [tx(20260901), tx(20260905), tx(20260906)], dates).current).toBe('89');
});
