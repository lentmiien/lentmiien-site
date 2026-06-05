const {
  Task,
  CookingCalendarModel,
  CookingCalendarV2Model,
  Chat4KnowledgeModel,
  CookbookRecipeModel,
} = require('../database');
const logger = require('../utils/logger');
const { getRequestCounterDashboard } = require('../services/incomingRequestCounterService');
const CookingCalendarService = require('../services/cookingCalendarService');
const {
  buildOverviewCards,
  formatDateTime,
  mapDailyMinuteStats,
} = require('../utils/requestCounterDashboardView');
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

async function fetchWifeRequestCounterStats() {
  try {
    const dashboard = await getRequestCounterDashboard();
    const overviewCards = buildOverviewCards(dashboard, { locale: 'ja' });

    return {
      loadError: null,
      generatedAtDisplay: formatDateTime(dashboard.generatedAt, 'ja'),
      currentMinutesCard: overviewCards.find((card) => card.key === 'currentMinutes') || null,
      dailyMinuteStats: mapDailyMinuteStats(dashboard.dailyMinuteStats, { locale: 'ja' }),
    };
  } catch (error) {
    logger.error('Failed to load wife view request counter stats', {
      category: 'public-tobuy',
      metadata: { error: error.message },
    });

    return {
      loadError: '分カウンターを読み込めませんでした。',
      generatedAtDisplay: null,
      currentMinutesCard: null,
      dailyMinuteStats: [],
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
  const [tasks, requestCounterStats, todayCooking] = await Promise.all([
    options.tasks ? Promise.resolve(options.tasks) : fetchOpenTasks(),
    fetchWifeRequestCounterStats(),
    fetchTodayCookingCalendar(),
  ]);
  const errorMessage = options.errorMessage || null;
  const successMessage = options.successMessage || (req.query && req.query.added === '1'
    ? '追加しました。'
    : null);
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
    requestCounterStats,
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
