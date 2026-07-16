const {
  APP_SETTING_KEYS,
  DEFAULT_APP_SETTINGS,
  AppSettingsError,
  AppSettingsService,
  normalizeKey,
  normalizeValue,
} = require('../../services/appSettingsService');

function leanQuery(value) {
  return {
    lean: jest.fn().mockResolvedValue(value),
  };
}

function createSettingsModel() {
  const model = jest.fn(function settingConstructor(doc = {}) {
    Object.assign(this, doc);
    this._id = doc._id || { toString: () => 'setting-new' };
    this.save = jest.fn().mockResolvedValue(this);
  });
  model.find = jest.fn();
  model.findOne = jest.fn();
  model.findById = jest.fn();
  model.deleteOne = jest.fn();
  model.updateOne = jest.fn();
  return model;
}

describe('AppSettingsService', () => {
  test('normalizes keys and rejects invalid or blank values', () => {
    expect(normalizeKey('  Chat5.AI.Title_Model ')).toBe('chat5.ai.title_model');
    expect(normalizeValue('  gpt-test  ')).toBe('gpt-test');
    expect(() => normalizeKey('chat5 model')).toThrow(AppSettingsError);
    expect(() => normalizeValue('   ')).toThrow('Setting value is required.');
  });

  test('lists settings ordered by key', async () => {
    const model = createSettingsModel();
    const rows = [{ key: 'a', value: '1' }, { key: 'b', value: '2' }];
    const lean = jest.fn().mockResolvedValue(rows);
    const sort = jest.fn().mockReturnValue({ lean });
    model.find.mockReturnValue({ sort });
    const service = new AppSettingsService(model);

    await expect(service.listSettings()).resolves.toBe(rows);
    expect(model.find).toHaveBeenCalledWith({});
    expect(sort).toHaveBeenCalledWith({ key: 1 });
  });

  test('returns a required value from the database', async () => {
    const model = createSettingsModel();
    model.findOne.mockReturnValue(leanQuery({
      key: APP_SETTING_KEYS.CHAT5_TITLE_MODEL,
      value: 'gpt-title-model',
    }));
    const service = new AppSettingsService(model);

    await expect(service.getValue(APP_SETTING_KEYS.CHAT5_TITLE_MODEL)).resolves.toBe('gpt-title-model');
    expect(model.findOne).toHaveBeenCalledWith({ key: APP_SETTING_KEYS.CHAT5_TITLE_MODEL });
  });

  test('does not fall back to a hard-coded model when a setting is missing', async () => {
    const model = createSettingsModel();
    model.findOne.mockReturnValue(leanQuery(null));
    const service = new AppSettingsService(model);

    await expect(service.getValue(APP_SETTING_KEYS.CHAT5_SUMMARY_MODEL)).rejects.toThrow(
      `Required app setting "${APP_SETTING_KEYS.CHAT5_SUMMARY_MODEL}" is missing.`
    );
  });

  test('creates a setting with audit fields', async () => {
    const model = createSettingsModel();
    const service = new AppSettingsService(model);

    const result = await service.saveSetting({
      key: ' Feature.Model ',
      value: ' model-name ',
      description: ' Description ',
    }, 'Admin User');

    expect(model).toHaveBeenCalledWith({
      key: 'feature.model',
      value: 'model-name',
      description: 'Description',
      createdBy: 'Admin User',
      updatedBy: 'Admin User',
    });
    expect(result).toMatchObject({ key: 'feature.model', value: 'model-name' });
  });

  test('edits an existing setting without replacing its identity', async () => {
    const model = createSettingsModel();
    const existing = {
      _id: { toString: () => 'setting-1' },
      key: 'old.key',
      value: 'old',
      description: '',
      createdBy: 'setup',
      save: jest.fn().mockResolvedValue(),
      toObject: jest.fn(function toObject() {
        return {
          _id: this._id,
          key: this.key,
          value: this.value,
          description: this.description,
          createdBy: this.createdBy,
          updatedBy: this.updatedBy,
        };
      }),
    };
    model.findById.mockResolvedValue(existing);
    const service = new AppSettingsService(model);

    const result = await service.saveSetting({
      id: 'setting-1',
      key: 'new.key',
      value: 'new-value',
      description: 'Changed',
    }, 'Lennart');

    expect(existing.save).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      key: 'new.key',
      value: 'new-value',
      createdBy: 'setup',
      updatedBy: 'Lennart',
    });
  });

  test('reports duplicate keys as a validation error', async () => {
    const model = createSettingsModel();
    model.mockImplementationOnce(function duplicateSetting() {
      this.save = jest.fn().mockRejectedValue(Object.assign(new Error('duplicate'), { code: 11000 }));
    });
    const service = new AppSettingsService(model);

    await expect(service.saveSetting({ key: 'duplicate.key', value: 'value' }))
      .rejects.toThrow('A setting with key "duplicate.key" already exists.');
  });

  test('deletes settings by id', async () => {
    const model = createSettingsModel();
    model.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const service = new AppSettingsService(model);

    await expect(service.deleteSetting('setting-1')).resolves.toBe(1);
    expect(model.deleteOne).toHaveBeenCalledWith({ _id: 'setting-1' });
  });

  test('seeds required defaults without overwriting existing values', async () => {
    const model = createSettingsModel();
    model.updateOne
      .mockResolvedValueOnce({ upsertedCount: 1 })
      .mockResolvedValueOnce({ upsertedCount: 0 });
    const service = new AppSettingsService(model);

    await expect(service.seedDefaults('setup')).resolves.toEqual({
      inserted: 1,
      total: DEFAULT_APP_SETTINGS.length,
    });
    expect(model.updateOne).toHaveBeenCalledTimes(DEFAULT_APP_SETTINGS.length);
    expect(model.updateOne).toHaveBeenNthCalledWith(
      1,
      { key: APP_SETTING_KEYS.CHAT5_TITLE_MODEL },
      {
        $setOnInsert: expect.objectContaining({
          key: APP_SETTING_KEYS.CHAT5_TITLE_MODEL,
          value: 'gpt-4.1-nano-2025-04-14',
          createdBy: 'setup',
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
        }),
      },
      { upsert: true, timestamps: false }
    );
  });
});
