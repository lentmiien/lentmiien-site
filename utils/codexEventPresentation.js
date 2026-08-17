const marked = require('marked');
const sanitizeHtml = require('sanitize-html');

const MARKDOWN_ITEM_TYPES = new Set(['agent_message', 'reasoning']);
const SUPPORTED_ITEM_TYPES = new Set([...MARKDOWN_ITEM_TYPES, 'todo_list', 'file_change']);

function extractCodexItem(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.item && typeof payload.item === 'object') {
    return payload.item;
  }

  if (payload.payload?.item && typeof payload.payload.item === 'object') {
    return payload.payload.item;
  }

  return null;
}

function renderAgentMessageMarkdown(text) {
  const rendered = marked.parse(String(text || ''), {
    gfm: true,
  });

  return sanitizeHtml(rendered, {
    allowedTags: [
      'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      code: ['class'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'escape',
    transformTags: {
      a: (tagName, attribs) => {
        const attributes = { ...attribs };
        if (/^(https?:|mailto:)/i.test(attributes.href || '')) {
          attributes.target = '_blank';
          attributes.rel = 'noopener noreferrer nofollow';
        } else {
          delete attributes.target;
          delete attributes.rel;
        }
        return { tagName, attribs: attributes };
      },
    },
  });
}

function buildCodexEventPresentation(event) {
  const item = extractCodexItem(event?.payload);
  const itemType = String(item?.type || '').trim().toLowerCase();
  if (!SUPPORTED_ITEM_TYPES.has(itemType)) {
    return null;
  }

  if (MARKDOWN_ITEM_TYPES.has(itemType)) {
    return {
      itemType,
      html: renderAgentMessageMarkdown(item.text),
    };
  }

  if (itemType === 'file_change') {
    return {
      itemType,
      changes: Array.isArray(item.changes)
        ? item.changes
          .map((change) => ({
            path: String(change?.path || '').trim(),
            kind: String(change?.kind || '').trim().toLowerCase(),
          }))
          .filter((change) => change.path)
        : [],
    };
  }

  return {
    itemType,
    items: Array.isArray(item.items)
      ? item.items.map((todo) => ({
        text: String(todo?.text || ''),
        completed: todo?.completed === true,
      }))
      : [],
  };
}

function addCodexEventPresentation(event) {
  const presentation = buildCodexEventPresentation(event);
  return presentation ? { ...event, presentation } : event;
}

module.exports = {
  addCodexEventPresentation,
  buildCodexEventPresentation,
  extractCodexItem,
  renderAgentMessageMarkdown,
};
