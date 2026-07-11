const { renderMessageHtml } = require('./chat5Markdown');

function toPlain(doc) {
  if (!doc) return doc;
  if (typeof doc.toObject === 'function') {
    return doc.toObject({ virtuals: true, versionKey: false });
  }
  if (Array.isArray(doc)) return doc.map(toPlain);
  if (typeof doc === 'object') {
    return { ...doc };
  }
  return doc;
}

function toClientMessage(message) {
  const plain = toPlain(message);
  if (!plain) return plain;
  if (plain.content && typeof plain.content === 'object') {
    plain.content = { ...plain.content };
  }
  if (plain._id && typeof plain._id !== 'string') plain._id = plain._id.toString();
  if (plain.id && typeof plain.id !== 'string') plain.id = plain.id.toString();
  return renderMessageHtml(plain);
}

function emitConversationMessages(io, { conversation, messages = [], placeholderId = null }) {
  if (!io || typeof io.conversationRoom !== 'function' || typeof io.userRoom !== 'function') {
    return false;
  }

  const conversationId = conversation?._id?.toString?.() || conversation?.id?.toString?.();
  if (!conversationId) {
    return false;
  }

  const convRoom = io.conversationRoom(conversationId);
  const clientMessages = messages.map(toClientMessage).filter(Boolean);
  const payload = { id: conversationId, messages: clientMessages };
  if (placeholderId) {
    payload.placeholderId = placeholderId;
  }

  io.to(convRoom).emit('chat5-messages', payload);
  io.to(convRoom).emit('chat5_6-messages', {
    id: conversationId,
    messages: clientMessages,
  });

  const members = Array.isArray(conversation.members) ? conversation.members.filter(Boolean) : [];
  if (members.length > 0) {
    const rooms = members.map((member) => io.userRoom(member));
    io.to(rooms).emit('chat5-notice', { id: conversationId, title: conversation.title });
  }

  return true;
}

module.exports = {
  emitConversationMessages,
  toClientMessage,
  toPlain,
};
