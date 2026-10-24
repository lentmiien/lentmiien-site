const { SECTIONS, allows, canCloseAccounts } = require('./accountSurfacePolicy');
const { createDashboardData } = require('./accountDashboardData');
const { tokyoDay } = require('../utils/scheduleTaskDates');
const { buildDueReminder } = require('../utils/myLifeLogReminderRules');
const accountBalances = require('../utils/accountBalances');
const logger = require('../utils/logger');

const PREVIEW_LIMIT = 2;
const HOUR = 3600000;
const OVERVIEW_SECTIONS = [
  ['tasks', 'Next 24 hours', 'No deadlines in the next 24 hours.'],
  ['cooking', 'Scheduled today', 'Nothing planned for today.'],
  ['life', 'Due reminders', 'No reminders due.'],
  ['accounting', 'Finalize last month', 'No accounts need finalizing.'],
  ['ask', 'Awaiting your response', 'No pending requests.'],
  ['codex', 'Running & queued sessions', 'No active sessions.'],
  ['chats', 'Active in the last 6 hours', 'No chats in the last 6 hours.'],
].map(([id, subtitle, emptyText]) => {
  const section = SECTIONS.find(s => s.id === id);
  return { id, title: section.title, href: id === 'accounting' ? '/accounting/close-month/' : section.href, subtitle, emptyText };
});

function overviewSections(policy) {
  return OVERVIEW_SECTIONS.filter(section => allows(policy, SECTIONS.find(s => s.id === section.id))
    && (section.id !== 'accounting' || canCloseAccounts(policy))).map(section => ({ ...section,
    href: section.id === 'accounting' && !policy.capabilities.includes('accounting') ? '/budget/close-month/' : section.href,
  }));
}

const text = value => String(value ?? '').slice(0, 180);
const row = (title, detail, href, at = null) => ({ title: text(title), detail: text(detail), href,
  at: at && Number.isFinite(new Date(at).getTime()) ? new Date(at).toISOString() : null });

