const {
  Chat3TemplateModel,
  Chat5QuickSettingModel,
} = require('../database');
const logger = require('../utils/logger');
const ToolManagerService = require('../services/toolManagerService');
const { listAvailableChatModels } = require('../services/chat5ModelCatalogService');
const {
  Chat5QuickSettingService,
  MODE_OPTIONS,
  REASONING_OPTIONS,
  VERBOSITY_OPTIONS,
  buildToolOptions,
  parseQuickSettingForm,
  toManagementView,
} = require('../services/chat5QuickSettingService');

const quickSettingService = new Chat5QuickSettingService(Chat5QuickSettingModel);
const toolManagerService = new ToolManagerService();
const PAGE_PATH = '/chat5/quick-settings';

function redirectWithMessage(res, key, message) {
  return res.redirect(`${PAGE_PATH}?${key}=${encodeURIComponent(message)}`);
}

function errorMessage(error, fallback) {
  if (error && error.code === 11000) {
    return 'A quick setting with that name already exists.';
  }
  if (error && error.name === 'Chat5QuickSettingValidationError') {
    return error.message;
  }
  if (error && error.name === 'CastError') {
    return 'Quick setting not found.';
  }
  if (error && error.name === 'ValidationError') {
    return 'The quick setting contains an invalid value.';
  }
  return fallback;
}

async function loadCatalog() {
  const [models, templates, availableTools] = await Promise.all([
    listAvailableChatModels(),
    Chat3TemplateModel.find().sort({ Category: 1, Title: 1 }).lean().exec(),
    toolManagerService.getAvailableTools(),
  ]);

  return {
    models,
    contextTemplates: templates.filter((template) => template.Type === 'context'),
    tools: buildToolOptions(availableTools),
  };
}

exports.list = async (req, res) => {
  const user = req.user.name;
  const [settings, catalog] = await Promise.all([
    quickSettingService.listForUser(user),
    loadCatalog(),
  ]);

  res.render('chat5_quick_settings', {
    quickSettings: settings.map(toManagementView),
    catalog,
    reasoningOptions: REASONING_OPTIONS,
    modeOptions: MODE_OPTIONS,
    verbosityOptions: VERBOSITY_OPTIONS,
    successMessage: req.query.success || '',
    errorMessage: req.query.error || '',
  });
};

exports.create = async (req, res) => {
  const user = req.user.name;
  try {
    const catalog = await loadCatalog();
    const data = parseQuickSettingForm(req.body, catalog);
    await quickSettingService.createForUser(user, data);
    return redirectWithMessage(res, 'success', 'Quick setting created.');
  } catch (error) {
    logger.warning('Failed to create Chat5 quick setting', {
      category: 'chat5_quick_settings',
      metadata: { user, error: error.message },
    });
    return redirectWithMessage(res, 'error', errorMessage(error, 'Unable to create quick setting.'));
  }
};

exports.update = async (req, res) => {
  const user = req.user.name;
  try {
    const catalog = await loadCatalog();
    const data = parseQuickSettingForm(req.body, catalog);
    const setting = await quickSettingService.updateForUser(user, req.params.id, data);
    if (!setting) {
      return redirectWithMessage(res, 'error', 'Quick setting not found.');
    }
    return redirectWithMessage(res, 'success', 'Quick setting updated.');
  } catch (error) {
    logger.warning('Failed to update Chat5 quick setting', {
      category: 'chat5_quick_settings',
      metadata: { user, settingId: req.params.id, error: error.message },
    });
    return redirectWithMessage(res, 'error', errorMessage(error, 'Unable to update quick setting.'));
  }
};

exports.remove = async (req, res) => {
  const user = req.user.name;
  try {
    const setting = await quickSettingService.deleteForUser(user, req.params.id);
    if (!setting) {
      return redirectWithMessage(res, 'error', 'Quick setting not found.');
    }
    return redirectWithMessage(res, 'success', 'Quick setting deleted.');
  } catch (error) {
    logger.warning('Failed to delete Chat5 quick setting', {
      category: 'chat5_quick_settings',
      metadata: { user, settingId: req.params.id, error: error.message },
    });
    return redirectWithMessage(res, 'error', errorMessage(error, 'Unable to delete quick setting.'));
  }
};
