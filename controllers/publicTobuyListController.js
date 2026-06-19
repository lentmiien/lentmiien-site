const {
  Task,
  CookingCalendarModel,
  CookingCalendarV2Model,
  Chat4KnowledgeModel,
  CookbookRecipeModel,
} = require('../database');
const logger = require('../utils/logger');
const {
  COMMENT_MAX_LENGTH,
  DeviceUsageSettingsError,
  REWARD_TITLE_MAX_LENGTH,
  addDeviceUsageReward,
  getDeviceUsageDashboard,
} = require('../services/deviceUsageService');
const CookingCalendarService = require('../services/cookingCalendarService');
const {
  buildOverviewCards,
  formatDateTime,
  formatNumber,
  mapDailyStats,
} = require('../utils/deviceUsageDashboardView');
const {
  PUBLIC_TOBUY_LIST_OWNER,
  consumePublicTobuyAddQuota,
} = require('../utils/publicTobuyList');

const MAX_TITLE_LENGTH = 200;
const PAGE_TITLE = '妻のページ';
const WEEKDAY_LABELS_JA = {
  Sunday: '日曜日',
  Monday: '月曜日',
  Tuesday: '火曜日',
  Wednesday: '水曜日',
  Thursday: '木曜日',
  Friday: '金曜日',
  Saturday: '土曜日',
};

const cookingCalendarService = new CookingCalendarService({
  CookingCalendarModel,
  CookingCalendarV2Model,
  Chat4KnowledgeModel,
  CookbookRecipeModel,
});

