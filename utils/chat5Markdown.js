const marked = require('marked');
const katex = require('katex');
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

renderer.html = ({ text }) => escapeHtml(text);

function findNextDelimiter(source, delimiter, startIndex) {
  let index = source.indexOf(delimiter, startIndex);
  while (index >= 0) {
    let slashCount = 0;
    for (let cursor = index - 1; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 0) return index;
    index = source.indexOf(delimiter, index + delimiter.length);
  }
  return -1;
}

function findNextBackslashDelimiter(source, delimiter, startIndex) {
  let index = source.indexOf(delimiter, startIndex);
  while (index >= 0) {
    let slashCount = 0;
    for (let cursor = index; cursor >= 0 && source[cursor] === '\\'; cursor -= 1) {
      slashCount += 1;
    }
    if (slashCount % 2 === 1) return index;
    index = source.indexOf(delimiter, index + delimiter.length);
  }
  return -1;
}

function createMathToken(raw, text, displayMode, type = 'chat5Math') {
  return {
    type,
    raw,
    text,
    displayMode,
  };
}

function tokenizeDisplayMathBlock(source) {
  const firstNewline = source.indexOf('\n');
  if (firstNewline < 0) return undefined;

  const firstLine = source.slice(0, firstNewline);
  const opening = /^ {0,3}(\\\[|\$\$)[ \t]*$/.exec(firstLine);
  if (!opening) return undefined;

  const closingPattern = opening[1] === '$$'
    ? /^ {0,3}\$\$[ \t]*$/
    : /^ {0,3}\\\][ \t]*$/;
  let lineStart = firstNewline + 1;

  while (lineStart <= source.length) {
    const nextNewline = source.indexOf('\n', lineStart);
    const lineEnd = nextNewline < 0 ? source.length : nextNewline;
    const line = source.slice(lineStart, lineEnd);

    if (closingPattern.test(line)) {
      const rawEnd = nextNewline < 0 ? lineEnd : nextNewline + 1;
      const raw = source.slice(0, rawEnd);
      const text = source.slice(firstNewline + 1, lineStart).replace(/\n$/, '');
      return createMathToken(raw, text, true, 'chat5MathBlock');
    }

    if (nextNewline < 0) break;
    lineStart = nextNewline + 1;
  }

  return undefined;
}

function tokenizeBackslashMath(source, opening, closing, displayMode, allowNewlines = false) {
  if (!source.startsWith(opening)) return undefined;
  const closingIndex = findNextBackslashDelimiter(source, closing, opening.length);
  if (closingIndex < 0) return undefined;

  const raw = source.slice(0, closingIndex + closing.length);
  const text = source.slice(opening.length, closingIndex);
  if (text.trim().length === 0 || (!allowNewlines && text.includes('\n'))) return undefined;
  return createMathToken(raw, text, displayMode);
}

function tokenizeDollarMath(source) {
  if (!source.startsWith('$') || source.startsWith('$$')) return undefined;
  if (source.length < 3 || /\s/.test(source[1])) return undefined;

  let closingIndex = findNextDelimiter(source, '$', 1);
  while (closingIndex >= 0) {
    if (source.slice(1, closingIndex).includes('\n')) return undefined;
    const previous = source[closingIndex - 1];
    const next = source[closingIndex + 1];
    if (source[closingIndex + 1] !== '$'
      && !/\s/.test(previous)
      && !(next && /\d/.test(next))) {
      const raw = source.slice(0, closingIndex + 1);
      return createMathToken(raw, source.slice(1, closingIndex), false);
    }
    closingIndex = findNextDelimiter(source, '$', closingIndex + 1);
  }

  return undefined;
}

function tokenizeDoubleDollarMath(source) {
  if (!source.startsWith('$$') || source.startsWith('$$$')) return undefined;
  const closingIndex = findNextDelimiter(source, '$$', 2);
  if (closingIndex < 0) return undefined;

  const text = source.slice(2, closingIndex);
  if (text.trim().length === 0) return undefined;
  return createMathToken(source.slice(0, closingIndex + 2), text, true);
}

function renderMath(token) {
  try {
    return katex.renderToString(token.text, {
      displayMode: token.displayMode,
      output: 'html',
      strict: 'ignore',
      throwOnError: false,
      trust: false,
    });
  } catch (error) {
    const message = error && error.message ? error.message : 'Unable to render equation';
    return `<span class="katex-error" title="${escapeHtml(message)}">${escapeHtml(token.text)}</span>`;
  }
}

const markdownRenderer = new marked.Marked();
markdownRenderer.use({
  extensions: [
    {
      name: 'chat5MathBlock',
      level: 'block',
      start(source) {
        const match = /\n {0,3}(?:\\\[|\$\$)[ \t]*(?=\n|$)/.exec(source);
        return match ? match.index : undefined;
      },
      tokenizer: tokenizeDisplayMathBlock,
      renderer: renderMath,
    },
    {
      name: 'chat5Math',
      level: 'inline',
      start(source) {
        const indices = [source.indexOf('\\('), source.indexOf('\\['), source.indexOf('$')]
          .filter((index) => index >= 0);
        return indices.length > 0 ? Math.min(...indices) : undefined;
      },
      tokenizer(source) {
        return tokenizeBackslashMath(source, '\\(', '\\)', false)
          || tokenizeBackslashMath(source, '\\[', '\\]', true, true)
          || tokenizeDoubleDollarMath(source)
          || tokenizeDollarMath(source);
      },
      renderer: renderMath,
    },
  ],
});

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

  const html = markdownRenderer.parse(source, { renderer });

  return sanitizeHtml(html, {
    allowedTags: [
      'p', 'em', 'strong', 'blockquote', 'a', 'ul', 'ol', 'li', 'pre', 'code', 'hr', 'br',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
      'span', 'svg', 'path', 'line',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      code: ['class'],
      img: ['src', 'alt', 'title', 'loading'],
      span: ['class', 'style', 'title', 'aria-hidden'],
      th: ['align'],
      td: ['align'],
      svg: ['xmlns', 'width', 'height', 'viewbox', 'preserveaspectratio'],
      path: ['d'],
      line: ['x1', 'x2', 'y1', 'y2', 'stroke-width'],
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
