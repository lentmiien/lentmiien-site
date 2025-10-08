const path = require('path');

jest.mock('fs', () => ({
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
  mkdirSync: jest.fn(),
  unlinkSync: jest.fn()
}));

jest.mock('sharp', () =>
  jest.fn(() => ({
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    webp: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('')),
    toFile: jest.fn().mockResolvedValue(),
    composite: jest.fn().mockReturnThis()
  }))
);

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

jest.mock('../../database', () => ({
  Conversation5Model: {},
  PendingRequests: {}
}));

const ConversationService = require('../../services/conversationService');

const createConversationModel = () => {
  const modelFn = jest.fn(function conversationCtor(doc) {
    this.doc = doc;
    this.save = jest.fn().mockResolvedValue({
      _id: { toString: () => 'conv-id' },
      ...doc
    });
    return this;
  });
  modelFn.find = jest.fn();
  modelFn.findById = jest.fn();
  return modelFn;
};

const createMessageDoc = ({ prompt = 'Hello', response = 'Hi', images = [], prompt_html = '<p>Hello</p>', response_html = '<p>Hi</p>' } = {}) => ({
  prompt,
  response,
  images,
  prompt_html,
  response_html
});

describe('ConversationService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getCategories caches unique sorted categories', async () => {
    const conversations = [
      { category: 'Work' },
      { category: 'personal' },
      { category: 'Work' }
    ];
    const conversationModel = createConversationModel();
    conversationModel.find.mockResolvedValue(conversations);

    const service = new ConversationService(conversationModel, {}, {});
    const first = await service.getCategories();
    const second = await service.getCategories();

    expect(first).toEqual(['Work', 'personal']);
    expect(second).toBe(first);
    expect(conversationModel.find).toHaveBeenCalledTimes(1);
  });

  test('getTags generates unique sorted tag list', async () => {
    const conversations = [
      { tags: ['alpha', 'beta'] },
      { tags: ['beta', 'gamma'] },
      { tags: null }
    ];
    const conversationModel = createConversationModel();
    conversationModel.find.mockResolvedValue(conversations);

    const service = new ConversationService(conversationModel, {}, {});
    const tags = await service.getTags();

    expect(tags).toEqual(['alpha', 'beta', 'gamma']);
    expect(conversationModel.find).toHaveBeenCalledTimes(1);
  });

  test('getInRange returns formatted conversations with messages in date range', async () => {
    const inRangeConv = {
      _id: { toString: () => 'conv-1' },
      title: 'Topic',
      category: 'Chat',
      tags: ['tag'],
      messages: ['msg-1'],
      updated_date: new Date('2024-05-05T12:00:00Z')
    };
    const outOfRangeConv = {
      _id: { toString: () => 'conv-2' },
      title: 'Old',
      category: 'Chat',
      tags: [],
      messages: ['msg-2'],
      updated_date: new Date('2024-04-01T00:00:00Z')
    };

    const conversationModel = createConversationModel();
    conversationModel.find.mockImplementation((query) => {
      if (query && query.user_id) {
        return {
          sort: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([inRangeConv, outOfRangeConv])
          })
        };
      }
      return Promise.resolve([]);
    });

    const messageService = {
      getMessagesByIdArray: jest.fn().mockResolvedValue([
        createMessageDoc({
          prompt: 'Request',
          response: 'Answer',
          prompt_html: '<p>Request</p>',
          response_html: '<p>Answer</p>',
          images: [{ filename: 'img1.png', use_flag: 'high quality' }]
        })
      ])
    };

    const service = new ConversationService(conversationModel, messageService, {});
    const result = await service.getInRange('user-1', '2024-05-01', '2024-05-31');

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      _id: 'conv-1',
      title: 'Topic',
      category: 'Chat'
    });
    expect(result[0].messages).toHaveLength(2);
    expect(result[0].messages[0]).toEqual({
      role: 'user',
      text: 'Request',
      html: '<p>Request</p>',
      images: ['img1.png']
    });
    expect(messageService.getMessagesByIdArray).toHaveBeenCalledWith(['msg-1']);
  });

  test('createConversationFromMessagesArray saves conversation with generated messages', async () => {
    const conversationModel = createConversationModel();
    const savedEntries = [];
    conversationModel.mockImplementation(function (doc) {
      savedEntries.push(doc);
      this.save = jest.fn().mockResolvedValue({
        _id: { toString: () => 'conv-xyz' },
        ...doc
      });
      return this;
    });

    let messageCounter = 0;
    const messageService = {
      CreateCustomMessage: jest.fn().mockImplementation(() => {
        messageCounter += 1;
        return Promise.resolve({
          db_entry: {
            _id: { toString: () => `msg-${messageCounter}` }
          }
        });
      })
    };

    const service = new ConversationService(conversationModel, messageService, {});
    const messagesArray = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello there' },
      { role: 'user', content: 'How are you?' },
      { role: 'assistant', content: 'Great!' }
    ];

    const id = await service.createConversationFromMessagesArray(
      'user-9',
      'Greetings',
      messagesArray,
      'Context',
      'model-x',
      'Chat',
      'tag1'
    );

    expect(id).toBe('conv-xyz');
    expect(messageService.CreateCustomMessage).toHaveBeenCalledTimes(2);
    expect(savedEntries[0]).toMatchObject({
      user_id: 'user-9',
      title: 'Greetings',
      category: 'Chat',
      tags: ['tag1'],
      context_prompt: 'Context',
      default_model: 'model-x'
    });
    expect(savedEntries[0].messages).toEqual(['msg-1', 'msg-2']);
  });

  test('generateMessageArrayForConversation builds context with knowledge and prior messages', async () => {
    const conversationModel = createConversationModel();
    const conversationDoc = {
      _id: 'conv-knowledge',
      context_prompt: 'Base context',
      knowledge_injects: [{ knowledge_id: 'k1', use_type: 'context' }],
      messages: ['m1'],
      max_messages: 0
    };
    conversationModel.findById.mockResolvedValue(conversationDoc);

    const knowledgeService = {
      getKnowledgesByIdArray: jest.fn().mockResolvedValue([
        {
          _id: { toString: () => 'k1' },
          title: 'Guide',
          contentMarkdown: 'Helpful text'
        }
      ])
    };

    const messageService = {
      getMessagesByIdArray: jest.fn().mockResolvedValue([
        {
          prompt: 'User question',
          response: 'Assistant reply',
          images: []
        }
      ])
    };

    const service = new ConversationService(conversationModel, messageService, knowledgeService);
    const messages = await service.generateMessageArrayForConversation('conv-knowledge');

    expect(messages[0]).toEqual({
      role: 'system',
      content: [
        expect.objectContaining({
          text: expect.stringContaining('Base context')
        })
      ]
    });
    expect(messages[1]).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'User question' }
      ]
    });
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Assistant reply' }
      ]
    });
    expect(knowledgeService.getKnowledgesByIdArray).toHaveBeenCalledWith(['k1']);
  });
});
