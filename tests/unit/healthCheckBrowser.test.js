const fs = require('fs');
const pug = require('pug');
const { JSDOM } = require('jsdom');
const { createService } = require('../../services/healthCheckService');
const analytics = fs.readFileSync('public/js/health-check-analytics.js', 'utf8');
const bodyAnalytics = fs.readFileSync('public/js/health-check-body.js', 'utf8');
const wait = () => new Promise(resolve => setImmediate(resolve));
function page(view) {
  const html = pug.renderFile(`views/${view}.pug`, { loggedIn: false, bookmarks: [], htmlPaths: [], csrfToken: 'a'.repeat(43) });
  const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://localhost/health-check' });
  dom.window.HTMLElement.prototype.scrollIntoView = () => {};
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
  return dom;
}
function sample(year = 2026, value = 25) {
  return { exam_date: `${year}-04-12`, overall_comment: '<script>alert(1)</script> synthetic note', sections: [], measurements: [{ id: 'one', name: 'Test <img src=x onerror=alert(1)>', original: 'R', category: 'Synthetic', value, unit: 'kg', reference_range: '0-20' }] };
}
test('dashboard defaults latest, switches years, keeps 13-year trends and renders untrusted strings as text', async () => {
  const dom = page('health_check'); const { window } = dom;
  window.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ exams: Array.from({ length: 13 }, (_, index) => sample(2014 + index, index + 15)) }) }));
  window.eval(analytics); window.eval(bodyAnalytics); window.eval(fs.readFileSync('public/js/health-check.js', 'utf8')); await wait();
  const doc = window.document;
  expect(doc.getElementById('hc-year').value).toBe('2026'); expect(doc.getElementById('hc-summary').value).toContain('2026-04-12');
  expect(doc.querySelectorAll('.hc-chart circle')).toHaveLength(13);
  expect(doc.querySelector('#hc-notes script')).toBeNull(); expect(doc.querySelector('#hc-trends img')).toBeNull();
  expect(doc.getElementById('hc-notes').textContent).toContain('<script>alert(1)</script>');
  doc.getElementById('hc-year').value = '2020'; doc.getElementById('hc-year').dispatchEvent(new window.Event('change'));
  expect(doc.getElementById('hc-summary').value).toContain('2020-04-12'); expect(doc.querySelectorAll('.hc-chart circle')).toHaveLength(13);
  doc.getElementById('hc-search').value = 'absent'; doc.getElementById('hc-search').dispatchEvent(new window.Event('input'));
  expect(doc.getElementById('hc-trends').textContent).toContain('No numeric trends');
  dom.window.close();
});
test('empty dashboard offers import and failed clipboard leaves selectable summary', async () => {
  const dom = page('health_check'); const { window } = dom;
  window.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ exams: [] }) }));
  window.eval(analytics); window.eval(bodyAnalytics); window.eval(fs.readFileSync('public/js/health-check.js', 'utf8')); await wait();
  expect(window.document.getElementById('hc-message').textContent).toContain('Import your first report'); dom.window.close();
  const second = page('health_check'); second.window.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ exams: [sample()] }) }));
  second.window.eval(analytics); second.window.eval(bodyAnalytics); second.window.eval(fs.readFileSync('public/js/health-check.js', 'utf8')); await wait();
  second.window.document.getElementById('hc-copy').click(); await wait();
  expect(second.window.document.getElementById('hc-copy-status').textContent).toContain('Select and copy'); second.window.close();
});
test('upload UI completes mapping, first save, repeat and per-field conflict resolution against real service', async () => {
  const dom = page('health_check_upload'); const { window } = dom; const doc = window.document;
  let stored; const model = {
    findOne: () => ({ lean: async () => stored ? structuredClone(stored) : null }),
    create: async data => { stored = structuredClone(data); },
    updateOne: async (filter, update) => { expect(filter.revision).toBe(stored.revision); stored = { ...stored, ...structuredClone(update.$set), revision: stored.revision + 1 }; return { matchedCount: 1 }; },
  };
  const service = createService(model);
  window.fetch = jest.fn(async (url, options) => {
    expect(options.headers['X-CSRF-Token']).toBe('a'.repeat(43));
    const action = url.split('/').at(-1); const body = JSON.parse(options.body);
    try { const result = action === 'commit' ? await service.commit('111111111111111111111111', body) : await service.review('111111111111111111111111', body, action === 'mapping'); return { ok: true, json: async () => result }; }
    catch (error) { return { ok: false, status: error.status, json: async () => ({ error: error.message }) }; }
  });
  window.eval(fs.readFileSync('public/js/health-check-upload.js', 'utf8'));
  let report = { exams: [{ exam_date: '2026-04-12', overall_comment: 'First notes', sections: [{ name: 'Synthetic', items: [{ name: 'Synthetic test', value: 1, unit: 'kg' }] }] }] };
  async function upload() {
    Object.defineProperty(doc.getElementById('hc-file'), 'files', { configurable: true, value: [{ size: 100, text: async () => JSON.stringify(report) }] });
    doc.getElementById('hc-file').dispatchEvent(new window.Event('change')); await wait();
    doc.getElementById('hc-map').click(); await wait();
    const select = doc.querySelector('#hc-mappings select');
    if (!select.value) { select.value = 'new'; select.dispatchEvent(new window.Event('change')); }
    doc.getElementById('hc-preview').click(); await wait();
  }
  await upload(); expect(doc.getElementById('hc-import-counts').textContent).toContain('1 new exams');
  doc.getElementById('hc-save').click(); await wait(); expect(stored.exams).toHaveLength(1); expect(stored.revision).toBe(1);
  await upload(); expect(doc.getElementById('hc-import-counts').textContent).toContain('0 changed fields');
  doc.getElementById('hc-save').click(); await wait(); expect(stored.revision).toBe(1);
  report.exams[0].overall_comment = '<b>New notes</b>'; report.exams[0].sections[0].items[0].value = 2;
  await upload(); expect(doc.querySelectorAll('.hc-conflict')).toHaveLength(2); expect(doc.querySelector('#hc-conflicts b')).toBeNull();
  doc.getElementById('hc-save').click(); await wait(); expect(doc.getElementById('hc-upload-message').textContent).toContain('every changed field'); expect(stored.revision).toBe(1);
  for (const fieldset of doc.querySelectorAll('.hc-conflict')) fieldset.querySelector('input[value=import]').checked = true;
  doc.getElementById('hc-save').click(); await wait(); expect(stored.revision).toBe(2); expect(stored.exams[0].measurements[0].value).toBe(2);
  expect(stored.exams[0].overall_comment).toBe('<b>New notes</b>'); dom.window.close();
});

