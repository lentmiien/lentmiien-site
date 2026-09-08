const { MiienChatService } = require('../../services/miienChatService');
const id = 'a'.repeat(24);
const user = { _id: 'b'.repeat(24), name: 'owner', type_user: 'admin' };
const requestId = '12345678-1234-1234-1234-123456789abc';
const settings = { model: 'catalog-model', context: 'Hello', title: 'Miien', maxMessages: 20, reasoning: 'medium', verbosity: 'low' };
function fixture() {
  const conversation = { _id: id, members: ['owner'], metadata: { model: 'catalog-model', maxMessages: 20, contextPrompt: 'Hi', outputFormat: 'text', tools: [] }, messages: [] };
  const conversations = { findOne: jest.fn().mockResolvedValue(conversation), findOneAndUpdate: jest.fn().mockResolvedValue(conversation), updateOne: jest.fn().mockResolvedValue({}) };
  const messages = { exists: jest.fn().mockResolvedValue(false) };
  const pending = { exists: jest.fn().mockResolvedValue(false), countDocuments: jest.fn().mockResolvedValue(0) };
  const conversationService = { createNewConversation: jest.fn().mockResolvedValue(conversation), postToConversationNew: jest.fn().mockResolvedValue({}) };
  const service = new MiienChatService({ conversations, messages, pending, conversationService, listModels: async () => [{api_model:'catalog-model',model_name:'Configured model',provider:'OpenAI'}] });
  return { service, conversation, conversations, messages, pending, conversationService };
}
test('creates through Chat5 with principal-derived membership and validated model', async () => {
  const f = fixture(); await f.service.create(user, settings);
  expect(f.conversationService.createNewConversation).toHaveBeenCalledWith('owner', expect.objectContaining({model:'catalog-model',tools:[]}), expect.objectContaining({members:['owner'],tags:['chat5','miien']}));
});
test.each([{model:'invented'}, {members:['intruder']}, {owner:'intruder'}, {tools:['execute']}, {maxMessages:999}, {maxMessages:true}, {context:'x'.repeat(4001)}, {reasoning:'unbounded'}, {title:[]}, {outputFormat:'json'}])('rejects invalid settings %p', async changes => {
  const f=fixture(); await expect(f.service.create(user,{...settings,...changes})).rejects.toHaveProperty('status',400);
  expect(f.conversationService.createNewConversation).not.toHaveBeenCalled();
});
test('foreign and missing conversations have identical scoped 404 behavior', async () => {
  const f=fixture();f.conversations.findOne.mockResolvedValue(null);
  await expect(f.service.owned(user,id)).rejects.toMatchObject({status:404,message:'Conversation not found.'});
  expect(f.conversations.findOne).toHaveBeenCalledWith({_id:id,members:{$all:['owner'],$size:1}});
  await expect(f.service.owned(user,'../../etc')).rejects.toHaveProperty('status',404);
});
test.each([{tools:['web_search_preview']},{outputFormat:'json'},{maxMessages:999},{contextPrompt:'a'.repeat(4001)}])('rejects incompatible metadata %p', async metadata => {
  const f=fixture();Object.assign(f.conversation.metadata,metadata);
  await expect(f.service.send(user,id,{text:'Hello',requestId})).rejects.toHaveProperty('status',409);
  expect(f.conversationService.postToConversationNew).not.toHaveBeenCalled();
});
test('rejects media and oversized conversations', async () => {
  const f=fixture(); f.messages.exists.mockResolvedValue(true);
  await expect(f.service.compatible(f.conversation)).rejects.toHaveProperty('status',409);
  f.conversation.messages=Array(201).fill('id');
  await expect(f.service.compatible(f.conversation)).rejects.toHaveProperty('status',409);
});
test('saves text before generating and forwards scoped principal on both service calls', async () => {
  const f=fixture();await f.service.send(user,id,{text:'hello',requestId});
  expect(f.conversationService.postToConversationNew.mock.calls.map(([call]) => call.generateAI)).toEqual([false,true]);
  for(const [call] of f.conversationService.postToConversationNew.mock.calls) expect(call).toMatchObject({conversationId:id,authorizedMember:'owner',userId:'owner',requestPrincipal:user});
  expect(f.conversations.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({members:{$all:['owner'],$size:1},miienRequestIds:{$ne:requestId}}),expect.any(Object),{new:true});
  expect(f.conversations.updateOne).toHaveBeenCalled();expect(f.service.active.size).toBe(0);
});
test('durable duplicate returns without writing or calling provider', async () => {
  const f=fixture();f.conversation.miienRequestIds=[requestId];
  await expect(f.service.send(user,id,{text:'hello',requestId})).resolves.toEqual({duplicate:true});
  expect(f.conversationService.postToConversationNew).not.toHaveBeenCalled();
});
test('pending work and failed atomic claims prevent duplicate provider calls', async () => {
  const f=fixture();f.pending.exists.mockResolvedValue(true);
  await expect(f.service.send(user,id,{text:'hello',requestId})).rejects.toHaveProperty('status',409);
  f.pending.exists.mockResolvedValue(false);f.conversations.findOneAndUpdate.mockResolvedValue(null);
  await expect(f.service.send(user,id,{text:'hello',requestId})).rejects.toHaveProperty('status',409);
  expect(f.conversationService.postToConversationNew).not.toHaveBeenCalled();
});
test('provider failure releases guards and preserves saved user message', async () => {
  const f=fixture();f.conversationService.postToConversationNew.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('provider'));
  await expect(f.service.send(user,id,{text:'hello',requestId})).rejects.toThrow('provider');
  expect(f.conversations.updateOne).toHaveBeenCalled();expect(f.service.active.size).toBe(0);
});
test('settings update is scoped and preserves unrelated metadata by dotted updates', async () => {
  const f=fixture();await f.service.update(user,id,settings);
  const [query,update]=f.conversations.findOneAndUpdate.mock.calls[0];
  expect(query.members).toEqual({$all:['owner'],$size:1});expect(update.$set).not.toHaveProperty('metadata');
  expect(update.$set['metadata.model']).toBe('catalog-model');
});
test('text and privileged fields are rejected before provider work', async () => {
  for(const body of [{text:'' ,requestId},{text:'x'.repeat(4001),requestId},{text:'ok',requestId,userId:'bot'},{text:'ok',requestId:'invalid'}]) {
    const f=fixture();await expect(f.service.send(user,id,body)).rejects.toHaveProperty('status',400);expect(f.conversations.findOne).not.toHaveBeenCalled();
  }
});
test('per-account pending budget prevents further provider work', async () => {
  const f = fixture(); f.pending.countDocuments.mockResolvedValue(2);
  await expect(f.service.send(user, id, { text: 'hello', requestId })).rejects.toHaveProperty('status', 429);
  expect(f.conversations.findOneAndUpdate).not.toHaveBeenCalled();
  expect(f.service.active.size).toBe(0);
});
