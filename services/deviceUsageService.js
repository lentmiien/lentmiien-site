const DeviceUsageRequest = require('../models/device_usage_request');
const DeviceUsageSettings = require('../models/device_usage_settings');
const DeviceUsageGateState = require('../models/device_usage_gate_state');
const DeviceUsagePackageRule = require('../models/device_usage_package_rule');
const DeviceUsageReward = require('../models/device_usage_reward');
const DeviceUsageRewardSuggestion = require('../models/device_usage_reward_suggestion');
const { ensureDeviceUsagePath } = require('../utils/deviceUsagePath');

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_USAGE_SETTINGS_KEY = 'default';
const DEVICE_USAGE_DEFAULT_LIMIT_MINUTES = 60;
const DEVICE_USAGE_DEFAULT_WINDOW_MINUTES = 90;
const DEVICE_USAGE_DEFAULT_LEARNING_REQUIRED_MINUTES = 30;
const DEVICE_USAGE_DEFAULT_LEARNING_FREE_MINUTES = 30;
const DEVICE_USAGE_DEFAULT_HOMEWORK_GATE_ENABLED = false;
const DEVICE_USAGE_DEFAULT_MAX_VOLUME = 100;
const DEVICE_USAGE_MAX_WINDOW_MINUTES = 7 * 24 * 60;
const DEVICE_USAGE_MAX_DAILY_MINUTES = 24 * 60;
const DEVICE_USAGE_MAX_LIMIT_MINUTES = 100000;
const DEVICE_USAGE_MAX_VOLUME = 100;
const DEVICE_USAGE_MAX_VOLUME_STEP = 10;
const DEVICE_USAGE_DASHBOARD_DAYS = 7;
const UNKNOWN_PACKAGE_NAME = 'unknown';
const PACKAGE_NAME_MAX_LENGTH = 240;
const PACKAGE_LABEL_MAX_LENGTH = 120;
const NOTE_MAX_LENGTH = 1000;
const COMMENT_MAX_LENGTH = 1000;
const REWARD_TITLE_MAX_LENGTH = 160;
const CATEGORY_LEARNING = 'learning';
const CATEGORY_MANAGEMENT = 'management';
const CATEGORY_ENTERTAINMENT = 'entertainment';
const DEVICE_USAGE_CATEGORIES = [
  CATEGORY_LEARNING,
  CATEGORY_MANAGEMENT,
  CATEGORY_ENTERTAINMENT,
];

const DEVICE_USAGE_CATEGORY_LABELS = {
  learning: {
    color: '#2BC8A4',
    en: 'Learning',
    ja: '学習',
    ruleEn: 'Logged learning and manual study count toward the required block; the first learning minutes are free from the rolling limit.',
    ruleJa: '記録された学習と手入力の学習時間が条件に入り、最初の学習時間はローリング上限に入りません。',
  },
  management: {
    color: '#62A8FF',
    en: 'Management',
    ja: '管理',
    ruleEn: 'Adult or device-management apps are logged but ignored by limits.',
    ruleJa: '大人用・端末管理用アプリは記録のみで、制限には入りません。',
  },
  entertainment: {
    color: '#FFB84D',
    en: 'Entertainment',
    ja: '娯楽',
    ruleEn: 'Unknown packages default here and require today\'s learning gate plus homework when enabled.',
    ruleJa: '不明なパッケージはここに入り、当日の学習条件と有効時の宿題条件が必要です。',
  },
};

const DEVICE_USAGE_TEXT = {
  en: {
    reasons: {
      allowed: 'Allowed.',
      free_learning: 'Learning minute allowed and kept outside the rolling limit.',
      management_ignored: 'Management app logged and ignored by limits.',
      learning_required: 'Entertainment is locked until today\'s learning requirement is complete.',
      homework_required: 'Entertainment is locked until today\'s homework is cleared.',
      rolling_limit: 'Rolling usage limit reached.',
    },
    actions: {
      allow: 'Allow',
      learn_first: 'Learn first',
      finish_homework: 'Finish homework',
      wait: 'Wait',
    },
  },
  ja: {
    reasons: {
      allowed: '利用できます。',
      free_learning: '学習時間として許可され、ローリング上限には入りません。',
      management_ignored: '管理アプリとして記録し、制限には入りません。',
      learning_required: '今日の学習条件が終わるまで娯楽はロックされています。',
      homework_required: '今日の宿題が完了するまで娯楽はロックされています。',
      rolling_limit: 'ローリング利用上限に達しています。',
    },
    actions: {
      allow: '許可',
      learn_first: '先に学習',
      finish_homework: '宿題を完了',
      wait: '待機',
    },
  },
};

class DeviceUsageSettingsError extends Error {
  constructor(message, status = 400, code = 'invalid_device_usage_settings') {
    super(message);
    this.name = 'DeviceUsageSettingsError';
    this.status = status;
    this.code = code;
  }
}

function getDeviceUsageText(locale = 'en') {
  return DEVICE_USAGE_TEXT[locale] || DEVICE_USAGE_TEXT.en;
}

function getHeader(req, name) {
  if (req && typeof req.get === 'function') {
    return req.get(name) || null;
  }

  if (req && req.headers) {
    return req.headers[name.toLowerCase()] || null;
  }

  return null;
}

function getRequestPath(req) {
  return req.originalUrl || req.url || req.path || '/';
}

function getEndpointPath(req, fallback) {
  return fallback || req.baseUrl || req.path || getRequestPath(req);
}

function leanExec(query) {
  if (query && typeof query.lean === 'function') {
    const leanQuery = query.lean();
    if (leanQuery && typeof leanQuery.exec === 'function') {
      return leanQuery.exec();
    }
    return leanQuery;
  }

  if (query && typeof query.exec === 'function') {
    return query.exec();
  }

  return query;
}

function normalizeStoredInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function normalizeStoredSteppedInteger(value, fallback, min, max, step) {
  const parsed = normalizeStoredInteger(value, fallback, min, max);
  return parsed % step === 0 ? parsed : fallback;
}

function normalizeStoredBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 1 || value === '1') {
    return true;
  }

  if (value === 0 || value === '0') {
    return false;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', 'on', 'yes'].includes(normalized)) {
    return true;
  }

  if (['false', 'off', 'no'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseBoundedInteger(value, label, min, max) {
  const trimmed = String(value ?? '').trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new DeviceUsageSettingsError(`${label} must be a whole number.`);
  }

  const parsed = Number.parseInt(trimmed, 10);
  if (parsed < min || parsed > max) {
    throw new DeviceUsageSettingsError(`${label} must be between ${min} and ${max}.`);
  }

  return parsed;
}

function parseSteppedBoundedInteger(value, label, min, max, step) {
  const parsed = parseBoundedInteger(value, label, min, max);
  if (parsed % step !== 0) {
    throw new DeviceUsageSettingsError(`${label} must use ${step} step increments.`);
  }

  return parsed;
}

function parseOptionalBoundedInteger(value, label, min, max, fallback = null) {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    return fallback;
  }
  return parseBoundedInteger(trimmed, label, min, max);
}

function normalizeText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function normalizeMultilineText(value, maxLength) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, maxLength);
}

