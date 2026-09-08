const { classifyMood } = require('../utils/miienMood');
const DEFAULT_CONTEXT = 'You are Miien, a friendly adult catgirl mascot and helpful conversational companion. Be warm, clear and concise. Respond naturally in the user’s language. Be honest that you are an AI character; do not claim real feelings or a physical presence.';
const ID = /^[a-f\d]{24}$/i;
class MiienError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function fields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some(key => ![...allowed, '_csrf'].includes(key))) {
    throw new MiienError(400, 'Invalid request fields.');
  }
}
function string(value, max, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new MiienError(400, 'Check the text fields and their length limits.');
  }
  return value.trim();
}
class MiienChatService {
  constructor({ conversations, messages, pending, conversationService, listModels }) {
    Object.assign(this, { conversations, messages, pending, conversationService, listModels });
    this.active = new Set();
  }
  async models() {
    return (await this.listModels()).filter(m => m.provider !== 'Local' || process.env.DISABLE_LOCAL !== 'TRUE')
      .map(m => ({ id: m.api_model, name: m.model_name, provider: m.provider }));
  }
  async settings(body) {
    fields(body, ['model', 'context', 'title', 'maxMessages', 'reasoning', 'verbosity']);
    const model = string(body.model, 160);
    if (!(await this.models()).some(m => m.id === model)) throw new MiienError(400, 'Choose an available Chat5 model.');
    const maxMessages = Number(body.maxMessages);
    if (!['string', 'number'].includes(typeof body.maxMessages) || !Number.isInteger(maxMessages) || maxMessages < 2 || maxMessages > 40
      || !['low', 'medium', 'high'].includes(body.reasoning) || !['low', 'medium', 'high'].includes(body.verbosity)) {
      throw new MiienError(400, 'Choose valid conversation settings.');
    }
    return { title: string(body.title, 100), metadata: {
      model, contextPrompt: string(body.context, 4000, false), maxMessages,
      reasoning: body.reasoning, verbosity: body.verbosity, mode: 'standard',
      outputFormat: 'text', tools: [], maxAudioMessages: 0,
    } };
  }
  scope(user, id) {
    if (!ID.test(id || '')) throw new MiienError(404, 'Conversation not found.');
    // Single-member scope is intentional: phase 1 does not introduce shared character rooms.
    return { _id: id, members: { $all: [user.name], $size: 1 } };
  }
  async owned(user, id) {
    const conversation = await this.conversations.findOne(this.scope(user, id));
    if (!conversation) throw new MiienError(404, 'Conversation not found.');
    return conversation;
  }
  async compatible(conversation) {
    const m = conversation.metadata || {};
    if ((m.tools || []).length || m.outputFormat !== 'text' || conversation.messages.length > 200
      || m.contextPrompt?.length > 4000 || !Number.isInteger(m.maxMessages) || m.maxMessages < 2 || m.maxMessages > 40) {
      throw new MiienError(409, 'This conversation needs text output, no tools, a 2–40 message context window and at most 200 messages. Adjust it in Chat5 first.');
    }
    const unsupported = await this.messages.exists({ _id: { $in: conversation.messages },
      $or: [{ contentType: { $nin: ['text', 'reasoning'] } }, { 'content.text': { $regex: '[\\s\\S]{64001}' } }] });
    if (unsupported) throw new MiienError(409, 'Resume supports text conversations with messages up to 64,000 characters.');
  }
  async list(user) {
    return this.conversations.find({ members: { $all: [user.name], $size: 1 },
      'metadata.tools': { $size: 0 }, 'metadata.outputFormat': 'text',
      'metadata.maxMessages': { $gte: 2, $lte: 40 }, 'messages.200': { $exists: false },
    }).select('_id title updatedAt').sort({ updatedAt: -1 }).limit(30).lean();
  }
  async create(user, body) {
    const { title, metadata } = await this.settings(body);
    return this.conversationService.createNewConversation(user.name, metadata, {
      title, category: 'Chat5', tags: ['chat5', 'miien'], members: [user.name],
    });
  }
  async pendingFor(id) {
    return Boolean(await this.pending.exists({ conversation_id: String(id), recoveryState: { $ne: 'abandoned' } }));
  }
  async snapshot(user, id) {
    const conversation = await this.owned(user, id);
    await this.compatible(conversation);
    const rows = await this.messages.find({ _id: { $in: conversation.messages }, contentType: 'text', hideFromBot: { $ne: true } })
      .select('_id user_id content.text timestamp').lean();
    const order = new Map(conversation.messages.map((value, index) => [String(value), index]));
    rows.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
    const messages = rows.map(row => ({ id: String(row._id), role: row.user_id === 'bot' ? 'assistant' : 'user',
      text: (row.content?.text || '').slice(0, 64000), mood: row.user_id === 'bot' ? classifyMood(row.content?.text) : 'neutral' }));
    return { id: String(conversation._id), title: conversation.title, model: conversation.metadata.model,
      messages, pending: await this.pendingFor(id) || new Date(conversation.miienBusyUntil || 0).getTime() > Date.now() };
  }
  async update(user, id, body) {
    const settings = await this.settings(body);
    const conversation = await this.owned(user, id);
    await this.compatible(conversation);
    if (await this.pendingFor(id)) throw new MiienError(409, 'Wait for the current response before changing settings.');
    const set = { title: settings.title };
    Object.entries(settings.metadata).forEach(([key, value]) => { set[`metadata.${key}`] = value; });
    const result = await this.conversations.findOneAndUpdate({ ...this.scope(user, id),
      $or: [{ miienBusyUntil: null }, { miienBusyUntil: { $lte: new Date() } }],
    }, { $set: set }, { new: true });
    if (!result) throw new MiienError(409, 'A turn is in progress. Try again after it finishes.');
    return result;
  }
  async send(user, id, body) {
    fields(body, ['text', 'requestId']);
    const text = string(body.text, 4000);
    if (typeof body.requestId !== 'string' || !/^[a-f\d-]{36}$/i.test(body.requestId)) throw new MiienError(400, 'Invalid request ID.');
    const conversation = await this.owned(user, id);
    await this.compatible(conversation);
    if (conversation.miienRequestIds?.includes(body.requestId)) return { duplicate: true };
    if (conversation.messages.length >= 198) throw new MiienError(409, 'This proof-of-concept room is full. Start a new conversation.');
    if (!(await this.models()).some(m => m.id === conversation.metadata.model)) throw new MiienError(409, 'The saved model is unavailable. Choose another in settings.');
    if (await this.pendingFor(id)) throw new MiienError(409, 'A response is already pending.');
    if (this.active.has(user.name) || this.active.size >= 4) throw new MiienError(429, 'Chat is busy. Please try again shortly.');
    this.active.add(user.name);
    let claimed = false;
    try {
      const pendingCount = await this.pending.countDocuments({ recoveryState: { $in: ['pending', 'tool_wait'] }, 'initiatedBy.name': user.name });
      if (pendingCount >= 2) throw new MiienError(429, 'Two responses are already pending for your account. Wait for them to finish.');
      const lock = await this.conversations.findOneAndUpdate({ ...this.scope(user, id),
        miienRequestIds: { $ne: body.requestId },
        $or: [{ miienBusyUntil: null }, { miienBusyUntil: { $lte: new Date() } }],
      }, { $set: { miienBusyUntil: new Date(Date.now() + 15 * 60 * 1000) },
        $push: { miienRequestIds: { $each: [body.requestId], $slice: -200 } } }, { new: true });
      if (!lock) throw new MiienError(409, 'This turn was already submitted or another turn is in progress.');
      claimed = true;
      // Save user text first so a provider failure cannot leave it orphaned or silently lost.
      await this.conversationService.postToConversationNew({ conversationId: id, authorizedMember: user.name,
        userId: user.name, requestPrincipal: user, messageContent: { text }, messageType: 'text', generateAI: false });
      await this.conversationService.postToConversationNew({ conversationId: id, authorizedMember: user.name,
        userId: user.name, requestPrincipal: user, generateAI: true });
      return { accepted: true };
    } finally {
      this.active.delete(user.name);
      if (claimed) await this.conversations.updateOne(this.scope(user, id), { $unset: { miienBusyUntil: 1 } });
    }
  }
}
module.exports = { MiienChatService, MiienError, DEFAULT_CONTEXT, fields };
