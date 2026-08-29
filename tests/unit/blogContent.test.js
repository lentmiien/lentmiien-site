const {
  blogContentForEditing,
  prepareBlogContent,
  sanitizeBlogContent,
} = require('../../utils/blogContent');

describe('blogContent', () => {
  test('preserves line breaks while removing active HTML from new posts', () => {
    const result = prepareBlogContent('First line\n<script>alert(1)</script><b>Second</b>');

    expect(result).toBe('First line<br />&lt;script&gt;alert(1)&lt;/script&gt;&lt;b&gt;Second&lt;/b&gt;');
    expect(result).not.toContain('<script');
    expect(result).not.toContain('<b>');
  });

  test('sanitizes existing stored posts before public rendering', () => {
    expect(sanitizeBlogContent('<img src=x onerror=alert(1)>Safe<br>text'))
      .toBe('Safe<br />text');
  });

  test('preserves safe rich formatting produced by the chat Markdown renderer', () => {
    expect(sanitizeBlogContent('<h2>Heading</h2><ul><li><strong>Item</strong></li></ul>'))
      .toBe('<h2>Heading</h2><ul><li><strong>Item</strong></li></ul>');
  });

  test('converts sanitized line breaks back to plain text for editing', () => {
    expect(blogContentForEditing('First<br>Second<script>bad()</script>'))
      .toBe('First\nSecond&lt;script&gt;bad()&lt;/script&gt;');
  });

  test('removes UI-redress styles and image-based same-origin request gadgets', () => {
    const result = sanitizeBlogContent(
      '<span style="position:fixed;inset:0">Overlay</span>'
      + '<img src="/budget/delete_all">'
      + '<img src="/img/example.png" onerror="alert(1)">'
    );

    expect(result).toContain('<span>Overlay</span>');
    expect(result).not.toContain('position:fixed');
    expect(result).not.toContain('/budget/delete_all');
    expect(result).toContain('<img src="/img/example.png" loading="lazy" />');
    expect(result).not.toContain('onerror');
  });
});
