const {
  Chat5QuickSettingService,
  Chat5QuickSettingValidationError,
  buildToolOptions,
  parseQuickSettingForm,
  serializeQuickSetting,
} = require('../../services/chat5QuickSettingService');

const catalog = {
  models: [
    { api_model: 'gpt-fast', model_name: 'Fast' },
    { api_model: 'gpt-deep', model_name: 'Deep' },
  ],
  contextTemplates: [
    { _id: 'template-1', Type: 'context', TemplateText: 'Template context' },
  ],
  tools: buildToolOptions([
    { name: 'custom_tool', displayName: 'Custom tool' },
  ]),
};

function createQuery(result) {
  const query = {
    sort: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(result),
  };
  return query;
}

describe('Chat5 quick setting service', () => {
  test('parses every supported override and snapshots a selected context template', () => {
    const parsed = parseQuickSettingForm({
      name: '  Deep research  ',
      category_mode: 'override',
      category: ' Research ',
      tags_mode: 'override',
      tags: 'current, sources, current',
      context_mode: 'template',
      context_template_id: 'template-1',
      tools_mode: 'override',
      tools: ['web_search_preview', 'custom_tool'],
      model_mode: 'override',
      model: 'gpt-deep',
      maxMessages_mode: 'override',
      maxMessages: '42',
      reasoning_mode: 'override',
      reasoning: 'max',
      mode_mode: 'override',
      mode: 'pro',
      verbosity_mode: 'override',
      verbosity: 'high',
      members_mode: 'override',
      members: 'Alice, Bob, Alice',
    }, catalog);

    expect(parsed).toEqual({
      name: 'Deep research',
      overrides: {
        category: 'Research',
        tags: ['current', 'sources'],
        context: {
          source: 'template',
          text: 'Template context',
          templateId: 'template-1',
        },
        tools: ['web_search_preview', 'custom_tool'],
        model: 'gpt-deep',
        maxMessages: 42,
        reasoning: 'max',
        mode: 'pro',
        verbosity: 'high',
        members: ['Alice', 'Bob'],
      },
    });
  });

  test('omits ignored fields while retaining explicit empty list and text overrides', () => {
    const parsed = parseQuickSettingForm({
      name: 'Clear optional settings',
      category_mode: 'ignore',
      tags_mode: 'override',
      tags: '',
      context_mode: 'text',
      context_text: '',
      tools_mode: 'override',
      members_mode: 'override',
      members: '',
      model_mode: 'ignore',
    }, catalog);

    expect(parsed.overrides).toEqual({
      tags: [],
      context: { source: 'text', text: '', templateId: null },
      tools: [],
      members: [],
    });
    expect(parsed.overrides).not.toHaveProperty('category');
    expect(parsed.overrides).not.toHaveProperty('model');
  });

  test.each([
    [{ name: '', context_mode: 'ignore' }, 'name'],
    [{ name: 'Invalid max', maxMessages_mode: 'override', maxMessages: '0' }, 'positive'],
    [{ name: 'Invalid model', model_mode: 'override', model: 'missing' }, 'existing model'],
    [{ name: 'Invalid tool', tools_mode: 'override', tools: 'missing' }, 'not available'],
    [{ name: 'Invalid template', context_mode: 'template', context_template_id: 'missing' }, 'existing context template'],
  ])('rejects invalid form values', (body, messagePart) => {
    expect(() => parseQuickSettingForm(body, catalog)).toThrow(Chat5QuickSettingValidationError);
    expect(() => parseQuickSettingForm(body, catalog)).toThrow(expect.objectContaining({
      message: expect.stringContaining(messagePart),
    }));
  });

  test('serializes sparse overrides and resolves the latest template text', () => {
    const setting = {
      _id: 'quick-1',
      name: 'Template preset',
      overrides: {
        category: 'Work',
        tools: [],
        context: {
          source: 'template',
          text: 'Old template text',
          templateId: 'template-1',
        },
      },
    };

    expect(serializeQuickSetting(setting, [{
      _id: 'template-1',
      TemplateText: 'Latest template text',
    }])).toEqual({
      _id: 'quick-1',
      name: 'Template preset',
      overrides: {
        category: 'Work',
        tools: [],
        context: 'Latest template text',
      },
    });
  });

  test('scopes list, update, and delete operations to the authenticated user', async () => {
    const document = {
      name: 'Old',
      overrides: {},
      save: jest.fn().mockResolvedValue(undefined),
    };
    const listQuery = createQuery([{ _id: 'quick-1' }]);
    const model = jest.fn();
    model.find = jest.fn().mockReturnValue(listQuery);
    model.findOne = jest.fn().mockResolvedValue(document);
    model.findOneAndDelete = jest.fn().mockResolvedValue(document);
    const service = new Chat5QuickSettingService(model);

    await expect(service.listForUser('Alice')).resolves.toEqual([{ _id: 'quick-1' }]);
    await service.updateForUser('Alice', 'quick-1', { name: 'New', overrides: { model: 'gpt-fast' } });
    await service.deleteForUser('Alice', 'quick-1');

    expect(model.find).toHaveBeenCalledWith({ user: 'Alice' });
    expect(listQuery.sort).toHaveBeenCalledWith({ name: 1, createdAt: 1 });
    expect(model.findOne).toHaveBeenCalledWith({ _id: 'quick-1', user: 'Alice' });
    expect(model.findOneAndDelete).toHaveBeenCalledWith({ _id: 'quick-1', user: 'Alice' });
    expect(document).toMatchObject({
      name: 'New',
      overrides: { model: 'gpt-fast' },
    });
    expect(document.save).toHaveBeenCalledTimes(1);
  });
});
