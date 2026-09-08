const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const User = require('../models/useraccount');
const { resolvePolicy, allows, SECTIONS, navigationFor } = require('../services/accountSurfacePolicy');
const preferences = require('../services/accountPreferencesService');
const { createDashboardData } = require('../services/accountDashboardData');
const { createSessionCsrf, PRIVATE_NO_STORE } = require('../middleware/sessionCsrf');
const { visualPayload } = require('../utils/accountLifeLogPayload');
const logger = require('../utils/logger');
const csrf = createSessionCsrf();
function createAccountDashboard({ roleModel = Role, userModel = User, data = createDashboardData() } = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': PRIVATE_NO_STORE, 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false;
    if (!req.isAuthenticated?.() || !req.user?._id) return res.status(401).json({ ok: false, error: 'Login required.' });
    next();
  });
  router.use(async (req, res, next) => {
    try {
      req.dashboardPolicy = await resolvePolicy(req.user, roleModel);
      if (!req.dashboardPolicy.capabilities.includes('dashboard.account.read')) return res.status(403).json({ ok: false, error: 'Account access unavailable.' });
      next();
    } catch (_) {
      logger.warning('Dashboard authorization lookup failed', { category: 'account_dashboard' });
      res.status(503).json({ ok: false, error: 'Account access unavailable.' });
    }
  });
  router.use(rateLimit({ windowMs: 60000, limit: 100, standardHeaders: 'draft-8', legacyHeaders: false,
    keyGenerator: req => String(req.user._id), message: { ok: false, error: 'Too many account requests. Try again shortly.' } }));
  router.use(csrf.issueToken);
  router.use(express.json({ limit: '40kb' }));
  const current = req => preferences.effective(req.dashboardPolicy, req.user.dashboard_settings);
  router.get('/', (req, res) => {
    const dashboard = current(req);
    // Usernames can be email addresses or opaque identifiers; never use them as a greeting.
    res.render('mypage', { pageTitle: 'My Account', dashboard, accountContext: req.dashboardPolicy.isAdmin ? 'Administrator account' : 'Personal account',
      accountDate: new Intl.DateTimeFormat('en', { timeZone: 'Asia/Tokyo', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()),
      navChoices: navigationFor(req.dashboardPolicy, req.user.navbar_settings || req.user.mypage_icon_settings),
      canCompleteMypageTask: true });
  });
  router.get('/api/settings', (req, res) => res.json({ ok: true, settings: current(req) }));
  router.post('/api/settings', csrf.requireToken, async (req, res) => {
    if (!req.dashboardPolicy.capabilities.includes('dashboard.preferences.write')) return res.status(403).json({ ok: false, error: 'Settings access unavailable.' });
    let settings;
    try { settings = preferences.saveSettings(req.body, req.user.dashboard_settings, req.dashboardPolicy); }
    catch (_) { return res.status(400).json({ ok: false, error: 'Invalid dashboard settings.' }); }
    try {
      const result = await userModel.updateOne({ _id: req.user._id }, { $set: { dashboard_settings: settings } });
      if (result.matchedCount === 0) throw new Error('Account missing');
      req.user.dashboard_settings = settings;
      res.json({ ok: true, settings: current(req) });
    } catch (_) {
      logger.warning('Dashboard preferences could not be saved', { category: 'account_dashboard' });
      res.status(503).json({ ok: false, error: 'Could not save settings. Try again.' });
    }
  });
  router.post('/icon-settings', csrf.requireToken, async (req, res) => {
    if (!req.dashboardPolicy.capabilities.includes('dashboard.preferences.write')) return res.status(403).json({ ok: false, error: 'Settings access unavailable.' });
    let settings;
    try { settings = preferences.saveNavigation(req.body, req.user.navbar_settings || req.user.mypage_icon_settings, req.dashboardPolicy); }
    catch (_) { return res.status(400).json({ ok: false, error: 'Invalid shortcut settings.' }); }
    try {
      const result = await userModel.updateOne({ _id: req.user._id }, { $set: { navbar_settings: settings } });
      if (result.matchedCount === 0) throw new Error('Account missing');
      req.user.navbar_settings = settings;
      const visible = navigationFor(req.dashboardPolicy, settings);
      res.json({ ok: true, settings: { order: visible.map(n => n.id), hidden: visible.filter(n => n.hidden).map(n => n.id) } });
    } catch (_) {
      logger.warning('Navbar preferences could not be saved', { category: 'account_dashboard' });
      res.status(503).json({ ok: false, error: 'Could not save shortcuts. Try again.' });
    }
  });
  router.get('/api/cards/:section', async (req, res) => {
    const section = SECTIONS.find(s => s.id === req.params.section);
    if (!section || !allows(req.dashboardPolicy, section)) return res.status(403).json({ ok: false, error: 'Section unavailable.' });
    if (Object.keys(req.query).length) return res.status(400).json({ ok: false, error: 'Unexpected card parameters.' });
    try { res.json({ ok: true, ...(await data.load(section.id, req.dashboardPolicy, current(req).jobs)) }); }
    catch (_) {
      logger.warning('Dashboard card could not be loaded', { category: 'account_dashboard', metadata: { section: section.id } });
      res.status(503).json({ ok: false, error: 'Could not load this section. Try again.' });
    }
  });
  const personal = (id, write = false) => (req, res, next) => {
    if (!allows(req.dashboardPolicy, SECTIONS.find(s => s.id === id)) || write && !req.dashboardPolicy.capabilities.includes('dashboard.personal.write')) return res.status(403).json({ ok: false, error: 'Section unavailable.' });
    next();
  };
  router.get('/api/life-panel', personal('life'), async (req, res) => {
    try {
      const summary = await data.load('life', req.dashboardPolicy);
      res.render('partials/account_life_log', { lifeLogSuggestions: { all: summary.rows.map(r => r.title) }, lifeLogReminders: summary.reminders, lifeLogReminderCount: summary.reminders.length, lifeLogPath: '/admin/life_log' });
    } catch (_) {
      logger.warning('Dashboard life log panel unavailable', { category: 'account_dashboard' });
      res.status(503).json({ ok: false, error: 'Life log unavailable.' });
    }
  });
  router.get('/api/life/entries', personal('life'), async (req, res) => {
    // The body-map follow-up panel only needs the last 48 hours of visual entries.
    try {
      const entries = await data.read('my_life_log_entry', { type: 'visual_log', timestamp: { $gte: new Date(Date.now() - 48 * 3600000) } }, 'type label value text v_log_data timestamp', { timestamp: -1 }, 100);
      const safeEntries = entries.flatMap(e => {
        try { return [{ ...e, v_log_data: visualPayload(e.v_log_data), id: String(e._id), isLegacy: false }]; } catch (_) { return []; }
      });
      if (safeEntries.length !== entries.length) logger.warning('Dashboard skipped invalid visual log records', { category: 'account_dashboard', metadata: { skipped: entries.length - safeEntries.length } });
      res.json({ entries: safeEntries });
    } catch (_) {
      logger.warning('Dashboard visual log read failed', { category: 'account_dashboard' });
      res.status(503).json({ error: 'Unable to load visual logs.' });
    }
  });
  router.post('/api/life/entry', personal('life', true), csrf.requireToken, async (req, res) => {
    const input = req.body;
    const fields = ['type', 'label', 'value', 'text', 'v_log_data', 'timestamp'];
    if (!input || Object.keys(input).some(k => !fields.includes(k)) || !['basic', 'medical', 'diary', 'visual_log'].includes(input.type)
      || fields.filter(k => k !== 'timestamp').some(k => input[k] !== undefined && typeof input[k] !== 'string')
      || (input.label || '').length > 160 || (input.value || '').length > 1000 || (input.text || '').length > 10000 || (input.v_log_data || '').length > 24000
      || ['basic', 'medical'].includes(input.type) && (!input.label?.trim() || !input.value?.trim())
      || input.type === 'diary' && !input.text?.trim() || input.type === 'visual_log' && !input.v_log_data) return res.status(400).json({ error: 'Invalid entry.' });
    if (input.timestamp !== undefined && (typeof input.timestamp !== 'string' || input.timestamp.length > 40)) return res.status(400).json({ error: 'Invalid timestamp.' });
    const timestamp = input.timestamp ? new Date(input.timestamp) : new Date();
    if (!Number.isFinite(timestamp.getTime())) return res.status(400).json({ error: 'Invalid timestamp.' });
    if (input.type === 'visual_log') { try { input.v_log_data = visualPayload(input.v_log_data); } catch (_) { return res.status(400).json({ error: 'Invalid visual log.' }); } }
    try {
      const entry = await require('../models/my_life_log_entry').create({
        type: input.type, label: input.label || (input.type === 'visual_log' ? 'body_map' : ''), timestamp,
        value: ['basic', 'medical'].includes(input.type) ? input.value : '',
        text: input.type === 'diary' ? input.text : '', v_log_data: input.type === 'visual_log' ? input.v_log_data : '',
      });
      res.json({ entry: { id: String(entry._id), type: entry.type, timestamp: entry.timestamp } });
    } catch (_) {
      logger.warning('Dashboard life log entry could not be saved', { category: 'account_dashboard' });
      res.status(503).json({ error: 'Unable to save entry.' });
    }
  });
  return router;
}
module.exports = { createAccountDashboard };
