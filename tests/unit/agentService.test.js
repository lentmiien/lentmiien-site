jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  notice: jest.fn(),
  info: jest.fn(),
  warn: jest.fn()
}));

const AgentService = require('../../services/agentService');

const createAgentModel = () => {
  const model = jest.fn(function agentCtor(doc) {
    this.doc = doc;
    this.save = jest.fn().mockResolvedValue({ _id: 'agent-id', ...doc });
    return this;
  });
  model.find = jest.fn();
  model.findById = jest.fn();
  return model;
};

describe('AgentService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('getAgentAll and getAgent delegate to model', async () => {
    const agentModel = createAgentModel();
    agentModel.find.mockResolvedValue([{ name: 'Bot' }]);
    agentModel.findById.mockResolvedValue({ name: 'Bot' });

    const service = new AgentService(agentModel, {}, {});
    expect(await service.getAgentAll()).toEqual([{ name: 'Bot' }]);
    expect(await service.getAgent('id-1')).toEqual({ name: 'Bot' });
    expect(agentModel.find).toHaveBeenCalledTimes(1);
    expect(agentModel.findById).toHaveBeenCalledWith('id-1');
  });

  test('createAgent persists and returns saved entry', async () => {
    const agentModel = createAgentModel();
    agentModel.mockImplementation(function (doc) {
      this.save = jest.fn().mockResolvedValue({ _id: 'agent-123', ...doc });
      return this;
    });

    const service = new AgentService(agentModel, {}, {});
    const response = await service.createAgent('Name', 'Desc', 'Context', 'Memory');

    expect(agentModel).toHaveBeenCalledWith({
      name: 'Name',
      description: 'Desc',
      context: 'Context',
      memory: 'Memory'
    });
    expect(response.db_entry).toEqual({
      _id: 'agent-123',
      name: 'Name',
      description: 'Desc',
      context: 'Context',
      memory: 'Memory'
    });
  });

  test('teachAgent builds memory prompt, calls message service, and updates agent memory', async () => {
    const agent = {
      context: 'Assist with tasks',
      memory: 'Previous notes',
      save: jest.fn().mockResolvedValue()
    };
    const agentModel = createAgentModel();
    agentModel.findById.mockResolvedValue(agent);

    const createdMessage = {
      db_entry: { response: 'Updated memory' }
    };
    const messageService = {
      createMessage: jest.fn().mockResolvedValue(createdMessage)
    };

    const service = new AgentService(agentModel, {}, messageService);
    const response = await service.teachAgent(
      'agent-1',
      [
        { role: 'user', content: [{ type: 'text', text: 'Fact one' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'Acknowledged' }] }
      ],
      'user-id',
      'agent-cat'
    );

    expect(messageService.createMessage).toHaveBeenCalledTimes(1);
    const callArgs = messageService.createMessage.mock.calls[0];
    expect(callArgs[1][0]).toMatchObject({
      role: 'system'
    });
    expect(agent.memory).toBe('Updated memory');
    expect(agent.save).toHaveBeenCalledTimes(1);
    expect(response).toBe('Updated memory');
  });

  test('askAgent composes context with memory, queries message service, and appends to conversation', async () => {
    const agent = {
      context: 'Be helpful',
      memory: 'Earlier notes',
      save: jest.fn()
    };
    const agentModel = createAgentModel();
    agentModel.findById.mockResolvedValue(agent);

    const messageResponse = {
      db_entry: {
        _id: 'message-id',
        response: 'Agent reply'
      }
    };

    const messageService = {
      createMessage: jest.fn().mockResolvedValue(messageResponse)
    };
    const conversationService = {
      appendMessageToConversation: jest.fn().mockResolvedValue()
    };

    const service = new AgentService(agentModel, conversationService, messageService);
    const reply = await service.askAgent(
      'conv-1',
      'agent-1',
      [{ role: 'user', content: [{ type: 'text', text: 'Question' }] }],
      'user-id',
      'agent-cat'
    );

    expect(messageService.createMessage).toHaveBeenCalledTimes(1);
    expect(conversationService.appendMessageToConversation)
      .toHaveBeenCalledWith('conv-1', 'message-id');
    expect(reply).toBe('Agent reply');
  });

  test('queryAgent passes parameters to conversation service', async () => {
    const agentModel = createAgentModel();
    agentModel.findById.mockResolvedValue({
      memory: 'Knowledge'
    });

    const conversationService = {
      postToConversation: jest.fn().mockResolvedValue('conv-new')
    };

    const service = new AgentService(agentModel, conversationService, {});
    const id = await service.queryAgent(
      'agent-1',
      'Initial context',
      'What is the status?',
      'user-id',
      'tag',
      'Title',
      'Category'
    );

    expect(conversationService.postToConversation).toHaveBeenCalledWith(
      'user-id',
      'new',
      [],
      expect.objectContaining({
        context: expect.stringContaining('Initial context'),
        prompt: expect.stringContaining('What is the status?'),
        tags: 'tag',
        title: 'Title',
        category: 'Category'
      })
    );
    expect(id).toBe('conv-new');
  });
});
