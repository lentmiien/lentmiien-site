const { createHmac, randomBytes } = require('crypto');
const Account = require('../models/account_db');
const Transaction = require('../models/transaction_db');
const { period, balances, eligible, storedNumber, validDate } = require('../utils/accountBalances');
const { withLedgerWrite, conflict, rejection } = require('./accountingLedgerWrite');
const logger = require('../utils/logger');

const reviewKey = randomBytes(32);
const MAX_TRANSACTIONS = 50000;
function createCloseService({ accountModel = Account, transactionModel = Transaction, write = withLedgerWrite, now = () => new Date() } = {}) {
  async function snapshot(account, principalId, dates) {
    const invalidLedger = () => rejection('The baseline or ledger has an invalid date, currency, amount or unsupported precision. Review this account before closing.', 422);
    try { balances(account, [], dates); }
    catch (_) { throw invalidLedger(); }
    const transactions = await transactionModel.find({
      $or: [{ from_account: String(account._id) }, { to_account: String(account._id) }],
      date: { $gt: account.balance_date, $lte: dates.today },
    }).select('_id date from_account to_account amount from_fee to_fee').sort({ _id: 1 }).limit(MAX_TRANSACTIONS + 1).maxTimeMS(5000).lean();
    if (transactions.length > MAX_TRANSACTIONS) throw rejection('Ledger review limit reached. Contact the operator.', 422);
    let computed; let closingNumber;
    try {
      computed = balances(account, transactions, dates);
      closingNumber = storedNumber(computed.closingUnits);
    } catch (_) {
      throw invalidLedger();
    }
    const token = createHmac('sha256', reviewKey).update(JSON.stringify({ principalId: String(principalId), dates,
      account: [String(account._id), account.name, account.currency, account.balance, account.balance_date, account.closedThrough],
      transactions })).digest('hex');
    return { id: String(account._id), name: account.name, currency: account.currency,
      baseline: String(account.balance), baselineDate: account.balance_date, current: computed.current,
      currentMonth: computed.currentMonth, closing: computed.closing, closingNumber, token };
  }
  async function preview(principalId) {
    const dates = period(now());
    const accounts = await accountModel.find({}).sort({ _id: 1 }).limit(101).maxTimeMS(5000).lean();
    if (accounts.length > 100) throw Object.assign(new Error('Account review limit reached. Contact the operator.'), { status: 422 });
    const reviews = [];
    // Sequential bounded reads avoid multiplying database load for old baselines.
    for (const account of accounts.filter(a => eligible(a, dates) || !validDate(a.balance_date))) {
      try { reviews.push(await snapshot(account, principalId, dates)); }
      catch (error) {
        if (error.status !== 422) throw error;
        logger.warning('Accounting account requires review before month close', { category: 'accounting' });
        reviews.push({ id: String(account._id), name: account.name, error: error.message });
      }
    }
    return { dates, accounts: reviews };
  }
  async function close(principalId, input) {
    return write(async () => {
      const dates = period(now());
      const account = await accountModel.findOne({ _id: input.accountId }).maxTimeMS(5000).lean();
      if (!account) throw rejection('Account unavailable.', 404);
      if (!eligible(account, dates)) throw conflict('This account is already finalized or has a newer baseline. Refresh the review.');
      const review = await snapshot(account, principalId, dates);
      if (review.token !== input.token) throw conflict('The day, account, or transactions changed. Refresh and compare the balances again.');
      // Midnight may pass during a long query. The confirmation applies only to
      // the calendar day and month that the user actually reviewed.
      if (period(now()).today !== dates.today) throw conflict('The day changed. Refresh and compare the balances again.');
      const result = await accountModel.updateOne({ _id: account._id, balance: account.balance, balance_date: account.balance_date }, {
        $set: { balance: review.closingNumber, balance_date: dates.closeDate, closedThrough: dates.closeDate },
        $push: { balanceHistory: { balance: account.balance, balance_date: account.balance_date,
          closedBalance: review.closingNumber, closedThrough: dates.closeDate, confirmedAt: now(), confirmedBy: principalId } },
      }).maxTimeMS(5000);
      if (result.modifiedCount !== 1) throw conflict('The account changed. Refresh the review.');
    });
  }
  return { preview, close };
}
module.exports = { createCloseService, MAX_TRANSACTIONS };
