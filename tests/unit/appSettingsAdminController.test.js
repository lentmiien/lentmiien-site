const mockAppSettingsService = {
  listSettings: jest.fn(),
  getSettingById: jest.fn(),
  saveSetting: jest.fn(),
  deleteSetting: jest.fn(),
  seedDefaults: jest.fn(),
};

class MockAppSettingsError extends Error {}

jest.mock('../../services/appSettingsService', () => ({
  DEFAULT_APP_SETTINGS: [
    { key: 'chat5.ai.title_model', value: 'title-default', description: 'Title model' },
    { key: 'chat5.ai.summary_model', value: 'summary-default', description: 'Summary model' },
  ],
  AppSettingsError: MockAppSettingsError,
  appSettingsService: mockAppSettingsService,
}));

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
}));

const controller = require('../../controllers/appSettingsAdminController');

function createResponse() {
  const response = {
    render: jest.fn(),
    redirect: jest.fn(),
    status: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe('appSettingsAdminController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders stored settings and required Chat5 status', async () => {
    const titleSetting = {
      _id: 'setting-1',
      key: 'chat5.ai.title_model',
      value: 'gpt-title',
    };
    mockAppSettingsService.listSettings.mockResolvedValue([titleSetting]);
    const req = { query: {} };
    const res = createResponse();

    await controller.index(req, res);

    expect(res.render).toHaveBeenCalledWith('admin_app_settings', expect.objectContaining({
      settings: [titleSetting],
      coreSettings: [
        expect.objectContaining({ key: 'chat5.ai.title_model', setting: titleSetting }),
        expect.objectContaining({ key: 'chat5.ai.summary_model', setting: null }),
      ],
    }));
  });

  test('loads an entry for editing', async () => {
    const setting = { _id: 'setting-2', key: 'feature.key', value: 'on' };
    mockAppSettingsService.listSettings.mockResolvedValue([setting]);
    mockAppSettingsService.getSettingById.mockResolvedValue(setting);
    const res = createResponse();

    await controller.index({ query: { edit: 'setting-2' } }, res);

    expect(mockAppSettingsService.getSettingById).toHaveBeenCalledWith('setting-2');
    expect(res.render).toHaveBeenCalledWith('admin_app_settings', expect.objectContaining({
      editSetting: setting,
      formDefaults: setting,
    }));
  });

  test('saves an entry and redirects with feedback', async () => {
    mockAppSettingsService.saveSetting.mockResolvedValue({
      _id: { toString: () => 'setting-3' },
      key: 'feature.key',
    });
    const res = createResponse();

    await controller.save({
      body: { key: 'feature.key', value: 'enabled' },
      user: { name: 'Lennart' },
    }, res);

    expect(mockAppSettingsService.saveSetting).toHaveBeenCalledWith(
      { key: 'feature.key', value: 'enabled' },
      'Lennart'
    );
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('status=success'));
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('edit=setting-3'));
  });

  test('deletes an entry', async () => {
    mockAppSettingsService.deleteSetting.mockResolvedValue(1);
    const res = createResponse();

    await controller.delete({ params: { id: 'setting-4' } }, res);

    expect(mockAppSettingsService.deleteSetting).toHaveBeenCalledWith('setting-4');
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('status=success'));
  });

  test('restores only missing defaults', async () => {
    mockAppSettingsService.seedDefaults.mockResolvedValue({ inserted: 1, total: 2 });
    const res = createResponse();

    await controller.seedDefaults({ user: { name: 'Admin' } }, res);

    expect(mockAppSettingsService.seedDefaults).toHaveBeenCalledWith('Admin');
    expect(res.redirect).toHaveBeenCalledWith(expect.stringContaining('Restored%201%20missing'));
  });
});
