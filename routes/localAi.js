const express = require('express');
const { rateLimit } = require('express-rate-limit');
const Role = require('../models/role');
const { createRequireCapabilities } = require('../middleware/requireCapabilities');
const { createSessionCsrf } = require('../middleware/sessionCsrf');
const { createDatabaseReadinessMiddleware } = require('../middleware/databaseReadiness');
const { CAP, BUNDLES, problem } = require('../services/localAi/policy');
const { config } = require('../services/localAi/gateway');
const { publicJob } = require('../services/localAi/service');
const { descriptor: inputDescriptor } = require('../services/localAi/inputs');
const inputStorage = require('../services/localAi/inputStorage');
const { createInputUpload } = require('../middleware/localAiInputUpload');
const { readImage } = require('../services/localAi/artifacts');
const logger = require('../utils/logger');
function createRouter({ service, worker }, { machine = false } = {}) {
  const router = express.Router();
  const csrf = createSessionCsrf();
  router.use((req, res, next) => {
    res.set({ 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' });
    res.locals.gtag = false; next();
  });
  router.use(createDatabaseReadinessMiddleware());
  router.use(async (req, res, next) => {
    try {
      if (machine) {
        req.localAiActor = await service.authenticate(req.get('authorization')?.replace(/^Bearer /, ''));
      } else {
        if (!req.isAuthenticated?.()) throw problem('unauthorized', 401);
        const user = await service.principal(String(req.user._id));
        req.user = user; req.localAiActor = { ownerId: String(user._id), user };
      }
      next();
    } catch (error) { next(error); }
  });
  if (!machine) router.use(createRequireCapabilities({ capabilities: [CAP.use], roleModel: Role, roleCapabilityBundles: BUNDLES }));
  router.use(rateLimit({ windowMs: 60000, limit: 120, keyGenerator: req => req.localAiActor.tokenId || req.localAiActor.ownerId, standardHeaders: true, legacyHeaders: false }));
  router.use(express.json({ limit: '256kb' }));
  if (!machine) {
    router.use(express.urlencoded({ extended: false, limit: '4kb' }));
    router.use(csrf.issueToken);
    router.use((req, res, next) => ['GET', 'HEAD'].includes(req.method) ? next() : csrf.requireToken(req, res, next));
  }
  const api = machine ? '' : '/api/v1';
  const sessionStatus = async control => control?.activeSession
    ? require('../services/localAi/sessions').publicSession(await service.db.Session.findById(control.activeSession).lean())
    : control?.lastSession || null;
  const serialize = (job, control) => ({ ...publicJob(job, control), artifacts: publicJob(job, control).artifacts.map(a => ({ ...a, url: `${machine ? '/api/local-ai/v1' : '/local-ai/api/v1'}/jobs/${job._id}/outputs/${a.slot}` })), result_url: `${machine ? '/api/local-ai/v1' : '/local-ai/api/v1'}/jobs/${job._id}/result` });
  const wrap = fn => async (req, res, next) => { try { await fn(req, res); } catch (error) { next(error); } };
  router.get(`${api}/workflows`, wrap(async (req, res) => res.json(await service.workflows.catalog())));
  router.get(`${api}/workflows/:id/versions/:hash`, wrap(async (req, res) => res.json(await service.workflows.policy(req.params.id, req.params.hash))));
  router.get(`${api}/inputs`, wrap(async (req, res) => {
    const records = await service.db.Input.find({ ownerId: req.localAiActor.ownerId, state: 'ready' }).sort({ createdAt: -1 }).limit(128).lean();
    res.json({ inputs: records.map(inputDescriptor) });
  }));
  router.post(`${api}/inputs`, createInputUpload(service), wrap(async (req, res) => {
    res.status(201).json(inputDescriptor(req.localAiInput));
  }));
  router.post(`${api}/inputs/import`, wrap(async (req, res) => {
    res.status(201).json(inputDescriptor(await service.inputs.importShared(req.localAiActor, req.get('Idempotency-Key'), req.body)));
  }));
  router.get(`${api}/inputs/by-key/:key`, wrap(async (req, res) => res.json(inputDescriptor(await service.inputs.lookup(req.localAiActor, null, req.params.key)))));
  router.get(`${api}/inputs/:id`, wrap(async (req, res) => res.json(inputDescriptor(await service.inputs.lookup(req.localAiActor, req.params.id)))));
  router.get(`${api}/inputs/:id/content`, wrap(async (req, res) => {
    const record = await service.inputs.lookup(req.localAiActor, req.params.id, null, { verifyBytes: false });
    if (record.state !== 'ready') throw problem('input_not_ready', 409);
    await service.inputs.resolve(req.localAiActor, { artifact_id: record._id, sha256: record.descriptor.sha256 }, { verifyBytes: false });
    await require('../services/localAi/privateDelivery').readAndDeliver(req, res, () => inputStorage.read(record._id, record.descriptor), record.descriptor);
  }));
  router.post(`${api}/jobs`, wrap(async (req, res) => {
    const job = await service.submit(req.localAiActor, req.get('Idempotency-Key'), req.body);
    const location = `${machine ? '/api/local-ai/v1' : '/local-ai/api/v1'}/jobs/${job._id}`;
    res.status(202).set('Location', location).json(serialize(job));
  }));
  router.get(`${api}/jobs`, wrap(async (req, res) => {
    const offset = Number(req.query.offset || 0);
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000) throw problem('invalid_offset');
    const jobs = await service.db.Job.find({ ownerId: req.localAiActor.ownerId }).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(50).lean();
    const control = await service.db.Control.findById('scheduler').lean();
    res.json({ session: await sessionStatus(control), jobs: jobs.map(job => serialize(job, control)), next_offset: jobs.length === 50 ? offset + 50 : null });
  }));
  router.get(`${api}/jobs/:id`, wrap(async (req, res) => res.json(serialize(await service.get(req.localAiActor, req.params.id), await service.db.Control.findById('scheduler').lean()))));
  router.get(`${api}/jobs/:id/result`, wrap(async (req, res) => {
    const job = await service.get(req.localAiActor, req.params.id);
    if (!job.published) throw problem('result_not_published', 409);
    if (job.result?.artifactId) res.type('png').set('X-Content-Type-Options', 'nosniff').send(await readImage(job.result));
    else if (job.result?.artifacts) res.json({ ...job.result, artifacts: job.result.artifacts.map(a => ({ ...a, url: `${machine ? '/api/local-ai/v1' : '/local-ai/api/v1'}/jobs/${job._id}/outputs/${a.slot}` })) });
    else res.json({ text: job.result.text, thinking: job.result.thinking || null });
  }));
  router.get(`${api}/jobs/:id/outputs/:slot`, wrap(async (req, res) => {
    const job = await service.get(req.localAiActor, req.params.id);
    if (!job.published || !/^(0|[1-9]\d?)$/.test(req.params.slot)) throw problem('not_found', 404);
    const artifact = job.result?.artifacts?.find(a => a.slot === Number(req.params.slot));
    if (!artifact) throw problem('not_found', 404);
    await require('../services/localAi/privateDelivery').readAndDeliver(req, res, () => require('../services/localAi/outputs').read(artifact), artifact);
  }));
  for (const action of ['cancel', 'retry']) router.post(`${api}/jobs/:id/${action}`, wrap(async (req, res) => res.json(serialize(await service[action](req.localAiActor, req.params.id)))));
  if (!machine) {
    router.get('/queue', wrap(async (req, res) => {
      const jobs = await service.db.Job.find({ ownerId: req.localAiActor.ownerId }).sort({ createdAt: -1 }).limit(100).lean();
      const control = await service.db.Control.findById('scheduler').lean();
      res.render('local_ai_queue', { jobs: jobs.map(job => publicJob(job, control)), job: null, session: await sessionStatus(control), config: { enabled: config().enabled, auto: config().auto } });
    }));
    router.get('/queue/:id', wrap(async (req, res) => {
      const job = await service.get(req.localAiActor, req.params.id);
      res.render('local_ai_queue', { session: await sessionStatus(await service.db.Control.findById('scheduler').lean()), jobs: [], job: { ...publicJob(job, await service.db.Control.findById('scheduler').lean()), request: job.request, result: job.published ? job.result : null }, config: { enabled: config().enabled, auto: config().auto } });
    }));
    router.get('/api/v1/config', wrap(async (req, res) => {
      let workflowEnabled = false, workflowReason = null;
      if (config().media) {
        try { await service.workflows.negotiate(); workflowEnabled = true; }
        catch (error) { workflowReason = error.code || 'gateway_workflows_unavailable'; }
      }
      res.json({ enabled: config().enabled, mediaEnabled: config().media, workflowEnabled, workflowReason,
        ownerId: req.localAiActor.ownerId, csrfToken: res.locals.csrfToken,
        canImportShared: await require('../utils/authorization').hasCapabilities(req.localAiActor.user, [CAP.importShared], { roleModel: Role, roleCapabilityBundles: BUNDLES }),
        supported: ['llm.chat', 'chat5.response', 'comfy.image', ...(workflowEnabled ? ['comfy.workflow'] : [])], image_workflow: 'qwen-image-2.1-t2i-v1' });
    }));
    const admin = createRequireCapabilities({ capabilities: [CAP.manage], roleModel: Role, roleCapabilityBundles: BUNDLES });
    router.get('/api/v1/scheduler', admin, wrap(async (req, res) => {
      const control = await service.db.Control.findById('scheduler').lean();
      const run = control?.activeRun ? await service.db.Run.findById(control.activeRun).lean() : null;
      const activities = await service.gateway.request('GET', '/batch/activities').catch(() => ({ error: 'gateway_unreachable' }));
      const rows = await service.db.Job.aggregate([{ $match: { slot: { $type: 'number' } } }, { $group: {
        _id: '$state', count: { $sum: 1 }, blocked: { $sum: { $cond: [{ $or: [
          { $eq: ['$state', 'needs_review'] }, { $eq: ['$reason', 'cohort_preparation_blocked'] }, { $gt: ['$blockedUntil', new Date()] },
        ] }, 1, 0] } }, eligible: { $sum: { $cond: [{ $and: [
          { $eq: ['$state', 'queued'] }, { $eq: ['$runId', null] },
          ...(!config().media ? [{ $ne: ['$schemaVersion', 2] }] : []),
          { $or: [{ $eq: [{ $ifNull: ['$blockedUntil', null] }, null] }, { $lte: ['$blockedUntil', new Date()] }] },
          ...(control?.manualDeadline > new Date() ? [] : [{ $lte: ['$nextAttemptAt', new Date()] }]),
        ] }, 1, 0] } },
      } }]);
      const counts = { intakes: control?.intakes?.length || 0, ...Object.fromEntries(rows.map(row => [row._id, row.count])),
        blocked: rows.reduce((sum, row) => sum + row.blocked, 0), remaining_eligible: rows.reduce((sum, row) => sum + row.eligible, 0) };
      res.json({ session: await sessionStatus(control), counts, enabled: config().enabled, auto: config().auto, reason: control?.reason, next_attempt_at: control?.nextAttemptAt, manual_deadline: control?.manualDeadline, manual_requested_at: control?.manualRequestedAt,
        readiness: control?.readiness, coordinator: control ? { holder: control.holder, host: control.ownerHost, pid: control.ownerPid, lease_until: control.leaseUntil } : null, suppressed_window: control?.suppressedWindow,
        run: run ? { id: run._id, mode: run.wire.mode, deadline: run.wire.deadline, state: run.state,
          remote_status: run.remote?.status, admission: run.admission?.state || (run.remote ? 'accepted' : 'unconfirmed'),
          admission_reason: run.admission?.reason, admission_http_status: run.admission?.httpStatus,
          stop_mode: run.stopMode, reason: run.reason, operations: run.manifest.length,
          accepted_operations: run.remote?.operations?.length || 0,
          completed_operations: run.remote?.operations?.filter(op => op.status === 'succeeded').length || 0 } : null, activities });
    }));
    router.post('/api/v1/scheduler/:action', admin, wrap(async (req, res) => {
      await worker.manage(req.localAiActor, req.params.action, req.params.action === 'start' ? req.get('Idempotency-Key') : undefined);
      res.status(202).json({ accepted: true });
    }));
  }
  router.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const code = typeof error.code === 'string' && /^[a-z0-9_]{1,100}$/.test(error.code) ? error.code : 'local_ai_unavailable';
    const status = error.status >= 400 && error.status <= 599 ? error.status : 503;
    if (status >= 500) logger.warning('Local AI request failed', { category: 'local_ai', metadata: { code } });
    res.status(status).json({ error: { code } });
  });
  return router;
}
module.exports = { createRouter };
