const sanitizeHtml = require('sanitize-html');
const { MAX_HTML_BYTES, MAX_CODES, AmiAmiUploadError } = require('../utils/amiamiUploadPolicy');

function parseItemCodes(html) {
  if (typeof html !== 'string' || !html.trim()) {
    throw new AmiAmiUploadError('HTML_REQUIRED', 'Choose an HTML file or paste HTML.');
  }
  if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
    throw new AmiAmiUploadError('HTML_TOO_LARGE', 'HTML must be no larger than 2 MiB.', 413);
  }
  if (html.includes('\0') || html.includes('\ufffd')) {
    throw new AmiAmiUploadError('INVALID_HTML', 'Use an HTML file saved as UTF-8 text.');
  }
  const codes = new Set();
  // Use the existing HTML tokenizer, never a DOM with script/resource loading.
  // This accepts document/body/container/anchor fragments and decoded attributes.
  sanitizeHtml(html, {
    allowedTags: ['a'], allowedAttributes: { a: ['href'] },
    transformTags: {
      a(tagName, attribs) {
        const href = attribs.href || '';
        if (href.length <= 512 && (href.startsWith('/eng/detail?') || /^https:\/\/www\.amiami\.com\//i.test(href))) {
          try {
            const url = new URL(href, 'https://www.amiami.com');
            const values = url.searchParams.getAll('gcode');
            if (url.origin === 'https://www.amiami.com' && !url.username && !url.password
              && url.pathname === '/eng/detail' && values.length === 1
              && /^(?=.{1,80}$)(?=.*[A-Za-z])(?=.*\d)(?=.*-)[A-Za-z\d-]+$/.test(values[0])) {
              codes.add(values[0]);
            }
          } catch (_) { /* Ignore malformed links; never fetch an uploaded URL. */ }
        }
        if (codes.size > MAX_CODES) {
          throw new AmiAmiUploadError('TOO_MANY_CODES', 'Upload at most 1,000 distinct item codes.', 413);
        }
        return { tagName, attribs: {} };
      },
    },
    textFilter: () => '',
  });
  if (!codes.size) {
    throw new AmiAmiUploadError('NO_ITEM_CODES', 'No AmiAmi item links were found. Copy HTML containing /eng/detail?gcode=… links.');
  }
  return [...codes];
}

module.exports = { parseItemCodes };
