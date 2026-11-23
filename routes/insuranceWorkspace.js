const express = require('express');
const { renderMarkdownSafe } = require('../utils/chat5Markdown');
const { z } = require('zod');
const service = require('../services/insuranceBatches');
const legacy = require('../services/insuranceLegacyNotes');
const { Plan } = require('../models/insurance_batch');
const User = require('../models/useraccount');
const { PAGE_SIZE, VaultError } = require('../services/documentVault/policy');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');

const id = z.string().regex(/^[a-f\d]{24}$/i).transform(s => s.toLowerCase());
const revision = z.string().regex(/^\d{1,9}$/).transform(Number);
const offset = revision.optional().default(0);
const notes = z.string().trim().max(6000);
const text = max => z.string().trim().max(max).default('');
const optionalDate = z.union([z.literal(''), z.iso.date()]).default('');
const planFields = z.object({
  ownerId: id, name: z.string().trim().min(1).max(160), company: z.string().trim().min(1).max(160),
  startDate: optionalDate, monthlyCost: z.string().regex(/^(?:\d{1,12}(?:\.\d{1,4})?)?$/).default(''),
  currency: z.string().regex(/^(?:[A-Za-z]{3})?$/).transform(s => s.toUpperCase()).default(''),
  number: text(160), clearNumber: z.literal('on').optional(), coverage: text(6000), instructions: text(6000),
  claimUrl: z.union([z.literal(''), z.url({ protocol: /^https$/ }).max(2000).refine(s => {
    if (!URL.canParse(s)) return false;
    const url = new URL(s);
    return !url.username && !url.password;
  })]).default(''), revision: revision.optional(),
}).strict();
const details = { planId: z.union([id, z.literal('')]), notes };
const attachment = { kind: z.enum(['invoice', 'support']), pageId: id };
const edit = z.discriminatedUnion('action', [
  { action: z.literal('details'), ...details, submittedOn: optionalDate },
  { action: z.literal('submit'), ...details, submittedOn: z.iso.date() },
  { action: z.literal('add'), ...attachment }, { action: z.literal('remove'), ...attachment },
  { action: z.literal('followUp'), notes }, { action: z.literal('discard') },
].map(shape => z.object({ revision, ...shape }).strict()));

function parse(schema, input) {
  const result = schema.safeParse(input);
  if (!result.success) throw new VaultError(422, 'Check the form fields and try again.');
  return result.data;
}
const work = 'insurance.batches.manage', read = 'insurance.plans.read', manage = 'insurance.plans.manage';
const bundles = { admin: [work, read, manage], family: [work, read] };
const cap = name => createRequireCapabilities({ capabilities: [name], roleCapabilityBundles: bundles });

