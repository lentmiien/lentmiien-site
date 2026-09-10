jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { createCloseService, MAX_TRANSACTIONS } = require('../../services/accountingCloseService');
const id = '111111111111111111111111'; const owner = '222222222222222222222222';
let accounts; let transactions; let service; let accountModel; let transactionModel; let instant; let write;
function query(value) {
  const q = {};
  for (const method of ['select', 'sort', 'limit', 'maxTimeMS']) q[method] = jest.fn(() => q);
  q.lean = async () => structuredClone(value);
  return q;
}
beforeEach(() => {
  instant = new Date('2026-09-10T00:00:00Z');
  accounts = [{ _id: id, name: 'Synthetic checking', currency: 'USD', balance: 100, balance_date: 20220101 }];
  transactions = [{ _id: 't1', date: 20260831, from_account: id, to_account: 'EXT', amount: 10, from_fee: 1, to_fee: 0 },
    { _id: 't2', date: 20260901, from_account: 'EXT', to_account: id, amount: 20, from_fee: 0, to_fee: 2 }];
  accountModel = { find: jest.fn(() => query(accounts)), findOne: jest.fn(filter => query(accounts.find(a => a._id === filter._id))),
    updateOne: jest.fn((filter, update) => ({ maxTimeMS: async () => {
      const a = accounts.find(a => a._id === filter._id && a.balance === filter.balance && a.balance_date === filter.balance_date);
      if (!a) return { modifiedCount: 0 };
      Object.assign(a, update.$set); (a.balanceHistory ||= []).push(update.$push.balanceHistory); return { modifiedCount: 1 };
    } })) };
  transactionModel = { find: jest.fn(() => query(transactions)) };
  write = jest.fn(work => work());
  service = createCloseService({ accountModel, transactionModel, write, now: () => instant });
});
const review = async () => (await service.preview(owner)).accounts[0];
const submit = async token => service.close(owner, { accountId: id, token });
test('review is read-only; close saves previous month, retains prior baseline and audit', async () => {
  const preview = await review();
  expect(preview).toMatchObject({ current: '107', closing: '89', currentMonth: '18' });
  expect(accountModel.updateOne).not.toHaveBeenCalled();
  await submit(preview.token);
  expect(accounts[0]).toMatchObject({ balance: 89, balance_date: 20260831, closedThrough: 20260831,
    balanceHistory: [{ balance: 100, balance_date: 20220101, closedBalance: 89, closedThrough: 20260831, confirmedBy: owner }] });
  expect(transactions).toHaveLength(2);
  expect(write).toHaveBeenCalledTimes(1);
  await expect(submit(preview.token)).rejects.toMatchObject({ status: 409 });
  expect((await service.preview(owner)).accounts).toEqual([]);
});
test.each(['amount', 'fee', 'insert', 'delete', 'baseline', 'name', 'day', 'month', 'forged', 'principal'])('stale review rejects %s', async change => {
  const preview = await review();
  if (change === 'amount') transactions[0].amount += 1;
  if (change === 'fee') transactions[1].to_fee += 1;
  if (change === 'insert') transactions.push({ ...transactions[0], _id: 't3' });
  if (change === 'delete') transactions.pop();
  if (change === 'baseline') accounts[0].balance += 1;
  if (change === 'name') accounts[0].name = 'Changed';
  if (change === 'day') instant = new Date('2026-09-11T00:00:00Z');
  if (change === 'month') instant = new Date('2026-10-01T00:00:00Z');
  if (change === 'forged') preview.token = 'f'.repeat(64);
  if (change === 'principal') preview.token = (await service.preview(id)).accounts[0].token;
  await expect(submit(preview.token)).rejects.toMatchObject({ status: 409 });
  expect(accountModel.updateOne).not.toHaveBeenCalled();
});
test('offsetting edits are stale even when totals match', async () => {
  const preview = await review(); transactions[0].amount += 1; transactions[0].from_fee -= 1;
  await expect(submit(preview.token)).rejects.toMatchObject({ status: 409 });
});
test('missing account and compare-and-set race do not write history', async () => {
  const preview = await review();
  accountModel.updateOne.mockReturnValue({ maxTimeMS: async () => ({ modifiedCount: 0 }) });
  await expect(submit(preview.token)).rejects.toMatchObject({ status: 409 });
  accounts = [];
  await expect(submit(preview.token)).rejects.toMatchObject({ status: 404 });
});
test('multiple accounts are independent; equal/newer dates are not eligible', async () => {
  accounts.push({ ...accounts[0], _id: owner }, { ...accounts[0], _id: 'newer', balance_date: 20260901 });
  const previews = (await service.preview(owner)).accounts;
  expect(previews).toHaveLength(2);
  await submit(previews[0].token);
  expect((await service.preview(owner)).accounts.map(a => a.id)).toEqual([owner]);
});
test('query limits reject truncated review and do not update', async () => {
  transactions = Array(MAX_TRANSACTIONS + 1).fill(transactions[0]);
  expect((await review()).error).toContain('limit');
  expect(accountModel.updateOne).not.toHaveBeenCalled();
});
test('unsafe persistence fails instead of rounding', async () => {
  accounts[0].balance = Number.MAX_SAFE_INTEGER;
  transactions = [{ ...transactions[0], amount: -0.1, from_fee: 0 }];
  expect((await review()).error).toContain('precision');
});

test('invalid account does not prevent review of other eligible accounts', async () => {
  accounts.push({ ...accounts[0], _id: owner, balance: NaN });
  const result = await service.preview(owner);
  expect(result.accounts[0].token).toMatch(/^[a-f0-9]{64}$/);
  expect(result.accounts[1].error).toContain('invalid');
});
test('midnight during the final reread rejects before persistence', async () => {
  const preview = await review();
  transactionModel.find.mockImplementation(() => {
    instant = new Date('2026-10-01T00:00:00Z');
    return query(transactions);
  });
  await expect(submit(preview.token)).rejects.toMatchObject({ status: 409 });
  expect(accountModel.updateOne).not.toHaveBeenCalled();
});
