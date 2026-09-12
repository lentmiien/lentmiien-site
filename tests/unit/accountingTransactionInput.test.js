jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../models/accounting_write_lock', () => ({ create: jest.fn(), deleteOne: jest.fn() }));
jest.mock('../../models/account_db', () => ({ find: jest.fn(), exists: jest.fn() }));
jest.mock('../../services/accountingBusinessService', () => ({ ensureBusiness: jest.fn(), SOURCE_BUDGET: 'budget' }));
jest.mock('../../services/creditCardService', () => ({}));
jest.mock('../../services/externalAssetService', () => ({}));
jest.mock('../../database', () => ({
  TransactionDBModel: require('../../models/transaction_db'),
  AccountDBModel: require('../../models/account_db'),
  CategoryDBModel: { find: jest.fn(async () => [{ _id: '333333333333333333333333', title: 'Synthetic', type: 'income' }]) },
}));
const express = require('express');
const Transaction = require('../../models/transaction_db');
const Account = require('../../models/account_db');
const Lock = require('../../models/accounting_write_lock');
const business = require('../../services/accountingBusinessService');
const accounting = require('../../controllers/accountingController');
const legacy = require('../../controllers/budgetcontroller');
const logger = require('../../utils/logger');
const id = '111111111111111111111111';
let server; let base; let saved;
function query(value) {
  const q = { then: resolve => Promise.resolve(value).then(resolve), maxTimeMS: async () => value,
    select: () => q, limit: () => q, lean: () => q };
  return q;
}
beforeEach(async () => {
  saved = [];
  jest.spyOn(Transaction, 'find').mockResolvedValue([]);
  jest.spyOn(Transaction.prototype, 'save').mockImplementation(async function () { saved.push(this.toObject()); return this; });
  Account.find.mockReturnValue(query([{ _id: id, name: 'Synthetic account', currency: 'USD' }]));
  Account.exists.mockReturnValue(query(null));
  Lock.create.mockResolvedValue({}); Lock.deleteOne.mockReturnValue(query({ deletedCount: 1 }));
  const app = express(); app.use(express.json());
  app.post(['/accounting/api/transaction', '/budget/api/transaction'], accounting.newTransaction);
  app.post('/accounting/legacy/add_transaction', (req, res, next) => {
    res.render = () => res.status(200).send('Saved');
    return legacy.add_transaction_post(req, res, next);
  });
  app.use(require('../../middleware/errorHandler')(logger));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { jest.restoreAllMocks(); await new Promise(resolve => server.close(resolve)); });
test.each(['/accounting/api/transaction', '/budget/api/transaction', '/accounting/legacy/add_transaction'])('%s rejects invalid Expense and saves only corrected Income', async path => {
  const isLegacy = path.includes('/legacy/');
  const input = { from_account: 'EXT', to_account: id, type: 'expense', amount: 25, from_fee: 0, to_fee: 0,
    date: isLegacy ? '2026-09-01' : 20260901, transaction_business: 'Synthetic business',
    categories: isLegacy ? 'Synthetic@100' : '333333333333333333333333@100', tags: 'synthetic' };
  const post = body => fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
  const rejected = await post(input);
  expect(rejected.status).toBe(422);
  expect(await rejected.json()).toEqual({ error: expect.stringContaining('income') });
  expect(saved).toEqual([]); expect(business.ensureBusiness).not.toHaveBeenCalled();
  expect(Lock.create).not.toHaveBeenCalled();
  const accepted = await post({ ...input, type: 'income' });
  expect(accepted.status).toBe(isLegacy ? 200 : 201);
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ from_account: 'EXT', to_account: id, type: 'income', amount: 25, from_fee: 0, to_fee: 0, date: 20260901 });
  expect(Lock.deleteOne).toHaveBeenCalledTimes(1);
});
