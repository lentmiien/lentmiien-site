const DEFAULT_CURRENCY = 'JPY';
const MAX_MONTHS = 24;

function pad(value) {
  return String(value).padStart(2, '0');
}

function toCurrency(value, currency = DEFAULT_CURRENCY, options = {}) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return '--';
  }
  const formatter = new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency,
    maximumFractionDigits: options.maximumFractionDigits ?? 0,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
  });
  return formatter.format(Number(value));
}

function toPercent(value, base) {
  if (!Number.isFinite(value) || !Number.isFinite(base) || base === 0) {
    return null;
  }
  return (value / base) * 100;
}

function delta(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) {
    return null;
  }
  return current - previous;
}

function deltaPercent(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

function monthKey(year, month) {
  return `${year}-${pad(month)}`;
}

function intRangeForMonth(year, month) {
  const start = (year * 10000) + (month * 100);
  return { start, end: start + 32 };
}

function buildRecentPeriods(months = 6, anchorDate = new Date()) {
  const safeMonths = Math.max(1, Math.min(MAX_MONTHS, Number(months) || 1));
  const list = [];
  let year = anchorDate.getUTCFullYear();
  let month = anchorDate.getUTCMonth() + 1;
  for (let i = 0; i < safeMonths; i += 1) {
    list.unshift({
      year,
      month,
      label: monthKey(year, month),
      range: intRangeForMonth(year, month),
    });
    month -= 1;
    if (month < 1) {
      month = 12;
      year -= 1;
    }
  }
  return list;
}

function resolvePeriod(input = {}) {
  const now = new Date();
  const periodText = typeof input.period === 'string' ? input.period : null;
  const yearInput = Number.parseInt(input.year, 10);
  const monthInput = Number.parseInt(input.month, 10);
  let year = now.getUTCFullYear();
  let month = now.getUTCMonth() + 1;

  if (periodText && /^\d{4}-(0[1-9]|1[0-2])$/.test(periodText)) {
    const [y, m] = periodText.split('-');
    year = Number.parseInt(y, 10);
    month = Number.parseInt(m, 10);
  } else if (Number.isInteger(yearInput) && Number.isInteger(monthInput) && monthInput >= 1 && monthInput <= 12) {
    year = yearInput;
    month = monthInput;
  }

  return {
    year,
    month,
    label: monthKey(year, month),
    range: intRangeForMonth(year, month),
  };
}

function intDateToISO(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const year = Math.floor(value / 10000);
  const month = Math.floor((value % 10000) / 100);
  const day = value % 100;
  if (year < 1970 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

module.exports = {
  buildRecentPeriods,
  delta,
  deltaPercent,
  intDateToISO,
  intRangeForMonth,
  monthKey,
  pad,
  resolvePeriod,
  toCurrency,
  toPercent,
};
