function parseOptionalDateOnly(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  if (typeof value !== 'string') {
    throw new TypeError('Date must be a string');
  }

  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new RangeError('Date must use YYYY-MM-DD format');
  }

  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new RangeError('Date is not a valid calendar date');
  }
  return date;
}

function toDateOnlyString(value) {
  if (!value) return '';

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function toLocalDateOnlyString(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function hasDatePassed(value, now = new Date()) {
  const dateValue = toDateOnlyString(value);
  const todayValue = toLocalDateOnlyString(now);
  return dateValue.length > 0 && todayValue.length > 0 && dateValue < todayValue;
}

module.exports = {
  hasDatePassed,
  parseOptionalDateOnly,
  toDateOnlyString,
  toLocalDateOnlyString,
};
