const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { resolveImageReference, resolveImageUrl, PRIVATE_NAME } = require('../../public/js/libraryImageReference');
const privateName = 'gpt-image-private-11111111-2222-4333-8444-555555555555.png';
const privateUrl = `/gpt-image/media/${privateName}`;

const accepted = [
  ...['png', 'jpg', 'webp'].flatMap(extension => {
    const name = privateName.replace(/png$/, extension);
    return [name, `/gpt-image/media/${name}`, `/img/${name}`].map(ref => [ref, `/gpt-image/media/${name}`, true]);
  }),
  ['image-1716544082239-.jpg', '/img/image-1716544082239-.jpg', false],
  ['UP-upload-123.jpg', '/img/UP-upload-123.jpg', false],
  ['/img/legacy.png', '/img/legacy.png', false],
  ['photo (1).JPEG', '/img/photo%20(1).JPEG', false],
  ['/img/photo%20(1).JPEG', '/img/photo%20(1).JPEG', false],
  ['料理.webp', `/img/${encodeURIComponent('料理.webp')}`, false],
];
const rejected = [
  null, undefined, {}, [], 7, '', ' ', ' image.png', 'image.png\n',
  '../image.png', '/img/../image.png', '/img/%2e%2e/image.png', '/img/%252e%252e%252fimage.png',
  '/img/%2fimage.png', '/img/%5cimage.png', '/img/%00.png', '/img/%zz.png',
  '/img/image.png%0a', '/img/image.png%0d', '/img/image.png%E2%80%A8',
  `/img/${privateName}%0a`, `/img/${privateName}%0d`,
  'folder/image.png', 'folder\\image.png', '/img/folder/image.png',
  'https://example.test/image.png', '//example.test/image.png', '/admin/delete/image.png',
  'data:image/png;base64,AAA', 'javascript:alert(1)', 'image.svg', 'image.html',
  'image.png?x=1', '/img/image.png#fragment', '/img/image.png?x=1',
  'image.png" onerror="alert(1)', 'image\u0000.png', '/img/.hidden.png',
  'gpt-image-private-invalid.png', `gpt-image-private-${'a'.repeat(36)}.png`,
  privateUrl + '?download=1', privateUrl + '#fragment', privateUrl.replace('1111', '%31' + '111'),
  privateUrl.replace('.png', '.jpeg'), privateUrl.replace('/media/', '/media//'),
  `/img/${privateName.replace('1111', 'ZZZZ')}`, 'a'.repeat(241) + '.png',
];

test.each(accepted)('resolves supported reference %s', (reference, url, isPrivate) => {
  expect(resolveImageUrl(reference)).toBe(url);
  expect(resolveImageReference(reference)).toEqual({ fileName: decodeURIComponent(url.split('/').pop()), url, isPrivate });
  expect(resolveImageUrl(url)).toBe(url);
});
test.each(rejected)('rejects unsafe reference %p', reference => {
  expect(resolveImageReference(reference)).toBeNull();
  expect(resolveImageUrl(reference)).toBeNull();
});
test('server and browser run the same resolver; private names match the delivery contract', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../public/js/libraryImageReference.js'), 'utf8'), context);
  for (const [reference, url] of accepted) expect(context.window.LibraryImages.resolveImageUrl(reference)).toBe(url);
  for (const reference of rejected) expect(context.window.LibraryImages.resolveImageUrl(reference)).toBeNull();
  expect(require('../../services/gptImageStorageService').PRIVATE_NAME).toBe(PRIVATE_NAME);
});
