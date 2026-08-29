const {
  getFirstPathSegment,
  targetsProtectedStaticDirectory,
} = require('../../utils/protectedStaticPath');

describe('protected static path detection', () => {
  const protectedDirectories = new Set(['audio', 'mp3', 'temp']);

  test.each([
    '/mp3/private.mp3',
    '/mp%33/private.mp3',
    '/%6dp3/private.mp3',
    '/mp3%2fprivate.mp3',
    '//public/../mp3/private.mp3',
    '/public/%2e%2e/mp3/private.mp3',
    '/public%5c..%5cmp3%5cprivate.mp3',
    'http://example.test/mp%33/private.mp3',
  ])('recognizes protected directory variants: %s', (requestUrl) => {
    expect(targetsProtectedStaticDirectory(requestUrl, protectedDirectories)).toBe(true);
  });

  test('does not classify similarly named public directories as protected', () => {
    expect(targetsProtectedStaticDirectory('/mp30/example.txt', protectedDirectories)).toBe(false);
    expect(getFirstPathSegment('/blog?next=/mp3/private.mp3')).toBe('blog');
  });

  test('rejects malformed encodings and null bytes', () => {
    expect(() => getFirstPathSegment('/mp3/%E0%A4%A')).toThrow(URIError);
    expect(() => getFirstPathSegment('/mp3/%00file')).toThrow(URIError);
  });
});
