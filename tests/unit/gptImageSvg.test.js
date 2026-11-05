const { validateGeneratedSvg, MAX_SVG_BYTES } = require('../../utils/gptImageSvg');

test('static paths, text and local gradients are accepted without modifying bytes', () => {
  const buffer = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><defs><linearGradient id="paint"><stop offset="0" stop-color="red"/></linearGradient></defs><path fill="url(#paint)" d="M0 0h32v32H0z"/><text x="2" y="10">Test &amp; safe</text></svg>');
  expect(validateGeneratedSvg(buffer)).toBe(buffer);
});
test.each([
  '<script>alert(1)</script>', '<image href="https://example.com/a.png"/>',
  '<foreignObject><div>HTML</div></foreignObject>', '<style>path{fill:red}</style>',
  '<path onload="alert(1)"/>', '<path style="fill:url(https://example.com/x)"/>',
  '<path fill="url(https://example.com/x)"/>', '<path fill="url(&#104;ttps://example.com/x)"/>',
  '<use href="#foo"/>', '<animate attributeName="href" values="javascript:alert(1)"/>',
  '<path xmlns="http://www.w3.org/1999/xhtml"/>',
])('rejects active or external content %s', content => {
  expect(() => validateGeneratedSvg(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${content}</svg>`))).toThrow();
});
test.each([
  '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
  '<?xml-stylesheet href="https://example.com/style.css"?><svg/>', '<svg><path></svg>', '<html/>',
  '<svg>'.repeat(66) + '</svg>'.repeat(66),
])('rejects malformed XML, entities and excessive nesting', value => {
  expect(() => validateGeneratedSvg(Buffer.from(value))).toThrow();
});
test('enforces byte bound', () => {
  expect(() => validateGeneratedSvg(Buffer.alloc(MAX_SVG_BYTES + 1))).toThrow();
});
