function normalizeMessageId(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value.toString === 'function') {
    const stringValue = value.toString();
    return stringValue === '[object Object]' ? '' : stringValue.trim();
  }
  return '';
}

function getMessageId(message) {
  if (message === undefined || message === null) return '';
  if (typeof message !== 'object') return normalizeMessageId(message);
  return normalizeMessageId(message._id || message.id);
}

function getConfiguredStartMessageId(conversation) {
  return normalizeMessageId(conversation?.metadata?.startMessageId);
}

function sliceMessagesFromConfiguredStart(messages, conversation) {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const startMessageId = getConfiguredStartMessageId(conversation);
  if (!startMessageId) return messages;

  const startIndex = messages.findIndex((message) => getMessageId(message) === startMessageId);
  return startIndex >= 0 ? messages.slice(startIndex) : messages;
}

module.exports = {
  getConfiguredStartMessageId,
  getMessageId,
  sliceMessagesFromConfiguredStart,
};
