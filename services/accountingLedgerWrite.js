const { randomUUID } = require('crypto');
const Lock = require('../models/accounting_write_lock');
const Account = require('../models/account_db');
const Transaction = require('../models/transaction_db');
const logger = require('../utils/logger');

// These fixed messages contain no ledger data and must reach legacy write UIs.
function conflict(message) { return Object.assign(new Error(message), { status: 409, expose: true }); }
async function withLedgerWrite(work) {
  const token = randomUUID();
  try {
    await Lock.create({ _id: 'ledger', token, startedAt: new Date() });
  } catch (error) {
    if (error.code === 11000) {
      logger.warning('Accounting ledger is busy; inspect accounting_write_lock if persistent', { category: 'accounting' });
      throw conflict('The ledger is busy. Retry shortly; contact the operator if this persists.');
    }
    logger.error('Accounting write lock acquisition failed', { category: 'accounting' });
    throw error;
  }
  try { return await work(); }
  catch (error) {
    if (!error.status || error.status >= 500) logger.error('Accounting ledger write failed', { category: 'accounting', metadata: { errorName: error.name } });
    throw error;
  } finally {
    try { await Lock.deleteOne({ _id: 'ledger', token }).maxTimeMS(5000); }
    catch (_) { logger.error('Accounting write lock release failed; operator recovery required', { category: 'accounting' }); }
  }
}
async function assertOpen(transaction) {
  const closed = await Account.exists({ _id: { $in: [transaction.from_account, transaction.to_account].filter(id => /^[a-f\d]{24}$/i.test(id)) },
    closedThrough: { $gte: transaction.date } }).maxTimeMS(5000);
  if (closed) throw conflict('This transaction affects a finalized period. Historical transactions are preserved; use an open-period correction.');
}
async function insertTransaction(document) {
  return withLedgerWrite(async () => {
    await assertOpen(document);
    return document.save();
  });
}
async function deleteTransaction(id) {
  return withLedgerWrite(async () => {
    const transaction = await Transaction.findById(id).lean().maxTimeMS(5000);
    if (transaction) await assertOpen(transaction);
    return Transaction.deleteOne({ _id: id }).maxTimeMS(5000);
  });
}
async function deleteAccount(id) {
  return withLedgerWrite(async () => {
    if (await Account.exists({ _id: id, closedThrough: { $exists: true } }).maxTimeMS(5000)) throw conflict('A finalized account cannot be deleted.');
    return Account.deleteOne({ _id: id }).maxTimeMS(5000);
  });
}
module.exports = { withLedgerWrite, insertTransaction, deleteTransaction, deleteAccount, conflict };
