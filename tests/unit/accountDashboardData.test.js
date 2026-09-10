jest.mock('../../utils/logger', () => ({ warning: jest.fn() }));
const { createDashboardData, tokyoDay, freshness, spendingByCurrency } = require('../../services/accountDashboardData');
const { resolvePolicy } = require('../../services/accountSurfacePolicy');
const { DEFAULT_JOBS } = require('../../services/accountPreferencesService');
const at = new Date('2026-09-08T01:00:00Z');
const owner = '111111111111111111111111';
let calls; let fixtures; let data;
function model(name) {
  const chain = { select: p => { calls.at(-1).projection = p; return chain; }, sort: s => { calls.at(-1).sort = s; return chain; }, limit: l => { calls.at(-1).limit = l; return chain; }, maxTimeMS: ms => { expect(ms).toBe(2000); return chain; }, setOptions: () => chain, lean: () => chain, option: () => chain, exec: async () => typeof fixtures[name] === 'function' ? fixtures[name](calls.at(-1).filter) : fixtures[name] || [] };
  return { find: filter => { calls.push({ name, filter }); return chain; }, aggregate: pipeline => { calls.push({ name, pipeline }); return chain; } };
}
const policy = (id = owner, role = 'admin', grants = []) => resolvePolicy({ _id: id, type_user: role, name: 'member' }, { findOne: async q => q.type === 'user' ? { permissions: grants } : null }, owner);
beforeEach(() => { calls = []; fixtures = {}; data = createDashboardData({ model, now: () => at }); });

test.each(['accounting', 'life', 'minute', 'embedding'])('denies %s before ANY personal model access for another admin', async section => {
  await expect(data.load(section, await policy('222222222222222222222222', 'admin', ['accounting', 'embedding']))).rejects.toMatchObject({ status: 403 });
  expect(calls).toHaveLength(0);
});
test('chat membership has no admin bypass and minimal projection with limit 5', async () => {
  await data.load('chats', await policy(owner, 'admin', ['chat5']));
  expect(calls).toEqual([{ name: 'conversation5', filter: { members: 'member' }, projection: 'title category updatedAt', sort: { updatedAt: -1, _id: -1 }, limit: 5 }]);
});
test('tasks are scoped to validated username and only incomplete todo/tobuy', async () => {
  await data.load('tasks', await policy(owner, 'user', ['scheduletask']));
  expect(calls[0]).toMatchObject({ filter: { userId: 'member', done: false, type: { $in: ['todo', 'tobuy'] } }, limit: 12 });
});
test('Tokyo midnight boundaries and event overlap are half-open', async () => {
  expect(tokyoDay(new Date('2026-09-07T14:59:59Z')).key).toBe('2026-09-07');
  const day = tokyoDay(new Date('2026-09-07T15:00:00Z'));
  expect(day.key).toBe('2026-09-08');
  expect(day.end.toISOString()).toBe('2026-09-08T15:00:00.000Z');
  await data.load('agenda', await policy(owner, 'user', ['scheduletask']));
  expect(calls[0].filter).toMatchObject({ userId: 'member', $or: [
    { type: 'presence', start: { $lt: day.end }, end: { $gt: day.start } },
    { type: { $in: ['todo', 'tobuy'] }, done: false, end: { $gte: day.start, $lt: day.end } },
  ] });
});
test('mine feed filters permissions/owner before any source read or aggregation', async () => {
  const p = await policy(owner, 'user', ['ocr']);
  await data.load('jobs', p, { ...DEFAULT_JOBS, types: ['ocr', 'asr', 'music', 'sora', 'bulk', 'gpt_image'] });
  expect(calls.map(c => c.name).sort()).toEqual(['gpt_image_generation', 'ocr_job']);
  expect(calls.find(c => c.name === 'ocr_job').filter['owner.id']).toBe(owner);
  const grouped = calls.find(c => c.name === 'gpt_image_generation').pipeline;
  expect(grouped[0].$match.createdBy).toBe('member');
  expect(grouped[1].$group._id).toBe('$generationId');
  expect(grouped.at(-1)).toEqual({ $limit: 10 });
});
test('shared 3D is explicit, unowned operations admin-only, and personal sources are excluded', async () => {
  await data.load('jobs', await policy(owner, 'user', ['music', 'image_gen']), { ...DEFAULT_JOBS, types: ['trellis2', 'ocr', 'music', 'bulk'], scope: 'shared' });
  expect(calls.map(c => c.name).sort()).toEqual(['music_generation', 'trellis2_job']);
  expect(calls.find(c => c.name === 'trellis2_job').filter.shared).toBe(true);
});
test('saved-only sources never claim running records', async () => {
  await data.load('jobs', await policy(owner, 'user', ['asr']), { ...DEFAULT_JOBS, types: ['gpt_image'], status: 'running' });
  expect(calls).toHaveLength(0);
});
test('stable bounded merge uses fixed URLs and does not expose raw metadata', async () => {
  fixtures.ocr_job = Array.from({ length: 10 }, (_, i) => ({ _id: String(i), createdAt: at, status: 'completed', prompt: 'secret', owner: { id: 'foreign' }, outputUrl: 'javascript:bad' }));
  const result = await data.load('jobs', await policy(owner, 'user', ['ocr']), { ...DEFAULT_JOBS, types: ['ocr'] });
  expect(result.rows).toHaveLength(10);
  expect(result.rows[0].href).toBe('/ocr');
  expect(JSON.stringify(result)).not.toMatch(/secret|foreign|javascript/);
});
test('missing and stale device readings are distinct from fresh states', () => {
  expect(freshness(null, at)).toBe('unavailable');
  expect(freshness(new Date(at - 3600000), at)).toBe('stale');
  expect(freshness(at, at)).toBe('ready');
});
test('Runpod displays provider state, never desired state, and exposes sync time', async () => {
  fixtures.runpod_pod = [{ name: 'Fixture GPU', providerStatus: 'EXITED', desiredStatus: 'RUNNING', lastProviderSyncAt: at }];
  const result = await data.load('runpod', await policy());
  expect(result.rows[0].detail).toBe('Tracked stopped · EXITED');
  expect(result.rows[0].at).toBe(at.toISOString());
});
test('no device configuration means no query', async () => {
  const previous = process.env.DASHBOARD_MINUTE_LOGGER_DEVICE_ID;
  delete process.env.DASHBOARD_MINUTE_LOGGER_DEVICE_ID;
  expect((await data.load('minute', await policy())).state).toBe('unavailable');
  expect(calls).toHaveLength(0);
  if (previous !== undefined) process.env.DASHBOARD_MINUTE_LOGGER_DEVICE_ID = previous;
});
test('financial semantics include both fees, exclude transfers/income and keep currencies separate', () => {
  const accounts = [{ _id: 'jpy', currency: 'JPY' }, { _id: 'usd', currency: 'USD' }];
  const base = { from_account: 'jpy', to_account: 'EXT', amount: 100, from_fee: 2, to_fee: 3, date: 20260907 };
  expect(spendingByCurrency([base, { ...base, date: 20260810, amount: 50 }, { ...base, from_account: 'usd', amount: 10 },
    { ...base, type: 'saving' }, { ...base, type: 'income' }, { ...base, type: 'transfer' }], accounts, 20260901)).toEqual([
    { currency: 'JPY', current: 105, prior: 55 }, { currency: 'USD', current: 15, prior: 0 },
  ]);
});

