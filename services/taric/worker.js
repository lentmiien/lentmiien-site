const logger = require('../../utils/logger');
const { TaricError, fail } = require('../../utils/taricContracts');
const { hash, lexical } = require('../../utils/taricProtocol');
const { configuration, runtimeReady } = require('./gate');
const { query, id, SCOPES } = require('./service');
function createWorker(service, { authorizeAdmin = async () => false, ready = () => true } = {}) {
  const { Control, Request, Run, Benchmark } = service.models;
  let timer; let busy = false; let stopped = true; let lastBootstrapWarning = 0;
  async function fence(holder) {
    const lease = await query(Control.findOne({ _id: 'inference', holder, until: { $gt: new Date(service.now()) } }));
    if (!lease || stopped || !ready()) fail('INTERRUPTED');
  }
  async function hold(holder, reason) {
    await Control.updateOne({ _id: 'inference', holder }, { $set: { blocked: true, reason } }).exec();
    logger.error('TARIC inference held: confirm Gateway idle before resuming', { category: 'taric', metadata: { code: reason } });
  }
  async function finishRequest(r, holder, update) {
    await fence(holder);
    await Request.updateOne({ _id: r._id, state: 'running', fence: holder }, { $set: {
      ...update, active: false, finishedAt: new Date(service.now()) } }).exec();
  }
  function report(error, operation) {
    const code = error instanceof TaricError ? error.code : 'STORAGE_FAILED';
    logger.warning('TARIC background operation requires follow-up', { category: 'taric', metadata: { operation, code } });
    return code;
  }
  async function processRequest(r, holder) {
    try {
      await service.authorize(service.principalFrom(r), SCOPES[0]);
      const selected = await service.checkAdmission(r);
      const { test, ...request } = r.input;
      const evidence = await service.evidence.resolve(request);
      await fence(holder);
      // Recheck after an online fetch, before spending inference work.
      await service.authorize(service.principalFrom(r), SCOPES[0]);
      await service.checkAdmission(r);
      const row = { descriptive_name: request.descriptive_name, full_item_name: evidence.facts.name,
        specs: evidence.facts.specifications || '', hs_code: request.input_hs_code };
      const result = await service.transport.generate(row, r.admission.adapter,
        (test ? selected.settings.testCatalog : selected.settings.catalog).codes,
        selected.settings.maxTokens, r.admission.identity);
      await service.authorize(service.principalFrom(r), SCOPES[0]);
      await service.checkAdmission(r);
      result.warnings = result.taric_code.startsWith(request.input_hs_code) ? [] : ['input_hs_prefix_mismatch'];
      await finishRequest(r, holder, { state: 'complete', evidence, result, error: null });
    } catch (e) {
      const error = report(e, 'request');
      if (error === 'INFERENCE_UNCERTAIN') await hold(holder, error);
      await finishRequest(r, holder, { state: error === 'INTERRUPTED' ? 'interrupted' : 'failed', result: null, error });
    }
  }
  async function runContext(r) {
    if (r.cancelRequested || r.deadline <= new Date(service.now())) fail(r.cancelRequested ? 'CANCELLED' : 'INTERRUPTED');
    if (!await authorizeAdmin(r.actor)) fail('FORBIDDEN');
    const settings = await service.settings();
    const benchmark = await query(Benchmark.findById(r.benchmark));
    if (!settings?.enabled || !benchmark || hash(configuration(settings, r.adapter, service.version())) !== r.fingerprint
      || hash(benchmark.policy) !== hash(r.policy) || benchmark.cases.length !== r.requestedCount) fail('STALE');
    if (benchmark.version > 0 && (!runtimeReady(r.configuration.runtime, service.now())
      || benchmark._id !== settings.currentBenchmark || !benchmark.releaseEligible)) fail('RELEASE_CLOSED');
    return { settings, benchmark };
  }
  async function processRun(r, holder) {
    try {
      const { settings, benchmark } = await runContext(r);
      await fence(holder);
      const index = r.actualCount;
      if (index >= benchmark.cases.length) fail('STALE');
      const c = benchmark.cases[index];
      let result = null; let error = null;
      try {
        result = await service.transport.generate(c.input, r.adapter,
          (benchmark.version === 0 ? settings.testCatalog : settings.catalog).codes,
          settings.maxTokens, benchmark.version === 0 ? null : r.configuration.runtime);
      } catch (e) {
        error = report(e, 'benchmark.case');
        if (error === 'INFERENCE_UNCERTAIN') throw e;
      }
      await fence(holder);
      const fresh = await query(Run.findById(r._id));
      await runContext(fresh);
      const exact = r.exact + (result?.taric_code === c.target ? 1 : 0);
      const invalid = r.invalid + (result ? 0 : 1);
      const actualCount = index + 1;
      const complete = actualCount === r.requestedCount;
      const score = exact / r.requestedCount;
      const passed = complete && score >= r.policy.minExact && invalid / r.requestedCount <= r.policy.maxInvalid;
      const saved = await Run.updateOne({ _id: r._id, fence: holder, cancelRequested: false }, { $set: {
        actualCount, exact, invalid, score, passed, active: !complete, state: complete ? 'complete' : 'running',
        fence: null, ...(complete ? { finishedAt: new Date(service.now()) } : {}) },
      $push: { results: { index, inputHash: c.inputHash, result, error,
        exact: result?.taric_code === c.target, lexicalSimilarity: result && c.summary ? lexical(result.description, c.summary) : null } } }).exec();
      if (!saved.matchedCount) {
        await Run.updateOne({ _id: r._id, fence: holder, cancelRequested: true }, { $set: {
          state: 'cancelled', active: false, passed: false, fence: null, finishedAt: new Date(service.now()) } }).exec();
      }
    } catch (e) {
      const error = report(e, 'benchmark');
      if (error === 'INFERENCE_UNCERTAIN') await hold(holder, error);
      await fence(holder);
      await Run.updateOne({ _id: r._id, fence: holder }, { $set: { state: error === 'CANCELLED' ? 'cancelled' : error === 'INTERRUPTED' ? 'interrupted' : 'failed',
        active: false, passed: false, error, fence: null, finishedAt: new Date(service.now()) } }).exec();
    }
  }
  async function tick() {
    if (busy || stopped || !ready()) return;
    busy = true; const holder = id(); let held = false;
    try {
      // 180 seconds exceeds the absolute budget for one evidence + inference case.
      const lease = await query(Control.findOneAndUpdate({ _id: 'inference', blocked: { $ne: true }, until: { $lte: new Date(service.now()) } },
        { $set: { holder, until: new Date(service.now() + 180000) } }, { returnDocument: 'after' }));
      if (!lease) {
        if (service.now() - lastBootstrapWarning > 3600000) {
          const control = await query(Control.findById('inference'));
          if (!control) {
            lastBootstrapWarning = service.now();
            logger.warning('TARIC worker awaits explicit bootstrap/index initialization', { category: 'taric' });
          }
        }
        return;
      }
      held = true;
      const orphanRequests = await Request.updateMany({ state: 'running', active: true }, { $set: { state: 'interrupted', active: false,
        result: null, error: 'INTERRUPTED', finishedAt: new Date(service.now()) } }).exec();
      const orphanRuns = await Run.updateMany({ active: true, fence: { $type: 'string' } }, { $set: {
        state: 'interrupted', active: false, passed: false, error: 'INTERRUPTED', fence: null } }).exec();
      if (orphanRequests.modifiedCount || orphanRuns.modifiedCount) {
        await hold(holder, 'INTERRUPTED');
        return;
      }
      const request = await query(Request.findOneAndUpdate({ state: 'queued', active: true },
        { $set: { state: 'running', fence: holder } }, { returnDocument: 'after', sort: { createdAt: 1, _id: 1 } }));
      if (request) return await processRequest(request, holder);
      const run = await query(Run.findOneAndUpdate({ active: true, state: { $in: ['pending', 'running'] }, fence: null },
        { $set: { state: 'running', fence: holder } }, { returnDocument: 'after', sort: { createdAt: 1, _id: 1 } }));
      if (run) await processRun(run, holder);
    } catch (e) { report(e, 'worker'); }
    finally {
      if (held) {
        try { await Control.updateOne({ _id: 'inference', holder }, { $set: { until: new Date(0) } }).exec(); }
        catch (e) { report(e, 'lease.release'); }
      }
      busy = false;
    }
  }
  function start() {
    if (!stopped) return;
    stopped = false;
    timer = setInterval(tick, 1000); timer.unref?.();
  }
  function stop() { stopped = true; clearInterval(timer); }
  return { start, stop, tick };
}
module.exports = { createWorker };
