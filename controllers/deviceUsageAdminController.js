const logger = require('../utils/logger');
const {
  DEVICE_USAGE_CATEGORIES,
  DeviceUsageSettingsError,
  addDeviceUsageReward,
  addManualStudyMinutes,
  deleteDeviceUsagePackageRule,
  deleteRewardSuggestion,
  getDeviceUsageDashboard,
  normalizeDeviceUsageCategory,
  saveDeviceUsagePackageRule,
  saveRewardSuggestion,
  updateHomeworkGateForToday,
  updateDeviceUsageSettings,
} = require('../services/deviceUsageService');
const {
  buildCategoryRules,
  buildOverviewCards,
  formatDateTime,
  formatMinuteDuration,
  formatNumber,
  formatWindow,
  getCategoryColor,
  getCategoryLabel,
  mapDailyStats,
  mapPackageStats,
  mapRecentRequest,
} = require('../utils/deviceUsageDashboardView');

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
    `/admin/device-usage?status=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}`
  );
}

function mapSettings(settings) {
  return {
    ...settings,
    rollingWindowDisplay: formatWindow(settings.rollingWindowMinutes),
    rollingLimitDisplay: `${formatNumber(settings.rollingLimitMinutes)} min`,
    learningRequiredDisplay: `${formatNumber(settings.learningRequiredMinutes)} min`,
    learningFreeDisplay: `${formatNumber(settings.learningFreeMinutes)} min`,
    homeworkGateDisplay: settings.homeworkGateEnabled ? 'Enabled' : 'Disabled',
    maxVolumeDisplay: `${formatNumber(settings.maxVolume)}%`,
    updatedAtDisplay: formatDateTime(settings.updatedAt),
    updatedByDisplay: settings.updatedBy || 'N/A',
  };
}

function mapPackageRule(rule) {
  const category = normalizeDeviceUsageCategory(rule.category);

  return {
    ...rule,
    category,
    categoryLabel: getCategoryLabel(category),
    categoryColor: getCategoryColor(category),
    updatedAtDisplay: formatDateTime(rule.updatedAt),
    updatedByDisplay: rule.updatedBy || 'N/A',
  };
}

function mapRewardSuggestion(suggestion) {
  return {
    ...suggestion,
    lastUsedDisplay: formatDateTime(suggestion.lastUsedAt),
  };
}

function mapReward(reward) {
  return {
    ...reward,
    awardedAtDisplay: formatDateTime(reward.awardedAt),
    titleDisplay: reward.titleEn || reward.titleJa || 'Reward',
    commentDisplay: reward.comment || '',
  };
}

function mapGateState(gateState = {}, settings = {}) {
  const totalStudyMinutes = Number(gateState.totalStudyMinutes) || 0;
  const manualStudyMinutes = Number(gateState.manualStudyMinutes) || 0;
  const loggedLearningMinutes = Number(gateState.loggedLearningMinutes) || 0;
  const learningRequiredMinutes = Number(settings.learningRequiredMinutes) || 0;
  const homeworkCleared = Boolean(gateState.homeworkCleared);
  const homeworkGateEnabled = Boolean(settings.homeworkGateEnabled);

  return {
    ...gateState,
    manualStudyMinutes,
    loggedLearningMinutes,
    totalStudyMinutes,
    manualStudyDisplay: `${formatNumber(manualStudyMinutes)} min`,
    loggedLearningDisplay: `${formatNumber(loggedLearningMinutes)} min`,
    totalStudyDisplay: `${formatNumber(totalStudyMinutes)} / ${formatNumber(learningRequiredMinutes)} min`,
    learningRemainingDisplay: `${formatNumber(Math.max(0, learningRequiredMinutes - totalStudyMinutes))} min`,
    homeworkStatusDisplay: homeworkGateEnabled
      ? (homeworkCleared ? 'Cleared' : 'Waiting')
      : 'Disabled',
    homeworkAction: homeworkCleared ? 'Reset Homework' : 'Clear Homework',
    homeworkNextValue: homeworkCleared ? 'false' : 'true',
    homeworkClearedAtDisplay: formatDateTime(gateState.homeworkClearedAt),
    homeworkClearedByDisplay: gateState.homeworkClearedBy || 'N/A',
    manualStudyUpdatedAtDisplay: formatDateTime(gateState.manualStudyUpdatedAt),
    manualStudyUpdatedByDisplay: gateState.manualStudyUpdatedBy || 'N/A',
  };
}

