jest.mock('../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const express = require('express');
const { createChat5ExportRouter, CAPABILITY } = require('../../routes/chat5Export');
const { ExportError } = require('../../services/chat5ExportService');
const logger = require('../../utils/logger');
let server, base, principal, authenticated, roleModel, exportConversation;
const conversationId = '0123456789abcdef01234567';
beforeEach(async () => {
  principal = { _id: 'account-1', name: 'member', type_user: 'user' };
  authenticated = true;
  roleModel = { findOne: jest.fn(async () => ({ permissions: ['chat5'] })) };
  exportConversation = jest.fn(async () => ({ body: '{"safe":"雪"}' }));
  const app = express();
  app.use((req, res, next) => {
    req.user = principal; req.isAuthenticated = () => authenticated;
    res.render = (_view, locals) => res.json({ error: locals.message });
    next();
  });
  app.use('/chat5/chat/:id/export', createChat5ExportRouter({ roleModel, exportConversation }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}/chat5/chat/${conversationId}/export`;
});
afterEach(async () => { await new Promise(resolve => server.close(resolve)); });

test.each(['user', 'family', 'admin'])('normal %s with Chat5 access receives safe, private download', async role => {
  principal.type_user = role;
  const response = await fetch(base);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toContain('private, no-store');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  expect(response.headers.get('content-type')).toContain('application/json');
  expect(response.headers.get('content-disposition')).toBe(`attachment; filename="chat5-${conversationId}-source-v1.json"`);
  expect(await response.json()).toEqual({ safe: '雪' });
  expect(exportConversation).toHaveBeenCalledWith(conversationId, principal, { format: 'json', types: ['sent_text', 'received_text'], include_hidden: false, include_raw: false });
});

test('JSONL uses correct content type, disposition and validated options', async () => {
  const response = await fetch(base + '?format=jsonl&types=reasoning,tool&hidden=1&raw=1');
  expect(response.headers.get('content-type')).toContain('application/x-ndjson');
  expect(response.headers.get('content-disposition')).toContain('.jsonl"');
  expect(exportConversation.mock.calls[0][2]).toMatchObject({ format: 'jsonl', include_raw: true, include_hidden: true });
});

test.each(['anonymous', 'incomplete', 'no-chat5', 'missing-export', 'admin-no-chat5'])('denies %s before resolving any conversation', async mode => {
  if (mode === 'anonymous') authenticated = false;
  if (mode === 'incomplete') principal.name = '';
  if (mode.includes('no-chat5')) { roleModel.findOne.mockResolvedValue(null); principal.type_user = mode.startsWith('admin') ? 'admin' : 'user'; }
  if (mode === 'missing-export') principal.type_user = 'custom';
  const response = await fetch(base);
  expect(response.status).toBe(mode === 'anonymous' ? 401 : 403);
  expect(response.headers.get('cache-control')).toContain('no-store');
  expect(exportConversation).not.toHaveBeenCalled();
});

test('explicit per-user semantic grant enables a custom role with existing Chat5 access', async () => {
  principal.type_user = 'custom';
  roleModel.findOne.mockImplementation(async filter => filter.type === 'user' ? { permissions: ['chat5', CAPABILITY] } : null);
  expect((await fetch(base)).status).toBe(200);
  expect(roleModel.findOne).toHaveBeenCalledWith({ name: 'member', type: 'user' });
});

test.each(['?owner=other', '?format=csv', '?types=', '?types=sent_text&types=received_text', '?raw=true', '?hidden=2', '?path=/private/file'])('rejects invalid options %s before message access', async query => {
  expect((await fetch(base + query)).status).toBe(400);
  expect(exportConversation).not.toHaveBeenCalled();
});

test('membership failure, invalid/missing IDs, changed conversation and bounds produce controlled errors', async () => {
  for (const status of [400, 404, 409, 413]) {
    exportConversation.mockRejectedValueOnce(new ExportError(status, 'Safe public error.'));
    const response = await fetch(base);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: 'Safe public error.' });
    expect(response.headers.get('content-disposition')).toBeNull();
  }
});

test('database failure logs no payloads and concurrency is released for retry', async () => {
  exportConversation.mockRejectedValueOnce(new Error('PRIVATE_TEXT api-key /local/path'));
  const response = await fetch(base);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toMatch(/PRIVATE_TEXT|api-key|local/);
  expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/PRIVATE_TEXT|api-key|local/);
  expect((await fetch(base)).status).toBe(200);
});

test('authorization lookup failure stays private and never reaches the exporter', async () => {
  roleModel.findOne.mockRejectedValue(new Error('private auth error'));
  const response = await fetch(base);
  expect(response.status).toBe(503);
  expect(exportConversation).not.toHaveBeenCalled();
  expect(await response.text()).not.toContain('private auth error');
});

test('POST cannot mutate or start an export', async () => {
  expect((await fetch(base, { method: 'POST' })).status).toBe(404);
  expect(exportConversation).not.toHaveBeenCalled();
});

test('concurrent exports for the same principal are bounded', async () => {
  let release;
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  exportConversation.mockImplementationOnce(() => new Promise(resolve => { release = resolve; entered(); }));
  const first = fetch(base);
  await started;
  const second = await fetch(base);
  expect(second.status).toBe(429);
  expect(exportConversation).toHaveBeenCalledTimes(1);
  release({ body: '{}' });
  expect((await first).status).toBe(200);
});

test('per-principal request rate is bounded', async () => {
  for (let n = 0; n < 6; n++) expect((await fetch(base)).status).toBe(200);
  const response = await fetch(base);
  expect(response.status).toBe(429);
  expect(response.headers.get('retry-after')).toBeTruthy();
  expect(exportConversation).toHaveBeenCalledTimes(6);
});

test('HTTP capability checks compose with scoped database lookup; foreign admin cannot fetch child records', async () => {
  const { createExportService } = require('../../services/chat5ExportService');
  const queries = [];
  const scoped = { aggregate: jest.fn(pipeline => ({ option: async () => {
    const filter = pipeline[0].$match;
    queries.push(filter);
    return String(filter._id) === conversationId && filter.members === 'member'
      ? [{ _id: conversationId, members: ['member'], messages: [], referenceCount: 0 }] : [];
  } })) };
  const empty = { aggregate: jest.fn(() => ({ option: async () => [] })) };
  const children = { aggregate: jest.fn(() => { throw new Error('must not fetch foreign records'); }) };
  exportConversation.mockImplementation(createExportService({ conversation5: scoped, conversation4: empty, chat5: children, chat4: children }));
  principal.type_user = 'admin';
  principal.name = 'foreign';
  const foreign = await fetch(base);
  expect(foreign.status).toBe(404);
  expect(await foreign.json()).toEqual({ error: 'Conversation not found.' });
  expect(children.aggregate).not.toHaveBeenCalled();
  expect(queries[0].members).toBe('foreign');
  principal.name = 'member';
  const member = await fetch(base);
  expect(member.status).toBe(200);
  expect((await member.json()).summary.reference_count).toBe(0);
  const invalid = await fetch(base.replace(conversationId, 'not-an-id'));
  expect(invalid.status).toBe(400);
});