function normalizeDevicePackageName(value) {
  const values = Array.isArray(value) ? value : [value];
  const rawValue = values.find((entry) => String(entry ?? '').trim());
  const normalized = String(rawValue ?? '')
    .trim()
    .toLowerCase()
    .slice(0, PACKAGE_NAME_MAX_LENGTH);

  return normalized || UNKNOWN_PACKAGE_NAME;
}

function normalizeDeviceUsageCategory(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return DEVICE_USAGE_CATEGORIES.includes(normalized)
    ? normalized
    : CATEGORY_ENTERTAINMENT;
}

function normalizeSettings(raw = {}) {
  const rollingLimitMinutes = normalizeStoredInteger(
    raw.rollingLimitMinutes,
    DEVICE_USAGE_DEFAULT_LIMIT_MINUTES,
    1,
    DEVICE_USAGE_MAX_LIMIT_MINUTES
  );
  const rollingWindowMinutes = normalizeStoredInteger(
    raw.rollingWindowMinutes,
    DEVICE_USAGE_DEFAULT_WINDOW_MINUTES,
    1,
    DEVICE_USAGE_MAX_WINDOW_MINUTES
  );
  const learningRequiredMinutes = normalizeStoredInteger(
    raw.learningRequiredMinutes,
    DEVICE_USAGE_DEFAULT_LEARNING_REQUIRED_MINUTES,
    0,
    DEVICE_USAGE_MAX_DAILY_MINUTES
  );
  const learningFreeMinutes = normalizeStoredInteger(
    raw.learningFreeMinutes,
    DEVICE_USAGE_DEFAULT_LEARNING_FREE_MINUTES,
    0,
    DEVICE_USAGE_MAX_DAILY_MINUTES
  );
  const homeworkGateEnabled = normalizeStoredBoolean(
    raw.homeworkGateEnabled,
    DEVICE_USAGE_DEFAULT_HOMEWORK_GATE_ENABLED
  );
  const maxVolume = normalizeStoredSteppedInteger(
    raw.maxVolume,
    DEVICE_USAGE_DEFAULT_MAX_VOLUME,
    0,
    DEVICE_USAGE_MAX_VOLUME,
    DEVICE_USAGE_MAX_VOLUME_STEP
  );

  return {
    key: raw.key || DEVICE_USAGE_SETTINGS_KEY,
    rollingLimitMinutes,
    rollingWindowMinutes,
    rollingWindowMs: rollingWindowMinutes * MINUTE_MS,
    learningRequiredMinutes,
    learningFreeMinutes,
    homeworkGateEnabled,
    maxVolume,
    updatedAt: raw.updatedAt || raw.createdAt || null,
    updatedBy: raw.updatedBy || null,
  };
}

async function getDeviceUsageSettings(options = {}) {
  if (options.settings) {
    return normalizeSettings(options.settings);
  }

  const settingsModel = options.settingsModel || DeviceUsageSettings;
  const existing = await leanExec(settingsModel.findOne({ key: DEVICE_USAGE_SETTINGS_KEY }));
  if (existing) {
    return normalizeSettings(existing);
  }

  const created = await leanExec(settingsModel.findOneAndUpdate(
    { key: DEVICE_USAGE_SETTINGS_KEY },
    {
      $setOnInsert: {
        key: DEVICE_USAGE_SETTINGS_KEY,
        rollingLimitMinutes: DEVICE_USAGE_DEFAULT_LIMIT_MINUTES,
        rollingWindowMinutes: DEVICE_USAGE_DEFAULT_WINDOW_MINUTES,
        learningRequiredMinutes: DEVICE_USAGE_DEFAULT_LEARNING_REQUIRED_MINUTES,
        learningFreeMinutes: DEVICE_USAGE_DEFAULT_LEARNING_FREE_MINUTES,
        homeworkGateEnabled: DEVICE_USAGE_DEFAULT_HOMEWORK_GATE_ENABLED,
        maxVolume: DEVICE_USAGE_DEFAULT_MAX_VOLUME,
        updatedBy: null,
      },
    },
    {
      new: true,
      upsert: true,
      setDefaultsOnInsert: true,
    }
  ));

  return normalizeSettings(created);
}

