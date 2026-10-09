jest.mock('../../../utils/logger', () => ({ warning: jest.fn(), error: jest.fn() }));
const { permitted, SHELTER_ADMIN_ID } = require('../../../services/commons/policy');
const { PLAY, SHELTER, DIARY_READ, DIARY_WRITE } = require('../../../utils/commonsAuthorizationPolicy');
const { fixture } = require('../../fixtures/commonsV12');
const { percentage, stockPanel, createPanels } = require('../../../services/commons/panels');
const { buildEmergencyStockSnapshot } = require('../../../services/emergencyStockService');
const { createDiary } = require('../../../services/commons/diary');
const { createPrivateAccess } = require('../../../services/commons/privateAccess');
const { CommonsRoom } = require('../../../services/commons/room');
const { scenes } = require('../../../services/commons/scenes');
const W = require('../../../public/commons/world');
const id = n => String(n).padStart(24, '0');
const roles = permissions => ({ findOne: async () => ({ permissions }) });
const user = (type_user = 'user', _id = id(1)) => ({ _id, name: 'Preview 1', type_user });

test.each([
  ['family', id(2), true], ['Family', id(2), false], ['FAMILY', id(2), false],
  ['admin', SHELTER_ADMIN_ID, true], ['admin', id(1), false], ['user', SHELTER_ADMIN_ID, false], ['other', SHELTER_ADMIN_ID, false],
])('Shelter narrow identity %s %s; no blanket superuser bypass', async (type, identity, expected) => {
  expect(await permitted(user(type, identity), 'shelter', roles([PLAY, SHELTER, 'emergencystock']))).toBe(expected);
  expect(await permitted(user(type, identity), 'stock', roles([PLAY, SHELTER, 'emergencystock']))).toBe(expected);
});
test('Shelter needs existing ES permission even for family and the named admin', async () => {
  for (const principal of [user('family'), user('admin', SHELTER_ADMIN_ID)]) expect(await permitted(principal, 'shelter', roles([]))).toBe(false);
});
test('Hall metrics enforce admin role and semantic operations; diary grants do not need Chat5', async () => {
  expect(await permitted(user('admin'), 'statistics', roles([]))).toBe(true);
  expect(await permitted(user(), 'statistics', roles(['commons.operations.read']))).toBe(false);
  expect(await permitted(user(), 'diary-save', roles([]))).toBe(true);
  expect(await permitted(user('other'), 'diary', roles([]))).toBe(false);
  expect(await permitted(user('other'), 'diary-save', roles([DIARY_READ]))).toBe(false);
  expect(await permitted(user('other'), 'diary-save', roles([DIARY_READ, DIARY_WRITE]))).toBe(true);
});
test('quest policy uses the dashboard section plus canonical completion permission', async () => {
  expect(await permitted(user(), 'quests', roles([]))).toBe(false);
  expect(await permitted(user(), 'quest-done', roles(['scheduletask']))).toBe(true);
  expect(await permitted(user('other'), 'quest-done', roles(['scheduletask', 'dashboard.account.read']))).toBe(false);
});
test('quest rows exactly match dashboard adapter, including task ordering and omissions', async () => {
  const roleModel = roles(['scheduletask', 'accounting']);
  const now = new Date('2026-10-09T03:00:00Z');
  const h = fixture({ roleModel, now: () => now });
  const cases = require('../../fixtures/taskDates');
  const tasks = h.records['scheduleTask/Task']; tasks.length = 0;
  tasks.push(...cases.tasks.map((t, i) => ({ ...t, _id: id(i + 1), userId: 'Preview 1' })));
  for (let i = 0; i < 55; i++) tasks.push({ _id: id(i + 100), userId: 'Preview 1', title: 'Synthetic bounded task', type: i % 2 ? 'todo' : 'tobuy', done: false, end: null, start: null });
  tasks.push({ _id: id(900), userId: 'other', type: 'todo', done: false }, { _id: id(901), userId: 'Preview 1', type: 'presence', done: false });
  const policy = await require('../../../services/accountSurfacePolicy').resolvePolicy(user(), roleModel);
  expect(await h.panels.quests(user())).toEqual(await h.dashboard.load('tasks', policy));
  const rows = (await h.panels.quests(user())).rows;
  expect(rows.length).toBeLessThanOrEqual(40);
  expect(rows.some(r => ['900', '901'].includes(String(Number(r.taskId))))).toBe(false);
  expect(rows.some(r => r.detail.startsWith('Buy'))).toBe(true);
  expect(rows.some(r => r.detail.startsWith('To do'))).toBe(true);
});
test('canonical completion is idempotent and rejects missing, foreign, ownerless, presence and unknown fields', async () => {
  const h = fixture({ roleModel: roles(['scheduletask']) });
  for (const taskId of [id(100), id(101)]) {
    expect(await h.panels.complete(user(), { taskId })).toMatchObject({ ok: true, done: true });
    const stamp = h.records['scheduleTask/Task'].find(t => t._id === taskId).updatedAt;
    await h.panels.complete(user(), { taskId });
    expect(h.records['scheduleTask/Task'].find(t => t._id === taskId).updatedAt).toBe(stamp);
  }
  expect((await h.panels.quests(user())).rows).toEqual([]);
  for (const task of [{ _id: id(501), userId: null, type: 'todo' }, { _id: id(502), userId: 'Preview 1', type: 'presence' }]) h.records['scheduleTask/Task'].push(task);
  for (const taskId of [id(102), id(501), id(502), id(999)]) await expect(h.panels.complete(user('admin'), { taskId })).rejects.toHaveProperty('code', 'TASK_GONE');
  await expect(h.panels.complete(user(), { taskId: id(100), ownerId: id(2) })).rejects.toHaveProperty('code', 'INVALID_INPUT');
});
test('stock adapter uses canonical quantities and units without item contents and uncaps ratios', async () => {
  const h = fixture({ roleModel: roles([]), now: () => new Date('2026-10-09T03:00:00Z') });
  const snapshot = buildEmergencyStockSnapshot({ categories: h.records.es_category, items: h.records.es_item, profile: h.records.es_profile[0], now: new Date('2026-10-09T03:00:00Z') });
  const panel = await h.panels.stock();
  expect(panel).toEqual(stockPanel(snapshot));
  expect(panel.rows.find(r => r.id === 'water')).toMatchObject({ unit: 'L', current: snapshot.domains.water.currentAmount, target: snapshot.domains.water.targetAmount });
  expect(panel.rows.find(r => r.id === 'food').unit).toBe('person-meals');
  expect(JSON.stringify(panel)).not.toContain('water-lot');
  expect(percentage(15, 10)).toBe(150); expect(percentage(1, 0)).toBeNull(); expect(percentage(0, 10)).toBe(0); expect(percentage(1, 10, false)).toBeNull(); expect(percentage(NaN, 10)).toBeNull();
});
test('stock bounds fail closed for missing profile or inventory overflow', async () => {
  const h = fixture({ roleModel: roles([]) }); h.records.es_profile.length = 0;
  await expect(h.panels.stock()).rejects.toHaveProperty('code', 'SUMMARY_UNAVAILABLE');
  h.records.es_profile.push({ key: 'household' }); h.records.es_item.push(...Array.from({ length: 2001 }, () => ({ _id: 'x' })));
  await expect(h.panels.stock()).rejects.toHaveProperty('code', 'SUMMARY_UNAVAILABLE');
});
test('metrics read only the five curated collections, sanitize partial errors and refresh without a cache', async () => {
  const collectionStats = jest.fn(async name => { if (name === 'chat5') throw new Error('private failure'); return { count: 7, secret: 'never return' }; });
  const h = createPanels({ collectionStats, model: name => ({ collection: { name } }) });
  const result = await h.statistics();
  expect(collectionStats.mock.calls.map(c => c[0])).toEqual(['conversation5', 'chat5', 'chat4_knowledge', 'gpt_image_generation', 'music_generation']);
  expect(result.rows[1]).toMatchObject({ state: 'unavailable', value: null });
  expect(JSON.stringify(result)).not.toMatch(/private failure|secret|never return/);
  await h.statistics(); expect(collectionStats).toHaveBeenCalledTimes(10);
});

