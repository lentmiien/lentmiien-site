const {
  escapeHtml,
  renderMarkdownSafe,
  renderMessageHtml,
} = require('../../utils/chat5Markdown');

describe('chat5Markdown', () => {
  test('escapes raw html characters correctly', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });

  test('preserves markdown image syntax as a safe img tag', () => {
    const output = renderMarkdownSafe('![Generated image 1](/img/example.png)');
    expect(output).toContain('<img');
    expect(output).toContain('src="/img/example.png"');
    expect(output).toContain('alt="Generated image 1"');
    expect(output).not.toContain('&lt;img');
  });

  test('treats raw html image tags as text instead of executable html', () => {
    const output = renderMarkdownSafe('<img src="/img/example.png" onerror="alert(1)">');
    expect(output).toContain('&lt;img');
    expect(output).not.toContain('<img src="/img/example.png"');
  });

  test('renders full html documents as code blocks', () => {
    const output = renderMarkdownSafe('<!doctype html><html><body><h1>Title</h1></body></html>');
    expect(output).toContain('<pre>');
    expect(output).toContain('&lt;!doctype html&gt;');
    expect(output).toContain('&lt;h1&gt;Title&lt;/h1&gt;');
  });

  test('adds rendered html to message content when text exists', () => {
    const message = {
      content: {
        text: '![Generated image 1](/img/example.png)',
      },
    };

    renderMessageHtml(message);

    expect(message.content.html).toContain('<img');
    expect(message.content.html).toContain('src="/img/example.png"');
  });

  test('preserves normal GFM rendering alongside math support', () => {
    const output = renderMarkdownSafe([
      '## Heading',
      '',
      'Normal **bold** text and a [link](https://example.com).',
      '',
      '- item one',
      '- item two',
      '',
      '> quoted text',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| one | two |',
    ].join('\n'));

    expect(output).toContain('<h2>Heading</h2>');
    expect(output).toContain('<strong>bold</strong>');
    expect(output).toContain('href="https://example.com"');
    expect(output).toContain('<ul>');
    expect(output).toContain('<blockquote>');
    expect(output).toContain('<table>');
  });

  test.each([
    ['bracket display math', String.raw`\[
T_P=\frac{p}{0.70}\qquad \text{when }p\leq0.70l
\]`],
    ['dollar display math', String.raw`$$
\int_0^1 x^2\,dx = \frac{1}{3}
$$`],
  ])('renders %s with KaTeX display markup', (name, markdown) => {
    const output = renderMarkdownSafe(markdown);

    expect(output).toContain('class="katex-display"');
    expect(output).toContain('class="katex"');
    expect(output).not.toContain('<p>');
  });

  test.each([
    ['bracket inline math', String.raw`Einstein wrote \(E = mc^2\).`],
    ['dollar inline math', 'Einstein wrote $E = mc^2$.'],
  ])('renders %s without display layout', (name, markdown) => {
    const output = renderMarkdownSafe(markdown);

    expect(output).toContain('Einstein wrote <span class="katex">');
    expect(output).not.toContain('class="katex-display"');
  });

  test('leaves currency and escaped dollar signs as ordinary text', () => {
    const output = renderMarkdownSafe(String.raw`This costs $19.99, not $20. A fee of $ 5 is waived; write \$x to show it literally.`);

    expect(output).toContain('This costs $19.99, not $20.');
    expect(output).toContain('A fee of $ 5 is waived; write $x to show it literally.');
    expect(output).not.toContain('class="katex"');
  });

  test('does not render math delimiters inside any Markdown code form', () => {
    const output = renderMarkdownSafe([
      'Inline code: `$x^2$` and `\\(y^2\\)`',
      '',
      '```js',
      'const example = "$x^2$";',
      'const bracket = "\\\\[y^2\\\\]";',
      '```',
      '',
      '    $$notMath$$',
      '    \\(alsoNotMath\\)',
    ].join('\n'));

    expect(output).toContain('<code>$x^2$</code>');
    expect(output).toContain('<code>\\(y^2\\)</code>');
    expect(output).toContain('const example = "$x^2$";');
    expect(output).toContain('$$notMath$$');
    expect(output).toContain('\\(alsoNotMath\\)');
    expect(output).not.toContain('class="katex"');
  });

  test('renders malformed LaTeX non-fatally and continues with following Markdown', () => {
    const output = renderMarkdownSafe(String.raw`\[
\notARealCommand{
\]

The rest is still **rendered**.`);

    expect(output).toContain('class="katex-error"');
    expect(output).toContain('\\notARealCommand{');
    expect(output).toContain('The rest is still <strong>rendered</strong>.');
  });

  test('sanitizes untrusted HTML after KaTeX and Markdown rendering', () => {
    const output = renderMarkdownSafe(String.raw`\(x^2\) <script>alert('xss')</script>`);

    expect(output).toContain('class="katex"');
    expect(output).toContain('&lt;script&gt;');
    expect(output).not.toContain('<script>');
  });
});
