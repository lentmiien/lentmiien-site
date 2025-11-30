const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

function formatBytes(value) {
  if (typeof value !== 'number' || Number.isNaN(value) || value === 0) {
    return '0 B';
  }
  const base = 1024;
  const absolute = Math.abs(value);
  const exponent = Math.min(Math.floor(Math.log(absolute) / Math.log(base)), BYTE_UNITS.length - 1);
  const scaled = value / (base ** exponent);
  const digits = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${scaled.toFixed(digits)} ${BYTE_UNITS[exponent]}`;
}

function formatNumber(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0';
  }
  return value.toLocaleString('en-US');
}

function formatPercent(value, digits = 1) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '0%';
  }
  return `${value.toFixed(digits)}%`;
}

function calculatePercent(total, portion) {
  if (!total || typeof total !== 'number' || typeof portion !== 'number') {
    return 0;
  }
  return (portion / total) * 100;
}

module.exports = {
  formatBytes,
  formatNumber,
  formatPercent,
  calculatePercent,
};
