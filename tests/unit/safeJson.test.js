const {
  escapeInlineScriptText,
  serializeForInlineScript,
} = require('../../utils/safeJson');

describe('safeJson', () => {
  test('prevents script element breakouts without changing parsed values', () => {
    const value = { text: '</script><script>alert(1)</script>&' };
    const serialized = serializeForInlineScript(value);

    expect(serialized).not.toContain('<');
    expect(serialized).not.toContain('>');
    expect(serialized).not.toContain('&');
    expect(JSON.parse(serialized)).toEqual(value);
  });

  test('escapes JSON that was serialized before reaching the view', () => {
    const serialized = '{"label":"</script>"}';
    const escaped = escapeInlineScriptText(serialized);

    expect(escaped).toBe('{"label":"\\u003c/script\\u003e"}');
    expect(JSON.parse(escaped)).toEqual({ label: '</script>' });
  });
});
