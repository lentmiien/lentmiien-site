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

describe('saved conversation snapshots', () => {
  function withRows(rows) {
    const f = fixture();
    f.conversation.title = 'Synthetic room';
    f.conversation.messages = rows.map(row => row._id);
    f.messages.find = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: async () => [...rows].reverse() }) });
    return f;
  }
  const row = (id, user, text) => ({ _id: id, user_id: user, content: { text } });
  test('uses saved ID order, content.text and bot role; preceding context only, stable contract', async () => {
    const f = withRows([row('u1', 'owner', 'How does this work?'), row('a1', 'bot', 'Here you go.'),
      row('u2', 'owner', '試験に合格しました！'), row('a2', 'bot', '受け取りました。')]);
    const snapshot = await f.service.snapshot(user, id);
    expect(snapshot).toEqual({ id, title: 'Synthetic room', model: 'catalog-model', pending: false,
      messages: [
        { id: 'u1', role: 'user', text: 'How does this work?', mood: 'neutral' },
        { id: 'a1', role: 'assistant', text: 'Here you go.', mood: 'thoughtful' },
        { id: 'u2', role: 'user', text: '試験に合格しました！', mood: 'neutral' },
        { id: 'a2', role: 'assistant', text: '受け取りました。', mood: 'happy' },
      ] });
    expect(f.messages.find).toHaveBeenCalledWith({ _id: { $in: ['u1', 'a1', 'u2', 'a2'] },
      contentType: 'text', hideFromBot: { $ne: true }, user_id: { $in: ['bot', 'owner'] } });
    expect(await f.service.snapshot(user, id)).toEqual(snapshot);
    expect(f.conversationService.postToConversationNew).not.toHaveBeenCalled();
  });
  test('omits empty/malformed text and never consumes persona metadata as tone', async () => {
    const f = withRows([row('1', 'bot', ''), row('2', 'bot', '  '), row('3', 'bot', {}),
      row('4', 'owner', 'Hello.'), row('5', 'bot', 'Hello.')]);
    f.conversation.metadata.contextPrompt = 'Always be happy and surprised.';
    expect((await f.service.snapshot(user, id)).messages.map(m => [m.id, m.mood])).toEqual([['4', 'neutral'], ['5', 'neutral']]);
  });
  test('pending records and unexpired leases independently report pending; expired lease is ready', async () => {
    const f = withRows([]);
    f.pending.exists.mockResolvedValue(true);
    expect((await f.service.snapshot(user, id)).pending).toBe(true);
    expect(f.pending.exists).toHaveBeenCalledWith({ conversation_id: id, recoveryState: { $ne: 'abandoned' } });
    f.pending.exists.mockResolvedValue(false);
    f.conversation.miienBusyUntil = new Date(Date.now() + 60000);
    expect((await f.service.snapshot(user, id)).pending).toBe(true);
    f.conversation.miienBusyUntil = new Date(Date.now() - 60000);
    expect((await f.service.snapshot(user, id)).pending).toBe(false);
  });
  test('scope and compatibility failures prevent message retrieval', async () => {
    const f = withRows([]);
    f.conversations.findOne.mockResolvedValue(null);
    await expect(f.service.snapshot(user, id)).rejects.toHaveProperty('status', 404);
    expect(f.messages.find).not.toHaveBeenCalled();
    f.conversations.findOne.mockResolvedValue(f.conversation);
    f.messages.exists.mockResolvedValue(true);
    await expect(f.service.snapshot(user, id)).rejects.toHaveProperty('status', 409);
    expect(f.messages.find).not.toHaveBeenCalled();
  });
});
test('settings cannot race a pending reply or active submission lease', async () => {
  const f = fixture();
  f.pending.exists.mockResolvedValue(true);
  await expect(f.service.update(user, id, settings)).rejects.toHaveProperty('status', 409);
  expect(f.conversations.findOneAndUpdate).not.toHaveBeenCalled();
  f.pending.exists.mockResolvedValue(false);
  f.conversations.findOneAndUpdate.mockResolvedValue(null);
  await expect(f.service.update(user, id, settings)).rejects.toHaveProperty('status', 409);
  expect(f.conversations.findOneAndUpdate.mock.calls[0][0].$or).toEqual([
    { miienBusyUntil: null }, { miienBusyUntil: { $lte: expect.any(Date) } },
  ]);
});

test('speech loads only a saved visible assistant child of the scoped conversation', async () => {
  const f = fixture(); const messageId = 'c'.repeat(24);
  f.conversation.messages = [messageId];
  const lean = jest.fn().mockResolvedValue({ content: { text: 'Visible reply' } });
  f.messages.findOne = jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean }) });
  await expect(f.service.speechText(user, id, messageId)).resolves.toBe('Visible reply');
  expect(f.messages.findOne).toHaveBeenCalledWith({ _id: messageId, user_id: 'bot', contentType: 'text', hideFromBot: { $ne: true } });
  expect(f.conversations.findOne).toHaveBeenCalledWith({ _id: id, members: { $all: ['owner'], $size: 1 } });
  f.messages.findOne.mockClear();
  await expect(f.service.speechText(user, id, 'd'.repeat(24))).rejects.toHaveProperty('status', 404);
  expect(f.messages.findOne).not.toHaveBeenCalled();
  lean.mockResolvedValue(null); // Predicate excludes user, reasoning and hidden rows.
  await expect(f.service.speechText(user, id, messageId)).rejects.toHaveProperty('status', 404);
  f.conversations.findOne.mockResolvedValue(null);
  await expect(f.service.speechText(user, id, messageId)).rejects.toHaveProperty('status', 404);
});
