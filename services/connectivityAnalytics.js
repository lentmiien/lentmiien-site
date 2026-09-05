const { probeTargets } = require('./connectivityProbe');

const MAX_SAMPLES = 5000;
const MAX_STRETCHES = 200;
const DETAIL_LIMIT = 360;
const PROBES = [
  { name: 'internet', label: 'Internet · Google', scope: 'external' },
  { name: 'cloudflare', label: 'Cloudflare edge', scope: 'external' },
  { name: 'publicApp', label: 'Public app', scope: 'external' },
  { name: 'localHealth', label: 'LOCAL health', scope: 'local' },
  { name: 'database', label: 'DB ping', scope: 'local' },
];
const OUTCOMES = new Set(['ok', 'timeout', 'unsafe_address', 'http_status', 'oversized',
  'connection_error', 'unexpected_response', 'dns_error', 'unavailable']);
const PHASES = new Set(['dns', 'tcp', 'tls', 'headers', 'body', 'contract', 'database']);
const NOTIFICATIONS = new Set(['none', 'attempted', 'sent', 'failed', 'deferred']);
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const date = (value) => value && Number.isFinite(+new Date(value)) ? new Date(value).toISOString() : null;
const safeId = (value) => typeof value === 'string' && /^[a-zA-Z0-9-]{1,64}$/.test(value) ? value : null;

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

function normalizeProbe(probe, slowMs) {
  if (!probe) return null;
  const outcome = OUTCOMES.has(probe.outcome) ? probe.outcome : 'unknown';
  const latencyMs = finite(probe.latencyMs);
  const statusCode = Number.isInteger(probe.statusCode) && probe.statusCode >= 100 && probe.statusCode <= 599 ? probe.statusCode : null;
  const slow = typeof probe.slow === 'boolean' ? probe.slow
    : latencyMs !== null && slowMs !== null ? latencyMs >= slowMs : outcome === 'ok' && probe.degraded === true;
  return { name: probe.name, outcome, statusCode, latencyMs, slow,
    state: outcome === 'unknown' || outcome === 'unavailable' ? 'unknown' : outcome === 'ok' ? slow ? 'slow' : 'ok'
      : outcome === 'http_status' ? 'http_error' : ['unexpected_response', 'oversized'].includes(outcome) ? 'contract_error'
        : outcome === 'timeout' ? 'timeout' : 'connection_error',
    httpReachable: typeof probe.httpReachable === 'boolean' ? probe.httpReachable : statusCode !== null ? true : null,
    failurePhase: PHASES.has(probe.failurePhase) ? probe.failurePhase : null,
    // Codes are fixed by our writer; redact unrecognized legacy text rather than returning raw errors.
    errorCode: typeof probe.errorCode === 'string' && /^[A-Z][A-Z0-9_]{0,47}$/.test(probe.errorCode) ? probe.errorCode : null,
    timings: Object.fromEntries(['dnsMs', 'tcpMs', 'tlsMs', 'ttfbMs', 'totalMs'].map((key) => [key, finite(probe.timings?.[key])])),
  };
}

function recentStatus(latest, config, now = new Date()) {
  if (!config.enabled || !latest || latest.signature !== config.signature
    || !date(latest.sampledAt) || +new Date(latest.sampledAt) > +now
    || +now - new Date(latest.sampledAt) > config.maxGapMs) return 'unknown';
  const results = probeTargets(config).map(({ name }) => normalizeProbe(latest.probes?.find((probe) => probe.name === name), config.slowMs));
  if (results.some((probe) => !probe || probe.state === 'unknown')) return 'unknown';
  return results.some((probe) => probe.state !== 'ok') ? 'degraded' : 'ok';
}