test('diary current date create/edit, revision conflict, owner isolation and bounded date history', async () => {
  let now = new Date('2026-10-09T14:59:59Z'); const h = fixture({ roleModel: roles([]), now: () => now });
  const input = { date: '2026-10-09', text: '<script>synthetic</script>', revision: 0 };
  const saved = await h.diary.save(id(1), input); expect(saved.entry).toMatchObject({ revision: 1, text: input.text });
  await expect(h.diary.save(id(1), input)).rejects.toHaveProperty('code', 'REVISION_CONFLICT');
  expect((await h.diary.read(id(2), {})).entry.text).toBe('');
  await h.diary.save(id(1), { ...input, revision: 1, text: 'Second draft' });
  now = new Date('2026-10-09T15:00:00Z');
  await expect(h.diary.save(id(1), { ...input, revision: 2 })).rejects.toHaveProperty('code', 'DAY_CHANGED');
  expect((await h.diary.read(id(1), { date: input.date })).entry.text).toBe('Second draft');
  for (let n = 1; n <= 25; n++) h.records.diary.push({ ownerId: id(1), date: `2026-09-${String(n).padStart(2, '0')}`, text: 'Synthetic past', revision: 1 });
  const first = await h.diary.read(id(1), { before: '9999-12-31' });
  expect(first.dates).toHaveLength(20); expect(first.next).toBe(first.dates[19].date); expect(first.dates[0]).not.toHaveProperty('text');
  const second = await h.diary.read(id(1), { before: first.next }); expect(second.dates).toHaveLength(6); expect(second.next).toBeNull();
});
test.each([
  { date: '2026-02-30', text: 'x', revision: 0 }, { date: '2026-10-09', text: 'x'.repeat(10001), revision: 0 },
  { date: '2026-10-09', text: 2, revision: 0 }, { date: '2026-10-09', text: 'x', revision: -1 },
  { date: '2026-10-09', text: 'x', revision: 0, ownerId: id(2) },
])('invalid diary writes do no work %#', async input => {
  const model = { findOneAndUpdate: jest.fn() }; const service = createDiary({ model, now: () => Date.parse('2026-10-09T00:00:00Z') });
  await expect(service.save(id(1), input)).rejects.toHaveProperty('code', 'INVALID_INPUT'); expect(model.findOneAndUpdate).not.toHaveBeenCalled();
});
test('diary rechecks day after authorization and refuses future/past/guessed owner query', async () => {
  let now = Date.parse('2026-10-09T14:59:59Z'); const model = { findOneAndUpdate: jest.fn() };
  const diary = createDiary({ model, now: () => now });
  await expect(diary.save(id(1), { date: '2026-10-09', text: 'draft', revision: 0 }, async () => { now += 2000; })).rejects.toHaveProperty('code', 'DAY_CHANGED');
  expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  for (const date of ['2026-10-08', '2026-10-11']) await expect(diary.save(id(1), { date, text: 'draft', revision: 0 })).rejects.toHaveProperty('code', 'DAY_CHANGED');
  for (const input of [{ date: '2026-10-11' }, { ownerId: id(2) }, { date: '2026-02-30' }, { date: '2026-10-09', before: '2026-01-01' }]) await expect(diary.read(id(1), input)).rejects.toHaveProperty('code', 'INVALID_INPUT');
});
test('HTTP connection ticket is session/generation scoped, bounded concurrency and rejects delayed takeover', async () => {
  const access = createPrivateAccess(), ticket = crypto.randomUUID(), connection = { sessionId: 's', userId: id(1), check: jest.fn(async () => user()) };
  access.add(ticket, connection); const req = { get: () => ticket, sessionID: 's', session: { passport: { user: id(1) } } };
  const grant = await access.open(req, 'diary');
  await expect(access.open(req, 'diary')).rejects.toHaveProperty('code', 'BUSY');
  grant.release();
  await expect(access.open({ ...req, sessionID: 'other' }, 'diary')).rejects.toHaveProperty('code', 'UNAUTHORIZED');
  access.remove(ticket); await expect(grant.check()).rejects.toHaveProperty('code', 'UNAUTHORIZED');
});
test('restricted scene entry, reachability, safe revocation and reconnect never expose another interior', async () => {
  let saved = { version: 1, revision: 0, blooms: 0, players: [], leaseUntil: new Date(Date.now() + 60000) };
  const room = new CommonsRoom({ repository: { acquire: async () => structuredClone(saved), save: async s => (saved = structuredClone(s)) } });
  const conn = token => ({ token, validUntil: Date.now() + 60000, close: jest.fn() });
  await room.join(id(1), conn('one')); await room.join(id(2), conn('two'));
  for (const scene of ['hall', 'shelter']) {
    Object.assign(room.state.players[0], scenes[scene].publicExit);
    await expect(room.action(id(1), 'one', { id: crypto.randomUUID(), target: scene })).rejects.toHaveProperty('code', 'FORBIDDEN');
    await room.action(id(1), 'one', { id: crypto.randomUUID(), target: scene }, { [scene]: true });
    expect(room.snapshot(id(1), 'one').self.sceneDefinition.id).toBe(scene);
    expect(JSON.stringify(room.snapshot(id(2), 'two'))).not.toContain('sceneDefinition');
    for (const entity of scenes[scene].entities) expect(W.walkable(entity.x, Math.min(entity.y + 1, 9), scene, scenes[scene])).toBe(true);
    expect(await room.enforceScene(id(1), 'one', {})).toBe(true);
    expect(room.state.players[0]).toMatchObject(scenes[scene].publicExit);
    expect(W.walkable(room.state.players[0].x, room.state.players[0].y)).toBe(true);
  }
  Object.assign(room.state.players[0], { scene: 'hall', x: 3, y: 5 });
  expect((await room.join(id(1), conn('new'))).self).toMatchObject(scenes.hall.publicExit);
});


