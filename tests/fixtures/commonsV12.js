/* Synthetic, bounded in-memory model adapter for the real dashboard/panel services. */
const { matches } = require('./taskDates');
const { createDashboardData } = require('../../services/accountDashboardData');
const { createPanels } = require('../../services/commons/panels');
const { createDiary } = require('../../services/commons/diary');
const { createTaskCompletion } = require('../../services/scheduleTaskCompletion');
function fixture({ roleModel, now = () => new Date(), diagnostics = () => ({ online: 2, roomOwned: true, revision: 4, persistenceFailed: false }) } = {}) {
  const id = n => String(n).padStart(24, '0');
  const records = {
    'scheduleTask/Task': Array.from({ length: 12 }, (_, i) => ({ _id: id(100 + i), userId: `Preview ${Math.floor(i / 2) + 1}`, title: i % 2 ? 'Buy a synthetic field notebook' : 'Tend the synthetic herb garden', type: i % 2 ? 'tobuy' : 'todo', done: false, createdAt: now(), start: null, end: null })),
    es_profile: [{ key: 'household', householdSize: 3 }],
    es_category: [
      { _id: 'water', name: 'Bottled water', unit: 'L', managementMode: 'rolling', preparednessDomain: 'water', applicable: true, contributionPerUnit: { domainUnits: 1 }, officialBaseline: 27 },
      { _id: 'food', name: 'Complete meals', unit: 'meals', managementMode: 'rolling', preparednessDomain: 'food', applicable: true, contributionPerUnit: { completeMeals: 1 } },
      { _id: 'equipment', name: 'Blankets', unit: 'items', managementMode: 'durable', preparednessDomain: 'other', applicable: true, officialBaseline: 3 },
    ],
    es_item: [{ _id: 'water-lot', categoryId: 'water', amount: 60, status: 'active' }, { _id: 'food-lot', categoryId: 'food', amount: 30, status: 'active' },
      { _id: 'blankets', categoryId: 'equipment', amount: 3, status: 'active', lastInspectedAt: now(), inspectionIntervalDays: 365 }],
    account_db: [], diary: [],
  };
  const models = new Map();
  function model(name) {
    if (models.has(name)) return models.get(name);
    const rows = records[name] || (records[name] = []);
    function query(filter, single = false) {
      let limit = Infinity, sort = {};
      const value = () => {
        let result = rows.filter(row => matches(row, filter)).sort((a, b) => {
          for (const [key, direction] of Object.entries(sort)) { const order = a[key] == null ? b[key] == null ? 0 : -1 : b[key] == null ? 1 : a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0; if (order) return order * direction; }
          return 0;
        }).slice(0, limit);
        return single ? result[0] || null : result;
      };
      const chain = { select: () => chain, sort: s => { sort = s; return chain; }, limit: n => { limit = n; return chain; }, maxTimeMS: () => chain,
        setOptions: () => chain, lean: () => chain, exec: async () => value(), then: (a, b) => Promise.resolve(value()).then(a, b) };
      return chain;
    }
    const output = { collection: { name, listIndexes: () => ({ toArray: async () => [{ key: { ownerId: 1, date: -1 }, unique: true }] }) }, find: filter => query(filter), findOne: filter => query(filter, true),
      findOneAndUpdate(filter, update, options) {
        const promise = Promise.resolve().then(() => {
          let row = rows.find(r => matches(r, filter));
          if (name === 'diary') {
            const date = require('../../public/commons/world').clock(+now()).day;
            if (filter.date !== date) throw Object.assign(new Error('date'), { code: 241 });
            if (!row && rows.some(r => r.ownerId === filter.ownerId && r.date === filter.date)) throw Object.assign(new Error('duplicate'), { code: 11000 });
            if (!row && options.upsert) { row = { ...filter }; rows.push(row); }
            if (row) { row.text = update[0].$set.text.$cond[1].$literal; row.revision++; row.updatedAt = now(); }
          } else if (row) { Object.assign(row, update.$set); row.updatedAt = now(); }
          return row ? structuredClone(row) : null;
        });
        return { lean: () => promise, then: (a, b) => promise.then(a, b) };
      },
    }; models.set(name, output); return output;
  }
  const dashboard = createDashboardData({ model, now });
  const completeTask = createTaskCompletion({ Task: model('scheduleTask/Task'), deleteReminders: async () => 0 });
  const panels = createPanels({ dashboard, roleModel, model, diagnostics, now, completeTask, collectionStats: async () => ({ count: 42 }) });
  const diary = createDiary({ model: model('diary'), now: () => +now() });
  return { records, model, panels, diary, dashboard };
}
module.exports = { fixture };
