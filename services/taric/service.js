const crypto = require('crypto');
const logger = require('../../utils/logger');
const { TaricError, fail, object, string, idempotencyKey, validateFeedback } = require('../../utils/taricContracts');
const { input, hash, sha, TEST_ADAPTER, TEMPLATE, CLEANED_SHA } = require('../../utils/taricProtocol');
const { preview, draft, overlaps } = require('./importer');
const { codeFingerprint, configuration, selectWinner, testAdmission } = require('./gate');
const SCOPES = ['taric.requests.create', 'taric.requests.read', 'taric.feedback.write'];
const id = () => crypto.randomBytes(16).toString('hex');
const validId = value => string(value, 32, 'NOT_FOUND', /^[a-f0-9]{32}$/);
const query = q => q.maxTimeMS(2000).lean().exec();
function createService({ models, transport, evidence, codeVersion, authorizeAdmin = async () => false, now = Date.now, warmSessions = require('./warmSession').createWarmSessions(), recoveryLeaseMs = 120000 } = {}) {
  let recoveryTask = null;
  const { Settings, Credential, Benchmark, Run, Request, Feedback, Control, Attempt } = models;
  // Freeze at startup: an old worker must not advertise hashes of newly replaced files.
  const implementationVersion = transport.fingerprint
    ? hash({ code: codeVersion || codeFingerprint(), gateway: transport.fingerprint() })
    : codeVersion || codeFingerprint();
  const version = () => implementationVersion;
  const settings = () => query(Settings.findById('tool'));
  async function lock(fn) {
    const holder = id();
    const lease = await query(Control.findOneAndUpdate({ _id: 'management', until: { $lte: new Date(now()) } },
      { $set: { holder, until: new Date(now() + 30000) } }, { returnDocument: 'after' }));
    if (!lease) fail('STALE');
    try { return await fn(); } finally {
      await Control.updateOne({ _id: 'management', holder }, { $set: { until: new Date(0) } }).exec();
    }
  }
  async function authenticate(secret) {
    if (typeof secret !== 'string' || !/^ttk_[A-Za-z0-9_-]{43}$/.test(secret)) fail('UNAUTHORIZED');
    const c = await query(Credential.findById('integration').select('+digest'));
    if (!c?.active || (!Number.isFinite(c.expiresAt?.getTime()) || c.expiresAt <= new Date(now())) || !/^[a-f0-9]{64}$/.test(c.digest || '')
      || !crypto.timingSafeEqual(Buffer.from(c.digest, 'hex'), Buffer.from(sha(secret), 'hex'))) fail('UNAUTHORIZED');
    return { id: c._id, owner: c.owner, generation: c.generation, scopes: c.scopes };
  }
  async function authorize(principal, scope) {
    if (/^admin_[a-f0-9]{24}$/.test(principal.id || '')) {
      const s = await settings();
      if (!SCOPES.includes(scope) || principal.owner !== s?.owner || principal.generation !== 0
        || !await authorizeAdmin(principal.id.slice(6))) fail('FORBIDDEN');
      return principal;
    }
    const c = await query(Credential.findById('integration'));
    if (!c?.active || (!Number.isFinite(c.expiresAt?.getTime()) || c.expiresAt <= new Date(now())) || c.generation !== principal.generation
      || c.owner !== principal.owner || principal.id !== c._id || !c.scopes.includes(scope)) fail('FORBIDDEN');
    return c;
  }
  async function adminPrincipal(actor) {
    const s = await settings();
    if (!s || !await authorizeAdmin(actor)) fail('FORBIDDEN');
    return { id: `admin_${actor}`, owner: s.owner, generation: 0 };
  }
  async function rate(principal) {
    const window = Math.floor(now() / 60000);
    await Credential.updateOne({ _id: principal.id, rateWindow: { $ne: window } }, { $set: { rateWindow: window, rateCount: 0 } }).exec();
    const c = await query(Credential.findOneAndUpdate({ _id: principal.id, generation: principal.generation,
      active: true, rateWindow: window, rateCount: { $lt: 120 } }, { $inc: { rateCount: 1 } }, { returnDocument: 'after' }));
    if (!c) fail('RATE_LIMITED');
  }
  async function rotate(actor) {
    return lock(async () => {
      const s = await settings(); if (!s) fail('CONFIG_NOT_READY');
      const secret = `ttk_${crypto.randomBytes(32).toString('base64url')}`;
      await Credential.updateOne({ _id: 'integration' }, { $set: { owner: s.owner, digest: sha(secret), active: true,
        scopes: SCOPES, expiresAt: new Date(now() + 90 * 86400000), issuedBy: actor, revokedAt: null, rateWindow: 0, rateCount: 0 },
      $inc: { generation: 1 } }, { upsert: true }).exec();
      logger.notice('TARIC credential rotated', { category: 'taric', metadata: { operation: 'credential.rotate' } });
      return secret;
    });
  }
  async function revoke() {
    await Credential.updateOne({ _id: 'integration' }, { $set: { active: false, revokedAt: new Date(now()) }, $inc: { generation: 1 } }).exec();
    logger.warning('TARIC credential revoked', { category: 'taric', metadata: { operation: 'credential.revoke' } });
  }
  async function releaseRuns(s, benchmarkId) {
    const adapters = (s?.runtime?.adapters || []).map(a => a.name);
    // Group in Mongo before transfer: at most 20 configured adapters, no private
    // outputs or repeated catalogs loaded just to evaluate release eligibility.
    return Run.aggregate([{ $match: { benchmark: benchmarkId, adapter: { $in: adapters } } },
      { $sort: { adapter: 1, sequence: -1 } }, { $group: { _id: '$adapter', run: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$run' } }, { $project: { _id: 1, benchmark: 1, adapter: 1, identity: 1,
        sequence: 1, fingerprint: 1, 'configuration.runtime': 1, policy: 1, state: 1, active: 1, requestedCount: 1,
        actualCount: 1, exact: 1, invalid: 1, score: 1, passed: 1, cancelRequested: 1, createdAt: 1,
        resultCount: { $size: { $ifNull: ['$results', []] } } } }]).option({ maxTimeMS: 2000 }).exec();
  }
  async function admission(test) {
    const s = await settings();
    if (test) {
      const control = await query(Control.findById('inference'));
      if (!control) fail('CONFIG_NOT_READY');
      if (control.blocked) fail('INFERENCE_UNCERTAIN');
      transport.configured();
    }
    if (test) {
      const selected = testAdmission(s, version());
      await warmSessions.preflight?.();
      return { settings: s, admission: selected };
    }
    const benchmark = s?.currentBenchmark ? await query(Benchmark.findById(s.currentBenchmark)) : null;
    const runs = benchmark ? await releaseRuns(s, benchmark._id) : [];
    const winner = selectWinner(s, benchmark, runs, version(), now());
    const control = await query(Control.findById('inference'));
    if (!control) fail('CONFIG_NOT_READY');
    if (control.blocked) fail('INFERENCE_UNCERTAIN');
    transport.configured();
    await warmSessions.preflight?.();
    await transport.verifyIdentity(winner.adapter, winner.configuration.runtime);
    const fresh = await settings();
    const freshRuns = await releaseRuns(fresh, benchmark._id);
    const freshWinner = selectWinner(fresh, benchmark, freshRuns, version(), now());
    if (fresh.revision !== s.revision || freshWinner._id !== winner._id || freshWinner.fingerprint !== winner.fingerprint) fail('RELEASE_CLOSED');
    return { settings: s, admission: { test: false, adapter: winner.adapter, fingerprint: winner.fingerprint,
      revision: s.revision, benchmark: benchmark._id, run: winner._id, identity: winner.configuration.runtime } };
  }
  async function checkAdmission(record) {
    const current = await admission(record.input.test);
    if (hash(current.admission) !== hash(record.admission)) fail(record.input.test ? 'STALE' : 'RELEASE_CLOSED');
    return current;
  }
  function principalFrom(r) { return { id: r.principal, owner: r.owner, generation: r.generation }; }
  async function submit(principal, key, value) {
    const normalized = input(value); key = sha(idempotencyKey(key));
    await authorize(principal, SCOPES[0]);
    const digest = hash({ input: normalized, generation: principal.generation });
    const previous = await query(Request.findOne({ principal: principal.id, key }));
    if (previous) {
      if (previous.digest !== digest) fail('IDEMPOTENCY_CONFLICT');
      if (!(previous.input.test === true && !previous.active)) await checkAdmission(previous);
      return publicRequest(previous);
    }
    const selected = await admission(normalized.test);
    for (let slot = 0; slot < 20; slot++) {
      try {
        const r = await Request.create({ _id: id(), owner: principal.owner, principal: principal.id,
          generation: principal.generation, key, digest, input: normalized, admission: selected.admission,
          state: 'queued', active: true, slot, result: null, evidence: null, error: null });
        return publicRequest(r.toObject());
      } catch (e) {
        if (e.code !== 11000) throw e;
        const winner = await query(Request.findOne({ principal: principal.id, key }));
        if (winner) {
          if (winner.digest !== digest) fail('IDEMPOTENCY_CONFLICT');
          if (!(winner.input.test === true && !winner.active)) await checkAdmission(winner);
          return publicRequest(winner);
        }
      }
    }
    fail('QUEUE_FULL');
  }
  function publicRequest(r) {
    return { id: r._id, state: r.state, test: r.input.test, result: r.result || null, error: r.error || null,
      ...(r.input.test === true ? { diagnostics: r.diagnostics || null, diagnosticsStatus: r.diagnostics ? 'captured' : 'not_captured',
        evidence: r.evidence || null, errorStatus: require('../../utils/taricDiagnostics').errorStatus(r.errorStatus),
        help: require('../../utils/taricDiagnostics').help(r.error, r.errorStatus) } : {}),
      manual_confirmation_required: true, baseline: r.input.test ? 'untested' : null,
      adapter: r.admission.adapter, benchmark: r.admission.benchmark,
      poll_url: `/api/taric/v1/requests/${r._id}`, feedback_url: `/api/taric/v1/requests/${r._id}/feedback` };
  }
  async function retrieve(principal, requestId) {
    validId(requestId); await authorize(principal, SCOPES[1]);
    const r = await query(Request.findOne({ _id: requestId, owner: principal.owner, principal: principal.id }));
    if (!r) fail('NOT_FOUND');
    if (r.generation !== principal.generation) fail('FORBIDDEN');
    if (!(r.input.test === true && !r.active)) await checkAdmission(r);
    return publicRequest(r);
  }
  async function feedback(principal, key, requestId, value) {
    validId(requestId); key = sha(idempotencyKey(key)); const parsed = validateFeedback(value);
    await authorize(principal, SCOPES[2]);
    const parent = await query(Request.findOne({ _id: requestId, owner: principal.owner, principal: principal.id }));
    if (!parent) fail('NOT_FOUND');
    // Final manual feedback remains possible when release/settings have since closed.
    if (parent.active) fail('STALE');
    const digest = hash({ requestId, ...parsed });
    const filter = { principal: principal.id, key };
    const prior = await query(Feedback.findOne(filter));
    if (prior) { if (prior.digest !== digest) fail('IDEMPOTENCY_CONFLICT'); return prior; }
    const s = await settings();
    try {
      const row = await Feedback.create({ _id: id(), ...filter, owner: principal.owner, request: requestId, digest,
        selected_code: parsed.selected_code, decision: parent.result ? (parent.result.taric_code === parsed.selected_code ? 'accepted' : 'changed') : 'manual',
        catalog_status: s?.catalog?.approved && s.catalog.codes.includes(parsed.selected_code) ? 'approved_member' : 'unknown',
        verification: 'unverified', training_approved: false, recommendationHash: hash({ result: parent.result, error: parent.error }) });
      return row.toObject();
    } catch (e) {
      if (e.code !== 11000) throw e;
      const winner = await query(Feedback.findOne(filter));
      if (!winner || winner.digest !== digest) fail('IDEMPOTENCY_CONFLICT'); return winner;
    }
  }
  async function saveConfig(value) {
    object(value, ['enabled', 'maxTokens', 'catalog', 'runtime'], 'INVALID_REQUEST');
    if (typeof value.enabled !== 'boolean' || !Number.isInteger(value.maxTokens) || value.maxTokens < 1 || value.maxTokens > 512) fail('INVALID_REQUEST');
    if (value.catalog !== null) {
      object(value.catalog, ['approved', 'version', 'source', 'date', 'applicability', 'attestation', 'codes'], 'INVALID_REQUEST');
      if (value.catalog.approved !== true || !Array.isArray(value.catalog.codes) || !value.catalog.codes.length || value.catalog.codes.length > 10000) fail('INVALID_REQUEST');
      for (const k of ['version', 'source', 'date', 'applicability', 'attestation']) string(value.catalog[k], 1000, 'INVALID_REQUEST');
      for (const code of value.catalog.codes) string(code, 10, 'INVALID_REQUEST', /^[0-9]{10}$/);
    }
    object(value.runtime, ['adapters'], 'INVALID_REQUEST');
    if (!Object.keys(value.runtime).length) value = { ...value, runtime: { adapters: [] } };
    if (!Array.isArray(value.runtime.adapters) || value.runtime.adapters.length > 20) fail('INVALID_REQUEST');
    const identities = new Set(); const names = new Set();
    for (const a of value.runtime.adapters) {
      object(a, ['name', 'identity', 'verified', 'trustSource', 'deploymentRevision', 'baseRevision', 'tokenizerRevision', 'adapterSha256', 'validUntil'], 'INVALID_REQUEST');
      string(a.name, 100, 'INVALID_REQUEST', /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
      for (const k of ['identity', 'trustSource', 'deploymentRevision', 'baseRevision', 'tokenizerRevision']) string(a[k], 500, 'INVALID_REQUEST');
      string(a.adapterSha256, 64, 'INVALID_REQUEST', /^[a-f0-9]{64}$/);
      if (typeof a.verified !== 'boolean' || !Number.isFinite(Date.parse(a.validUntil)) || identities.has(a.identity) || names.has(a.name)) fail('INVALID_REQUEST');
      identities.add(a.identity); names.add(a.name);
      if (a.verified && value.enabled) await transport.verifyIdentity(a.name, a);
    }
    return lock(async () => {
      await Settings.updateOne({ _id: 'tool' }, { $set: value, $inc: { revision: 1 } }).exec();
      transport.sessionAdapter?.invalidate();
      logger.notice('TARIC configuration changed; prior scores invalidated', { category: 'taric' });
    });
  }
  async function importBenchmark(buffer, versionNumber, review, actor) {
    const parsed = await preview(buffer);
    return lock(async () => {
      const training = await query(Benchmark.findOne({ version: 0 }));
      if (versionNumber === 0 && parsed.manifest.sha256 !== CLEANED_SHA) fail('IMPORT_INVALID');
      const s = await settings(); if (!s) fail('CONFIG_NOT_READY');
      const value = draft(parsed, versionNumber, review, training);
      value.review.actor = actor;
      const prior = await query(Benchmark.findOne({ version: versionNumber }));
      if (prior && prior.manifest.sha256 !== parsed.manifest.sha256) fail('IDEMPOTENCY_CONFLICT');
      const row = prior || await Benchmark.create({ _id: id(), ...value });
      const testCatalog = { source: 'training-derived/non-authoritative', sha256: parsed.manifest.sha256,
        codes: [...new Set(parsed.cases.map(c => c.target))] };
      // Repair an interrupted v0 import without mutating the immutable benchmark.
      if (versionNumber === 0 && hash(s.testCatalog) !== hash(testCatalog)) {
        await Settings.updateOne({ _id: 'tool' }, { $set: { testCatalog }, $inc: { revision: 1 } }).exec();
      }
      return { id: row._id, manifest: parsed.manifest, contaminated: row.contaminated,
        alreadyImported: Boolean(prior), policy: row.policy };
    });
  }
  async function publish(benchmarkId, actor) {
    validId(benchmarkId);
    return lock(async () => {
      const b = await query(Benchmark.findById(benchmarkId)); const s = await settings();
      if (!b || !s || !['draft', 'published'].includes(b.state)) fail('STALE');
      if (b.state === 'published' && s.currentBenchmark === b._id) return;
      const current = s.currentBenchmark ? await query(Benchmark.findById(s.currentBenchmark)) : null;
      if (current && b.version <= current.version) fail('STALE');
      const training = await query(Benchmark.findOne({ version: 0 }));
      const overlap = overlaps(b.cases, training?.cases || []);
      if (b.version > 0 && (!training || b.contaminated || overlap.any || !b.review.targetsReviewed
        || !b.review.independent || !b.review.trainingExcluded || !b.cases.length)) fail('OVERLAP');
      await Benchmark.updateOne({ _id: b._id, state: 'draft' }, { $set: { state: 'published',
        releaseEligible: b.version > 0 && !b.contaminated, publishedAt: new Date(now()), publishedBy: actor } }).exec();
      await Settings.updateOne({ _id: 'tool' }, { $set: { currentBenchmark: b._id }, $inc: { revision: 1 } }).exec();
      logger.notice('TARIC benchmark published; release gate recalculated', { category: 'taric', metadata: { version: b.version } });
    });
  }
  async function queueRun(benchmarkId, adapter, actor) {
    validId(benchmarkId); string(adapter, 100, 'INVALID_REQUEST', /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
    const control = await query(Control.findById('inference'));
    if (!control || control.blocked) fail('RECOVERY_REQUIRED');
    await warmSessions.preflight?.();
    const known = await transport.adapters(); if (!known.some(a => a.name === adapter)) fail('INVALID_REQUEST');
    const s = await settings(); if (!s?.enabled) fail('CONFIG_NOT_READY');
    const b = await query(Benchmark.findById(benchmarkId)); if (!b) fail('NOT_FOUND');
    if (!warmSessions.ready() || (b.version === 0 && adapter !== TEST_ADAPTER)) fail('WARM_SESSION_NOT_READY');
    if (b.version > 0 && b.state !== 'published') fail('CONFIG_NOT_READY');
    const config = configuration(s, adapter, version());
    if (b.version > 0 && (!config.runtime?.verified || !s.catalog?.approved)) fail('CONFIG_NOT_READY');
    const sequenced = await query(Settings.findOneAndUpdate({ _id: 'tool' }, { $inc: { nextRunSequence: 1 } }, { returnDocument: 'after' }));
    const sequence = sequenced?.nextRunSequence;
    if (!Number.isSafeInteger(sequence) || sequence < 1) fail('CONFIG_NOT_READY');
    for (let slot = 0; slot < 8; slot++) {
      try {
        const row = await Run.create({ _id: id(), sequence, benchmark: b._id, adapter, identity: config.runtime?.identity || hash({ adapter, unverified: true }),
          fingerprint: hash(config), configuration: config, policy: b.policy, state: 'pending', active: true, slot,
          warmSessionRequired: true, dispatchContract: 'owned-v1', attemptedCount: 0, errorCount: 0, catalogRejected: 0, codeExact: 0,
          requestedCount: b.cases.length, actualCount: 0, exact: 0, invalid: 0, results: [], score: 0, passed: false,
          cancelRequested: false, deadline: new Date(now() + 6 * 3600000), actor });
        return { id: row._id };
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    fail('QUEUE_FULL');
  }
  async function cancelRun(runId) {
    validId(runId);
    await Run.updateOne({ _id: runId, state: { $nin: ['failed', 'interrupted'] } }, { $set: { cancelRequested: true, passed: false } }).exec();
    await Run.updateOne({ _id: runId, fence: null, state: { $in: ['pending', 'running', 'paused', 'recovery_required'] } },
      { $set: { state: 'cancelled', active: false, finishedAt: new Date(now()) } }).exec();
  }
  async function inspect(kind, before) {
    const available = { requests: Request, feedback: Feedback, benchmarks: Benchmark, runs: Run };
    if (!Object.hasOwn(available, kind)) fail('NOT_FOUND');
    let filter = {};
    if (before) {
      const anchor = await query(available[kind].findById(validId(before)).select('createdAt'));
      if (!anchor) fail('INVALID_REQUEST');
      filter = { $or: [{ createdAt: { $lt: anchor.createdAt } }, { createdAt: anchor.createdAt, _id: { $lt: anchor._id } }] };
    }
    const projection = kind === 'benchmarks' ? '-cases' : kind === 'runs' ? '-results -configuration.catalog' : '-key -digest';
    return query(available[kind].find(filter).select(projection).sort({ createdAt: -1, _id: -1 }).limit(25));
  }

  async function detail(kind, itemId, offset = 0) {
    validId(itemId);
    if (!Number.isInteger(offset) || offset < 0 || offset > 500) fail('INVALID_REQUEST');
    const model = kind === 'benchmarks' ? Benchmark : kind === 'runs' ? Run : null;
    if (!model) fail('NOT_FOUND');
    const record = await query(model.findById(itemId).select(kind === 'benchmarks' ? { cases: { $slice: [offset, 25] } } : { results: { $slice: [offset, 25] } }));
    if (record && kind === 'runs') {
      // Durable attempts remain inspectable even after a crash between attempt and
      // parent persistence. No tokens are stored in this collection.
      record.attempts = await query(Attempt.find({ run: itemId, index: { $gte: offset } }).sort({ index: 1 }).limit(25));
    }
    return record;
  }
  async function recoveryStatus() {
    let remote;
    try { remote = await warmSessions.probe(); } catch (e) { remote = { idle: false, ...require('../../utils/taricDiagnostics').readinessError(e) }; }
    const wasActive = Boolean(recoveryTask);
    const control = await query(Control.findById('inference').select('-holder -attempts'));
    const owned = Boolean(control?.sessionId && warmSessions.lookup?.(control.sessionId));
    const ownership = { available: owned, state: owned ? 'owned' : control?.sessionId ? 'OWNERSHIP_LOST' : 'none',
      active: wasActive || Boolean(recoveryTask), cleanup: owned ? warmSessions.describe?.(control.sessionId) || null : null, action: owned ? 'continue_owned_cleanup' : 'acquire_recovery_admission' };
    return { control, remote, ownership, pending: await query(Run.find({ active: true }).select('_id state actualCount requestedCount cancelRequested').limit(8)),
      queuedRequests: await Request.countDocuments({ active: true }).exec() };
  }
  // Reuse the global control record and its lease as the recovery task lifecycle.
  // The HTTP response need not remain open for Gateway's 90-second cleanup.
  async function startRecovery(epoch, requestId, actor) {
    if (recoveryTask) fail('STALE');
    let timer;
    const task = resumeInference(epoch, requestId, actor);
    recoveryTask = task;
    const settled = task.then(() => ({ ok: true }), error => {
      if (!(error instanceof TaricError)) logger.error('TARIC recovery storage operation failed; hold requires reconciliation', {
        category: 'taric', metadata: { code: 'STORAGE_FAILED', requestId },
      });
      return { error };
    });
    settled.then(() => { if (recoveryTask === task) recoveryTask = null; });
    try {
      const result = await Promise.race([settled, new Promise(resolve => {
        timer = setTimeout(() => resolve({ pending: true, state: 'CLEANUP_PENDING', poll_url: '/admin/taric/inference/status' }), 1000);
      })]);
      if (result.error) throw result.error;
      return result;
    } finally { clearTimeout(timer); }
  }
  async function resumeInference(epoch, requestId, actor) {
    if (!Number.isSafeInteger(epoch) || epoch < 0) fail('INVALID_REQUEST');
    if (!await authorizeAdmin(actor)) fail('FORBIDDEN');
    const holder = id();
    const epochFilter = epoch === 0 ? { $or: [{ epoch: 0 }, { epoch: { $exists: false } }] } : { epoch };
    const lease = await query(Control.findOneAndUpdate({ _id: 'inference', blocked: true,
      until: { $lte: new Date(now()) }, ...epochFilter }, { $set: { holder, until: new Date(now() + recoveryLeaseMs) } }, { returnDocument: 'after' }));
    if (!lease) fail('STALE');
    const controller = new AbortController();
    let currentEpoch = epoch; let renewal = null; let session; let handedOff = false; let cleaned = false; let stage = 'recovery.pending';
    const filter = () => ({ _id: 'inference', holder, blocked: true, ...(handedOff ? { epoch: currentEpoch } : epochFilter), until: { $gt: new Date(now()) } });
    const check = async () => {
      if (controller.signal.aborted) fail('INTERRUPTED');
      if (!await authorizeAdmin(actor)) fail('FORBIDDEN');
      if (!await query(Control.findOne(filter()))) fail('STALE');
    };
    const heartbeat = setInterval(() => {
      if (renewal || controller.signal.aborted) return;
      renewal = (async () => {
        try {
          await check();
          const renewed = await Control.updateOne(filter(), { $set: { until: new Date(now() + recoveryLeaseMs) } }).maxTimeMS(2000).exec();
          if (!renewed.matchedCount) fail('STALE');
        } catch (error) {
          controller.abort();
          logger.warning('TARIC recovery lease or authority lost; remote ownership remains unknown', { category: 'taric', metadata: {
            code: error instanceof TaricError ? error.code : 'STORAGE_FAILED', epoch: currentEpoch, requestId,
          } });
        } finally { renewal = null; }
      })();
    }, Math.max(1, Math.floor(recoveryLeaseMs / 4)));
    heartbeat.unref?.();
    try {
      if (await Run.exists({ active: true }).maxTimeMS(2000).exec() || await Request.exists({ active: true }).maxTimeMS(2000).exec()) fail('RECOVERY_REQUIRED');
      await check();
      session = lease.sessionId ? warmSessions.lookup?.(lease.sessionId) : null;
      if (!session && warmSessions.retainedId?.()) fail('OWNERSHIP_LOST');
      if (!session) {
        stage = 'session.create';
        try { session = await warmSessions.open({ correlationId: requestId || id(), signal: controller.signal }); }
        catch (error) {
          if (lease.sessionId && error.transport?.status === 409) {
            const lost = new TaricError('OWNERSHIP_LOST'); lost.transport = error.transport; throw lost;
          }
          throw error;
        }
      }
      // Persist ownership before any further remote operation can fail. A known
      // matching local handle is reused, including after an earlier close timeout.
      stage = 'recovery.handoff';
      await check();
      const changed = await Control.updateOne(filter(), { $set: {
        sessionId: session.id, capabilityProof: session.capabilityProof, recoveryPhase: 'owned_cleanup', reason: 'CLEANUP_PENDING' }, $inc: { epoch: 1 } }).maxTimeMS(2000).exec();
      if (!changed.matchedCount) fail('STALE');
      currentEpoch = epoch + 1; handedOff = true;
      stage = 'session.cleanup';
      await check();
      const result = await warmSessions.close(session, { signal: controller.signal, epoch: currentEpoch });
      cleaned = result.idle;
      if (!cleaned) fail(result.reason || 'CLEANUP_PENDING');
      await check();
      const released = await Control.updateOne({ ...filter(), sessionId: session.id },
        { $set: { blocked: false, reason: null, recoveryPhase: null, sessionId: null } }).maxTimeMS(2000).exec();
      if (!released.matchedCount) fail('STALE');
      logger.warning('TARIC hold cleared through exclusive owned admission and verified cleanup; pending work remains stopped', { category: 'taric' });
    } catch (error) {
      error.stage = error.stage || stage;
      const code = error instanceof TaricError ? error.code : 'STORAGE_FAILED';
      // Never clear a fence or forget a known capability on failure. Persist only
      // nonsecret ownership metadata while we still hold the matching lease.
      if (session || code === 'OWNERSHIP_LOST') await Control.updateOne(filter(), { $set: {
        reason: code, ...(session ? { sessionId: session.id, recoveryPhase: 'owned_cleanup' } : {}),
      } }).maxTimeMS(2000).exec();
      logger.warning('TARIC recovery kept admission closed', { category: 'taric', metadata: {
        code, action: 'inference.recover', requestId, epoch: currentEpoch, stage: error.stage,
        transport: require('../../utils/taricDiagnostics').errorStatus(error.transport), handedOff, cleaned } });
      throw error;
    } finally {
      clearInterval(heartbeat); if (renewal) await renewal;
      await Control.updateOne({ _id: 'inference', holder }, { $set: { until: new Date(0) } }).maxTimeMS(2000).exec();
    }
  }
  async function cancelPending(epoch) {
    if (!Number.isSafeInteger(epoch) || epoch < 0) fail('INVALID_REQUEST');
    const holder = id();
    const lease = await query(Control.findOneAndUpdate({ _id: 'inference', blocked: true, ...(epoch === 0 ? { $or: [{ epoch: 0 }, { epoch: { $exists: false } }] } : { epoch }),
      until: { $lte: new Date(now()) } }, { $set: { holder, until: new Date(now() + 120000) }, $inc: { epoch: 1 } }, { returnDocument: 'after' }));
    if (!lease) fail('STALE');
    const checkLease = async () => {
      if (!await query(Control.findOne({ _id: 'inference', holder, blocked: true, epoch: epoch + 1, until: { $gt: new Date(now()) } }))) fail('STALE');
    };
    try {
      await checkLease();
      // Explicit cancellation, not recovery proof. Preserve already finished history.
      await Request.updateMany({ active: true }, { $set: { active: false, state: 'interrupted', error: 'INTERRUPTED', finishedAt: new Date(now()) } }).maxTimeMS(2000).exec();
      const runs = await query(Run.find({ active: true }).limit(8));
      for (const r of runs) {
        await checkLease();
        const claim = await query(Attempt.findOne({ run: r._id, index: r.actualCount }));
        if (claim) {
          const attempt = claim.state === 'finished' ? claim : { ...claim, state: 'finished', finishedAt: new Date(now()),
            result: null, exact: false, error: 'INFERENCE_UNCERTAIN' };
          await Attempt.updateOne({ _id: claim._id }, { $set: attempt }).maxTimeMS(2000).exec();
          await Run.updateOne({ _id: r._id, active: true, actualCount: claim.index }, {
            $push: { results: attempt }, $inc: { actualCount: 1, exact: attempt.exact ? 1 : 0, invalid: attempt.result ? 0 : 1,
              errorCount: attempt.error ? 1 : 0, codeExact: attempt.proposalExact ? 1 : 0, catalogRejected: attempt.error === 'CATALOG_REJECTED' ? 1 : 0 },
            $set: { score: (r.exact + (attempt.exact ? 1 : 0)) / r.requestedCount, currentAttempt: null } }).maxTimeMS(2000).exec();
        }
        await Run.updateOne({ _id: r._id, active: true }, { $set: { state: 'cancelled', active: false,
          passed: false, cancelRequested: true, fence: null, finishedAt: new Date(now()) } }).maxTimeMS(2000).exec();
      }
      logger.warning('TARIC pending work explicitly cancelled under recovery fence; remote hold retained', { category: 'taric' });
    } finally { await Control.updateOne({ _id: 'inference', holder }, { $set: { until: new Date(0) } }).maxTimeMS(2000).exec(); }
  }
  async function resumeRun(runId) {
    validId(runId);
    const holder = id();
    const lease = await query(Control.findOneAndUpdate({ _id: 'inference', blocked: { $ne: true }, until: { $lte: new Date(now()) } },
      { $set: { holder, until: new Date(now() + 30000) } }, { returnDocument: 'after' }));
    if (!lease) fail('RECOVERY_REQUIRED');
    try {
      const r = await query(Run.findOne({ _id: runId, state: { $in: ['paused', 'recovery_required'] }, active: false, cancelRequested: false }));
      if (!r || r.currentAttempt) fail('STALE');
      const s = await settings();
      if (r.dispatchContract !== 'owned-v1' || !warmSessions.ready() || r.fingerprint !== hash(configuration(s, r.adapter, version()))) fail('STALE');
      await warmSessions.preflight?.();
      // Dispatch acquires fresh exclusive owned admission; GET snapshots cannot prove idle.
      const stillHeld = await query(Control.findOne({ _id: 'inference', holder, blocked: { $ne: true }, until: { $gt: new Date(now()) } }));
      if (!stillHeld) fail('STALE');
      try {
        const changed = await Run.updateOne({ _id: runId, state: r.state, active: false, cancelRequested: false },
          { $set: { state: 'pending', active: true, recoveryRequired: false, error: null, deadline: new Date(now() + 6 * 3600000) } }).exec();
        if (!changed.matchedCount) fail('STALE');
      } catch (e) { if (e.code === 11000) fail('QUEUE_FULL'); throw e; }
    } finally { await Control.updateOne({ _id: 'inference', holder }, { $set: { until: new Date(0) } }).exec(); }
  }
  async function readiness() {
    const s = await settings(); let normal; let test; let gateway;
    try { gateway = { ready: true, capabilityProof: await warmSessions.preflight?.({ force: true }) }; }
    catch (e) { gateway = { ready: false, ...require('../../utils/taricDiagnostics').readinessError(e) }; }
    if (!warmSessions.ready()) gateway = { ready: false, reason: 'WARM_SESSION_NOT_READY' };
    const inference = await query(Control.findById('inference').select('-holder -attempts'));
    const b = s?.currentBenchmark ? await query(Benchmark.findById(s.currentBenchmark)) : null;
    const candidates = b ? await releaseRuns(s, b._id) : [];
    // Dashboard never calls model/adapters endpoints: old catchalls may start GPU.
    try { selectWinner(s, b, candidates, version(), now()); normal = { ready: false, locallyQualified: true, reason: 'READINESS_UNVERIFIED', runtimeCheck: 'Runtime identity is checked at dispatch; dashboard does not call model endpoints' }; }
    catch (e) { normal = { ready: false, reason: e instanceof TaricError ? e.code : 'STORAGE_FAILED' }; }
    const executionReasons = [];
    if (!s?.enabled || !inference) executionReasons.push('CONFIG_NOT_READY');
    if (!gateway.ready) executionReasons.push(gateway.reason);
    if (inference?.blocked) executionReasons.push('RECOVERY_REQUIRED');
    try { testAdmission(s, version()); test = { ready: !executionReasons.length, reasons: [...executionReasons], adapter: TEST_ADAPTER, status: 'untested baseline; manual confirmation required' }; }
    catch (e) { test = { ready: false, reasons: [...new Set([...executionReasons, e instanceof TaricError ? e.code : 'STORAGE_FAILED'])] }; }
    test.reason = test.reasons[0] || null;
    const blockers = [];
    if (!s?.enabled) blockers.push('Tool disabled or bootstrap missing');
    if (!b || b.version < 1 || b.contaminated || !b.releaseEligible) blockers.push('No published independent release-eligible v1+ benchmark');
    if (!s?.catalog?.approved) blockers.push('No approved catalog');
    if (!s?.runtime?.adapters?.some(a => a.verified)) blockers.push('No verified runtime identity');
    if (!candidates.length) blockers.push('No authoritative runs for configured adapters');
    if (!normal.locallyQualified) blockers.push('No current qualifying winner; inspect candidate status, fingerprint, policy and counts');
    return { normal: { ...normal, blockers, candidates }, test, gateway, benchmark: { ready: !executionReasons.length, reasons: executionReasons, reason: executionReasons[0] || null }, inference, settings: s, credential: await query(Credential.findById('integration')), template: TEMPLATE, codeFingerprint: version() };
  }
  return { models, transport, evidence, warmSessions, settings, authenticate, authorize, adminPrincipal, rate, rotate, revoke, admission, checkAdmission,
    principalFrom, submit, retrieve, feedback, saveConfig, importBenchmark, publish, queueRun, cancelRun,
    inspect, detail, readiness, recoveryStatus, resumeInference, startRecovery, cancelPending, resumeRun, version, now };
}
module.exports = { createService, query, id, validId, SCOPES };
