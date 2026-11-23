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
    // Match production: batch models are registered before the connection opens.
    mongoose.set('bufferCommands', false);
    require('../../models/insurance_batch');
    await new Promise(resolve => setImmediate(resolve));
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
    app.use('/insurance', require('../../routes/insurance').createRouter());
    app.use('/document-vault', require('../../routes/documentVault').createRouter());
    site = await listen(app);
    scan = await sharp({ create: { width: 16, height: 24, channels: 3, background: 'white' } }).png().toBuffer();
    users = {};
    for (const [name, role] of Object.entries({ clerk: 'user', owner: 'family', delegate: 'family', viewer: 'user', reader: 'other', admin: 'admin', denied: 'other' })) {
      users[name] = await User.create({ name, type_user: role, email: name + '@example.invalid', hash_password: 'fixture' });
    }
    await require('../../models/role').create({ name: 'reader', type: 'user', permissions: ['vault.documents.read'] });
    await Promise.all([Group.init(), Scan.init(), Queue.init()]);
  });
  beforeEach(async () => {
    calls = [];
    responseMode = 'ok';
    await Promise.all([require('../../models/insurance_batch').Batch.deleteMany({}), require('../../models/insurance_batch').Plan.deleteMany({}), require('../../models/document_vault').DuplicateFeedback.deleteMany({}), Group.deleteMany({}), Scan.deleteMany({}), Queue.deleteMany({}), AppSetting.deleteMany({}), require('../../models/insurance_claim').deleteMany({})]);
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
    return fetch(urlOf(site) + (route.startsWith('/insurance/') ? route : '/document-vault' + route), {
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
  test.each([
    ['Tax INVOICE', true, false],
    ['店名：領収書', false, true],
    ['領収証', false, true],
    ['領  収  証', false, true],
    ['領\u3000収\n書', true, false],
    ['領 収 金額', false, false],
    ['Admission', true, true],
  ])('reviews invoice tags against original OCR (%s)', async (ocrText, tagged, mismatch) => {
    const group = await Group.create({
      state: 'ready', ownerId: users.owner._id, uploaderId: users.clerk._id, summaryState: 'ready',
      pages: [{ ...answer, filename: 'scan.png', state: 'review', ocrText, tags: tagged ? ['museum', 'Invoice'] : ['museum'] }],
    });
    const page = group.pages[0];
    const html = await (await request('clerk', '/pages/' + page._id)).text();
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(html, { runScripts: 'outside-only' });
    try {
      dom.window.eval(require('fs').readFileSync(path.resolve(__dirname, '../../public/js/document-vault.js'), 'utf8'));
      const doc = dom.window.document;
      const toggle = doc.querySelector('#invoice');
      const total = doc.querySelector('#total');
      const warning = doc.querySelector('#invoice-warning');
      expect(doc.querySelector('#tags').value).toBe('museum');
      expect(toggle.checked).toBe(tagged);
      expect(doc.querySelector('#groupLabel').value).toBe(tagged ? 'Q3' : 'Other');
      expect(total.required).toBe(tagged);
      expect(warning.hidden).toBe(!mismatch);
      toggle.click();
      expect(doc.querySelector('#groupLabel').value).toBe(tagged ? 'Other' : 'Q3');
      expect(total.required).toBe(!tagged);
      expect(warning.hidden).toBe(mismatch);
      expect(total.value).toBe('500');
    } finally { dom.window.close(); }
    expect((await filePage(page, { invoice: 'on', totalAmount: '' })).status).toBe(422);
    // Both OCR disagreement directions are advisory at save time.
    const invoice = ocrText === 'Admission';
    expect((await filePage(page, { tags: 'museum', ...(invoice ? { invoice: 'on' } : {}) })).status).toBe(303);
    const saved = (await Group.findById(group._id)).pages[0];
    expect(saved.tags).toEqual(invoice ? ['museum', 'invoice'] : ['museum']);
    expect(saved.totalAmount).toBe(500);
  });
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
    const dateLink = require('jsdom').JSDOM.fragment(html).querySelector('dd a[href*="dateFrom="]');
    expect(dateLink.textContent).toBe(answer.documentDate);
    expect(dateLink.getAttribute('href')).toBe('/document-vault/?q=&dateFrom=' + answer.documentDate + '&dateTo=' + answer.documentDate);
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
  test('review storage defaults follow corrected dates until edited and Other is a manual override', async () => {
    const group = await Group.create({ ownerId: users.owner._id, uploaderId: users.clerk._id, state: 'ready',
      pages: [{ ...answer, state: 'review', filename: 'scan.png' }] });
    const dom = new (require('jsdom').JSDOM)(await (await request('clerk', '/pages/' + group.pages[0]._id)).text(), { runScripts: 'outside-only' });
    try {
      dom.window.eval(require('fs').readFileSync(path.resolve(__dirname, '../../public/js/document-vault.js'), 'utf8'));
      const field = id => dom.window.document.getElementById(id);
      const set = (id, value) => { field(id).value = value; field(id).dispatchEvent(new dom.window.Event('input')); };
      expect(field('yearLabel').value).toBe('2026');
      expect(field('folderId').value).toBe('OWNER');
      expect(field('groupLabel').value).toBe('Other');
      field('invoice').click();
      expect(field('groupLabel').value).toBe('Q3');
      set('date', '2025-03-31');
      expect(field('yearLabel').value).toBe('2025');
      expect(field('groupLabel').value).toBe('Q1');
      field('group-other').click();
      set('yearLabel', 'FY25');
      set('folderId', 'OWNER2');
      set('date', '2024-12-31');
      expect(field('groupLabel').value).toBe('Other');
      expect(field('yearLabel').value).toBe('FY25');
      expect(field('folderId').value).toBe('OWNER2');
      set('groupLabel', 'Personal');
      field('invoice').click();
      expect(field('groupLabel').value).toBe('Personal');
    } finally { dom.window.close(); }
  });

  test('uses the original upload deadline for filed pages and shared summary redos', async () => {
    const physical = { decision: 'keep', yearLabel: '2025', folderId: 'F', groupLabel: 'Q1' };
    const page = { ...answer, documentDate: '2001-04-01', filedAt: new Date(), state: 'stored', filename: 'scan.png', physical };
    const group = await Group.create({ ownerId: users.owner._id, viewerIds: [users.reader._id], uploaderId: users.clerk._id,
      state: 'ready', summaryState: 'ready', pages: [page, page] });
    const target = '/pages/' + group.pages[0]._id;
    const edit = new URLSearchParams({ revision: '0', yearLabel: '2001', folderId: 'A', groupLabel: 'Q2' });
    expect((await request('reader', target + '/location', edit)).status).toBe(303);
    await Group.collection.updateOne({ _id: group._id }, { $set: { createdAt: new Date(Date.now() - 90 * 86400000) } });
    edit.set('revision', '1');
    expect((await request('reader', target + '/location', edit)).status).toBe(409);
    expect((await request('owner', target + '/redo', new URLSearchParams({ mode: 'both', revision: '1' }))).status).toBe(409);
    expect((await request('owner', target + '/redo-group', new URLSearchParams({ revision: '0' }))).status).toBe(409);
    const html = await (await request('owner', target)).text();
    expect(html).toContain('Filed document locked');
    expect(html).not.toContain('Edit storage location');
  });

  test('serves private smaller previews for new and previously uploaded scans and preserves original bytes', async () => {
    const group = await upload(1);
    const id = group.pages[0]._id;
    expect((await Scan.findById(id).select('preview')).preview).toBeInstanceOf(Buffer);
    const original = await sharp({ create: { width: 2400, height: 3200, channels: 3, background: 'white' } }).jpeg().toBuffer();
    await Scan.updateOne({ _id: id }, { $set: { bytes: original, mime: 'image/jpeg' }, $unset: { preview: 1 } });
    expect((await request('viewer', '/pages/' + id + '/preview')).status).toBe(404);
    const response = await request('owner', '/pages/' + id + '/preview');
    expect(response.headers.get('cache-control')).toContain('no-store');
    const bytes = Buffer.from(await response.arrayBuffer());
    expect(await sharp(bytes).metadata()).toMatchObject({ width: 1200, height: 1600, format: 'jpeg' });
    expect(bytes.length).toBeLessThan(original.length);
    expect((await Scan.findById(id).select('preview')).preview.equals(bytes)).toBe(true);
    expect(Buffer.from(await (await request('owner', '/pages/' + id + '/image')).arrayBuffer()).equals(original)).toBe(true);
  });

  test('excludes unrelated dates, owners, amounts, tags, drafts and low OCR overlap', async () => {
    const duplicates = require('../../services/documentVault/duplicates');
    const base = { ownerId: users.owner._id, uploaderId: users.clerk._id, state: 'ready', summaryState: 'ready' };
    const page = { ...answer, state: 'stored', filename: 'scan.png', ocrText: '領収証 入場料金' };
    const invoice = { ...page, tags: ['invoice'] };
    await Group.create({ ...base, pages: [
      { ...invoice, totalAmount: page.totalAmount + 1 },
      { ...invoice, documentDate: '2026-01-01' }, { ...invoice, state: 'review' },
      { ...page, ocrText: 'entirely different text' },
    ] });
    await Group.create({ ...base, ownerId: users.viewer._id, pages: [page, invoice] });
    const group = await Group.create({ ...base, pages: [invoice, page].map(p => ({
      ...p, duplicateStatus: 'checking', duplicateReviewedAt: new Date(),
    })) });
    await duplicates.recover();
    expect((await Group.findById(group._id)).pages.every(p => !p.duplicateStatus)).toBe(true);
  });

  test('concurrent matching reviews retain an earlier copy and preserve siblings after deletion', async () => {
    const duplicates = require('../../services/documentVault/duplicates');
    const base = { ownerId: users.owner._id, uploaderId: users.clerk._id, state: 'ready', summaryState: 'ready' };
    const first = { ...answer, tags: ['invoice'], state: 'stored', filename: 'one.png',
      duplicateStatus: 'checking', duplicateReviewedAt: new Date() };
    const group = await Group.create({ ...base, pages: [first, first, { ...answer, state: 'stored', filename: 'three.png' }] });
    const [a, b] = group.pages;
    await Promise.all([duplicates.check(group, a), duplicates.check(group, b)]);
    const actor = users.owner._id;
    expect((await duplicates.comparison(String(a._id), actor)).match).toBeNull();
    expect((await duplicates.comparison(String(b._id), actor)).match.id).toBe(String(a._id));
    await duplicates.decide(String(b._id), actor, { outcome: 'duplicate', match: a._id + '/0', revision: '0' });
    await duplicates.decide(String(a._id), actor, { outcome: 'unique', match: '', revision: '0' });
    const kept = await Group.findById(group._id);
    expect(kept.pages.map(p => p.filename)).toEqual(['one.png', 'three.png']);
    expect(kept.jobs.map(job => job.kind)).toEqual(['group']);
  });

  test.each([true, false])('checks reviewed duplicates, scopes comparisons and records only OCR decisions (invoice=%s)', async invoice => {
    const { DuplicateFeedback } = require('../../models/document_vault');
    const insurance = require('../../services/insuranceService');
    const Claim = require('../../models/insurance_claim');
    const base = { ownerId: users.owner._id, uploaderId: users.clerk._id, state: 'ready', summaryState: 'ready' };
    const original = { ...answer, filename: 'original.png', title: 'Earlier page', ocrText: '令和六年 七月二日 診療費を受け取りました',
      tags: invoice ? ['invoice'] : [], state: 'stored' };
    const source = await Group.create({ ...base, pages: [original, original] });
    const fresh = await Group.create({ ...base, viewerIds: [users.viewer._id], pages: [{ ...original, state: 'review' }] });
    const id = fresh.pages[0]._id;
    const path = '/duplicates/' + id;
    await Scan.create({ _id: id, groupId: fresh._id, mime: 'image/png', bytes: scan });
    expect((await filePage(fresh.pages[0], invoice ? { invoice: 'on' } : {})).status).toBe(303);
    const flagged = (await Group.findById(fresh._id)).pages[0];
    expect(flagged.duplicateStatus).toBe('possible_duplicate');
    expect((await request('admin', path)).status).toBe(404);
    expect(await (await request('viewer', path)).text()).not.toContain(String(source.pages[0]._id));
    const body = new URLSearchParams({ revision: String(flagged.revision), outcome: 'unique', match: source.pages[0]._id + '/0' });
    expect((await request('viewer', path, body)).status).toBe(403);
    expect((await request('owner', path, body, false)).status).toBe(403);
    if (invoice) {
      await insurance.syncChunk();
      expect(await Claim.exists({ _id: id })).toBeNull();
      expect((await insurance.list(users.viewer._id, { view: 'unreviewed', offset: 0 })).rows).toHaveLength(0);
    }
    expect(await (await request('owner', path)).text()).toContain('Earlier page');
    expect((await request('owner', path, body)).status).toBe(303);
    expect((await request('owner', path, body)).status).toBe(409);
    body.set('match', source.pages[1]._id + '/0');
    body.set('revision', String(flagged.revision + 1));
    body.set('outcome', invoice ? 'unique' : 'duplicate');
    expect((await request('owner', path, body)).status).toBe(303);
    if (invoice) {
      await insurance.syncChunk();
      expect(await Claim.exists({ _id: id })).toBeTruthy();
      expect(await DuplicateFeedback.countDocuments()).toBe(0);
    } else {
      expect(await Scan.exists({ _id: id })).toBeNull();
      expect(await Group.exists({ _id: fresh._id })).toBeNull();
      expect((await Group.findById(source._id)).pages).toHaveLength(2);
      const feedback = await DuplicateFeedback.find().select('-_id').sort({ outcome: 1 }).lean();
      expect(feedback).toEqual([{ overlap: 100, outcome: 'duplicate' }, { overlap: 100, outcome: 'unique' }]);
      expect(await (await request('owner', '/duplicates')).text()).toContain('average 100.0%');
    }
  });

  test('Insurance monthly totals cover all visible invoices across results pages', async () => {
    const group = { ownerId: users.owner._id, uploaderId: users.clerk._id, viewerIds: [users.reader._id], state: 'ready' };
    const invoice = { ...answer, tags: ['invoice'], state: 'stored', filename: 'receipt.png', totalAmount: 0.1, currency: 'USD' };
    await Group.create([
      ...[0, 1].map(() => ({ ...group, pages: Array.from({ length: 12 }, () => invoice) })),
      { ...group, pages: [
        { ...invoice, totalAmount: 400, currency: 'JPY' },
        { ...invoice, totalAmount: 0, currency: null, documentDate: '2026-09-01' },
        { ...invoice, totalAmount: null, currency: null, documentDate: null },
      ] },
      { ...group, viewerIds: [], pages: [invoice] },
    ]);
    for (const offset of [0, 24]) {
      const page = await request('reader', '/insurance/?offset=' + offset);
      expect(page.status).toBe(200);
      const dom = new (require('jsdom').JSDOM)(await page.text());
      try {
        const summary = dom.window.document.querySelector('.insurance-summary');
        expect(summary.querySelector('strong').textContent).toBe('27 invoices');
        expect(Array.from(summary.querySelectorAll('dl > div'), row => [
          row.querySelector('dt').textContent, ...Array.from(row.querySelectorAll('dd > div'), el => el.textContent),
        ])).toEqual([
          ['2026-09', '0 (currency unspecified)'],
          ['2026-08', '400 JPY', '2.4 USD'],
          ['Undated', '1 without a receipt total'],
        ]);
      } finally { dom.window.close(); }
    }
  });

  test('family delegates organize drafts, submit an immutable plan and document snapshot, and update only follow-up notes', async () => {
    const { Batch } = require('../../models/insurance_batch');
    const service = require('../../services/insuranceService');
    const form = fields => new URLSearchParams(fields);
    const get = (who, url) => request(who, '/insurance' + url);
    const post = (who, url, fields, csrf) => request(who, '/insurance' + url, form(fields), csrf);
    const group = { state: 'ready', uploaderId: users.owner._id, ownerId: users.owner._id, viewerIds: [users.delegate._id] };
    const page = { ...answer, tags: ['invoice'], state: 'stored', filename: 'scan.png' };
    const original = await Group.create({ ...group, pages: [page, { ...page, title: 'Second invoice' }] });
    const supporting = await Group.create({ ...group, ownerId: users.admin._id, viewerIds: [users.owner._id, users.delegate._id],
      pages: [{ ...page, tags: [], title: 'Medical referral' }] });
    const unrelated = await Group.create({ ...group, ownerId: users.admin._id, pages: [page] });
    const ids = original.pages.map(p => String(p._id));
    const attachment = String(supporting.pages[0]._id);
    for (const doc of [original, supporting]) {
      await Scan.insertMany(doc.pages.map(p => ({ _id: p._id, groupId: doc._id, mime: 'image/png', bytes: scan })));
    }
    const plan = { name: 'Health cover', company: 'Example Health', ownerId: String(users.owner._id),
      startDate: '2025-01-01', monthlyCost: '4500', currency: 'JPY', coverage: '**Hospital stays**',
      number: 'POL-987654', instructions: '1. Upload scans\n2. Complete the online form.', claimUrl: 'https://example.invalid/claims' };
    expect((await get('viewer', '/plans')).status).toBe(403);
    expect((await post('delegate', '/plans', plan)).status).toBe(403);
    expect((await post('admin', '/plans', plan, false)).status).toBe(403);
    expect((await post('admin', '/plans', { ...plan, ownerId: String(users.viewer._id) })).status).toBe(422);
    expect((await post('admin', '/plans', { ...plan, claimUrl: 'javascript:alert(0)' })).status).toBe(422);
    const added = await post('admin', '/plans', plan);
    expect(added.status).toBe(303);
    const planPath = added.headers.get('location').replace('/insurance', '');
    const planId = planPath.split('/').at(-1);
    for (const route of ['/plans', planPath, planPath + '/edit']) {
      const html = await (await get('admin', route)).text();
      expect(html).toContain('Health cover');
      expect(html).not.toContain(plan.number);
    }
    const assertMarkdown = html => {
      const facts = require('jsdom').JSDOM.fragment(html).querySelector('.claim-facts');
      expect(facts.querySelector('strong').textContent).toBe('Hospital stays');
      expect(Array.from(facts.querySelectorAll('ol li'), li => li.textContent)).toEqual(['Upload scans', 'Complete the online form.']);
    };
    assertMarkdown(await (await get('delegate', planPath)).text());
    expect(await (await get('delegate', planPath + '/number')).text()).toContain(plan.number);
    expect((await get('viewer', planPath + '/number')).status).toBe(403);
    await service.transition(users.delegate._id, ids, 'unreviewed', 'processing');
    const start = () => post('delegate', '/finalize', { ids: ids[0] });
    const attempts = await Promise.all([start(), start()]);
    expect(attempts.map(r => r.status).sort()).toEqual([303, 409]);
    const path = attempts.find(r => r.status === 303).headers.get('location').replace('/insurance', '');
    const batchId = path.split('/').at(-1);
    const change = async (fields, who = 'delegate') => post(who, path, { revision: String((await Batch.findById(batchId)).__v), ...fields });
    expect((await get('admin', path)).status).toBe(404);
    expect(await (await get('delegate', '/finalize')).text()).toContain(answer.title);
    expect((await get('delegate', path)).status).toBe(200);
    expect(await (await get('delegate', path + '?kind=support&q=referral')).text()).toContain('Medical referral');
    expect((await change({ action: 'add', kind: 'support', pageId: String(unrelated.pages[0]._id) })).status).toBe(404);
    expect((await change({ action: 'add', kind: 'invoice', pageId: ids[1] })).status).toBe(303);
    expect((await change({ action: 'remove', kind: 'invoice', pageId: ids[1] })).status).toBe(303);
    const processing = await service.list(users.delegate._id, { view: 'processing', offset: 0 });
    expect(processing.rows.map(p => String(p._id))).toEqual([ids[1]]);
    expect((await change({ action: 'add', kind: 'support', pageId: attachment })).status).toBe(303);
    expect((await change({ action: 'details', notes: 'Prepare claim', planId })).status).toBe(303);
    assertMarkdown(await (await get('delegate', path)).text());
    expect((await post('delegate', path, { action: 'discard', revision: '0' })).status).toBe(409);
    expect((await change({ action: 'submit', planId: '', submittedOn: '2026-11-22', notes: '' })).status).toBe(422);
    expect((await change({ action: 'submit', planId, submittedOn: '2026-11-22', notes: 'Sent via portal' })).status).toBe(303);
    expect((await post('admin', planPath, { ...plan, name: 'Replacement plan', number: '', revision: '0' })).status).toBe(303);
    expect(await (await get('admin', planPath + '/number')).text()).toContain(plan.number);
    expect((await change({ action: 'remove', kind: 'support', pageId: attachment })).status).toBe(409);
    expect((await change({ action: 'followUp', notes: 'Paid in full' })).status).toBe(303);
    const history = await (await get('delegate', path)).text();
    for (const value of ['Health cover', 'Medical referral', 'Paid in full', 'Sent via portal']) expect(history).toContain(value);
    assertMarkdown(history);
    expect(history).not.toContain(plan.number);
    expect(history).not.toContain('Replacement plan');
    expect(await (await get('delegate', path + '/number')).text()).toContain(plan.number);
    const zip = await get('delegate', path + '/scans.zip');
    expect(zip.status).toBe(200);
    expect(Buffer.from(await zip.arrayBuffer()).includes(Buffer.from(attachment + '.png'))).toBe(true);
    const other = await post('delegate', '/finalize', { ids: ids[1] });
    const secondPath = other.headers.get('location').replace('/insurance', '');
    expect((await post('delegate', secondPath, { action: 'submit', planId, revision: '0', notes: '', submittedOn: '2026-11-22' })).status).toBe(303);
    const index = await (await get('delegate', '/batches')).text();
    expect(index).toContain('2 batches · 2 invoices');
    expect(index).toContain('1,000 JPY');
    expect(index).toContain(path);
    expect(index).toContain(secondPath);
    await Group.updateOne({ _id: supporting._id }, { $set: { viewerIds: [users.owner._id] } });
    expect((await get('delegate', path)).status).toBe(404);
    expect((await get('delegate', path + '/number')).status).toBe(404);
    expect((await change({ action: 'followUp', notes: 'Unavailable' })).status).toBe(404);
    expect(await (await get('delegate', '/batches')).text()).not.toContain(path);
    expect((await get('owner', path)).status).toBe(200);
  });

  test('Insurance delegates triage, expiration and dated batches through current vault membership', async () => {
    const service = require('../../services/insuranceService');
    const Claim = require('../../models/insurance_claim');
    const invoice = { ...answer, tags: ['INVOICE'], state: 'stored', filename: 'scan.png', filedAt: new Date() };
    const pages = ['A', 'B', 'C', 'D', 'E'].map(letter => ({ ...invoice, title: 'Fixture invoice ' + letter }));
    pages.push({ ...invoice, title: 'Private draft', state: 'review' }, { ...invoice, title: 'Unrelated', tags: ['receipt'] });
    const group = await Group.create({ ownerId: users.owner._id, uploaderId: users.clerk._id, viewerIds: [users.reader._id],
      state: 'ready', pages, createdAt: new Date('2020-11-20T00:00:00Z') });
    const ids = group.pages.map(p => String(p._id));
    await Scan.insertMany(group.pages.map(p => ({ _id: p._id, groupId: group._id, mime: 'image/png', bytes: scan })));
    const act = (actor, indexes, from, status, date, csrf = true) => {
      const form = new URLSearchParams({ from, status });
      for (const index of indexes) form.append('ids', ids[index]);
      if (date) form.set('submittedOn', date);
      return request(actor, '/insurance/status', form, csrf);
    };
    expect((await request(null, '/insurance/')).status).toBe(401);
    expect((await request('denied', '/insurance/')).status).toBe(403);
    const fresh = await request('reader', '/insurance/');
    expect(fresh.headers.get('cache-control')).toContain('no-store');
    expect(await fresh.text()).toContain('Fixture invoice A');
    expect(await Claim.countDocuments()).toBe(0);
    await Promise.all([service.syncChunk(), service.syncChunk()]);
    expect(await Claim.countDocuments({ status: 'unreviewed' })).toBe(5);
    expect((await act('admin', [0], 'unreviewed', 'processing')).status).toBe(404);
    expect((await act('reader', [5], 'unreviewed', 'processing')).status).toBe(404);
    expect((await act('reader', [0], 'unreviewed', 'processing', null, false)).status).toBe(403);
    expect((await act('reader', [0], 'unreviewed', 'completed', '2026-11-20')).status).toBe(422);
    expect((await act('reader', [0, 1, 2], 'unreviewed', 'processing')).status).toBe(303);
    expect((await act('owner', [3], 'unreviewed', 'processing')).status).toBe(303);
    expect((await act('reader', [3], 'processing', 'dismissed')).status).toBe(303);
    expect(await require('../../models/insurance_batch').Batch.exists({ invoiceIds: ids[3], status: 'dismissed' })).toBeTruthy();
    expect((await act('reader', [4], 'unreviewed', 'dismissed')).status).toBe(303);
    expect((await act('reader', [2], 'processing', 'expired')).status).toBe(303);
    expect((await act('reader', [2], 'processing', 'completed', '2026-11-20')).status).toBe(422);
    const processing = await (await request('owner', '/insurance/processing')).text();
    const dom = new (require('jsdom').JSDOM)(processing, { runScripts: 'outside-only' });
    try {
      dom.window.eval(require('fs').readFileSync(path.resolve(__dirname, '../../public/js/insurance.js'), 'utf8'));
      const doc = dom.window.document;
      const summary = doc.querySelector('.insurance-summary');
      expect(summary.querySelector('strong').textContent).toBe('2 invoices');
      expect(summary.querySelector('dt').textContent).toBe('2026-08');
      expect(summary.querySelector('dd').textContent).toBe('1,000 JPY');
      expect(doc.querySelectorAll('button[value="dismissed"]')).toHaveLength(2);
      expect(doc.querySelector('#submit-claims button').disabled).toBe(true);
      doc.querySelector('[data-select-all] input').click();
      expect(doc.querySelectorAll('[name="ids"]:checked')).toHaveLength(2);
      expect(doc.querySelector('#submit-claims button').disabled).toBe(false);
    } finally { dom.window.close(); }
    const zip = await request('owner', '/insurance/processing/all-scans.zip');
    expect(zip.status).toBe(200);
    const bytes = Buffer.from(await zip.arrayBuffer());
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(bytes.includes(Buffer.from(ids[0] + '.png'))).toBe(true);
    expect(bytes.includes(Buffer.from(ids[2] + '.png'))).toBe(false);
    // Existing completed claims remain browsable after the introduction of explicit batches.
    await Claim.updateMany({ _id: { $in: ids.slice(0, 2) } }, { status: 'completed', submittedOn: '2026-11-20', updatedBy: users.reader._id });
    await service.syncChunk();
    expect(await Claim.countDocuments({ status: 'completed', submittedOn: '2026-11-20', updatedBy: users.reader._id })).toBe(2);
    expect(await (await request('owner', '/insurance/')).text()).toContain('No invoices awaiting review');
    expect(await (await request('owner', '/insurance/processing')).text()).toContain('No invoices awaiting submission');
    expect(await (await request('owner', '/insurance/batches')).text()).toContain('2026-11-20');
    const batch = '?date=2026-11-20&owner=' + users.owner._id;
    expect(await (await request('reader', '/insurance/batch' + batch)).text()).toContain('Fixture invoice B');
    const followUp = new URLSearchParams({ owner: String(users.owner._id), date: '2026-11-20', revision: '0', notes: 'Legacy outcome' });
    expect((await request('owner', '/insurance/legacy-notes', followUp)).status).toBe(303);
    expect(await (await request('owner', '/insurance/batch' + batch)).text()).toContain('Legacy outcome');
    expect((await request('reader', '/insurance/legacy-notes', followUp)).status).toBe(403);
    const ownBatch = await request('reader', '/insurance/batch/all-scans.zip' + batch);
    expect(ownBatch.status).toBe(200);
    expect(Buffer.from(await ownBatch.arrayBuffer()).includes(Buffer.from(ids[1] + '.png'))).toBe(true);
    const otherGroup = await Group.create({ ownerId: users.viewer._id, uploaderId: users.clerk._id,
      viewerIds: [users.reader._id], state: 'ready', pages: [{ ...invoice, title: 'Second owner' }] });
    const secondId = String(otherGroup.pages[0]._id);
    await service.transition(users.reader._id, [secondId], 'unreviewed', 'processing');
    await Claim.updateOne({ _id: secondId }, { status: 'completed', submittedOn: '2026-11-20' });
    const list = await service.list(users.reader._id, { view: 'batches', offset: 0 });
    expect(list.rows.map(row => row.count).sort()).toEqual([1, 2]);
    const batches = await (await request('reader', '/insurance/batches')).text();
    expect(batches).toContain('2 batches · 3 invoices');
    expect(batches).toContain('<dt>2026-11</dt>');
    expect(batches).toContain('1,500 JPY');
    expect(await (await request('reader', '/insurance/batch' + batch)).text()).not.toContain('Second owner');
    await Group.updateOne({ _id: otherGroup._id }, { $set: { 'pages.0.tags': [] } });
    await Group.updateOne({ _id: group._id }, { $set: { viewerIds: [] } });
    expect(await (await request('reader', '/insurance/batches')).text()).toContain('No submitted batches');
    expect((await request('reader', '/insurance/batch/scans.zip' + batch)).status).toBe(404);
    expect((await request('reader', '/pages/' + ids[0] + '/image')).status).toBe(404);
  });

  test('corrects one filed storage location and enforces scope, revision and page state', async () => {
    const physical = { decision: 'keep', yearLabel: '2025', folderId: 'F.1', groupLabel: 'Old' };
    const seed = { ...answer, filename: 'scan.png', state: 'stored', filedAt: new Date(), physical };
    const group = await Group.create({ ownerId: users.owner._id, uploaderId: users.clerk._id, viewerIds: [users.viewer._id, users.reader._id],
      state: 'ready', pages: [seed, { ...seed, physical: { decision: 'dispose' } }, { ...seed, state: 'review', filedAt: null }] });
    const [page, disposed, pending] = group.pages;
    const path = '/pages/' + page._id;
    const body = new URLSearchParams({ revision: '0', yearLabel: '2025', folderId: 'F.1', groupLabel: 'Corrected' });
    expect(await (await request('owner', path)).text()).toContain('Edit storage location');
    for (const actor of ['viewer', 'reader']) {
      expect(await (await request(actor, path)).text()).toContain('Edit storage location');
      expect((await request(actor, '/pages/' + pending._id + '/location', body)).status).toBe(404);
      expect((await request(actor, '/pages/' + disposed._id + '/location', body)).status).toBe(409);
    }
    for (const actor of ['clerk', 'admin']) expect((await request(actor, path + '/location', body)).status).toBe(404);
    expect((await request('reader', path + '/location', body, false)).status).toBe(403);
    expect((await request('reader', path + '/redo', new URLSearchParams({ revision: '0', mode: 'chat' }))).status).toBe(403);
    for (const other of [disposed, pending]) expect((await request('owner', '/pages/' + other._id + '/location', body)).status).toBe(409);
    const blank = new URLSearchParams(body);
    blank.set('groupLabel', ' ');
    expect((await request('owner', path + '/location', blank)).status).toBe(422);
    expect((await request('reader', path + '/location', body)).status).toBe(303);
    expect((await request('owner', path + '/location', body)).status).toBe(409);
    const saved = await Group.findById(group._id);
    expect(saved.pages[0]).toMatchObject({ state: 'stored', filedAt: page.filedAt, revision: 1, physical: { ...physical, groupLabel: 'Corrected' } });
    expect(saved.jobs).toHaveLength(0);
    expect(saved.pages[2].physical.groupLabel).toBe('Old');
    expect((await repo.list('archive', users.viewer._id, { filters: { groupLabel: 'corrected' } })).rows.map(p => p._id)).toEqual([page._id]);
    expect((await repo.list('archive', users.viewer._id, { filters: { groupLabel: 'Old' } })).rows).toEqual([]);
    body.set('revision', '1');
    await Group.updateOne({ _id: group._id }, { $pull: { viewerIds: users.reader._id } });
    expect((await request('reader', path + '/location', body)).status).toBe(404);
  });

  test('combines inclusive page date bounds and independent exact location filters across archive pages', async () => {
    const physical = { decision: 'keep', yearLabel: 'FY26', folderId: 'F.1', groupLabel: 'Tax & fees' };
    const seed = { ...answer, title: 'Target receipt', filename: 'scan.png', state: 'stored', documentDate: '2026-08-14', physical };
    const group = { ownerId: users.owner._id, uploaderId: users.owner._id, viewerIds: [users.viewer._id], state: 'ready' };
    for (let i = 0; i < 3; i++) await Group.create({ ...group, pages: Array.from({ length: 9 }, () => seed) });
    await Group.create({ ...group, pages: [
      { ...seed, title: 'Later receipt', documentDate: '2026-08-15', physical: { ...physical, folderId: 'FX1' } },
      { ...seed, title: 'Undated receipt', documentDate: null, physical: { decision: 'dispose' } },
    ] });
    const query = new URLSearchParams({ q: 'receipt', dateFrom: '2026-08-14', dateTo: '2026-08-14',
      yearLabel: 'fy26', folderId: 'F.1', groupLabel: 'Tax & fees' });
    const html = await (await request('viewer', '/?' + query)).text();
    const dom = new (require('jsdom').JSDOM)(html);
    try {
      const next = dom.window.document.querySelector('.pager a').getAttribute('href');
      const params = new URL(next, 'http://localhost').searchParams;
      for (const [key, value] of query) expect(params.get(key)).toBe(value);
      const more = await (await request('viewer', '/?' + params)).text();
      expect(more.match(/class="doc-link"/g)).toHaveLength(3);
      expect(more).not.toContain('Later receipt');
    } finally { dom.window.close(); }
    for (const filters of ['dateFrom=2026-08-15', 'folderId=fx1']) {
      const results = await (await request('viewer', '/?' + filters)).text();
      expect(results).toContain('Later receipt');
      expect(results).not.toContain('Target receipt');
    }
    const endOnly = await (await request('viewer', '/?dateTo=2026-08-14')).text();
    expect(endOnly).toContain('Target receipt');
    expect(endOnly).not.toContain('Undated receipt');
    expect(await (await request('admin', '/?' + query)).text()).toContain('No matching pages');
    for (const malformed of ['dateFrom=2026-02-31', 'dateFrom=2026-09-01&dateTo=2026-08-31', 'folderId=x&folderId=y']) {
      expect((await request('viewer', '/?' + malformed)).status).toBe(422);
    }
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
