jest.mock('../../utils/chat5Markdown', () => ({ renderMarkdownSafe: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));

const { renderMarkdownSafe } = require('../../utils/chat5Markdown');
const KnowledgeService = require('../../services/knowledgeService');

const createQueryChain = (items) => {
  const exec = jest.fn().mockResolvedValue(items);
  const sort = jest.fn().mockReturnValue({ exec });
  return { sort, exec };
};

describe('KnowledgeService', () => {
  let knowledgeModel;
  let service;
  let queue;

  beforeEach(() => {
    renderMarkdownSafe.mockReset();
    renderMarkdownSafe.mockImplementation((text) => `parsed:${text}`);

    knowledgeModel = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn().mockResolvedValue({
        _id: { toString: () => 'created-id' }
      })
    }));

    knowledgeModel.findById = jest.fn();
    knowledgeModel.find = jest.fn();
    knowledgeModel.deleteOne = jest.fn();

    queue = { enqueueKnowledge: jest.fn(), enqueueKnowledgeDeletion: jest.fn() };
    service = new KnowledgeService(knowledgeModel, queue);
  });

  test('getKnowledgesById defaults originType and parses markdown', async () => {
    const doc = {
      _id: 'knowledge-1',
      contentMarkdown: '# Heading'
    };
    knowledgeModel.findById.mockResolvedValue(doc);

    const result = await service.getKnowledgesById('knowledge-1');

    expect(knowledgeModel.findById).toHaveBeenCalledWith('knowledge-1');
    expect(renderMarkdownSafe).toHaveBeenCalledWith('# Heading');
    expect(result.originType).toBe('chat4');
    expect(result.contentHTML).toBe('parsed:# Heading');
  });

  test('getKnowledgesByUser sorts by update date and fills originType', async () => {
    const docs = [
      { originType: 'chat5' },
      { originType: undefined }
    ];
    const chain = createQueryChain(docs);
    knowledgeModel.find.mockReturnValue({ sort: chain.sort });

    const result = await service.getKnowledgesByUser('user-1');

    expect(knowledgeModel.find).toHaveBeenCalledWith({ user_id: 'user-1' });
    expect(chain.sort).toHaveBeenCalledWith({ updatedDate: -1 });
    expect(chain.exec).toHaveBeenCalledTimes(1);
    expect(result[0].originType).toBe('chat5');
    expect(result[1].originType).toBe('chat4');
  });

  test('getKnowledgesByIdArray delegates to find', async () => {
    const docs = [{ _id: 'k1' }];
    knowledgeModel.find.mockResolvedValue(docs);

    const result = await service.getKnowledgesByIdArray(['k1', 'k2']);

    expect(knowledgeModel.find).toHaveBeenCalledWith({ _id: ['k1', 'k2'] });
    expect(result).toBe(docs);
  });

  test('getKnowledgesByCategory filters by category', async () => {
    const docs = [{ category: 'recipes' }];
    knowledgeModel.find.mockResolvedValue(docs);

    const result = await service.getKnowledgesByCategory('recipes');

    expect(knowledgeModel.find).toHaveBeenCalledWith({ category: 'recipes' });
    expect(result).toBe(docs);
  });

  test('createKnowledge saves new record and returns id', async () => {
    const saveResult = {
      _id: { toString: () => 'new-id' },
      title: 'Title',
      originConversationId: 'conversation-1',
      originType: 'chat6',
      contentMarkdown: 'markdown',
      category: 'category',
      tags: ['tag'],
      images: ['image'],
      user_id: 'user-2',
    };
    const saveFn = jest.fn().mockResolvedValue(saveResult);
    knowledgeModel.mockImplementationOnce((doc) => ({
      ...doc,
      save: saveFn
    }));

    const id = await service.createKnowledge(
      'Title',
      'conversation-1',
      'markdown',
      'category',
      ['tag'],
      ['image'],
      'user-2',
      'chat6'
    );

    expect(knowledgeModel).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Title',
      originConversationId: 'conversation-1',
      contentMarkdown: 'markdown',
      category: 'category',
      tags: ['tag'],
      images: ['image'],
      user_id: 'user-2',
      originType: 'chat6'
    }));
    expect(saveFn).toHaveBeenCalledTimes(1);
    expect(id).toBe('new-id');
    expect(knowledgeModel.mock.calls[0][0].pendingEmbeddingModes).toEqual(['default', 'high_quality']);
    expect(queue.enqueueKnowledge).toHaveBeenCalledWith(saveResult);
  });

  test('updateKnowledge mutates fields and saves entry', async () => {
    const save = jest.fn().mockResolvedValue();
    const doc = {
      _id: 'k-123', markModified: jest.fn(),
      title: 'Old Title',
      contentMarkdown: 'old',
      category: 'old',
      tags: [],
      images: [],
      save
    };
    knowledgeModel.findById.mockResolvedValue(doc);

    const result = await service.updateKnowledge(
      'k-123',
      'New Title',
      'new content',
      'new category',
      ['tag1'],
      ['image1']
    );

    expect(knowledgeModel.findById).toHaveBeenCalledWith('k-123');
    expect(doc.title).toBe('New Title');
    expect(doc.contentMarkdown).toBe('new content');
    expect(doc.category).toBe('new category');
    expect(doc.tags).toEqual(['tag1']);
    expect(doc.images).toEqual(['image1']);
    expect(doc.updatedDate).toBeInstanceOf(Date);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toBe('k-123');
    expect(doc.pendingEmbeddingModes).toEqual(['default', 'high_quality']);
    expect(queue.enqueueKnowledge).toHaveBeenCalledWith(doc);
  });

  test('embedAllKnowledges reports accepted jobs and logs failures without the entry title or user', async () => {
    const docs = [
      {
        _id: 'id-1',
        title: 'First',
        contentMarkdown: 'body1',
        category: 'cat',
        tags: ['tag'],
        originConversationId: 'conv-1',
        user_id: 'user-1',
      },
      {
        _id: 'id-2',
        title: 'Second',
        contentMarkdown: 'body2',
        category: 'cat',
        tags: [],
        originConversationId: 'conv-2',
        user_id: 'user-1',
      },
    ];
    const chain = createQueryChain(docs);
    knowledgeModel.find.mockReturnValue({ sort: chain.sort });
    queue.enqueueKnowledge
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('hq fail'));

    const summary = await service.embedAllKnowledges('user-1');

    expect(knowledgeModel.find).toHaveBeenCalledWith({ user_id: 'user-1' });
    expect(summary.totalCount).toBe(2);
    expect(summary.queuedCount).toBe(1);
    expect(summary.failed).toHaveLength(1);
    expect(summary.failed[0]).toEqual(expect.objectContaining({
      knowledgeId: 'id-2',
      title: 'Second',
    }));
    expect(queue.enqueueKnowledge).toHaveBeenCalledWith(docs[0], { force: true });
    expect(queue.enqueueKnowledge).toHaveBeenCalledTimes(2);
    const logs = JSON.stringify(require('../../utils/logger').error.mock.calls);
    expect(logs).not.toMatch(/Second|user-1|hq fail/);
  });

  test('a saved entry remains repairable if dispatch fails before either job is acknowledged', async () => {
    queue.enqueueKnowledge.mockRejectedValue(new Error('PRIVATE entry'));
    await expect(service.createKnowledge('PRIVATE title', '', 'PRIVATE body', 'manual', [], [], 'PRIVATE user'))
      .resolves.toBe('created-id');
    expect(knowledgeModel.mock.calls[0][0].pendingEmbeddingModes).toEqual(['default', 'high_quality']);
    expect(JSON.stringify(require('../../utils/logger').warning.mock.calls)).not.toContain('PRIVATE');
  });

  test('deleteKnovledgeById delegates to deleteOne', async () => {
    knowledgeModel.findById.mockResolvedValue({ _id: 'k-9' });
    knowledgeModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const result = await service.deleteKnovledgeById('k-9');

    expect(queue.enqueueKnowledgeDeletion).toHaveBeenCalledWith({ _id: 'k-9' });
    expect(knowledgeModel.deleteOne).toHaveBeenCalledWith({ _id: 'k-9' });
    expect(result).toEqual({ deletedCount: 1 });
  });
});
