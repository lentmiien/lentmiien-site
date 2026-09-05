const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { performance } = require('perf_hooks');
const { runDiagnostics: defaultDiagnostics } = require('./connectivityDiagnostics');
const PROCESS_ID = randomUUID();
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000);
const Sample = require('../models/connectivity_sample');
const logger = require('../utils/logger');
const { sendPushoverNotification } = require('../utils/pushover');
const { probe, probeTargets } = require('./connectivityProbe');

const DB_OPTIONS = { timeoutMS: 3000, maxTimeMS: 2000 };
const repository = {
  ready: () => mongoose.connection.readyState === 1,
  latest: () => Sample.findOne().sort({ sampledAt: -1 }).setOptions(DB_OPTIONS).lean(),
  save: (sample) => Sample.collection.insertOne(sample, { ...DB_OPTIONS, writeConcern: { w: 1, j: true } }),
  mark: (id, notification) => Sample.updateOne({ _id: id }, { $set: { notification } }, DB_OPTIONS),
  history: (since, limit, before = new Date()) => Sample.find({ sampledAt: { $gte: since, $lt: before }, expiresAt: { $gt: new Date() } })
    .select('-__v').sort({ sampledAt: -1 }).limit(limit).setOptions(DB_OPTIONS).lean(),
};

function advance(previous, results, sampledAt, config) {
  const gap = previous ? sampledAt - new Date(previous.sampledAt) : Infinity;
  const continuous = previous?.signature === config.signature && gap > 0 && gap <= config.maxGapMs;
  return {
    sampledAt, expiresAt: new Date(+sampledAt + config.retentionDays * 86400000),
    signature: config.signature,
    monitorVersion: config.monitorVersion, intervalMs: config.intervalMs,
    slowMs: config.slowMs, timeoutMs: config.timeoutMs,
    lastAttemptAt: previous?.lastAttemptAt || null,
    notification: 'none',
    probes: results.map((result) => ({
      ...result,
      degradedSince: result.degraded
        ? (continuous && (previous.probes || []).find((item) => item.name === result.name)?.degradedSince) || sampledAt
        : null,
    })),
  };
}

function createConnectivityMonitor({ config, store = repository, runProbe = probe,
  send = sendPushoverNotification, log = logger, clock = () => new Date(),
  runDiagnostics = defaultDiagnostics, localPort = () => null, monotonic = () => performance.now() }) {
  let running = false;
  let previous = null;
  let restored = false;
  const warnings = new Map();
  function warn(key, message) {
    const now = +clock();
    if (warnings.has(key) && now - warnings.get(key) < config.cooldownMs) return;
    warnings.set(key, now);
    Promise.resolve(log.warning(message, { category: 'connectivity_monitor' })).catch(() => {});
  }
  async function tick({ scheduledAt = clock(), schedulerLatenessMs = 0 } = {}) {
    if (running) return { skipped: true };
    running = true;
    const startedAt = clock();
    const started = monotonic();
    try {
      if (!restored && store.ready()) {
        try {
          const saved = await store.latest();
          // Keep current in-memory observations on DB recovery; merge saved cooldown only.
          if (!previous) previous = saved;
          else if (saved?.lastAttemptAt && (!previous.lastAttemptAt || +new Date(saved.lastAttemptAt) > +new Date(previous.lastAttemptAt))) {
            previous.lastAttemptAt = saved.lastAttemptAt;
          }
          restored = true;
        } catch { warn('db', 'Connectivity monitor cannot restore MongoDB state; alerts deferred'); }
      }
      const sampledAt = clock();
      // Retain the overlap lock until every task settles, even if a dependency unexpectedly rejects.
      const tasks = await Promise.allSettled([
        ...probeTargets(config).map((target) => Promise.resolve().then(() => runProbe(target, config))),
        Promise.resolve().then(() => runDiagnostics(config, localPort())),
      ]);
      if (tasks.some((task) => task.status === 'rejected')) throw new Error('Probe task failed');
      const diagnostics = tasks.at(-1).value;
      const results = tasks.slice(0, -1).map((task) => task.value);
      const sample = advance(previous, results, sampledAt, config);
      Object.assign(sample, { diagnostics, runId: randomUUID(), processId: PROCESS_ID,
        processStartedAt: PROCESS_STARTED_AT, scheduledAt, startedAt, endedAt: clock(),
        runDurationMs: Math.max(0, monotonic() - started), schedulerLatenessMs });
      if (diagnostics.some((item) => item.degraded)) {
        warn('diagnostics', 'Connectivity local diagnostics degraded; compare local health and DB ping in analytics');
      }
      const sustained = sample.probes.filter((item) => item.degradedSince
        && sampledAt - new Date(item.degradedSince) >= config.sustainedMs);
      const due = sustained.length > 0 && (!sample.lastAttemptAt
        || sampledAt - new Date(sample.lastAttemptAt) >= config.cooldownMs);
      if (sustained.length) warn('degraded', 'Connectivity monitor observed sustained degradation; inspect connectivity history');
      const oldAttempt = sample.lastAttemptAt;
      if (due && restored) {
        sample.lastAttemptAt = sampledAt;
        sample.notification = 'attempted';
      } else if (due) sample.notification = 'deferred';
      let persisted = false;
      let id;
      try {
        // A new sample must not hide a cooldown we have not managed to read yet.
        if (!store.ready() || !restored) throw new Error('Database state unavailable');
        const result = await store.save(sample);
        id = result.insertedId;
        persisted = true;
      } catch {
        restored = false;
        warn('db', 'Connectivity monitor cannot persist MongoDB samples; alerts deferred');
      }
      if (due && (!persisted || !restored)) {
        sample.lastAttemptAt = oldAttempt;
        sample.notification = 'deferred';
      }
      previous = sample;
      if (due && persisted && restored) {
        try {
          await send({ title: 'Lentmiien Site connectivity degraded',
            message: `Repeated slow or failed small HTTPS probes for at least ${Math.floor(config.sustainedMs / 60000)} minutes: ${sustained.map((item) => `${item.name} (${item.outcome}${item.statusCode ? ` HTTP ${item.statusCode}` : ''})`).join(', ')}. HTTP errors still mean an HTTP response arrived. Check connectivity analytics. This does not identify Wi-Fi, ISP or tunnel as the cause.` });
          sample.notification = 'sent';
        } catch {
          sample.notification = 'failed';
          warn('pushover', 'Connectivity monitor Pushover attempt failed; cooldown remains active');
        }
        try { await store.mark(id, sample.notification); }
        catch { warn('db', 'Connectivity monitor cannot persist notification outcome; attempt cooldown is already stored'); }
      }
      return sample;
    } catch {
      warn('tick', 'Connectivity monitor sampling failed; inspect monitor configuration and dependencies');
      // A failed monitor run is an observation gap, not observed network degradation.
      if (previous) previous = { ...previous, signature: '' };
      return { failed: true };
    } finally { running = false; }
  }
  return { tick };
}

module.exports = { createConnectivityMonitor, advance, repository, DB_OPTIONS };
