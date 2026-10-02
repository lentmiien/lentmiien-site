jest.mock('../../controllers/ocrcontroller', () => Object.fromEntries(['renderTool', 'listJobs', 'renderJobPage', 'getJobDetails', 'enqueueJob', 'embedFileHighQuality', 'updateFileResult', 'deleteJob', 'servePreview'].map(key => [key, jest.fn((req, res) => res.json({ ok: true }))])));
jest.mock('../../database', () => ({ RoleModel: { findOne: jest.fn().mockResolvedValue(null) } }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const router = require('../../routes/ocr');
const controller = require('../../controllers/ocrcontroller');
const { RoleModel } = require('../../database');
let server, base;
const csrfToken = 'A'.repeat(43);
beforeAll(async () => {
  const app = express();
  app.use((req, res, next) => {
    const role = req.get('x-test-role');
    req.user = role ? { _id: 'a'.repeat(24), name: 'tester', type_user: role } : null;
    req.session = { csrfToken };
    // Avoid the application's view engine in this isolated router test.
    res.render = () => res.json({ denied: true });
    next();
  });
  app.use('/ocr', router);
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));
async function submit(role = 'admin', extras = {}, model = 'teleocr') {
  const body = new FormData(); body.set('model', model);
  return fetch(`${base}/ocr/jobs`, { method: 'POST', headers: { ...(role ? { 'x-test-role': role } : {}), accept: 'application/json', ...extras }, body });
}
test('anonymous submission denied', async () => {
  expect((await submit(null)).status).toBe(401);
  expect(controller.enqueueJob).not.toHaveBeenCalled();
});
test('missing CSRF and foreign origin are rejected before handler', async () => {
  expect((await submit()).status).toBe(403);
  expect((await submit('admin', { 'x-csrf-token': csrfToken, origin: 'https://foreign.invalid' })).status).toBe(403);
  expect(controller.enqueueJob).not.toHaveBeenCalled();
});
test.each(['family', 'user'])('%s needs semantic model-testing grant', async role => {
  expect((await submit(role, { 'x-csrf-token': csrfToken })).status).toBe(403);
  expect(controller.enqueueJob).not.toHaveBeenCalled();
});
test('admin success and explicit user grants pass shared controls', async () => {
  expect((await submit('admin', { 'x-csrf-token': csrfToken })).status).toBe(200);
  RoleModel.findOne.mockResolvedValue({ permissions: ['ocr.jobs.test_models'] });
  expect((await submit('user', { 'x-csrf-token': csrfToken })).status).toBe(200);
  RoleModel.findOne.mockResolvedValue(null);
  expect(controller.enqueueJob).toHaveBeenCalledTimes(2);
});
test('private previews need capability and responses are not cached', async () => {
  const denied = await fetch(`${base}/ocr/jobs/test/files/test/preview`, { headers: { 'x-test-role': 'user' } });
  expect(denied.status).toBe(403);
  expect(controller.servePreview).not.toHaveBeenCalled();
  const allowed = await fetch(`${base}/ocr/jobs/test/files/test/preview`, { headers: { 'x-test-role': 'admin' } });
  expect(allowed.status).toBe(200);
  expect(allowed.headers.get('cache-control')).toContain('private, no-store');
});
test('default Hunyuan use retains existing page permission without testing capability', async () => {
  expect((await submit('user', { 'x-csrf-token': csrfToken }, 'hunyuanocr')).status).toBe(200);
});
