jest.mock('../../models/codex_prompt_template', () => ({
  create: jest.fn(),
  deleteOne: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
}));

const CodexPromptTemplate = require('../../models/codex_prompt_template');
const codexToolService = require('../../services/codexToolService');

const user = { _id: 'user-1', name: 'Lennart' };

function createQuery(result) {
  const query = {
    sort: jest.fn(() => query),
    lean: jest.fn(() => query),
    exec: jest.fn().mockResolvedValue(result),
  };
  return query;
}

describe('codexToolService prompt templates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('lists only templates owned by the signed-in user', async () => {
    const query = createQuery([
      { _id: 'template-1', name: 'Review', description: 'Review changes', prompt: 'Review the pending changes.' },
    ]);
    CodexPromptTemplate.find.mockReturnValue(query);

    const templates = await codexToolService.listPromptTemplates(user);

    expect(CodexPromptTemplate.find).toHaveBeenCalledWith({ ownerId: 'user-1' });
    expect(query.sort).toHaveBeenCalledWith({ name: 1, createdAt: 1 });
    expect(templates).toEqual([
      expect.objectContaining({ id: 'template-1', name: 'Review', prompt: 'Review the pending changes.' }),
    ]);
  });

  test('creates a trimmed template for the signed-in user', async () => {
    CodexPromptTemplate.create.mockImplementation(async (payload) => ({
      _id: 'template-2',
      ...payload,
    }));

    const template = await codexToolService.createPromptTemplate({
      name: '  Implement  ',
      description: '  Apply a scoped change.  ',
      prompt: '  Implement the requested change.  ',
    }, user);

    expect(CodexPromptTemplate.create).toHaveBeenCalledWith({
      ownerId: 'user-1',
      name: 'Implement',
      description: 'Apply a scoped change.',
      prompt: 'Implement the requested change.',
      updatedBy: { id: 'user-1', name: 'Lennart' },
    });
    expect(template.id).toBe('template-2');
  });

  test('updates a template only through an owner-scoped lookup', async () => {
    const document = {
      _id: 'template-3',
      ownerId: 'user-1',
      name: 'Old name',
      description: '',
      prompt: 'Old prompt',
      save: jest.fn().mockResolvedValue(undefined),
    };
    CodexPromptTemplate.findOne.mockReturnValue(createQuery(document));

    const template = await codexToolService.updatePromptTemplate('template-3', {
      name: 'Updated name',
      description: 'Updated note',
      prompt: 'Updated prompt',
    }, user);

    expect(CodexPromptTemplate.findOne).toHaveBeenCalledWith({ _id: 'template-3', ownerId: 'user-1' });
    expect(document.save).toHaveBeenCalledTimes(1);
    expect(template).toEqual(expect.objectContaining({
      id: 'template-3',
      name: 'Updated name',
      description: 'Updated note',
      prompt: 'Updated prompt',
    }));
  });

  test('deletes a template only for its owner', async () => {
    CodexPromptTemplate.deleteOne.mockReturnValue(createQuery({ deletedCount: 1 }));

    const result = await codexToolService.deletePromptTemplate('template-4', user);

    expect(CodexPromptTemplate.deleteOne).toHaveBeenCalledWith({ _id: 'template-4', ownerId: 'user-1' });
    expect(result).toEqual({ deleted: true, templateId: 'template-4' });
  });

  test('requires an authenticated owner', async () => {
    await expect(codexToolService.listPromptTemplates()).rejects.toMatchObject({
      statusCode: 401,
      message: 'Authentication is required to access prompt templates.',
    });
    expect(CodexPromptTemplate.find).not.toHaveBeenCalled();
  });
});
