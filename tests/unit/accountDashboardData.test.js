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
    { ...base, type: 'saving' }, { ...base, type: 'income' }, { ...base, type: 'transfer' }], accounts, 20260901)).toEqual({ issues: [], rows: [
    { title: 'JPY 105.00 this month', detail: 'Prior full month 55.00 · difference 50.00' },
    { title: 'USD 15.00 this month', detail: 'Prior full month 0.00 · difference 15.00' },
  ] });
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
const externalExpense = (date = 20260902) => ({ ...movement('EXT', date, 25), to_account: 'a', from_fee: 0 });
const supportedExpense = (date = 20260902) => ({ ...movement('a', date, 25), from_fee: 0 });
const logger = require('../../utils/logger');

test.each([false, true])('invalid external-payer expense preserves balances and tasks with pending closes=%s', async pending => {
  fixtures.account_db = [ledgerAccount('a', pending ? 20260731 : 20260831)];
  fixtures.transaction_db = filter => filter.date.$lt ? [] : [externalExpense()];
  const p = await policy(owner, 'admin', ['accounting', 'scheduletask']);
  const result = await data.load('accounting', p);
  expect(result.state).toBe('partial');
  expect(result.rows[0].title).toBe('Spending summary unavailable');
  expect(result.rows.find(r => r.title === 'Synthetic a').detail).toContain('USD 125 · current');
  expect(result.rows.some(r => r.href === '/accounting/close-month/')).toBe(true);
  expect((await data.load('tasks', p)).rows).toHaveLength(pending ? 1 : 0);
  expect(logger.warning.mock.calls[0][1].metadata.reasonCode).toBe('EXPENSE_EXTERNAL_PAYER');
});

test.each([{ transactions: [] }, { transactions: [movement('a', 20260901, 10)] }])('finalized accounts with empty/populated ledgers stay ready %#', async ({ transactions }) => {
  fixtures.account_db = [ledgerAccount('a')]; fixtures.transaction_db = transactions;
  const p = await policy(owner, 'admin', ['accounting', 'scheduletask']);
  const result = await data.load('accounting', p);
  expect(result.state).toBe('ready');
  expect(result.rows.find(r => r.title === 'Synthetic a').detail).toContain(`USD ${transactions.length ? 89 : 100} · current`);
  expect((await data.load('tasks', p)).rows).toEqual([]);
});

test('external representation preserves explicit classification, fees, same-currency accounts and signed amounts', () => {
  const base = externalExpense();
  const result = spendingByCurrency([
    { ...base, from_account: 'b', type: ' ExPeNsE ', from_fee: 2, to_fee: 3 },
    { ...base, type: '' }, { ...base, type: 'income' }, { ...base, type: 'saving' },
    { ...base, from_account: 'b', amount: -5 },
  ], [ledgerAccount('a'), ledgerAccount('b')], 20260901);
  expect(result).toEqual({ issues: [], rows: [{ title: 'USD 25.00 this month', detail: 'Prior full month 0.00 · difference 25.00' }] });
});

test.each([
  [{ from_account: 'missing' }, 'EXPENSE_CURRENCY_UNAVAILABLE'],
  [{ from_account: 'EXT' }, 'EXPENSE_EXTERNAL_PAYER'],
  [{ to_account: 'missing' }, 'EXPENSE_CURRENCY_UNAVAILABLE'],
  [{ to_account: 'jpy' }, 'EXPENSE_CURRENCY_CONFLICT'],
  [{ amount: NaN }, 'EXPENSE_AMOUNT_INVALID'],
  [{ amount: Infinity }, 'EXPENSE_AMOUNT_INVALID'],
  [{ amount: '25' }, 'EXPENSE_AMOUNT_INVALID'],
  [{ from_fee: undefined }, 'EXPENSE_AMOUNT_INVALID'],
])('unresolved expenses never become a zero or a partial total %#', (changes, reasonCode) => {
  const result = spendingByCurrency([supportedExpense(), { ...supportedExpense(), ...changes }],
    [ledgerAccount('a'), { ...ledgerAccount('jpy'), currency: 'JPY' }], 20260901);
  expect(result.issues).toEqual([{ period: 'current', reasonCode, affectedCount: 1 }]);
  expect(result.rows[0].title).toBe('Spending summary unavailable');
  expect(JSON.stringify(result.rows)).not.toMatch(/25.00|difference|0.00 this month/);
});

