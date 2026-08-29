const sanitizeHtml = require('sanitize-html');

function sanitizeEmailPreviewHtml(value) {
  return sanitizeHtml(String(value || ''), {
    allowedTags: [
      'a', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'h1', 'h2', 'h3',
      'h4', 'h5', 'h6', 'hr', 'i', 'li', 'ol', 'p', 'pre', 's', 'small', 'span',
      'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
      'u', 'ul',
    ],
    allowedAttributes: {
      td: ['align', 'colspan', 'rowspan'],
      th: ['align', 'colspan', 'rowspan'],
    },
    disallowedTagsMode: 'discard',
  });
}

module.exports = { sanitizeEmailPreviewHtml };
