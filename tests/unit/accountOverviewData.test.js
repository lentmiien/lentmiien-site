jest.mock('../../utils/logger', () => ({ warning: jest.fn() }));
const { createAccountOverviewData, overviewSections } = require('../../services/accountOverviewData');
const { resolvePolicy } = require('../../services/accountSurfacePolicy');
const logger = require('../../utils/logger');
const owner = '111111111111111111111111';
const instant = new Date('2026-10-24T15:00:00Z');
let fixtures; let calls; let data; let overview;
const policy = (role = 'admin', grants = [], id = owner) => resolvePolicy({ _id: id, type_user: role, name: 'synthetic-member' },
  { findOne: async q => q.type === 'user' ? { permissions: grants } : null }, owner);
const group = (result, id) => result.groups.find(g => g.id === id);
const facet = (rows, count = rows.length) => [{ rows, total: [{ value: count }] }];
function model(name) {
  return { aggregate(pipeline) {
    calls.push({ name, pipeline });
    return { option(options) {
      expect(options).toEqual({ maxTimeMS: 2000, allowDiskUse: false });
      return { exec: async () => {
        if (fixtures[name] instanceof Error) throw fixtures[name];
        return fixtures[name] || (name === 'my_life_log_entry' ? [] : facet([]));
      } };
    } };
  } };
}
beforeEach(() => {
  fixtures = {}; calls = [];
  data = {
    read: jest.fn(async (name, _filter, _projection, _sort, limit) => {
      if (fixtures[name] instanceof Error) throw fixtures[name];
      return (fixtures[name] || []).slice(0, limit);
    }),
    load: jest.fn(async () => ({ rows: fixtures.cooking || [] })),
  };
  overview = createAccountOverviewData({ model, data, now: () => instant });
});

