const { randomUUID } = require('crypto');
const Lock = require('../models/accounting_write_lock');
const Account = require('../models/account_db');
const Transaction = require('../models/transaction_db');
const logger = require('../utils/logger');
const { decimal, validDate } = require('../utils/accountBalances');

// Only explicit application rejections prove there is no in-flight mutation.
// A status code or driver error alone cannot prove that a write did not commit.
const safeRejections = new WeakSet();
function rejection(message, status) {
  const error = Object.assign(new Error(message), { status, expose: true });
  safeRejections.add(error);
  return error;
}
// These fixed messages contain no ledger data and must reach legacy write UIs.
function conflict(message) { return rejection(message, 409); }
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
  let canRelease = false;
  try {
    const result = await work();
    canRelease = true;
    return result;
  }
  catch (error) {
    canRelease = safeRejections.has(error);
    if (!canRelease) logger.error('Accounting ledger write outcome uncertain; lock retained for offline operator recovery', { category: 'accounting' });
    throw error;
  } finally {
    if (canRelease) {
      try {
        const result = await Lock.deleteOne({ _id: 'ledger', token }).maxTimeMS(5000);
        if (result.deletedCount !== 1) throw new Error('Lock ownership changed');
      } catch (_) { logger.error('Accounting write lock release failed; operator recovery required', { category: 'accounting' }); }
    }
  }
}
async function assertOpen(transaction) {
  const closed = await Account.exists({ _id: { $in: [transaction.from_account, transaction.to_account].filter(id => /^[a-f\d]{24}$/i.test(id)) },
    closedThrough: { $gte: transaction.date } }).maxTimeMS(5000);
  if (closed) throw conflict('This transaction affects a finalized period. Historical transactions are preserved; use an open-period correction.');
}
async function insertTransaction(document) {
  // Validate before taking the non-expiring write lock. A rejected form is not an
  // uncertain database write and must never prevent the next valid submission.
  const invalid = (reasonCode, message) => {
    logger.warning('Accounting transaction input rejected', { category: 'accounting', metadata: { stage: 'transaction_validation', reasonCode } });
    return rejection(message, 422);
  };
  const type = typeof document.type === 'string' ? document.type.trim().toLowerCase() : '';
  if (!['income', 'expense', 'saving', 'transfer'].includes(type)) {
    throw invalid('TRANSACTION_TYPE_INVALID', 'Select Income, Expense or Saving/Transfer as the transaction type.');
  }
  if (type === 'expense' && document.from_account === 'EXT') {
    throw invalid('EXPENSE_EXTERNAL_PAYER', 'An expense must have a tracked payer account. Review the transaction type and payer; money received from an external business is income.');
  }
  document.type = type;
  if (!validDate(document.date)) throw invalid('TRANSACTION_DATE_INVALID', 'Enter a valid transaction date.');
  try {
    for (const field of ['amount', 'from_fee', 'to_fee']) decimal(document[field]);
  } catch (_) { throw invalid('TRANSACTION_AMOUNT_INVALID', 'Enter finite amounts and fees within the supported ledger range and precision.'); }
  try { await document.validate(); }
  catch (_) { throw invalid('TRANSACTION_FIELDS_INVALID', 'Check all required transaction fields and their formats.'); }
  const accountIds = [...new Set([document.from_account, document.to_account].filter(id => id !== 'EXT'))];
  if (!accountIds.length || accountIds.some(id => typeof id !== 'string' || !/^[a-f\d]{24}$/.test(id))) {
    throw invalid('TRANSACTION_ACCOUNTS_INVALID', 'Select a tracked account and valid payer and receiver accounts.');
  }
  return withLedgerWrite(async () => {
    await assertOpen(document);
    let accounts;
    try {
      accounts = await Account.find({ _id: { $in: accountIds } }).select('_id currency').limit(2).lean().maxTimeMS(2000);
    } catch (_) {
      // Only reads have run; releasing this lock is safe. Never expose driver data.
      logger.warning('Accounting transaction account validation unavailable', { category: 'accounting', metadata: { stage: 'transaction_validation', reasonCode: 'ACCOUNT_LOOKUP_FAILED' } });
      throw rejection('Account validation unavailable. Retry shortly.', 503);
    }
    if (accounts.length !== accountIds.length || accounts.some(account => !/^[A-Z]{3}$/.test(account.currency || ''))) {
      throw invalid('TRANSACTION_CURRENCY_UNAVAILABLE', 'A selected account is missing or has an invalid currency. Review the accounts before saving.');
    }
    if (new Set(accounts.map(account => account.currency)).size !== 1) {
      throw invalid('TRANSACTION_CURRENCY_CONFLICT', 'The selected accounts must share one currency. This transaction form does not support currency conversion.');
    }
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
module.exports = { withLedgerWrite, insertTransaction, deleteTransaction, deleteAccount, conflict, rejection };
