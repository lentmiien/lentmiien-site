const User = require('../models/useraccount');
const Role = require('../models/role');
const Conversation = require('../models/conversation5');
const Legacy = require('../models/conversation4');
const { hasCapabilities } = require('../utils/authorization');
const { MIIEN_ROLE_CAPABILITY_BUNDLES } = require('../utils/miienAuthorizationPolicy');
const logger = require('../utils/logger');
async function listPage(req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  res.locals.gtag = false;
  try {
    if (!req.isAuthenticated?.()) return res.sendStatus(401);
    const user = await currentReader(req.user?._id);
    if (!user) return res.sendStatus(403);
    req.user = user;
    return next();
  } catch (error) {
    logger.error('Failed to authorize Chat5 conversation list', {
      category: 'authorization', metadata: { errorName: error?.name || 'Error' },
    });
    return next(error);
  }
}
async function currentReader(id) {
  if (!/^[a-f\d]{24}$/i.test(String(id || ''))) return null;
  const user = await User.findById(id).select('_id name type_user').lean();
  if (!user || !await hasCapabilities(user, ['chat.conversation.read'], { roleModel: Role, roleCapabilityBundles: MIIEN_ROLE_CAPABILITY_BUNDLES })) return null;
  return user;
}
async function canReadConversation(id, user) {
  if (!user || !/^[a-f\d]{24}$/i.test(String(id || ''))) return false;
  if (await Conversation.exists({ _id: id })) return Boolean(await Conversation.exists({ _id: id, members: user.name }));
  return Boolean(await Legacy.exists({ _id: id, user_id: user.name }));
}
async function page(req, res, next) {
  res.set('Cache-Control', 'private, no-store'); res.locals.gtag = false;
  try {
    const user = await currentReader(req.user?._id);
    if (!user) return res.sendStatus(403);
    if (req.params.id !== 'NEW' && !await canReadConversation(req.params.id, user)) return res.sendStatus(404);
    req.user = user; return next();
  } catch (error) { return next(error); }
}
async function messagePage(req, res, next) {
  res.set('Cache-Control', 'private, no-store'); res.locals.gtag = false;
  try {
    const user = await currentReader(req.user?._id);
    if (!user) return res.sendStatus(403);
    const id = req.params.id;
    if (!/^[a-f\d]{24}$/i.test(String(id)) || !(await Conversation.exists({ messages: id, members: user.name }) || await Legacy.exists({ messages: id, user_id: user.name }))) return res.sendStatus(404);
    req.user = user; return next();
  } catch (error) { return next(error); }
}
function socketGuard(socket) {
  return async (packet, next) => {
    const [event, raw, ack] = packet;
    const legacy = ['fetchConversation', 'loadLast50Coversations', 'loadConversations', 'userMessage', 'userUpdateSettings', 'createTitle', 'sendAsEmail', 'deleteOneMessage', 'toggleDeleteMessage'];
    if (!/^chat5(?:_|-)/.test(event) && !legacy.includes(event)) return next();
    try {
      const session = socket.request?.session;
      if (typeof session?.reload === 'function') await new Promise((resolve, reject) => session.reload(error => error ? reject(error) : resolve()));
      const current = socket.request?.session;
      if (!current?.cookie?.expires || +new Date(current.cookie.expires) <= Date.now()) throw new Error('Access denied');
      const user = await currentReader(current.passport?.user);
      if (!user || user.name !== socket.data.userName) throw new Error('Access denied');
      const payload = raw && typeof raw === 'object' ? raw : {};
      const ids = [payload.conversationId, payload.conversation_id, payload.sourceConversationId, payload.templateId];
      if (legacy.includes(event) && socket.conversation_id && socket.conversation_id !== 'new') ids.push(socket.conversation_id);
      if (event === 'fetchConversation') ids.push(raw);
      if (typeof raw === 'string' && /joinConversation|fetchConversation/.test(event)) ids.push(raw);
      for (const id of ids.filter(id => id && id !== 'NEW' && id !== 'new')) if (!await canReadConversation(id, user)) throw new Error('Access denied');
      const ordered = payload.newArray || (Array.isArray(payload.messages) ? payload.messages : null);
      if (ordered) {
        const conversationId = payload.conversationId || payload.conversation_id;
        if (!conversationId || !Array.isArray(ordered) || ordered.length > 10000 || ordered.some(id => typeof id !== 'string')
          || !await Conversation.exists({ _id: conversationId, members: user.name, messages: { $all: ordered } })) throw new Error('Access denied');
      }
      // Message reads/edits must be backed by an authorized parent as well.
      const messageId = payload.messageId || payload.message_id;
      if (messageId && !await Conversation.exists({ messages: messageId, members: user.name })) throw new Error('Access denied');
      next();
    } catch (_) {
      for (const room of socket.rooms || []) if (room.startsWith('conversation:')) socket.leave(room);
      if (typeof ack === 'function') ack({ ok: false, message: 'Access denied' });
      socket.emit(`${event}:error`, { message: 'Access denied' });
    }
  };
}
module.exports = { currentReader, canReadConversation, page, listPage, messagePage, socketGuard };
