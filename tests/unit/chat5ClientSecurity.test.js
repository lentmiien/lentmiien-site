const fs = require('fs');
const path = require('path');

describe('Chat5 client rendering safeguards', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../public/js/chat5_5.js'),
    'utf8'
  );

  test('does not assign conversation titles or ids through innerHTML', () => {
    expect(source).not.toMatch(/getElementById\(["']conversation_title["']\)\.innerHTML\s*=/);
    expect(source).not.toMatch(/getElementById\(["']id["']\)\.innerHTML\s*=/);
  });

  test('sanitizes both Markdown output and server-provided HTML before insertion', () => {
    expect(source).toContain('sanitizeDisplayHtml(window.marked.parse(source))');
    expect(source).toContain('? sanitizeDisplayHtml(content.html)');
    expect(source).toContain('textOutput.innerHTML = sanitizeDisplayHtml(data.html)');
  });

  test('removes Markdown image sources that can target authenticated routes', () => {
    expect(source).toContain("template.content.querySelectorAll('img[src]')");
    expect(source).toContain('isSafeMarkdownImageSource');
  });
});
