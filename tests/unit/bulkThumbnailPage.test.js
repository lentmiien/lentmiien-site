const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { createRequire } = require('module');
const { JSDOM } = createRequire(__filename)('jsdom');
const jobId = 'a'.repeat(24), id = 'b'.repeat(24);
const thumbnail = `/image_gen/api/bulk/jobs/${jobId}/prompts/${id}/thumbnail`;
const original = '/imgen/instance-1/result.png';
const download = '/image_gen/api/files/output/result.png?instance_id=instance-1';
const item = { id, filename: 'result.png', media_type: 'image', cached_url: original, download_url: download,
  thumbnail_url: thumbnail, template_label: 'One', score_total: 1, score_count: 1, score_average: 1 };
const video = { ...item, id: 'c'.repeat(24), filename: 'movie.mp4', media_type: 'video', cached_url: '/video/movie.mp4' };
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
let dom, timer;
afterEach(() => dom?.window.close());
function page(name, payload) {
  const html = pug.renderFile(path.join(__dirname, `../../views/image_gen/${name}.pug`), {
    jobId, loggedIn: true, permissions: ['image_gen'], htmlPaths: [], bookmarks: [],
  });
  dom = new JSDOM(html, { url: `https://site.invalid/image_gen/bulk/${jobId}`, runScripts: 'outside-only' });
  dom.window.setInterval = callback => { timer = callback; return 1; };
  dom.window.fetch = jest.fn(async (url, options) => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => payload(url, options) }));
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../../public/js/thumbnail_preview.js'), 'utf8'));
  dom.window.eval(fs.readFileSync(path.join(__dirname, `../../public/js/image_gen_${name}.js`), 'utf8'));
  return dom.window.document;
}
function jobData(url) {
  if (url.includes('/gallery/rate')) return { ok: true };
  if (url.includes('/gallery?')) return { items: [item, video], total: 2, returned: 2 };
  if (url.includes('/matrix?')) return { varA: 'template', varB: 'negative', cols: ['No negative'],
    data: [{ value: 'One', columns: [{ prompts: [item], average_score: 1 }] }] };
  if (url.includes('/prompts?')) return { items: [{ ...item, status: 'Completed' }] };
  return { job: { status: 'Processing', name: 'Fixture', variables_available: ['template', 'negative'],
    prompt_templates: [{ label: 'One' }], counters: { completed: 1, processing: 1, total: 2 } } };
}
function expectPreview(doc, selector, href) {
  const image = doc.querySelector(selector);
  expect(image).not.toBeNull();
  expect(image.getAttribute('src')).toBe(thumbnail);
  const link = image.closest('a');
  expect(link.getAttribute('href')).toBe(href);
  expect(link.target).toBe('_blank');
  expect(link.rel).toBe('noopener noreferrer');
  expect(link.querySelector('button, input, select, video[controls]')).toBeNull();
  return image;
}
test('bulk initial gallery/matrix and filter, rating and timed refresh paths retain previews and controls', async () => {
  const doc = page('bulk_job', jobData);
  await flush();
  expectPreview(doc, '#galleryGrid img', original);
  expectPreview(doc, '#matrixArea img', download);
  expect(doc.querySelector('#galleryGrid video').getAttribute('src')).toBe('/video/movie.mp4');
  expect(doc.querySelector('#galleryGrid video').closest('a')).toBeNull();
  expect(doc.querySelector('#galleryGrid video').controls).toBe(true);
  expect(doc.querySelector('#galleryRatingControls').classList.contains('d-none')).toBe(false);
  const filter = doc.querySelector('#gallery-filter-template');
  filter.value = 'One';
  doc.querySelector('#galleryFilterForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();
  expect(dom.window.fetch.mock.calls.some(([url]) => url.includes('filters=') && decodeURIComponent(url).includes('One'))).toBe(true);
  expectPreview(doc, '#galleryGrid img', original);
  doc.querySelector('input[name="galleryRating"][value="good"]').checked = true;
  doc.querySelector('#galleryRateForm').dispatchEvent(new dom.window.Event('submit', { cancelable: true }));
  await flush();
  expectPreview(doc, '#galleryGrid img', original);
  expect(doc.querySelector('.gallery-meta').textContent).toContain('Score 1.00 (2)');
  expect(doc.querySelector('#galleryRatingControls').classList.contains('d-none')).toBe(true);
  const [, rating] = dom.window.fetch.mock.calls.find(([url]) => url.endsWith('/gallery/rate'));
  expect(JSON.parse(rating.body).prompt_ids).toEqual([id, video.id]);
  doc.querySelector('#refreshMatrixBtn').click();
  await flush();
  expectPreview(doc, '#matrixArea img', download);
  timer();
  await flush();
  expectPreview(doc, '#matrixArea img', download);
  const image = expectPreview(doc, '#galleryGrid img', original);
  image.dispatchEvent(new dom.window.Event('error'));
  expect(doc.querySelector('#galleryGrid img')).toBeNull();
  expect(doc.querySelector('#galleryGrid .thumbnail-unavailable').closest('a').getAttribute('href')).toBe(original);
  doc.querySelector('#galleryResetBtn').click();
  await flush();
  expectPreview(doc, '#galleryGrid img', original);
});
test('analytics top and low-defect dynamic grids preserve chart/statistics and video behavior', async () => {
  const payload = { job: { name: 'Fixture', counters: { completed: 2 } }, overall: { total_prompts: 2, avg_score: 1 },
    defectBuckets: [{ label: 'Defect 0', count: 1 }], topImages: [item, video], lowDefectImages: [item] };
  const doc = page('bulk_analytics', () => payload);
  await flush();
  for (const selector of ['#topImagesGrid img', '#lowDefectImagesGrid img']) {
    const image = expectPreview(doc, selector, original);
    image.dispatchEvent(new dom.window.Event('error'));
  }
  expect(doc.querySelectorAll('.thumbnail-unavailable')).toHaveLength(2);
  expect(doc.querySelector('#topImagesGrid video').controls).toBe(true);
  expect(doc.querySelector('#topImagesGrid video').closest('a')).toBeNull();
  expect(doc.querySelector('#metricTotal').textContent).toBe('2');
  expect(doc.querySelector('#defectBucketList').textContent).toContain('Defect 0');
  // Analytics has one asynchronous fetch per page load, no refresh timer or image charts.
  expect(dom.window.fetch).toHaveBeenCalledTimes(1);
});
test.each(['bulk_job', 'bulk_analytics'])('%s missing/malicious thumbnail metadata never loads originals', async name => {
  const invalid = { ...item, thumbnail_url: '/admin/danger' };
  const missing = { ...item, thumbnail_url: undefined, download_url: 'javascript:bad()', cached_url: '' };
  const doc = page(name, url => name === 'bulk_job'
    ? url.includes('/gallery?') ? { items: [invalid, missing] } : jobData(url)
    : { topImages: [invalid, missing] });
  await flush();
  const grid = doc.querySelector(name === 'bulk_job' ? '#galleryGrid' : '#topImagesGrid');
  expect(grid.querySelectorAll('img')).toHaveLength(0);
  expect(grid.querySelectorAll('.thumbnail-unavailable')).toHaveLength(2);
  expect(grid.querySelector('.thumbnail-unavailable').closest('a').getAttribute('href')).toBe(original);
  expect(grid.querySelectorAll('.thumbnail-unavailable')[1].closest('a')).toBeNull();
});