async function updateDeviceUsageSettings(input = {}, options = {}) {
  const settingsModel = options.settingsModel || DeviceUsageSettings;
  const rollingLimitMinutes = parseBoundedInteger(
    input.rollingLimitMinutes,
    'Rolling limit minutes',
    1,
    DEVICE_USAGE_MAX_LIMIT_MINUTES
  );
  const rollingWindowMinutes = parseBoundedInteger(
    input.rollingWindowMinutes,
    'Rolling window minutes',
    1,
    DEVICE_USAGE_MAX_WINDOW_MINUTES
  );
  const learningRequiredMinutes = parseBoundedInteger(
    input.learningRequiredMinutes,
    'Learning required minutes',
    0,
    DEVICE_USAGE_MAX_DAILY_MINUTES
  );
  const learningFreeMinutes = parseBoundedInteger(
    input.learningFreeMinutes,
    'Free learning minutes',
    0,
    DEVICE_USAGE_MAX_DAILY_MINUTES
  );
  const homeworkGateEnabled = normalizeStoredBoolean(input.homeworkGateEnabled, false);
  const maxVolume = parseSteppedBoundedInteger(
    input.maxVolume,
    'Max volume',
    0,
    DEVICE_USAGE_MAX_VOLUME,
    DEVICE_USAGE_MAX_VOLUME_STEP
  );
  const updatedBy = typeof options.updatedBy === 'string' && options.updatedBy.trim()
    ? options.updatedBy.trim()
    : null;

  const updated = await leanExec(settingsModel.findOneAndUpdate(
    { key: DEVICE_USAGE_SETTINGS_KEY },
    {
      $set: {
        rollingLimitMinutes,
        rollingWindowMinutes,
        learningRequiredMinutes,
        learningFreeMinutes,
        homeworkGateEnabled,
        maxVolume,
        updatedBy,
      },
      $setOnInsert: {
        key: DEVICE_USAGE_SETTINGS_KEY,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  ));

  return normalizeSettings(updated);
}

function floorToMinute(date) {
  const value = new Date(date);
  value.setSeconds(0, 0);
  return value;
}

function startOfLocalDay(date) {
  const value = new Date(date);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function addLocalDays(date, days) {
  const value = new Date(date);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate() + days);
}

function formatLocalDateKey(date) {
  const value = new Date(date);
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeGateState(raw = {}, localDateKey = formatLocalDateKey(new Date())) {
  return {
    id: raw._id ? String(raw._id) : '',
    localDateKey: raw.localDateKey || localDateKey,
    manualStudyMinutes: normalizeStoredInteger(
      raw.manualStudyMinutes,
      0,
      0,
      DEVICE_USAGE_MAX_DAILY_MINUTES
    ),
    manualStudyNote: normalizeMultilineText(raw.manualStudyNote, NOTE_MAX_LENGTH),
    manualStudyUpdatedAt: raw.manualStudyUpdatedAt || null,
    manualStudyUpdatedBy: raw.manualStudyUpdatedBy || null,
    homeworkCleared: normalizeStoredBoolean(raw.homeworkCleared, false),
    homeworkClearedAt: raw.homeworkClearedAt || null,
    homeworkClearedBy: raw.homeworkClearedBy || null,
    homeworkUpdatedAt: raw.homeworkUpdatedAt || null,
    homeworkUpdatedBy: raw.homeworkUpdatedBy || null,
    updatedAt: raw.updatedAt || raw.createdAt || null,
  };
}

async function fetchGateStateForDate(localDateKey, options = {}) {
  const gateStateModel = options.gateStateModel || DeviceUsageGateState;
  const rawState = await leanExec(gateStateModel.findOne({ localDateKey }));

  return normalizeGateState(rawState || {}, localDateKey);
}

async function addManualStudyMinutes(input = {}, options = {}) {
  const gateStateModel = options.gateStateModel || DeviceUsageGateState;
  const now = new Date(options.now || Date.now());
  const localDateKey = formatLocalDateKey(now);
  const minutes = parseBoundedInteger(
    input.minutes,
    'Study minutes',
    1,
    DEVICE_USAGE_MAX_DAILY_MINUTES
  );
  const currentState = await fetchGateStateForDate(localDateKey, { ...options, gateStateModel });
  const manualStudyMinutes = currentState.manualStudyMinutes + minutes;

  if (manualStudyMinutes > DEVICE_USAGE_MAX_DAILY_MINUTES) {
    throw new DeviceUsageSettingsError(`Study minutes for a day cannot exceed ${DEVICE_USAGE_MAX_DAILY_MINUTES}.`);
  }

  const updatedBy = typeof options.updatedBy === 'string' && options.updatedBy.trim()
    ? options.updatedBy.trim()
    : null;
  const manualStudyNote = normalizeMultilineText(input.note, NOTE_MAX_LENGTH);
  const updated = await leanExec(gateStateModel.findOneAndUpdate(
    { localDateKey },
    {
      $set: {
        manualStudyMinutes,
        manualStudyNote,
        manualStudyUpdatedAt: now,
        manualStudyUpdatedBy: updatedBy,
      },
      $setOnInsert: {
        localDateKey,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  ));

  return normalizeGateState(updated, localDateKey);
}

async function updateHomeworkGateForToday(input = {}, options = {}) {
  const gateStateModel = options.gateStateModel || DeviceUsageGateState;
  const now = new Date(options.now || Date.now());
  const localDateKey = formatLocalDateKey(now);
  const homeworkCleared = normalizeStoredBoolean(input.cleared, true);
  const updatedBy = typeof options.updatedBy === 'string' && options.updatedBy.trim()
    ? options.updatedBy.trim()
    : null;
  const updated = await leanExec(gateStateModel.findOneAndUpdate(
    { localDateKey },
    {
      $set: {
        homeworkCleared,
        homeworkClearedAt: homeworkCleared ? now : null,
        homeworkClearedBy: homeworkCleared ? updatedBy : null,
        homeworkUpdatedAt: now,
        homeworkUpdatedBy: updatedBy,
      },
      $setOnInsert: {
        localDateKey,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  ));

  return normalizeGateState(updated, localDateKey);
}

function buildRecentDayRanges(now = new Date(), dayCount = DEVICE_USAGE_DASHBOARD_DAYS) {
  const todayStart = startOfLocalDay(now);
  const start = addLocalDays(todayStart, -(Math.max(1, dayCount) - 1));
  const ranges = [];

  for (let index = 0; index < Math.max(1, dayCount); index += 1) {
    const dayStart = addLocalDays(start, index);
    ranges.push({
      dateKey: formatLocalDateKey(dayStart),
      start: dayStart,
      end: addLocalDays(dayStart, 1),
      isToday: formatLocalDateKey(dayStart) === formatLocalDateKey(now),
    });
  }

  return ranges;
}

function isDuplicateKeyError(error) {
  if (!error) {
    return false;
  }
  if (error.code === 11000) {
    return true;
  }
  return Array.isArray(error.writeErrors) && error.writeErrors.some((item) => item && item.code === 11000);
}

async function findExistingMinuteRequest(model, endpointPath, minuteStart, minuteEnd) {
  const query = model.findOne({
    endpointPath,
    receivedAt: {
      $gte: minuteStart,
      $lt: minuteEnd,
    },
  });
  const sortedQuery = query && typeof query.sort === 'function'
    ? query.sort({ receivedAt: 1 })
    : query;

  return leanExec(sortedQuery);
}

function mapPackageRule(raw = {}, packageName = UNKNOWN_PACKAGE_NAME) {
  const normalizedPackageName = normalizeDevicePackageName(raw.packageName || packageName);
  const category = normalizeDeviceUsageCategory(raw.category);

  return {
    id: raw._id ? String(raw._id) : '',
    packageName: normalizedPackageName,
    category,
    active: raw.active !== false,
    known: Boolean(raw.packageName) && raw.active !== false,
    labelEn: normalizeText(raw.labelEn || '', PACKAGE_LABEL_MAX_LENGTH),
    labelJa: normalizeText(raw.labelJa || '', PACKAGE_LABEL_MAX_LENGTH),
    notes: normalizeMultilineText(raw.notes || '', NOTE_MAX_LENGTH),
    updatedAt: raw.updatedAt || raw.createdAt || null,
    updatedBy: raw.updatedBy || null,
  };
}

async function resolvePackageRule(packageName, options = {}) {
  const packageRuleModel = options.packageRuleModel || DeviceUsagePackageRule;
  const normalizedPackageName = normalizeDevicePackageName(packageName);
  const rawRule = await leanExec(packageRuleModel.findOne({
    packageName: normalizedPackageName,
    active: true,
  }));

  if (rawRule) {
    return mapPackageRule(rawRule, normalizedPackageName);
  }

  return {
    id: '',
    packageName: normalizedPackageName,
    category: CATEGORY_ENTERTAINMENT,
    active: true,
    known: false,
    labelEn: '',
    labelJa: '',
    notes: '',
    updatedAt: null,
    updatedBy: null,
  };
}

async function saveDeviceUsagePackageRule(input = {}, options = {}) {
  const packageRuleModel = options.packageRuleModel || DeviceUsagePackageRule;
  const packageName = normalizeDevicePackageName(input.packageName);
  if (packageName === UNKNOWN_PACKAGE_NAME) {
    throw new DeviceUsageSettingsError('Package name is required.');
  }

  const category = normalizeDeviceUsageCategory(input.category);
  const labelEn = normalizeText(input.labelEn, PACKAGE_LABEL_MAX_LENGTH);
  const labelJa = normalizeText(input.labelJa, PACKAGE_LABEL_MAX_LENGTH);
  const notes = normalizeMultilineText(input.notes, NOTE_MAX_LENGTH);
  const active = input.active === undefined
    ? true
    : ['true', 'on', '1', 'yes'].includes(String(input.active).toLowerCase()) || input.active === true;
  const updatedBy = typeof options.updatedBy === 'string' && options.updatedBy.trim()
    ? options.updatedBy.trim()
    : null;

  const updated = await leanExec(packageRuleModel.findOneAndUpdate(
    { packageName },
    {
      $set: {
        packageName,
        category,
        labelEn,
        labelJa,
        notes,
        active,
        updatedBy,
      },
    },
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  ));

  return mapPackageRule(updated, packageName);
}

async function deleteDeviceUsagePackageRule(input = {}, options = {}) {
  const packageRuleModel = options.packageRuleModel || DeviceUsagePackageRule;
  const packageName = normalizeDevicePackageName(input.packageName);
  if (packageName === UNKNOWN_PACKAGE_NAME) {
    throw new DeviceUsageSettingsError('Package name is required.');
  }

  const updated = await leanExec(packageRuleModel.findOneAndUpdate(
    { packageName },
    {
      $set: {
        active: false,
        updatedBy: options.updatedBy || null,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  ));

  return updated ? mapPackageRule(updated, packageName) : null;
}

async function fetchCurrentCountedEventTimes(endpointPath, settings, options = {}) {
  const requestModel = options.requestModel || options.model || DeviceUsageRequest;
  const now = new Date(options.now || Date.now());
  const windowStart = new Date(now.getTime() - settings.rollingWindowMs);
  const rows = await leanExec(requestModel.find({
    endpointPath,
    receivedAt: {
      $gte: windowStart,
      $lte: now,
    },
    allowed: true,
    countsTowardLimit: true,
  }).sort({ receivedAt: 1 }).select({ receivedAt: 1 }));

  return (Array.isArray(rows) ? rows : [])
    .map((row) => new Date(row.receivedAt).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
}

function calculateDeviceUsageLimitTiming(eventTimes, settings, now = new Date()) {
  const limit = normalizeStoredInteger(
    settings.rollingLimitMinutes,
    DEVICE_USAGE_DEFAULT_LIMIT_MINUTES,
    1,
    DEVICE_USAGE_MAX_LIMIT_MINUTES
  );
  const windowMinutes = normalizeStoredInteger(
    settings.rollingWindowMinutes,
    DEVICE_USAGE_DEFAULT_WINDOW_MINUTES,
    1,
    DEVICE_USAGE_MAX_WINDOW_MINUTES
  );
  const windowMs = Number.isFinite(Number(settings.rollingWindowMs)) && Number(settings.rollingWindowMs) > 0
    ? Number(settings.rollingWindowMs)
    : windowMinutes * MINUTE_MS;
  const nowMs = new Date(now).getTime();
  const windowStartMs = nowMs - windowMs;
  const currentEventTimes = (Array.isArray(eventTimes) ? eventTimes : [])
    .map((value) => new Date(value).getTime())
    .filter((time) => Number.isFinite(time) && time >= windowStartMs && time <= nowMs)
    .sort((a, b) => a - b);
  const currentCount = currentEventTimes.length;
  const expiryTimes = currentEventTimes
    .map((time) => time + windowMs)
    .sort((a, b) => a - b);

  if (currentCount >= limit) {
    const expirationsNeeded = currentCount - limit + 1;
    const expiryTime = expiryTimes[expirationsNeeded - 1];
    const minutes = Number.isFinite(expiryTime)
      ? Math.max(0, Math.ceil((expiryTime - nowMs) / MINUTE_MS))
      : null;

    return {
      mode: 'until_below_limit',
      minutes,
    };
  }

  if (limit > windowMinutes) {
    return {
      mode: 'infinite',
      minutes: null,
    };
  }

  let expiredCount = 0;
  for (let minuteOffset = 1; minuteOffset <= windowMinutes; minuteOffset += 1) {
    const futureMs = nowMs + (minuteOffset * MINUTE_MS);

    while (expiredCount < expiryTimes.length && expiryTimes[expiredCount] <= futureMs) {
      expiredCount += 1;
    }

    const projectedCount = currentCount + minuteOffset - expiredCount;
    if (projectedCount >= limit) {
      return {
        mode: 'until_limit',
        minutes: minuteOffset,
      };
    }
  }

  return {
    mode: 'infinite',
    minutes: null,
  };
}

async function fetchTodayLearningMinutes(endpointPath, localDateKey, options = {}) {
  const requestModel = options.requestModel || options.model || DeviceUsageRequest;

  return requestModel.countDocuments({
    endpointPath,
    localDateKey,
    packageCategory: CATEGORY_LEARNING,
    allowed: true,
  });
}

async function fetchRewardSummaryForDate(localDateKey, options = {}) {
  const rewardModel = options.rewardModel || DeviceUsageReward;
  if (!rewardModel || typeof rewardModel.aggregate !== 'function') {
    return {
      count: 0,
      points: 0,
    };
  }

  const rows = await leanExec(rewardModel.aggregate([
    { $match: { localDateKey } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        points: { $sum: '$points' },
      },
    },
  ]));
  const row = Array.isArray(rows) && rows.length ? rows[0] : {};

  return {
    count: Number(row.count) || 0,
    points: Number(row.points) || 0,
  };
}

function getDecisionForUsage({
  category,
  settings,
  learningMinutesTodayBefore,
  countedMinutesInWindowBefore,
  homeworkCleared,
}) {
  if (category === CATEGORY_MANAGEMENT) {
    return {
      allowed: true,
      action: 'allow',
      reasonCode: 'management_ignored',
      countsTowardLimit: false,
      freeLearningMinute: false,
    };
  }

  if (category === CATEGORY_LEARNING && learningMinutesTodayBefore < settings.learningFreeMinutes) {
    return {
      allowed: true,
      action: 'allow',
      reasonCode: 'free_learning',
      countsTowardLimit: false,
      freeLearningMinute: true,
    };
  }

  if (category === CATEGORY_ENTERTAINMENT && learningMinutesTodayBefore < settings.learningRequiredMinutes) {
    return {
      allowed: false,
      action: 'learn_first',
      reasonCode: 'learning_required',
      countsTowardLimit: false,
      freeLearningMinute: false,
    };
  }

  if (category === CATEGORY_ENTERTAINMENT && settings.homeworkGateEnabled && !homeworkCleared) {
    return {
      allowed: false,
      action: 'finish_homework',
      reasonCode: 'homework_required',
      countsTowardLimit: false,
      freeLearningMinute: false,
    };
  }

  const withinRollingLimit = countedMinutesInWindowBefore < settings.rollingLimitMinutes;
  return {
    allowed: withinRollingLimit,
    action: withinRollingLimit ? 'allow' : 'wait',
    reasonCode: withinRollingLimit ? 'allowed' : 'rolling_limit',
    countsTowardLimit: withinRollingLimit,
    freeLearningMinute: false,
  };
}

function buildDeviceUsageResponse({
  endpointPath,
  now,
  minuteBucket,
  packageRule,
  settings,
  decision,
  learningMinutesTodayBefore,
  learningMinutesTodayAfter,
  countedMinutesInWindowBefore,
  countedMinutesInWindowAfter,
  limitTiming,
  rewardSummary,
  loggedLearningMinutesTodayBefore,
  manualStudyMinutes,
  gateState,
}) {
  const statusText = decision.allowed ? 'OK' : 'NG';
  const learningRemaining = Math.max(0, settings.learningRequiredMinutes - learningMinutesTodayAfter);
  const freeLearningRemaining = Math.max(0, settings.learningFreeMinutes - learningMinutesTodayAfter);
  const rollingRemaining = Math.max(0, settings.rollingLimitMinutes - countedMinutesInWindowAfter);
  const homeworkCleared = Boolean(gateState?.homeworkCleared);
  const homeworkGateSatisfied = !settings.homeworkGateEnabled || homeworkCleared;
  const entertainmentUnlocked = learningRemaining === 0 && homeworkGateSatisfied;

  return {
    version: 1,
    status: statusText,
    allowed: decision.allowed,
    action: decision.action,
    reasonCode: decision.reasonCode,
    maxVolume: settings.maxVolume,
    messages: {
      en: DEVICE_USAGE_TEXT.en.reasons[decision.reasonCode] || DEVICE_USAGE_TEXT.en.reasons.allowed,
      ja: DEVICE_USAGE_TEXT.ja.reasons[decision.reasonCode] || DEVICE_USAGE_TEXT.ja.reasons.allowed,
    },
    endpointPath,
    serverTime: now.toISOString(),
    minuteBucket: minuteBucket.toISOString(),
    package: {
      name: packageRule.packageName,
      category: packageRule.category,
      known: packageRule.known,
      labelEn: packageRule.labelEn,
      labelJa: packageRule.labelJa,
    },
    usage: {
      countsTowardLimit: decision.countsTowardLimit,
      freeLearningMinute: decision.freeLearningMinute,
      learning: {
        todayMinutesBefore: learningMinutesTodayBefore,
        todayMinutes: learningMinutesTodayAfter,
        loggedMinutesBefore: loggedLearningMinutesTodayBefore,
        loggedMinutes: loggedLearningMinutesTodayBefore
          + (decision.allowed && packageRule.category === CATEGORY_LEARNING ? 1 : 0),
        manualStudyMinutes,
        requiredMinutes: settings.learningRequiredMinutes,
        remainingMinutes: learningRemaining,
        freeMinutes: settings.learningFreeMinutes,
        freeRemainingMinutes: freeLearningRemaining,
        entertainmentUnlocked,
      },
      homework: {
        gateEnabled: settings.homeworkGateEnabled,
        cleared: homeworkCleared,
        clearedAt: gateState?.homeworkClearedAt || null,
        clearedBy: gateState?.homeworkClearedBy || null,
        remaining: settings.homeworkGateEnabled && !homeworkCleared,
      },
      rolling: {
        countedMinutesBefore: countedMinutesInWindowBefore,
        countedMinutes: countedMinutesInWindowAfter,
        limitMinutes: settings.rollingLimitMinutes,
        remainingMinutes: rollingRemaining,
        windowMinutes: settings.rollingWindowMinutes,
        waitMinutes: limitTiming.mode === 'until_below_limit' ? limitTiming.minutes : null,
        projectedLimitMinutes: limitTiming.mode === 'until_limit' ? limitTiming.minutes : null,
      },
    },
    rewards: {
      todayPoints: rewardSummary.points,
      todayCount: rewardSummary.count,
    },
  };
}

function withMaxVolume(payload, settings = {}) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const fallback = normalizeStoredSteppedInteger(
    settings.maxVolume,
    DEVICE_USAGE_DEFAULT_MAX_VOLUME,
    0,
    DEVICE_USAGE_MAX_VOLUME,
    DEVICE_USAGE_MAX_VOLUME_STEP
  );

  return {
    ...payload,
    maxVolume: normalizeStoredSteppedInteger(
      payload.maxVolume,
      fallback,
      0,
      DEVICE_USAGE_MAX_VOLUME,
      DEVICE_USAGE_MAX_VOLUME_STEP
    ),
  };
}

function mapStoredDeviceUsageResult(storedRequest, duplicate = true, settings = {}) {
  const payload = storedRequest.responsePayload && typeof storedRequest.responsePayload === 'object'
    ? storedRequest.responsePayload
    : {
      version: 1,
      status: storedRequest.statusText || (storedRequest.allowed ? 'OK' : 'NG'),
      allowed: storedRequest.allowed !== false,
      action: storedRequest.action || (storedRequest.allowed === false ? 'wait' : 'allow'),
      reasonCode: storedRequest.reasonCode || 'allowed',
    };
  const responsePayload = withMaxVolume(payload, settings);

  return {
    allowed: responsePayload.allowed !== false,
    statusText: responsePayload.status || (responsePayload.allowed === false ? 'NG' : 'OK'),
    action: responsePayload.action || 'allow',
    reasonCode: responsePayload.reasonCode || 'allowed',
    responseStatusCode: storedRequest.responseStatusCode || 200,
    responsePayload,
    duplicate,
    logged: !duplicate,
  };
}

async function evaluateDeviceUsageRequest(req, options = {}) {
  const requestModel = options.requestModel || options.model || DeviceUsageRequest;
  const settings = await getDeviceUsageSettings(options);
  const now = new Date(options.now || Date.now());
  const endpointPath = getEndpointPath(req, options.endpointPath);
  const minuteBucket = floorToMinute(now);
  const localDateKey = formatLocalDateKey(now);
  const packageName = normalizeDevicePackageName([req.query?.package, req.body?.package]);
  const packageRule = await resolvePackageRule(packageName, options);
  const rollingWindowStart = new Date(now.getTime() - settings.rollingWindowMs);

  const [
    loggedLearningMinutesTodayBefore,
    gateState,
    countedEventTimes,
    rewardSummary,
  ] = await Promise.all([
    fetchTodayLearningMinutes(endpointPath, localDateKey, { ...options, requestModel }),
    fetchGateStateForDate(localDateKey, options),
    fetchCurrentCountedEventTimes(endpointPath, settings, { ...options, requestModel, now }),
    fetchRewardSummaryForDate(localDateKey, options),
  ]);
  const manualStudyMinutes = gateState.manualStudyMinutes;
  const learningMinutesTodayBefore = loggedLearningMinutesTodayBefore + manualStudyMinutes;
  const countedMinutesInWindowBefore = countedEventTimes.length;
  const decision = getDecisionForUsage({
    category: packageRule.category,
    settings,
    learningMinutesTodayBefore,
    countedMinutesInWindowBefore,
    homeworkCleared: gateState.homeworkCleared,
  });
  const learningMinutesTodayAfter = learningMinutesTodayBefore
    + (decision.allowed && packageRule.category === CATEGORY_LEARNING ? 1 : 0);
  const countedMinutesInWindowAfter = countedMinutesInWindowBefore
    + (decision.allowed && decision.countsTowardLimit ? 1 : 0);
  const limitTiming = calculateDeviceUsageLimitTiming(countedEventTimes, settings, now);
  const responsePayload = buildDeviceUsageResponse({
    endpointPath,
    now,
    minuteBucket,
    packageRule,
    settings,
    decision,
    learningMinutesTodayBefore,
    learningMinutesTodayAfter,
    countedMinutesInWindowBefore,
    countedMinutesInWindowAfter,
    limitTiming,
    rewardSummary,
    loggedLearningMinutesTodayBefore,
    manualStudyMinutes,
    gateState,
  });

  return {
    endpointPath,
    requestPath: getRequestPath(req),
    method: req.method || 'GET',
    ip: req.ip || null,
    ips: Array.isArray(req.ips) ? req.ips : [],
    userAgent: getHeader(req, 'user-agent'),
    referer: getHeader(req, 'referer') || getHeader(req, 'referrer'),
    packageRule,
    query: req.query || {},
    receivedAt: now,
    localDateKey,
    minuteBucket,
    rollingWindowStart,
    learningMinutesTodayBefore,
    learningMinutesTodayAfter,
    countedMinutesInWindowBefore,
    countedMinutesInWindowAfter,
    settings,
    decision,
    responseStatusCode: 200,
    statusText: decision.allowed ? 'OK' : 'NG',
    responsePayload,
  };
}

async function recordAndEvaluateDeviceUsage(req, options = {}) {
  const requestModel = options.requestModel || options.model || DeviceUsageRequest;
  const now = new Date(options.now || Date.now());
  const endpointPath = getEndpointPath(req, options.endpointPath);
  const minuteStart = floorToMinute(now);
  const minuteEnd = new Date(minuteStart.getTime() + MINUTE_MS);
  const existingMinuteRequest = await findExistingMinuteRequest(requestModel, endpointPath, minuteStart, minuteEnd);

  if (existingMinuteRequest) {
    const settings = await getDeviceUsageSettings(options);
    return mapStoredDeviceUsageResult(existingMinuteRequest, true, settings);
  }

  const evaluated = await evaluateDeviceUsageRequest(req, {
    ...options,
    requestModel,
    now,
    endpointPath,
  });
  const requestLog = {
    allowed: evaluated.decision.allowed,
    statusText: evaluated.statusText,
    action: evaluated.decision.action,
    reasonCode: evaluated.decision.reasonCode,
    responseStatusCode: evaluated.responseStatusCode,
    responsePayload: evaluated.responsePayload,
    duplicate: false,
    logged: true,
  };

  try {
    await requestModel.create({
      endpointPath: evaluated.endpointPath,
      requestPath: evaluated.requestPath,
      method: evaluated.method,
      ip: evaluated.ip,
      ips: evaluated.ips,
      userAgent: evaluated.userAgent,
      referer: evaluated.referer,
      packageName: evaluated.packageRule.packageName,
      packageCategory: evaluated.packageRule.category,
      packageKnown: evaluated.packageRule.known,
      packageLabelEn: evaluated.packageRule.labelEn,
      packageLabelJa: evaluated.packageRule.labelJa,
      query: evaluated.query,
      receivedAt: evaluated.receivedAt,
      localDateKey: evaluated.localDateKey,
      minuteBucket: evaluated.minuteBucket,
      learningMinutesTodayBefore: evaluated.learningMinutesTodayBefore,
      learningMinutesTodayAfter: evaluated.learningMinutesTodayAfter,
      learningRequiredMinutes: evaluated.settings.learningRequiredMinutes,
      learningFreeMinutes: evaluated.settings.learningFreeMinutes,
      freeLearningMinute: evaluated.decision.freeLearningMinute,
      rollingWindowStart: evaluated.rollingWindowStart,
      countedMinutesInWindowBefore: evaluated.countedMinutesInWindowBefore,
      countedMinutesInWindowAfter: evaluated.countedMinutesInWindowAfter,
      rollingLimitMinutes: evaluated.settings.rollingLimitMinutes,
      rollingWindowMinutes: evaluated.settings.rollingWindowMinutes,
      maxVolume: evaluated.settings.maxVolume,
      countsTowardLimit: evaluated.decision.allowed && evaluated.decision.countsTowardLimit,
      allowed: evaluated.decision.allowed,
      action: evaluated.decision.action,
      reasonCode: evaluated.decision.reasonCode,
      responseStatusCode: evaluated.responseStatusCode,
      statusText: evaluated.statusText,
      responsePayload: evaluated.responsePayload,
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) {
      throw error;
    }

    const duplicateRequest = await findExistingMinuteRequest(requestModel, endpointPath, minuteStart, minuteEnd);
    if (!duplicateRequest) {
      throw error;
    }

    return mapStoredDeviceUsageResult(duplicateRequest, true, evaluated.settings);
  }

  return requestLog;
}

async function getCurrentDeviceUsageStatus(endpointPath, query = {}, options = {}) {
  const req = {
    baseUrl: endpointPath,
    originalUrl: endpointPath,
    method: 'GET',
    query,
    get: () => null,
  };
  const evaluated = await evaluateDeviceUsageRequest(req, {
    ...options,
    endpointPath,
  });

  return {
    allowed: evaluated.decision.allowed,
    statusText: evaluated.statusText,
    action: evaluated.decision.action,
    reasonCode: evaluated.decision.reasonCode,
    responseStatusCode: evaluated.responseStatusCode,
    responsePayload: evaluated.responsePayload,
  };
}

async function fetchRollingDeviceUsageSeries(endpointPath, settings, options = {}) {
  const requestModel = options.requestModel || options.model || DeviceUsageRequest;
  const now = new Date(options.now || Date.now());
  const lastPointMinute = floorToMinute(now);
  const pointCount = Math.max(1, settings.rollingWindowMinutes);
  const firstPointMinute = new Date(lastPointMinute.getTime() - ((pointCount - 1) * MINUTE_MS));
  const earliestWindowStart = new Date(firstPointMinute.getTime() - settings.rollingWindowMs);
  const rows = await leanExec(requestModel.find({
    endpointPath,
    receivedAt: {
      $gte: earliestWindowStart,
      $lte: now,
    },
    allowed: true,
    countsTowardLimit: true,
  }).sort({ receivedAt: 1 }).select({ receivedAt: 1 }));
  const eventTimes = (Array.isArray(rows) ? rows : [])
    .map((row) => new Date(row.receivedAt).getTime())
    .filter((time) => Number.isFinite(time))
    .sort((a, b) => a - b);
  const points = [];
  let left = 0;
  let right = 0;

  for (let index = 0; index < pointCount; index += 1) {
    const pointMinute = new Date(firstPointMinute.getTime() + (index * MINUTE_MS));
    const isLastPoint = index === pointCount - 1;
    const pointEndMs = isLastPoint
      ? now.getTime()
      : pointMinute.getTime() + MINUTE_MS - 1;
    const windowStartMs = pointEndMs - settings.rollingWindowMs;

    while (right < eventTimes.length && eventTimes[right] <= pointEndMs) {
      right += 1;
    }

    while (left < right && eventTimes[left] < windowStartMs) {
      left += 1;
    }

    points.push({
      timestamp: pointMinute.toISOString(),
      windowStart: new Date(windowStartMs).toISOString(),
      windowEnd: new Date(pointEndMs).toISOString(),
      count: right - left,
    });
  }

  return points;
}

async function fetchDailyDeviceUsageStats(endpointPath, options = {}) {
  const requestModel = options.requestModel || options.model || DeviceUsageRequest;
  const now = new Date(options.now || Date.now());
  const ranges = buildRecentDayRanges(now, options.dayCount || DEVICE_USAGE_DASHBOARD_DAYS);

  return Promise.all(ranges.map(async (range) => {
    const rows = await leanExec(requestModel.aggregate([
      {
        $match: {
          endpointPath,
          receivedAt: {
            $gte: range.start,
            $lt: range.end,
          },
        },
      },
      {
        $group: {
          _id: '$packageCategory',
          totalMinutes: { $sum: 1 },
          allowedMinutes: {
            $sum: {
              $cond: ['$allowed', 1, 0],
            },
          },
          countedMinutes: {
            $sum: {
              $cond: [
                { $and: ['$allowed', '$countsTowardLimit'] },
                1,
                0,
              ],
            },
          },
          freeLearningMinutes: {
            $sum: {
              $cond: ['$freeLearningMinute', 1, 0],
            },
          },
          blockedMinutes: {
            $sum: {
              $cond: ['$allowed', 0, 1],
            },
          },
        },
      },
      { $sort: { totalMinutes: -1, _id: 1 } },
    ]));

    const categories = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        category: normalizeDeviceUsageCategory(row?._id),
        totalMinutes: Number(row?.totalMinutes) || 0,
        allowedMinutes: Number(row?.allowedMinutes) || 0,
        countedMinutes: Number(row?.countedMinutes) || 0,
        freeLearningMinutes: Number(row?.freeLearningMinutes) || 0,
        blockedMinutes: Number(row?.blockedMinutes) || 0,
      }))
      .filter((row) => row.totalMinutes > 0);
    const totalMinutes = categories.reduce((sum, row) => sum + row.totalMinutes, 0);
    const countedMinutes = categories.reduce((sum, row) => sum + row.countedMinutes, 0);
    const blockedMinutes = categories.reduce((sum, row) => sum + row.blockedMinutes, 0);
    const learningMinutes = categories
      .filter((row) => row.category === CATEGORY_LEARNING)
      .reduce((sum, row) => sum + row.allowedMinutes, 0);

    return {
      dateKey: range.dateKey,
      start: range.start,
      end: range.end,
      isToday: range.isToday,
      totalMinutes,
      countedMinutes,
      blockedMinutes,
      learningMinutes,
      categories,
    };
  }));
}

async function fetchTodayPackageStats(endpointPath, localDateKey, options = {}) {
  const requestModel = options.requestModel || options.model || DeviceUsageRequest;
  const rows = await leanExec(requestModel.aggregate([
    {
      $match: {
        endpointPath,
        localDateKey,
      },
    },
    {
      $group: {
        _id: {
          packageName: '$packageName',
          category: '$packageCategory',
        },
        totalMinutes: { $sum: 1 },
        allowedMinutes: {
          $sum: {
            $cond: ['$allowed', 1, 0],
          },
        },
        countedMinutes: {
          $sum: {
            $cond: [
              { $and: ['$allowed', '$countsTowardLimit'] },
              1,
              0,
            ],
          },
        },
        blockedMinutes: {
          $sum: {
            $cond: ['$allowed', 0, 1],
          },
        },
        lastSeenAt: { $max: '$receivedAt' },
      },
    },
    {
      $sort: {
        totalMinutes: -1,
        '_id.packageName': 1,
      },
    },
    { $limit: 12 },
  ]));

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    packageName: normalizeDevicePackageName(row?._id?.packageName),
    category: normalizeDeviceUsageCategory(row?._id?.category),
    totalMinutes: Number(row?.totalMinutes) || 0,
    allowedMinutes: Number(row?.allowedMinutes) || 0,
    countedMinutes: Number(row?.countedMinutes) || 0,
    blockedMinutes: Number(row?.blockedMinutes) || 0,
    lastSeenAt: row?.lastSeenAt || null,
  }));
}

async function listPackageRules(options = {}) {
  const packageRuleModel = options.packageRuleModel || DeviceUsagePackageRule;
  const rows = await leanExec(packageRuleModel.find({})
    .sort({ active: -1, packageName: 1 }));

  return (Array.isArray(rows) ? rows : []).map((row) => mapPackageRule(row));
}

async function listRewardSuggestions(options = {}) {
  const suggestionModel = options.rewardSuggestionModel || DeviceUsageRewardSuggestion;
  const rows = await leanExec(suggestionModel.find({})
    .sort({ active: -1, titleEn: 1, createdAt: -1 }));

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row._id ? String(row._id) : '',
    titleEn: normalizeText(row.titleEn, REWARD_TITLE_MAX_LENGTH),
    titleJa: normalizeText(row.titleJa, REWARD_TITLE_MAX_LENGTH),
    defaultPoints: Number(row.defaultPoints) || 0,
    notes: normalizeMultilineText(row.notes, NOTE_MAX_LENGTH),
    active: row.active !== false,
    usageCount: Number(row.usageCount) || 0,
    lastUsedAt: row.lastUsedAt || null,
  }));
}

