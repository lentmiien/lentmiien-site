jest.mock('../../utils/logger', () => ({ warning: jest.fn() }));
const { createDashboardData } = require('../../services/accountDashboardData');
const { resolvePolicy } = require('../../services/accountSurfacePolicy');
const { now, horizon, cases, tasks, matches } = require('../fixtures/taskDates');

test('all bounded owner queries apply the inclusive start horizon before limits and render date combinations', async () => {
  const records = [...tasks, ...tasks.map(t => ({ ...t, _id: `done-${t._id}`, done: true })),
    ...tasks.map(t => ({ ...t, _id: `foreign-${t._id}`, userId: 'foreign' })),
    { ...tasks[0], _id: 'presence', type: 'presence' }];
  const queries = [];
  const model = name => ({ find(filter) {
    const query = { name, filter }; queries.push(query);
    const chain = {
      select: value => { query.projection = value; return chain; },
      sort: () => chain, limit: value => { query.limit = value; return chain; },
      maxTimeMS: value => { expect(value).toBe(2000); return chain; },
      setOptions: () => chain, lean: () => chain,
      exec: async () => records.filter(t => matches(t, filter)).slice(0, query.limit),
    };
    return chain;
  } });
  const policy = await resolvePolicy({ _id: '1'.repeat(24), name: 'member', type_user: 'user' },
    { findOne: async () => ({ permissions: ['scheduletask'] }) });
  const result = await createDashboardData({ model, now: () => now }).load('tasks', policy);
  expect(queries).toHaveLength(3);
  for (const query of queries) {
    expect(query.filter).toMatchObject({ userId: 'member', done: false, type: { $in: ['todo', 'tobuy'] },
      $and: [{ $or: [{ start: null }, { start: { $lte: horizon } }] }, expect.any(Object)] });
    expect(query.projection).toBe('title type start end');
  }
  expect(queries.map(q => q.limit)).toEqual([12, 12, 16]);
  expect(result.rows.map(r => r.taskId).sort()).toEqual(cases.filter(c => c[3] !== false).map(c => c[0]).sort());
  for (const row of result.rows) {
    const [id, dates, status] = cases.find(c => c[0] === row.taskId);
    expect(row).toMatchObject({ taskId: id, group: status, start: dates.start?.toISOString() || null,
      end: dates.end?.toISOString() || null, canComplete: true, href: '/scheduleTask/upcoming' });
    expect(row.detail).toContain(status);
  }
  expect([...new Set(result.rows.map(r => r.group))]).toEqual(['Overdue', 'Due today', 'Ongoing', 'Upcoming']);
});
