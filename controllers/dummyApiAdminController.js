const logger = require('../utils/logger');
const {
  DUMMY_API_ENDPOINT_PATHS,
  DUMMY_API_LOG_COLLECTION_NAME,
  DUMMY_API_LOG_LIMIT,
  clearDummyApiRequestLogs,
  countDummyApiRequestLogs,
  getDummyApiEndpointSettings,
  listDummyApiRequestLogs,
  updateDummyApiEndpointSettings,
} = require('../services/dummyApiLogService');

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

function formatPayload(payload) {
  if (payload === null || payload === undefined) {
    return 'null';
  }

  try {
    return JSON.stringify(payload, null, 2);
  } catch (error) {
    return `Unable to serialize payload: ${error.message}`;
  }
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
    `/admin/dummy-api-requests?status=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}`
  );
}

function mapLogEntry(entry) {
  return {
    id: entry._id ? String(entry._id) : '',
    receivedAtDisplay: formatDateTime(entry.receivedAt),
    method: entry.method || entry.raw?.method || 'N/A',
    requestPath: entry.requestPath || entry.raw?.requestPath || 'N/A',
    rawJson: formatPayload(entry.raw || entry),
  };
}

exports.dashboard = async (req, res) => {
  try {
    const [settings, logs, totalLogs] = await Promise.all([
      getDummyApiEndpointSettings(),
      listDummyApiRequestLogs({ limit: DUMMY_API_LOG_LIMIT }),
      countDummyApiRequestLogs(),
    ]);

    return res.render('admin_dummy_api_requests', {
      feedback: parseFeedback(req.query),
      loadError: null,
      endpoints: DUMMY_API_ENDPOINT_PATHS,
      collectionName: DUMMY_API_LOG_COLLECTION_NAME,
      logLimit: DUMMY_API_LOG_LIMIT,
      totalLogs,
      settings: {
        ...settings,
        updatedAtDisplay: formatDateTime(settings.updatedAt),
        updatedByDisplay: settings.updatedBy || 'N/A',
      },
      logs: logs.map(mapLogEntry),
    });
  } catch (error) {
    logger.error('Failed to load dummy API request admin page', {
      category: 'dummy_api',
      metadata: { error: error.message },
    });

    return res.status(500).render('admin_dummy_api_requests', {
      feedback: null,
      loadError: 'Unable to load dummy API request logs right now.',
      endpoints: DUMMY_API_ENDPOINT_PATHS,
      collectionName: DUMMY_API_LOG_COLLECTION_NAME,
      logLimit: DUMMY_API_LOG_LIMIT,
      totalLogs: 0,
      settings: {
        enabled: false,
        updatedAtDisplay: 'N/A',
        updatedByDisplay: 'N/A',
      },
      logs: [],
    });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await updateDummyApiEndpointSettings(req.body || {}, {
      updatedBy: req.user?.name || null,
    });

    logger.notice('Dummy API logging setting updated by admin', {
      category: 'dummy_api',
      metadata: {
        enabled: settings.enabled,
        user: req.user?.name || 'unknown',
      },
    });

    return redirectWithFeedback(
      res,
      'success',
      settings.enabled ? 'Dummy API logging enabled.' : 'Dummy API logging disabled.'
    );
  } catch (error) {
    logger.error('Failed to update dummy API logging setting', {
      category: 'dummy_api',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to save dummy API setting.');
  }
};

exports.clearLogs = async (req, res) => {
  try {
    const result = await clearDummyApiRequestLogs();
    logger.notice('Dummy API request log collection cleared by admin', {
      category: 'dummy_api',
      metadata: {
        deletedCount: result.deletedCount,
        user: req.user?.name || 'unknown',
      },
    });

    return redirectWithFeedback(
      res,
      'success',
      `Cleared ${result.deletedCount} dummy API request log entr${result.deletedCount === 1 ? 'y' : 'ies'}.`
    );
  } catch (error) {
    logger.error('Failed to clear dummy API request logs', {
      category: 'dummy_api',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to clear dummy API request logs.');
  }
};
