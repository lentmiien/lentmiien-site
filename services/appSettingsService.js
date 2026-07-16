const AppSetting = require('../models/app_setting');
const {
  APP_SETTING_KEYS,
  DEFAULT_APP_SETTINGS,
} = require('./data/defaultAppSettings');

const APP_SETTING_KEY_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

class AppSettingsError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'AppSettingsError';
    this.status = status;
  }
}

function normalizeKey(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!key) {
    throw new AppSettingsError('Setting key is required.');
  }
  if (key.length > 160 || !APP_SETTING_KEY_PATTERN.test(key)) {
    throw new AppSettingsError('Setting key may only contain lowercase letters, numbers, dots, underscores, and hyphens.');
  }
  return key;
}

function normalizeValue(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new AppSettingsError('Setting value is required.');
  }
  if (normalized.length > 10000) {
    throw new AppSettingsError('Setting value must be 10,000 characters or fewer.');
  }
  return normalized;
}

function normalizeDescription(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (normalized.length > 1000) {
    throw new AppSettingsError('Description must be 1,000 characters or fewer.');
  }
  return normalized;
}

function normalizeActor(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return (normalized || 'system').slice(0, 100);
}

function toPlainSetting(setting) {
  if (!setting) return null;
  if (typeof setting.toObject === 'function') {
    return setting.toObject({ versionKey: false });
  }
  return { ...setting };
}

function isDuplicateKeyError(error) {
  return error && (error.code === 11000 || error.code === 11001);
}

class AppSettingsService {
  constructor(settingsModel = AppSetting) {
    this.settingsModel = settingsModel;
  }

  async listSettings() {
    return this.settingsModel.find({}).sort({ key: 1 }).lean();
  }

  async getSettingById(id) {
    if (!id) return null;
    return this.settingsModel.findById(id).lean();
  }

  async getValue(key) {
    const normalizedKey = normalizeKey(key);
    const setting = await this.settingsModel.findOne({ key: normalizedKey }).lean();
    if (!setting) {
      throw new AppSettingsError(
        `Required app setting "${normalizedKey}" is missing. Configure it at /admin/app-settings.`,
        500
      );
    }
    return normalizeValue(setting.value);
  }

  async saveSetting(input = {}, actor = 'system') {
    const id = typeof input.id === 'string' ? input.id.trim() : '';
    const key = normalizeKey(input.key);
    const value = normalizeValue(input.value);
    const description = normalizeDescription(input.description);
    const updatedBy = normalizeActor(actor);

    try {
      if (id) {
        const setting = await this.settingsModel.findById(id);
        if (!setting) {
          throw new AppSettingsError('App setting not found.', 404);
        }
        setting.key = key;
        setting.value = value;
        setting.description = description;
        setting.updatedBy = updatedBy;
        await setting.save();
        return toPlainSetting(setting);
      }

      const setting = new this.settingsModel({
        key,
        value,
        description,
        createdBy: updatedBy,
        updatedBy,
      });
      await setting.save();
      return toPlainSetting(setting);
    } catch (error) {
      if (error instanceof AppSettingsError) {
        throw error;
      }
      if (isDuplicateKeyError(error)) {
        throw new AppSettingsError(`A setting with key "${key}" already exists.`);
      }
      throw error;
    }
  }

  async deleteSetting(id) {
    if (!id) {
      throw new AppSettingsError('App setting id is required.');
    }
    const result = await this.settingsModel.deleteOne({ _id: id });
    return result.deletedCount || 0;
  }

  async seedDefaults(actor = 'setup') {
    const updatedBy = normalizeActor(actor);
    const seededAt = new Date();
    let inserted = 0;

    for (const definition of DEFAULT_APP_SETTINGS) {
      const result = await this.settingsModel.updateOne(
        { key: definition.key },
        {
          $setOnInsert: {
            ...definition,
            createdBy: updatedBy,
            updatedBy,
            createdAt: seededAt,
            updatedAt: seededAt,
          },
        },
        { upsert: true, timestamps: false }
      );
      inserted += result.upsertedCount || (result.upsertedId ? 1 : 0);
    }

    return {
      inserted,
      total: DEFAULT_APP_SETTINGS.length,
    };
  }
}

const appSettingsService = new AppSettingsService();

module.exports = {
  APP_SETTING_KEYS,
  DEFAULT_APP_SETTINGS,
  AppSettingsError,
  AppSettingsService,
  appSettingsService,
  normalizeKey,
  normalizeValue,
};
