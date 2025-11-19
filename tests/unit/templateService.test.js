jest.mock('../../utils/logger', () => ({
  warning: jest.fn(),
  notice: jest.fn(),
  error: jest.fn(),
}));

const logger = require('../../utils/logger');
const TemplateService = require('../../services/templateService');

const createTemplateModel = () => {
  const TemplateModel = jest.fn(function templateCtor(doc) {
    this.doc = doc;
    this.save = jest.fn().mockResolvedValue({
      _id: 'generated-id',
      ...doc,
    });
    return this;
  });
  TemplateModel.find = jest.fn();
  TemplateModel.deleteOne = jest.fn();
  return TemplateModel;
};

const createChat5TemplateModel = () => {
  const Chat5Model = jest.fn(function chat5Ctor(doc = {}) {
    Object.assign(this, doc);
    this.save = jest.fn().mockResolvedValue(this);
    return this;
  });
  Chat5Model.find = jest.fn();
  Chat5Model.findOne = jest.fn();
  Chat5Model.exists = jest.fn();
  Chat5Model.deleteOne = jest.fn();
  return Chat5Model;
};

describe('TemplateService legacy templates', () => {
  let TemplateModel;
  let templateService;

  beforeEach(() => {
    TemplateModel = createTemplateModel();
    templateService = new TemplateService(TemplateModel);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getTemplates returns all templates', async () => {
    const fakeTemplates = [{ Title: 'Welcome' }, { Title: 'Reminder' }];
    TemplateModel.find.mockResolvedValue(fakeTemplates);

    const result = await templateService.getTemplates();

    expect(TemplateModel.find).toHaveBeenCalledWith();
    expect(result).toEqual(fakeTemplates);
  });

  test('getTemplatesByIdArray queries with ids', async () => {
    const ids = ['abc', 'def'];
    const fakeTemplates = [{ _id: 'abc' }];
    TemplateModel.find.mockResolvedValue(fakeTemplates);

    const result = await templateService.getTemplatesByIdArray(ids);

    expect(TemplateModel.find).toHaveBeenCalledWith({ _id: ids });
    expect(result).toEqual(fakeTemplates);
  });

  test('createTemplate saves a new template', async () => {
    const result = await templateService.createTemplate(
      'Title',
      'Type',
      'Category',
      'Body'
    );

    expect(TemplateModel).toHaveBeenCalledWith({
      Title: 'Title',
      Type: 'Type',
      Category: 'Category',
      TemplateText: 'Body',
    });

    const createdInstance = TemplateModel.mock.results[0].value;
    expect(createdInstance.save).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      _id: 'generated-id',
      Title: 'Title',
      Type: 'Type',
      Category: 'Category',
      TemplateText: 'Body',
    });
  });

  test('updateTemplate mutates and saves the template entry', async () => {
    const templateDoc = {
      Title: 'Old',
      Type: 'Old',
      Category: 'Old',
      TemplateText: 'Old',
      save: jest.fn().mockResolvedValue(),
    };
    TemplateModel.find.mockResolvedValue([templateDoc]);

    const result = await templateService.updateTemplate(
      'template-id',
      'New Title',
      'New Type',
      'New Category',
      'New Text'
    );

    expect(TemplateModel.find).toHaveBeenCalledWith({ _id: 'template-id' });
    expect(templateDoc).toMatchObject({
      Title: 'New Title',
      Type: 'New Type',
      Category: 'New Category',
      TemplateText: 'New Text',
    });
    expect(templateDoc.save).toHaveBeenCalledTimes(1);
    expect(result).toBe(templateDoc);
  });

  test('deleteTemplateById removes template', async () => {
    TemplateModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

    await templateService.deleteTemplateById('template-id');

    expect(TemplateModel.deleteOne).toHaveBeenCalledWith({ _id: 'template-id' });
  });
});

