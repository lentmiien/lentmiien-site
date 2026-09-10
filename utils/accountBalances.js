const { tokyoDay } = require('./scheduleTaskDates');

// Preserve decimal values represented by the existing Number schema. No currency
// conversion or rounding: unsupported precision must be reviewed, never discarded.
function decimal(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error('Invalid ledger amount');
  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const places = 20 + Number(exponent) - fraction.length;
  if (places < 0) throw new Error('Unsupported ledger precision');
  return BigInt(whole + fraction) * (10n ** BigInt(places));
}
function decimalText(value) {
  const negative = value < 0n;
  const digits = String(negative ? -value : value).padStart(21, '0');
  const fraction = digits.slice(-20).replace(/0+$/, '');
  return `${negative ? '-' : ''}${digits.slice(0, -20)}${fraction ? `.${fraction}` : ''}`;
}
function storedNumber(value) {
  const number = Number(decimalText(value));
  if (decimal(number) !== value) throw new Error('Balance cannot be stored without precision loss');
  return number;
}
function validDate(value) {
  if (!Number.isInteger(value) || value < 19700101 || value > 99991231) return false;
  const date = new Date(Date.UTC(Math.floor(value / 10000), Math.floor(value / 100) % 100 - 1, value % 100));
  return Number(date.toISOString().slice(0, 10).replaceAll('-', '')) === value;
}
function period(now = new Date()) {
  const key = tokyoDay(now).key;
  const [year, month] = key.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, 0));
  return { today: Number(key.replaceAll('-', '')), monthStart: year * 10000 + month * 100 + 1,
    closeDate: Number(previous.toISOString().slice(0, 10).replaceAll('-', '')), todayLabel: key };
}
function movement(transaction, accountId) {
  let result = 0n;
  if (transaction.from_account === accountId) result -= decimal(transaction.amount) + decimal(transaction.from_fee);
  if (transaction.to_account === accountId) result += decimal(transaction.amount) - decimal(transaction.to_fee);
  return result;
}
function balances(account, transactions, dates) {
  if (!validDate(account.balance_date) || account.balance_date > dates.today || !/^[A-Z]{3}$/.test(account.currency)) throw new Error('Invalid account baseline');
  let closing = decimal(account.balance);
  let currentMonth = 0n;
  for (const transaction of transactions) {
    if (transaction.from_account !== String(account._id) && transaction.to_account !== String(account._id)) continue;
    if (!validDate(transaction.date)) throw new Error('Invalid ledger date');
    if (transaction.date <= account.balance_date || transaction.date > dates.today) continue;
    const change = movement(transaction, String(account._id));
    if (transaction.date < dates.monthStart) closing += change;
    else currentMonth += change;
  }
  return { current: decimalText(closing + currentMonth), closing: decimalText(closing), currentMonth: decimalText(currentMonth), closingUnits: closing };
}
function eligible(account, dates) {
  return validDate(account.balance_date) && account.balance_date < dates.closeDate;
}
module.exports = { decimal, decimalText, storedNumber, validDate, period, movement, balances, eligible };
