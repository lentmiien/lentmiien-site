const fs = require('fs');
const path = require('path');
const pug = require('pug');
test('management page renders private source strings as inert text and starts closed', async () => {
  const { JSDOM } = await import('jsdom');
  const attack = '</textarea><img src=x onerror="window.compromised=true"><script>window.compromised=true</script>';
  const html = pug.renderFile(path.join(__dirname, '../../views/admin_taric.pug'), { csrfToken: 'synthetic-csrf' });
  const dom = new JSDOM(html, { url: 'http://localhost/admin/taric', runScripts: 'outside-only' });
  dom.window.fetch = jest.fn(async () => ({ ok: true, json: async () => ({
    normal: { ready: false, reason: 'RELEASE_CLOSED' }, test: { ready: false },
    settings: { enabled: false, runtime: { adapters: [{ trustSource: attack }] }, catalog: null },
    credential: { active: false }, template: { provenance: attack },
  }) }));
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../../public/js/taric-admin.js'), 'utf8'));
  await new Promise(setImmediate);
  expect(dom.window.document.querySelector('#readiness').textContent).toContain('RELEASE_CLOSED');
  expect(dom.window.document.querySelector('#runtime').value).toContain(attack.replace(/"/g, '\\"'));
  expect(dom.window.document.querySelector('#enabled').checked).toBe(false);
  expect(dom.window.document.querySelectorAll('img')).toHaveLength(0);
  expect(dom.window.compromised).toBeUndefined();
  expect(dom.window.document.querySelectorAll('script:not([src])')).toHaveLength(0);
  expect(dom.window.document.querySelector('#secret-panel').hidden).toBe(true);
  expect(dom.window.fetch.mock.calls[0][1].headers['X-CSRF-Token']).toBe('synthetic-csrf');
  dom.window.close();
});
test('app mounts terminal private machine router before legacy parsers/auth and exempts admin parser', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');
  const machine = source.indexOf("app.use('/api/taric/v1'");
  expect(machine).toBeLessThan(source.indexOf('const legacyJsonParser'));
  expect(machine).toBeLessThan(source.indexOf("app.use('/api', isAuthenticated"));
  expect(source).toContain('isTaricAdminPath(req)) ? next() : legacyJsonParser');
  expect(source.indexOf("app.use('/admin/taric'")).toBeLessThan(source.indexOf("app.use('/admin', isAuthenticated"));
});

test('benchmark selector defaults newest, preserves older choice, paginates, autoselects import and handles empty lists', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(pug.renderFile(path.join(__dirname, '../../views/admin_taric.pug'), { csrfToken: 'synthetic' }), { url: 'http://localhost/admin/taric', runScripts: 'outside-only' });
  const doc = dom.window.document;
  const rows = Array.from({ length: 27 }, (_, i) => ({ _id: String(i + 1).padStart(32, '0'), version: 27 - i,
    state: 'draft', contaminated: i === 26, manifest: { accepted: 67 }, review: { provenance: '<img src=x onerror=alert(1)>' } }));
  let data = [...rows]; let deleted = false;
  dom.window.fetch = jest.fn(async (url, options) => {
    let result;
    if (url === '/admin/taric/state') result = { settings: { enabled: false } };
    else if (url === '/admin/taric/inspect/benchmarks') result = data.slice(0, 25);
    else if (url.includes('/inspect/benchmarks?before=')) result = data.slice(25);
    else if (url.includes('/inspect/benchmarks/')) result = deleted ? null : rows.find(r => url.endsWith(r._id));
    else if (url === '/admin/taric/imports') {
      const meta = JSON.parse(options.body.get('metadata'));
      result = meta.action === 'preview' ? { sha256: 'synthetic' } : { id: rows[1]._id };
    }
    return { ok: true, json: async () => result };
  });
  const settle = () => new Promise(setImmediate);
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../../public/js/taric-admin.js'), 'utf8')); await settle();
  const select = doc.querySelector('#benchmark-id');
  expect(select.tagName).toBe('SELECT'); expect(select.value).toBe(rows[0]._id); expect(select.options).toHaveLength(25);
  doc.querySelector('#benchmarks-more').click(); await settle();
  expect(select.options).toHaveLength(27); expect(doc.querySelector('#benchmarks-more').disabled).toBe(true);
  select.value = rows[26]._id; doc.querySelector('#refresh').click(); await settle();
  expect(select.value).toBe(rows[26]._id); expect(doc.querySelectorAll('img')).toHaveLength(0);
  Object.defineProperty(doc.querySelector('#csv'), 'files', { value: [new dom.window.File(['synthetic'], 'synthetic.csv')] });
  doc.querySelector('#preview').click(); await settle(); doc.querySelector('#import').click(); await settle();
  expect(select.value).toBe(rows[1]._id);
  deleted = true; data = []; doc.querySelector('#refresh').click(); await settle();
  expect(select.options).toHaveLength(0); expect(select.disabled).toBe(true); expect(doc.querySelector('#run').disabled).toBe(true);
  expect(doc.querySelector('#benchmark-help').textContent).toContain('Import');
  dom.window.close();
});
test('test diagnostics display literal rejected text without executing HTML and list failures are actionable', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(pug.renderFile(path.join(__dirname, '../../views/admin_taric.pug'), { csrfToken: 'synthetic' }), { url: 'http://localhost/admin/taric', runScripts: 'outside-only' });
  const attack = '<img src=x onerror="window.compromised=true">';
  dom.window.fetch = jest.fn(async url => ({ ok: !url.endsWith('/benchmarks'), json: async () => url.endsWith('/test') ?
    { id: 'a'.repeat(32), result: null, error: 'CATALOG_REJECTED', diagnostics: { label: 'REJECTED', visibleText: attack } } : url.endsWith('/benchmarks') ? { error: 'STORAGE_FAILED' } : { settings: {}, gateway: { ready: true }, test: { ready: true } } }));
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../../public/js/taric-admin.js'), 'utf8')); await new Promise(setImmediate);
  expect(dom.window.document.querySelector('#benchmark-help').textContent).toContain('Refresh to retry');
  dom.window.document.querySelector('#test').click(); await new Promise(setImmediate);
  expect(dom.window.document.querySelector('#test-result').textContent).toContain('REJECTED');
  expect(dom.window.document.querySelectorAll('img')).toHaveLength(0); expect(dom.window.compromised).toBeUndefined();
  dom.window.close();
});

