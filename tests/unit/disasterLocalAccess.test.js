jest.mock('../../database', () => ({ DisasterAlert: {}, DisasterWeatherObservation: {} }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../models/disaster_local_summary', () => ({ find: jest.fn() }));
jest.mock('../../services/disasterIngestionService', () => ({ running: false, weatherRunning: false, runOnce: jest.fn(async () => ({})), runWeatherOnce: jest.fn(async () => ({})) }));
const express = require('express');
const fs = require('fs');
const { disasterAccess, disasterCsrf } = require('../../middleware/disasterAccess');
const controller = require('../../controllers/disasterAdminController');
const { buildSummary, key } = require('../../services/disasterLocalSummaryService');
const ingestion = require('../../services/disasterIngestionService');
const summaryModel = require('../../models/disaster_local_summary');
const { READ } = require('../../utils/disasterPolicy');
let server, base, user, authenticated, grants;
const token = 'a'.repeat(43);
beforeEach(async () => {
  user = { _id: '111111111111111111111111', name: 'synthetic', type_user: 'admin' }; authenticated = true; grants = [];
  const chain = { select: () => chain, limit: () => chain, maxTimeMS: () => chain, lean: () => chain, exec: async () => [] };
  summaryModel.find.mockReturnValue(chain);
  const app = express(); app.set('view engine', 'pug'); app.set('views', 'views'); app.use(express.urlencoded({ extended: false, limit: '2kb' }));
  app.use((req, res, next) => { req.user = user; req.isAuthenticated = () => authenticated; req.session = { csrfToken: token }; res.locals.bookmarks = []; res.locals.htmlPaths = []; next(); });
  const roles = { findOne: async q => q.type === 'user' ? { permissions: grants } : null };
  app.use('/disasters', disasterAccess('read', roles), disasterCsrf.issueToken);
  app.get('/disasters', controller.dashboard);
  app.get('/disasters/api/summary', controller.summary);
  app.post('/disasters/refresh', disasterAccess('refresh', roles), disasterCsrf.requireToken, controller.refresh);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => { await new Promise(resolve => server.close(resolve)); });
const post = (headers = {}, body = `_csrf=${token}`) => fetch(`${base}/disasters/refresh`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body });
test('anonymous and missing capabilities denied before summary access', async () => {
  authenticated = false; expect((await fetch(`${base}/disasters/api/summary`)).status).toBe(401);
  authenticated = true;
  for (const role of ['family', 'user', 'unknown']) { user.type_user = role; expect((await fetch(`${base}/disasters/api/summary`)).status).toBe(403); }
  expect(summaryModel.find).not.toHaveBeenCalled();
});
test('read grant allows fixed admin-managed scope without granting refresh authority', async () => {
  user.type_user = 'user'; grants = [READ];
  expect((await fetch(`${base}/disasters/api/summary`)).status).toBe(200);
  expect((await post()).status).toBe(403); expect(ingestion.runOnce).not.toHaveBeenCalled();
});
test('admin page and API are private, bounded reads with no ingestion, analytics or coordinates', async () => {
  const page = await fetch(`${base}/disasters`); const html = await page.text();
  expect(page.status).toBe(200); expect(page.headers.get('cache-control')).toContain('private, no-store');
  expect(html).toContain('Your neighbourhood, now.'); expect(html).toContain('disaster_local.js');
  expect(html).not.toMatch(/latitude|longitude|googletagmanager/);
  expect((await fetch(`${base}/disasters/api/summary`)).status).toBe(200);
  expect((await fetch(`${base}/disasters/refresh`)).status).toBe(404);
  expect(ingestion.runOnce).not.toHaveBeenCalled(); expect(ingestion.runWeatherOnce).not.toHaveBeenCalled();
});
test.each(['?area=1410012', '?latitude=0', '?userId=foreign'])('summary rejects selectors %s', async query => {
  expect((await fetch(`${base}/disasters/api/summary${query}`)).status).toBe(400); expect(summaryModel.find).not.toHaveBeenCalled();
});
test('CSRF missing, mismatched and foreign origin denied; valid refresh returns accepted', async () => {
  expect((await post({}, '')).status).toBe(403);
  expect((await post({}, '_csrf=wrong')).status).toBe(403);
  expect((await post({ Origin: 'https://foreign.invalid' })).status).toBe(403);
  expect(ingestion.runOnce).not.toHaveBeenCalled();
  expect((await post({ Origin: base })).status).toBe(202);
  expect(ingestion.runOnce).toHaveBeenCalledWith({ reason: 'manual' }); expect(ingestion.runWeatherOnce).toHaveBeenCalledTimes(1);
});
test('refresh rejects untrusted fields and concurrent work', async () => {
  expect((await post({}, `_csrf=${token}&location=foreign`)).status).toBe(400);
  ingestion.running = true; expect((await post()).status).toBe(409); ingestion.running = false;
  expect(ingestion.runOnce).not.toHaveBeenCalled();
});
test('escaped Pug and decorative art do not execute provider text', () => {
  const now = new Date();
  const summary = buildSummary([{ _id: key('weather'), data: { observedAt: now, temperatureC: 21, source: 'openweathermap-current', description: '<img src=x onerror=alert(1)>', weatherCode: '500' } }], now);
  const html = require('pug').renderFile('views/admin_disaster_dashboard.pug', { summary, formatDateTimeLong: () => 'synthetic time', csrfToken: token, bookmarks: [], htmlPaths: [], feedback: null });
  expect(html).toContain('&lt;img'); expect(html).not.toContain('<img src="x"');
  expect(html).toContain('alt=""'); expect(html).toContain('name="_csrf"');
});
test('real route wiring retains read capability and refresh CSRF/rate limit', () => {
  const routes = fs.readFileSync('routes/admin.js', 'utf8');
  expect(routes).toContain("router.use('/disasters', disasterAccess('read'), disasterCsrf.issueToken)");
  expect(routes).toContain("disasterAccess('refresh'), disasterRefreshLimit, disasterCsrf.requireToken, disasterAdminController.refresh");
});