test.each(['current', 'prior', 'both'])('month availability and comparisons remain honest: %s', async missing => {
  fixtures.account_db = [ledgerAccount('a')];
  fixtures.transaction_db = [supportedExpense(), supportedExpense(20260831)];
  for (const [period, date] of [['current', 20260901], ['prior', 20260801]]) {
    if (missing === period || missing === 'both') fixtures.transaction_db.push(externalExpense(date));
  }
  const p = await policy(owner, 'admin', ['accounting', 'scheduletask']);
  const result = await data.load('accounting', p);
  expect(result.state).toBe('partial');
  expect(result.rows.filter(r => r.title === 'Spending summary unavailable')).toHaveLength(missing === 'both' ? 2 : 1);
  const serialized = JSON.stringify(result.rows);
  expect(serialized).not.toContain('difference');
  expect(serialized.includes('USD 25.00 this month')).toBe(missing === 'prior');
  expect(serialized.includes('USD 25.00 prior full month')).toBe(missing === 'current');
  expect(result.rows.find(r => r.title === 'Synthetic a').detail).toContain(`USD ${missing === 'prior' ? 75 : 100} · current`);
  expect((await data.load('tasks', p)).rows).toEqual([]);
  expect(result.rows.some(r => r.href === '/accounting/close-month/')).toBe(true);
});

test('spending failures aggregate safe diagnostics without record values or identifiers', async () => {
  fixtures.account_db = [ledgerAccount('a')];
  fixtures.transaction_db = [0, 1].map(() => ({ ...externalExpense(), from_account: 'private-account-id', _id: 'private-transaction-id', amount: 987654, tags: 'private text' }));
  await data.load('accounting', await policy(owner, 'admin', ['accounting']));
  expect(logger.warning.mock.calls).toEqual([['Dashboard accounting summary requires review', {
    category: 'account_dashboard', metadata: { section: 'accounting', stage: 'spending', reasonCode: 'EXPENSE_CURRENCY_UNAVAILABLE', period: 'current', affectedCount: 2 },
  }]]);
});

test('unexpected spending exception leaves valid balances and close action available', async () => {
  fixtures.account_db = [ledgerAccount('a')];
  const entry = externalExpense();
  Object.defineProperty(entry, 'type', { get() { throw new Error('private exception content'); } });
  fixtures.transaction_db = [entry];
  const result = await data.load('accounting', await policy(owner, 'admin', ['accounting']));
  expect(result.state).toBe('partial');
  expect(result.rows[0]).toMatchObject({ title: 'Spending summary unavailable' });
  expect(result.rows.find(r => r.title === 'Synthetic a').detail).toContain('USD 125 · current');
  expect(result.rows.some(r => r.href === '/accounting/close-month/')).toBe(true);
  expect(logger.warning.mock.calls[0][1].metadata).toEqual({ section: 'accounting', stage: 'spending', reasonCode: 'SPENDING_CALCULATION_FAILED' });
  expect(JSON.stringify(logger.warning.mock.calls)).not.toContain('private exception content');
});

test.each(['summary_read', 'balance_history_read'])('read failure remains a failure with safe stage: %s', async stage => {
  fixtures.account_db = [ledgerAccount('a', 20220101)];
  fixtures.transaction_db = filter => {
    if (stage === 'summary_read' || filter.date.$lt) throw new Error('private database content');
    return [];
  };
  await expect(data.load('accounting', await policy(owner, 'admin', ['accounting']))).rejects.toThrow();
  expect(logger.warning.mock.calls).toEqual([['Dashboard accounting summary requires review', {
    category: 'account_dashboard', metadata: { section: 'accounting', stage, reasonCode: 'ACCOUNTING_STAGE_FAILED' },
  }]]);
});

test.each([
  ['2026-08-31T14:59:59Z', 20260701, 20260831, 20260801],
  ['2026-08-31T15:00:00Z', 20260801, 20260901, 20260901],
  ['2026-12-31T15:00:00Z', 20261201, 20270101, 20270101],
  ['2028-02-29T14:59:59Z', 20280101, 20280229, 20280201],
  ['2028-02-29T15:00:00Z', 20280201, 20280301, 20280301],
])('spending window and balances use Tokyo date boundaries at %s', async (instant, begin, today, monthStart) => {
  data = createDashboardData({ model, now: () => new Date(instant) });
  fixtures.account_db = [ledgerAccount('a', begin)];
  const ledger = [supportedExpense(begin - 1), supportedExpense(begin), supportedExpense(today), supportedExpense(today + 1)];
  fixtures.transaction_db = filter => ledger.filter(t => t.date >= filter.date.$gte && t.date <= filter.date.$lte);
  const result = await data.load('accounting', await policy(owner, 'admin', ['accounting']));
  expect(calls.find(c => c.name === 'transaction_db').filter).toEqual({ date: { $gte: begin, $lte: today } });
  expect(result.state).toBe('ready');
  expect(result.rows[0]).toMatchObject({ title: 'USD 25.00 this month', detail: 'Prior full month 25.00 · difference 0.00' });
  expect(result.rows.find(r => r.title === 'Synthetic a').detail).toContain('USD 75 · current');
  expect(today).toBeGreaterThanOrEqual(monthStart);
});

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
  expect(result.rows.find(r => r.title === 'Synthetic a').detail).toContain('Current balance unavailable');
  expect(result.state).toBe('partial');
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
