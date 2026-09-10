jest.mock('../../models/accounting_write_lock', () => ({ create: jest.fn(), deleteOne: jest.fn() }));
jest.mock('../../models/account_db', () => ({ exists: jest.fn(), deleteOne: jest.fn() }));
jest.mock('../../models/transaction_db', () => ({ findById: jest.fn(), deleteOne: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const Lock = require('../../models/accounting_write_lock');
const Account = require('../../models/account_db');
const Transaction = require('../../models/transaction_db');
const logger = require('../../utils/logger');
const ledger = require('../../services/accountingLedgerWrite');
const id = '111111111111111111111111';
const tx = { from_account: id, to_account: 'EXT', date: 20260831, save: jest.fn(async () => 'saved') };
const query = value => ({ maxTimeMS: async () => value });
beforeEach(() => {
  Lock.create.mockResolvedValue({}); Lock.deleteOne.mockReturnValue(query({ deletedCount: 1 }));
  Account.exists.mockReturnValue(query(null)); Transaction.deleteOne.mockReturnValue(query({ deletedCount: 1 }));
  Account.deleteOne.mockReturnValue(query({ deletedCount: 1 }));
  Transaction.findById.mockReturnValue({ lean: () => query(tx) });
});
test('insert holds a token-scoped lock and releases it after save', async () => {
  expect(await ledger.insertTransaction(tx)).toBe('saved');
  expect(Account.exists).toHaveBeenCalledWith({ _id: { $in: [id] }, closedThrough: { $gte: 20260831 } });
  expect(Lock.deleteOne).toHaveBeenCalledWith({ _id: 'ledger', token: Lock.create.mock.calls[0][0].token });
});
test('closed history insert/delete and finalized account deletion fail without changing data', async () => {
  Account.exists.mockReturnValue(query({ _id: id }));
  await expect(ledger.insertTransaction(tx)).rejects.toMatchObject({ status: 409 });
  await expect(ledger.deleteTransaction(id)).rejects.toMatchObject({ status: 409 });
  await expect(ledger.deleteAccount(id)).rejects.toMatchObject({ status: 409 });
  expect(tx.save).not.toHaveBeenCalled(); expect(Transaction.deleteOne).not.toHaveBeenCalled(); expect(Account.deleteOne).not.toHaveBeenCalled();
  expect(Lock.deleteOne).toHaveBeenCalledTimes(3);
});
test('another writer fails closed and cannot release the active lock', async () => {
  Lock.create.mockRejectedValue({ code: 11000 });
  const work = jest.fn();
  await expect(ledger.withLedgerWrite(work)).rejects.toMatchObject({ status: 409 });
  expect(work).not.toHaveBeenCalled(); expect(Lock.deleteOne).not.toHaveBeenCalled();
});
test('failed work releases lock; failed release is reported without exposing content', async () => {
  await expect(ledger.withLedgerWrite(() => { throw new Error('private ledger content'); })).rejects.toThrow();
  expect(Lock.deleteOne).toHaveBeenCalledTimes(1);
  Lock.deleteOne.mockReturnValue({ maxTimeMS: async () => { throw new Error('private ledger content'); } });
  await ledger.withLedgerWrite(async () => 'done');
  expect(logger.error).toHaveBeenCalledWith('Accounting write lock release failed; operator recovery required', expect.any(Object));
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private ledger content');
});
test('open-period deletes are allowed under the lock', async () => {
  await ledger.deleteTransaction(id); await ledger.deleteAccount(id);
  expect(Transaction.deleteOne).toHaveBeenCalledWith({ _id: id });
  expect(Account.deleteOne).toHaveBeenCalledWith({ _id: id });
});
test.each(['busy', 'closed'])('shared HTTP handler exposes safe %s guidance to ordinary ledger clients', async reason => {
  if (reason === 'busy') Lock.create.mockRejectedValue({ code: 11000 });
  else Account.exists.mockReturnValue(query({ _id: id }));
  const error = await ledger.insertTransaction(tx).catch(e => e);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  require('../../middleware/errorHandler')(logger)(error, {
    originalUrl: '/budget/api/transaction', get: () => 'application/json',
  }, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(409);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining(reason === 'busy' ? 'Retry shortly' : 'open-period correction') });
  expect(tx.save).not.toHaveBeenCalled();
});
