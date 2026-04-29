const marked = require('marked');
const sanitizeHtml = require('sanitize-html');

const renderer = new marked.Renderer();

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    '\'': '&#39;',
  }[char]));
}

renderer.html = (html) => escapeHtml(html);

function looksLikeFullHtmlDocument(value = '') {
  const source = String(value || '');
  return /<!doctype html/i.test(source)
    || /<html[\s>]/i.test(source)
    || /<head[\s>]/i.test(source)
    || /<body[\s>]/i.test(source);
}

function renderMarkdownSafe(markdown = '') {
  let source = typeof markdown === 'string' ? markdown : String(markdown || '');
  if (looksLikeFullHtmlDocument(source)) {
    source = `\`\`\`html\n${source}\n\`\`\``;
  }

  const html = marked.parse(source, { renderer });

  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'em', 'strong', 'blockquote', 'a', 'ul', 'ol', 'li', 'pre', 'code', 'hr', 'br',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      code: ['class'],
      img: ['src', 'alt', 'title', 'loading'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data'],
    },
    disallowedTagsMode: 'escape',
    transformTags: {
      a: (tagName, attribs) => {
        const nextAttribs = { ...attribs };
        if (/^(https?:|mailto:)/i.test(nextAttribs.href || '')) {
          nextAttribs.rel = 'noopener noreferrer nofollow';
          nextAttribs.target = '_blank';
        } else {
          delete nextAttribs.rel;
          delete nextAttribs.target;
        }
        return { tagName, attribs: nextAttribs };
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          loading: 'lazy',
        },
      }),
    },
  });
}

function renderMessageHtml(message) {
  if (!message || !message.content || typeof message.content !== 'object') {
    return message;
  }

  const text = message.content.text;
  if (typeof text === 'string' && text.length > 0) {
    message.content.html = renderMarkdownSafe(text);
  }

  return message;
}

function renderMessagesHtml(messages = []) {
  if (!Array.isArray(messages)) return messages;
  messages.forEach((message) => renderMessageHtml(message));
  return messages;
}

module.exports = {
  escapeHtml,
  looksLikeFullHtmlDocument,
  renderMarkdownSafe,
  renderMessageHtml,
  renderMessagesHtml,
};