test('only entitled groups appear, regardless of hidden or collapsed cards', async () => {
  const p = await policy('user', ['scheduletask', 'chat5', 'cooking']);
  p.user.dashboard_settings = { hiddenSections: ['tasks', 'chats', 'cooking'], collapsedSections: ['cooking'] };
  expect(overviewSections(p).map(s => s.id)).toEqual(['tasks', 'cooking', 'chats']);
  expect((await overview.load(p)).groups.map(g => g.id)).toEqual(['tasks', 'cooking', 'chats']);
  expect(data.load).toHaveBeenCalledWith('cooking', p);
  expect(data.read).not.toHaveBeenCalled();
});
test('missing surface capability denies before any source read', async () => {
  const p = await policy(); p.capabilities = [];
  await expect(overview.load(p)).rejects.toMatchObject({ status: 403 });
  expect(calls).toEqual([]); expect(data.read).not.toHaveBeenCalled(); expect(data.load).not.toHaveBeenCalled();
});
test.each(['user', 'family'])('%s has no personal or operations summaries merely from tool grants', async role => {
  const result = await overview.load(await policy(role, ['accounting', 'human.request.manage', 'codex.turn.read']));
  expect(result.groups).toEqual([]); expect(calls).toEqual([]); expect(data.read).not.toHaveBeenCalled();
});
test('another admin cannot query the personal stores or receive their metadata', async () => {
  const p = await policy('admin', ['accounting'], '222222222222222222222222');
  expect(overviewSections(p).map(s => s.id)).toEqual(['ask', 'codex']);
  expect((await overview.load(p)).groups.map(g => g.id)).toEqual(['ask', 'codex']);
  expect(data.read).not.toHaveBeenCalled();
  expect(calls.map(c => c.name)).toEqual(['human_tool_request', 'codex_turn']);
});
test('missing personal-owner binding denies personal summaries even to admin', async () => {
  const p = await resolvePolicy({ _id: owner, name: 'synthetic-member', type_user: 'admin' }, { findOne: async () => ({ permissions: ['accounting'] }) }, '');
  await overview.load(p);
  expect(overviewSections(p).some(s => ['life', 'accounting'].includes(s.id))).toBe(false);
  expect(data.read).not.toHaveBeenCalled();
});
test('removing a semantic capability denies that source before database work', async () => {
  const p = await policy('admin', ['accounting']);
  p.capabilities = p.capabilities.filter(c => !['finance.account.close', 'human.request.manage', 'codex.turn.read', 'dashboard.personal.read'].includes(c));
  expect((await overview.load(p)).groups).toEqual([]);
  expect(calls).toEqual([]); expect(data.read).not.toHaveBeenCalled();
});
test.each(['admin', 'user', 'family'])('tasks use an exact rolling 24-hour deadline and an arrived start for %s', async role => {
  await overview.load(await policy(role, ['scheduletask']));
  const query = calls.find(c => c.name === 'scheduleTask/Task').pipeline;
  expect(query[0]).toEqual({ $match: {
    userId: 'synthetic-member', done: false, type: { $in: ['todo', 'tobuy'] },
    $or: [{ start: null }, { start: { $lte: instant } }],
    end: { $gte: instant, $lte: new Date('2026-10-25T15:00:00Z') },
  } });
  expect(query[1]).toEqual({ $sort: { end: 1, _id: 1 } });
  expect(query[2].$facet).toEqual({ rows: [{ $limit: 2 }, { $project: { title: 1, type: 1, end: 1 } }], total: [{ $count: 'value' }] });
  expect(data.load).not.toHaveBeenCalled(); // Never filter an already capped task card.
});
test.each(['admin', 'user'])('chats require membership and both inclusive six-hour boundaries for %s', async role => {
  await overview.load(await policy(role, ['chat5']));
  const query = calls.find(c => c.name === 'conversation5').pipeline;
  expect(query[0]).toEqual({ $match: { members: 'synthetic-member', updatedAt: {
    $gte: new Date('2026-10-24T09:00:00Z'), $lte: instant,
  } } });
  expect(query[1]).toEqual({ $sort: { updatedAt: -1, _id: -1 } });
  expect(query[2].$facet.rows).toEqual([{ $limit: 2 }, { $project: { title: 1, updatedAt: 1 } }]);
});
test('minimal previews preserve total counts without prompts, transcripts or raw metadata', async () => {
  fixtures.human_tool_request = facet([{ variant: 'codex', createdAt: instant, prompt: 'private fixture prompt' }], 8);
  fixtures.conversation5 = facet([{ _id: 'chat/one', title: 'Synthetic chat', updatedAt: instant, members: ['other'], text: 'private fixture transcript' }]);
  const result = await overview.load(await policy('admin', ['chat5']));
  expect(group(result, 'ask')).toMatchObject({ count: 8, rows: [{ title: 'Codex request', detail: 'Pending', href: '/admin/ask-lennart', at: instant.toISOString() }] });
  expect(group(result, 'chats').rows[0].href).toBe('/chat5/chat/chat%2Fone');
  expect(JSON.stringify(result)).not.toMatch(/private fixture|members/);
});
test('Codex aggregates distinct sessions before counting and linking, with running first', async () => {
  fixtures.codex_turn = facet([{ _id: 'session/one', status: 'running', at: instant }], 5);
  fixtures.codex_session = [{ _id: 'session/one', title: 'Synthetic session' }];
  const result = await overview.load(await policy());
  const query = calls.find(c => c.name === 'codex_turn').pipeline;
  expect(query[0]).toEqual({ $match: { status: { $in: ['queued', 'running'] } } });
  expect(query[1].$sort.status).toBe(-1);
  expect(query[2].$group).toMatchObject({ _id: '$sessionId', status: { $first: '$status' } });
  expect(query[4].$facet.total).toEqual([{ $count: 'value' }]);
  expect(data.read).toHaveBeenCalledWith('codex_session', { _id: { $in: ['session/one'] } }, 'title', { _id: 1 }, 2);
  expect(group(result, 'codex')).toMatchObject({ count: 5, rows: [{ title: 'Synthetic session', detail: 'Running', href: '/codex/sessions/session%2Fone', at: instant.toISOString() }] });
});
test('Life Log checks beyond the old ten-schedule card limit and uses Tokyo calendar days', async () => {
  fixtures.my_life_log_reminder = Array.from({ length: 12 }, (_, i) => ({ _id: String(i), type: 'basic', label: `Synthetic ${i}`, scheduleType: 'interval', intervalDays: 1 }));
  fixtures.my_life_log_entry = fixtures.my_life_log_reminder.slice(0, 10).map(r => ({ _id: { type: r.type, label: r.label }, timestamp: instant }));
  fixtures.my_life_log_entry.push({ _id: { type: 'basic', label: 'Synthetic 11' }, timestamp: '2026-10-22T15:00:00Z' });
  const result = await overview.load(await policy());
  expect(group(result, 'life')).toMatchObject({ count: 2, rows: [
    { title: 'Synthetic 11', detail: 'Basic · 1 day late' }, { title: 'Synthetic 10', detail: 'Basic · Due today' },
  ] });
  expect(data.read).toHaveBeenCalledWith('my_life_log_reminder', { enabled: true }, expect.any(String), { _id: 1 }, 101);
  expect(calls.find(c => c.name === 'my_life_log_entry').pipeline[0].$match.timestamp).toEqual({ $lte: instant });
});
test.each([
  ['2026-09-30T14:59:59Z', 20260831, 'August 2026'],
  ['2026-09-30T15:00:00Z', 20260930, 'September 2026'],
  ['2026-12-31T15:00:00Z', 20261231, 'December 2026'],
  ['2028-02-29T15:00:00Z', 20280229, 'February 2028'],
])('accounting only includes unclosed accounts at Tokyo month boundary %s', async (at, closed, month) => {
  overview = createAccountOverviewData({ model, data, now: () => new Date(at) });
  fixtures.account_db = [{ _id: 'open', name: 'Synthetic open', balance_date: 20260101 }, { _id: 'closed', name: 'Synthetic closed', balance_date: closed }];
  const p = await policy('admin', ['budget']);
  const result = group(await overview.load(p), 'accounting');
  expect(result.count).toBe(1);
  expect(result.rows).toEqual([{ title: 'Synthetic open', detail: `Finalize ${month}`, href: '/budget/close-month/#account-open', at: null }]);
  expect(overviewSections(p).find(s => s.id === 'accounting').href).toBe('/budget/close-month/');
});
test.each([['my_life_log_reminder', 'life'], ['account_db', 'accounting']])('excessive %s scan reports unavailable, never a misleading zero', async (name, id) => {
  fixtures[name] = Array(101).fill({});
  const result = await overview.load(await policy('admin', ['accounting']));
  expect(group(result, id)).toEqual({ id, state: 'unavailable', rows: [], count: null });
  expect(logger.warning).toHaveBeenCalledWith('Account overview source unavailable', { category: 'account_dashboard', metadata: { section: id } });
});
test('source failure is isolated and diagnostics omit exception content', async () => {
  fixtures.human_tool_request = new Error('private fixture diagnostic');
  const result = await overview.load(await policy('admin', ['chat5']));
  expect(group(result, 'ask')).toMatchObject({ state: 'unavailable', count: null });
  expect(group(result, 'chats')).toMatchObject({ state: 'empty', count: 0 });
  expect(result.fetchedAt).toBe(instant.toISOString());
  expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('private fixture diagnostic');
});
test('cooking reuses entitled recipe resolution and marks capped counts honestly', async () => {
  fixtures.cooking = Array.from({ length: 12 }, (_, i) => ({ title: `Meal ${i}`, detail: 'Dinner', href: `/cooking/cookbook/${i}` }));
  const p = await policy('user', ['cooking']);
  const result = group(await overview.load(p), 'cooking');
  expect(data.load).toHaveBeenCalledWith('cooking', p);
  expect(result).toMatchObject({ count: 12, countIsLowerBound: true, rows: fixtures.cooking.slice(0, 2) });
});
