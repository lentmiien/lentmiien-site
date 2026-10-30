const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const sharp = require('sharp');
const { randomUUID } = require('crypto');
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
jest.mock('../../database', () => ({ UseraccountModel: { findById: jest.fn() } }));
const { UseraccountModel } = require('../../database');
const logger = require('../../utils/logger');
const { LabStore } = require('../../services/experimentalModels/storage');
const { LabGateway } = require('../../services/experimentalModels/gateway');
const { LabJobs } = require('../../services/experimentalModels/jobs');
const { LIMITS } = require('../../services/experimentalModels/policy');
const { parseInput, validateWav, REFERENCE_TASKS, WEVIS_TASKS, CONTROLS } = require('../../services/experimentalModels/contracts');
const { createRouter } = require('../../routes/experimentalModels');
const { wav, vision } = require('../helpers/experimentalModelsFixtures');
const owner = 'a'.repeat(24), secret = 'synthetic-ming-private-secret';
const reference = (fileId, task = 'TTS') => ({ task, fileId, text: 'Synthetic speech.', transcript: 'Synthetic reference.', consent: true,
  language: task === 'MULTILINGUAL' ? 'ja' : 'zh', controls: { BASIC: { speed: '慢速', pitch: '中', volume: '高' }, EMOTION: { emotion: '高兴' }, DIALECT: { dialect: 'cantonese' } }[task] || {}, max_decode_steps: 200 });
async function until(predicate) {
  for (let i = 0; i < 300; i += 1) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  throw new Error('Local test did not settle');
}
const listen = app => new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
const close = server => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); };

