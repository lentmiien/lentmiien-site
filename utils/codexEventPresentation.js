const marked = require('marked');
const sanitizeHtml = require('sanitize-html');

const SUPPORTED_ITEM_TYPES = new Set(['agent_message', 'todo_list']);

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

  if (itemType === 'agent_message') {
    return {
      itemType,
      html: renderAgentMessageMarkdown(item.text),
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
