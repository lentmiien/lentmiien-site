const THIRTY_DAYS_MS = 1000 * 60 * 60 * 24 * 30;
const DEFAULT_HISTORY_VALUE = 'last30';
const HISTORY_MONTH_LIMIT = 36;
const HISTORY_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

const monthFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

const createUtcMonthStart = (year, monthIndex) => new Date(Date.UTC(year, monthIndex, 1));

const buildReceiptHistoryOptions = (now = new Date()) => {
  const options = [{ value: DEFAULT_HISTORY_VALUE, label: 'Last 30 days' }];
  const startOfCurrentMonth = createUtcMonthStart(now.getUTCFullYear(), now.getUTCMonth());

  for (let offset = 0; offset < HISTORY_MONTH_LIMIT; offset += 1) {
    const monthStart = createUtcMonthStart(
      startOfCurrentMonth.getUTCFullYear(),
      startOfCurrentMonth.getUTCMonth() - offset,
    );

    options.push({
      value: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`,
      label: monthFormatter.format(monthStart),
    });
  }

  return options;
};

const resolveReceiptHistorySelection = (value, historyOptions = buildReceiptHistoryOptions()) => {
  const rawValue = typeof value === 'string' ? value.trim() : '';
  if (!rawValue) return DEFAULT_HISTORY_VALUE;
  if (!HISTORY_MONTH_PATTERN.test(rawValue) && rawValue !== DEFAULT_HISTORY_VALUE) {
    return DEFAULT_HISTORY_VALUE;
  }

  const matched = historyOptions.find((option) => option.value === rawValue);
  return matched ? matched.value : DEFAULT_HISTORY_VALUE;
};

const getReceiptHistoryConfig = (value, now = new Date()) => {
  const historyOptions = buildReceiptHistoryOptions(now);
  const selectedHistory = resolveReceiptHistorySelection(value, historyOptions);

  if (selectedHistory === DEFAULT_HISTORY_VALUE) {
    return {
      historyOptions,
      selectedHistory,
      historyLabel: 'Last 30 days',
      historyEmptyMessage: 'No receipts found in the last 30 days.',
      query: {
        date: {
          $gte: new Date(now.getTime() - THIRTY_DAYS_MS),
        },
      },
    };
  }

  const [, yearString, monthString] = selectedHistory.match(HISTORY_MONTH_PATTERN);
  const year = Number.parseInt(yearString, 10);
  const monthIndex = Number.parseInt(monthString, 10) - 1;
  const monthStart = createUtcMonthStart(year, monthIndex);
  const monthEnd = createUtcMonthStart(year, monthIndex + 1);
  const historyLabel = monthFormatter.format(monthStart);

  return {
    historyOptions,
    selectedHistory,
    historyLabel,
    historyEmptyMessage: `No receipts found for ${historyLabel}.`,
    query: {
      date: {
        $gte: monthStart,
        $lt: monthEnd,
      },
    },
  };
};

const buildReceiptHistoryReturnUrl = (value) => {
  const selectedHistory = resolveReceiptHistorySelection(value);
  if (selectedHistory === DEFAULT_HISTORY_VALUE) return '/receipt';
  return `/receipt?history=${encodeURIComponent(selectedHistory)}`;
};

module.exports = {
  DEFAULT_HISTORY_VALUE,
  HISTORY_MONTH_LIMIT,
  buildReceiptHistoryOptions,
  resolveReceiptHistorySelection,
  getReceiptHistoryConfig,
  buildReceiptHistoryReturnUrl,
};