test('automatic accounting reminders match My Page and cannot complete without canonical review', async () => {
  const prior = process.env.DASHBOARD_PERSONAL_OWNER_USER_ID;
  process.env.DASHBOARD_PERSONAL_OWNER_USER_ID = id(1);
  try {
    const roleModel = roles(['scheduletask', 'accounting']);
    const h = fixture({ roleModel, now: () => new Date('2026-10-09T03:00:00Z') });
    h.records.account_db.push({ _id: id(301), name: 'Synthetic account', balance_date: 20260831 });
    const principal = user('admin');
    const policy = await require('../../../services/accountSurfacePolicy').resolvePolicy(principal, roleModel);
    const board = await h.panels.quests(principal);
    expect(board).toEqual(await h.dashboard.load('tasks', policy));
    expect(board.rows.at(-1)).toMatchObject({ group: 'Automatic accounting', canComplete: false, href: `/accounting/close-month/#account-${id(301)}` });
    expect(board.rows.at(-1)).not.toHaveProperty('taskId');
  } finally { if (prior === undefined) delete process.env.DASHBOARD_PERSONAL_OWNER_USER_ID; else process.env.DASHBOARD_PERSONAL_OWNER_USER_ID = prior; }
});
test('all new interior interactions have a walkable path from spawn and an escape route', () => {
  for (const scene of Object.values(scenes)) {
    const seen = new Set(), queue = [[scene.spawn.x, scene.spawn.y]];
    while (queue.length) {
      const [x, y] = queue.shift(), key = `${x},${y}`;
      if (seen.has(key) || !W.walkable(x, y, scene.id, scene)) continue;
      seen.add(key);
      for (const [dx, dy] of [[.25, 0], [-.25, 0], [0, .25], [0, -.25]]) queue.push([x + dx, y + dy]);
    }
    expect(seen.has('6,9')).toBe(true);
    for (const entity of scene.entities) expect([...seen].some(key => {
      const [x, y] = key.split(',').map(Number); return Math.hypot(x - entity.x, y - entity.y) <= 1.5;
    })).toBe(true);
  }
  expect(W.walkable(30, 22)).toBe(false);
  expect(W.walkable(30, 23)).toBe(true);
  expect(W.nearby({ scene: 'village', x: 30, y: 23 }).some(e => e.id === 'quests')).toBe(true);
});
