const sanitizeHtml = require('sanitize-html');

const BLOG_ORIGIN = 'https://blog-content.invalid';

function isSafeLocalBlogImage(source) {
  try {
    const parsed = new URL(String(source || ''), BLOG_ORIGIN);
    return parsed.origin === BLOG_ORIGIN && parsed.pathname.startsWith('/img/');
  } catch (error) {
    return false;
  }
}

function sanitizeBlogContent(value) {
  return sanitizeHtml(String(value ?? ''), {
    allowedTags: [
      'p', 'em', 'strong', 'blockquote', 'a', 'ul', 'ol', 'li', 'pre', 'code',
      'hr', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead',
      'tbody', 'tr', 'th', 'td', 'img', 'span',
    ],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
      code: ['class'],
      img: ['src', 'alt', 'title', 'loading'],
      th: ['align'],
      td: ['align'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    disallowedTagsMode: 'escape',
    exclusiveFilter: (frame) => frame.tag === 'img' && !isSafeLocalBlogImage(frame.attribs.src),
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
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, loading: 'lazy' },
      }),
    },
  });
}

function prepareBlogContent(value) {
  const normalized = String(value ?? '').replace(/\r\n?/g, '\n');
  return sanitizeBlogContent(normalized.split('\n').join('<br>'));
}

function blogContentForEditing(value) {
  return sanitizeBlogContent(value).replace(/<br\s*\/?\s*>/gi, '\n');
}

module.exports = {
  blogContentForEditing,
  prepareBlogContent,
  sanitizeBlogContent,
};
