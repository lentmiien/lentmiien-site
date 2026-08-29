const { resolveLocalRedirect } = require('../../utils/localRedirect');

describe('resolveLocalRedirect', () => {
  test('preserves normal local paths', () => {
    expect(resolveLocalRedirect('/bookmarks?view=compact#saved', '/fallback'))
      .toBe('/bookmarks?view=compact#saved');
  });

  test.each([
    'https://attacker.example/path',
    '//attacker.example/path',
    '/\\attacker.example/path',
    '/%5c%5cattacker.example/path',
    '/safe\r\nLocation: https://attacker.example',
  ])('rejects unsafe redirect target %s', (value) => {
    expect(resolveLocalRedirect(value, '/fallback')).toBe('/fallback');
  });
});
