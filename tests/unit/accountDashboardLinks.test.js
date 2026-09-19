jest.mock('../../utils/logger', () => ({ warning: jest.fn() }));
const { Types } = require('mongoose');
const { createDashboardData } = require('../../services/accountDashboardData');
const { resolvePolicy } = require('../../services/accountSurfacePolicy');
const now = new Date('2026-09-08T15:00:00Z');
const id = n => n.toString(16).padStart(24, '0');
let fixtures; let calls; let data;
function matches(doc, filter) {
  return Object.entries(filter).every(([key, value]) => {
    if (value instanceof RegExp) return value.test(doc[key]);
    if (value?.$in) return value.$in.some(v => String(v) === String(doc[key]));
    if (value?.$ne) return doc[key] !== value.$ne;
    return doc[key] === value;
  });
}
function model(name) {
  return { find(filter) {
    const call = { name, filter }; calls.push(call);
    const chain = {
      select(projection) { call.projection = projection; return chain; },
      sort(sort) { call.sort = sort; return chain; },
      limit(limit) { call.limit = limit; return chain; },
      maxTimeMS(ms) { expect(ms).toBe(2000); return chain; },
      setOptions() { return chain; }, lean() { return chain; },
      async exec() {
        let rows = (fixtures[name] || []).filter(doc => matches(doc, filter));
        const keys = Object.entries(call.sort);
        rows.sort((a, b) => {
          for (const [key, direction] of keys) {
            if (a[key] < b[key]) return -direction;
            if (a[key] > b[key]) return direction;
          }
          return 0;
        });
        rows = rows.slice(0, call.limit);
        if (call.projection.entries) return rows.map(doc => ({ entries: doc.entries.slice(0, call.projection.entries.$slice) }));
        return rows;
      },
    };
    return chain;
  } };
}
const policy = async (role = 'user', grants = ['cooking']) => resolvePolicy(
  { _id: id(99), name: 'fixture-owner', type_user: role },
  { findOne: async q => q.type === 'user' ? { permissions: grants } : null }, id(99));
const recipe = (n, extra = {}) => ({ _id: new Types.ObjectId(id(n)), user_id: 'fixture-owner', title: `Fixture recipe ${n}`, ...extra });
function schedule(ids) {
  fixtures.CookingCalendarV2 = [{ date: '2026-09-09', entries: ids.map((n, i) => ({ recipeId: new Types.ObjectId(id(n)), category: `Meal ${i}` })) }];
}
beforeEach(() => { fixtures = {}; calls = []; data = createDashboardData({ model, now: () => now }); });

test('mixed recipes use owned titles and canonical links, preserving schedule order and duplicates', async () => {
  schedule([3, 1, 2, 3, 4, 5, 6, 7]);
  fixtures.cookbook_recipe = [recipe(1), recipe(10, { originKnowledgeId: id(2) }), recipe(4, { title: '' }), recipe(5, { user_id: 'other', title: 'Private cookbook title' })];
  fixtures.chat4_knowledge = [recipe(2, { category: 'Recipe', title: 'Old title' }), recipe(3, { category: 'recipe' }), recipe(7, { category: 'Recipe', user_id: 'other', title: 'Private legacy title' })];
  const result = await data.load('cooking', await policy());
  expect(result.rows.map(r => r.title)).toEqual(['Fixture recipe 3', 'Fixture recipe 1', 'Fixture recipe 10', 'Fixture recipe 3', 'Untitled recipe', 'Recipe unavailable', 'Recipe unavailable', 'Recipe unavailable']);
  expect(result.rows.map(r => r.href)).toEqual([`/cooking/cookbook/legacy/${id(3)}`, `/cooking/cookbook/${id(1)}`, `/cooking/cookbook/${id(10)}`, `/cooking/cookbook/legacy/${id(3)}`, `/cooking/cookbook/${id(4)}`, null, null, null]);
  expect(result.rows.map(r => r.detail.split(' · ')[0])).toEqual(Array.from({ length: 8 }, (_, i) => `Meal ${i}`));
  expect(JSON.stringify(result)).not.toMatch(/Private|other/);
  expect(calls[0]).toMatchObject({ filter: { date: '2026-09-09' }, projection: { entries: { $slice: 12 } }, limit: 1 });
  expect(calls.slice(1).every(c => c.filter.user_id === 'fixture-owner' && c.limit === 12)).toBe(true);
  expect(calls.find(c => c.filter.originKnowledgeId).filter.originKnowledgeId.$in).toEqual([3, 1, 2, 4, 5, 6, 7].map(id));
});