module.exports = function workspace({ csrf, sendZip, limit }) {
  const router = express.Router();
  router.use(['/plans', '/finalize', '/legacy-notes'], (req, res, next) =>
    service.family(req.user) ? next() : next(new VaultError(403, 'Family access required.')));
  router.use('/plans', cap(read));
  router.use(['/finalize', '/legacy-notes'], cap(work));
  const post = [limit(60), express.urlencoded({ extended: false, limit: '96kb', parameterLimit: 32 }), csrf.requireToken,
    (req, res, next) => {
      if (!req.is('application/x-www-form-urlencoded') || !req.body) throw new VaultError(415, 'Submit the Insurance form to save changes.');
      delete req.body._csrf;
      next();
    }];
  const admin = [(req, res, next) => req.user.type_user === 'admin' ? next() : next(new VaultError(403, 'Administrator access required.')), cap(manage)];
  const render = (res, view, data) => res.render('insurance', { view, pageSize: PAGE_SIZE, renderMarkdownSafe, ...data });
  router.param('id', (req, res, next, value) => { parse(id, value); next(); });
  router.get('/plans', async (req, res) => {
    const start = parse(offset, req.query.offset);
    render(res, 'plans', { offset: start, rows: await service.planDirectory(start) });
  });
  router.get('/plans/new', ...admin, async (req, res) => render(res, 'plan-edit', {
    plan: {}, owners: await User.find(service.accounts).select('_id name').sort({ name: 1 }).lean(),
  }));
  router.get('/plans/:id', async (req, res) => {
    const plan = await service.planDetail(req.params.id);
    render(res, 'plan', { plan, ownerName: (await User.findById(plan.ownerId).select('name').lean())?.name });
  });
  router.get('/plans/:id/edit', ...admin, async (req, res) => {
    const plan = await service.planDetail(req.params.id);
    render(res, 'plan-edit', { plan, owners: await User.find(service.accounts).select('_id name').sort({ name: 1 }).lean() });
  });
  router.get('/plans/:id/number', limit(30), async (req, res) => {
    const plan = await service.planDetail(req.params.id, true);
    render(res, 'number', { title: plan.name, number: plan.number, back: '/insurance/plans/' + plan._id });
  });
  router.post(['/plans', '/plans/:id'], ...admin, ...post, async (req, res) => {
    const body = parse(planFields, req.body);
    if (req.params.id && body.revision == null) throw new VaultError(422, 'Missing plan revision.');
    const plan = await service.savePlan(req.params.id, body);
    res.redirect(303, '/insurance/plans/' + plan._id);
  });
  router.get('/finalize', async (req, res) => {
    const start = parse(offset, req.query.offset);
    render(res, 'drafts', { rows: await service.drafts(req.user._id, start), offset: start });
  });
  router.post('/finalize', ...post, async (req, res) => {
    const { ids } = parse(z.object({ ids: z.union([id, z.array(id).min(1).max(PAGE_SIZE)]) }).strict(), req.body);
    const batch = await service.createDraft(req.user._id, [...new Set([ids].flat())]);
    res.redirect(303, '/insurance/finalize/' + batch._id);
  });
  router.get('/finalize/:id', async (req, res) => {
    const batch = await service.getBatch(req.user._id, req.params.id);
    const { kind, q, offset: start, planOffset } = parse(z.object({ kind: z.enum(['invoice', 'support']).default('invoice'),
      q: text(160), offset, planOffset: offset }).strict(), req.query);
    const draft = batch.status === 'draft';
    const [owner, choices, plans, selected] = await Promise.all([
      User.findById(batch.ownerId).select('name').lean(),
      draft ? service.picker(req.user._id, batch, kind, q, start) : [],
      draft ? Plan.find({ ownerId: batch.ownerId }).sort({ name: 1, _id: 1 }).skip(planOffset).limit(PAGE_SIZE + 1).select('name company').lean() : [],
      draft && batch.planId ? Plan.findOne({ _id: batch.planId, ownerId: batch.ownerId }).lean() : batch.plan,
    ]);
    render(res, 'workspace', { batch, ownerName: owner?.name, choices, plans, selected, kind, q, offset: start, planOffset });
  });
  router.get('/finalize/:id/number', limit(30), async (req, res) => {
    const batch = await service.getBatch(req.user._id, req.params.id, true);
    if (batch.status !== 'submitted') throw new VaultError(404, 'Submitted plan unavailable.');
    render(res, 'number', { title: batch.plan.name, number: batch.plan.number, back: '/insurance/finalize/' + batch._id });
  });
  router.get('/finalize/:id/scans.zip', limit(8), async (req, res) => {
    const batch = await service.getBatch(req.user._id, req.params.id);
    const ids = [...batch.invoiceIds, ...batch.supportingIds];
    if (!ids.length) throw new VaultError(404, 'This batch has no scans.');
    await sendZip(req, res, ids.map(_id => ({ _id })), 'insurance-' + batch._id + '.zip');
  });
  router.post('/finalize/:id', ...post, async (req, res) => {
    const body = parse(edit, req.body);
    await service.edit(req.user._id, req.params.id, body);
    res.redirect(303, body.action === 'discard' ? '/insurance/finalize' : '/insurance/finalize/' + req.params.id);
  });
  router.post('/legacy-notes', ...post, async (req, res) => {
    const body = parse(z.object({ owner: id, date: z.iso.date(), revision, notes }).strict(), req.body);
    await legacy.save(req.user._id, body.owner, body.date, body.revision, body.notes);
    res.redirect(303, '/insurance/batch?owner=' + body.owner + '&date=' + body.date);
  });
  return router;
};
