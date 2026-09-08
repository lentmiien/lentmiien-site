// Dashboard adapters never import database.js, controllers, workers or provider SDKs.
const { allows, SECTIONS } = require('./accountSurfacePolicy');
const { jobTypesFor } = require('./accountPreferencesService');
const logger = require('../utils/logger');
const DAY = 86400000;
const text = value => String(value ?? '').slice(0, 180);
function tokyoDay(now = new Date()) {
  const key = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10);
  const start = new Date(`${key}T00:00:00+09:00`);
  return { key, start, end: new Date(start.getTime() + DAY) };
}
function freshness(date, now, maxAge = 30 * 60000) {
  const age = date ? now.getTime() - new Date(date).getTime() : NaN;
  return !Number.isFinite(age) ? 'unavailable' : age > maxAge || age < -60000 ? 'stale' : 'ready';
}
const iso = date => date && Number.isFinite(new Date(date).getTime()) ? new Date(date).toISOString() : null;
const row = (title, detail, href, at) => ({ title: text(title), detail: text(detail), href, at: iso(at) });
function createDashboardData({ model = name => require(`../models/${name}`), now = () => new Date() } = {}) {
  const read = (name, filter, projection, sort = { updatedAt: -1, _id: -1 }, limit = 10) => model(name)
    .find(filter).select(projection).sort(sort).limit(limit).maxTimeMS(2000).setOptions({ sanitizeFilter: false }).lean().exec();
  const aggregate = (name, pipeline) => model(name).aggregate(pipeline).option({ maxTimeMS: 2000 }).exec();
  async function jobs(policy, filters) {
    const types = jobTypesFor(policy, filters.scope).filter(t => filters.types.includes(t));
    const sources = {
      ocr: ['ocr_job', '/ocr', 'OCR'], ocr_tts: ['ocr_tts_job', '/ocr-tts', 'OCR to TTS'],
      asr: ['asr_job', '/asr', 'Transcription'], gpt_image: ['gpt_image_generation', '/gpt-image', 'GPT Image'],
      trellis2: ['trellis2_job', '/trellis2', 'TRELLIS.2'], pixal3d: ['pixal3d_job', '/pixal3d', 'Pixal3D'],
      prompt_to_3d: ['prompt_to_3d_job', '/prompt-to-3d', 'Prompt to 3D'], music: ['music_generation', '/music', 'Music'],
      sora: ['sora_video', '/sora', 'Sora'], bulk: ['bulk_job', '/image_gen/bulk', 'ComfyUI bulk'],
    };
    const statuses = { queued: ['queued', 'Created'], running: ['processing', 'in_progress', 'generating_image', 'generating_model', 'Processing'],
      completed: ['completed', 'Completed'], failed: ['failed'], cancelled: ['cancelled', 'Canceled'] };
    const results = await Promise.allSettled(types.map(async type => {
      const [name, href, label] = sources[type]; const dateField = type === 'bulk' ? 'created_at' : 'createdAt';
      const filter = { [dateField]: { $gte: new Date(now().getTime() - filters.dateWindow * DAY) } };
      if (filters.scope === 'mine') filter[type === 'gpt_image' ? 'createdBy' : 'owner.id'] = type === 'gpt_image' ? policy.user.name : String(policy.user._id);
      else if (['trellis2', 'pixal3d'].includes(type)) filter.shared = true;
      const historical = ['gpt_image', 'music'].includes(type);
      if (filters.status !== 'all') {
        if (historical && filters.status !== 'completed') return [];
        if (!historical) filter.status = { $in: statuses[filters.status] || [] };
      }
      let entries;
      if (type === 'gpt_image') {
        entries = await aggregate(name, [{ $match: filter }, { $group: { _id: '$generationId', createdAt: { $max: '$createdAt' } } },
          { $sort: { createdAt: -1, _id: -1 } }, { $limit: 10 }]);
      } else entries = await read(name, filter, `${dateField} status`, { [dateField]: -1, _id: -1 }, 10);
      return entries.map(e => ({ ...row(label, `${filters.scope === 'mine' ? 'Mine' : type === 'bulk' ? 'Shared operations' : 'Shared library'} · ${historical ? 'Saved output' : e.status} · Open tool`, href, e[dateField]),
        key: `${type}:${e._id}`, source: type }));
    }));
    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed) logger.warning('Dashboard activity sources unavailable', { category: 'account_dashboard', metadata: { failedSources: failed } });
    return { state: failed ? 'stale' : undefined, rows: results.flatMap(r => r.status === 'fulfilled' ? r.value : [])
      .sort((a, b) => String(b.at).localeCompare(String(a.at)) || a.key.localeCompare(b.key)).slice(0, 10),
    note: `${failed ? 'Some sources could not be loaded. ' : ''}Up to 10 recent records. ASR and GPT Image are saved histories; Prompt to 3D history expires. Shared libraries are opt-in. Tool links open their history pages.` };
  }
  const adapters = {
    async tasks(policy) {
      const day = tokyoDay(now());
      const ownerFilter = { userId: policy.user.name, done: false, type: { $in: ['todo', 'tobuy'] } };
      const taskRead = (filter, limit) => read('scheduleTask/Task', { ...ownerFilter, ...filter }, 'title type start end', { end: 1, createdAt: 1, _id: 1 }, limit);
      const groups = await Promise.all([
        taskRead({ end: { $lt: day.start, $ne: null } }, 12),
        taskRead({ end: { $gte: day.start, $lt: day.end } }, 12),
        taskRead({ $or: [{ end: { $gte: day.end } }, { end: null }] }, 16),
      ]);
      const tasks = groups.flat();
      return { rows: tasks.map(t => ({ ...row(t.title, `${t.type === 'tobuy' ? 'Buy' : 'To do'} · ${t.end && new Date(t.end) < day.start ? 'Overdue' : t.end && new Date(t.end) < day.end ? 'Today' : 'Later / no deadline'}`, '/scheduleTask/upcoming', t.end),
        taskId: String(t._id), canComplete: policy.capabilities.includes('schedule.task.complete') || ['admin', 'family', 'user'].includes(policy.user.type_user) })), note: 'Up to 40 incomplete tasks. Hold for 0.9 seconds or use Complete.' };
    },
    async agenda(policy) {
      const day = tokyoDay(now());
      const entries = await read('scheduleTask/Task', { userId: policy.user.name, $or: [
        { type: 'presence', start: { $lt: day.end }, end: { $gt: day.start } },
        { type: { $in: ['todo', 'tobuy'] }, done: false, end: { $gte: day.start, $lt: day.end } },
      ] }, 'title type start end', { start: 1, _id: 1 }, 20);
      return { rows: entries.map(e => row(e.title, e.type === 'presence' ? 'Scheduled' : 'Due today', '/scheduleTask/calendar', e.type === 'presence' ? e.start : e.end)), note: 'Today in Asia/Tokyo, including events crossing midnight.' };
    },
    async cooking() {
      const entries = await read('CookingCalendarV2', { date: tokyoDay(now()).key }, { entries: { $slice: 12 } }, { date: -1 }, 1);
      const meals = entries[0]?.entries || [];
      const recipes = meals.length ? await read('chat4_knowledge', { _id: { $in: meals.map(m => m.recipeId) } }, 'title', { _id: 1 }, 12) : [];
      return { rows: meals.map(m => row(recipes.find(r => String(r._id) === String(m.recipeId))?.title || 'Scheduled recipe', m.category, '/cooking/v2')), note: 'Shared household cooking plan · Asia/Tokyo.' };
    },
    async chats(policy) {
      const chats = await read('conversation5', { members: policy.user.name }, 'title category updatedAt', { updatedAt: -1, _id: -1 }, 5);
      return { rows: chats.map(c => row(c.title || 'Untitled chat', c.category, `/chat5/chat/${encodeURIComponent(c._id)}`, c.updatedAt)), note: 'Conversations you belong to, including shared chats.' };
    },
    jobs,
    async ask() {
      const filter = { status: 'pending' };
      const [entries, count] = await Promise.all([read('human_tool_request', filter, 'variant createdAt', { createdAt: 1, _id: 1 }, 5), model('human_tool_request').countDocuments(filter).maxTimeMS(2000).exec()]);
      return { rows: entries.map(e => row(`${e.variant === 'codex' ? 'Codex' : 'General'} request`, 'Awaiting your response', '/admin/ask-lennart', e.createdAt)), note: `${count} pending · oldest first. Prompts stay in the inbox.` };
    },
    async codex() {
      const turns = await read('codex_turn', { status: { $in: ['queued', 'running'] } }, 'sessionId status startedAt queuedAt', { queuedAt: 1, _id: 1 }, 8);
      const sessions = turns.length ? await read('codex_session', { _id: { $in: turns.map(t => t.sessionId) } }, 'title', { _id: 1 }, 8) : [];
      return { rows: turns.map(t => row(sessions.find(s => s._id === t.sessionId)?.title || 'Codex session', t.status, '/codex', t.startedAt || t.queuedAt)), note: 'Admin operations · up to 8 queued/running turns.' };
    },
    async accounting(policy) {
      const href = policy.capabilities.includes('accounting') ? '/accounting' : '/budget';
      const day = tokyoDay(now()); const [year, month] = day.key.split('-').map(Number);
      const prior = new Date(Date.UTC(year, month - 2, 1));
      const begin = prior.getUTCFullYear() * 10000 + (prior.getUTCMonth() + 1) * 100 + 1;
      const current = year * 10000 + month * 100 + 1;
      const [accounts, transactions] = await Promise.all([
        read('account_db', {}, 'name currency balance balance_date', { _id: 1 }, 101),
        read('transaction_db', { date: { $gte: begin, $lte: Number(day.key.replaceAll('-', '')) } }, 'amount from_fee to_fee type from_account to_account date', { date: -1, _id: -1 }, 2001),
      ]);
      if (accounts.length > 100 || transactions.length > 2000) return { state: 'unavailable', rows: [], note: 'Summary limit reached. Open Accounting for complete figures.' };
      const totals = spendingByCurrency(transactions, accounts, current);
      return { rows: [...totals.map(t => row(`${t.currency} ${t.current.toFixed(2)} this month`, `Prior full month ${t.prior.toFixed(2)} · difference ${(t.current - t.prior).toFixed(2)}`, href)),
        ...accounts.slice(0, 5).map(a => row(a.name, `${a.currency} ${Number(a.balance).toFixed(2)} · recorded balance as of ${a.balance_date}`, href))],
      note: 'Budget ledger expenses including both fees, by payer currency. Prior full month comparison; transfers and credit-card ledgers excluded to avoid double counting. Balances are dated snapshots.' };
    },
    async life() {
      const entries = await read('my_life_log_entry', {}, 'type label value text timestamp', { timestamp: -1, _id: -1 }, 8);
      const reminders = await read('my_life_log_reminder', { enabled: true }, 'type label labelKey scheduleType intervalDays weekdays monthDates', { updatedAt: -1, _id: -1 }, 10);
      const latest = reminders.length ? await aggregate('my_life_log_entry', [
        { $match: { $or: reminders.map(r => ({ type: r.type, label: r.label })) } },
        { $group: { _id: { type: '$type', label: '$label' }, timestamp: { $max: '$timestamp' } } }, { $limit: 10 },
      ]) : [];
      const { buildDueReminder } = require('../utils/myLifeLogReminderRules');
      // Existing rules use local calendar getters. Supply Tokyo calendar dates
      // represented in the runtime's local zone so host TZ cannot shift a day.
      const calendarDate = date => { const [y, m, d] = tokyoDay(new Date(date)).key.split('-').map(Number); return new Date(y, m - 1, d, 12); };
      const due = reminders.map(reminder => {
        const last = latest.find(e => e._id.type === reminder.type && e._id.label === reminder.label);
        return buildDueReminder({ reminder, lastEntry: last ? { timestamp: calendarDate(last.timestamp) } : null, today: calendarDate(now()) });
      }).filter(Boolean);
      return { rows: entries.map(e => row(e.label || e.type, e.type === 'diary' ? e.text : e.value, '/admin/life_log', e.timestamp)), reminders: due,
        note: 'Recent entries and due reminders from up to 10 enabled schedules. Open the timeline for full history and reminder management.' };
    },
    async minute() {
      const deviceId = process.env.DASHBOARD_MINUTE_LOGGER_DEVICE_ID;
      const endpointPath = process.env.MINUTE_LOGGER_PATH;
      if (!deviceId || deviceId.length > 160 || !endpointPath || !endpointPath.startsWith('/')) return { state: 'unavailable', rows: [], note: 'A dashboard device must be configured by the site owner.' };
      const entries = await read('minute_logger_request', { deviceId, endpointPath }, 'battery active receivedAt', { receivedAt: -1, _id: -1 }, 1);
      const e = entries[0];
      return { state: freshness(e?.receivedAt, now(), 10 * 60000), rows: e ? [row('Configured device', `${e.battery == null ? 'Battery unknown' : `${e.battery}% battery`} · ${e.active ? 'Active at last report' : 'Inactive at last report'}`, '/admin/minute-logger', e.receivedAt)] : [], note: 'Last-known report; no location or endpoint details.' };
    },
    async runpod() {
      const pods = await read('runpod_pod', {}, 'name providerStatus lastProviderSyncAt', { lastProviderSyncAt: -1, _id: -1 }, 30);
      return { state: pods.length ? pods.some(p => freshness(p.lastProviderSyncAt, now()) !== 'ready') ? 'stale' : 'ready' : 'unavailable',
        rows: pods.map(p => row(p.name, `Tracked ${p.providerStatus === 'RUNNING' ? 'running' : p.providerStatus === 'EXITED' ? 'stopped' : 'other'} · ${p.providerStatus}`, '/admin/runpod', p.lastProviderSyncAt)), note: 'Up to 30 locally tracked pods. Actual provider status at last sync; no provider refresh.' };
    },
    async tapo() {
      const day = tokyoDay(now());
      const [daily, monthly] = await Promise.all([
        read('tapo_daily_consumption_snapshot', { dateKey: day.key }, 'deviceName deviceNameKey consumptionKwh currentPowerW lastReadingAt', { lastReadingAt: -1, _id: -1 }, 20),
        read('tapo_monthly_consumption_snapshot', { monthKey: day.key.slice(0, 7) }, 'deviceNameKey consumptionKwh', { lastReadingAt: -1, _id: -1 }, 20),
      ]);
      if (!daily.length) {
        const latest = await read('tapo_reading', {}, 'deviceName timestampUtc metrics.current_power', { timestampUtc: -1, _id: -1 }, 1);
        return { state: 'stale', rows: latest.map(e => row(e.deviceName, 'No energy snapshot for today', '/admin/tapo', e.timestampUtc)), note: 'Household energy data is missing for today.' };
      }
      return { state: daily.some(d => freshness(d.lastReadingAt, now()) !== 'ready') ? 'stale' : 'ready', rows: daily.map(d => {
        const month = monthly.find(m => m.deviceNameKey === d.deviceNameKey);
        return row(d.deviceName, `${d.currentPowerW ?? 'Unknown'} W · ${d.consumptionKwh} kWh today${month ? ` · ${month.consumptionKwh} kWh month` : ''}`, '/admin/tapo', d.lastReadingAt);
      }), note: 'Shared household · last-known snapshot values.' };
    },
    async disaster() {
      const { DASHBOARD_SCOPE_CHAIN, dashboardFilter } = require('../utils/accountDisasterFilters');
      let alerts = []; let scope = DASHBOARD_SCOPE_CHAIN[0];
      for (const candidate of DASHBOARD_SCOPE_CHAIN) {
        alerts = await read('disaster_alert', dashboardFilter(candidate, new Date(now().getTime() - DAY)), 'title severity reportAt', { severityScore: -1, reportAt: -1 }, 5);
        scope = candidate;
        if (alerts.length) break;
      }
      const [weather, ingestion] = await Promise.all([
        read('disaster_weather_snapshot', {}, 'locationName summary fetchedAt', { fetchedAt: -1 }, 1),
        read('disaster_ingestion_state', { key: 'default' }, 'lastSuccessAt lastErrorAt', { lastSuccessAt: -1 }, 1),
      ]);
      const state = freshness(ingestion[0]?.lastSuccessAt, now());
      return { state: state !== 'ready' || freshness(weather[0]?.fetchedAt, now(), 2 * 3600000) !== 'ready' ? 'stale' : 'ready',
        rows: [...alerts.map(a => row(a.title, `Stored alert · ${a.severity}`, '/admin/disasters', a.reportAt)), ...weather.map(w => row(w.locationName, w.summary || 'Latest stored weather', '/admin/disasters', w.fetchedAt))],
        note: `Latest stored regional feed (${scope}). ${alerts.length ? 'Up to 5 alerts from the last 24 hours.' : 'No recent stored alerts; this is not an all-clear.'} Ingestion last succeeded: ${iso(ingestion[0]?.lastSuccessAt) || 'unknown'}.` };
    },
    async stock() {
      const [categories, items, profiles] = await Promise.all([
        read('es_category', {}, '-purpose -whyItMatters -qualifies -doesNotQualify -examples -householdNote -source', { _id: 1 }, 201),
        read('es_item', { status: { $nin: ['consumed', 'discarded', 'replaced'] } }, '-notes -resolutionNote', { _id: 1 }, 2001),
        read('es_profile', { key: 'household' }, '-assumptions -recommendationSource', { _id: 1 }, 1),
      ]);
      if (!profiles.length || categories.length > 200 || items.length > 2000) return { state: 'unavailable', rows: [], note: 'Household profile missing or summary limit reached. Open Emergency Stock.' };
      const snapshot = require('./emergencyStockService').buildEmergencyStockSnapshot({ categories, items, profile: profiles[0], now: now() });
      return { rows: [row('Core coverage', snapshot.core.measurable ? `${snapshot.core.days} days · limiting: ${snapshot.core.limitingDomains.join(', ')}` : 'Not yet measurable', '/es/es_dashboard'),
        row('Stock attention', `${snapshot.rollingHealth.belowFloor} below floor · ${snapshot.rotationHealth.expired} expired · ${snapshot.rotationHealth.dueSoon} expiring soon`, '/es/es_dashboard'),
        row('Inspection', `${snapshot.durableHealth.inspectionDue} due · ${snapshot.monthlyReview.due} stock reviews due`, '/es/es_dashboard')], note: 'Shared household · calculated from local records without maintenance or synchronization.' };
    },
    async models() {
      // Reuse already initialized application caches without importing provider modules.
      const cached = [['OpenAI', '../utils/ChatGPT', 'GetOpenAIModels'], ['Anthropic', '../utils/anthropic', 'GetAnthropicModels']];
      const announcements = cached.flatMap(([provider, path, getter]) => {
        const loaded = require.cache[require.resolve(path)]?.exports;
        return (loaded?.[getter]?.() || []).filter(m => m.created * 1000 >= now().getTime() - 30 * DAY).slice(0, 40).map(m => ({ ...m, provider }));
      });
      const cards = announcements.length ? await read('ai_model_card', { api_model: { $in: announcements.map(m => m.model) } }, 'provider api_model', { _id: 1 }, 100) : [];
      return { state: announcements.length ? 'ready' : 'empty', rows: announcements.map(m => {
        const saved = cards.some(c => c.provider?.toLowerCase() === m.provider.toLowerCase() && c.api_model?.toLowerCase() === m.model.toLowerCase());
        return row(m.model, `${m.provider} · ${saved ? 'Saved' : 'Missing model card'}`, `/chat5/ai_model_cards?provider=${encodeURIComponent(m.provider)}&model=${encodeURIComponent(m.model)}`, new Date(m.created * 1000));
      }), note: 'Last 30 days from the application’s existing model caches. No provider refresh; empty may mean the cache is unavailable.' };
    },
    async gateway() { return require('./accountGatewayStatus').getStatus(); },
    async embedding() { return { rows: [], note: 'User-initiated search of a mixed personal corpus. Results can contain sensitive content.' }; },
  };
  async function load(id, policy, filters) {
    const section = SECTIONS.find(s => s.id === id);
    if (!section || !allows(policy, section)) { const error = new Error('Section unavailable.'); error.status = 403; throw error; }
    const result = await adapters[id](policy, filters);
    return { ...result, state: result.state || (result.rows.length ? 'ready' : 'empty'), fetchedAt: now().toISOString() };
  }
  return { load, read };
}
function spendingByCurrency(transactions, accounts, monthStart) {
  const currencies = new Map(accounts.map(a => [String(a._id), a.currency || 'Unknown currency']));
  const totals = new Map();
  for (const t of transactions) {
    const type = typeof t.type === 'string' && t.type.trim() ? t.type.trim().toLowerCase() : t.from_account === 'EXT' ? 'income' : t.to_account === 'EXT' ? 'expense' : 'saving';
    if (type !== 'expense') continue;
    const currency = currencies.get(t.from_account);
    if (!currency || currency === 'Unknown currency') throw new Error('Expense account currency unavailable');
    const value = Number(t.amount || 0) + Number(t.from_fee || 0) + Number(t.to_fee || 0);
    if (!Number.isFinite(value)) throw new Error('Invalid ledger amount');
    if (!totals.has(currency)) totals.set(currency, { currency, current: 0, prior: 0 });
    totals.get(currency)[t.date >= monthStart ? 'current' : 'prior'] += value;
  }
  return [...totals.values()];
}
module.exports = { createDashboardData, tokyoDay, freshness, spendingByCurrency };
