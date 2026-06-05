const logger = require('../utils/logger');
const {
  RequestCounterSettingsError,
  getRequestCounterDashboard,
  normalizeRequestCategory,
  updateRequestCounterSettings,
} = require('../services/incomingRequestCounterService');
const {
  buildOverviewCards,
  formatDateTime,
  formatNumber,
  formatWindow,
  mapDailyMinuteStats,
} = require('../utils/requestCounterDashboardView');

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
