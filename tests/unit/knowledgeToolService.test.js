const KnowledgeToolService = require('../../services/knowledgeToolService');

describe('KnowledgeToolService', () => {
  test('creates a chat5 knowledge entry with normalized tool arguments', async () => {
    const knowledgeService = {
      createKnowledge: jest.fn().mockResolvedValue('knowledge-123'),
    };
    const service = new KnowledgeToolService({ knowledgeService });

    const result = await service.createKnowledge({
      title: '  Useful   note  ',
      contentMarkdown: '\n# Heading\n\nBody\n',
      category: '  Coding  ',
      tags: ['JavaScript Tips', 'javascript_tips', ' Node ', ''],
      images: [
        '/img/example.png',
        'https://home.lentmiien.com/img/photo.webp',
        '',
      ],
    }, {
      conversationId: 'conversation-456',
    });

    expect(knowledgeService.createKnowledge).toHaveBeenCalledWith(
      'Useful note',
      'conversation-456',
      '# Heading\n\nBody',
      'Coding',
      ['javascript_tips', 'node'],
      ['example.png', 'photo.webp'],
      'Lennart',
      'chat5'
    );
    expect(result).toEqual({
      ok: true,
      knowledgeId: 'knowledge-123',
      userId: 'Lennart',
      originConversationId: 'conversation-456',
      originType: 'chat5',
      title: 'Useful note',
      category: 'Coding',
      tags: ['javascript_tips', 'node'],
      images: ['example.png', 'photo.webp'],
      viewPath: '/chat4/viewknowledge/knowledge-123',
    });
  });

  test('defaults unknown origin to none', async () => {
    const knowledgeService = {
      createKnowledge: jest.fn().mockResolvedValue('knowledge-123'),
    };
    const service = new KnowledgeToolService({ knowledgeService });

    await service.createKnowledge({
      title: 'Note',
      contentMarkdown: 'Body',
      category: 'General',
      tags: [],
    });

    expect(knowledgeService.createKnowledge).toHaveBeenCalledWith(
      'Note',
      'none',
      'Body',
      'General',
      [],
      [],
      'Lennart',
      'chat5'
    );
  });

  test('rejects missing required fields', async () => {
    const knowledgeService = {
      createKnowledge: jest.fn(),
    };
    const service = new KnowledgeToolService({ knowledgeService });

    await expect(service.createKnowledge({
      title: 'Note',
      contentMarkdown: '',
      category: 'General',
      tags: [],
    })).rejects.toMatchObject({
      message: 'contentMarkdown is required.',
      status: 400,
    });
    expect(knowledgeService.createKnowledge).not.toHaveBeenCalled();
  });
});