function normalizeTitle(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function getSubmitPath(req) {
  return req.baseUrl || req.path || '/';
}

function joinPublicPath(req, suffix) {
  const basePath = getSubmitPath(req).replace(/\/+$/, '') || '/';
  const normalizedSuffix = String(suffix || '').replace(/^\/+/, '');

  return basePath === '/'
    ? `/${normalizedSuffix}`
    : `${basePath}/${normalizedSuffix}`;
}

function findOverviewCard(cards, key) {
  return (Array.isArray(cards) ? cards : []).find((card) => card.key === key) || null;
}

function buildPublicDeviceUsageCard(card, fallback = {}) {
  if (!card && !fallback.value) {
    return null;
  }

  return {
    key: fallback.key || card?.key || '',
    label: fallback.label || card?.label || '',
    value: fallback.value || card?.helper || card?.value || '',
    helper: fallback.helper || card?.value || '',
    tone: fallback.tone || card?.tone || '',
  };
}

function mapPublicRewardSuggestions(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((suggestion) => suggestion && suggestion.active !== false)
    .map((suggestion) => {
      const titleEn = String(suggestion.titleEn || '').trim();
      const titleJa = String(suggestion.titleJa || '').trim();
      const defaultPoints = Number(suggestion.defaultPoints) || 0;

      return {
        id: suggestion.id || '',
        titleEn,
        titleJa,
        displayTitle: titleJa || titleEn || 'ご褒美',
        defaultPoints,
        pointsDisplay: `${formatNumber(defaultPoints, 'ja')}点`,
      };
    })
    .filter((suggestion) => suggestion.id && suggestion.titleEn);
}

function buildDefaultRewardForm() {
  return {
    suggestionId: '',
    titleEn: '',
    points: '1',
    comment: '',
  };
}

function mapRewardForm(input = {}) {
  return {
    suggestionId: String(input.suggestionId || '').trim(),
    titleEn: String(input.titleEn || '').trim().slice(0, REWARD_TITLE_MAX_LENGTH),
    points: String(input.points || '1').trim() || '1',
    comment: String(input.comment || '').trim().slice(0, COMMENT_MAX_LENGTH),
  };
}

async function fetchOpenTasks() {
  const tasks = await Task.find({
    userId: PUBLIC_TOBUY_LIST_OWNER,
    type: 'tobuy',
    done: false,
  }).sort({ createdAt: 1, _id: 1 }).lean();

  return (tasks || []).map((task) => ({
    id: task._id ? task._id.toString() : '',
    title: task.title || 'Untitled item',
  }));
}

async function fetchPublicDeviceUsageStats() {
  try {
    const dashboard = await getDeviceUsageDashboard();
    const overviewCards = buildOverviewCards(dashboard, { locale: 'ja' });
    const rollingUsageCard = findOverviewCard(overviewCards, 'rollingUsage');
    const learningGateCard = findOverviewCard(overviewCards, 'learningGate');
    const rewardPoints = Number(dashboard.rewardSummary?.points) || 0;
    const rewardCount = Number(dashboard.rewardSummary?.count) || 0;

    return {
      loadError: null,
      generatedAtDisplay: formatDateTime(dashboard.generatedAt, 'ja'),
      rollingUsageCard: buildPublicDeviceUsageCard(rollingUsageCard, {
        key: 'rollingUsage',
        label: 'ローリング利用',
        value: rollingUsageCard?.helper || `残り ${formatNumber(dashboard.rollingRemainingMinutes, 'ja')}分`,
        helper: rollingUsageCard?.value || '',
      }),
      learningGateCard: buildPublicDeviceUsageCard(learningGateCard, {
        key: 'learningGate',
        label: '学習条件',
        value: learningGateCard?.helper || (
          dashboard.entertainmentUnlocked
            ? '娯楽を利用できます'
            : `学習が残り ${formatNumber(dashboard.learningRemainingMinutes, 'ja')}分`
        ),
        helper: learningGateCard?.value || '',
      }),
      rewardSummary: {
        points: rewardPoints,
        count: rewardCount,
        pointsDisplay: `${formatNumber(rewardPoints, 'ja')}点`,
        countDisplay: `${formatNumber(rewardCount, 'ja')}件`,
      },
      dailyStats: mapDailyStats(dashboard.dailyStats, { locale: 'ja' }),
      rewardSuggestions: mapPublicRewardSuggestions(dashboard.rewardSuggestions),
    };
  } catch (error) {
    logger.error('Failed to load public device usage stats', {
      category: 'public-tobuy',
      metadata: { error: error.message },
    });

    return {
      loadError: '端末利用を読み込めませんでした。',
      generatedAtDisplay: null,
      rollingUsageCard: null,
      learningGateCard: null,
      rewardSummary: {
        points: 0,
        count: 0,
        pointsDisplay: '0点',
        countDisplay: '0件',
      },
      dailyStats: [],
      rewardSuggestions: [],
    };
  }
}

function mapTodayCookingEntry(entry) {
  const source = entry || {};
  const recipe = source.recipe || null;
  const image = recipe && recipe.image ? String(recipe.image) : '';

  return {
    entryId: source.entryId || '',
    category: source.category || 'Other',
    title: recipe && recipe.title ? recipe.title : '不明なレシピ',
    imageSrc: image ? `/img/${encodeURIComponent(image)}` : null,
  };
}

async function fetchTodayCookingCalendar() {
  const today = cookingCalendarService.formatDate(new Date());

  try {
    const calendar = await cookingCalendarService.getCalendarRange(today, today);
    const day = Array.isArray(calendar.days) && calendar.days.length ? calendar.days[0] : null;
    const entries = day && Array.isArray(day.entries)
      ? day.entries.map(mapTodayCookingEntry)
      : [];
    const weekday = day && day.weekday ? day.weekday : '';

    return {
      loadError: null,
      date: today,
      weekdayDisplay: WEEKDAY_LABELS_JA[weekday] || weekday,
      entries,
    };
  } catch (error) {
    logger.error('Failed to load wife view cooking calendar', {
      category: 'public-tobuy',
      metadata: { error: error.message },
    });

    return {
      loadError: '今日の料理を読み込めませんでした。',
      date: today,
      weekdayDisplay: '',
      entries: [],
    };
  }
}

async function renderPage(req, res, options = {}) {
  const [tasks, deviceUsageStats, todayCooking] = await Promise.all([
    options.tasks ? Promise.resolve(options.tasks) : fetchOpenTasks(),
    fetchPublicDeviceUsageStats(),
    fetchTodayCookingCalendar(),
  ]);
  const errorMessage = options.errorMessage || null;
  const successMessage = options.successMessage
    || (req.query && req.query.reward === '1' ? 'ご褒美を追加しました。' : null)
    || (req.query && req.query.added === '1' ? '追加しました。' : null);
  const statusCode = options.statusCode || 200;

  res.locals.pageLang = 'ja';
  res.locals.pageTitle = `${PAGE_TITLE} - Lennart's Website`;
  res.locals.og_title = `Lennart's Website - ${PAGE_TITLE}`;
  res.locals.twitter_title = `Lennart's Website - ${PAGE_TITLE}`;

  return res.status(statusCode).render('public_tobuy_list', {
    pageHeading: PAGE_TITLE,
    taskCount: tasks.length,
    tasks,
    errorMessage,
    successMessage,
    formTitle: options.formTitle || '',
    submitPath: getSubmitPath(req),
    rewardSubmitPath: joinPublicPath(req, 'rewards'),
    rewardForm: options.rewardForm || buildDefaultRewardForm(),
    deviceUsageStats,
    todayCooking,
  });
}

exports.renderPublicPage = async (req, res) => {
  try {
    return await renderPage(req, res);
  } catch (error) {
    logger.error('Failed to load public to-buy list', {
      category: 'public-tobuy',
      metadata: { error: error.message },
    });
    return res.status(500).send('ページを読み込めません。');
  }
};

exports.addPublicTask = async (req, res) => {
  const title = normalizeTitle(req.body && req.body.title);

  try {
    if (!title) {
      return await renderPage(req, res, {
        statusCode: 400,
        errorMessage: '追加するものを入力してください。',
      });
    }

    if (title.length > MAX_TITLE_LENGTH) {
      return await renderPage(req, res, {
        statusCode: 400,
        errorMessage: `${MAX_TITLE_LENGTH}文字以内で入力してください。`,
        formTitle: title,
      });
    }

    const quota = consumePublicTobuyAddQuota();
    if (!quota.allowed) {
      const errorMessage = quota.reason === 'too_fast'
        ? 'もう一度追加する前に1秒待ってください。'
        : '今日の共有追加上限に達しました。';

      return await renderPage(req, res, {
        statusCode: 429,
        errorMessage,
        formTitle: title,
      });
    }

    const doc = new Task({
      userId: PUBLIC_TOBUY_LIST_OWNER,
      type: 'tobuy',
      title,
      description: '',
      start: null,
      end: null,
      done: false,
    });

    await doc.save();
    return res.redirect(`${getSubmitPath(req)}?added=1`);
  } catch (error) {
    logger.error('Failed to add item to public to-buy list', {
      category: 'public-tobuy',
      metadata: { error: error.message },
    });

    try {
      return await renderPage(req, res, {
        statusCode: 500,
        errorMessage: 'いまは追加できません。',
        formTitle: title,
      });
    } catch (_) {
      return res.status(500).send('追加できません。');
    }
  }
};

function getRewardErrorMessage(error) {
  if (error instanceof DeviceUsageSettingsError) {
    if (/title/i.test(error.message)) {
      return 'ご褒美の内容を入力してください。';
    }

    if (/points/i.test(error.message)) {
      return 'ポイントは0から100000までの整数で入力してください。';
    }
  }

  return 'ご褒美を追加できません。';
}

exports.addPublicDeviceUsageReward = async (req, res) => {
  const rewardForm = mapRewardForm(req.body || {});

  try {
    await addDeviceUsageReward(req.body || {}, {
      updatedBy: 'public-tobuy',
    });

    return res.redirect(`${getSubmitPath(req)}?reward=1`);
  } catch (error) {
    const isSettingsError = error instanceof DeviceUsageSettingsError;
    if (!isSettingsError) {
      logger.error('Failed to add public device usage reward', {
        category: 'public-tobuy',
        metadata: { error: error.message },
      });
    }

    try {
      return await renderPage(req, res, {
        statusCode: isSettingsError ? error.status || 400 : 500,
        errorMessage: getRewardErrorMessage(error),
        rewardForm,
      });
    } catch (_) {
      return res.status(500).send('ご褒美を追加できません。');
    }
  }
};
