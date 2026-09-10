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
test('unexpected failure retains lock; failed release is reported without exposing content', async () => {
  await expect(ledger.withLedgerWrite(() => { throw new Error('private ledger content'); })).rejects.toThrow();
  expect(Lock.deleteOne).not.toHaveBeenCalled();
  expect(logger.error).toHaveBeenCalledWith('Accounting ledger write outcome uncertain; lock retained for offline operator recovery', { category: 'accounting' });
  Lock.deleteOne.mockReturnValue({ maxTimeMS: async () => { throw new Error('private ledger content'); } });
  await ledger.withLedgerWrite(async () => 'done');
  expect(logger.error).toHaveBeenCalledWith('Accounting write lock release failed; operator recovery required', expect.any(Object));
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private ledger content');
});
test.each([404, 409, 422])('explicit no-write rejection %s releases the lock', async status => {
  await expect(ledger.withLedgerWrite(() => { throw ledger.rejection('Review required.', status); })).rejects.toMatchObject({ status });
  expect(Lock.deleteOne).toHaveBeenCalledTimes(1);
});
test('an arbitrary status code is not evidence that the database stopped writing', async () => {
  await expect(ledger.withLedgerWrite(() => { throw Object.assign(new Error('uncertain'), { status: 409 }); })).rejects.toThrow();
  expect(Lock.deleteOne).not.toHaveBeenCalled();
});
test('a lost write acknowledgment blocks the next writer even if the interrupted operation later commits', async () => {
  let locked = false;
  let finishDatabaseWrite;
  let committed = false;
  Lock.create.mockImplementation(async () => {
    if (locked) throw { code: 11000 };
    locked = true;
  });
  const uncertainWrite = () => {
    finishDatabaseWrite = () => { committed = true; };
    throw new Error('Network timeout');
  };
  await expect(ledger.withLedgerWrite(uncertainWrite)).rejects.toThrow('Network timeout');
  const secondWriter = jest.fn();
  await expect(ledger.withLedgerWrite(secondWriter)).rejects.toMatchObject({ status: 409 });
  finishDatabaseWrite();
  expect(committed).toBe(true);
  await expect(ledger.withLedgerWrite(secondWriter)).rejects.toMatchObject({ status: 409 });
  expect(secondWriter).not.toHaveBeenCalled();
  expect(Lock.deleteOne).not.toHaveBeenCalled();
});
test('missing token-scoped lock on release is an operational failure', async () => {
  Lock.deleteOne.mockReturnValue(query({ deletedCount: 0 }));
  await expect(ledger.withLedgerWrite(async () => 'done')).resolves.toBe('done');
  expect(logger.error).toHaveBeenCalledWith('Accounting write lock release failed; operator recovery required', { category: 'accounting' });
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