function buildFallbackDashboard() {
  return {
    endpointPath: 'N/A',
    generatedAt: new Date(),
    localDateKey: '',
    settings: {
      rollingLimitMinutes: 60,
      rollingWindowMinutes: 90,
      rollingWindowMs: 90 * 60 * 1000,
      learningRequiredMinutes: 30,
      learningFreeMinutes: 30,
      homeworkGateEnabled: false,
      maxVolume: 100,
      updatedAt: null,
      updatedBy: null,
    },
    currentWindowStart: new Date(),
    currentCountedMinutes: 0,
    currentLearningMinutes: 0,
    learningRemainingMinutes: 30,
    rollingRemainingMinutes: 60,
    totalStored: 0,
    blockedToday: 0,
    limitTiming: { mode: 'infinite', minutes: null },
    entertainmentUnlocked: false,
    nextEntertainmentAction: 'learn_first',
    nextEntertainmentStatus: 'NG',
    todayStats: {
      totalMinutes: 0,
      countedMinutes: 0,
      blockedMinutes: 0,
      learningMinutes: 0,
      categories: [],
    },
    todayPackageStats: [],
    chartSeries: [],
    dailyStats: [],
    packageRules: [],
    rewardSuggestions: [],
    recentRewards: [],
    rewardSummary: { points: 0, count: 0 },
    gateState: {
      localDateKey: '',
      manualStudyMinutes: 0,
      loggedLearningMinutes: 0,
      totalStudyMinutes: 0,
      homeworkCleared: false,
      homeworkClearedAt: null,
      homeworkClearedBy: null,
      manualStudyUpdatedAt: null,
      manualStudyUpdatedBy: null,
    },
    recentRequests: [],
  };
}

