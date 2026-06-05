const logger = require('../utils/logger');
const {
  RequestCounterSettingsError,
  UNKNOWN_REQUEST_CATEGORY,
  getRequestCounterDashboard,
  normalizeRequestCategory,
  updateRequestCounterSettings,
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

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('en-US') : '0';
}

function formatDateTime(value) {
  if (!value) {
    return 'N/A';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return date.toLocaleString();
}

function formatWindow(minutes) {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) {
    return 'N/A';
  }

  if (value % 1440 === 0) {
    const days = value / 1440;
    return `${days} day${days === 1 ? '' : 's'}`;
  }

  if (value % 60 === 0) {
    const hours = value / 60;
    return `${hours} hour${hours === 1 ? '' : 's'}`;
  }

  return `${value} min`;
}

function formatMinuteDuration(minutes) {
  const value = Number(minutes);
  const totalMinutes = Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  const hours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  const parts = [];

  if (hours > 0) {
    parts.push(`${formatNumber(hours)} hour${hours === 1 ? '' : 's'}`);
  }

  if (remainingMinutes > 0 || parts.length === 0) {
    parts.push(`${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`);
  }

  return parts.join(' ');
}

function parseFeedback(query = {}) {
  const status = typeof query.status === 'string' ? query.status : '';
  const message = typeof query.message === 'string' ? query.message : '';
  if (!status || !message) {
    return null;
  }

  return {
    status: status === 'success' ? 'success' : 'error',
    message,
  };
}

function redirectWithFeedback(res, status, message) {
  return res.redirect(
    `/admin/request-counter?status=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}`
  );
}

function mapRecentRequest(entry) {
  const category = normalizeRequestCategory(entry.category);

  return {
    receivedAtDisplay: formatDateTime(entry.receivedAt),
    responseText: entry.responseText || (entry.allowed ? 'OK' : 'NG'),
    responseStatusCode: entry.responseStatusCode || (entry.allowed ? 200 : 429),
    windowMinutesDisplay: formatNumber(entry.countInWindow || 0),
    categoryDisplay: category,
    ip: entry.ip || 'N/A',
    userAgent: entry.userAgent || 'N/A',
    requestPath: entry.requestPath || 'N/A',
  };
}

function formatCurrentMinutesHelper(dashboard) {
  const timing = dashboard.limitTiming || null;

  if (!timing) {
    return `${formatNumber(dashboard.remaining)} min remaining`;
  }

  if (timing.mode === 'infinite') {
    return '∞ until max';
  }

  if (timing.mode === 'until_below_max') {
    return `${formatNumber(timing.minutes)} min until below max`;
  }

  return `${formatNumber(timing.minutes)} min until max`;
}

function buildOverviewCards(dashboard) {
  const settings = dashboard.settings;
  return [
    {
      label: 'Current Minutes',
      value: `${formatNumber(dashboard.currentCount)} / ${formatNumber(settings.maxRequests)} min`,
      helper: formatCurrentMinutesHelper(dashboard),
      tone: dashboard.currentCount >= settings.maxRequests ? 'danger' : 'ok',
    },
    {
      label: 'Next Response',
      value: dashboard.nextDecision,
      helper: dashboard.nextDecision === 'OK' ? 'HTTP 200' : 'HTTP 429',
      tone: dashboard.nextDecision === 'OK' ? 'ok' : 'danger',
    },
    {
      label: 'Window',
      value: formatWindow(settings.windowMinutes),
      helper: `Since ${formatDateTime(dashboard.currentWindowStart)}`,
    },
    {
      label: 'NG Minutes',
      value: formatNumber(dashboard.blockedInWindow),
      helper: 'Current window',
    },
    {
      label: 'Stored Minutes',
      value: formatNumber(dashboard.totalStored),
      helper: '7-day retention',
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

function mapDailyMinuteStats(rows = []) {
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
          minutes,
          durationDisplay: formatMinuteDuration(minutes),
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
      totalDurationDisplay: formatMinuteDuration(totalMinutes),
      totalPercent: Math.round((totalMinutes / maxTotal) * 100),
      categories,
    };
  });
}

exports.dashboard = async (req, res) => {
  try {
    const dashboard = await getRequestCounterDashboard();
    const chartPayload = {
      points: dashboard.chartSeries,
      limit: dashboard.settings.maxRequests,
      windowMinutes: dashboard.settings.windowMinutes,
    };
    const dailyMinuteStats = mapDailyMinuteStats(dashboard.dailyMinuteStats);

    return res.render('admin_request_counter', {
      feedback: parseFeedback(req.query),
      loadError: null,
      generatedAtDisplay: formatDateTime(dashboard.generatedAt),
      endpointPath: dashboard.endpointPath,
      settings: {
        ...dashboard.settings,
        windowDisplay: formatWindow(dashboard.settings.windowMinutes),
        updatedAtDisplay: formatDateTime(dashboard.settings.updatedAt),
        updatedByDisplay: dashboard.settings.updatedBy || 'N/A',
      },
      overviewCards: buildOverviewCards(dashboard),
      dailyMinuteStats,
      recentRequests: dashboard.recentRequests.map(mapRecentRequest),
      chartJson: JSON.stringify(chartPayload),
    });
  } catch (error) {
    logger.error('Failed to load request counter admin dashboard', {
      category: 'incoming-request-counter',
      metadata: { error: error.message },
    });

    return res.status(500).render('admin_request_counter', {
      feedback: null,
      loadError: 'Unable to load request counter data right now.',
      generatedAtDisplay: formatDateTime(new Date()),
      endpointPath: 'N/A',
      settings: {
        maxRequests: 60,
        windowMinutes: 90,
        windowDisplay: formatWindow(90),
        updatedAtDisplay: 'N/A',
        updatedByDisplay: 'N/A',
      },
      overviewCards: [],
      dailyMinuteStats: [],
      recentRequests: [],
      chartJson: JSON.stringify({ points: [], limit: 60, windowMinutes: 90 }),
    });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await updateRequestCounterSettings(req.body || {}, {
      updatedBy: req.user?.name || null,
    });

    logger.notice('Request counter settings updated by admin', {
      category: 'incoming-request-counter',
      metadata: {
        maxRequests: settings.maxRequests,
        windowMinutes: settings.windowMinutes,
        user: req.user?.name || 'unknown',
      },
    });

    return redirectWithFeedback(res, 'success', 'Request counter settings saved.');
  } catch (error) {
    if (error instanceof RequestCounterSettingsError) {
      return redirectWithFeedback(res, 'error', error.message);
    }

    logger.error('Failed to update request counter settings', {
      category: 'incoming-request-counter',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to save request counter settings.');
  }
};
