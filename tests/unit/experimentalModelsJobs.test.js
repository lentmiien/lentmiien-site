const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { randomUUID } = require('crypto');
const sharp = require('sharp');
const express = require('express');
const sessionMiddleware = require('express-session');
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
const logger = require('../../utils/logger');
const { LabStore } = require('../../services/experimentalModels/storage');
const { LabJobs } = require('../../services/experimentalModels/jobs');
const { LabError, LIMITS } = require('../../services/experimentalModels/policy');
const { createRouter } = require('../../routes/experimentalModels');
const owner = 'a'.repeat(24), other = 'b'.repeat(24);
const body = { task: 'VOICE_DESIGN', text: 'Synthetic speech', language: 'en', controls: { style: 'Calm' } };
const result = () => ({ bytes: Buffer.from('mocked binary output; WAV validation is tested at the Gateway boundary'), mime: 'audio/wav',
  headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store', 'X-Generation-Complete': 'true' }, status: 200,
  metadata: { channels: 1, sampleRate: 44100, bitsPerSample: 16, durationSeconds: 1 } });
let root, store, jobs, gateway, binding, releases;
const flush = () => new Promise(resolve => setTimeout(resolve, 5));
async function until(predicate) { for (let i = 0; i < 500; i += 1) { if (predicate()) return; await flush(); } throw new Error('Test state did not settle'); }
async function idle() { await until(() => !store.busy); }
async function finish() { while (jobs.running) await jobs.draining; }
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'experimental-jobs-')); binding = randomUUID(); releases = [];
  store = new LabStore({ root });
  gateway = { config: jest.fn(), sanitize: value => value, capabilities: jest.fn(async () => ({ available: true })),
    run: jest.fn(() => new Promise(resolve => releases.push(resolve))) };
  jobs = new LabJobs({ store, gateway });
});
afterEach(async () => {
  gateway.run.mockImplementation(async () => result());
  await until(() => { releases.forEach(release => release(result())); return !jobs.running; });
  await finish(); await fs.rm(root, { recursive: true, force: true });
});
const submit = (s, options = {}) => jobs.submit(options.owner || owner, binding, s.id, 'ming-tts', body, options.authorize || (async () => true));

test('one forwarded experiment globally; queue reserves quota and stores complete output', async () => {
  const a = await store.create(owner, binding), b = await store.create(other, binding);
  const first = await submit(a); await until(() => gateway.run.mock.calls.length === 1); await idle();
  expect((await store.get(owner, binding, a.id)).bytes).toBeGreaterThan(6291456);
  const second = await submit(b, { owner: other }); await idle();
  expect((await store.job(other, binding, b.id, second.id)).state).toBe('queued');
  expect(gateway.run).toHaveBeenCalledTimes(1);
  releases[0](result()); await until(() => gateway.run.mock.calls.length === 2); await idle();
  const completed = await store.job(owner, binding, a.id, first.id);
  expect(completed).toMatchObject({ state: 'succeeded', status: 200, reservedBytes: 0, audio: { sampleRate: 44100 } });
  const download = await store.download(owner, binding, a.id, completed.resultId);
  expect(await download.handle.readFile()).toEqual(result().bytes); await download.handle.close();
  releases[1](result()); await finish();
  const recovered = new LabStore({ root });
  expect((await recovered.get(owner, binding, a.id)).jobs[0]).toMatchObject({ state: 'succeeded', resultId: completed.resultId });
});

test.each(['clear', 'ttl'])('%s waits for active request, stops admission, purges only when quiescent', async kind => {
  let now = 1000; store.now = () => now;
  const s = await store.create(owner, binding), job = await submit(s);
  await until(() => gateway.run.mock.calls.length === 1); await idle();
  if (kind === 'clear') {
    expect(await store.clear(owner, binding, s.id)).toEqual({ deleted: false, deletePending: true });
    expect((await store.get(owner, binding, s.id)).deletePending).toBe(true);
  } else {
    now = s.expiresAt; await store.sweep();
    await expect(store.get(owner, binding, s.id)).rejects.toMatchObject({ status: 404 });
  }
  await expect(submit(s)).rejects.toMatchObject({ status: 404 });
  expect(await fs.readdir(root)).toEqual([s.id]);
  releases[0](result()); await finish();
  expect(await fs.readdir(root)).toEqual([]);
  await expect(store.job(owner, binding, s.id, job.id)).rejects.toMatchObject({ status: 404 });
});

