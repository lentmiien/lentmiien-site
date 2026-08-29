const { sanitizeEmailPreviewHtml } = require('../../utils/emailPreview');

describe('sanitizeEmailPreviewHtml', () => {
  test('keeps passive formatting while removing scripts and network-capable attributes', () => {
    const result = sanitizeEmailPreviewHtml(`
      <style>body { background: url(https://tracker.example/style); }</style>
      <script>window.top.location = 'https://attacker.example';</script>
      <p style="background:url(https://tracker.example/css)">Hello <strong>there</strong></p>
      <a href="https://attacker.example/click">link</a>
      <img src="https://tracker.example/pixel" onerror="alert(1)">
      <form action="https://attacker.example/post"><input name="secret"></form>
    `);

    expect(result).toContain('<p>Hello <strong>there</strong></p>');
    expect(result).toContain('<a>link</a>');
    expect(result).not.toMatch(/script|style=|href=|src=|form|input|tracker\.example|attacker\.example/);
  });
});
