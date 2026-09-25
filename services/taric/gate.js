const fs = require('fs');
const path = require('path');
const { fail } = require('../../utils/taricContracts');
const { hash, sha, TEST_ADAPTER, TEMPLATE } = require('../../utils/taricProtocol');
const CODE_FILES = ['package-lock.json', 'utils/taricProtocol.js', 'utils/taricContracts.js', 'services/taricEvidenceService.js',
  'services/amiamiScraperService.js', 'models/amiami_item.js',
  'utils/taricDiagnostics.js', 'services/taric/warmSession.js', 'services/taric/gatewaySessions.js', 'services/taric/gatewayCapabilities.js', 'services/taric/amiamiBounded.js', 'services/taric/amiamiCurlChild.js', 'services/taric/gate.js', 'services/taric/transport.js', 'services/taric/importer.js',
  'services/taric/reprocess.js', 'services/taric/reprocessWorker.js', 'models/taric_reprocess.js', 'models/taric_review.js', 'services/taric/historyDomain.js', 'services/taric/service.js', 'services/taric/worker.js', 'services/taric/index.js',
  'routes/taric.js', 'routes/taricAdmin.js', 'utils/taricAuthorizationPolicy.js', 'models/taric_tool.js'];
function codeFingerprint() { return hash(CODE_FILES.map(f => [f, sha(fs.readFileSync(path.join(__dirname, '../..', f)))])); }
function configuration(settings, adapter, codeVersion) {
  const runtime = settings.runtime?.adapters?.find(a => a.name === adapter) || null;
  return { revision: settings.revision, adapter, runtime, codeVersion, template: TEMPLATE,
    catalog: settings.catalog, maxTokens: settings.maxTokens };
}
function runtimeReady(runtime, now = Date.now()) {
  return Boolean(runtime?.verified === true && runtime.trustSource && runtime.deploymentRevision
    && runtime.baseRevision && runtime.tokenizerRevision && /^[a-f0-9]{64}$/.test(runtime.adapterSha256)
    && runtime.identity && Date.parse(runtime.validUntil) > now);
}
function selectWinner(settings, benchmark, runs, codeVersion, now = Date.now()) {
  if (!settings?.enabled || !benchmark || benchmark.state !== 'published' || !benchmark.releaseEligible
    || benchmark.version < 1 || benchmark.contaminated || !benchmark.review?.independent
    || !benchmark.cases?.length || benchmark._id !== settings.currentBenchmark
    || settings.catalog?.approved !== true || !settings.catalog.codes?.length) fail('RELEASE_CLOSED');
  const latest = new Map();
  for (const run of [...runs].sort((a, b) => (b.sequence || 0) - (a.sequence || 0) || new Date(b.createdAt) - new Date(a.createdAt) || b._id.localeCompare(a._id))) {
    if (run.benchmark === benchmark._id && !latest.has(run.adapter)) latest.set(run.adapter, run);
  }
  const qualified = [...latest.values()].filter(run => {
    const config = configuration(settings, run.adapter, codeVersion);
    return run.state === 'complete' && run.active === false && !run.cancelRequested && run.passed === true
      && run.actualCount === benchmark.cases.length && run.requestedCount === benchmark.cases.length
      && (run.resultCount ?? run.results?.length) === benchmark.cases.length && run.fingerprint === hash(config)
      && hash(run.policy) === hash(benchmark.policy) && runtimeReady(config.runtime, now)
      && run.identity === config.runtime.identity && run.score === run.exact / benchmark.cases.length
      && run.score >= benchmark.policy.minExact && run.invalid / benchmark.cases.length <= benchmark.policy.maxInvalid;
  });
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  qualified.sort((a, b) => b.score - a.score || compare(a.identity, b.identity) || compare(a.adapter, b.adapter));
  if (!qualified.length) fail('RELEASE_CLOSED');
  return qualified[0];
}
function testAdmission(settings, codeVersion) {
  if (!settings?.enabled || !settings.testCatalog?.codes?.length) fail('CONFIG_NOT_READY');
  return { test: true, adapter: TEST_ADAPTER, fingerprint: hash({ codeVersion, template: TEMPLATE,
    catalog: settings.testCatalog, maxTokens: settings.maxTokens, revision: settings.revision }),
    revision: settings.revision, benchmark: null, run: null, identity: null };
}
module.exports = { CODE_FILES, codeFingerprint, configuration, runtimeReady, selectWinner, testAdmission };
