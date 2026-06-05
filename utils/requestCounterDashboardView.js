const {
  UNKNOWN_REQUEST_CATEGORY,
  normalizeRequestCategory,
} = require('../services/incomingRequestCounterService');

const CATEGORY_COLORS = [
  '#17C696',
  '#19E3E3',
  '#FFC247',
  '#5B8DEF',
  '#FF7A90',
  '#B985FF',
  '#6BE675',
  '#FF9F40',
  '#A5B4FC',
  '#F472B6',
  '#2DD4BF',
  '#FACC15',
];
const UNKNOWN_CATEGORY_COLOR = '#717A88';

const TEXT = {
  en: {
    currentMinutes: 'Current Minutes',
    nextResponse: 'Next Response',
    window: 'Window',
    ngMinutes: 'NG Minutes',
    storedMinutes: 'Stored Minutes',
    minUnit: 'min',
    minute: 'minute',
    hour: 'hour',
    day: 'day',
    na: 'N/A',
    remaining: (count) => `${count} min remaining`,
    infiniteUntilMax: '∞ until max',
    untilBelowMax: (minutes) => `${minutes} min until below max`,
    untilMax: (minutes) => `${minutes} min until max`,
    httpOk: 'HTTP 200',
    httpNg: 'HTTP 429',
    since: (date) => `Since ${date}`,
    currentWindow: 'Current window',
    retention: '7-day retention',
    unknownCategory: UNKNOWN_REQUEST_CATEGORY,
  },
  ja: {
    currentMinutes: '現在の分数',
    nextResponse: '次のレスポンス',
    window: '集計期間',
    ngMinutes: 'NG分',
    storedMinutes: '保存済み分',
    minUnit: '分',
    minute: '分',
    hour: '時間',
    day: '日',
    na: 'N/A',
    remaining: (count) => `残り ${count}分`,
    infiniteUntilMax: '上限まで ∞',
    untilBelowMax: (minutes) => `上限未満まで ${minutes}分`,
    untilMax: (minutes) => `上限まで ${minutes}分`,
    httpOk: 'HTTP 200',
    httpNg: 'HTTP 429',
    since: (date) => `${date} から`,
    currentWindow: '現在の集計期間',
    retention: '7日間保持',
    unknownCategory: '不明',
  },
};

function getText(locale) {
  return TEXT[locale] || TEXT.en;
}

function formatNumber(value, locale = 'en') {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(locale === 'ja' ? 'ja-JP' : 'en-US') : '0';
}

function formatDateTime(value, locale = 'en') {
  const text = getText(locale);
  if (!value) {
    return text.na;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return text.na;
  }

  return date.toLocaleString(locale === 'ja' ? 'ja-JP' : undefined);
}

function formatWindow(minutes, locale = 'en') {
  const text = getText(locale);
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) {
    return text.na;
  }

  if (value % 1440 === 0) {
    const days = value / 1440;
    return locale === 'ja'
      ? `${formatNumber(days, locale)}${text.day}`
      : `${formatNumber(days, locale)} day${days === 1 ? '' : 's'}`;
  }

  if (value % 60 === 0) {
    const hours = value / 60;
    return locale === 'ja'
      ? `${formatNumber(hours, locale)}${text.hour}`
      : `${formatNumber(hours, locale)} hour${hours === 1 ? '' : 's'}`;
  }

  return locale === 'ja'
    ? `${formatNumber(value, locale)}${text.minute}`
    : `${formatNumber(value, locale)} min`;
}

function formatMinuteDuration(minutes, locale = 'en') {
  const value = Number(minutes);
  const totalMinutes = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(locale === 'ja'
      ? `${formatNumber(hours, locale)}${getText(locale).hour}`
      : `${formatNumber(hours, locale)} hour${hours === 1 ? '' : 's'}`);
  }

  if (remainingMinutes > 0 || parts.length === 0) {
    parts.push(locale === 'ja'
      ? `${formatNumber(remainingMinutes, locale)}${getText(locale).minute}`
      : `${formatNumber(remainingMinutes, locale)} minute${remainingMinutes === 1 ? '' : 's'}`);
  }

  return parts.join(' ');
}

function formatCurrentMinutesHelper(dashboard, locale = 'en') {
  const text = getText(locale);
  const timing = dashboard.limitTiming || null;

  if (!timing) {
    return text.remaining(formatNumber(dashboard.remaining, locale));
  }

  if (timing.mode === 'infinite') {
    return text.infiniteUntilMax;
  }

  if (timing.mode === 'until_below_max') {
    return text.untilBelowMax(formatNumber(timing.minutes, locale));
  }

  return text.untilMax(formatNumber(timing.minutes, locale));
}

