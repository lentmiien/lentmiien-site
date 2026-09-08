jest.mock('../../utils/logger', () => ({ error: jest.fn() }));
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { createFormAssets, FORM_SCRIPTS } = require('../../utils/formAssets');
let root; let server;
afterEach(async () => {
  if (server) { await new Promise(resolve => server.close(resolve)); server = null; }
  if (root) { fs.rmSync(root, { recursive: true, force: true }); root = null; }
});
test('fingerprints change with script bytes; old URLs never serve a different revision', async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'form-assets-test-'));
  fs.mkdirSync(path.join(root, 'js'));
  for (const name of FORM_SCRIPTS) fs.copyFileSync(path.join('public/js', name), path.join(root, 'js', name));
  const before = createFormAssets(root);
  const same = createFormAssets(root);
  for (const name of FORM_SCRIPTS) expect(same.url(name)).toBe(before.url(name));
  const oldBytes = fs.readFileSync(path.join(root, 'js/my_life_log.js'));
  fs.appendFileSync(path.join(root, 'js/my_life_log.js'), '\n// synthetic revision\n');
  let assets = before;
  const app = express(); app.get('/assets/forms/:revision/:filename', (req, res) => assets.serve(req, res));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  // A running process serves its hashed snapshot even if deployment changes the file.
  let response = await fetch(base + before.url('my_life_log.js'));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  expect(Buffer.from(await response.arrayBuffer()).equals(oldBytes)).toBe(true);
  assets = createFormAssets(root);
  expect(assets.url('my_life_log.js')).not.toBe(before.url('my_life_log.js'));
  expect(assets.url('account_dashboard.js')).toBe(before.url('account_dashboard.js'));
  const render = formAssetUrl => require('pug').renderFile('views/mypage.pug', { formAssetUrl, bookmarks: [], htmlPaths: [] });
  expect(render(before.url)).toContain(`data-life-log-script="${before.url('my_life_log.js')}"`);
  expect(render(assets.url)).toContain(`data-life-log-script="${assets.url('my_life_log.js')}"`);
  response = await fetch(base + before.url('my_life_log.js'));
  expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toBe('no-store');
  for (const name of FORM_SCRIPTS) {
    response = await fetch(base + assets.url(name)); expect(response.status).toBe(200);
    const hash = crypto.createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    expect(assets.url(name)).toBe(`/assets/forms/${hash}/${name}`);
  }
  expect((await fetch(base + assets.url('my_life_log.js'), { method: 'HEAD' })).status).toBe(200);
  expect((await fetch(base + '/assets/forms/unknown/private.js')).status).toBe(404);
  expect(() => assets.url('../private.js')).toThrow('Unknown form script');
});
test('missing security-critical scripts fail startup with a safe actionable log', () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'form-assets-test-'));
  expect(() => createFormAssets(root)).toThrow('Required form script unavailable');
  expect(require('../../utils/logger').error).toHaveBeenCalledWith('Required form script unavailable; restore public/js before starting', { category: 'form_assets' });
});