describe('real Site HTTP, session, dispatch authority, storage, queue and mock Gateway wire contract', () => {
  let root, store, gateway, jobs, site, upstream, origin, calls, releases, hold, capability, capStatus, runStatus, output, now, role, sessionStore;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-ephemeral-'));
    now = Date.now(); role = 'admin'; hold = false; releases = []; calls = [];
    capability = { available: true, ephemeral_reference: { version: 1 }, container_state: 'stopped' }; capStatus = 200; runStatus = 200; output = wav(44100, 1);
    UseraccountModel.findById.mockImplementation(() => ({ select: () => ({ maxTimeMS: () => ({ lean: async () => ({ _id: owner, name: 'synthetic', type_user: role }) }) }) }));
    const mock = express();
    mock.use((req, res, next) => { calls.push({ method: req.method, path: req.path, token: req.get('X-Ming-Token') }); next(); });
    mock.get('/tts/ming/capabilities', (_req, res) => res.status(capStatus).json(capability));
    mock.get('/perception/wevisone-vl/capabilities', (_req, res) => res.json({ available: true }));
    mock.get('/limits', (req, res) => { expect(req.get('X-Ming-Token')).toBeUndefined(); res.json({ queue_timeout_sec: 900, upstream_timeout_sec: 630 }); });
    const terminal = async (req, res) => {
      expect(req.get('X-Ming-Token')).toBe(secret);
      if (hold) await new Promise(resolve => releases.push(resolve));
      if (runStatus !== 200) return res.status(runStatus).json({ detail: { private: `${secret} /private/path private transcript` } });
      res.set({ 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Generation-Complete': 'true', 'X-Private': secret }).send(output);
    };
    mock.post('/tts/ming/tasks/ephemeral', multer({ storage: multer.memoryStorage(), limits: { files: 1, fields: 3, parts: 4, fileSize: 6291456, fieldSize: 16384 } }).single('file'), async (req, res) => {
      expect(Number(req.get('content-length'))).toBeLessThanOrEqual(6320128);
      expect(Object.keys(req.body).sort()).toEqual(['consent', 'request', 'transcript']);
      expect(req.file.originalname).toBe('reference.wav'); expect(req.file.mimetype).toBe('audio/wav');
      validateWav(req.file.buffer, { reference: true });
      expect(req.body.consent).toBe('true'); expect(typeof req.body.request).toBe('string'); expect(typeof req.body.transcript).toBe('string');
      const value = JSON.parse(req.body.request);
      expect(Object.keys(value).sort()).toEqual(['controls', 'language', 'max_decode_steps', 'task', 'text']);
      expect(REFERENCE_TASKS).toContain(value.task);
      calls.at(-1).request = value; calls.at(-1).reference = req.file.buffer;
      await terminal(req, res);
    });
    mock.post('/tts/ming/tasks', express.json(), terminal);
    mock.post('/perception/wevisone-vl', multer().single('file'), (req, res) => {
      expect(req.get('X-Ming-Token')).toBeUndefined();
      expect(Object.keys(req.body).sort()).toEqual(['max_new_tokens', 'query', 'task']);
      res.set('Cache-Control', 'no-store').json(vision(req.body.task));
    });
    mock.use((_req, res) => res.status(404).json({ error: 'Mock endpoint not allowed' }));
    upstream = await listen(mock);
    gateway = new LabGateway({ env: { AI_GATEWAY_BASE_URL: `http://127.0.0.1:${upstream.address().port}`, MING_ADMIN_TOKEN: secret } });
    store = new LabStore({ root, now: () => now }); jobs = new LabJobs({ store, gateway });
    const app = express(); app.set('views', path.resolve('views')); app.set('view engine', 'pug');
    sessionStore = new session.MemoryStore();
    app.use(session({ secret: 'synthetic-browser-session-secret', store: sessionStore, resave: false, saveUninitialized: false }));
    app.use((req, res, next) => {
      const account = req.get('x-owner') || owner, type = req.get('x-role') || 'admin';
      req.user = { _id: account, name: 'synthetic', type_user: type }; req.isAuthenticated = () => type !== 'anonymous';
      req.session.passport = { user: account };
      Object.assign(res.locals, { loggedIn: true, admin: type === 'admin', permissions: [], htmlPaths: [], bookmarks: [] }); next();
    });
    // Real dispatchAuthorization reads the live session and mocked account record.
    app.use('/admin/experimental-models', createRouter({ store, jobs }));
    site = await listen(app); origin = `http://127.0.0.1:${site.address().port}/admin/experimental-models`;
  });
  afterEach(async () => {
    hold = false; releases.forEach(resolve => resolve());
    if (jobs.running) await jobs.draining;
    await close(site); await close(upstream); await fs.rm(root, { recursive: true, force: true });
    expect(calls.some(call => /voices|register|catalog|delete/i.test(call.path))).toBe(false);
    expect(JSON.stringify(logger.error.mock.calls) + JSON.stringify(logger.warning.mock.calls)).not.toMatch(/synthetic-ming-private-secret|private transcript|\/private\/path/);
  });
  async function browser() {
    const response = await fetch(origin), html = await response.text();
    return { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': /data-csrf="([^"]+)"/.exec(html)[1] };
  }
  const call = (b, url, method = 'GET', body) => fetch(origin + '/api' + url, { method, headers: { ...b, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  async function upload(b, id, bytes = wav(16000, 1, 2), fields = [], { type = 'audio/wav', filename = 'synthetic.wav' } = {}) {
    const form = new FormData(); form.append('file', new File([bytes], filename, { type }));
    for (const [key, value] of fields) form.append(key, value);
    return call(b, `/sessions/${id}/references`, 'POST', form);
  }
  async function setup() {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const response = await upload(b, s.id); expect(response.status).toBe(201);
    return { b, s, asset: await response.json() };
  }
  async function run(b, s, input, model = 'ming-tts') {
    const response = await call(b, `/sessions/${s.id}/experiments/${model}/runs`, 'POST', input);
    expect(response.status).toBe(202); const job = await response.json();
    await until(() => !jobs.running);
    return (await call(b, `/sessions/${s.id}/jobs/${job.id}`)).json();
  }
  test.each(['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave', 'application/octet-stream', ''])('native File MIME %s admits strict WAV bytes and normalizes stored MIME', async type => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const response = await upload(b, s.id, wav(), [], { type, filename: 'experiment-11111111-1111-4111-8111-111111111111.wav' });
    expect(response.status).toBe(201);
    const asset = await response.json(); expect(asset).toMatchObject({ mime: 'audio/wav', audio: { durationSeconds: 1 } });
    expect(await fs.readFile(path.join(root, s.id, `${asset.id}.wav`))).toEqual(wav());
    expect(logger.warning).not.toHaveBeenCalled();
  });
  test.each([
    ['empty_file', 400, Buffer.alloc(0), {}],
    ['mime', 400, wav(), { type: 'text/html' }],
    ['mime', 400, wav(), { type: 'audio/mpeg' }],
    ['mime', 400, wav(), { type: 'application/json' }],
    ['extension', 400, wav(), { filename: 'synthetic.mp3' }],
    ['filename', 400, wav(), { filename: 'a'.repeat(197) + '.wav' }],
    ['filename', 400, wav(), { filename: '../synthetic.wav' }],
    ['filename', 400, wav(), { filename: 'C:\\private\\synthetic.wav' }],
    ['wav_format', 422, Buffer.from('<html>not audio</html>'), { type: 'application/octet-stream' }],
    ['wav_format', 422, Buffer.from('{"token":"private transcript"}'), { type: '' }],
    ['rate', 422, wav(8000), {}], ['channels', 422, wav(16000, 1, 3), {}],
    ['duration', 422, wav(16000, 0.5), {}], ['duration', 422, wav(16000, 30.01), {}],
    ['size', 413, Buffer.alloc(6291457), {}],
  ])('reference %s returns safe HTTP %s diagnostics without persisting or logging content', async (reason, status, bytes, options) => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const response = await upload(b, s.id, bytes, [], options), body = await response.json();
    expect(response.status).toBe(status);
    expect(body).toMatchObject({ status, code: `reference_${reason}`, reason, stage: expect.any(String), requestId: expect.any(String) });
    expect(logger.warning).toHaveBeenCalledWith(expect.any(String), { category: 'experimental_models', metadata: expect.objectContaining({ status, code: body.code, reason, requestId: body.requestId }) });
    expect(JSON.stringify(body) + JSON.stringify(logger.warning.mock.calls)).not.toMatch(/synthetic\.wav|private transcript|private\\synthetic|<html>/);
    expect(await fs.readdir(path.join(root, s.id))).toEqual(['session.json']); expect(calls).toEqual([]);
  });
  const design = { task: 'VOICE_DESIGN', text: 'Synthetic speech.', language: 'en', controls: { style: 'Calm' } };
  test('generated result is reused as the exact four-part ephemeral bytes without copying or reference registration', async () => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const generated = await run(b, s, design);
    const before = await (await call(b, `/sessions/${s.id}`)).json();
    expect(before.assets).toHaveLength(1);
    expect(before.assets[0]).toMatchObject({ id: generated.resultId, referenceEligible: true, audio: generated.audio });
    for (const consent of [false, undefined]) {
      expect((await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', { ...reference(generated.resultId), consent })).status).toBe(422);
    }
    const reused = await run(b, s, reference(generated.resultId));
    expect(reused.state).toBe('succeeded');
    expect(calls.find(c => c.path.endsWith('/ephemeral')).reference).toEqual(output);
    const after = await (await call(b, `/sessions/${s.id}`)).json();
    expect(after.assets).toHaveLength(2); // Only two outputs, no copied reference.
    expect((await fs.readdir(path.join(root, s.id))).sort()).toEqual([`${generated.resultId}.wav`, `${reused.resultId}.wav`, 'session.json'].sort());
    await call(b, `/sessions/${s.id}`, 'DELETE'); expect(await fs.readdir(root)).toEqual([]);
  });
  test.each([0.5, 30.01])('successful %s second output remains downloadable but cannot be a reference', async seconds => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json(); output = wav(16000, seconds);
    const generated = await run(b, s, design); expect(generated.state).toBe('succeeded');
    const summary = await (await call(b, `/sessions/${s.id}`)).json(); expect(summary.assets[0].referenceEligible).toBe(false);
    const rejected = await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', reference(generated.resultId));
    expect(rejected.status).toBe(422); expect(await rejected.json()).toMatchObject({ reason: 'duration', numeric: { durationSeconds: seconds, minSeconds: 1, maxSeconds: 30 } });
    expect((await call(b, `/sessions/${s.id}/files/${generated.resultId}`)).status).toBe(200);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });
  test.each(['owner', 'browser', 'session', 'expired', 'cleared', 'failed', 'queued', 'arbitrary', 'json', 'tampered'])('generated reference denies %s before inference', async kind => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const generated = await run(b, s, design), local = store.sessions.get(s.id);
    let headers = b, sessionId = s.id, assetId = generated.resultId;
    if (kind === 'owner') headers = { ...b, 'x-owner': 'b'.repeat(24) };
    if (kind === 'browser') headers = await browser();
    if (kind === 'session') sessionId = (await (await call(b, '/sessions', 'POST')).json()).id;
    if (kind === 'expired') now = s.expiresAt;
    if (kind === 'cleared') await call(b, `/sessions/${s.id}`, 'DELETE');
    if (['failed', 'queued'].includes(kind)) local.jobs[0].state = kind;
    if (kind === 'arbitrary') { local.jobs[0].resultId = randomUUID(); }
    if (kind === 'json') local.assets[0].mime = 'application/json';
    if (kind === 'tampered') { const bytes = Buffer.alloc(output.length); await fs.writeFile(path.join(root, s.id, `${assetId}.wav`), bytes); }
    const rejected = await call(headers, `/sessions/${sessionId}/experiments/ming-tts/runs`, 'POST', reference(assetId));
    expect(rejected.status).toBe(kind === 'queued' ? 409 : kind === 'tampered' ? 422 : 404);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });
  test('reuse reserves output quota and clear waits for its lease, rejects new uses and discards late output', async () => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const generated = await run(b, s, design);
    for (const key of ['sessionBytes', 'userBytes', 'globalBytes']) {
      store.limits = { ...LIMITS, [key]: output.length + 6291456 };
      expect((await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', reference(generated.resultId))).status).toBe(429);
    }
    store.limits = LIMITS; hold = true;
    expect((await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', reference(generated.resultId))).status).toBe(202);
    await until(() => releases.length === 1);
    expect((await call(b, `/sessions/${s.id}`, 'DELETE')).status).toBe(202);
    expect((await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', reference(generated.resultId))).status).toBe(404);
    expect((await fs.readdir(path.join(root, s.id))).sort()).toEqual([`${generated.resultId}.wav`, 'session.json'].sort());
    releases[0](); await until(() => !jobs.running);
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('queued generated reference revalidates bytes at dispatch after another session releases the worker', async () => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const generated = await run(b, s, design), second = await (await call(b, '/sessions', 'POST')).json();
    hold = true;
    await call(b, `/sessions/${second.id}/experiments/ming-tts/runs`, 'POST', design); await until(() => releases.length === 1);
    const response = await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', reference(generated.resultId));
    expect(response.status).toBe(202); const queued = await response.json();
    await fs.writeFile(path.join(root, s.id, `${generated.resultId}.wav`), Buffer.alloc(output.length));
    releases[0](); await until(() => !jobs.running);
    expect(await (await call(b, `/sessions/${s.id}/jobs/${queued.id}`)).json()).toMatchObject({ state: 'failed', code: 'reference_wav_format' });
    expect(calls.some(c => c.path.endsWith('/ephemeral'))).toBe(false); expect(store.leases.size).toBe(0);
  });
  test('restart derives generated reference eligibility without changing the manifest or copying audio', async () => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const generated = await run(b, s, design), binding = store.sessions.get(s.id).binding;
    const recovered = new LabStore({ root, now: () => now });
    const summary = await recovered.get(owner, binding, s.id);
    expect(summary.assets[0]).toMatchObject({ id: generated.resultId, referenceEligible: true });
    expect((await recovered.exclusive(() => recovered.referenceSource(owner, binding, s.id, generated.resultId))).bytes).toEqual(output);
    const manifest = JSON.parse(await fs.readFile(path.join(root, s.id, 'session.json')));
    expect(manifest.assets).toHaveLength(1); expect(manifest.assets[0].audio).toBeUndefined();
  });
  test('download lease keeps reused asset until close, while delete-pending denies reference resolution', async () => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const generated = await run(b, s, design), binding = store.sessions.get(s.id).binding;
    const download = await store.download(owner, binding, s.id, generated.resultId);
    expect((await call(b, `/sessions/${s.id}`, 'DELETE')).status).toBe(202);
    await expect(store.exclusive(() => store.referenceSource(owner, binding, s.id, generated.resultId))).rejects.toMatchObject({ status: 404 });
    await download.handle.close(); await store.sweep(); expect(await fs.readdir(root)).toEqual([]);
  });
  test.each([...REFERENCE_TASKS, 'VOICE_DESIGN', 'FREEFORM'])('Ming %s completes, exposes safe WAV metadata, clears every local artifact', async task => {
    const { b, s, asset } = await setup();
    const input = REFERENCE_TASKS.includes(task) ? reference(asset.id, task) : { task, text: 'Synthetic speech', language: 'en', ...(task === 'VOICE_DESIGN' ? { controls: { style: 'Calm' } } : { instruction: 'Speak softly' }) };
    const job = await run(b, s, input);
    expect(job).toMatchObject({ state: 'succeeded', status: 200, audio: { sampleRate: 44100, channels: 1, durationSeconds: 1 } });
    expect(job.request).not.toMatch(/synthetic-ming-private-secret|private_data|base64|reference_id|voice_id/);
    if (REFERENCE_TASKS.includes(task)) {
      expect(JSON.parse(job.request)).toMatchObject({ endpoint: '/tts/ming/tasks/ephemeral', fields: { consent: true, transcript: input.transcript } });
      expect(calls.find(c => c.path.endsWith('/ephemeral')).reference).toEqual(wav(16000, 1, 2));
    }
    const download = await call(b, `/sessions/${s.id}/files/${job.resultId}`);
    expect(download.headers.get('content-type')).toBe('audio/wav'); expect(download.headers.get('cache-control')).toContain('no-store');
    expect(download.headers.get('content-disposition')).toMatch(/^attachment; filename="experiment-[a-f0-9-]+\.wav"$/);
    expect(Buffer.from(await download.arrayBuffer())).toEqual(output);
    expect(JSON.stringify(job.headers)).not.toContain(secret);
    await until(() => !store.leases.size);
    const manifest = JSON.parse(await fs.readFile(path.join(root, s.id, 'session.json')));
    expect((await fs.stat(path.join(root, s.id, `${asset.id}.wav`))).mode & 0o777).toBe(0o600);
    expect((await store.get(owner, manifest.binding, s.id)).bytes).toBeGreaterThan(asset.bytes + output.length);
    expect((await call(b, `/sessions/${s.id}`, 'DELETE')).status).toBe(200); expect(await fs.readdir(root)).toEqual([]);
  });
  test.each(WEVIS_TASKS)('WeVis %s remains usable through the same full HTTP lifecycle', async task => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#222' } }).png().toBuffer();
    const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'synthetic.png');
    const asset = await (await call(b, `/sessions/${s.id}/files`, 'POST', form)).json();
    const job = await run(b, s, { fileId: asset.id, task, query: task === 'ocr' ? '' : 'cup' }, 'wevisone-vl');
    expect(job.state).toBe('succeeded');
    expect(await (await call(b, `/sessions/${s.id}/files/${job.resultId}`)).json()).toMatchObject(vision(task));
  });
  test.each([16000, 44100])('validates uploaded %i Hz mono/stereo bytes instead of trusting extension', async rate => {
    const { b, s } = await setup();
    for (const channels of [1, 2]) {
      const response = await upload(b, s.id, wav(rate, 1, channels)); expect(response.status).toBe(201);
      expect((await response.json()).audio).toMatchObject({ sampleRate: rate, channels, durationSeconds: 1 });
    }
  });
  test('reference upload rejects extra parts, duplicates, malformed/truncated WAV and oversized bodies without files', async () => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    for (const [bytes, fields, status] of [[Buffer.from('not audio'), [], 422], [wav().subarray(0, 100), [], 422], [wav(), [['url', 'https://invalid']], 413],
      [wav(), [['file', new Blob([wav()])]], 413], [Buffer.alloc(6291457), [], 413]]) {
      expect((await upload(b, s.id, bytes, fields)).status).toBe(status);
    }
    expect(await fs.readdir(path.join(root, s.id))).toEqual(['session.json']); expect(calls).toEqual([]);
  });
  test.each(['anonymous', 'family', 'user', 'csrf', 'origin', 'owner', 'login'])('denies %s reference upload and run before Gateway access', async kind => {
    const { b, s, asset } = await setup();
    const headers = kind === 'login' ? await browser() : { ...b, ...(['anonymous', 'family', 'user'].includes(kind) ? { 'x-role': kind } : kind === 'owner' ? { 'x-owner': 'b'.repeat(24) } : kind === 'csrf' ? { 'X-CSRF-Token': '' } : { Origin: 'https://foreign.invalid' }) };
    const expected = kind === 'anonymous' ? 401 : ['owner', 'login'].includes(kind) ? 404 : 403;
    expect((await upload(headers, s.id)).status).toBe(expected);
    expect((await call(headers, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', reference(asset.id))).status).toBe(expected);
    expect(calls).toEqual([]);
  });
  test('foreign-session and expired file IDs cannot become a Gateway reference', async () => {
    const { b, s, asset } = await setup(), second = await (await call(b, '/sessions', 'POST')).json();
    expect((await call(b, `/sessions/${second.id}/experiments/ming-tts/runs`, 'POST', reference(asset.id))).status).toBe(404);
    now = s.expiresAt;
    expect((await upload(b, s.id)).status).toBe(404);
    expect((await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', reference(asset.id))).status).toBe(404);
    await store.sweep(); expect(await fs.readdir(root)).toEqual([]); expect(calls.some(c => c.method === 'POST')).toBe(false);
  });
  test.each(['missing', '404', 'version2', 'credential', '501'])('old or unavailable backend %s fails honestly without fallback; JSON tasks still work when configured', async kind => {
    const { b, s, asset } = await setup();
    if (kind === 'missing') delete capability.ephemeral_reference;
    if (kind === '404') capStatus = 404;
    if (kind === 'version2') capability.ephemeral_reference.version = 2;
    if (kind === 'credential') delete gateway.env.MING_ADMIN_TOKEN;
    if (kind === '501') runStatus = 501;
    const response = await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', reference(asset.id));
    if (kind === '501') {
      expect(response.status).toBe(202); const queued = await response.json(); await until(() => !jobs.running);
      const job = await (await call(b, `/sessions/${s.id}/jobs/${queued.id}`)).json();
      expect(job).toMatchObject({ state: 'failed', code: 'worker_update_required', status: 501 }); expect(job.resultId).toBeUndefined();
      expect(JSON.stringify(job)).not.toMatch(/private transcript|\/private\/path/);
    } else { expect(response.status).toBe(503); expect(calls.some(c => c.method === 'POST')).toBe(false); }
    if (kind === 'credential') expect(calls).toEqual([]);
    else {
      runStatus = 200;
      expect((await run(b, s, { task: 'FREEFORM', language: 'en', text: 'Test', instruction: 'Speak calmly' })).state).toBe('succeeded');
    }
  });
  test('clear retains a lease while forwarded, drops a queued reference, discards late audio, removes transcripts and files', async () => {
    const a = await setup(), b = await setup(); hold = true;
    const first = await (await call(a.b, `/sessions/${a.s.id}/experiments/ming-tts/runs`, 'POST', reference(a.asset.id))).json();
    await until(() => releases.length === 1);
    const second = await (await call(b.b, `/sessions/${b.s.id}/experiments/ming-tts/runs`, 'POST', reference(b.asset.id))).json();
    expect(second.state).toBe('queued');
    expect((await call(a.b, `/sessions/${a.s.id}`, 'DELETE')).status).toBe(202);
    expect((await call(b.b, `/sessions/${b.s.id}`, 'DELETE')).status).toBe(200);
    expect(jobs.pending).toEqual([]);
    releases[0](); await until(() => !jobs.running);
    expect((await call(a.b, `/sessions/${a.s.id}/jobs/${first.id}`)).status).toBe(404);
    expect(await fs.readdir(root)).toEqual([]); expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });
  test.each(['logout', 'role', 'expiry'])('queued reference rechecks %s before forwarding and cleanup stays restart safe', async kind => {
    const a = await setup(), b = await setup(); hold = true;
    await call(a.b, `/sessions/${a.s.id}/experiments/ming-tts/runs`, 'POST', reference(a.asset.id)); await until(() => releases.length === 1);
    const queued = await (await call(b.b, `/sessions/${b.s.id}/experiments/ming-tts/runs`, 'POST', reference(b.asset.id))).json();
    if (kind === 'logout') await new Promise(resolve => sessionStore.clear(resolve));
    if (kind === 'role') role = 'user';
    if (kind === 'expiry') now = b.s.expiresAt;
    releases[0](); await until(() => !jobs.running);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
    if (kind !== 'expiry') expect(store.sessions.get(b.s.id).jobs.find(j => j.id === queued.id).code).toBe('authorization_revoked');
    const recovered = new LabStore({ root, now: () => now + LIMITS.ttlMs }); await recovered.sweep();
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('restart restores reference metadata and quota; inspectors redact credential-like user text', async () => {
    const { b, s, asset } = await setup();
    const job = await run(b, s, { ...reference(asset.id), text: secret, transcript: secret });
    expect(job.state).toBe('succeeded'); expect(job.request).toContain('[redacted]'); expect(job.request).not.toContain(secret);
    const manifest = JSON.parse(await fs.readFile(path.join(root, s.id, 'session.json')));
    const recovered = new LabStore({ root, now: () => now });
    const restored = await recovered.get(owner, manifest.binding, s.id);
    expect(restored.assets).toHaveLength(2); expect(restored.assets[0].audio).toEqual(asset.audio);
    expect(restored.jobs[0].state).toBe('succeeded'); expect(restored.bytes).toBe((await store.get(owner, manifest.binding, s.id)).bytes);
    expect(calls.filter(c => c.method === 'POST')).toHaveLength(1);
  });
  test.each(['badWav', 'timeout', 'missingEndpoint'])('ephemeral %s produces no output and clear removes private inputs', async kind => {
    const { b, s, asset } = await setup();
    if (kind === 'badWav') output = Buffer.from('not audio');
    if (kind === 'timeout') runStatus = 504;
    if (kind === 'missingEndpoint') runStatus = 404;
    const job = await run(b, s, reference(asset.id));
    expect(job.state).toBe(kind === 'timeout' ? 'interrupted' : 'failed'); expect(job.resultId).toBeUndefined();
    expect((await fs.readdir(path.join(root, s.id))).sort()).toEqual([`${asset.id}.wav`, 'session.json'].sort());
    await call(b, `/sessions/${s.id}`, 'DELETE'); expect(await fs.readdir(root)).toEqual([]);
  });
  test('reference, manifest and maximum result reservations apply to every quota before forwarding', async () => {
    const { b, s, asset } = await setup();
    for (const key of ['sessionBytes', 'userBytes', 'globalBytes']) {
      store.limits = { ...LIMITS, [key]: asset.bytes + 6291456 };
      expect((await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', reference(asset.id))).status).toBe(429);
    }
    expect(calls.some(c => c.method === 'POST')).toBe(false);
  });
});

describe('ephemeral field and WAV boundary matrix', () => {
  const input = reference(randomUUID());
  test.each([
    { consent: false }, { consent: 'true' }, { consent: undefined }, { transcript: '' }, { transcript: ' '.repeat(2049) }, { transcript: '😀'.repeat(2049) },
    { transcript: 'a<b' }, { transcript: 'a\rb' }, { fileId: '../source.wav' }, { fileId: 'https://invalid' }, { reference_id: null }, { voice_id: 'voice' },
    { path: '/private/path' }, { url: 'https://invalid' }, { reference_language: 'en' }, { instruction: null }, { instructions: 'test' }, { max_decode_steps: true },
    { controls: { speed: '慢速' } }, { task: 'MULTILINGUAL', language: 'ja', text: '[Uhm] hello' }, { task: 'MULTILINGUAL', language: 'en' },
    { task: 'BASIC', controls: {} }, { task: 'BASIC', controls: { speed: 'slow' } }, { task: 'EMOTION', controls: { emotion: '高兴', speed: '慢速' } },
    { task: 'DIALECT', language: 'en', controls: { dialect: 'cantonese' } }, { task: 'VOICE_DESIGN', controls: { style: 'calm' } }, { task: 'FREEFORM', instruction: 'calm' },
  ])('rejects disallowed input %j', change => { expect(() => parseInput('ming-tts', { ...input, ...change })).toThrow(); });
  test('default task, exact UTF-8 transcript limit and newline/tab are accepted', () => {
    const value = parseInput('ming-tts', { ...input, task: undefined, transcript: '😀'.repeat(2048) });
    expect(value.task).toBe('TTS'); expect(Buffer.byteLength(value.transcript)).toBe(8192);
    expect(parseInput('ming-tts', { ...input, transcript: 'hello\n\tworld' }).transcript).toBe('hello\n\tworld');
  });
  test.each(['ja', 'ko', 'de', 'fr', 'es'])('multilingual supports %s without controls', language => {
    expect(parseInput('ming-tts', { ...input, task: 'MULTILINGUAL', language }).language).toBe(language);
  });
  test.each(Object.entries(CONTROLS).flatMap(([key, values]) => values.map(value => [key, value])))('accepts translated %s enum %s', (key, value) => {
    const task = ['speed', 'pitch', 'volume'].includes(key) ? 'BASIC' : key === 'emotion' ? 'EMOTION' : 'DIALECT';
    expect(parseInput('ming-tts', { ...input, task, controls: { [key]: value } }).controls).toEqual({ [key]: value });
  });
  test.each(['codec', 'bits', 'channels', 'rateLow', 'rateHigh', 'short', 'long', 'empty', 'length', 'chunk', 'align', 'byteRate', 'trailing', 'duplicateData', 'duplicateFmt'])('rejects malformed reference %s', kind => {
    let bytes = wav();
    if (kind === 'codec') bytes.writeUInt16LE(3, 20); if (kind === 'bits') bytes.writeUInt16LE(24, 34); if (kind === 'channels') bytes = wav(16000, 1, 3);
    if (kind === 'rateLow') bytes = wav(8000); if (kind === 'rateHigh') bytes = wav(96000); if (kind === 'short') bytes = wav(16000, 0.999);
    if (kind === 'long') bytes = wav(16000, 30.01); if (kind === 'empty') bytes = wav(16000, 0); if (kind === 'length') bytes.writeUInt32LE(1, 4);
    if (kind === 'chunk') bytes.writeUInt32LE(0xffffffff, 40); if (kind === 'align') bytes.writeUInt16LE(4, 32); if (kind === 'byteRate') bytes.writeUInt32LE(1, 28);
    if (['trailing', 'duplicateData', 'duplicateFmt'].includes(kind)) {
      bytes = Buffer.concat([bytes, kind === 'trailing' ? Buffer.from([1]) : kind === 'duplicateData' ? bytes.subarray(36) : bytes.subarray(12, 36)]);
      bytes.writeUInt32LE(bytes.length - 8, 4);
    }
    expect(() => validateWav(bytes, { reference: true })).toThrow();
  });
});


test('WAV validates exact magic bytes and handles a bounded ancillary chunk at the file size limit', () => {
  const bad = wav(); bad[0] |= 0x80;
  expect(() => validateWav(bad, { reference: true })).toThrow();
  const audio = wav(48000, 30, 2), chunk = Buffer.alloc(6291456 - audio.length);
  chunk.write('JUNK'); chunk.writeUInt32LE(chunk.length - 8, 4);
  const bytes = Buffer.concat([audio, chunk]); bytes.writeUInt32LE(bytes.length - 8, 4);
  expect(validateWav(bytes, { reference: true })).toMatchObject({ sampleRate: 48000, channels: 2, durationSeconds: 30 });
  expect(() => validateWav(Buffer.concat([bytes, Buffer.from([0])]), { reference: true })).toThrow();
});
