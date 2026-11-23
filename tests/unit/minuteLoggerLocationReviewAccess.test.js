const express = require('express');
const router = require('../../routes/minuteLoggerLocationReview');
const controller = require('../../controllers/minuteLoggerAdminController');

jest.mock('../../controllers/minuteLoggerAdminController', () => ({
  nameIgnoredLocationGroup: jest.fn((_req, res) => res.sendStatus(204)),
  unignoreLocationGroup: jest.fn((_req, res) => res.sendStatus(204)),
  ignoredLocationGroups: jest.fn((_req, res) => res.send(res.locals.csrfToken)),
  unnamedLocationGroups: jest.fn((_req, res) => res.send(res.locals.csrfToken)),
  ignoreLocationGroup: jest.fn((_req, res) => res.sendStatus(204)),
  updateLocationGroupSettings: jest.fn((_req, res) => res.sendStatus(204)),
}));
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));

let server;
let base;
const session = {};
beforeAll(async () => {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.user = { name: 'fixture', type_user: req.get('test-role') || 'admin' };
    req.session = session;
    res.render = () => res.end();
    next();
  });
  app.use('/admin/minute-logger', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/admin/minute-logger`;
});
afterAll(() => new Promise(resolve => server.close(resolve)));

test.each(['/unnamed', '/ignored'])('%s denies access without the management capability', async path => {
  const response = await fetch(base + path, { headers: { 'test-role': 'family' } });
  expect(response.status).toBe(403);
  expect(controller.unnamedLocationGroups).not.toHaveBeenCalled();
});

test.each(['/location-groups', '/location-groups/ignore', '/location-groups/name-ignored', '/location-groups/unignore'])('%s requires the capability and session CSRF token', async path => {
  const review = await fetch(base + '/ignored');
  expect(review.headers.get('cache-control')).toContain('no-store');
  const body = new URLSearchParams({ _csrf: await review.text() });
  const url = base + path;
  expect((await fetch(url, { method: 'POST', body, headers: { 'test-role': 'user' } })).status).toBe(403);
  expect((await fetch(url, { method: 'POST' })).status).toBe(403);
  expect((await fetch(url, { method: 'POST', body })).status).toBe(204);
});
