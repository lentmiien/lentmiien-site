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
});
