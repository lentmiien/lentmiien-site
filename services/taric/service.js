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
function createService({ models, transport, evidence, codeVersion, authorizeAdmin = async () => false, now = Date.now } = {}) {
  const { Settings, Credential, Benchmark, Run, Request, Feedback, Control } = models;
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
    if (test) return { settings: s, admission: testAdmission(s, version()) };
    const benchmark = s?.currentBenchmark ? await query(Benchmark.findById(s.currentBenchmark)) : null;
    const runs = benchmark ? await releaseRuns(s, benchmark._id) : [];
    const winner = selectWinner(s, benchmark, runs, version(), now());
    const control = await query(Control.findById('inference'));
    if (!control) fail('CONFIG_NOT_READY');
    if (control.blocked) fail('INFERENCE_UNCERTAIN');
    transport.configured();
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
      await checkAdmission(previous); return publicRequest(previous);
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
          await checkAdmission(winner); return publicRequest(winner);
        }
      }
    }
    fail('QUEUE_FULL');
  }
  function publicRequest(r) {
    return { id: r._id, state: r.state, test: r.input.test, result: r.result || null, error: r.error || null,
      manual_confirmation_required: true, baseline: r.input.test ? 'untested' : null,
      adapter: r.admission.adapter, benchmark: r.admission.benchmark,
      poll_url: `/api/taric/v1/requests/${r._id}`, feedback_url: `/api/taric/v1/requests/${r._id}/feedback` };
  }
  async function retrieve(principal, requestId) {
    validId(requestId); await authorize(principal, SCOPES[1]);
    const r = await query(Request.findOne({ _id: requestId, owner: principal.owner, principal: principal.id }));
    if (!r) fail('NOT_FOUND');
    if (r.generation !== principal.generation) fail('FORBIDDEN');
    await checkAdmission(r); return publicRequest(r);
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
    const known = await transport.adapters(); if (!known.some(a => a.name === adapter)) fail('INVALID_REQUEST');
    const s = await settings(); if (!s?.enabled) fail('CONFIG_NOT_READY');
    const b = await query(Benchmark.findById(benchmarkId)); if (!b) fail('NOT_FOUND');
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
          requestedCount: b.cases.length, actualCount: 0, exact: 0, invalid: 0, results: [], score: 0, passed: false,
          cancelRequested: false, deadline: new Date(now() + 6 * 3600000), actor });
        return { id: row._id };
      } catch (e) { if (e.code !== 11000) throw e; }
    }
    fail('QUEUE_FULL');
  }
  async function cancelRun(runId) {
    validId(runId);
    await Run.updateOne({ _id: runId }, { $set: { cancelRequested: true, passed: false } }).exec();
  }
  async function inspect(kind, before) {
    const available = { requests: Request, feedback: Feedback, benchmarks: Benchmark, runs: Run };
    if (!Object.hasOwn(available, kind)) fail('NOT_FOUND');
    const filter = before ? { _id: { $lt: validId(before) } } : {};
    // Random opaque ID keyset pagination is stable; ordering intentionally isn't time.
    const projection = kind === 'benchmarks' ? '-cases' : kind === 'runs' ? '-results -configuration.catalog' : '-key -digest';
    return query(available[kind].find(filter).select(projection).sort({ _id: -1 }).limit(25));
  }
  async function detail(kind, itemId, offset = 0) {
    validId(itemId);
    if (!Number.isInteger(offset) || offset < 0 || offset > 500) fail('INVALID_REQUEST');
    const model = kind === 'benchmarks' ? Benchmark : kind === 'runs' ? Run : null;
    if (!model) fail('NOT_FOUND');
    return query(model.findById(itemId).select(kind === 'benchmarks' ? { cases: { $slice: [offset, 25] } } : { results: { $slice: [offset, 25] } }));
  }
  async function resumeInference() {
    const released = await Control.updateOne({ _id: 'inference', blocked: true, until: { $lte: new Date(now()) } },
      { $set: { blocked: false, reason: null } }).exec();
    if (!released.matchedCount) fail('STALE');
    logger.warning('TARIC inference hold cleared after operator idle confirmation', { category: 'taric' });
  }
  async function readiness() {
    const s = await settings(); let normal; let test;
    try { const a = await admission(false); normal = { ready: true, ...a.admission }; } catch (e) { normal = { ready: false, reason: e instanceof TaricError ? e.code : 'STORAGE_FAILED' }; }
    try { await admission(true); test = { ready: true, adapter: TEST_ADAPTER, status: 'untested baseline; manual confirmation required' }; }
    catch (e) { test = { ready: false, reason: e instanceof TaricError ? e.code : 'STORAGE_FAILED' }; }
    const b = s?.currentBenchmark ? await query(Benchmark.findById(s.currentBenchmark)) : null;
    const candidates = b ? await releaseRuns(s, b._id) : [];
    const blockers = [];
    if (!s?.enabled) blockers.push('Tool disabled or bootstrap missing');
    if (!b || b.version < 1 || b.contaminated || !b.releaseEligible) blockers.push('No published independent release-eligible v1+ benchmark');
    if (!s?.catalog?.approved) blockers.push('No approved catalog');
    if (!s?.runtime?.adapters?.some(a => a.verified)) blockers.push('No verified runtime identity');
    if (!candidates.length) blockers.push('No authoritative runs for configured adapters');
    if (!normal.ready) blockers.push('No current qualifying winner or observed runtime identity mismatch; inspect candidate status, fingerprint, policy and counts');
    return { normal: { ...normal, blockers, candidates }, test, inference: await query(Control.findById('inference').select('-holder -attempts')), settings: s, credential: await query(Credential.findById('integration')), template: TEMPLATE, codeFingerprint: version() };
  }
  return { models, transport, evidence, settings, authenticate, authorize, adminPrincipal, rate, rotate, revoke, admission, checkAdmission,
    principalFrom, submit, retrieve, feedback, saveConfig, importBenchmark, publish, queueRun, cancelRun,
    inspect, detail, readiness, resumeInference, version, now };
}
module.exports = { createService, query, id, validId, SCOPES };
