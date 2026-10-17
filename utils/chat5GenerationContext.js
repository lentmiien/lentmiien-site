// Pure message preparation: all I/O and authorization belong to the supplied
// resolver. No filenames, URLs, provider calls or tools are resolved here.
const { buildEffectiveContextPrompt } = require('./chat5Context');
const { problem } = require('../services/localAi/policy');
function messageText(message, includeImages = true) {
  const content = message.content || {};
  const trim = value => typeof value === 'string' ? value.trim() : '';
  switch ((message.contentType || '').toLowerCase()) {
    case 'image': return trim(content.revisedPrompt || (!includeImages && content.text));
    case 'audio': return trim(content.transcript || content.text);
    default: return trim(content.text);
  }
}
async function prepareGenerationContext({ conversation, settings, selected, prompt, resolveImage }) {
  const historyLimit = Math.max(0, settings.maxMessages - (prompt ? 1 : 0));
  const visible = historyLimit ? selected.filter(m => !m.hideFromBot).slice(-historyLimit) : [];
  const context = buildEffectiveContextPrompt({ ...conversation, metadata: { ...conversation.metadata, contextPrompt: settings.contextPrompt } });
  const messages = context ? [{ role: 'system', content: context }] : [];
  for (const message of visible) {
    const content = message.content || {};
    if (!['text', 'image', 'audio'].includes(message.contentType) || content.toolCallId || content.callId || content.toolName
      || content.toolOutput || content.raw?.tool_calls || content.images) throw problem('batch_history_contains_tools_or_media');
    const role = message.user_id === 'bot' ? 'assistant' : 'user';
    const entry = { role, content: messageText(message) };
    if (message.contentType === 'image') {
      if (role !== 'user' || !resolveImage) throw problem('batch_image_source_requires_reupload');
      entry.images = [await resolveImage(message)];
    }
    if (entry.content || entry.images) messages.push(entry);
  }
  if (prompt) messages.push({ role: 'user', content: prompt });
  return { messages, selectedIds: visible.map(m => String(m._id)) };
}
module.exports = { messageText, prepareGenerationContext };
