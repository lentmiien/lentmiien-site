const path = require('path');
const pug = require('pug');
const express = require('express');
const mockModels = jest.fn();
const mockTemplates = jest.fn();
const mockSettings = jest.fn();
jest.mock('../../database', () => ({
  Chat3TemplateModel: { find: () => ({ sort: () => ({ lean: () => ({ exec: mockTemplates }) }) }) },
  Chat5QuickSettingModel: { find: () => ({ sort: () => ({ lean: () => ({ exec: mockSettings }) }) }) },
}));
jest.mock('../../services/chat5ModelCatalogService', () => ({ listAvailableChatModels: mockModels }));
jest.mock('../../services/toolManagerService', () => jest.fn(() => ({ getAvailableTools: async () => [] })));
const controller = require('../../controllers/chat5QuickSettingsController');
const { parseQuickSettingForm, toManagementView } = require('../../services/chat5QuickSettingService');
const { initialize } = require('../../public/js/chat5_quick_settings');
const template = path.resolve(__dirname, '../../views/chat5_quick_settings.pug');
const navigation = {
  loggedIn: true, permissions: ['quicknote'],
  accountNavigation: [{ id: 'chat5', label: 'Chat navigation', group: 'AI', subgroup: 'Chat', href: '/chat5', src: '/i/chat.svg' }],
  navigationGroups: ['AI'],
};

test.each([false, true])('renders empty/populated settings catalogs alongside inherited navigation: populated=%s', populated => {
  const html = pug.renderFile(template, {
    ...navigation,
    catalog: {
      contextTemplates: populated ? [{ _id: 'context-1', Category: 'Work', Title: 'Synthetic context' }] : [],
      models: populated ? [{ api_model: 'synthetic-model', model_name: 'Synthetic model' }] : [],
      tools: populated ? [{ name: 'synthetic-tool', displayName: 'Synthetic tool' }] : [],
    },
    quickSettings: populated ? [toManagementView({ _id: 'setting-1', name: 'Saved setting', overrides: { model: 'synthetic-model' } })] : [],
    reasoningOptions: ['medium'], modeOptions: ['standard'], verbosityOptions: ['medium'], successMessage: '', errorMessage: '',
  });
  expect(html).toContain('Chat navigation');
  expect(html).toContain('id="quickNoteForm"');
  expect(html).toContain('Create quick setting');
  if (populated) {
    for (const value of ['Synthetic context', 'Synthetic model', 'Synthetic tool', 'Saved setting']) expect(html).toContain(value);
  }
});

test('authenticated controller GET renders HTTP 200 using its actual catalog loader', async () => {
  mockModels.mockResolvedValue([{ api_model: 'synthetic-model', model_name: 'Synthetic model' }]);
  mockTemplates.mockResolvedValue([]);
  mockSettings.mockResolvedValue([]);
  const app = express();
  app.set('views', path.dirname(template));
  app.set('view engine', 'pug');
  app.use((req, res, next) => { req.user = { name: 'synthetic-user' }; Object.assign(res.locals, navigation); next(); });
  app.get('/chat5/quick-settings', controller.list);
  const server = await new Promise(resolve => { const listening = app.listen(0, '127.0.0.1', () => resolve(listening)); });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/chat5/quick-settings`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Synthetic model');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('rendered create and edit forms toggle independently and submit the selected overrides', async () => {
  const { JSDOM } = await import('jsdom');
  const catalog = {
    contextTemplates: [{ _id: 'context-1', Category: 'Work', Title: 'Synthetic context', TemplateText: 'Context instructions' }],
    models: [{ api_model: 'synthetic-model', model_name: 'Synthetic model' }],
    tools: [],
  };
  const html = pug.renderFile(template, {
    ...navigation,
    catalog,
    quickSettings: [toManagementView({ _id: 'setting-1', name: 'Saved setting', overrides: { model: 'synthetic-model' } })],
    reasoningOptions: ['medium'],
    modeOptions: ['standard'],
    verbosityOptions: ['medium'],
  });
  const dom = new JSDOM(html);
  try {
    const { document, Event, FormData } = dom.window;
    initialize(document, dom.window);
    const [createForm, editForm] = document.querySelectorAll('[data-quick-setting-form]');
    const change = (form, name, value) => {
      const input = form.elements.namedItem(name);
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    expect(createForm.getAttribute('action')).toBe('/chat5/quick-settings');
    expect(editForm.getAttribute('action')).toBe('/chat5/quick-settings/setting-1');
    expect(createForm.elements.namedItem('model').disabled).toBe(true);
    expect(editForm.elements.namedItem('model').disabled).toBe(false);
    change(createForm, 'name', 'New setting');
    change(createForm, 'model_mode', 'override');
    change(createForm, 'model', 'synthetic-model');
    change(editForm, 'model_mode', 'ignore');
    expect(createForm.elements.namedItem('model').disabled).toBe(false);
    expect(editForm.elements.namedItem('model').disabled).toBe(true);

    change(createForm, 'context_mode', 'text');
    expect(createForm.elements.namedItem('context_text').disabled).toBe(false);
    expect(createForm.elements.namedItem('context_template_id').disabled).toBe(true);
    change(createForm, 'context_mode', 'template');
    change(createForm, 'context_template_id', 'context-1');
    expect(createForm.elements.namedItem('context_text').disabled).toBe(true);
    expect(createForm.elements.namedItem('context_template_id').classList.contains('d-none')).toBe(false);

    const submitted = Object.fromEntries(new FormData(createForm));
    expect(submitted).not.toHaveProperty('context_text');
    expect(parseQuickSettingForm(submitted, catalog)).toEqual({
      name: 'New setting',
      overrides: {
        model: 'synthetic-model',
        context: { source: 'template', text: 'Context instructions', templateId: 'context-1' },
      },
    });
    expect(parseQuickSettingForm(Object.fromEntries(new FormData(editForm)), catalog)).toEqual({
      name: 'Saved setting',
      overrides: {},
    });
  } finally {
    dom.window.close();
  }
});