test('trend cards filter by selected-exam flags, open every year in a dialog and restore focus', async () => {
  const dom = page('health_check'); const { window } = dom; const doc = window.document;
  const exams = Array.from({ length: 13 }, (_, index) => sample(2014 + index, index + 15));
  exams[12].measurements.push({ id: 'two', category: 'Body measurements', name: 'Weight', value: 70, unit: 'kg', reference_range: '60-80', rating: 'A' });
  window.fetch = async () => ({ ok: true, json: async () => ({ exams }) });
  window.eval(analytics); window.eval(bodyAnalytics); window.eval(fs.readFileSync('public/js/health-check.js', 'utf8')); await wait();
  expect(doc.querySelectorAll('.hc-trend-card')).toHaveLength(2);
  expect(doc.querySelector('#hc-trends table')).toBeNull();
  doc.querySelector('[data-filter="flagged"]').click();
  expect(doc.querySelectorAll('.hc-trend-card')).toHaveLength(1);
  const card = doc.querySelector('.hc-trend-card'); card.focus(); card.click();
  const dialog = doc.getElementById('hc-trend-dialog'); expect(dialog.open).toBe(true);
  expect(dialog.querySelectorAll('.hc-chart-point')).toHaveLength(13);
  expect(dialog.querySelectorAll('tbody tr')).toHaveLength(13);
  expect(dialog.querySelector('img')).toBeNull();
  dialog.querySelector('.hc-chart-point').dispatchEvent(new window.Event('focus'));
  expect(dialog.querySelector('.hc-chart-readout').textContent).toContain('2014');
  dialog.querySelector('[aria-label="Close trend details"]').click();
  expect(dialog.open).toBe(false); expect(doc.activeElement).toBe(card);
  expect(doc.body.classList.contains('hc-dialog-open')).toBe(false);
  doc.querySelector('[data-year="2014"]').click();
  expect(doc.querySelectorAll('.hc-trend-card')).toHaveLength(0);
  doc.querySelector('[data-filter="all"]').click();
  expect(doc.querySelectorAll('.hc-trend-card')).toHaveLength(2);
  expect(doc.getElementById('hc-trends').textContent).toContain('Not measured this exam');
  dom.window.close();
});