async function listRecentRewards(options = {}) {
  const rewardModel = options.rewardModel || DeviceUsageReward;
  const rows = await leanExec(rewardModel.find({})
    .sort({ awardedAt: -1, createdAt: -1 })
    .limit(options.limit || 12));

  return (Array.isArray(rows) ? rows : []).map((row) => ({
    id: row._id ? String(row._id) : '',
    awardedAt: row.awardedAt || row.createdAt || null,
    localDateKey: row.localDateKey || '',
    points: Number(row.points) || 0,
    titleEn: normalizeText(row.titleEn, REWARD_TITLE_MAX_LENGTH),
    titleJa: normalizeText(row.titleJa, REWARD_TITLE_MAX_LENGTH),
    comment: normalizeMultilineText(row.comment, COMMENT_MAX_LENGTH),
    source: row.source || 'manual',
    awardedBy: row.awardedBy || null,
  }));
}

async function getDeviceUsageDashboard(options = {}) {
  const requestModel = options.requestModel || options.model || DeviceUsageRequest;
  const endpointPath = options.endpointPath || ensureDeviceUsagePath();
  const now = new Date(options.now || Date.now());
  const localDateKey = formatLocalDateKey(now);
  const settings = await getDeviceUsageSettings(options);
  const currentWindowStart = new Date(now.getTime() - settings.rollingWindowMs);

  const [
    countedEventTimes,
    totalStored,
    blockedToday,
    recentRequests,
    chartSeries,
    dailyStats,
    todayPackageStats,
    packageRules,
    rewardSuggestions,
    recentRewards,
    rewardSummary,
    gateState,
  ] = await Promise.all([
    fetchCurrentCountedEventTimes(endpointPath, settings, { ...options, requestModel, now }),
    requestModel.countDocuments({ endpointPath }),
    requestModel.countDocuments({
      endpointPath,
      localDateKey,
      allowed: false,
    }),
    leanExec(requestModel.find({ endpointPath })
      .sort({ receivedAt: -1 })
      .limit(30)),
    fetchRollingDeviceUsageSeries(endpointPath, settings, { ...options, requestModel, now }),
    fetchDailyDeviceUsageStats(endpointPath, { ...options, requestModel, now }),
    fetchTodayPackageStats(endpointPath, localDateKey, { ...options, requestModel }),
    listPackageRules(options),
    listRewardSuggestions(options),
    listRecentRewards(options),
    fetchRewardSummaryForDate(localDateKey, options),
    fetchGateStateForDate(localDateKey, options),
  ]);
  const todayStats = dailyStats.find((row) => row.dateKey === localDateKey) || {
    learningMinutes: 0,
    countedMinutes: 0,
    blockedMinutes: 0,
    totalMinutes: 0,
    categories: [],
  };
  const currentCountedMinutes = countedEventTimes.length;
  const loggedLearningMinutes = todayStats.learningMinutes;
  const manualStudyMinutes = gateState.manualStudyMinutes;
  const currentLearningMinutes = loggedLearningMinutes + manualStudyMinutes;
  const limitTiming = calculateDeviceUsageLimitTiming(countedEventTimes, settings, now);
  const learningRequirementMet = currentLearningMinutes >= settings.learningRequiredMinutes;
  const homeworkGateMet = !settings.homeworkGateEnabled || gateState.homeworkCleared;
  const entertainmentUnlocked = learningRequirementMet && homeworkGateMet;
  const rollingAvailable = currentCountedMinutes < settings.rollingLimitMinutes;
  const nextEntertainmentAction = !entertainmentUnlocked
    ? (learningRequirementMet ? 'finish_homework' : 'learn_first')
    : (rollingAvailable ? 'allow' : 'wait');
  const nextEntertainmentStatus = nextEntertainmentAction === 'allow' ? 'OK' : 'NG';

  return {
    endpointPath,
    generatedAt: now,
    localDateKey,
    settings,
    gateState: {
      ...gateState,
      loggedLearningMinutes,
      manualStudyMinutes,
      totalStudyMinutes: currentLearningMinutes,
      learningRequirementMet,
      homeworkGateEnabled: settings.homeworkGateEnabled,
      homeworkGateMet,
      entertainmentUnlocked,
    },
    currentWindowStart,
    currentCountedMinutes,
    currentLearningMinutes,
    learningRemainingMinutes: Math.max(0, settings.learningRequiredMinutes - currentLearningMinutes),
    rollingRemainingMinutes: Math.max(0, settings.rollingLimitMinutes - currentCountedMinutes),
    totalStored,
    blockedToday,
    limitTiming,
    entertainmentUnlocked,
    nextEntertainmentAction,
    nextEntertainmentStatus,
    todayStats,
    todayPackageStats,
    chartSeries,
    dailyStats,
    packageRules,
    rewardSuggestions,
    recentRewards,
    rewardSummary,
    recentRequests: Array.isArray(recentRequests) ? recentRequests : [],
  };
}

