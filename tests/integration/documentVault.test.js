// Set DOCUMENT_VAULT_TEST_MONGO_URI to a disposable loopback MongoDB.
// Every run owns a fresh database. The provider fixture never contacts a real model.
const express = require('express');
const multer = require('multer');
const mongoose = require('mongoose');
const sharp = require('sharp');
const { randomUUID } = require('crypto');
const path = require('path');
const fixture = process.env.DOCUMENT_VAULT_TEST_MONGO_URI;
const suite = fixture ? describe : describe.skip;
const answer = {
  title: 'Museum receipt', description: 'A museum admission receipt.',
  englishText: 'Admission, 500 yen.', tags: ['museum', 'receipt'], documentDate: '2026-08-14', totalAmount: 500, currency: 'JPY',
};
const session = { csrfToken: 'x'.repeat(43) };
const invalidReply = '<script>private_fixture_reply</script>';
function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}
function close(server) {
  if (!server) return;
  server.closeAllConnections();
  return new Promise(resolve => server.close(resolve));
}
const urlOf = server => 'http://127.0.0.1:' + server.address().port;

suite('Document vault with standalone MongoDB', () => {
  let Group, Scan, Queue, User, worker, repo, library, AppSetting;
  let users, scan, site, gateway, calls, responseMode;
  const oldOcr = process.env.OCR_API_BASE_URL;
  const oldChat = process.env.OLLAMA_BASE_URL;
  beforeAll(async () => {
    if (!/^mongodb:\/\/127\.0\.0\.1:\d+\/document_vault_test$/.test(fixture)) throw new Error('Use a disposable loopback document_vault_test fixture.');
    await mongoose.connect(fixture, { dbName: 'document_vault_test_' + randomUUID().replaceAll('-', ''), bufferCommands: false });
    const api = express();
    api.get('/llm/models', (_req, res) => res.json({ models: ['qwen3.8:27b', 'alternate:12b'].map(id => ({ id, allow_images: true })) }));
    api.post('/ocr', multer().single('file'), (req, res) => {
      calls.push({ kind: 'ocr', body: req.body, file: req.file.originalname });
      if (responseMode === 'fail') return res.sendStatus(503);
      res.json({ text: '入場料(10,10),(90,20)' });
    });
    api.post('/llm/chat', express.json({ limit: '15mb' }), (req, res) => {
      const isGroup = !req.body.messages[1].images;
      calls.push({ kind: isGroup ? 'group' : 'chat', body: req.body });
      const result = isGroup ? { description: 'Museum admission documents.' } : answer;
      res.json({ message: { role: 'assistant', content: responseMode === 'fail' ? invalidReply : JSON.stringify(result) } });
    });
    gateway = await listen(api);
    process.env.OCR_API_BASE_URL = urlOf(gateway);
    process.env.OLLAMA_BASE_URL = urlOf(gateway);
    ({ Group, Scan, Queue } = require('../../models/document_vault'));
    User = require('../../models/useraccount');
    AppSetting = require('../../models/app_setting');
    repo = require('../../services/documentVault/repository');
    library = require('../../services/documentVault/worker');
    worker = new library.VaultWorker();
    const app = express();
    app.set('view engine', 'pug');
    app.set('views', path.resolve(__dirname, '../../views'));
    app.use((req, _res, next) => {
      req.user = users?.[req.get('x-test-user')];
      req.session = session;
      req.isAuthenticated = () => Boolean(req.user);
      next();
    });
    app.use('/document-vault', require('../../routes/documentVault').createRouter());
    site = await listen(app);
    scan = await sharp({ create: { width: 16, height: 24, channels: 3, background: 'white' } }).png().toBuffer();
    users = {};
    for (const [name, role] of Object.entries({ clerk: 'user', owner: 'family', viewer: 'user', admin: 'admin', denied: 'other' })) {
      users[name] = await User.create({ name, type_user: role, email: name + '@example.invalid', hash_password: 'fixture' });
    }
    await Promise.all([Group.init(), Scan.init(), Queue.init()]);
  });
  beforeEach(async () => {
    calls = [];
    responseMode = 'ok';
    await Promise.all([Group.deleteMany({}), Scan.deleteMany({}), Queue.deleteMany({}), AppSetting.deleteMany({})]);
  });
  afterAll(async () => {
    await Promise.all([close(site), close(gateway)]);
    if (mongoose.connection.name?.startsWith('document_vault_test_')) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    for (const [name, value] of Object.entries({ OCR_API_BASE_URL: oldOcr, OLLAMA_BASE_URL: oldChat })) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  function request(user, route, body, csrf = true) {
    return fetch(urlOf(site) + '/document-vault' + route, {
      method: body ? 'POST' : 'GET', redirect: 'manual', body, headers: {
        ...(user ? { 'x-test-user': user } : {}), ...(csrf ? { 'x-csrf-token': session.csrfToken } : {}),
      },
    });
  }
  function batch(size = 1) {
    const form = new FormData();
    form.set('uploadKey', randomUUID());
    form.set('ownerId', String(users.owner._id));
    form.set('viewerIds', String(users.viewer._id));
    for (let i = 0; i < size; i++) form.append('scans', new Blob([scan], { type: 'image/png' }), 'page-' + (i + 1) + '.png');
    return form;
  }
  async function upload(size) {
    const response = await request('clerk', '/upload', batch(size));
    expect([response.status, await response.json()]).toEqual([201, expect.objectContaining({ location: expect.any(String) })]);
    return Group.findOne({});
  }
  function filePage(page, changes = {}, user = 'clerk') {
    const { tags, ...fields } = answer;
    return request(user, '/pages/' + page._id + '/review', new URLSearchParams({
      ...fields, tags: tags.join(', '), decision: 'dispose', revision: page.revision, ...changes,
    }));
  }
  test('runs OCR, English page and ordered group jobs, files papers independently and restricts archive, source and sibling access', async () => {
    let group = await upload(2);
    const [first, second] = group.pages.map(p => String(p._id));
    expect(await Scan.countDocuments()).toBe(2);
    expect((await request('viewer', '/pages/' + first)).status).toBe(404);
    for (let i = 0; i < 3; i++) await worker.runOne();
    expect(calls.map(c => c.kind)).toEqual(['ocr', 'ocr', 'chat']);
    expect(calls[0].body).toMatchObject({ model: 'hunyuanocr', max_new_tokens: '2048' });
    expect(calls[2].body.model).toBe('qwen3.8:27b');
    const pageFormat = calls[2].body.format;
    expect(pageFormat).toMatchObject({ type: 'object', additionalProperties: false });
    expect(pageFormat.required.toSorted()).toEqual(Object.keys(answer).toSorted());
    expect(calls[2].body.response_format).toEqual({ type: 'json_schema', json_schema: { name: 'vault_page', strict: true, schema: pageFormat } });
    const [context, prompt] = calls[2].body.messages;
    expect(context.content).toContain('English');
    expect(prompt.content).toContain('入場料');
    expect(prompt.images).toHaveLength(1);
    group = await Group.findById(group._id);
    expect(group.pages[0]).toMatchObject({ ...answer, ocrText: '入場料', state: 'review' });
    expect((await request('clerk', '/pages/' + first)).status).toBe(200);
    expect((await filePage(group.pages[0], { title: 'Reviewed receipt', decision: 'keep', yearLabel: '2026', folderId: 'B4', groupLabel: 'Travel' })).status).toBe(303);
    await AppSetting.create({ key: 'document_vault.chat5.model', value: 'alternate:12b' });
    await worker.runOne();
    await worker.runOne();
    expect(calls.slice(3).map(c => [c.kind, c.body.model])).toEqual([['chat', 'alternate:12b'], ['group', 'alternate:12b']]);
    expect(calls[4].body.format).toEqual({ type: 'object', properties: { description: { type: 'string' } },
      required: ['description'], additionalProperties: false });
    expect(calls[4].body.response_format.json_schema).toEqual({ name: 'vault_group', strict: true, schema: calls[4].body.format });
    expect(calls[4].body.messages[1].content).toContain(JSON.stringify([{ page: 1, description: answer.description }, { page: 2, description: answer.description }]));
    group = await Group.findById(group._id);
    expect(group.jobs).toHaveLength(0);
    expect(group.pages[0].state).toBe('stored');
    const view = await request('viewer', '/pages/' + first);
    expect(view.headers.get('cache-control')).toContain('no-store');
    const html = await view.text();
    expect(html).toContain('Reviewed receipt');
    expect(html).not.toContain('/pages/' + second);
    expect(html).not.toContain('Processing controls');
    expect((await request('viewer', '/pages/' + second + '/image')).status).toBe(404);
    const last = group.pages[1];
    expect((await filePage(last, { description: 'An admission ticket stub.' })).status).toBe(303);
    expect((await request('clerk', '/pages/' + first)).status).toBe(404);
    expect((await request('viewer', '/pages/' + first + '/image')).status).toBe(200);
    await worker.runOne();
    group = await Group.findById(group._id);
    expect(group.pages.map(p => p.state)).toEqual(['stored', 'stored']);
    expect(group.pages.map(p => p.physical.decision)).toEqual(['keep', 'dispose']);
    expect(group.pages[0].physical.folderId).toBe('B4');
    expect(group.jobs).toHaveLength(0);
    expect((await library.state()).active).toBeNull();
    expect(await (await request('viewer', '/pages/' + second)).text()).toContain('/pages/' + first);
    for (const query of ['500', 'B4', '入場料', 'museum', '2026-08-14', 'Admission, 500', 'Museum admission documents']) {
      expect((await repo.list('archive', users.viewer._id, { q: query })).rows.length).toBeGreaterThan(0);
    }
    expect((await repo.list('archive', users.admin._id)).rows).toEqual([]);
    expect((await request('admin', '/pages/' + second + '/image')).status).toBe(404);
    expect((await request('viewer', '/pages/' + second + '/redo', new URLSearchParams({ mode: 'both', revision: '1' }))).status).toBe(404);
    expect(await (await request('viewer', '/?q=Reviewed')).text()).toContain('Reviewed receipt');
  });
  test('retrying the same upload is idempotent and a different manifest requires a fresh form', async () => {
    const form = batch(1);
    expect((await request('clerk', '/upload', form)).status).toBe(201);
    expect((await request('clerk', '/upload', form)).status).toBe(201);
    form.delete('viewerIds');
    expect((await request('clerk', '/upload', form)).status).toBe(409);
    expect(await Group.countDocuments()).toBe(1);
    expect(await Scan.countDocuments()).toBe(1);
  });
  test('workers share one durable slot, handle stale results and recover already-saved work without resubmission', async () => {
    const group = await upload(2);
    let started, finish;
    const running = new Promise(resolve => { started = resolve; });
    const hold = new Promise(resolve => { finish = resolve; });
    const generate = jest.fn(async () => { started(); await hold; return 'OCR'; });
    const a = new library.VaultWorker({ generate });
    const b = new library.VaultWorker({ generate });
    const one = a.runOne();
    try {
      await running;
      expect((await request('owner', '/upload', batch(1))).status).toBe(201);
      await b.runOne();
      expect(generate).toHaveBeenCalledTimes(1);
      expect((await library.state()).active.jobId).toEqual(group.jobs[0]._id);
    } finally { finish(); await one; }
    const saved = await Group.findById(group._id);
    await Queue.updateOne({}, { active: { groupId: group._id, jobId: saved.lastJob.jobId, expiresAt: new Date() }, recent: [] });
    await b.runOne();
    expect((await library.state()).recent).toEqual(['ok']);
    expect(generate).toHaveBeenCalledTimes(1);
    await Queue.updateOne({}, { active: { groupId: group._id, jobId: saved.jobs[0]._id, expiresAt: new Date(0) } });
    await b.runOne();
    expect((await library.state()).pauseReason).toBe('interrupted');
    expect((await Group.findById(group._id)).pages[1].issue).toBe('interrupted');
  });
  test('three failures within five attempts pause both providers until verified resume; redo uses saved OCR', async () => {
    const group = await upload(4);
    const warning = jest.spyOn(require('../../utils/logger'), 'warning');
    try {
      for (const mode of ['ok', 'fail', 'ok', 'fail', 'fail']) { responseMode = mode; await worker.runOne(); }
      expect(warning).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
        metadata: expect.objectContaining({ kind: 'chat', reason: 'invalid_json' }),
      }));
      expect(JSON.stringify(warning.mock.calls)).not.toContain('private_fixture_reply');
    } finally {
      warning.mockRestore();
    }
    const paused = await library.state();
    expect(paused).toMatchObject({ recent: ['ok', 'error', 'ok', 'error', 'error'], pauseReason: 'generation' });
    await worker.runOne();
    expect(calls).toHaveLength(5);
    const verify = new URLSearchParams({ version: paused.version, verified: 'yes' });
    expect((await request('clerk', '/queue/resume', verify)).status).toBe(403);
    expect((await request('admin', '/queue/resume', new URLSearchParams({ version: paused.version }))).status).toBe(422);
    expect((await request('admin', '/queue/resume', verify)).status).toBe(303);
    expect((await library.state()).recent).toEqual([]);
    const page = (await Group.findById(group._id)).pages[0];
    expect(page.failedStage).toBe('chat');
    expect(page.failedReply).toMatchObject({ raw: invalidReply, reason: 'invalid_json' });
    const detail = await (await request('owner', '/pages/' + page._id)).text();
    expect(detail).toContain('&lt;script&gt;private_fixture_reply&lt;/script&gt;');
    expect(detail).not.toContain(invalidReply);
    expect((await repo.detail(String(page._id), users.owner._id, false)).page.failedReply).toBeUndefined();
    expect((await request('viewer', '/pages/' + page._id)).status).toBe(404);
    expect((await request('owner', '/pages/' + page._id + '/redo', new URLSearchParams({ revision: page.revision, mode: 'chat' }))).status).toBe(303);
    expect((await Group.findById(group._id)).pages[0].failedReply.raw).toBe(invalidReply);
    responseMode = 'ok';
    await worker.runOne();
    await worker.runOne();
    expect(calls.slice(-2).map(c => c.kind)).toEqual(['chat', 'chat']);
    expect((await Group.findById(group._id)).pages[0].failedReply).toBeUndefined();
  });
  test('a failed group job has one queue item and retries only the ordered summary', async () => {
    let group = await upload(2);
    for (let i = 0; i < 4; i++) await worker.runOne();
    const pending = await repo.list('queue', users.clerk._id);
    expect(pending.rows).toHaveLength(1);
    expect(pending.rows[0].state).toBe('group');
    responseMode = 'fail';
    await worker.runOne();
    group = await Group.findById(group._id);
    expect(group.summaryState).toBe('failed');
    expect(group.failedSummaryReply).toMatchObject({ raw: invalidReply, reason: 'invalid_json' });
    expect(await (await request('owner', '/pages/' + group.pages[0]._id)).text()).toContain('private_fixture_reply');
    expect((await request('owner', '/pages/' + group.pages[0]._id + '/redo-group',
      new URLSearchParams({ revision: group.descriptionRevision }))).status).toBe(303);
    responseMode = 'ok';
    await worker.runOne();
    expect(calls.map(c => c.kind)).toEqual(['ocr', 'ocr', 'chat', 'chat', 'group', 'group']);
    group = await Group.findById(group._id);
    expect(group.summaryState).toBe('ready');
    expect(group.failedSummaryReply).toBeUndefined();
    // A failed summary redo can coexist with a filed page visible to a viewer.
    expect((await filePage(group.pages[0])).status).toBe(303);
    expect((await request('owner', '/pages/' + group.pages[0]._id + '/redo-group',
      new URLSearchParams({ revision: group.descriptionRevision }))).status).toBe(303);
    responseMode = 'fail';
    await worker.runOne();
    expect(await (await request('viewer', '/pages/' + group.pages[0]._id)).text()).not.toContain('private_fixture_reply');
    expect(await (await request('clerk', '/pages/' + group.pages[1]._id)).text()).not.toContain('private_fixture_reply');
  });
  test('rejects foreign, anonymous, forged, malformed and partially invalid batches; delayed jobs recheck the principal', async () => {
    expect((await request(null, '/')).status).toBe(401);
    expect((await request('denied', '/')).status).toBe(403);
    expect((await request('clerk', '/upload', batch(1), false)).status).toBe(403);
    const foreign = batch(1);
    foreign.set('ownerId', new mongoose.Types.ObjectId().toString());
    expect((await request('clerk', '/upload', foreign)).status).toBe(422);
    const invalid = batch(1);
    invalid.append('scans', new Blob(['invalid'], { type: 'image/png' }), 'bad.png');
    expect((await request('clerk', '/upload', invalid)).status).toBe(422);
    expect(await Group.countDocuments()).toBe(0);
    expect(await Scan.countDocuments()).toBe(0);
    const group = await upload(1);
    await User.updateOne({ _id: users.clerk._id }, { type_user: 'other' });
    try {
      await worker.runOne();
      expect(calls).toEqual([]);
      expect((await Group.findById(group._id)).pages[0].issue).toBe('access');
      expect((await library.state()).recent).toEqual([]);
    } finally { await User.updateOne({ _id: users.clerk._id }, { type_user: 'user' }); }
  });
});