test('canonical ID takes precedence over an alias and a legacy ID with the same value', async () => {
  schedule([1]);
  fixtures.cookbook_recipe = [recipe(1), recipe(2, { originKnowledgeId: id(1) })];
  fixtures.chat4_knowledge = [recipe(1, { category: 'Recipe', title: 'Old name' })];
  expect((await data.load('cooking', await policy())).rows[0]).toMatchObject({ title: 'Fixture recipe 1', href: `/cooking/cookbook/${id(1)}` });
});

test('empty plan skips recipe queries and selected meals stay bounded', async () => {
  expect((await data.load('cooking', await policy())).state).toBe('empty');
  expect(calls).toHaveLength(1);
  schedule(Array.from({ length: 20 }, (_, i) => i + 1));
  expect((await data.load('cooking', await policy())).rows).toHaveLength(12);
  expect(calls.at(-1).filter._id.$in).toHaveLength(12);
});

test('non-recipe knowledge is unavailable; owned untitled legacy has an honest title', async () => {
  schedule([1, 2]);
  fixtures.chat4_knowledge = [recipe(1, { category: 'Note' }), recipe(2, { category: 'Recipe', title: '' })];
  expect((await data.load('cooking', await policy())).rows.map(r => [r.title, r.href])).toEqual([
    ['Recipe unavailable', null], ['Untitled recipe', `/cooking/cookbook/legacy/${id(2)}`],
  ]);
});

test('custom roles need the legacy read capability to receive a compatibility link', async () => {
  schedule([1]); fixtures.chat4_knowledge = [recipe(1, { category: 'Recipe' })];
  const grants = ['cooking', 'dashboard.account.read'];
  expect((await data.load('cooking', await policy('custom', grants))).rows[0].href).toBeNull();
  expect((await data.load('cooking', await policy('custom', [...grants, 'cooking.recipe.read']))).rows[0].href).toBe(`/cooking/cookbook/legacy/${id(1)}`);
});

test('running and queued turns in one session link to their own encoded turn, never lastTurnId', async () => {
  fixtures.codex_turn = [
    { _id: 'running/turn', sessionId: 'session', status: 'running', queuedAt: new Date(now - 2000), startedAt: now },
    { _id: 'queued?turn', sessionId: 'session', status: 'queued', queuedAt: new Date(now - 1000) },
    { _id: 'missing-session', sessionId: 'missing', status: 'running', queuedAt: now },
    { _id: 'done', sessionId: 'session', status: 'completed', queuedAt: now },
  ];
  fixtures.codex_session = [{ _id: 'session', title: 'Fixture session', lastTurnId: 'wrong-turn' }];
  const result = await data.load('codex', await policy('admin'));
  expect(result.rows.map(r => r.href)).toEqual(['/codex/turns/running%2Fturn', '/codex/turns/queued%3Fturn', '/codex/turns/missing-session']);
  expect(result.rows.map(r => r.detail)).toEqual(['running', 'queued', 'running']);
  expect(result.rows[2].title).toBe('Codex session');
  expect(calls[0]).toMatchObject({ limit: 8, sort: { queuedAt: 1, _id: 1 } });
});

test('terminated pods are filtered before sorting/limit and do not affect visible freshness', async () => {
  fixtures.runpod_pod = [
    ...Array.from({ length: 35 }, (_, i) => ({ _id: id(i), providerStatus: 'TERMINATED', lastProviderSyncAt: new Date(now.getTime() + 1000), lifecycle: 'archived' })),
    ...['EXITED', 'RUNNING', 'CREATED', 'UNKNOWN', undefined].map((status, i) => ({ _id: id(100 + i), name: `Fixture pod ${i}`, providerStatus: status, lastProviderSyncAt: now })),
  ];
  const before = JSON.stringify(fixtures);
  const result = await data.load('runpod', await policy('admin'));
  expect(result.rows).toHaveLength(5);
  expect(result.rows.some(r => r.detail === 'Tracked stopped · EXITED')).toBe(true);
  expect(result.state).toBe('ready');
  expect(calls[0]).toMatchObject({ filter: { providerStatus: { $ne: 'TERMINATED' } }, limit: 30, sort: { lastProviderSyncAt: -1, _id: -1 } });
  expect(JSON.stringify(fixtures)).toBe(before);
});

test('all terminated pods yield the existing unavailable empty state; stopped stale pods remain', async () => {
  fixtures.runpod_pod = [{ providerStatus: 'TERMINATED', lastProviderSyncAt: now }];
  expect(await data.load('runpod', await policy('admin'))).toMatchObject({ state: 'unavailable', rows: [] });
  fixtures.runpod_pod.push({ name: 'Fixture stopped', providerStatus: 'EXITED', lastProviderSyncAt: new Date(now - 3600000) });
  expect(await data.load('runpod', await policy('admin'))).toMatchObject({ state: 'stale', rows: [expect.objectContaining({ title: 'Fixture stopped' })] });
});