describe('TemplateService chat5 templates', () => {
  let TemplateModel;
  let Chat5TemplateModel;
  let conversationService;
  let templateService;

  beforeEach(() => {
    TemplateModel = createTemplateModel();
    Chat5TemplateModel = createChat5TemplateModel();
    conversationService = {
      loadConversation: jest.fn(),
    };
    templateService = new TemplateService(TemplateModel, {
      chat5TemplateModel: Chat5TemplateModel,
      conversationService,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('addChat5Template caches snapshot and returns clones', async () => {
    conversationService.loadConversation.mockResolvedValue({
      conv: { _id: 'conv-1', title: 'Thread' },
      msg: [{ text: 'Hello' }],
      source: 'conversation5',
    });
    Chat5TemplateModel.findOne.mockResolvedValue(null);

    const result = await templateService.addChat5Template('abc123', { refresh: true });

    expect(conversationService.loadConversation).toHaveBeenCalledWith('abc123');
    expect(Chat5TemplateModel).toHaveBeenCalledWith({ conversationId: 'abc123' });
    expect(result.record.conversationId).toBe('abc123');
    expect(result.template).toMatchObject({
      conversation: { _id: 'conv-1', title: 'Thread' },
      messages: [{ text: 'Hello' }],
      source: 'chat5',
    });
    const isTemplate = await templateService.isChat5Template('abc123');
    expect(isTemplate).toBe(true);
    expect(Chat5TemplateModel.exists).not.toHaveBeenCalled();
  });

  test('getChat5Template returns deep clones and maps sources', async () => {
    const record = {
      conversationId: 'abc',
      save: jest.fn().mockResolvedValue(),
    };
    Chat5TemplateModel.findOne.mockResolvedValue(record);
    conversationService.loadConversation.mockResolvedValue({
      conv: { _id: 'conv-2', metadata: { nested: true } },
      msg: [{ text: 'Hi' }],
      source: 'conversation4',
    });

    const first = await templateService.getChat5Template('abc');
    first.messages[0].text = 'mutated';

    const second = await templateService.getChat5Template('abc');

    expect(second.messages[0].text).toBe('Hi');
    expect(record.source).toBe('chat4');
    expect(conversationService.loadConversation).toHaveBeenCalledTimes(1);
  });

  test('fetchChat5Templates refreshes each id', async () => {
    const lean = jest.fn().mockResolvedValue([
      { conversationId: 'one' },
      { conversationId: 'two' },
    ]);
    const sort = jest.fn().mockReturnValue({ lean });
    Chat5TemplateModel.find.mockReturnValue({ sort });
    const loadSpy = jest.spyOn(templateService, '_loadChat5Template')
      .mockImplementation(async (id) => ({ conversation: { id }, messages: [{ text: id }] }));

    const results = await templateService.fetchChat5Templates({ refresh: true });

    expect(loadSpy).toHaveBeenCalledWith('one', { forceRefresh: true });
    expect(loadSpy).toHaveBeenCalledWith('two', { forceRefresh: true });
    expect(results).toEqual([
      { conversationId: 'one', conversation: { id: 'one' }, messages: [{ text: 'one' }] },
      { conversationId: 'two', conversation: { id: 'two' }, messages: [{ text: 'two' }] },
    ]);

    loadSpy.mockRestore();
  });

  test('_fetchConversationSnapshot logs and rethrows errors', async () => {
    conversationService.loadConversation.mockRejectedValue(new Error('offline'));
    await expect(templateService._fetchConversationSnapshot('abc')).rejects.toThrow('offline');
    expect(logger.warning).toHaveBeenCalledWith(
      'Failed to fetch conversation snapshot for template',
      expect.objectContaining({ conversationId: 'abc', error: 'offline' })
    );
  });

  test('_normalizeId trims whitespace and rejects blanks', () => {
    expect(templateService._normalizeId('  conv   ')).toBe('conv');
    expect(templateService._normalizeId('   ')).toBeNull();
    expect(templateService._normalizeId(null)).toBeNull();
  });

  test('_ensureChat5Support throws when dependencies missing', () => {
    const legacyService = new TemplateService(TemplateModel);
    expect(() => legacyService._ensureChat5Support()).toThrow('not configured');
  });

  test('addChat5Template without refresh clears cache entry', async () => {
    conversationService.loadConversation.mockResolvedValue({
      conv: { _id: 'conv-3' },
      msg: [],
      source: 'conversation5',
    });
    const record = {
      conversationId: 'conv-3',
      save: jest.fn().mockResolvedValue(),
    };
    Chat5TemplateModel.findOne.mockResolvedValue(record);

    const result = await templateService.addChat5Template('conv-3', { refresh: false });

    expect(result.template).toBeNull();
    expect(templateService.chat5TemplateCache.has('conv-3')).toBe(false);
  });

  test('removeChat5Template deletes from cache and db', async () => {
    Chat5TemplateModel.deleteOne.mockResolvedValue({ deletedCount: 1 });
    const miss = await templateService.removeChat5Template('  ');
    expect(miss.deletedCount).toBe(0);
    const hit = await templateService.removeChat5Template('conv-7');
    expect(hit).toEqual({ deletedCount: 1 });
    expect(Chat5TemplateModel.deleteOne).toHaveBeenCalledWith({ conversationId: 'conv-7' });
  });

  test('isChat5Template consults db when cache is cold', async () => {
    Chat5TemplateModel.exists.mockResolvedValue({ _id: 'conv-9' });
    const result = await templateService.isChat5Template('conv-9');
    expect(result).toBe(true);
    Chat5TemplateModel.exists.mockResolvedValue(null);
    const missing = await templateService.isChat5Template('conv-10');
    expect(missing).toBe(false);
  });

  test('refresh helpers force reload via _loadChat5Template', async () => {
    const loadSpy = jest.spyOn(templateService, '_loadChat5Template').mockResolvedValue({ messages: [], conversation: {} });
    await templateService.refreshChat5Template('conv-11');
    expect(loadSpy).toHaveBeenCalledWith('conv-11', { forceRefresh: true });
    jest.spyOn(templateService, 'listChat5TemplateIds').mockResolvedValue(['one', 'two']);
    const refreshed = await templateService.refreshAllChat5Templates();
    expect(refreshed).toHaveLength(2);
    loadSpy.mockRestore();
  });

  test('_cloneCachedTemplate falls back when structuredClone unavailable', () => {
    const original = global.structuredClone;
    global.structuredClone = undefined;
    try {
      const template = {
        fetchedAt: new Date(),
        messages: [{ at: new Date() }],
      };
      const cloned = templateService._cloneCachedTemplate(template);
      expect(cloned).not.toBe(template);
      expect(cloned.fetchedAt).not.toBe(template.fetchedAt);
      expect(cloned.messages[0]).not.toBe(template.messages[0]);
    } finally {
      global.structuredClone = original;
    }
  });
});
