const fs = require('fs');
const path = require('path');

describe('Chat3 client rendering safeguards', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/chat3.js'), 'utf8');

  test('renders conversation titles and attributes through DOM properties', () => {
    expect(source).toContain("link.textContent = String(d.Title || 'Untitled')");
    expect(source).toContain("link.title = String(d.last_message || '')");
    expect(source).not.toMatch(/history_(?:list|modal)\.innerHTML\s*\+=/);
  });

  test('does not interpolate attachment URLs or inline event handlers', () => {
    expect(source).toContain("normalizeLocalMediaPath(thread[i].img, '/img/')");
    expect(source).toContain("normalizeLocalMediaPath(thread[i].mp3, '/mp3/')");
    expect(source).not.toMatch(/onclick=/);
  });
});
