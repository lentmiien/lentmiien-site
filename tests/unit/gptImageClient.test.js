const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { buildPageData } = require('../../controllers/gptImageController');
const { DEFAULT_FORM_VALUES } = require('../../services/gptImageService');
const { STUDIO_MODEL_NAME } = require('../../services/gptImageModels');
let dom, window, document;
beforeEach(async () => {
  const { JSDOM } = await import('jsdom');
  const config = buildPageData({
    gallery: { totalCount: 1, currentPage: 1, items: [{ id: 'a'.repeat(24), modelLabel: 'GPT Image 2', prompt: '</script><script>bad()</script>', outputUrl: '/img/legacy.png', createdAt: new Date(), createdBy: 'Other' }] },
    filters: {}, formDefaults: { ...DEFAULT_FORM_VALUES, model: STUDIO_MODEL_NAME },
  });
  const html = pug.renderFile(path.join(__dirname, '../../views/gpt_image/index.pug'), { pageLang: 'en', loggedIn: true, csrfToken: 'A'.repeat(43), ...config });
  dom = new JSDOM(html, { url: 'https://site.invalid/gpt-image', runScripts: 'outside-only' });
  window = dom.window; document = window.document;
  window.fetch = jest.fn().mockResolvedValue({ ok: false, text: async () => '{"ok":false,"error":"Synthetic stop"}' });
  window.eval(fs.readFileSync(path.join(__dirname, '../../public/js/gpt_image.js'), 'utf8'));
});
afterEach(() => window?.close());
function change(id, value) {
  const input = document.getElementById(id); input.value = value; input.dispatchEvent(new window.Event('change')); return input;
}
function options(id) { return Array.from(document.getElementById(id).options, option => option.value); }
test('renders model labels, escaped prompts and no analytics; default is Sunburst', () => {
  expect(document.getElementById('gptImageModel').value).toBe(STUDIO_MODEL_NAME);
  expect(document.querySelector('.gpt-image-card__meta').textContent).toContain('GPT Image 2');
  expect(document.querySelector('.gpt-image-card__prompt').textContent).toContain('</script>');
  expect(document.querySelector('script[src*="googletagmanager"]')).toBeNull();
  expect(options('gptImageQuality')).toContain('max');
  expect(document.getElementById('gptImageCompression').disabled).toBe(true);
});
test('model and format changes remove unsupported options', () => {
  change('gptImageQuality', 'max'); change('gptImageBackground', 'transparent');
  change('gptImageModel', 'gpt-image-2');
  expect(options('gptImageQuality')).not.toContain('max');
  expect(document.getElementById('gptImageQuality').value).toBe('auto');
  expect(options('gptImageBackground')).not.toContain('transparent');
  change('gptImageModel', 'gpt-image-2.5-flare');
  expect(options('gptImageQuality')).toContain('xhigh');
  change('gptImageOutputFormat', 'jpeg');
  expect(options('gptImageBackground')).not.toContain('transparent');
  expect(document.getElementById('gptImageCompression').disabled).toBe(false);
  change('gptImageOutputFormat', 'webp');
  expect(options('gptImageBackground')).toContain('transparent');
});
test('reference selection and generation preserve ID and send header CSRF, omitting PNG compression', async () => {
  document.querySelector('[data-select-input]').click();
  document.getElementById('gptImageForm').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await Promise.resolve();
  const [url, request] = window.fetch.mock.calls[0];
  expect(url).toBe('/gpt-image/api/generate');
  expect(request.headers['X-CSRF-Token']).toBe('A'.repeat(43));
  expect(request.body.get('model')).toBe(STUDIO_MODEL_NAME);
  expect(request.body.get('selectedImageIds')).toBe('a'.repeat(24));
  expect(request.body.has('outputCompression')).toBe(false);
});
test('likes carry shared CSRF token', async () => {
  document.querySelector('[data-like-button]').click();
  await Promise.resolve();
  expect(window.fetch).toHaveBeenCalledWith(expect.stringContaining('/like'), expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-CSRF-Token': 'A'.repeat(43) }) }));
});