function createAccountOverviewData({ model = name => require(`../models/${name}`), now = () => new Date(), data = createDashboardData({ model, now }) } = {}) {
  const aggregate = (name, pipeline) => model(name).aggregate(pipeline).option({ maxTimeMS: 2000, allowDiskUse: false }).exec();
  const facet = projection => ({ $facet: {
    rows: [{ $limit: PREVIEW_LIMIT }, { $project: projection }], total: [{ $count: 'value' }],
  } });
  const unpack = result => ({ rows: result[0]?.rows || [], count: result[0]?.total[0]?.value || 0 });
  const summary = async (name, filter, projection, sort) => unpack(await aggregate(name, [
    { $match: filter }, { $sort: sort }, facet(projection),
  ]));
  const preview = rows => ({ rows: rows.slice(0, PREVIEW_LIMIT), count: rows.length });

  const sources = {
    async tasks(policy, instant) {
      const result = await summary('scheduleTask/Task', {
        userId: policy.user.name, done: false, type: { $in: ['todo', 'tobuy'] },
        $or: [{ start: null }, { start: { $lte: instant } }],
        end: { $gte: instant, $lte: new Date(instant.getTime() + 24 * HOUR) },
      }, { title: 1, type: 1, end: 1 }, { end: 1, _id: 1 });
      return { ...result, rows: result.rows.map(t => row(t.title, t.type === 'tobuy' ? 'Buy' : 'To do', '/scheduleTask/upcoming', t.end)) };
    },
    async cooking(policy) {
      const result = await data.load('cooking', policy);
      return { ...preview(result.rows), countIsLowerBound: result.rows.length === 12 };
    },
    async life(_policy, instant) {
      const reminders = await data.read('my_life_log_reminder', { enabled: true },
        'type label scheduleType intervalDays weekdays monthDates', { _id: 1 }, 101);
      if (reminders.length > 100) throw new Error('Reminder summary limit reached');
      const latest = reminders.length ? await aggregate('my_life_log_entry', [
        { $match: { timestamp: { $lte: instant }, $or: reminders.map(r => ({ type: r.type, label: r.label })) } },
        { $group: { _id: { type: '$type', label: '$label' }, timestamp: { $max: '$timestamp' } } }, { $limit: 100 },
      ]) : [];
      // The shared rules use local calendar getters; represent Tokyo days at local noon.
      const calendarDate = date => {
        const [year, month, day] = tokyoDay(new Date(date)).key.split('-').map(Number);
        return new Date(year, month - 1, day, 12);
      };
      const due = reminders.map(reminder => {
        const last = latest.find(e => e._id.type === reminder.type && e._id.label === reminder.label);
        return buildDueReminder({ reminder, lastEntry: last ? { timestamp: calendarDate(last.timestamp) } : null, today: calendarDate(instant) });
      }).filter(Boolean).sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
      return preview(due.map(r => row(r.label, `${r.typeLabel} · ${r.statusLabel}`, '/admin/life_log')));
    },
    async accounting(policy, instant) {
      const dates = accountBalances.period(instant);
      const accounts = await data.read('account_db', {}, 'name balance_date', { name: 1, _id: 1 }, 101);
      if (accounts.length > 100) throw new Error('Account summary limit reached');
      const href = policy.capabilities.includes('accounting') ? '/accounting/close-month/' : '/budget/close-month/';
      const [year, monthNumber] = tokyoDay(instant).key.split('-').map(Number);
      const month = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', month: 'long', year: 'numeric' })
        .format(new Date(Date.UTC(year, monthNumber - 2, 1)));
      return preview(accounts.filter(a => accountBalances.eligible(a, dates))
        .map(a => row(a.name, `Finalize ${month}`, `${href}#account-${encodeURIComponent(String(a._id))}`)));
    },
    async ask() {
      const result = await summary('human_tool_request', { status: 'pending' }, { variant: 1, createdAt: 1 }, { createdAt: 1, _id: 1 });
      return { ...result, rows: result.rows.map(r => row(r.variant === 'codex' ? 'Codex request' : 'General request', 'Pending', '/admin/ask-lennart', r.createdAt)) };
    },
    async codex() {
      const result = unpack(await aggregate('codex_turn', [
        { $match: { status: { $in: ['queued', 'running'] } } },
        { $sort: { status: -1, queuedAt: 1, _id: 1 } },
        { $group: { _id: '$sessionId', status: { $first: '$status' }, at: { $first: { $ifNull: ['$startedAt', '$queuedAt'] } } } },
        { $sort: { status: -1, at: 1, _id: 1 } }, facet({ status: 1, at: 1 }),
      ]));
      const sessions = result.rows.length ? await data.read('codex_session', { _id: { $in: result.rows.map(r => r._id) } }, 'title', { _id: 1 }, PREVIEW_LIMIT) : [];
      return { ...result, rows: result.rows.map(r => row(sessions.find(s => String(s._id) === String(r._id))?.title || 'Codex session',
        r.status === 'running' ? 'Running' : 'Queued', `/codex/sessions/${encodeURIComponent(String(r._id))}`, r.at)) };
    },
    async chats(policy, instant) {
      const result = await summary('conversation5', { members: policy.user.name,
        updatedAt: { $gte: new Date(instant.getTime() - 6 * HOUR), $lte: instant },
      }, { title: 1, updatedAt: 1 }, { updatedAt: -1, _id: -1 });
      return { ...result, rows: result.rows.map(c => row(c.title || 'Untitled chat', '', `/chat5/chat/${encodeURIComponent(String(c._id))}`, c.updatedAt)) };
    },
  };

  async function load(policy) {
    if (!policy.user || !policy.capabilities.includes('dashboard.account.read')) {
      const error = new Error('Overview unavailable'); error.status = 403; throw error;
    }
    const instant = now();
    const sections = overviewSections(policy);
    const groups = [];
    // Keep source work bounded, preserving the fixed presentation order.
    for (let offset = 0; offset < sections.length; offset += 4) {
      const batch = sections.slice(offset, offset + 4);
      const results = await Promise.allSettled(batch.map(section => sources[section.id](policy, instant)));
      results.forEach((result, index) => {
        const id = batch[index].id;
        if (result.status === 'fulfilled') {
          groups.push({ id, ...result.value, state: result.value.count ? 'ready' : 'empty' });
        } else {
          logger.warning('Account overview source unavailable', { category: 'account_dashboard', metadata: { section: id } });
          groups.push({ id, state: 'unavailable', rows: [], count: null });
        }
      });
    }
    return { groups, fetchedAt: instant.toISOString() };
  }
  return { load };
}

module.exports = { createAccountOverviewData, overviewSections, OVERVIEW_SECTIONS, PREVIEW_LIMIT };
