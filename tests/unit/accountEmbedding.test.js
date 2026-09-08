jest.mock('../../models/role', () => ({ findOne: jest.fn() }));
jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
jest.mock('../../services/accountEmbeddingAdapter', () => ({ createAccountEmbeddingAdapter: jest.fn() }));
const express = require('express');
const Role = require('../../models/role');
const { createAccountEmbeddingAdapter } = require('../../services/accountEmbeddingAdapter');
const router = require('../../routes/accountEmbedding');
let user; let base; let server; const owner = '111111111111111111111111'; const token = 'a'.repeat(43);
beforeEach(async () => {
  process.env.DASHBOARD_PERSONAL_OWNER_USER_ID = owner;
  user = { _id: owner, type_user: 'admin', name: 'owner' };
  Role.findOne.mockResolvedValue({ permissions: ['embedding'] });
  createAccountEmbeddingAdapter.mockReturnValue({ similaritySearch: jest.fn(async () => ({ results: [], apiBase: 'private' })) });
  const app = express(); app.use(express.urlencoded({ extended: false, limit: '8kb' }));
  app.use((req, res, next) => { req.user = user; req.isAuthenticated = () => !!user; req.session = { csrfToken: token }; res.render = (_view, locals) => res.json(locals); next(); });
  app.use('/mypage/embedding-search', router);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); }); base = `http://127.0.0.1:${server.address().port}/mypage/embedding-search`;
});
afterEach(async () => { delete process.env.DASHBOARD_PERSONAL_OWNER_USER_ID; await new Promise(resolve => server.close(resolve)); });
const search = (fields = {}, headers = {}) => fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', ...headers }, body: new URLSearchParams({ search_text: 'synthetic', _csrf: token, ...fields }) });
test('GET never searches even with query text', async () => { expect((await fetch(base + '?search_text=private')).status).toBe(200); expect(createAccountEmbeddingAdapter).not.toHaveBeenCalled(); });
test('another admin and missing existing permission fail before provider/DB search', async () => {
  user._id = '222222222222222222222222'; expect((await search()).status).toBe(403);
  user._id = owner; Role.findOne.mockResolvedValue(null); expect((await search()).status).toBe(403);
  expect(createAccountEmbeddingAdapter).not.toHaveBeenCalled();
});
test('forgery and invalid payloads fail before search', async () => {
  expect((await search({ _csrf: '' })).status).toBe(403);
  expect((await search({}, { Origin: 'https://foreign.invalid' })).status).toBe(403);
  expect((await search({ search_text: 'x'.repeat(2001) })).status).toBe(400);
  expect((await search({ owner: 'foreign' })).status).toBe(400);
  expect(createAccountEmbeddingAdapter).not.toHaveBeenCalled();
});
test('successful search excludes provider endpoint from rendering', async () => {
  const response = await search(); expect(response.status).toBe(200); expect(await response.text()).not.toContain('private');
});
