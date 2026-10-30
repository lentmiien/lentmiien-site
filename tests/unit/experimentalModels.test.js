const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');
const express = require('express');
const session = require('express-session');
const sharp = require('sharp');
const pug = require('pug');
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn(), notice: jest.fn() }));
const logger = require('../../utils/logger');
const { LabStore } = require('../../services/experimentalModels/storage');
const { LIMITS, BUNDLES, CAPABILITY } = require('../../services/experimentalModels/policy');
const { createRouter } = require('../../routes/experimentalModels');
const registry = require('../../services/experimentalModels/registry');
const { hasCapabilities } = require('../../utils/authorization');
const owner = 'a'.repeat(24), other = 'b'.repeat(24);
let root, store, png;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'experimental-models-test-'));
  store = new LabStore({ root });
  png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#ff6600' } }).png().toBuffer();
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
const file = buffer => ({ buffer, mimetype: 'image/png', originalname: 'synthetic.png' });

describe('private staging lifecycle', () => {
  test('normalizes images and scopes list/read/download/clear to account AND login', async () => {
    const binding = randomUUID(), foreignBinding = randomUUID();
    const s = await store.create(owner, binding);
    const asset = await store.upload(owner, binding, s.id, file(png));
    const result = await store.download(owner, binding, s.id, asset.id);
    const bytes = await result.handle.readFile(); await result.handle.close();
    expect((await sharp(bytes).metadata()).format).toBe('png');
    expect(result.asset).toMatchObject({ width: 64, height: 48, mime: 'image/png' });
    expect(JSON.stringify(s)).not.toMatch(/binding|owner|private_data/);
    for (const [user, login] of [[other, binding], [owner, foreignBinding]]) {
      expect(await store.list(user, login)).toEqual([]);
      await expect(store.get(user, login, s.id)).rejects.toMatchObject({ status: 404 });
      await expect(store.download(user, login, s.id, asset.id)).rejects.toMatchObject({ status: 404 });
      await expect(store.upload(user, login, s.id, file(png))).rejects.toMatchObject({ status: 404 });
      await expect(store.clear(user, login, s.id)).rejects.toMatchObject({ status: 404 });
    }
    await store.clear(owner, binding, s.id);
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('absolute TTL denies reads immediately and sweeper removes all files', async () => {
    let now = 1000; store = new LabStore({ root, now: () => now });
    const binding = randomUUID(), s = await store.create(owner, binding);
    await store.upload(owner, binding, s.id, file(png));
    now = s.expiresAt - 1;
    expect((await store.get(owner, binding, s.id)).expiresAt).toBe(s.expiresAt);
    now += 1;
    await expect(store.get(owner, binding, s.id)).rejects.toMatchObject({ status: 404 });
    await store.sweep();
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('restart restores quotas/owners, removes orphan files and expires data', async () => {
    const binding = randomUUID(), s = await store.create(owner, binding);
    await store.upload(owner, binding, s.id, file(png));
    await fs.writeFile(path.join(root, s.id, 'unfinished.tmp'), 'synthetic');
    const orphan = randomUUID(); await fs.mkdir(path.join(root, orphan));
    const recovered = new LabStore({ root });
    expect((await recovered.list(owner, binding))[0].assets).toHaveLength(1);
    await expect(fs.stat(path.join(root, orphan))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(root, s.id, 'unfinished.tmp'))).rejects.toMatchObject({ code: 'ENOENT' });
    const expired = new LabStore({ root, now: () => s.expiresAt });
    await expired.sweep();
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('failed clear keeps delete-pending inaccessible and scheduler can retry', async () => {
    const binding = randomUUID(), s = await store.create(owner, binding);
    const purge = jest.spyOn(store, 'purgeDirectory').mockRejectedValueOnce(new Error('synthetic disk failure'));
    await expect(store.clear(owner, binding, s.id)).rejects.toThrow();
    expect((await store.get(owner, binding, s.id)).deletePending).toBe(true);
    expect(await store.list(owner, binding)).toEqual([]);
    purge.mockRestore();
    // Persisted pending marker survives a process restart.
    await new LabStore({ root }).sweep();
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('serializes clear with active storage work without manual retry', async () => {
    const binding = randomUUID(), s = await store.create(owner, binding);
    let release;
    const active = store.exclusive(() => new Promise(resolve => { release = resolve; }));
    while (!release) await new Promise(resolve => setImmediate(resolve));
    const clearing = store.clear(owner, binding, s.id);
    expect(store.waiters).toHaveLength(1);
    release(); await active;
    await expect(clearing).resolves.toMatchObject({ deleted: true });
    await expect(store.upload(owner, binding, s.id, file(png))).rejects.toMatchObject({ status: 404 });
  });
  test('enforces session and per-session/user/global byte quotas', async () => {
    const binding = randomUUID();
    await store.create(owner, binding); await store.create(owner, binding);
    await expect(store.create(owner, randomUUID())).rejects.toMatchObject({ code: 'session_limit' });
    for (const limit of ['sessionBytes', 'userBytes', 'globalBytes']) {
      const limited = new LabStore({ root, limits: { ...LIMITS, [limit]: 1 } });
      const [s] = await limited.list(owner, binding);
      await expect(limited.upload(owner, binding, s.id, file(png))).rejects.toMatchObject({ code: 'storage_limit' });
    }
    const limited = new LabStore({ root, limits: { ...LIMITS, globalSessions: 2 } });
    await expect(limited.create(other, randomUUID())).rejects.toMatchObject({ code: 'session_limit' });
  });
  test('bounds files per session and quarantines failed writes for cleanup', async () => {
    const binding = randomUUID(), s = await store.create(owner, binding);
    for (let i = 0; i < LIMITS.sessionFiles; i += 1) await store.upload(owner, binding, s.id, file(png));
    await expect(store.upload(owner, binding, s.id, file(png))).rejects.toMatchObject({ code: 'file_count' });
    await store.clear(owner, binding, s.id);
    const next = await store.create(owner, binding);
    const save = jest.spyOn(store, 'save').mockRejectedValueOnce(new Error('synthetic failure'));
    await expect(store.upload(owner, binding, next.id, file(png))).rejects.toThrow('synthetic failure');
    expect(store.sessions.get(next.id).assets).toHaveLength(1);
    expect((await store.get(owner, binding, next.id)).deletePending).toBe(true);
    save.mockRestore();
    await store.sweep();
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('rejects bad magic, MIME mismatch, extension mismatch, traversal, excessive pixels and bytes', async () => {
    const binding = randomUUID(), s = await store.create(owner, binding);
    const oversizeImage = await sharp({ create: { width: 16385, height: 32, channels: 3, background: '#000000' } }).png().toBuffer();
    const excessPixels = await sharp({ create: { width: 4100, height: 4100, channels: 3, background: '#000000' } }).png().toBuffer();
    for (const input of [file(Buffer.from('<script>synthetic</script>')), { ...file(png), mimetype: 'image/jpeg' },
      { ...file(png), originalname: 'bad.jpg' }, { ...file(png), originalname: '../test.png' }, file(oversizeImage), file(excessPixels)]) {
      await expect(store.upload(owner, binding, s.id, input)).rejects.toMatchObject({ status: 400 });
    }
    await expect(store.upload(owner, binding, s.id, file(Buffer.alloc(LIMITS.fileBytes + 1)))).rejects.toMatchObject({ status: 413 });
    for (const id of ['../outside', '/etc/passwd', '..%2foutside']) {
      await expect(store.get(owner, binding, id)).rejects.toMatchObject({ status: 404 });
      await expect(store.download(owner, binding, s.id, id)).rejects.toMatchObject({ status: 404 });
    }
    expect((await store.get(owner, binding, s.id)).assets).toEqual([]);
  });
  test('rejects symlink assets/root without reading or deleting the outside target', async () => {
    const binding = randomUUID(), s = await store.create(owner, binding);
    const asset = await store.upload(owner, binding, s.id, file(png));
    const target = path.join(root, s.id, `${asset.id}.png`);
    const outside = path.join(os.tmpdir(), `lab-outside-${randomUUID()}`);
    try {
      await fs.writeFile(outside, 'synthetic outside');
      await fs.unlink(target); await fs.symlink(outside, target);
      await expect(store.download(owner, binding, s.id, asset.id)).rejects.toThrow();
      await store.clear(owner, binding, s.id);
      expect(await fs.readFile(outside, 'utf8')).toBe('synthetic outside');
      const alias = path.join(root, 'alias'); await fs.symlink(root, alias);
      await expect(new LabStore({ root: alias }).sweep()).rejects.toThrow();
    } finally { await fs.rm(outside, { force: true }); }
  });
});

describe('real Express route guards', () => {
  let server, origin;
  beforeEach(async () => {
    const app = express();
    app.set('views', path.resolve('views')); app.set('view engine', 'pug');
    app.use(session({ secret: 'synthetic-test-session-secret', resave: false, saveUninitialized: false }));
    app.use((req, res, next) => {
      const role = req.get('x-test-role') || 'admin';
      req.user = role === 'anonymous' ? null : { _id: req.get('x-test-owner') || owner, name: 'synthetic-admin', type_user: role };
      req.isAuthenticated = () => !!req.user;
      Object.assign(res.locals, { loggedIn: !!req.user, admin: role === 'admin', permissions: [], htmlPaths: [], bookmarks: [] });
      next();
    });
    app.use('/admin/experimental-models', createRouter({ store }));
    server = await new Promise(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
    origin = `http://127.0.0.1:${server.address().port}/admin/experimental-models`;
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  async function browser(headers = {}) {
    const response = await fetch(origin, { headers });
    const html = await response.text();
    return { cookie: response.headers.get('set-cookie')?.split(';')[0], token: /data-csrf="([^"]+)"/.exec(html)?.[1], html };
  }
  async function call(b, url, method = 'GET', headers = {}, body) {
    return fetch(origin + url, { method, headers: { Cookie: b.cookie, 'X-CSRF-Token': b.token, Accept: 'application/json', ...headers }, body });
  }
  test.each(['anonymous', 'family', 'user'])('denies %s on page, every API, upload, download and clear', async role => {
    for (const [method, url] of [['GET', ''], ['GET', '/api/experiments'], ['GET', '/api/sessions'], ['POST', '/api/sessions'],
      ['GET', '/api/sessions/any'], ['POST', '/api/sessions/any/files'], ['POST', '/api/sessions/any/references'], ['GET', '/api/sessions/any/files/any'],
      ['DELETE', '/api/sessions/any'], ['GET', '/api/sessions/any/jobs/any'], ['GET', '/api/experiments/ming-tts/capabilities'], ['POST', '/api/sessions/any/experiments/ming-tts/runs']]) {
      const response = await fetch(origin + url, { method, headers: { 'x-test-role': role } });
      expect(response.status).toBe(role === 'anonymous' ? 401 : 403);
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('valid CSRF creates; absent/wrong token and foreign origin cannot mutate or upload', async () => {
    const b = await browser();
    expect(b.html).toContain('Run an experiment');
    for (const headers of [{ 'X-CSRF-Token': '' }, { 'X-CSRF-Token': 'x'.repeat(43) }, { Origin: 'https://hostile.invalid' }]) {
      expect((await call(b, '/api/sessions', 'POST', headers)).status).toBe(403);
      expect((await call(b, '/api/sessions/any/files', 'POST', headers)).status).toBe(403);
      expect((await call(b, '/api/sessions/any', 'DELETE', headers)).status).toBe(403);
    }
    const created = await call(b, '/api/sessions', 'POST'); expect(created.status).toBe(201);
    expect((await call(b, '/api/sessions', 'GET')).status).toBe(200);
    expect((await call(b, '/api/sessions', 'POST', { 'Content-Type': 'application/json' }, '{"owner":"other"}')).status).toBe(400);
    expect((await call(b, '/api/sessions?owner=other')).status).toBe(400);
    expect((await call(b, '/api/sessions?EXPERIMENTAL_MODELS_STORAGE_ROOT=/tmp/other')).status).toBe(400);
    expect((await call(b, '/api/sessions', 'POST', { 'Content-Type': 'application/json' }, '{"root":"/tmp/other"}')).status).toBe(400);
    expect(store.root).toBe(root);
  });
  test('stages real image, downloads actual PNG, blocks IDOR and deletes through CSRF', async () => {
    const b = await browser(), foreignLogin = await browser();
    const created = await (await call(b, '/api/sessions', 'POST')).json();
    const data = new FormData(); data.append('file', new Blob([png], { type: 'image/png' }), 'test.png');
    const uploaded = await call(b, `/api/sessions/${created.id}/files`, 'POST', {}, data);
    expect(uploaded.status).toBe(201);
    const asset = await uploaded.json();
    const download = await call(b, `/api/sessions/${created.id}/files/${asset.id}`);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toMatch(/^image\/png/);
    expect(download.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(download.headers.get('cache-control')).toContain('private, no-store');
    expect(Buffer.from(await download.arrayBuffer()).subarray(0, 8)).toEqual(Buffer.from('89504e470d0a1a0a', 'hex'));
    for (const [method, url] of [['GET', `/api/sessions/${created.id}`], ['GET', `/api/sessions/${created.id}/files/${asset.id}`], ['DELETE', `/api/sessions/${created.id}`]]) {
      expect((await call(foreignLogin, url, method)).status).toBe(404);
      expect((await call(b, url, method, { 'x-test-owner': other })).status).toBe(404);
    }
    expect((await call(b, `/api/sessions/${created.id}`, 'DELETE')).status).toBe(200);
    expect(await fs.readdir(root)).toEqual([]);
  });
  test.each(['decode', 'committed result'])('one process upload slot bounds image/reference allocations through %s', async stage => {
    const b = await browser(), s = await (await call(b, '/api/sessions', 'POST')).json();
    let release, entered;
    const reached = new Promise(resolve => { entered = resolve; });
    const method = stage === 'decode' ? 'decodeUpload' : 'upload';
    const original = store[method].bind(store);
    const held = jest.spyOn(store, method).mockImplementationOnce(async (...args) => {
      const result = stage === 'committed result' ? await original(...args) : null;
      entered(); await new Promise(resolve => { release = resolve; });
      return result || original(...args);
    });
    const data = () => { const value = new FormData(); value.append('file', new Blob([png], { type: 'image/png' }), 'test.png'); return value; };
    const first = call(b, `/api/sessions/${s.id}/files`, 'POST', {}, data());
    try {
      await reached;
      for (const route of ['files', 'references']) {
        const denied = await call(b, `/api/sessions/${s.id}/${route}`, 'POST', {}, data());
        expect(denied.status).toBe(429); expect((await denied.json()).code).toBe('upload_busy');
      }
      expect((await call(b, '/api/sessions')).status).toBe(200);
      expect(held).toHaveBeenCalledTimes(1);
    } finally { release?.(); await first; held.mockRestore(); }
    expect((await first).status).toBe(201);
    expect((await call(b, `/api/sessions/${s.id}/files`, 'POST', {}, data())).status).toBe(201);
  });
  test('upload parser rejects unknown parts, multiple files, bad magic and oversized requests', async () => {
    const b = await browser(), s = await (await call(b, '/api/sessions', 'POST')).json();
    for (const kind of ['field', 'two', 'magic', 'size']) {
      const data = new FormData();
      data.append('file', new Blob([kind === 'magic' ? 'not an image' : kind === 'size' ? Buffer.alloc(LIMITS.fileBytes + 1) : png], { type: 'image/png' }), 'test.png');
      if (kind === 'field') data.append('url', 'https://invalid.test');
      if (kind === 'two') data.append('file', new Blob([png], { type: 'image/png' }), 'second.png');
      expect((await call(b, `/api/sessions/${s.id}/files`, 'POST', {}, data)).status).toBe(kind === 'magic' ? 400 : 413);
    }
    expect((await (await call(b, `/api/sessions/${s.id}`)).json()).assets).toEqual([]);
  });
  test('registry never loads models; unknown routes and guessed fields fail closed', async () => {
    const b = await browser(), s = await (await call(b, '/api/sessions', 'POST')).json();
    const metadata = await (await call(b, '/api/experiments')).json();
    expect(metadata.stage).toBe('implemented');
    expect(metadata.experiments).toHaveLength(2);
    for (const experiment of metadata.experiments) {
      expect(experiment.tasks.length).toBeGreaterThan(0);
      const run = await call(b, `/api/sessions/${s.id}/experiments/${experiment.id}/runs`, 'POST');
      expect(run.status).toBe(400);
    }
    expect((await call(b, `/api/sessions/${s.id}/experiments/unknown/runs`, 'POST')).status).toBe(404);
    expect((await call(b, `/api/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', { 'Content-Type': 'application/json' }, '{"url":"https://invalid.test","token":"secret"}')).status).toBe(422);
  });
  test('bounded strict JSON rejects duplicate keys, prototypes, compression and oversized bodies before dispatch', async () => {
    const b = await browser(), s = await (await call(b, '/api/sessions', 'POST')).json();
    const url = `/api/sessions/${s.id}/experiments/ming-tts/runs`;
    for (const body of ['{"task":"FREEFORM","task":"VOICE_DESIGN"}', '{"controls":{"style":"a","style":"b"}}', '{"__proto__":{}}', '{bad json']) {
      expect((await call(b, url, 'POST', { 'Content-Type': 'application/json' }, body)).status).toBe(400);
    }
    expect((await call(b, url, 'POST', { 'Content-Type': 'application/json' }, '{"text":"' + 'x'.repeat(16384) + '"}')).status).toBe(413);
    expect((await call(b, url, 'POST', { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, '{}')).status).toBe(400);
    expect((await store.list(owner, store.sessions.get(s.id).binding))[0].jobs).toEqual([]);
  });
  test('internal errors never expose provider secrets, tokens, hashes, paths or payloads', async () => {
    const b = await browser();
    jest.spyOn(store, 'list').mockRejectedValueOnce(Object.assign(new Error(`X-Ming-Token synthetic-secret ${root} /private/path synthetic-prompt`), { token: 'synthetic-secret', response: { data: 'synthetic-private-output' } }));
    const response = await call(b, '/api/sessions');
    expect(response.status).toBe(503);
    const responseText = await response.text();
    expect(responseText).not.toMatch(/synthetic|X-Ming|private\/path/);
    expect(responseText).not.toContain(root);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(root);
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/synthetic-secret|private\/path|synthetic-prompt|synthetic-private/);
  });
});

test('admin bundle assignment is explicit and templates escape untrusted metadata', async () => {
  for (const type_user of ['admin', 'family', 'user']) {
    expect(await hasCapabilities({ name: 'synthetic', type_user }, [CAPABILITY], { roleCapabilityBundles: BUNDLES })).toBe(type_user === 'admin');
  }
  const html = pug.renderFile('views/admin_experimental_models.pug', { experiments: [{ ...registry.listExperiments()[0], title: '<img src=x onerror=alert(1)>', warning: '<script>alert(1)</script>' }],
    csrfToken: 'x'.repeat(43), loggedIn: true, admin: true, permissions: [], htmlPaths: [], bookmarks: [] });
  expect(html).toContain('&lt;img'); expect(html).not.toContain('<script>alert(1)</script>');
  const { NAVIGATION, navigationFor, resolvePolicy } = require('../../services/accountSurfacePolicy');
  expect(NAVIGATION.find(item => item.id === 'experimental_models')).toMatchObject({ adminOnly: true, href: '/admin/experimental-models' });
  const roleModel = { findOne: async () => ({ permissions: [CAPABILITY] }) };
  for (const type_user of ['family', 'user']) {
    const policy = await resolvePolicy({ _id: owner, name: 'synthetic', type_user }, roleModel);
    expect(navigationFor(policy).some(item => item.id === 'experimental_models')).toBe(false);
  }
  const adminPolicy = await resolvePolicy({ _id: owner, name: 'synthetic', type_user: 'admin' }, roleModel);
  expect(navigationFor(adminPolicy).some(item => item.id === 'experimental_models')).toBe(true);
});

test('app mounts dedicated guards before legacy admin routes and skips large body parsers', async () => {
  const source = await fs.readFile('app.js', 'utf8');
  expect(source).toContain("app.use('/admin/experimental-models', require('./routes/experimentalModels').createRouter());");
  expect(source.indexOf("app.use('/admin/experimental-models'")).toBeLessThan(source.indexOf("app.use('/admin', isAuthenticated"));
  expect(source.match(/isExperimentalModelsPath\(req\) \|\|/g)).toHaveLength(2);
  expect(source).toContain("require('./schedulers/experimentalModelsCleanup')();");
});

test('static delivery guard blocks aliases into lab storage', async () => {
  const storage = require('../../services/experimentalModels/storage');
  const guard = require('../../services/gptImageStorageService').guardStaticMedia;
  const privateRoot = path.join(root, 'private'), publicRoot = path.join(root, 'public');
  await fs.mkdir(privateRoot); await fs.mkdir(publicRoot);
  await fs.writeFile(path.join(privateRoot, 'test.png'), png);
  await fs.symlink(path.join(privateRoot, 'test.png'), path.join(publicRoot, 'alias.png'));
  const spy = jest.spyOn(storage, 'storageRoot').mockReturnValue(privateRoot);
  const middleware = jest.fn(), res = { status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), end: jest.fn() };
  try {
    await guard(publicRoot, middleware)({ path: '/alias.png' }, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(404); expect(middleware).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});

test('cleanup scheduler runs at startup, retries failures and reports only safe diagnostics', async () => {
  jest.useFakeTimers();
  const sweep = jest.fn().mockRejectedValueOnce(new Error('synthetic-private-secret')).mockResolvedValue(undefined);
  const schedule = require('../../schedulers/experimentalModelsCleanup');
  let handle;
  try {
    handle = schedule({ sweep });
    await jest.advanceTimersByTimeAsync(0);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('cleanup failed'), { category: 'experimental_models' });
    await jest.advanceTimersByTimeAsync(LIMITS.sweepMs);
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('synthetic-private-secret');
  } finally { clearInterval(handle); jest.useRealTimers(); }
});
