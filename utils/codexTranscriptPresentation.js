const marked = require('marked');
const sanitizeHtml = require('sanitize-html');
const logger = require('./logger');

const MAX_MARKDOWN_CHARACTERS = 100000;

function plainHtml(text) {
  return `<pre>${sanitizeHtml(text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), { allowedTags: [], allowedAttributes: {} })}</pre>`;
}

// Transcript text is private, untrusted user/model output. No embedded resources,
// active HTML, IDs, styles or event handlers may reach either rendering context.
function renderTranscriptMarkdown(value) {
  const source = String(value == null ? '' : value);
  if (!source) return '';
  // Bound Markdown parsing without silently truncating older, oversized responses.
  if (source.length > MAX_MARKDOWN_CHARACTERS) return plainHtml(source);
  try {
    return sanitizeHtml(marked.parse(source, { gfm: true }), {
      allowedTags: [
        'a', 'blockquote', 'br', 'code', 'del', 'em', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'hr', 'li', 'ol', 'p', 'pre', 'strong', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul',
      ],
      allowedAttributes: { a: ['href', 'title', 'target', 'rel'], ol: ['start'] },
      allowedSchemes: ['http', 'https'],
      allowProtocolRelative: false,
      disallowedTagsMode: 'escape',
      transformTags: {
        a: (_tag, attributes) => {
          const href = String(attributes.href || '');
          // Local links must be explicit root-relative paths; reject protocol-
          // relative, backslash and control-character URL normalization tricks.
          const local = /^\/(?!\/)/.test(href) && !/[\\\u0000-\u0020\u007f]/.test(href);
          let external = false;
          try {
            const url = new URL(href);
            external = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
          } catch (_) { /* Relative or invalid URL. */ }
          const safe = { title: attributes.title || '' };
          if (local || external) {
            safe.href = href;
            safe.rel = 'noopener noreferrer nofollow';
            if (external) safe.target = '_blank';
          }
          return { tagName: 'a', attribs: safe };
        },
      },
    });
  } catch (error) {
    logger.warning('Unable to render Codex transcript Markdown; showing plain text', {
      category: 'codex_tool', metadata: { errorName: error?.name || 'Error' },
    });
    return plainHtml(source);
  }
}

function presentTurn(turn) {
  return {
    ...turn,
    promptHtml: renderTranscriptMarkdown(turn.prompt),
    responseHtml: renderTranscriptMarkdown(turn.finalResponse),
  };
}

function presentCodexTranscripts(state) {
  return {
    ...state,
    ...(state.turn ? { turn: presentTurn(state.turn) } : {}),
    ...(Array.isArray(state.turns) ? { turns: state.turns.map(presentTurn) } : {}),
  };
}

module.exports = { MAX_MARKDOWN_CHARACTERS, presentCodexTranscripts, renderTranscriptMarkdown };
