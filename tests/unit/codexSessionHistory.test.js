jest.mock('../../models/codex_session', () => ({ aggregate: jest.fn() }));
jest.mock('../../models/codex_workspace', () => ({ find: jest.fn() }));
jest.mock('../../models/role', () => ({ findOne: jest.fn().mockResolvedValue(null) }));
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));
jest.mock('../../services/codexToolService', () => ({}));
jest.mock('../../services/codexQueueWorker', () => ({}));
const CodexSession = require('../../models/codex_session');
const CodexWorkspace = require('../../models/codex_workspace');
const Role = require('../../models/role');
const logger = require('../../utils/logger');
const { parseHistoryQuery, listSessionHistory } = require('../../services/codexSessionHistoryService');
const owner = { _id: 'owner-1', name: 'Owner', type_user: 'user' };
const chain = (value) => ({ option: jest.fn().mockReturnThis(), select: jest.fn().mockReturnThis(), maxTimeMS: jest.fn().mockReturnThis(), lean: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue(value) });

beforeEach(() => {
  jest.clearAllMocks();
  Role.findOne.mockResolvedValue(null);
  CodexSession.aggregate.mockReturnValue(chain([{ rows: [], count: [] }]));
});

test.each([
  { page: '0' }, { page: '10001' }, { page: '2oops' }, { page: '1.5' }, { page: ['1'] },
  { limit: '25' }, { limit: '-1' }, { status: 'running' }, { status: { $ne: '' } },
  { workspaceId: { $ne: '' } }, { workspaceId: 'x'.repeat(161) }, { search: 'x'.repeat(101) },
  { search: ['x'] }, { owner: 'someone-else' }, { page: 'Infinity' },
])('rejects malformed query before database access: %j', async (query) => {
  await expect(listSessionHistory(query, owner)).rejects.toMatchObject({ statusCode: 400 });
  expect(CodexSession.aggregate).not.toHaveBeenCalled();
});

test('defaults are bounded and filters are trimmed', () => {
  expect(parseHistoryQuery()).toEqual({ page: 1, limit: 12, status: 'recent', search: '', workspaceId: '' });
  expect(parseHistoryQuery({ search: ' test ', workspaceId: ' ws ' })).toMatchObject({ search: 'test', workspaceId: 'ws' });
});

test.each([null, { name: 'Missing role' }, { name: 'Unknown', type_user: 'other', _id: 'x' }, { name: 'No id', type_user: 'admin' }])('denies incomplete or unauthorized principals', async (user) => {
  await expect(listSessionHistory({}, user)).rejects.toMatchObject({ statusCode: 403 });
  expect(CodexSession.aggregate).not.toHaveBeenCalled();
});

test('queries actual older rows and counts with identical owner and literal filters', async () => {
  const aggregate = chain([{ rows: [{ _id: 'older-13', title: 'literal .*', workspaceId: 'ws', status: 'failed' }], count: [{ total: 13 }] }]);
  CodexSession.aggregate.mockReturnValue(aggregate);
  const workspaces = chain([{ _id: 'ws', name: 'Workspace' }]);
  CodexWorkspace.find.mockReturnValue(workspaces);
  const result = await listSessionHistory({ page: '2', search: '.*', status: 'failed', workspaceId: 'ws' }, owner);
  const pipeline = CodexSession.aggregate.mock.calls[0][0];
  expect(pipeline[0].$match).toEqual({ 'createdBy.id': 'owner-1', title: { $regex: '\\.\\*', $options: 'i' }, status: 'failed', workspaceId: 'ws' });
  expect(pipeline[1]).toEqual({ $sort: { updatedAt: -1, _id: -1 } });
  expect(pipeline[2].$facet.rows.slice(0, 2)).toEqual([{ $skip: 12 }, { $limit: 12 }]);
  expect(pipeline[2].$facet.count).toEqual([{ $count: 'total' }]);
  expect(aggregate.option).toHaveBeenCalledWith({ maxTimeMS: 3000 });
  expect(workspaces.maxTimeMS).toHaveBeenCalledWith(3000);
  expect(CodexWorkspace.find).toHaveBeenCalledWith({ _id: { $in: ['ws'] } });
  expect(result.sessions[0]).toMatchObject({ id: 'older-13', workspace: { name: 'Workspace' } });
  expect(result.pagination).toEqual({ page: 2, limit: 12, total: 13, pages: 2, hasNext: false });
});

test('admin scope is explicit; archived and all queries retain counts on empty pages', async () => {
  const admin = { ...owner, type_user: 'admin' };
  CodexSession.aggregate.mockReturnValue(chain([{ rows: [], count: [{ total: 3 }] }]));
  const result = await listSessionHistory({ page: '9', status: 'all' }, admin);
  expect(CodexSession.aggregate.mock.calls[0][0][0]).toEqual({ $match: {} });
  expect(result.pagination).toMatchObject({ page: 9, pages: 1, total: 3, hasNext: false });
  expect(CodexWorkspace.find).not.toHaveBeenCalled();
  await listSessionHistory({ status: 'archived' }, owner);
  expect(CodexSession.aggregate.mock.calls[1][0][0].$match).toEqual({ 'createdBy.id': 'owner-1', status: 'archived' });
});

test('uses explicit capability grants without granting an owner override', async () => {
  Role.findOne.mockResolvedValue({ permissions: ['codex.session.read'] });
  await listSessionHistory({}, { ...owner, type_user: 'other' });
  expect(CodexSession.aggregate.mock.calls[0][0][0].$match['createdBy.id']).toBe('owner-1');
});

test('route denies access before querying and sets private cache headers', async () => {
  const express = require('express');
  const app = express();
  app.set('views', 'views'); app.set('view engine', 'pug');
  app.use((req, _res, next) => { req.session = {}; next(); });
  app.use('/codex', require('../../routes/codex'));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const response = await fetch(`http://127.0.0.1:${server.address().port}/codex/api/session-history`);
    expect(response.status).toBe(403);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(CodexSession.aggregate).not.toHaveBeenCalled();
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('controller sanitizes database failures and logs no query or personal data', async () => {
  CodexSession.aggregate.mockReturnValue({ option: () => ({ exec: () => Promise.reject(new Error('private database detail')) }) });
  const res = { json: jest.fn(), status: jest.fn().mockReturnThis() };
  await require('../../controllers/codexController').listSessionHistory({ query: { search: 'private title' }, user: owner }, res);
  expect(res.status).toHaveBeenCalledWith(500);
  expect(res.json).toHaveBeenCalledWith({ ok: false, error: 'Unable to load session history.' });
  expect(logger.error).toHaveBeenCalledWith('Unable to query Codex session history', { category: 'codex_tool', metadata: { errorName: 'Error' } });
});
