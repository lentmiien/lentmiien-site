const {
  DEVICE_USAGE_CATEGORIES,
  DEVICE_USAGE_CATEGORY_LABELS,
  DEVICE_USAGE_TEXT,
  normalizeDeviceUsageCategory,
} = require('../services/deviceUsageService');

const TEXT = {
  en: {
    rollingUsage: 'Rolling Usage',
    learningGate: 'Learning Gate',
    nextEntertainment: 'Next Entertainment',
    rewardsToday: 'Rewards Today',
    blockedToday: 'Blocked Today',
    storedMinutes: 'Stored Minutes',
    minUnit: 'min',
    pointsUnit: 'pts',
    unlocked: 'Entertainment unlocked',
    remainingLearning: (minutes) => `${minutes} min learning remaining`,
    remainingRolling: (minutes) => `${minutes} min remaining`,
    waitMinutes: (minutes) => `${minutes} min until below limit`,
    infiniteUntilLimit: 'No projected limit',
    currentWindow: 'Current rolling window',
    today: 'Today',
    retention: '90-day raw retention',
    action: (value) => `Action: ${value}`,
    noValue: 'N/A',
  },
  ja: {
    rollingUsage: 'ローリング利用',
    learningGate: '学習条件',
    nextEntertainment: '次の娯楽',
    rewardsToday: '今日のご褒美',
    blockedToday: '今日のブロック',
    storedMinutes: '保存済み分',
    minUnit: '分',
    pointsUnit: '点',
    unlocked: '娯楽を利用できます',
    remainingLearning: (minutes) => `学習が残り ${minutes}分`,
    remainingRolling: (minutes) => `残り ${minutes}分`,
    waitMinutes: (minutes) => `上限未満まで ${minutes}分`,
    infiniteUntilLimit: '上限予測なし',
    currentWindow: '現在のローリング期間',
    today: '今日',
    retention: '90日間の生データ保持',
    action: (value) => `操作: ${value}`,
    noValue: 'N/A',
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
    return text.noValue;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return text.noValue;
  }

  return date.toLocaleString(locale === 'ja' ? 'ja-JP' : undefined);
}

function formatWindow(minutes, locale = 'en') {
  const text = getText(locale);
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) {
    return text.noValue;
  }

  if (value % 1440 === 0) {
    const days = value / 1440;
    return locale === 'ja'
      ? `${formatNumber(days, locale)}日`
      : `${formatNumber(days, locale)} day${days === 1 ? '' : 's'}`;
  }

  if (value % 60 === 0) {
    const hours = value / 60;
    return locale === 'ja'
      ? `${formatNumber(hours, locale)}時間`
      : `${formatNumber(hours, locale)} hour${hours === 1 ? '' : 's'}`;
  }

  return locale === 'ja'
    ? `${formatNumber(value, locale)}分`
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
      ? `${formatNumber(hours, locale)}時間`
      : `${formatNumber(hours, locale)} hour${hours === 1 ? '' : 's'}`);
  }

  if (remainingMinutes > 0 || parts.length === 0) {
    parts.push(locale === 'ja'
      ? `${formatNumber(remainingMinutes, locale)}分`
      : `${formatNumber(remainingMinutes, locale)} minute${remainingMinutes === 1 ? '' : 's'}`);
  }

  return parts.join(' ');
}

function formatRollingTiming(dashboard, locale = 'en') {
  const text = getText(locale);
  const timing = dashboard.limitTiming || null;

  if (!timing) {
    return text.remainingRolling(formatNumber(dashboard.rollingRemainingMinutes, locale));
  }

  if (timing.mode === 'until_below_limit') {
    return text.waitMinutes(formatNumber(timing.minutes, locale));
  }

  if (timing.mode === 'until_limit') {
    return text.remainingRolling(formatNumber(dashboard.rollingRemainingMinutes, locale));
  }

  return text.infiniteUntilLimit;
}

function getActionLabel(action, locale = 'en') {
  const actionText = (DEVICE_USAGE_TEXT[locale] || DEVICE_USAGE_TEXT.en).actions;
  return actionText[action] || action;
}