test('body map follows selected year, supports keyboard selection, and keeps uncertain anatomy separate', async () => {
  const dom = page('health_check'); const { window } = dom; const doc = window.document;
  const exams = [2025, 2026].map(year => ({ exam_date: `${year}-05-01`, sections: [{ name: 'Liver function', section_rating: year === 2026 ? 'C6' : 'A' }], measurements: [
    { id: 'liver', category: 'Liver function', name: 'ALT', value: year === 2026 ? 70 : 20, unit: 'U/L', reference_range: '0-30' },
    { id: 'rbc', category: 'Blood (hematology)', name: 'RBC', value: 500, rating: 'A' },
    ...(year === 2026 ? [{ id: 'renal', category: 'Urine', name: 'Protein', finding: 'Negative', rating: 'A' }] : []),
  ] }));
  window.fetch = async () => ({ ok: true, json: async () => ({ exams }) });
  window.eval(analytics); window.eval(bodyAnalytics); window.eval(fs.readFileSync('public/js/health-check.js', 'utf8')); await wait();
  expect(doc.querySelector('.hc-organ[data-area="liver"]').classList.contains('hc-tone-danger')).toBe(true);
  expect(doc.querySelector('.hc-organ[data-area="kidneys"]').classList.contains('hc-tone-success')).toBe(true);
  const kidney = doc.querySelector('.hc-organ[data-area="kidneys"]'); kidney.focus();
  kidney.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(doc.getElementById('hc-body-detail').textContent).toContain('Protein'); expect(doc.activeElement).toBe(kidney);
  doc.querySelector('[data-year="2025"]').click();
  expect(doc.querySelector('.hc-organ[data-area="liver"]').classList.contains('hc-tone-success')).toBe(true);
  expect(doc.querySelector('.hc-organ[data-area="kidneys"]').classList.contains('hc-tone-muted')).toBe(true);
  expect(doc.getElementById('hc-body-detail').textContent).toContain('No tests associated');
  doc.querySelector('.hc-area-button[data-area="systemic"]').click();
  expect(doc.getElementById('hc-body-detail').textContent).toContain('RBC');
  dom.window.close();
});

test('test sections begin collapsed, search opens matches, and note tabs support keyboard navigation', async () => {
  const dom = page('health_check'); const { window } = dom; const doc = window.document;
  window.fetch = async () => ({ ok: true, json: async () => ({ exams: [{ ...sample(), doctor_comment: 'Doctor note' }] }) });
  window.eval(analytics); window.eval(bodyAnalytics); window.eval(fs.readFileSync('public/js/health-check.js', 'utf8')); await wait();
  expect(doc.querySelector('.hc-category').open).toBe(false);
  doc.getElementById('hc-search').value = 'Test'; doc.getElementById('hc-search').dispatchEvent(new window.Event('input'));
  expect(doc.querySelector('.hc-category').open).toBe(true);
  const overall = doc.getElementById('hc-note-tab-overall_comment'); overall.focus();
  overall.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(doc.getElementById('hc-note-tab-doctor_comment').getAttribute('aria-selected')).toBe('true');
  expect(doc.getElementById('hc-note-panel-overall_comment').hidden).toBe(true);
  expect(doc.getElementById('hc-note-panel-doctor_comment').hidden).toBe(false);
  expect(doc.activeElement.id).toBe('hc-note-tab-doctor_comment');
  dom.window.close();
});
