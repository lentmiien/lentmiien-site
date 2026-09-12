jest.mock('../../models/accounting_write_lock', () => ({ create: jest.fn(), deleteOne: jest.fn() }));
jest.mock('../../models/account_db', () => ({ find: jest.fn(), exists: jest.fn(), deleteOne: jest.fn() }));
jest.mock('../../models/transaction_db', () => ({ findById: jest.fn(), deleteOne: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const Lock = require('../../models/accounting_write_lock');
const Account = require('../../models/account_db');
const Transaction = require('../../models/transaction_db');
const logger = require('../../utils/logger');
const ledger = require('../../services/accountingLedgerWrite');
const id = '111111111111111111111111';
const tx = { from_account: id, to_account: 'EXT', date: 20260831, type: 'expense', amount: 10, from_fee: 0, to_fee: 0, validate: jest.fn(async () => {}), save: jest.fn(async () => 'saved') };
const query = value => {
  const q = { maxTimeMS: async () => value, select: () => q, limit: () => q, lean: () => q };
  return q;
};
beforeEach(() => {
  Lock.create.mockResolvedValue({}); Lock.deleteOne.mockReturnValue(query({ deletedCount: 1 }));
  Account.find.mockReturnValue(query([{ _id: id, currency: 'USD' }]));
  Account.exists.mockReturnValue(query(null)); Transaction.deleteOne.mockReturnValue(query({ deletedCount: 1 }));
  Account.deleteOne.mockReturnValue(query({ deletedCount: 1 }));
  Transaction.findById.mockReturnValue({ lean: () => query(tx) });
});
test('insert holds a token-scoped lock and releases it after save', async () => {
  expect(await ledger.insertTransaction(tx)).toBe('saved');
  expect(Account.exists).toHaveBeenCalledWith({ _id: { $in: [id] }, closedThrough: { $gte: 20260831 } });
  expect(Lock.deleteOne).toHaveBeenCalledWith({ _id: 'ledger', token: Lock.create.mock.calls[0][0].token });
});
test.each(['expense', 'Expense', ' EXPENSE '])('external payer %s is rejected before lock/write with safe corrective feedback', async type => {
  const document = { ...tx, from_account: 'EXT', to_account: id, type };
  const error = await ledger.insertTransaction(document).catch(e => e);
  expect(error).toMatchObject({ status: 422, expose: true, message: expect.stringContaining('income') });
  expect(Lock.create).not.toHaveBeenCalled(); expect(document.save).not.toHaveBeenCalled();
  expect(Account.find).not.toHaveBeenCalled();
  expect(logger.warning.mock.calls).toEqual([['Accounting transaction input rejected', {
    category: 'accounting', metadata: { stage: 'transaction_validation', reasonCode: 'EXPENSE_EXTERNAL_PAYER' },
  }]]);
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  require('../../middleware/errorHandler')(logger)(error, { originalUrl: '/accounting/api/transaction', get: () => 'application/json' }, res, jest.fn());
  expect(res.status).toHaveBeenCalledWith(422);
  expect(res.json).toHaveBeenCalledWith({ error: expect.stringContaining('tracked payer account') });
});
test('corrected Income is accepted with external payer and tracked receiver', async () => {
  expect(await ledger.insertTransaction({ ...tx, from_account: 'EXT', to_account: id, type: 'income' })).toBe('saved');
  expect(Account.find).toHaveBeenCalledWith({ _id: { $in: [id] } });
  expect(Lock.deleteOne).toHaveBeenCalledTimes(1);
});
test.each([{ date: 20260229 }, { date: 20260931 }, { amount: Infinity }, { amount: NaN }, { from_fee: undefined },
  { amount: 1e-21 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { from_account: 'missing' }, { type: '' }, { type: 'expenses' }])('invalid ledger input fails without taking a lock %#', async changes => {
  await expect(ledger.insertTransaction({ ...tx, ...changes })).rejects.toMatchObject({ status: 422, expose: true });
  expect(tx.save).not.toHaveBeenCalled(); expect(Lock.create).not.toHaveBeenCalled();
});
test('schema validation failure is sanitized and never strands the lock', async () => {
  await expect(ledger.insertTransaction({ ...tx, validate: async () => { throw new Error('private model values'); } })).rejects.toMatchObject({ status: 422 });
  expect(Lock.create).not.toHaveBeenCalled(); expect(tx.save).not.toHaveBeenCalled();
  expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('private model values');
});
test('actual Mongoose documents validate before save without opening a database connection', async () => {
  const Model = jest.requireActual('../../models/transaction_db');
  const input = { from_account: 'EXT', to_account: id, type: 'income', date: 20260901, amount: 25, from_fee: 0, to_fee: 0,
    transaction_business: 'Synthetic business', categories: 'Synthetic category', tags: 'synthetic' };
  const valid = new Model(input); valid.save = jest.fn(async () => valid);
  await expect(ledger.insertTransaction(valid)).resolves.toBe(valid);
  const invalid = new Model({ ...input, tags: undefined }); invalid.save = jest.fn();
  await expect(ledger.insertTransaction(invalid)).rejects.toMatchObject({ status: 422, message: 'Check all required transaction fields and their formats.' });
  expect(invalid.save).not.toHaveBeenCalled();
  expect(Lock.create).toHaveBeenCalledTimes(1);
});
test.each([{ accounts: [] }, { accounts: [{ _id: id, currency: '' }] }])('missing account/currency releases lock and rejects save %#', async ({ accounts }) => {
  Account.find.mockReturnValue(query(accounts));
  await expect(ledger.insertTransaction(tx)).rejects.toMatchObject({ status: 422 });
  expect(tx.save).not.toHaveBeenCalled(); expect(Lock.deleteOne).toHaveBeenCalledTimes(1);
});
test('conflicting currencies fail; supported same-currency transfer retains fees and decimals', async () => {
  const receiver = '222222222222222222222222';
  Account.find.mockReturnValue(query([{ _id: id, currency: 'USD' }, { _id: receiver, currency: 'JPY' }]));
  const transfer = { ...tx, to_account: receiver, type: 'saving', amount: 1.25, from_fee: 0.05, to_fee: 0.1 };
  await expect(ledger.insertTransaction(transfer)).rejects.toMatchObject({ status: 422, message: expect.stringContaining('one currency') });
  expect(tx.save).not.toHaveBeenCalled(); expect(Lock.deleteOne).toHaveBeenCalledTimes(1);
  Account.find.mockReturnValue(query([{ _id: id, currency: 'USD' }, { _id: receiver, currency: 'USD' }]));
  await expect(ledger.insertTransaction(transfer)).resolves.toBe('saved');
  expect(transfer).toMatchObject({ amount: 1.25, from_fee: 0.05, to_fee: 0.1 });
});
test('account lookup failure is read-only, releases lock, and hides database content', async () => {
  const q = query([]); q.maxTimeMS = async () => { throw new Error('private database content'); };
  Account.find.mockReturnValue(q);
  await expect(ledger.insertTransaction(tx)).rejects.toMatchObject({ status: 503 });
  expect(tx.save).not.toHaveBeenCalled(); expect(Lock.deleteOne).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('private database content');
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