function buildOverviewCards(dashboard, options = {}) {
  const locale = options.locale || 'en';
  const text = getText(locale);
  const settings = dashboard.settings;
  const learningRemaining = dashboard.learningRemainingMinutes || 0;
  const rollingBlocked = dashboard.currentCountedMinutes >= settings.rollingLimitMinutes;

  return [
    {
      key: 'rollingUsage',
      label: text.rollingUsage,
      value: `${formatNumber(dashboard.currentCountedMinutes, locale)} / ${formatNumber(settings.rollingLimitMinutes, locale)} ${text.minUnit}`,
      helper: formatRollingTiming(dashboard, locale),
      tone: rollingBlocked ? 'danger' : 'ok',
    },
    {
      key: 'learningGate',
      label: text.learningGate,
      value: `${formatNumber(dashboard.currentLearningMinutes, locale)} / ${formatNumber(settings.learningRequiredMinutes, locale)} ${text.minUnit}`,
      helper: dashboard.entertainmentUnlocked
        ? text.unlocked
        : text.remainingLearning(formatNumber(learningRemaining, locale)),
      tone: dashboard.entertainmentUnlocked ? 'ok' : 'warning',
    },
    {
      key: 'nextEntertainment',
      label: text.nextEntertainment,
      value: dashboard.nextEntertainmentStatus,
      helper: text.action(getActionLabel(dashboard.nextEntertainmentAction, locale)),
      tone: dashboard.nextEntertainmentStatus === 'OK' ? 'ok' : 'danger',
    },
    {
      key: 'rewardsToday',
      label: text.rewardsToday,
      value: `${formatNumber(dashboard.rewardSummary.points, locale)} ${text.pointsUnit}`,
      helper: `${formatNumber(dashboard.rewardSummary.count, locale)} records`,
      tone: dashboard.rewardSummary.points > 0 ? 'ok' : '',
    },
    {
      key: 'blockedToday',
      label: text.blockedToday,
      value: formatNumber(dashboard.blockedToday, locale),
      helper: text.today,
      tone: dashboard.blockedToday > 0 ? 'danger' : 'ok',
    },
    {
      key: 'storedMinutes',
      label: text.storedMinutes,
      value: formatNumber(dashboard.totalStored, locale),
      helper: text.retention,
      tone: '',
    },
  ];
}

function getCategoryLabel(category, locale = 'en') {
  const normalized = normalizeDeviceUsageCategory(category);
  const meta = DEVICE_USAGE_CATEGORY_LABELS[normalized] || DEVICE_USAGE_CATEGORY_LABELS.entertainment;
  return locale === 'ja' ? meta.ja : meta.en;
}

function getCategoryColor(category) {
  const normalized = normalizeDeviceUsageCategory(category);
  const meta = DEVICE_USAGE_CATEGORY_LABELS[normalized] || DEVICE_USAGE_CATEGORY_LABELS.entertainment;
  return meta.color;
}

function getCategoryRuleText(category, locale = 'en') {
  const normalized = normalizeDeviceUsageCategory(category);
  const meta = DEVICE_USAGE_CATEGORY_LABELS[normalized] || DEVICE_USAGE_CATEGORY_LABELS.entertainment;
  return locale === 'ja' ? meta.ruleJa : meta.ruleEn;
}

