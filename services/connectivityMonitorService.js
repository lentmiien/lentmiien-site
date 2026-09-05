const mongoose = require('mongoose');
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
    lastAttemptAt: previous?.lastAttemptAt || null,
    notification: 'none',
    probes: results.map((result) => ({
      ...result,
      degradedSince: result.degraded
        ? (continuous && previous.probes.find((item) => item.name === result.name)?.degradedSince) || sampledAt
        : null,
    })),
  };
}

function createConnectivityMonitor({ config, store = repository, runProbe = probe,
  send = sendPushoverNotification, log = logger, clock = () => new Date() }) {
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
  async function tick() {
    if (running) return { skipped: true };
    running = true;
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
      const results = await Promise.all(probeTargets(config).map((target) => runProbe(target, config)));
      const sample = advance(previous, results, sampledAt, config);
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
            message: `Repeated slow or failed small HTTPS probes for at least ${Math.floor(config.sustainedMs / 60000)} minutes: ${sustained.map((item) => item.name).join(', ')}. Check connectivity history. This does not identify Wi-Fi, ISP or tunnel as the cause.` });
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
