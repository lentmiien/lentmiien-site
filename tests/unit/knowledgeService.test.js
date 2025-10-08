jest.mock('marked', () => ({ parse: jest.fn() }));

const marked = require('marked');
const KnowledgeService = require('../../services/knowledgeService');

const createQueryChain = (items) => {
  const exec = jest.fn().mockResolvedValue(items);
  const sort = jest.fn().mockReturnValue({ exec });
  return { sort, exec };
};

describe('KnowledgeService', () => {
  let knowledgeModel;
  let service;

  beforeEach(() => {
    marked.parse.mockReset();
    marked.parse.mockImplementation((text) => `parsed:${text}`);

    knowledgeModel = jest.fn().mockImplementation((doc) => ({
      ...doc,
      save: jest.fn().mockResolvedValue({
        _id: { toString: () => 'created-id' }
      })
    }));

    knowledgeModel.findById = jest.fn();
    knowledgeModel.find = jest.fn();
    knowledgeModel.deleteOne = jest.fn();

    service = new KnowledgeService(knowledgeModel);
  });

  test('getKnowledgesById defaults originType and parses markdown', async () => {
    const doc = {
      _id: 'knowledge-1',
      contentMarkdown: '# Heading'
    };
    knowledgeModel.findById.mockResolvedValue(doc);

    const result = await service.getKnowledgesById('knowledge-1');

    expect(knowledgeModel.findById).toHaveBeenCalledWith('knowledge-1');
    expect(marked.parse).toHaveBeenCalledWith('# Heading');
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
      _id: { toString: () => 'new-id' }
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
  });

  test('updateKnowledge mutates fields and saves entry', async () => {
    const save = jest.fn().mockResolvedValue();
    const doc = {
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
  });

  test('deleteKnovledgeById delegates to deleteOne', async () => {
    knowledgeModel.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const result = await service.deleteKnovledgeById('k-9');

    expect(knowledgeModel.deleteOne).toHaveBeenCalledWith({ _id: 'k-9' });
    expect(result).toEqual({ deletedCount: 1 });
  });
});