function mapDailyStats(rows = [], options = {}) {
  const locale = options.locale || 'en';
  const maxTotal = Math.max(1, ...rows.map((row) => row.totalMinutes || 0));

  return rows.map((row) => {
    const totalMinutes = row.totalMinutes || 0;
    const categories = DEVICE_USAGE_CATEGORIES.map((category) => {
      const source = (Array.isArray(row.categories) ? row.categories : [])
        .find((entry) => normalizeDeviceUsageCategory(entry.category) === category);
      const minutes = source ? Number(source.totalMinutes) || 0 : 0;

      return {
        category,
        label: getCategoryLabel(category, locale),
        minutes,
        countedMinutes: source ? Number(source.countedMinutes) || 0 : 0,
        allowedMinutes: source ? Number(source.allowedMinutes) || 0 : 0,
        blockedMinutes: source ? Number(source.blockedMinutes) || 0 : 0,
        freeLearningMinutes: source ? Number(source.freeLearningMinutes) || 0 : 0,
        durationDisplay: formatMinuteDuration(minutes, locale),
        percent: totalMinutes > 0 ? (minutes / totalMinutes) * 100 : 0,
        color: getCategoryColor(category),
      };
    }).filter((category) => category.minutes > 0);

    return {
      dateKey: row.dateKey,
      isToday: Boolean(row.isToday),
      totalMinutes,
      totalDurationDisplay: formatMinuteDuration(totalMinutes, locale),
      countedDurationDisplay: formatMinuteDuration(row.countedMinutes || 0, locale),
      blockedDurationDisplay: formatMinuteDuration(row.blockedMinutes || 0, locale),
      learningDurationDisplay: formatMinuteDuration(row.learningMinutes || 0, locale),
      totalPercent: Math.round((totalMinutes / maxTotal) * 100),
      categories,
    };
  });
}

function mapPackageStats(rows = [], options = {}) {
  const locale = options.locale || 'en';
  const maxTotal = Math.max(1, ...rows.map((row) => row.totalMinutes || 0));

  return rows.map((row) => ({
    packageName: row.packageName,
    category: normalizeDeviceUsageCategory(row.category),
    categoryLabel: getCategoryLabel(row.category, locale),
    categoryColor: getCategoryColor(row.category),
    totalMinutes: Number(row.totalMinutes) || 0,
    totalDurationDisplay: formatMinuteDuration(row.totalMinutes || 0, locale),
    allowedDurationDisplay: formatMinuteDuration(row.allowedMinutes || 0, locale),
    countedDurationDisplay: formatMinuteDuration(row.countedMinutes || 0, locale),
    blockedDurationDisplay: formatMinuteDuration(row.blockedMinutes || 0, locale),
    percent: ((Number(row.totalMinutes) || 0) / maxTotal) * 100,
    lastSeenDisplay: formatDateTime(row.lastSeenAt, locale),
  }));
}

function mapRecentRequest(entry, options = {}) {
  const locale = options.locale || 'en';
  const category = normalizeDeviceUsageCategory(entry.packageCategory);

  return {
    receivedAtDisplay: formatDateTime(entry.receivedAt, locale),
    statusText: entry.statusText || (entry.allowed ? 'OK' : 'NG'),
    action: entry.action || (entry.allowed ? 'allow' : 'wait'),
    actionDisplay: getActionLabel(entry.action || (entry.allowed ? 'allow' : 'wait'), locale),
    reasonCode: entry.reasonCode || 'allowed',
    packageName: entry.packageName || 'unknown',
    category,
    categoryDisplay: getCategoryLabel(category, locale),
    categoryColor: getCategoryColor(category),
    countedDisplay: entry.countsTowardLimit ? 'Yes' : 'No',
    learningAfter: formatNumber(entry.learningMinutesTodayAfter || 0, locale),
    rollingAfter: formatNumber(entry.countedMinutesInWindowAfter || 0, locale),
    ip: entry.ip || 'N/A',
    userAgent: entry.userAgent || 'N/A',
  };
}

function buildCategoryRules(options = {}) {
  const locale = options.locale || 'en';

  return DEVICE_USAGE_CATEGORIES.map((category) => ({
    category,
    label: getCategoryLabel(category, locale),
    color: getCategoryColor(category),
    rule: getCategoryRuleText(category, locale),
  }));
}

module.exports = {
  buildCategoryRules,
  buildOverviewCards,
  formatDateTime,
  formatMinuteDuration,
  formatNumber,
  formatWindow,
  getActionLabel,
  getCategoryColor,
  getCategoryLabel,
  getText,
  mapDailyStats,
  mapPackageStats,
  mapRecentRequest,
};