function buildOverviewCards(dashboard, options = {}) {
  const locale = options.locale || 'en';
  const text = getText(locale);
  const settings = dashboard.settings;

  return [
    {
      key: 'currentMinutes',
      label: text.currentMinutes,
      value: `${formatNumber(dashboard.currentCount, locale)} / ${formatNumber(settings.maxRequests, locale)} ${text.minUnit}`,
      helper: formatCurrentMinutesHelper(dashboard, locale),
      tone: dashboard.currentCount >= settings.maxRequests ? 'danger' : 'ok',
    },
    {
      key: 'nextResponse',
      label: text.nextResponse,
      value: dashboard.nextDecision,
      helper: dashboard.nextDecision === 'OK' ? text.httpOk : text.httpNg,
      tone: dashboard.nextDecision === 'OK' ? 'ok' : 'danger',
    },
    {
      key: 'window',
      label: text.window,
      value: formatWindow(settings.windowMinutes, locale),
      helper: text.since(formatDateTime(dashboard.currentWindowStart, locale)),
    },
    {
      key: 'ngMinutes',
      label: text.ngMinutes,
      value: formatNumber(dashboard.blockedInWindow, locale),
      helper: text.currentWindow,
    },
    {
      key: 'storedMinutes',
      label: text.storedMinutes,
      value: formatNumber(dashboard.totalStored, locale),
      helper: text.retention,
    },
  ];
}

function hashString(value) {
  return String(value || '').split('').reduce((hash, character) => {
    return ((hash << 5) - hash) + character.charCodeAt(0);
  }, 0);
}

function getCategoryColor(category) {
  const normalized = normalizeRequestCategory(category);
  if (normalized === UNKNOWN_REQUEST_CATEGORY) {
    return UNKNOWN_CATEGORY_COLOR;
  }

  const index = Math.abs(hashString(normalized)) % CATEGORY_COLORS.length;
  return CATEGORY_COLORS[index];
}

function buildDailyCategoryOrder(rows = []) {
  const totals = new Map();

  rows.forEach((row) => {
    (Array.isArray(row.categories) ? row.categories : []).forEach((category) => {
      const name = normalizeRequestCategory(category.name);
      const minutes = Number(category.minutes) || 0;
      totals.set(name, (totals.get(name) || 0) + minutes);
    });
  });

  return Array.from(totals.entries())
    .sort(([leftName, leftMinutes], [rightName, rightMinutes]) => {
      if (leftName === UNKNOWN_REQUEST_CATEGORY && rightName !== UNKNOWN_REQUEST_CATEGORY) {
        return -1;
      }
      if (rightName === UNKNOWN_REQUEST_CATEGORY && leftName !== UNKNOWN_REQUEST_CATEGORY) {
        return 1;
      }
      return rightMinutes - leftMinutes || leftName.localeCompare(rightName);
    })
    .map(([name]) => name);
}

function getCategoryDisplayName(name, locale) {
  const normalized = normalizeRequestCategory(name);
  if (normalized === UNKNOWN_REQUEST_CATEGORY) {
    return getText(locale).unknownCategory;
  }
  return normalized;
}

function mapDailyMinuteStats(rows = [], options = {}) {
  const locale = options.locale || 'en';
  const maxTotal = Math.max(1, ...rows.map((row) => row.totalMinutes || 0));
  const categoryOrder = buildDailyCategoryOrder(rows);

  return rows.map((row) => {
    const totalMinutes = row.totalMinutes || 0;
    const categories = (Array.isArray(row.categories) ? row.categories : [])
      .map((category) => {
        const name = normalizeRequestCategory(category.name);
        const minutes = Number(category.minutes) || 0;

        return {
          name,
          displayName: getCategoryDisplayName(name, locale),
          minutes,
          durationDisplay: formatMinuteDuration(minutes, locale),
          percent: totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0,
          color: getCategoryColor(name),
        };
      })
      .filter((category) => category.minutes > 0)
      .sort((left, right) => {
        return categoryOrder.indexOf(left.name) - categoryOrder.indexOf(right.name);
      });

    return {
      dateKey: row.dateKey,
      totalDurationDisplay: formatMinuteDuration(totalMinutes, locale),
      totalPercent: Math.round((totalMinutes / maxTotal) * 100),
      categories,
    };
  });
}

module.exports = {
  buildOverviewCards,
  formatDateTime,
  formatMinuteDuration,
  formatNumber,
  formatWindow,
  mapDailyMinuteStats,
};