test('clearing a locally queued session prevents forwarding', async () => {
  const a = await store.create(owner, binding), b = await store.create(other, binding);
  await submit(a); await until(() => gateway.run.mock.calls.length === 1); await idle();
  await submit(b, { owner: other }); await idle();
  expect(await store.clear(other, binding, b.id)).toEqual({ deleted: true, deletePending: false });
  expect(jobs.pending).toEqual([]);
  releases[0](result()); await finish(); expect(gateway.run).toHaveBeenCalledTimes(1);
  expect(await fs.readdir(root)).toEqual([a.id]);
});

test('fresh dispatch authorization blocks revoked admin/session; no request or output', async () => {
  const a = await store.create(owner, binding), b = await store.create(other, binding);
  await submit(a); await until(() => gateway.run.mock.calls.length === 1); await idle();
  const authorize = jest.fn(async () => false), job = await submit(b, { owner: other, authorize });
  releases[0](result()); await finish();
  expect(authorize).toHaveBeenCalledTimes(1); expect(gateway.run).toHaveBeenCalledTimes(1);
  expect(await store.job(other, binding, b.id, job.id)).toMatchObject({ state: 'failed', code: 'authorization_revoked', reservedBytes: 0 });
});

test('download leases defer explicit clear and release on stream close', async () => {
  const s = await store.create(owner, binding);
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#000' } }).png().toBuffer();
  const asset = await store.upload(owner, binding, s.id, { buffer: png, mimetype: 'image/png', originalname: 'test.png' });
  const download = await store.download(owner, binding, s.id, asset.id);
  expect(await store.clear(owner, binding, s.id)).toMatchObject({ deletePending: true });
  const stream = download.handle.createReadStream({ autoClose: true });
  await new Promise((resolve, reject) => { stream.on('error', reject); stream.on('close', resolve); stream.resume(); });
  expect(store.leases.size).toBe(0); await store.sweep(); expect(await fs.readdir(root)).toEqual([]);
});

test('restart marks forwarded jobs unknown and queued jobs cancelled without replay', async () => {
  const a = await store.create(owner, binding), b = await store.create(other, binding);
  await submit(a); await until(() => gateway.run.mock.calls.length === 1); await idle(); await submit(b, { owner: other }); await idle();
  const copy = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-restart-'));
  try {
    await fs.cp(root, copy, { recursive: true });
    const recovered = new LabStore({ root: copy });
    expect((await recovered.get(owner, binding, a.id)).jobs[0]).toMatchObject({ state: 'interrupted', reservedBytes: 0, error: expect.stringContaining('unknown') });
    expect((await recovered.get(other, binding, b.id)).jobs[0]).toMatchObject({ state: 'cancelled', reservedBytes: 0 });
    const again = new LabStore({ root: copy }); expect((await again.get(owner, binding, a.id)).jobs[0].state).toBe('interrupted');
    expect(gateway.run).toHaveBeenCalledTimes(1);
  } finally { await fs.rm(copy, { recursive: true, force: true }); }
  releases[0](result()); await until(() => releases.length === 2); releases[1](result()); await finish();
});

test.each(['sessionBytes', 'userBytes', 'globalBytes'])('reserves result quota against %s before forwarding', async limit => {
  store.limits = { ...LIMITS, [limit]: 6291455 };
  const s = await store.create(owner, binding);
  await expect(submit(s)).rejects.toMatchObject({ code: 'storage_limit' }); expect(gateway.run).not.toHaveBeenCalled();
});

test('bounds queued jobs and per-session work', async () => {
  store.limits = { ...LIMITS, pendingJobs: 1 };
  const a = await store.create(owner, binding), b = await store.create(other, binding), c = await store.create('c'.repeat(24), binding);
  await submit(a); await until(() => gateway.run.mock.calls.length === 1); await idle();
  await expect(submit(a)).rejects.toMatchObject({ code: 'session_busy' });
  await submit(b, { owner: other });
  await expect(submit(c, { owner: 'c'.repeat(24) })).rejects.toMatchObject({ code: 'queue_full' });
  await store.clear(other, binding, b.id); releases[0](result()); await finish();
});

