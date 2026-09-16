jest.mock('../../database', () => ({ MusicGeneration: { find: jest.fn(), exists: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn(), findOneAndUpdate: jest.fn(), deleteOne: jest.fn() }, RoleModel: { findOne: jest.fn() } }));
jest.mock('../../utils/OpenAI_API', () => ({ generateStructuredOutput: jest.fn() }));
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
jest.mock('axios');
const express = require('express');
const axios = require('axios');
const { MusicGeneration, RoleModel } = require('../../database');
const { generateStructuredOutput } = require('../../utils/OpenAI_API');
const router = require('../../routes/music');
const controller = require('../../controllers/musiccontroller');
const { requireMusic, CAPABILITIES, csrf } = require('../../middleware/musicAccess');
const { parseLosslessJson } = require('../../utils/losslessJson');
const fs = require('fs');
const raw = parseLosslessJson(fs.readFileSync('tests/fixtures/music/models.json', 'utf8'));
const yueId = 'yue2:' + 'a'.repeat(32);
const path = yueId + '/audio.flac';
let server, base, activeCatalog, principalSequence = 100;
const token = 'A'.repeat(43);
const principals = { one: { _id: '1'.repeat(24), name: 'one', type_user: 'user' }, two: { _id: '2'.repeat(24), name: 'two', type_user: 'family' }, denied: { _id: '3'.repeat(24), name: 'denied', type_user: 'user' }, admin: { _id: '4'.repeat(24), name: 'admin', type_user: 'admin' } };
beforeAll(async () => {
  const app = express();
  app.use((req, res, next) => { req.user = principals[req.get('x-test-user')]; req.isAuthenticated = () => Boolean(req.user); req.session = { csrfToken: token }; next(); });
  app.use('/music', router);
  app.use('/admin/music-test', requireMusic(CAPABILITIES.admin), (req, res, next) => { req.musicAdmin = true; next(); }, csrf.issueToken);
  app.post('/admin/music-test/generate', express.json({ limit: '32kb' }), csrf.requireToken, controller.music_generate);
  app.post('/admin/music-test/generate-ai', express.json({ limit: '32kb' }), csrf.requireToken, controller.music_generate_ai);
  app.post('/admin/music-test', express.json({ limit: '32kb' }), csrf.requireToken, controller.music_generate);
  app.get('/admin/music-test/status/:id', controller.music_status);
  server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); }); base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