test('disaster fallback remains regional and absence is never an all-clear', async () => {
  const result = await data.load('disaster', await policy());
  const reads = calls.filter(c => c.name === 'disaster_alert');
  expect(reads).toHaveLength(3);
  expect(reads.every(c => c.limit === 5 && c.filter.$and)).toBe(true);
  expect(result.note).toContain('not an all-clear');
  expect(result.state).toBe('stale');
});

const ledgerAccount = (id, date = 20260831) => ({ _id: id, name: `Synthetic ${id}`, currency: 'USD', balance: 100, balance_date: date });
const movement = (id, date, amount) => ({ _id: `${id}-${date}`, date, amount, from_account: id, to_account: 'EXT', from_fee: 1, to_fee: 0, type: 'expense' });
test('closed accounts reuse spend transactions with no extra history read and include transfers in balances only', async () => {
  fixtures.account_db = [ledgerAccount('a'), ledgerAccount('b')];
  fixtures.transaction_db = [movement('a', 20260831, 20), movement('a', 20260901, 10),
    { ...movement('a', 20260902, 5), to_account: 'b', type: 'saving', to_fee: 2 }];
  const result = await data.load('accounting', await policy(owner, 'admin', ['accounting']));
  expect(calls.filter(c => c.name === 'transaction_db')).toHaveLength(1);
  expect(result.rows.find(r => r.title === 'Synthetic a').detail).toContain('USD 83 · current');
  expect(result.rows.find(r => r.title === 'Synthetic b').detail).toContain('USD 103 · current');
  expect(result.rows[0].title).toBe('USD 11.00 this month');
});
test('years-old baselines read only non-overlapping older history, individually filter each baseline', async () => {
  fixtures.account_db = [ledgerAccount('a', 20220101), ledgerAccount('b', 20260831)];
  fixtures.transaction_db = filter => filter.date.$lt ? [movement('a', 20220301, 20)] : [movement('a', 20260831, 5), movement('a', 20260901, 10)];
  const result = await data.load('accounting', await policy(owner, 'admin', ['accounting']));
  const reads = calls.filter(c => c.name === 'transaction_db');
  expect(reads).toHaveLength(2);
  expect(reads[1].filter).toMatchObject({ date: { $lt: 20260801 }, $or: [{ date: { $gt: 20220101 } }] });
  expect(result.rows.find(r => r.title === 'Synthetic a').detail).toContain('USD 62 · current');
  expect(result.rows.find(r => r.title === 'Synthetic b').detail).toContain('USD 100 · current');
});
test('history truncation and invalid baseline never masquerade as current balances', async () => {
  fixtures.account_db = [ledgerAccount('a', 20220101)];
  fixtures.transaction_db = filter => filter.date.$lt ? Array(50001).fill(movement('a', 20220301, 1)) : [];
  expect((await data.load('accounting', await policy(owner, 'admin', ['accounting']))).state).toBe('unavailable');
  fixtures.account_db = [ledgerAccount('a', 20260931)]; fixtures.transaction_db = [];
  const result = await data.load('accounting', await policy(owner, 'admin', ['accounting']));
  expect(result.rows[0].detail).toContain('Current balance unavailable');
});
test('automatic reminders require owner/capability, are per account, and cannot be marked complete', async () => {
  fixtures.account_db = [ledgerAccount('a', 20220101), ledgerAccount('b', 20260731), ledgerAccount('c')];
  const result = await data.load('tasks', await policy(owner, 'admin', ['scheduletask', 'accounting']));
  expect(result.rows).toHaveLength(2);
  expect(result.rows.every(r => r.group === 'Automatic accounting' && !r.canComplete && !r.taskId)).toBe(true);
  expect(result.rows[0].href).toBe('/accounting/close-month/#account-a');
  calls = [];
  await data.load('tasks', await policy('222222222222222222222222', 'admin', ['scheduletask', 'accounting']));
  expect(calls.some(c => c.name === 'account_db')).toBe(false);
});
