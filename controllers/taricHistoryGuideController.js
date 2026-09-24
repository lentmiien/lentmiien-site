const fs = require('fs/promises');
const path = require('path');
const marked = require('marked');
const sanitizeHtml = require('sanitize-html');
const logger = require('../utils/logger');

// One fixed repository document; no request-supplied paths, data or remote assets.
const GUIDE = path.join(__dirname, '../documentation/taric-dataset-guide.md');
function renderMarkdown(markdown) {
  return sanitizeHtml(marked.parse(markdown), {
    allowedTags: ['h1', 'h2', 'h3', 'p', 'a', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'hr', 'br'],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: [],
    allowProtocolRelative: false,
    transformTags: { a: (_tag, attrs) => ({ tagName: 'a', attribs: {
      ...(attrs.href?.startsWith('/admin/') && !attrs.href.includes('\\') ? { href: attrs.href } : {}),
    } }) },
  });
}
async function render(_req, res) {
  try {
    const markdown = await fs.readFile(GUIDE, 'utf8');
    return res.render('admin_taric_history_guide', { guideHtml: renderMarkdown(markdown) });
  } catch (_error) {
    logger.error('TARIC history guide could not be rendered; check packaged documentation and template', { category: 'taric' });
    return res.status(500).type('text/plain').send('TARIC guide unavailable. Check application logs.');
  }
}
module.exports = { render, renderMarkdown };
