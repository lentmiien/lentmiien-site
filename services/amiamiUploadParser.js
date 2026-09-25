const sanitizeHtml = require('sanitize-html');
const { MAX_HTML_BYTES, MAX_CODES, AmiAmiUploadError } = require('../utils/amiamiUploadPolicy');

const ITEM_CODE = /^(?=.{1,80}$)(?=.*[A-Za-z])(?=.*\d)(?=.*-)[A-Za-z\d-]+$/;

function parseItemCodes(input, format = 'html') {
  if (format === 'html') return parseHtmlItemCodes(input);
  if (format !== 'codes') {
    throw new AmiAmiUploadError('INVALID_FORMAT', 'Choose HTML or item codes as the input format.');
  }
  if (typeof input !== 'string' || !input.trim()) {
    throw new AmiAmiUploadError('CODES_REQUIRED', 'Choose a text file or paste one item code per line, with no header.');
  }
  if (Buffer.byteLength(input, 'utf8') > MAX_HTML_BYTES) {
    throw new AmiAmiUploadError('CODES_TOO_LARGE', 'The item code list must be no larger than 2 MiB.', 413);
  }
  if (input.includes('\0') || input.includes('\ufffd')) {
    throw new AmiAmiUploadError('INVALID_CODES', 'Use a text file saved as UTF-8.');
  }
  const codes = new Set();
  const lines = input.split(/\r\n|\n|\r/);
  for (let i = 0; i < lines.length; i += 1) {
    const code = lines[i].trim();
    if (!code) continue;
    if (!ITEM_CODE.test(code)) {
      throw new AmiAmiUploadError('INVALID_CODE', `Invalid item code on line ${i + 1}. Use one code per line (for example TOY-RBT-9417), with no header or links.`);
    }
    codes.add(code);
    if (codes.size > MAX_CODES) {
      throw new AmiAmiUploadError('TOO_MANY_CODES', 'Upload at most 1,000 distinct item codes.', 413);
    }
  }
  return [...codes];
}

function parseHtmlItemCodes(html) {
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
              && ITEM_CODE.test(values[0])) {
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