test.each(['completion_unknown', 'gateway_error', 'untrusted'])('failed %s stores no partial artifact and logs no private exception', async code => {
  const s = await store.create(owner, binding);
  gateway.run.mockRejectedValueOnce(code === 'untrusted' ? new Error('/private/path token=secret private prompt') : new LabError(code, 504, 'Safe failure.'));
  const job = await submit(s); await finish();
  const state = await store.job(owner, binding, s.id, job.id);
  expect(state.state).toBe(code === 'completion_unknown' ? 'interrupted' : 'failed');
  expect(state.resultId).toBeUndefined(); expect((await store.get(owner, binding, s.id)).assets).toEqual([]);
  expect(await fs.readdir(path.join(root, s.id))).toEqual(['session.json']);
  expect(JSON.stringify(logger.warning.mock.calls)).not.toMatch(/private.path|private prompt|token=secret/);
});

test('result close failure quarantines and purges the file instead of losing quota accounting', async () => {
  const s = await store.create(owner, binding);
  await submit(s); await until(() => releases.length === 1); await idle();
  const originalOpen = fs.open.bind(fs);
  const open = jest.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    if (String(args[0]).endsWith('.wav')) {
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); throw new Error('synthetic close failure'); };
    }
    return handle;
  });
  try { releases[0](result()); await finish(); } finally { open.mockRestore(); }
  expect(await fs.readdir(root)).toEqual([]);
});

test('preserves EXIF-oriented dimensions without logical resizing; unsupported formats fail', async () => {
  const s = await store.create(owner, binding);
  const jpeg = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#f60' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
  const asset = await store.upload(owner, binding, s.id, { buffer: jpeg, mimetype: 'image/jpeg', originalname: 'portrait.jpg' });
  expect(asset).toMatchObject({ width: 64, height: 96 });
  const download = await store.download(owner, binding, s.id, asset.id), metadata = await sharp(await download.handle.readFile()).metadata(); await download.handle.close();
  expect(metadata).toMatchObject({ width: 64, height: 96, channels: 3 }); expect(metadata.orientation).toBeUndefined();
  for (const [mimetype, originalname] of [['image/bmp', 'test.bmp'], ['image/tiff', 'test.tiff'], ['image/svg+xml', 'test.svg']]) {
    await expect(store.upload(owner, binding, s.id, { buffer: jpeg, mimetype, originalname })).rejects.toMatchObject({ code: 'invalid_file' });
  }
});

test('revocation while dispatch waits for storage prevents the only forwarding attempt', async () => {
  const s = await store.create(owner, binding);
  const kick = jest.spyOn(jobs, 'kick').mockImplementation(() => {});
  let allowed = true;
  const authorize = jest.fn(async () => allowed);
  const job = await submit(s, { authorize }); kick.mockRestore();
  let resume, entered = false;
  const active = store.exclusive(() => new Promise(resolve => { entered = true; resume = resolve; }));
  await until(() => entered); jobs.kick(); await until(() => store.waiters.length === 1);
  allowed = false; resume(); await active; await finish();
  expect(authorize).toHaveBeenCalledTimes(2); expect(gateway.run).not.toHaveBeenCalled();
  expect(await store.job(owner, binding, s.id, job.id)).toMatchObject({ state: 'failed', code: 'authorization_revoked', reservedBytes: 0 });
  expect(store.leases.size).toBe(0);
});

