const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { serializeForInlineScript } = require('../../utils/safeJson');
const { resolveImageUrl } = require('../../public/js/libraryImageReference');
const privateName = 'gpt-image-private-11111111-2222-4333-8444-555555555555.png';
const privateUrl = `/gpt-image/media/${privateName}`;
const locals = { loggedIn: true, permissions: [], bookmarks: [], htmlPaths: [], gtag: false, resolveImageUrl, safeJson: serializeForInlineScript };
let window;
async function openView(view, data) {
  const { JSDOM } = await import('jsdom');
  const html = pug.renderFile(path.join(__dirname, '../../views', view + '.pug'), { ...locals, ...data });
  window = new JSDOM(html, { url: 'https://site.invalid', runScripts: 'outside-only' }).window;
  // Let jsdom's initial lifecycle finish before installing app listeners.
  await new Promise(resolve => setImmediate(resolve));
  const scripts = Array.from(window.document.querySelectorAll('script[src]'), script => script.getAttribute('src'));
  expect(scripts).toContain('/js/libraryImageReference.js');
  expect(scripts.indexOf('/js/libraryImageReference.js')).toBeLessThan(scripts.indexOf(view === 'knowledge_list' ? '/js/knowledge_list.js' : '/cooking_index.js'));
  evaluate('/js/libraryImageReference.js');
}
function evaluate(asset) { window.eval(fs.readFileSync(path.join(__dirname, '../../public', asset), 'utf8')); }
async function settle() { for (let index = 0; index < 4; index += 1) await new Promise(resolve => setImmediate(resolve)); }
afterEach(() => window?.close());

test('Knowledge Library preview resolves private and public images and skips hostile sources', async () => {
  await openView('knowledge_list', {
    knowledges: [
      [privateName, privateUrl, '/img/legacy.png'],
      ['UP-upload.jpg', '/admin/action.png', 'https://example.test/remote.png'],
      ['/img/%2e%2e/escape.png'],
    ].map((images, index) => ({ _id: String(index), title: 'Fixture', category: 'Recipe', displayCategory: 'Recipe', tags: [], images })),
    knowledge_categories: ['Recipe'], knowledge_tags: [],
  });
  evaluate('/js/knowledge_list.js');
  window.document.querySelectorAll('.knowledge-preview-btn').forEach(button => button.click());
  expect(Array.from(window.document.querySelectorAll('.knowledge-preview img'), img => img.getAttribute('src'))).toEqual([privateUrl, privateUrl, '/img/legacy.png', '/img/UP-upload.jpg']);
});

test.each([
  [privateName, privateUrl],
  [privateUrl, privateUrl],
  ['/img/legacy.png', '/img/legacy.png'],
  ['legacy.jpg', '/img/legacy.jpg'],
  ['/admin/action.png', null],
  ['https://example.test/image.png', null],
])('calendar renders initial and post-create refresh safely for %s', async (image, expectedUrl) => {
  await openView('cooking_index', { initialDate: '2026-01-01', categories: ['Lunch'] });
  window.COOKING_CALENDAR_V2 = { initialDate: '2026-01-01', categories: ['Lunch'] };
  const recipe = { id: 'a'.repeat(24), title: 'Fixture', image, imageUrl: resolveImageUrl(image), viewPath: '/cooking/cookbook/' + 'a'.repeat(24) };
  let created = false;
  window.fetch = jest.fn(async (url, options = {}) => {
    const pathname = new URL(url, window.location.origin).pathname;
    let data;
    if (pathname.endsWith('/calendar')) {
      data = { range: { start: '2026-01-01' }, days: [{ date: '2026-01-01', weekday: 'Thursday', entries: [{ entryId: 'b'.repeat(24), recipe, category: 'Lunch' }, ...(created ? [{ entryId: 'c'.repeat(24), recipe, category: 'Lunch' }] : [])] }] };
    } else if (pathname.endsWith('/recipes')) {
      await new Promise(resolve => setImmediate(resolve));
      data = { recipes: [recipe], categories: ['Lunch'] };
    } else {
      expect(options.method).toBe('POST');
      created = true;
      data = { status: 'created', entry: { recipe } };
    }
    return { ok: true, json: async () => data };
  });
  evaluate('/cooking_index.js');
  window.document.dispatchEvent(new window.Event('DOMContentLoaded'));
  await settle();
  const sources = () => Array.from(window.document.querySelectorAll('#calendarDays img'), img => img.getAttribute('src'));
  expect(sources()).toEqual(expectedUrl ? [expectedUrl] : []);
  window.document.querySelector('[data-action="open-modal"]').click();
  window.document.querySelector('.recipe-list [data-recipe-id]').click();
  window.document.getElementById('scheduleRecipe').click();
  await settle();
  expect(created).toBe(true);
  expect(sources()).toEqual(expectedUrl ? [expectedUrl, expectedUrl] : []);
});