beforeEach(() => {
  activeCatalog = raw;
  // Isolate the real rate limiter and in-memory job ownership across cases.
  principals.one._id = String(++principalSequence).padStart(24, '0');
  principals.admin._id = String(++principalSequence).padStart(24, '0');
  RoleModel.findOne.mockImplementation(async query => query.type === 'user' && ['one', 'two'].includes(query.name) ? { permissions: ['music'] } : { permissions: [] });
  MusicGeneration.countDocuments.mockResolvedValue(0); MusicGeneration.exists.mockResolvedValue(null); MusicGeneration.aggregate.mockResolvedValue([]);
  MusicGeneration.find.mockReturnValue({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) });
  axios.get.mockImplementation(async (url, options) => {
    if (url.endsWith('/music/models')) return { data: activeCatalog };
    return { data: { ok: true, items: [{ path, name: 'audio.flac', size_bytes: 200, modified_ts: 1000 }], pages: 1 } };
  });
});
const request = (path, { user = 'one', body, headers = {}, method = body ? 'POST' : 'GET' } = {}) => fetch(base + path, { method, headers: { 'x-test-user': user, accept: 'application/json', 'content-type': 'application/json', 'x-csrf-token': token, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
const yue = extra => ({ model: 'yue2-3b', caption: 'Folk', lyrics: '[Verse]\nA paper boat', ...extra });
const settleJob = async (id, user = 'one', prefix = '/music') => {
  for (let i = 0; i < 20; i++) {
    const result = await (await request(`${prefix}/status/${id}`, { user })).json();
    if (['completed', 'failed'].includes(result.status)) return result;
    await new Promise(resolve => setImmediate(resolve));
  }
  throw new Error('Mock job did not settle');
};
test.each(['', 'denied'])('anonymous/missing capability %s cannot read or generate', async user => {
  const read = await request('/music/library', { user }); expect(read.status).toBe(user ? 403 : 401);
  const write = await request('/music/generate', { user, body: yue() }); expect(write.status).toBe(user ? 403 : 401);
  expect(axios.post).not.toHaveBeenCalled();
});
test.each([{ 'x-csrf-token': '' }, { 'x-csrf-token': 'B'.repeat(43) }, { origin: 'https://hostile.invalid' }])('CSRF rejects forged generation and library mutations %p', async headers => {
  for (const path of ['/music/generate', '/music/library/' + 'a'.repeat(24) + '/rating', '/admin/music-test/generate']) {
    const response = await request(path, { user: path.startsWith('/admin') ? 'admin' : 'one', headers, body: yue() }); expect(response.status).toBe(403);
  }
  expect(axios.post).not.toHaveBeenCalled(); expect(MusicGeneration.findOneAndUpdate).not.toHaveBeenCalled();
});
test('GET cannot submit work and regular music member cannot enter admin scope', async () => {
  expect((await request('/music/generate')).status).toBe(404);
  expect((await request('/admin/music-test/status/foreign')).status).toBe(403);
});
test('shared library read/play authorization retains authorized family access', async () => {
  expect((await request('/music/library', { user: 'two' })).status).toBe(200);
  expect((await request('/music/output?path=' + encodeURIComponent(path))).status).toBe(404);
  expect(MusicGeneration.exists).toHaveBeenCalledWith({ outputPath: path });
  expect(axios.request).not.toHaveBeenCalled();
});
test('negative settings and oversized direction are rejected without generation', async () => {
  const response = await request('/music/generate-ai', { body: yue({ direction: 'x'.repeat(2001) }) }); expect(response.status).toBe(422);
  expect(generateStructuredOutput).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
});
test('AI uses selected YuE2 settings, persists exact nested seed and exposes provenance through shared tracks', async () => {
  generateStructuredOutput.mockResolvedValue({ caption: 'A new folk song', lyrics: '[Verse]\nThe boat comes home', model: 'ACE injection', instrumental: true });
  const result = parseLosslessJson(`{"ok":true,"job_id":"${yueId}","model":"yue2-3b","model_id":"yue2-3b","seed":9223372036854775807,"resolved_settings":{"seed":9223372036854775807,"config":{"seeds":[9223372036854775807]},"audio_format":"wav","max_duration":12},"provenance":{"source_revision":"pin","models":[{"revision":"weights"}]},"audio_seconds":11.9,"truncated":false,"duration_cropped":true,"outputs":[{"path":"${path}"}]}`);
  axios.post.mockResolvedValue({ status: 200, data: result });
  MusicGeneration.findOneAndUpdate.mockImplementation(async (_query, update) => ({ _id: 'a'.repeat(24), ...update.$setOnInsert }));
  const response = await request('/music/generate-ai', { body: yue({ seed: '0', cot: 'melody', max_duration: '12', audio_format: 'wav', background: true }) });
  expect(response.status).toBe(202); const data = await response.json();
  expect((await request(`/music/status/${data.job.id}`, { user: 'two' })).status).toBe(404);
  const done = await settleJob(data.job.id);
  expect(done.status).toBe('completed');
  expect(axios.post.mock.calls[0][1]).toMatchObject({ model: 'yue2-3b', seed: 0, cot: 'melody', max_duration: 12, audio_format: 'wav', lyrics: '[Verse]\nThe boat comes home' });
  expect(axios.post.mock.calls[0][1]).not.toHaveProperty('instrumental');
  expect(done.saved[0]).toMatchObject({ seed: '9223372036854775807', modelId: 'yue2-3b', provider: 'yue2', audioFormat: 'wav', audioSeconds: 11.9, durationCropped: true });
  expect(done.saved[0].resolvedSettings.config.seeds[0]).toBe('9223372036854775807');
  const aiOptions = generateStructuredOutput.mock.calls[0][0];
  expect(aiOptions.privateRequest).toBe(true); expect(aiOptions.schema.properties.lyrics.minLength).toBe(1); expect(aiOptions.prompt).toContain('yue2-3b');
});
test('admin generation uses the same validation and dispatcher, with admin job inspection', async () => {
  axios.post.mockResolvedValue({ status: 200, data: { ok: true, model: 'yue2-3b', model_id: 'yue2-3b', job_id: yueId, outputs: [{ path }] } });
  MusicGeneration.findOneAndUpdate.mockImplementation(async (_query, update) => ({ _id: 'a'.repeat(24), ...update.$setOnInsert }));
  const response = await request('/admin/music-test/generate', { user: 'admin', body: yue({ seed: 0 }) }); expect(response.status).toBe(202);
  const data = await response.json();
  const done = await settleJob(data.job.id, 'admin', '/admin/music-test'); expect(done.status).toBe('completed');
  expect(axios.post.mock.calls[0][1].model).toBe('yue2-3b');
});

test.each([null, true, [], {}, '', '  ', '3x', 1.5])('invalid shared rating %p cannot delete or mutate a record', async rating => {
  const response = await request('/music/library/' + 'a'.repeat(24) + '/rating', { body: { rating } });
  expect(response.status).toBe(400);
  expect(MusicGeneration.deleteOne).not.toHaveBeenCalled();
  expect(MusicGeneration.findOneAndUpdate).not.toHaveBeenCalled();
});

describe.each([['models.json', 300, 300, 3630], ['models-legacy.json', 30, 20, 1830]])('%s route contract', (file, max, defaultDuration, execution) => {
  beforeEach(() => {
    activeCatalog = parseLosslessJson(fs.readFileSync(`tests/fixtures/music/${file}`, 'utf8'));
    generateStructuredOutput.mockResolvedValue({ caption: 'Folk song', lyrics: '[Verse]\nA boat sails home', max_duration: 8, model: 'untrusted-model' });
    axios.post.mockResolvedValue({ status: 200, data: { ok: true, model: 'yue2-3b', model_id: 'yue2-3b', job_id: yueId, audio_seconds: 11.9, outputs: [{ path }] } });
    MusicGeneration.findOneAndUpdate.mockImplementation(async (_query, update) => ({ _id: 'a'.repeat(24), ...update.$setOnInsert }));
  });
  describe.each([
    ['/music/generate', false], ['/music/generate-ai', false], ['/music/generate-ai', true],
    ['/admin/music-test/generate', false], ['/admin/music-test/generate-ai', false], ['/admin/music-test/generate-ai', true], ['/admin/music-test', false],
  ])('%s background=%s', (route, background) => {
    test.each([false, true])('ACE remains usable with explicit controls=%s', async explicit => {
      const admin = route.startsWith('/admin'); const ai = route.endsWith('generate-ai');
      const user = admin ? 'admin' : 'one'; const prefix = admin ? '/admin/music-test' : '/music';
      const ace = 'ace-step-1.5-xl-turbo'; const acePath = 'ace-job/audio.flac';
      const get = axios.get.getMockImplementation();
      axios.get.mockImplementation(async (url, options) => url.endsWith('/music/models') ? get(url, options) : { data: { items: [{ path: acePath }], pages: 1 } });
      axios.post.mockResolvedValue({ status: 200, data: { ok: true, model: ace, model_id: ace, job_id: 'ace-job', outputs: [{ path: acePath }] } });
      const controls = explicit ? { model: ace, seed: 0, duration: 120, inference_steps: 16, guidance_scale: 0, batch_size: 2, bpm: 90, instrumental: true, vocal_language: 'ja', load_llm: true, llm_backend: 'pt', audio_format: 'wav', timeout_sec: 1800 } : {};
      const response = await request(route, { user, body: { caption: 'Folk', background, ...controls } });
      expect(response.status).toBe(202);
      const { job } = await response.json(); expect((await settleJob(job.id, user, prefix)).status).toBe('completed');
      const [, payload, options] = axios.post.mock.calls[0];
      expect(payload).toMatchObject(explicit ? { model: ace, seed: 0, duration: 120, inference_steps: 16, guidance_scale: 0, batch_size: 2, bpm: 90, instrumental: true, vocal_language: 'ja', thinking: true, load: { load_llm: true, llm_backend: 'pt' }, audio_format: 'wav', timeout_sec: 1800 } : { model: ace, duration: -1, inference_steps: 8, guidance_scale: 7, batch_size: 1, instrumental: false, thinking: false, vocal_language: 'unknown', audio_format: 'flac', timeout_sec: 7200 });
      expect(payload).not.toHaveProperty('max_duration');
      expect(options.timeout).toBe(((explicit ? 1800 : 7200) + 900 + 900 + 600 + 60) * 1000);
      if (ai) expect(generateStructuredOutput.mock.calls[0][0].prompt).not.toContain('selected maximum song length');
    });
    test.each([undefined, 12, 31, 300, 301])('validated ceiling %s reaches shared job/AI/persistence flow', async ceiling => {
      const admin = route.startsWith('/admin'); const ai = route.endsWith('generate-ai');
      const user = admin ? 'admin' : 'one'; const prefix = admin ? '/admin/music-test' : '/music';
      // Exercise the public alias on every route; the Gateway gets the canonical setting.
      const response = await request(route, { user, body: yue({ ...(ceiling === undefined ? {} : { max_duration_seconds: String(ceiling) }), background, seed: 0 }) });
      if (ceiling > max) {
        expect(response.status).toBe(422); expect(axios.post).not.toHaveBeenCalled(); expect(generateStructuredOutput).not.toHaveBeenCalled(); return;
      }
      expect(response.status).toBe(202);
      const { job } = await response.json(); const done = await settleJob(job.id, user, prefix);
      expect(done.status).toBe('completed');
      expect(done.settings).toMatchObject({ max_duration: ceiling ?? defaultDuration, timeout_sec: execution });
      const [, payload, options] = axios.post.mock.calls[0];
      expect(payload).toMatchObject({ model: 'yue2-3b', max_duration: ceiling ?? defaultDuration, seed: 0, timeout_sec: execution });
      expect(payload).not.toHaveProperty('max_duration_seconds');
      expect(options.timeout).toBe((execution + 900 + 900 + 600 + 60) * 1000);
      expect(done.saved).toHaveLength(1); expect(done.saved[0].audioSeconds).toBe(11.9);
      if (ai) {
        const options = generateStructuredOutput.mock.calls[0][0];
        expect(options.prompt).toContain(`selected maximum song length is ${ceiling ?? defaultDuration} seconds`);
        expect(options.prompt).toContain('full song sections'); expect(options.prompt).toContain('natural completion may be earlier');
        expect(options.prompt).not.toContain('8–30');
        expect(Object.keys(options.schema.properties)).toEqual(['caption', 'lyrics']);
      } else expect(generateStructuredOutput).not.toHaveBeenCalled();
    });
  });
  test.each(['future', 'disabled', 'malformed'])('rejects %s discovery/selection before AI or generation', async kind => {
    if (kind === 'disabled') activeCatalog.models[1].enabled = false;
    if (kind === 'malformed') activeCatalog.models[1].limits.max_duration = [8, 301];
    const response = await request('/music/generate-ai', { body: yue(kind === 'future' ? { model: 'future' } : {}) });
    expect(response.status).toBe(kind === 'future' ? 422 : kind === 'disabled' ? 503 : 502);
    expect(generateStructuredOutput).not.toHaveBeenCalled(); expect(axios.post).not.toHaveBeenCalled();
  });
});
