const { createHash } = require('crypto');
const { Marked } = require('marked');
const sanitizeHtml = require('sanitize-html');

const PREPARATION_VERSION = 'miien-spoken-v1';
const RAW_LIMIT = 64000;
const PREVIEW_LIMIT = 600;
const MARKUP_LIMIT = 2048;
// A private parser instance: never change shared Chat5 rendering/extensions.
const markdown = new Marked({ gfm: true, renderer: {
  code() { return '\n'; },
  codespan({ text }) {
    return text.length <= 80 && !/[{};=<>\n]|(?:https?:|www\.)/i.test(text) ? text : ' ';
  },
  image() { return ' '; },
  link({ tokens, text, href }) {
    return text === href || text === href.replace(/^mailto:/i, '') ? ' ' : this.parser.parseInline(tokens);
  },
} });

function prepareSpeechText(raw) {
  // Defense in depth; callers must first load through chat.speechText's owner,
  // membership, assistant/text and raw-length checks. Never persist the result.
  if (typeof raw !== 'string' || raw.length > RAW_LIMIT) throw new Error('Speech input exceeds bounds');
  // Marked's emphasis grammar can do disproportionate work on dense malformed
  // delimiters. Reject excessive syntax before parsing, never truncate raw text.
  let markers = 0, depth = 0;
  for (const character of raw) {
    if ('*_`~[]()<>'.includes(character) && ++markers > MARKUP_LIMIT) throw new Error('Speech markup exceeds bounds');
    if (character === '[' || character === '(') {
      if (++depth > 32) throw new Error('Speech nesting exceeds bounds');
    } else if (character === ']' || character === ')') depth = Math.max(0, depth - 1);
  }
  for (const line of raw.split('\n')) {
    if (/^(?: {0,3}>[ \t]*){33}|^ {129}|^\t{33}/.test(line)) throw new Error('Speech nesting exceeds bounds');
  }
  const html = markdown.parse(raw);
  const plain = sanitizeHtml(html, {
    allowedTags: ['p', 'div', 'br', 'hr', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'td', 'th'], allowedAttributes: {},
    nonTextTags: ['script', 'style', 'textarea', 'option', 'xmp', 'pre', 'code', 'svg', 'math', 'iframe', 'object'],
  });
  // sanitize-html has decoded named/numeric entities, then re-escaped only these
  // three text characters. Decode once, with no second HTML interpretation.
  const text = plain.replace(/<[^>]*>/g, '\n').replace(/&(amp|lt|gt);/g, (_, entity) => ({ amp: '&', lt: '<', gt: '>' }[entity]))
    .replace(/\S+/g, word => (word.includes('://') || /www\./i.test(word) || word.includes('@')) ? '' : word)
    .replace(/[*_`~#\[\]<>\\|]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/[^\S\n]+/g, ' ').replace(/ *\n+ */g, '\n').trim();
  const characters = Array.from(text);
  return { preview: characters.slice(0, PREVIEW_LIMIT).join(''),
    spokenCharacters: Math.min(characters.length, PREVIEW_LIMIT), truncated: characters.length > PREVIEW_LIMIT,
    preparationVersion: PREPARATION_VERSION,
    fingerprint: createHash('sha256').update(PREPARATION_VERSION).update('\0').update(raw).update('\0').update(text).digest('hex') };
}
module.exports = { prepareSpeechText, PREPARATION_VERSION, RAW_LIMIT, PREVIEW_LIMIT, MARKUP_LIMIT };