exports.dashboard = async (req, res) => {
  try {
    const dashboard = await getDeviceUsageDashboard();
    const chartPayload = {
      points: dashboard.chartSeries,
      limit: dashboard.settings.rollingLimitMinutes,
      windowMinutes: dashboard.settings.rollingWindowMinutes,
    };

    return res.render('admin_device_usage', {
      feedback: parseFeedback(req.query),
      loadError: null,
      generatedAtDisplay: formatDateTime(dashboard.generatedAt),
      endpointPath: dashboard.endpointPath,
      todayDateKey: dashboard.localDateKey,
      settings: mapSettings(dashboard.settings),
      overviewCards: buildOverviewCards(dashboard),
      categoryRules: buildCategoryRules(),
      categories: DEVICE_USAGE_CATEGORIES.map((category) => ({
        value: category,
        label: getCategoryLabel(category),
        color: getCategoryColor(category),
      })),
      todayStats: {
        totalDurationDisplay: formatMinuteDuration(dashboard.todayStats.totalMinutes),
        countedDurationDisplay: formatMinuteDuration(dashboard.todayStats.countedMinutes),
        blockedDurationDisplay: formatMinuteDuration(dashboard.todayStats.blockedMinutes),
        learningDurationDisplay: formatMinuteDuration(dashboard.todayStats.learningMinutes),
      },
      dailyStats: mapDailyStats(dashboard.dailyStats),
      packageStats: mapPackageStats(dashboard.todayPackageStats),
      packageRules: dashboard.packageRules.map(mapPackageRule),
      rewardSuggestions: dashboard.rewardSuggestions.map(mapRewardSuggestion),
      recentRewards: dashboard.recentRewards.map(mapReward),
      gateState: mapGateState(dashboard.gateState, dashboard.settings),
      recentRequests: dashboard.recentRequests.map(mapRecentRequest),
      chartJson: JSON.stringify(chartPayload),
    });
  } catch (error) {
    logger.error('Failed to load device usage admin dashboard', {
      category: 'device-usage',
      metadata: { error: error.message },
    });

    const dashboard = buildFallbackDashboard();
    return res.status(500).render('admin_device_usage', {
      feedback: null,
      loadError: 'Unable to load device usage data right now.',
      generatedAtDisplay: formatDateTime(new Date()),
      endpointPath: 'N/A',
      todayDateKey: '',
      settings: mapSettings(dashboard.settings),
      overviewCards: [],
      categoryRules: buildCategoryRules(),
      categories: DEVICE_USAGE_CATEGORIES.map((category) => ({
        value: category,
        label: getCategoryLabel(category),
        color: getCategoryColor(category),
      })),
      todayStats: {
        totalDurationDisplay: '0 minutes',
        countedDurationDisplay: '0 minutes',
        blockedDurationDisplay: '0 minutes',
        learningDurationDisplay: '0 minutes',
      },
      dailyStats: [],
      packageStats: [],
      packageRules: [],
      rewardSuggestions: [],
      recentRewards: [],
      gateState: mapGateState(dashboard.gateState, dashboard.settings),
      recentRequests: [],
      chartJson: JSON.stringify({ points: [], limit: 60, windowMinutes: 90 }),
    });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    const settings = await updateDeviceUsageSettings(req.body || {}, {
      updatedBy: req.user?.name || null,
    });

    logger.notice('Device usage settings updated by admin', {
      category: 'device-usage',
      metadata: {
        rollingLimitMinutes: settings.rollingLimitMinutes,
        rollingWindowMinutes: settings.rollingWindowMinutes,
        learningRequiredMinutes: settings.learningRequiredMinutes,
        learningFreeMinutes: settings.learningFreeMinutes,
        homeworkGateEnabled: settings.homeworkGateEnabled,
        maxVolume: settings.maxVolume,
        user: req.user?.name || 'unknown',
      },
    });

    return redirectWithFeedback(res, 'success', 'Device usage settings saved.');
  } catch (error) {
    if (error instanceof DeviceUsageSettingsError) {
      return redirectWithFeedback(res, 'error', error.message);
    }

    logger.error('Failed to update device usage settings', {
      category: 'device-usage',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to save device usage settings.');
  }
};

exports.addStudyMinutes = async (req, res) => {
  try {
    const gateState = await addManualStudyMinutes(req.body || {}, {
      updatedBy: req.user?.name || null,
    });
    return redirectWithFeedback(res, 'success', `Added study minutes. Manual study today is now ${gateState.manualStudyMinutes} min.`);
  } catch (error) {
    if (error instanceof DeviceUsageSettingsError) {
      return redirectWithFeedback(res, 'error', error.message);
    }

    logger.error('Failed to add manual device usage study minutes', {
      category: 'device-usage',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to add study minutes.');
  }
};

exports.updateHomeworkGate = async (req, res) => {
  try {
    const gateState = await updateHomeworkGateForToday(req.body || {}, {
      updatedBy: req.user?.name || null,
    });
    return redirectWithFeedback(
      res,
      'success',
      gateState.homeworkCleared ? 'Homework cleared for today.' : 'Homework gate reset for today.'
    );
  } catch (error) {
    if (error instanceof DeviceUsageSettingsError) {
      return redirectWithFeedback(res, 'error', error.message);
    }

    logger.error('Failed to update device usage homework gate', {
      category: 'device-usage',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to update homework gate.');
  }
};

exports.savePackageRule = async (req, res) => {
  try {
    await saveDeviceUsagePackageRule(req.body || {}, {
      updatedBy: req.user?.name || null,
    });
    return redirectWithFeedback(res, 'success', 'Package rule saved.');
  } catch (error) {
    if (error instanceof DeviceUsageSettingsError) {
      return redirectWithFeedback(res, 'error', error.message);
    }

    logger.error('Failed to save device usage package rule', {
      category: 'device-usage',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to save package rule.');
  }
};

exports.deletePackageRule = async (req, res) => {
  try {
    await deleteDeviceUsagePackageRule(req.body || {}, {
      updatedBy: req.user?.name || null,
    });
    return redirectWithFeedback(res, 'success', 'Package rule archived.');
  } catch (error) {
    if (error instanceof DeviceUsageSettingsError) {
      return redirectWithFeedback(res, 'error', error.message);
    }

    logger.error('Failed to archive device usage package rule', {
      category: 'device-usage',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to archive package rule.');
  }
};

exports.addReward = async (req, res) => {
  try {
    await addDeviceUsageReward(req.body || {}, {
      updatedBy: req.user?.name || null,
    });
    return redirectWithFeedback(res, 'success', 'Reward saved.');
  } catch (error) {
    if (error instanceof DeviceUsageSettingsError) {
      return redirectWithFeedback(res, 'error', error.message);
    }

    logger.error('Failed to add device usage reward', {
      category: 'device-usage',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to save reward.');
  }
};

exports.saveRewardSuggestion = async (req, res) => {
  try {
    await saveRewardSuggestion(req.body || {}, {
      updatedBy: req.user?.name || null,
    });
    return redirectWithFeedback(res, 'success', 'Reward suggestion saved.');
  } catch (error) {
    if (error instanceof DeviceUsageSettingsError) {
      return redirectWithFeedback(res, 'error', error.message);
    }

    logger.error('Failed to save device usage reward suggestion', {
      category: 'device-usage',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to save reward suggestion.');
  }
};

exports.deleteRewardSuggestion = async (req, res) => {
  try {
    await deleteRewardSuggestion(req.body || {}, {
      updatedBy: req.user?.name || null,
    });
    return redirectWithFeedback(res, 'success', 'Reward suggestion archived.');
  } catch (error) {
    if (error instanceof DeviceUsageSettingsError) {
      return redirectWithFeedback(res, 'error', error.message);
    }

    logger.error('Failed to archive device usage reward suggestion', {
      category: 'device-usage',
      metadata: { error: error.message },
    });
    return redirectWithFeedback(res, 'error', 'Unable to archive reward suggestion.');
  }
};