test('action errors include safe HTTP, stage and permission context and stay inert', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(pug.renderFile(path.join(__dirname, '../../views/admin_taric.pug'), { csrfToken: 'synthetic' }), { url: 'http://localhost/admin/taric', runScripts: 'outside-only' });
  const attack = '<img src=x onerror="window.compromised=true">';
  let denied = false;
  dom.window.fetch = jest.fn(async url => {
    if (url.endsWith('/credential/rotate')) return { ok: false, status: 403, json: async () => {
      if (denied) throw new Error('private upstream body');
      return { error: 'FORBIDDEN', action: 'credential.rotate', stage: 'request.operation', message: attack, requestId: 'a'.repeat(32) };
    } };
    return { ok: true, json: async () => url.endsWith('/benchmarks') ? [] : { settings: {}, gateway: { ready: false } } };
  });
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../../public/js/taric-admin.js'), 'utf8')); await new Promise(setImmediate);
  const doc = dom.window.document; doc.querySelector('#rotate').click(); await new Promise(setImmediate);
  expect(doc.querySelector('#status').textContent).toContain('Create / rotate key: credential.rotate failed — HTTP 403, FORBIDDEN, stage request.operation');
  expect(doc.querySelector('#status').textContent).toContain(attack); expect(doc.querySelectorAll('img')).toHaveLength(0);
  expect(dom.window.compromised).toBeUndefined();
  denied = true; doc.querySelector('#rotate').click(); await new Promise(setImmediate);
  expect(doc.querySelector('#status').textContent).toContain('permission or CSRF');
  expect(doc.querySelector('#status').textContent).not.toContain('private upstream body');
  dom.window.close();
});

test('unheld current state clears stale recovery controls and 67 errors are not presented as successful completion', async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM(pug.renderFile(path.join(__dirname, '../../views/admin_taric.pug'), { csrfToken: 'synthetic' }), { url: 'http://localhost/admin/taric', runScripts: 'outside-only' });
  const doc = dom.window.document;
  let blocked = true;
  dom.window.fetch = jest.fn(async url => ({ ok: true, json: async () => {
    if (url === '/admin/taric/state') return { settings: { enabled: true }, gateway: { ready: true }, inference: { blocked, epoch: 7 }, test: { ready: !blocked, adapter: 'taric-v1-20260917-2' } };
    if (url === '/admin/taric/inference/status') return { control: { blocked, epoch: 7 }, ownership: { available: false }, remote: { capabilityProof: { protocol: 'owned-v1' } }, pending: [], queuedRequests: 0 };
    if (url.startsWith('/admin/taric/inspect/runs/')) return { _id: 'a'.repeat(32), state: 'complete', requestedCount: 67,
      attemptedCount: 67, actualCount: 67, successfulGenerations: 1, invalid: 67, errorCount: 67, exact: 0,
      score: 0, passed: false, sessionCount: 67, sessionEndReasons: { uncertain_operation: 66, finished: 1 } };
    return [];
  } }));
  const settle = () => new Promise(setImmediate);
  dom.window.eval(fs.readFileSync(path.join(__dirname, '../../public/js/taric-admin.js'), 'utf8')); await settle();
  doc.querySelector('#remote-status').click(); await settle();
  expect(doc.querySelector('#resume').disabled).toBe(false);
  blocked = false; doc.querySelector('#refresh').click(); await settle();
  expect(doc.querySelector('#resume').disabled).toBe(true);
  expect(doc.querySelector('#resume').textContent).toBe('Recovery not needed');
  expect(doc.querySelector('#test').disabled).toBe(false);
  expect(doc.querySelector('#recovery-help').textContent).toContain('No inference hold');
  doc.querySelector('#run-id').value = 'a'.repeat(32); doc.querySelector('#run-progress').click(); await settle();
  const summary = JSON.parse(doc.querySelector('#run-progress-output').textContent);
  expect(summary).toMatchObject({ state: 'Completed with 67 errors', recorded: 67, successfulGenerations: 1, validOutputs: 0, exact: 0, errors: 67, passed: false });
  expect(dom.window.fetch.mock.calls.some(([url]) => /\/model|\/adapters/.test(url))).toBe(false);
  dom.window.close();
});
