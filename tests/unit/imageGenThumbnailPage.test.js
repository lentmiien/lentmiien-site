const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { createRequire } = require('module');
const { JSDOM } = createRequire(__filename)('jsdom');
const locals = { loggedIn: true, permissions: ['image_gen'], htmlPaths: [], bookmarks: [], pinnedId: null };
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
let dom;
afterEach(() => dom?.window.close());
function page(view, script, payload) {
  const html = pug.renderFile(path.join(__dirname, '../../views/image_gen', view), locals);
  dom = new JSDOM(html, { url: 'https://fixture.invalid/image_gen', runScripts: 'outside-only' });
  dom.window.fetch = jest.fn(async url => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => payload(url) }));
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../../public/js', script), 'utf8'));
  return dom.window.document;
}
test('input images use thumbnails, Open uses originals, other media preserve their previews', async () => {
  const doc = page('index.pug', 'image_gen.js', url => url.includes('/api/files/input?') ? {
    files: ['photo.png', 'sound.wav', 'movie.mp4', 'document.pdf'].map(filename => ({ path: `folder/${filename}`, filename })),
    total: 4, pages: 1, page: 1,
  } : {});
  await flush();
  const image = doc.querySelector('#inputGrid img');
  expect(image.getAttribute('src')).toBe('/image_gen/api/files/input/thumbnail?path=folder%2Fphoto.png');
  expect(doc.querySelector('#inputGrid a').getAttribute('href')).toBe('/image_gen/api/files/input/view?path=folder%2Fphoto.png');
  for (const element of doc.querySelectorAll('#inputGrid audio, #inputGrid video, #inputGrid iframe')) {
    expect(element.getAttribute('src')).toContain('/image_gen/api/files/input/view?path=');
  }
  image.dispatchEvent(new dom.window.Event('error'));
  expect(doc.querySelector('#inputGrid img')).toBeNull();
  expect(doc.querySelector('.input-card__preview').textContent).toBe('Preview unavailable');
  expect(doc.querySelector('#inputGrid a').textContent).toBe('Open');
});
test('gallery and pinned cards request only thumbnails, retain Open and pagination, and fail lightly', async () => {
  const id = 'a'.repeat(24), pinnedId = 'b'.repeat(24);
  const make = imageId => ({ id: imageId, filename: 'fixture.png', public_url: '/img/fixture.png',
    thumbnail_url: `/image_gen/api/good-images/${imageId}/thumbnail` });
  const doc = page('good_gallery.pug', 'image_gen_good.js', () => ({ items: [make(id)], pinned: make(pinnedId), page: 1, total_pages: 2, total_items: 17 }));
  await flush();
  const cards = doc.querySelectorAll('.good-card');
  expect(cards).toHaveLength(2);
  expect(doc.querySelector('.pinned')).not.toBeNull();
  for (const card of cards) {
    const image = card.querySelector('img');
    expect(image.getAttribute('src')).toMatch(/^\/image_gen\/api\/good-images\/[a-f\d]{24}\/thumbnail$/);
    expect(card.querySelector('a').href).toBe('https://fixture.invalid/img/fixture.png');
    expect(card.querySelector('a').textContent).toBe('Open');
    image.dispatchEvent(new dom.window.Event('error'));
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.good-thumb-unavailable').textContent).toBe('Preview unavailable');
  }
  expect(doc.querySelector('#goodNext').disabled).toBe(false);
  doc.querySelector('#goodNext').click();
  await flush();
  expect(dom.window.fetch.mock.calls[1][0]).toContain('page=2');
});
test('missing or malicious thumbnail metadata never requests original/remote URLs', async () => {
  const doc = page('good_gallery.pug', 'image_gen_good.js', () => ({ items: [
    { id: 'a'.repeat(24), download_url: 'https://remote.invalid/large.png' },
    { id: 'b'.repeat(24), thumbnail_url: '/admin/danger', public_url: 'javascript:alert(1)' },
  ] }));
  await flush();
  expect(doc.querySelectorAll('.good-card img')).toHaveLength(0);
  expect(doc.querySelectorAll('.good-thumb-unavailable')).toHaveLength(2);
  const links = doc.querySelectorAll('.good-card a');
  expect(links).toHaveLength(1);
  expect(links[0].href).toBe('https://remote.invalid/large.png');
});
