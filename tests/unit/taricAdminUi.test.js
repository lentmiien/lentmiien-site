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
