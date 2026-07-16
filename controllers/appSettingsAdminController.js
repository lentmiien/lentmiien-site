const logger = require('../utils/logger');
const {
  DEFAULT_APP_SETTINGS,
  AppSettingsError,
  appSettingsService,
} = require('../services/appSettingsService');

function parseFeedback(query = {}) {
  const status = typeof query.status === 'string' ? query.status : '';
  const message = typeof query.message === 'string' ? query.message : '';
  if (!status || !message) return null;
  return {
    status: status === 'success' ? 'success' : 'error',
    message,
  };
}

function redirectWithFeedback(res, status, message, editId = '') {
  const edit = editId ? `&edit=${encodeURIComponent(editId)}` : '';
  return res.redirect(
    `/admin/app-settings?status=${encodeURIComponent(status)}&message=${encodeURIComponent(message)}${edit}`
  );
}

function mapCoreSettings(settings) {
  const settingsByKey = new Map(settings.map((setting) => [setting.key, setting]));
  return DEFAULT_APP_SETTINGS.map((definition) => ({
    ...definition,
    setting: settingsByKey.get(definition.key) || null,
  }));
}

exports.index = async (req, res) => {
  try {
    const settings = await appSettingsService.listSettings();
    const editSetting = req.query.edit
      ? await appSettingsService.getSettingById(req.query.edit)
      : null;
    const formDefaults = editSetting || {
      key: typeof req.query.key === 'string' ? req.query.key : '',
      value: typeof req.query.value === 'string' ? req.query.value : '',
      description: typeof req.query.description === 'string' ? req.query.description : '',
    };

    return res.render('admin_app_settings', {
      pageTitle: 'App Settings',
      feedback: parseFeedback(req.query),
      settings,
      coreSettings: mapCoreSettings(settings),
      editSetting,
      formDefaults,
    });
  } catch (error) {
    logger.error('Failed to render app settings admin page', {
      category: 'app_settings',
      metadata: { error: error.message },
    });
    return res.status(500).render('error_page', {
      message: 'Unable to load app settings right now.',
    });
  }
};

exports.save = async (req, res) => {
  try {
    const setting = await appSettingsService.saveSetting(req.body || {}, req.user?.name || 'admin');
    return redirectWithFeedback(
      res,
      'success',
      `Saved app setting ${setting.key}.`,
      setting._id ? setting._id.toString() : ''
    );
  } catch (error) {
    const knownError = error instanceof AppSettingsError;
    logger[knownError ? 'warning' : 'error']('Failed to save app setting', {
      category: 'app_settings',
      metadata: {
        key: req.body?.key || null,
        user: req.user?.name || null,
        error: error.message,
      },
    });
    return redirectWithFeedback(
      res,
      'error',
      knownError ? error.message : 'Unable to save the app setting.'
    );
  }
};

exports.delete = async (req, res) => {
  try {
    const deletedCount = await appSettingsService.deleteSetting(req.params.id);
    if (!deletedCount) {
      return redirectWithFeedback(res, 'error', 'App setting not found.');
    }
    return redirectWithFeedback(res, 'success', 'App setting deleted.');
  } catch (error) {
    logger.warning('Failed to delete app setting', {
      category: 'app_settings',
      metadata: { id: req.params.id, error: error.message },
    });
    return redirectWithFeedback(
      res,
      'error',
      error instanceof AppSettingsError ? error.message : 'Unable to delete the app setting.'
    );
  }
};

exports.seedDefaults = async (req, res) => {
  try {
    const result = await appSettingsService.seedDefaults(req.user?.name || 'admin');
    const message = result.inserted > 0
      ? `Restored ${result.inserted} missing required setting${result.inserted === 1 ? '' : 's'}.`
      : 'All required settings already exist; no values were changed.';
    return redirectWithFeedback(res, 'success', message);
  } catch (error) {
    logger.error('Failed to seed default app settings', {
      category: 'app_settings',
      metadata: { error: error.message, user: req.user?.name || null },
    });
    return redirectWithFeedback(res, 'error', 'Unable to restore required app settings.');
  }
};
