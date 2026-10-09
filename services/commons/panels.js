const { createDashboardData } = require('../accountDashboardData');
const { resolvePolicy } = require('../accountSurfacePolicy');
const { buildEmergencyStockSnapshot } = require('../emergencyStockService');
const { CommonsError } = require('./room');
const logger = require('../../utils/logger');
const percentage = (current, target, known = true) => known && Number.isFinite(current) && Number.isFinite(target) && target > 0
  ? Math.round(current / target * 1000) / 10 : null;
function stockPanel(snapshot) {
  const rows = Object.values(snapshot.domains).map(d => ({ id: d.id, title: d.label, current: d.measurable ? d.currentAmount : null,
    target: d.targetAmount, unit: d.unit, percent: percentage(d.currentAmount, d.targetAmount, d.measurable), status: d.status }));
  rows.push(...snapshot.categories.filter(c => !c.targetManagedAtDomain).map(c => ({
    id: c.id, title: String(c.name).slice(0, 180), current: c.applicable ? c.managementMode === 'durable' ? c.readyItemCount : c.stock : null,
    target: c.target, unit: String(c.unit).slice(0, 40), percent: percentage(c.managementMode === 'durable' ? c.readyItemCount : c.stock, c.target, c.applicable), status: c.health,
  })));
  return { rows, fetchedAt: new Date(snapshot.generatedAt).toISOString(),
    note: `Shared household · active ${snapshot.milestone.targetDays}-day milestone. Food is meal capacity, water litres; equipment counts only inspection-ready stock. Ratios are uncapped; no target or unknown readiness is shown as —.`,
    attention: { expired: snapshot.rotationHealth.expired, dueSoon: snapshot.rotationHealth.dueSoon, inspectionDue: snapshot.durableHealth.inspectionDue,
      reviewDue: snapshot.monthlyReview.due }, source: '/es/es_dashboard' };
}
const metricSources = [
  ['conversation5', 'Chat5 conversations'], ['chat5', 'Chat5 messages'],
  ['chat4_knowledge', 'Knowledge records'], ['gpt_image_generation', 'Saved GPT images'], ['music_generation', 'Saved music outputs'],
];
function createPanels({ dashboard = createDashboardData(), roleModel = require('../../models/role'),
  model = name => require(`../../models/${name}`), diagnostics = require('./runtime').diagnostics,
  collectionStats = require('../databaseUsageService').fetchSelectedCollectionStats, now = () => new Date(),
  completeTask = require('../scheduleTaskCompletion').createTaskCompletion() } = {}) {
  return {
    quests: user => resolvePolicy(user, roleModel).then(policy => dashboard.load('tasks', policy)),
    async complete(user, input) {
      if (!input || Object.keys(input).length !== 1 || typeof input.taskId !== 'string' || !/^[a-f\d]{24}$/i.test(input.taskId)) throw new CommonsError('INVALID_INPUT');
      const result = await completeTask(user, input.taskId);
      if (!result) throw new CommonsError('TASK_GONE');
      return result;
    },
    diagnostics: () => ({ ...diagnostics(), fetchedAt: now().toISOString(), note: 'Current worker, local in-memory health; last successful Mongo checkpoint timestamp. No player identities.' }),
    async statistics() {
      const rows = await Promise.all(metricSources.map(async ([name, title]) => {
        try {
          const result = await collectionStats(model(name).collection.name);
          return { title, value: result.count, unit: 'records', state: 'ready' };
        } catch (_) {
          logger.warning('Commons Site statistic unavailable', { category: 'commons.statistics', metadata: { source: name } });
          return { title, value: null, unit: 'records', state: 'unavailable' };
        }
      }));
      return { rows, fetchedAt: now().toISOString(), source: '/admin/database_usage',
        note: 'Database Usage collection statistics · all retained records at read time (not unique users or jobs). No time-window filter. Refresh reads again; unavailable is not zero.' };
    },
    async stock() {
      const read = (name, filter, projection, limit) => model(name).find(filter).select(projection).sort({ _id: 1 }).limit(limit).maxTimeMS(2000).lean();
      const [categories, items, profiles] = await Promise.all([
        read('es_category', {}, '-purpose -whyItMatters -qualifies -doesNotQualify -examples -householdNote -source', 201),
        read('es_item', {}, '-notes -resolutionNote', 2001), read('es_profile', { key: 'household' }, '-assumptions -recommendationSource', 1),
      ]);
      if (!profiles.length || categories.length > 200 || items.length > 2000) throw new CommonsError('SUMMARY_UNAVAILABLE');
      return stockPanel(buildEmergencyStockSnapshot({ categories, items, profile: profiles[0], now: now() }));
    },
  };
}
module.exports = { createPanels, stockPanel, percentage, metricSources };
