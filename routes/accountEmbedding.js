const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const { resolvePolicy, allows, SECTIONS } = require('../services/accountSurfacePolicy');
const { createSessionCsrf, PRIVATE_NO_STORE } = require('../middleware/sessionCsrf');
const logger = require('../utils/logger');
const csrf = createSessionCsrf();
const router = express.Router();
const types = [{ value: 'default', label: 'Fast' }, { value: 'high_quality', label: 'High quality' }, { value: 'combined', label: 'Combined reranking' }];
let active = 0;
router.use(async (req, res, next) => {
  res.set('Cache-Control', PRIVATE_NO_STORE); res.locals.gtag = false;
  if (!req.isAuthenticated?.()) return res.status(401).json({ error: 'Login required.' });
  try {
    const policy = await resolvePolicy(req.user, Role);
    if (!allows(policy, SECTIONS.find(s => s.id === 'embedding')) || !policy.capabilities.includes('dashboard.embedding.search')) return res.status(403).json({ error: 'Search unavailable.' });
    next();
  } catch (_) {
    logger.warning('Dashboard embedding authorization unavailable', { category: 'account_dashboard' });
    res.status(503).json({ error: 'Search unavailable.' });
  }
});
router.use(csrf.issueToken);
router.use(rateLimit({ windowMs: 60000, limit: 6, keyGenerator: req => String(req.user._id), standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Please wait before searching again.' } }));
const render = (res, form = {}, result = null, error = null) => res.render('embedding_search', {
  searchForm: form, searchResult: result, searchError: error, searchTypes: types,
  searchTypeLabels: Object.fromEntries(types.map(t => [t.value, t.label])), searchLimits: { defaultTopK: 10, maxTopK: 50 },
});
router.get('/', (req, res) => render(res));
router.post('/', csrf.requireToken, async (req, res) => {
  const body = req.body || {};
  const form = { query: body.search_text, searchType: body.search_type || 'default', topK: Number(body.top_k || 10), startDate: body.start_date || '', endDate: body.end_date || '' };
  const permitted = ['_csrf', 'search_text', 'search_type', 'top_k', 'start_date', 'end_date'];
  if (Object.keys(body).some(k => !permitted.includes(k)) || typeof form.query !== 'string' || !form.query.trim() || form.query.length > 2000
    || !types.some(t => t.value === form.searchType) || !Number.isInteger(form.topK) || form.topK < 1 || form.topK > 50) return render(res.status(400), {}, null, 'Invalid search options.');
  const dateRange = {};
  for (const [key, value] of [['start', form.startDate], ['end', form.endDate]]) {
    if (!value) continue;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) return render(res.status(400), form, null, 'Invalid date range.');
    dateRange[key] = new Date(`${value}T${key === 'start' ? '00:00:00' : '23:59:59.999'}Z`);
  }
  if (dateRange.start && dateRange.end && dateRange.start > dateRange.end) return render(res.status(400), form, null, 'Start date must precede end date.');
  if (active >= 2) return render(res.status(429), form, null, 'Search is busy. Try again shortly.');
  active++;
  try {
    const service = require('../services/accountEmbeddingAdapter').createAccountEmbeddingAdapter();
    const method = { default: 'similaritySearch', high_quality: 'similaritySearchHighQuality', combined: 'combinedSimilaritySearch' }[form.searchType];
    const result = await service[method](form.query, { topK: form.topK, dateRange });
    // Provider configuration never belongs in the browser response.
    const { apiBase, ...safeResult } = result;
    render(res, form, safeResult);
  } catch (_) {
    logger.warning('Dashboard embedding search failed', { category: 'account_dashboard' });
    render(res.status(503), form, null, 'Search could not be completed. Try again.');
  } finally { active--; }
});
module.exports = router;