async function saveRewardSuggestion(input = {}, options = {}) {
  const suggestionModel = options.rewardSuggestionModel || DeviceUsageRewardSuggestion;
  const titleEn = normalizeText(input.titleEn, REWARD_TITLE_MAX_LENGTH);
  if (!titleEn) {
    throw new DeviceUsageSettingsError('Reward suggestion title is required.');
  }

  const titleJa = normalizeText(input.titleJa, REWARD_TITLE_MAX_LENGTH);
  const defaultPoints = parseOptionalBoundedInteger(
    input.defaultPoints,
    'Default points',
    0,
    DEVICE_USAGE_MAX_LIMIT_MINUTES,
    1
  );
  const notes = normalizeMultilineText(input.notes, NOTE_MAX_LENGTH);
  const active = input.active === undefined
    ? true
    : ['true', 'on', '1', 'yes'].includes(String(input.active).toLowerCase()) || input.active === true;
  const updatedBy = typeof options.updatedBy === 'string' && options.updatedBy.trim()
    ? options.updatedBy.trim()
    : null;
  const id = normalizeText(input.id, 80);
  const query = id ? { _id: id } : { titleEn };
  const update = {
    $set: {
      titleEn,
      titleJa,
      defaultPoints,
      notes,
      active,
      updatedBy,
    },
    $setOnInsert: {
      createdBy: updatedBy,
    },
  };
  const updated = await leanExec(suggestionModel.findOneAndUpdate(
    query,
    update,
    {
      new: true,
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  ));

  return updated;
}

async function deleteRewardSuggestion(input = {}, options = {}) {
  const suggestionModel = options.rewardSuggestionModel || DeviceUsageRewardSuggestion;
  const id = normalizeText(input.id || input.suggestionId, 80);
  if (!id) {
    throw new DeviceUsageSettingsError('Reward suggestion is required.');
  }

  return leanExec(suggestionModel.findOneAndUpdate(
    { _id: id },
    {
      $set: {
        active: false,
        updatedBy: options.updatedBy || null,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  ));
}

async function findRewardSuggestionById(id, options = {}) {
  const suggestionModel = options.rewardSuggestionModel || DeviceUsageRewardSuggestion;
  if (!id) {
    return null;
  }

  return leanExec(suggestionModel.findOne({ _id: id, active: true }));
}

async function addDeviceUsageReward(input = {}, options = {}) {
  const rewardModel = options.rewardModel || DeviceUsageReward;
  const suggestionModel = options.rewardSuggestionModel || DeviceUsageRewardSuggestion;
  const now = new Date(options.now || Date.now());
  const suggestionId = normalizeText(input.suggestionId, 80);
  const suggestion = await findRewardSuggestionById(suggestionId, { ...options, rewardSuggestionModel: suggestionModel });
  const titleEn = normalizeText(input.titleEn || suggestion?.titleEn, REWARD_TITLE_MAX_LENGTH);
  if (!titleEn) {
    throw new DeviceUsageSettingsError('Reward title is required.');
  }

  const titleJa = normalizeText(input.titleJa || suggestion?.titleJa, REWARD_TITLE_MAX_LENGTH);
  const points = parseOptionalBoundedInteger(
    input.points,
    'Reward points',
    0,
    DEVICE_USAGE_MAX_LIMIT_MINUTES,
    Number(suggestion?.defaultPoints) || 1
  );
  const comment = normalizeMultilineText(input.comment, COMMENT_MAX_LENGTH);
  const awardedBy = typeof options.updatedBy === 'string' && options.updatedBy.trim()
    ? options.updatedBy.trim()
    : null;
  const created = await rewardModel.create({
    awardedAt: now,
    localDateKey: formatLocalDateKey(now),
    points,
    titleEn,
    titleJa,
    comment,
    suggestionId: suggestion?._id || null,
    source: 'manual',
    awardedBy,
    metadata: {},
  });

  if (suggestion && typeof suggestionModel.findOneAndUpdate === 'function') {
    await leanExec(suggestionModel.findOneAndUpdate(
      { _id: suggestion._id },
      {
        $inc: { usageCount: 1 },
        $set: { lastUsedAt: now, updatedBy: awardedBy },
      },
      { new: true }
    ));
  }

  return created;
}

module.exports = {
  CATEGORY_ENTERTAINMENT,
  CATEGORY_LEARNING,
  CATEGORY_MANAGEMENT,
  COMMENT_MAX_LENGTH,
  DEVICE_USAGE_CATEGORIES,
  DEVICE_USAGE_CATEGORY_LABELS,
  DEVICE_USAGE_DASHBOARD_DAYS,
  DEVICE_USAGE_DEFAULT_LEARNING_FREE_MINUTES,
  DEVICE_USAGE_DEFAULT_LEARNING_REQUIRED_MINUTES,
  DEVICE_USAGE_DEFAULT_HOMEWORK_GATE_ENABLED,
  DEVICE_USAGE_DEFAULT_LIMIT_MINUTES,
  DEVICE_USAGE_DEFAULT_MAX_VOLUME,
  DEVICE_USAGE_DEFAULT_WINDOW_MINUTES,
  DEVICE_USAGE_SETTINGS_KEY,
  DEVICE_USAGE_TEXT,
  DeviceUsageSettingsError,
  PACKAGE_LABEL_MAX_LENGTH,
  REWARD_TITLE_MAX_LENGTH,
  UNKNOWN_PACKAGE_NAME,
  addDeviceUsageReward,
  addManualStudyMinutes,
  buildRecentDayRanges,
  calculateDeviceUsageLimitTiming,
  fetchCurrentCountedEventTimes,
  fetchDailyDeviceUsageStats,
  fetchGateStateForDate,
  fetchRollingDeviceUsageSeries,
  formatLocalDateKey,
  getCurrentDeviceUsageStatus,
  getDeviceUsageDashboard,
  getDeviceUsageSettings,
  getDeviceUsageText,
  normalizeDevicePackageName,
  normalizeDeviceUsageCategory,
  recordAndEvaluateDeviceUsage,
  saveDeviceUsagePackageRule,
  saveRewardSuggestion,
  deleteDeviceUsagePackageRule,
  deleteRewardSuggestion,
  updateHomeworkGateForToday,
  updateDeviceUsageSettings,
};