describe('async HTTP lifecycle', () => {
  let server, origin, sessionStore;
  beforeEach(async () => {
    const app = express(); app.set('views', path.resolve('views')); app.set('view engine', 'pug');
    sessionStore = new sessionMiddleware.MemoryStore();
    app.use(sessionMiddleware({ secret: 'synthetic-secret-for-lab-tests', store: sessionStore, resave: false, saveUninitialized: false }));
    app.use((req, res, next) => {
      req.user = { _id: req.get('x-owner') || owner, type_user: 'admin', name: 'synthetic-admin' }; req.isAuthenticated = () => true;
      Object.assign(res.locals, { loggedIn: true, admin: true, permissions: [], htmlPaths: [], bookmarks: [] }); next();
    });
    app.use('/admin/experimental-models', createRouter({ store, jobs, authorize: () => async () => true }));
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    origin = `http://127.0.0.1:${server.address().port}/admin/experimental-models`;
  });
  afterEach(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  async function browser() { const response = await fetch(origin), html = await response.text(); return { Cookie: response.headers.get('set-cookie').split(';')[0], 'X-CSRF-Token': /data-csrf="([^"]+)"/.exec(html)[1] }; }
  const call = (headers, url, method = 'GET', value) => fetch(origin + '/api' + url, { method, headers: { ...headers, ...(value ? { 'Content-Type': 'application/json' } : {}) }, body: value ? JSON.stringify(value) : undefined });
  test.each(['upload', 'finish', 'clear', 'ttl'])('same-owner GET polls settle during %s, retaining owner/browser/CSRF guards', async phase => {
    const b = await browser(), foreign = await browser();
    const s = await (await call(b, '/sessions', 'POST')).json();
    if (phase === 'finish') {
      expect((await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', body)).status).toBe(202);
      await until(() => releases.length === 1); await idle();
    }
    let entered = false, resume;
    const gate = new Promise(resolve => { resume = resolve; });
    const method = phase === 'ttl' ? 'purgeDirectory' : 'save', original = store[method].bind(store);
    jest.spyOn(store, method).mockImplementationOnce(async (...args) => { entered = true; await gate; return original(...args); });
    let operation;
    if (phase === 'upload') {
      const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#f60' } }).png().toBuffer();
      const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'synthetic.png');
      operation = fetch(origin + `/api/sessions/${s.id}/files`, { method: 'POST', headers: b, body: form });
    } else if (phase === 'finish') { releases[0](result()); operation = finish(); }
    else if (phase === 'clear') operation = call(b, `/sessions/${s.id}`, 'DELETE');
    else { store.now = () => s.expiresAt; operation = store.sweep(); }
    await until(() => entered);
    const poll = call(b, '/sessions'), otherBrowser = call(foreign, `/sessions/${s.id}`), otherOwner = call({ ...b, 'x-owner': other }, `/sessions/${s.id}`);
    await until(() => store.waiters.length === 3);
    expect((await call({ ...b, 'X-CSRF-Token': '' }, `/sessions/${s.id}`, 'DELETE')).status).toBe(403);
    resume();
    const resultResponse = await operation;
    if (phase === 'upload' || phase === 'clear') expect(resultResponse.status).toBe(phase === 'upload' ? 201 : 200);
    expect((await poll).status).toBe(200);
    expect((await otherBrowser).status).toBe(404); expect((await otherOwner).status).toBe(404);
    expect(gateway.run).toHaveBeenCalledTimes(phase === 'finish' ? 1 : 0);
    expect(store.waiters).toEqual([]); expect(store.leases.size).toBe(0);
  });
  test('queue overload returns safe Retry-After without starting a mutation', async () => {
    const b = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    let resume, entered = false;
    const active = store.exclusive(() => new Promise(resolve => { entered = true; resume = resolve; }));
    await until(() => entered); store.maxWaiters = 0;
    const response = await call(b, `/sessions/${s.id}`, 'DELETE');
    expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('1');
    expect(await response.json()).toMatchObject({ status: 429, code: 'storage_busy' });
    expect(store.sessions.get(s.id).deletePending).toBe(false);
    resume(); await active;
  });
  test('202 job/poll/download ownership, CSRF and pending deletion stay guarded after navigation', async () => {
    const b = await browser(), foreign = await browser();
    const s = await (await call(b, '/sessions', 'POST')).json();
    const url = `/sessions/${s.id}/experiments/ming-tts/runs`;
    expect((await call({ ...b, 'X-CSRF-Token': '' }, url, 'POST', body)).status).toBe(403);
    expect((await call(foreign, url, 'POST', body)).status).toBe(404);
    const response = await call(b, url, 'POST', body); expect(response.status).toBe(202); const job = await response.json();
    await until(() => gateway.run.mock.calls.length === 1); await idle();
    const poll = `/sessions/${s.id}/jobs/${job.id}`;
    expect((await call(foreign, poll)).status).toBe(404); expect((await call({ ...b, 'x-owner': other }, poll)).status).toBe(404);
    expect((await call(b, poll)).headers.get('cache-control')).toContain('no-store');
    expect((await call(b, `/sessions/${s.id}`, 'DELETE')).status).toBe(202);
    expect((await (await call(b, `/sessions/${s.id}`)).json()).deletePending).toBe(true);
    releases[0](result()); await finish(); expect((await call(b, poll)).status).toBe(404);
    expect(await fs.readdir(root)).toEqual([]);
  });
  test.each(['inspection', 'legacy'])('real router and Gateway preserve failed %s response, private ownership and cleanup', async kind => {
    const { LabGateway } = require('../../services/experimentalModels/gateway');
    const { CAPABILITY } = require('../../services/experimentalModels/wevisInspection');
    const raw = '<script>window.pwned=true</script>😀';
    const failureBody = kind === 'inspection' ? Buffer.from(JSON.stringify({ detail: { code: 'model_output_invalid', model_output_valid: false,
      diagnostics: { version: 1, stage: 'normalize', reason: 'unrecognized_output', raw_text: raw, raw_available: true, raw_length: Array.from(raw).length,
        raw_truncated: false, task: 'ocr', max_new_tokens: 1024, generated_tokens: 2, finish_reason: 'stop', eos_observed: true } } }))
      : Buffer.from(JSON.stringify({ detail: 'x'.repeat(49) }));
    if (kind === 'legacy') expect(failureBody.length).toBe(62);
    const http = { request: jest.fn(async options => ({ status: options.method === 'POST' ? 502 : 200,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      // Axios arraybuffer is raw bytes, not an object or double-encoded JSON.
      data: options.method === 'POST' ? failureBody : Buffer.from(JSON.stringify(options.url.endsWith('/capabilities')
        ? { available: true, failure_inspection: CAPABILITY } : {})) })) };
    jobs.gateway = new LabGateway({ http, env: { AI_GATEWAY_BASE_URL: 'http://synthetic.invalid' } });
    const b = await browser(), foreign = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#000' } }).png().toBuffer();
    const form = new FormData(); form.append('file', new Blob([png], { type: 'image/png' }), 'synthetic.png');
    const asset = await (await fetch(origin + `/api/sessions/${s.id}/files`, { method: 'POST', headers: b, body: form })).json();
    const submitted = await call(b, `/sessions/${s.id}/experiments/wevisone-vl/runs`, 'POST', { task: 'ocr', fileId: asset.id });
    expect(submitted.status).toBe(202);
    const job = await submitted.json(); await finish();
    const failed = await (await call(b, `/sessions/${s.id}/jobs/${job.id}`)).json();
    expect(failed).toMatchObject({ state: 'failed', status: 502 }); expect(failed.resultId).toBeUndefined();
    expect(http.request.mock.calls.filter(([o]) => o.method === 'POST')).toHaveLength(1);
    if (kind === 'inspection') {
      expect(failed).toMatchObject({ code: 'model_output_invalid', model_output_valid: false, reservedBytes: 0 });
      const url = `/sessions/${s.id}/files/${failed.inspectionId}`;
      expect((await call(foreign, url)).status).toBe(404);
      expect((await call({ ...b, 'x-owner': other }, url)).status).toBe(404);
      const response = await call(b, url); expect(response.headers.get('cache-control')).toContain('no-store');
      expect(Buffer.from(await response.arrayBuffer())).toEqual(failureBody);
      await until(() => !store.leases.size);
      const recovered = new LabStore({ root });
      const existing = [...store.sessions.values()][0];
      expect((await recovered.job(owner, existing.binding, s.id, job.id)).inspectionId).toBe(failed.inspectionId);
      expect((await store.get(owner, existing.binding, s.id)).bytes).toBeGreaterThan(failureBody.length);
    } else {
      expect(failed).toMatchObject({ code: 'gateway_error', error: 'Gateway runtime, response schema or output size failed.' });
      expect(failed.inspectionId).toBeUndefined(); expect(JSON.stringify(failed)).not.toContain('x'.repeat(49));
    }
    expect(JSON.stringify(logger.warning.mock.calls)).not.toContain(raw);
    expect((await call(b, `/sessions/${s.id}`, 'DELETE')).status).toBe(200);
    expect(await fs.readdir(root)).toEqual([]);
  });
  test('audio result download applies account and browser scope, attachment and sandbox', async () => {
    const b = await browser(), foreign = await browser(), s = await (await call(b, '/sessions', 'POST')).json();
    const job = await (await call(b, `/sessions/${s.id}/experiments/ming-tts/runs`, 'POST', body)).json();
    await until(() => releases.length === 1); releases[0](result()); await finish();
    const complete = await (await call(b, `/sessions/${s.id}/jobs/${job.id}`)).json();
    const url = `/sessions/${s.id}/files/${complete.resultId}`;
    expect((await call(foreign, url)).status).toBe(404); expect((await call({ ...b, 'x-owner': other }, url)).status).toBe(404);
    const response = await call(b, url); expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/wav'); expect(response.headers.get('content-disposition')).toContain('.wav');
    expect(response.headers.get('content-security-policy')).toContain('sandbox'); expect(Buffer.from(await response.arrayBuffer())).toEqual(result().bytes);
    await until(() => !store.leases.size);
  });
});