function aggregateConnectivity(input, config, { since, until, truncated = false }) {
  const raw = input.filter((sample) => date(sample.sampledAt) && +new Date(sample.sampledAt) >= +since && +new Date(sample.sampledAt) < +until)
    .sort((a, b) => new Date(a.sampledAt) - new Date(b.sampledAt)).slice(-MAX_SAMPLES);
  const configs = new Map();
  const samples = raw.map((sample) => {
    const key = sample.signature || 'legacy';
    if (!configs.has(key)) configs.set(key, { id: `config-${configs.size + 1}`,
      current: key === config.signature, monitorVersion: safeId(sample.monitorVersion) || 'legacy',
      intervalMs: finite(sample.intervalMs), slowMs: finite(sample.slowMs), timeoutMs: finite(sample.timeoutMs) });
    return { sampledAt: date(sample.sampledAt), configId: configs.get(key).id,
      monitorVersion: safeId(sample.monitorVersion) || 'legacy',
      notification: NOTIFICATIONS.has(sample.notification) ? sample.notification : 'none',
      lastAttemptAt: date(sample.lastAttemptAt), runId: safeId(sample.runId), processId: safeId(sample.processId),
      processStartedAt: date(sample.processStartedAt), scheduledAt: date(sample.scheduledAt),
      startedAt: date(sample.startedAt), endedAt: date(sample.endedAt),
      runDurationMs: finite(sample.runDurationMs), schedulerLatenessMs: finite(sample.schedulerLatenessMs),
      probes: PROBES.map(({ name }) => normalizeProbe(
        [...(sample.probes || []), ...(sample.diagnostics || [])].find((probe) => probe.name === name),
        finite(sample.slowMs))).filter(Boolean) };
  });
  const expectedNames = new Set(probeTargets(config).map(({ name }) => name));
  const binCount = 240;
  const binMs = (+until - since) / binCount;
  const bins = Array.from({ length: binCount }, (_, index) => ({
    start: new Date(+since + index * binMs).toISOString(), end: new Date(+since + (index + 1) * binMs).toISOString(),
    samples: 0, probes: {}, configIds: [],
  }));
  const gaps = [];
  let previousAt = +since;
  let previousInterval = config.intervalMs;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const at = +new Date(sample.sampledAt);
    const interval = raw[index].intervalMs || config.intervalMs;
    if (at - previousAt > Math.max(previousInterval, interval) * 1.5) {
      gaps.push({ start: new Date(previousAt).toISOString(), end: sample.sampledAt, durationMs: at - previousAt,
        boundary: index === 0 ? 'window-start' : 'between-samples' });
    }
    previousAt = at;
    previousInterval = interval;
    const bin = bins[Math.min(binCount - 1, Math.floor((at - since) / binMs))];
    bin.samples += 1;
    if (!bin.configIds.includes(sample.configId)) bin.configIds.push(sample.configId);
    for (const probe of sample.probes) {
      const item = bin.probes[probe.name] ||= { counts: {}, successes: [] };
      item.counts[probe.state] = (item.counts[probe.state] || 0) + 1;
      if (probe.outcome === 'ok' && probe.latencyMs !== null) item.successes.push(probe.latencyMs);
    }
  }
  if (+until - previousAt > previousInterval * 1.5) gaps.push({ start: new Date(previousAt).toISOString(),
    end: until.toISOString(), durationMs: +until - previousAt, boundary: 'window-end' });
  for (const bin of bins) {
    for (const item of Object.values(bin.probes)) {
      item.p50Ms = percentile(item.successes, 0.5);
      item.p95Ms = percentile(item.successes, 0.95);
      delete item.successes;
    }
  }
  const incidents = [];
  const latest = samples.at(-1);
  const summaries = PROBES.map((definition) => {
    const counts = {};
    const codes = {};
    const latencies = [];
    let httpReachable = 0;
    let observed = 0;
    let streak = null;
    let previous = null;
    const close = (reason) => {
      if (streak) { incidents.push({ ...streak, endReason: reason }); streak = null; }
    };
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const probe = sample.probes.find(({ name }) => name === definition.name);
      const continuous = previous && previous.configId === sample.configId
        && +new Date(sample.sampledAt) > +new Date(previous.sampledAt)
        && new Date(sample.sampledAt) - new Date(previous.sampledAt) <= (raw[index - 1].intervalMs || config.intervalMs) * 1.5;
      if (!continuous) close(previous?.configId !== sample.configId ? 'configuration/boundary' : 'observation-gap');
      previous = sample;
      if (!probe || probe.state === 'unknown') close('missing-observation');
      if (!probe) continue;
      observed += 1;
      counts[probe.state] = (counts[probe.state] || 0) + 1;
      if (probe.httpReachable) httpReachable += 1;
      if (probe.outcome === 'ok' && probe.latencyMs !== null) latencies.push(probe.latencyMs);
      if (probe.state !== 'ok' && probe.state !== 'slow') {
        const code = [probe.outcome, probe.statusCode, probe.errorCode, probe.failurePhase].filter(Boolean).join(' · ');
        codes[code] = (codes[code] || 0) + 1;
      }
      if (!['ok', 'unknown'].includes(probe.state)) {
        if (!streak) streak = { probe: definition.name, start: sample.sampledAt, end: sample.sampledAt,
          configId: sample.configId, observations: 0, states: [] };
        streak.end = sample.sampledAt;
        streak.observations += 1;
        if (!streak.states.includes(probe.state)) streak.states.push(probe.state);
      } else if (probe.state === 'ok') close('observed-recovery');
    }
    close('window-end; recovery unobserved');
    const latestProbe = latest?.probes.find(({ name }) => name === definition.name);
    const fresh = config.enabled && raw.at(-1)?.signature === config.signature
      && +until - new Date(latest.sampledAt) <= config.maxGapMs;
    const successCount = (counts.ok || 0) + (counts.slow || 0);
    return { ...definition, configured: definition.scope === 'local' || expectedNames.has(definition.name), observed,
      missingInStoredRounds: samples.length - observed, counts, httpReachable, successCount,
      sampledSuccessPercent: observed ? successCount / observed * 100 : null,
      p50Ms: percentile(latencies, 0.5), p95Ms: percentile(latencies, 0.95), latencyObservations: latencies.length,
      latest: fresh && latestProbe ? latestProbe.state : 'unknown', latestProbe: latestProbe || null,
      codes: Object.entries(codes).map(([code, count]) => ({ code, count })) };
  });
  incidents.sort((a, b) => new Date(b.end) - new Date(a.end));
  const expectedRounds = Math.ceil((+until - since) / config.intervalMs);
  const occupiedSlots = new Set(samples.map((sample) => Math.floor((new Date(sample.sampledAt) - since) / config.intervalMs))).size;
  const notificationCounts = {};
  for (const sample of samples) notificationCounts[sample.notification] = (notificationCounts[sample.notification] || 0) + 1;
  return { since, until, enabled: config.enabled, status: recentStatus(raw.at(-1), config, until),
    publicAppConfigured: Boolean(config.publicOrigin), monitorVersion: config.monitorVersion,
    intervalMs: config.intervalMs, timeoutMs: config.timeoutMs, slowMs: config.slowMs,
    sustainedMs: config.sustainedMs, cooldownMs: config.cooldownMs, retentionDays: config.retentionDays,
    sampleCount: samples.length, latestAt: latest?.sampledAt || null, truncated,
    coverage: { expectedRounds, occupiedSlots, percent: occupiedSlots / expectedRounds * 100,
      cadenceChanged: [...configs.values()].some((item) => item.intervalMs !== config.intervalMs) },
    configurations: [...configs.values()], probes: summaries, bins, gaps: gaps.slice(-MAX_STRETCHES), gapCount: gaps.length,
    incidents: incidents.slice(0, MAX_STRETCHES), incidentCount: incidents.length,
    notifications: notificationCounts,
    alertAttempts: samples.filter((sample) => sample.notification !== 'none').reverse().slice(0, MAX_STRETCHES)
      .map(({ sampledAt, notification, lastAttemptAt }) => ({ sampledAt, notification, lastAttemptAt })),
    detailLimit: DETAIL_LIMIT, detailsTruncated: samples.length > DETAIL_LIMIT,
    samples: samples.slice(-DETAIL_LIMIT).reverse() };
}

module.exports = { aggregateConnectivity, recentStatus, percentile, MAX_SAMPLES };
