const logger = require('../utils/logger');
const {
  RequestCounterSettingsError,
  getRequestCounterDashboard,
  updateRequestCounterSettings,
} = require('../services/incomingRequestCounterService');

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
  return {
    receivedAtDisplay: formatDateTime(entry.receivedAt),
    responseText: entry.responseText || (entry.allowed ? 'OK' : 'NG'),
    responseStatusCode: entry.responseStatusCode || (entry.allowed ? 200 : 429),
    windowMinutesDisplay: formatNumber(entry.countInWindow || 0),
    ip: entry.ip || 'N/A',
    userAgent: entry.userAgent || 'N/A',
    requestPath: entry.requestPath || 'N/A',
  };
}

function buildOverviewCards(dashboard) {
  const settings = dashboard.settings;
  return [
    {
      label: 'Current Minutes',
      value: `${formatNumber(dashboard.currentCount)} / ${formatNumber(settings.maxRequests)} min`,
      helper: `${formatNumber(dashboard.remaining)} min remaining`,
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

function mapDailyMinuteStats(rows = []) {
  const maxTotal = Math.max(1, ...rows.map((row) => row.totalMinutes || 0));
  return rows.map((row) => {
    const totalMinutes = row.totalMinutes || 0;
    const okMinutes = row.okMinutes || 0;
    const ngMinutes = row.ngMinutes || 0;

    return {
      dateKey: row.dateKey,
      totalDurationDisplay: formatMinuteDuration(totalMinutes),
      okDurationDisplay: formatMinuteDuration(okMinutes),
      ngDurationDisplay: formatMinuteDuration(ngMinutes),
      totalPercent: Math.round((totalMinutes / maxTotal) * 100),
      okPercent: totalMinutes > 0 ? Math.round((okMinutes / totalMinutes) * 100) : 0,
      ngPercent: totalMinutes > 0 ? Math.round((ngMinutes / totalMinutes) * 100) : 0,
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
