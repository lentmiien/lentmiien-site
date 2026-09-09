const { prepareSpeechText: prepare, PREPARATION_VERSION } = require('../../utils/miienSpeechText');
test.each([
  ['# Welcome\n\n**Hello** *friend*.\n- Read [the guide](https://example.invalid/path).\n- Enjoy `tea`.', 'Welcome\nHello friend.\nRead the guide.\nEnjoy tea.'],
  ['***Hello _friend_***, ~~old~~ new. **unfinished and \\*literal\\*', 'Hello friend, old new. unfinished and literal'],
  ['> A quotation.\n>\n> A second paragraph.\n\n1. First\n2. Second\n   - Nested', 'A quotation.\nA second paragraph.\nFirst\nSecond\nNested'],
  ['Read [a **useful** label][ref].\n\n[ref]: https://example.invalid/long?q=secret', 'Read a useful label.'],
  ['![private diagram](https://example.invalid/image) Visit <https://example.invalid> or www.example.invalid/noisy and <test@example.invalid>.', 'Visit or and .'],
  ['Before.\n```js\n' + 'x'.repeat(30000) + '\n```\nAfter.\n\n    const secret = 1;\n', 'Before.\nAfter.'],
  ['Use `simple name`, skip `const x = 1;` and `' + 'x'.repeat(81) + '`.', 'Use simple name, skip and .'],
  ['<div>Hello</div><div>World &amp; &#x1f431; &copy; &nbsp;tea.</div><script>SECRET</script><style>NOISE</style><img src="https://tracker.invalid" alt="hidden">', 'Hello\nWorld & 🐱 © tea.'],
  ['<pre>not spoken</pre><iframe>hidden</iframe><svg><text>hidden</text></svg><p>Visible</p>', 'Visible'],
  ['&lt;script&gt;inert&lt;/script&gt; &amp;lt;plain&amp;gt;', 'scriptinert/script &lt;plain&gt;'],
  ['| Item | Use |\n| --- | --- |\n| Tea | Relax |', 'Item\nUse\nTea\nRelax'],
  ['- [x] Done\n- [ ] Next', 'Done\nNext'],
  ['**unterminated _nested [label](https://example.invalid', 'unterminated nested label('],
])('prepares Markdown and HTML as inert spoken prose: %#', (raw, expected) => {
  expect(prepare(raw).preview).toBe(expected);
});
test.each(['```js\ncode\n```', '![image](https://example.invalid)', '<script>secret</script>', '** __ ~~', '<https://example.invalid>'])('empty material has no preview: %#', raw => {
  expect(prepare(raw)).toMatchObject({ preview: '', spokenCharacters: 0, truncated: false });
});
test('prepares the whole reply before counting/truncating; code and URL length do not consume preview', () => {
  const raw = '```\n' + 'x'.repeat(10000) + '\n```\n**' + '🐱'.repeat(599) + 'éZ**\n[tail](https://example.invalid/' + 'x'.repeat(1000) + ')';
  const result = prepare(raw);
  expect(result).toMatchObject({ preview: '🐱'.repeat(599) + 'é', spokenCharacters: 600, truncated: true, preparationVersion: PREPARATION_VERSION });
  expect(prepare('**' + '🐱'.repeat(600) + '**').truncated).toBe(false);
  expect(prepare('**' + '🐱'.repeat(601) + '**').preview).toBe('🐱'.repeat(600));
});
test('fingerprint covers version and whole content, including edits beyond preview or to markup only', () => {
  const raw = 'a'.repeat(601);
  expect(prepare(raw)).toEqual(prepare(raw));
  expect(prepare(raw).fingerprint).not.toBe(prepare(raw + 'b').fingerprint);
  expect(prepare('**Hi**').fingerprint).not.toBe(prepare('Hi').fingerprint);
});
test.each([null, 'x'.repeat(64001), '*a '.repeat(15000), '['.repeat(33) + 'nested', '>'.repeat(33) + 'quote', ' '.repeat(129) + 'deep'])('rejects raw size and excessive parser work: %#', raw => {
  expect(() => prepare(raw)).toThrow(/bounds/);
});
test('accepts the raw bound for simple prose', () => {
  expect(prepare('a'.repeat(64000))).toMatchObject({ spokenCharacters: 600, truncated: true });
});
