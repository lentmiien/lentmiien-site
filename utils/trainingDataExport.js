function normalizeGroupId(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  return raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function normalizeId(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (value && typeof value.toString === 'function') return value.toString().trim();
  return '';
}

function normalizeIdArray(value) {
  const input = Array.isArray(value) ? value : [value];
  const seen = new Set();
  const output = [];
  input.forEach((item) => {
    const normalized = normalizeId(item);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

function buildTrainingSelectionKey({ conversationId, promptMessageIds, outputMessageId }) {
  const conv = normalizeId(conversationId);
  const prompts = normalizeIdArray(promptMessageIds);
  const output = normalizeId(outputMessageId);
  return `${conv}|${prompts.join(',')}|${output}`;
}

function getMessageText(message) {
  if (!message || !message.content || typeof message.content !== 'object') return '';
  return typeof message.content.text === 'string' ? message.content.text.trim() : '';
}

function joinPromptTexts(messages) {
  return messages
    .map(getMessageText)
    .filter((text) => text.length > 0)
    .join('\n\n');
}

function escapeCsvCell(value) {
  const text = value === undefined || value === null ? '' : String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function buildTrainingCsv(rows) {
  const header = ['system', 'prompt', 'response'];
  const lines = [header.join(',')];
  rows.forEach((row) => {
    lines.push([
      escapeCsvCell(row.system || ''),
      escapeCsvCell(row.prompt || ''),
      escapeCsvCell(row.response || ''),
    ].join(','));
  });
  return `${lines.join('\n')}\n`;
}

module.exports = {
  normalizeGroupId,
  normalizeId,
  normalizeIdArray,
  buildTrainingSelectionKey,
  getMessageText,
  joinPromptTexts,
  escapeCsvCell,
  buildTrainingCsv,
};
