const fs = require('fs');
const path = require('path');
const pug = require('pug');
const domain = require('../../services/taric/historyDomain');
const { verified } = require('../helpers/taricHistoryFixture');

test('benchmark UI previews all matching pages, escapes names, downloads with CSRF and invalidates changed options', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(pug.renderFile(path.join(__dirname, '../../views/admin_taric_history.pug'), { csrfToken: 'synthetic-csrf' }),
    { url: 'http://localhost/admin/taric/history?review=verified&mode=test', runScripts: 'outside-only' });
  try {
    const row = verified(); const attack = '<img src=x onerror="window.compromised=true">';
    const preview = { summary: { available: 530, selected: 500, distinctCodes: 20, excluded: 30, excludedByReason: { duplicate_product_or_input: 30 }, perCode: {} },
      bytes: 150000, sha256: 'b'.repeat(64), snapshotHash: 'a'.repeat(64), trainingReference: { id: 'v0' },
      selected: [{ id: row.id, name: attack, jan: row.inputs.jan, target: row.review.target }], skipped: [] };
    let pending;
    dom.window.fetch = jest.fn(async (url, opts) => {
      if (url.endsWith('/benchmark/preview')) {
        if (pending) await pending;
        return { ok: true, json: async () => preview };
      }
      if (url.endsWith('/benchmark/download')) return { ok: true, blob: async () => new dom.window.Blob(['synthetic CSV']), headers: { get: () => 'attachment; filename="taric-benchmark-bbbbbbbbbbbbbbbb.csv"' } };
      return { ok: true, json: async () => ({ rows: [row], stats: { ...domain.stats([row]), total: 530 }, snapshot: 'c'.repeat(64), next: `${row.createdAt}|${row.id}` }) };
    });
    dom.window.URL.createObjectURL = jest.fn(() => 'blob:synthetic'); dom.window.URL.revokeObjectURL = jest.fn();
    const downloads = [];
    dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
    const settle = () => new Promise(setImmediate);
    dom.window.eval(fs.readFileSync(path.join(__dirname, '../../public/js/taric-history.js'), 'utf8')); await settle();
    const doc = dom.window.document;
    expect(dom.window.fetch).toHaveBeenCalledTimes(1);
    expect(doc.querySelector('#benchmark-download').disabled).toBe(true);
    doc.querySelector('#next').click(); await settle();
    doc.querySelector('#benchmark-preview').click(); await settle();
    const call = dom.window.fetch.mock.calls.find(([url]) => url.endsWith('/benchmark/preview'));
    expect(JSON.parse(call[1].body)).toEqual({ filters: { mode: 'test', review: 'verified' }, options: { limit: 500 } });
    expect(call[1].headers['X-CSRF-Token']).toBe('synthetic-csrf');
    expect(doc.querySelector('#benchmark-content').textContent).toContain('530');
    expect(doc.querySelector('#benchmark-content').textContent).toContain(attack);
    expect(doc.querySelector('#benchmark-content img')).toBeNull();
    expect(doc.querySelector('#benchmark-download').disabled).toBe(false);
    doc.querySelector('#benchmark-download').click(); await settle();
    const download = dom.window.fetch.mock.calls.find(([url]) => url.endsWith('/benchmark/download'));
    expect(JSON.parse(download[1].body)).toMatchObject({ expectedSnapshotHash: preview.snapshotHash, options: { limit: 500 } });
    expect(download[1].headers['X-CSRF-Token']).toBe('synthetic-csrf');
    expect(downloads).toEqual(['taric-benchmark-bbbbbbbbbbbbbbbb.csv']);
    doc.querySelector('#benchmark-limit').value = '300';
    doc.querySelector('#benchmark-limit').dispatchEvent(new dom.window.Event('input'));
    expect(doc.querySelector('#benchmark-download').disabled).toBe(true);
    let resolve; pending = new Promise(done => { resolve = done; });
    doc.querySelector('#benchmark-preview').click(); await settle();
    doc.querySelector('[name=mode]').dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    resolve(); await settle();
    expect(doc.querySelector('#benchmark-download').disabled).toBe(true);
    expect(doc.querySelector('#benchmark-content').textContent).toBe('');
    pending = null; preview.summary.selected = 0;
    doc.querySelector('#benchmark-preview').click(); await settle();
    expect(doc.querySelector('#benchmark-download').disabled).toBe(true);
    dom.window.fetch.mockImplementationOnce(async () => ({ ok: false, status: 409, json: async () => ({ error: 'STALE' }) }));
    doc.querySelector('#benchmark-preview').click(); await settle();
    expect(doc.querySelector('#status').textContent).toContain('Snapshot changed');
  } finally { dom.window.close(); }
});
