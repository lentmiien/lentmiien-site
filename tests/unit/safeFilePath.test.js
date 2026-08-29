const path = require('path');
const {
  createSafeUploadName,
  resolveFileWithinDirectory,
} = require('../../utils/safeFilePath');

describe('safeFilePath', () => {
  const root = path.join(path.sep, 'srv', 'app', 'tmp_data');

  test('creates an unpredictable name without retaining path components', () => {
    const first = createSafeUploadName('../../private.png');
    const second = createSafeUploadName('../../private.png');

    expect(first).toMatch(/^\d+-[0-9a-f-]{36}\.png$/);
    expect(second).not.toBe(first);
    expect(first).not.toContain('private');
  });

  test('resolves direct children inside the configured directory', () => {
    expect(resolveFileWithinDirectory(root, 'image.png', { directChild: true }))
      .toBe(path.join(root, 'image.png'));
  });

  test.each([
    '../secret.png',
    '../../secret.png',
    'nested/secret.png',
    'nested\\secret.png',
    path.join(path.sep, 'etc', 'passwd'),
  ])('rejects a path outside the direct upload directory: %s', (candidate) => {
    expect(() => resolveFileWithinDirectory(root, candidate, { directChild: true }))
      .toThrow();
  });
});
