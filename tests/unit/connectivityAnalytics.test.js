const { aggregateConnectivity, recentStatus, percentile } = require('../../services/connectivityAnalytics');
const { getConnectivityConfig } = require('../../utils/connectivityConfig');
const config = getConnectivityConfig({});
const since = new Date('2026-09-05T00:00:00Z');
const until = new Date(+since + 3600000);
function sample(minute, probes, extra = {}) {
  return { sampledAt: new Date(+since + minute * 60000), signature: config.signature,
    monitorVersion: '2', intervalMs: config.intervalMs, slowMs: config.slowMs, probes, ...extra };
}
const ok = (latencyMs, name = 'internet') => ({ name, outcome: 'ok', statusCode: 204, latencyMs });
const timeout = { name: 'internet', outcome: 'timeout', latencyMs: 5000, failurePhase: 'dns', errorCode: 'DEADLINE_EXCEEDED' };

test('percentiles include only successful responses, count slow separately and distinguish HTTP reachability', () => {
  const result = aggregateConnectivity([sample(0, [ok(10)]), sample(2, [ok(2000)]), sample(4, [timeout]),
    sample(6, [{ name: 'internet', outcome: 'http_status', statusCode: 404, latencyMs: 30 }])], config, { since, until });
  expect(result.probes[0]).toMatchObject({ observed: 4, successCount: 2, sampledSuccessPercent: 50,
    p50Ms: 10, p95Ms: 2000, latencyObservations: 2, httpReachable: 3,
    counts: { ok: 1, slow: 1, timeout: 1, http_error: 1 } });
  expect(result.probes[1]).toMatchObject({ observed: 0, latest: 'unknown', sampledSuccessPercent: null });
  expect(result.coverage).toMatchObject({ expectedRounds: 30, occupiedSlots: 4 });
  expect(result.bins).toHaveLength(240);
  expect(result.bins.filter((b) => b.probes.internet?.counts.timeout)[0].probes.internet.p95Ms).toBeNull();
});

test('incidents split at gaps, recovery, missing probe, and config changes; boundary gaps remain unknown', () => {
  const rows = [sample(0, [timeout]), sample(2, [timeout]), sample(8, [timeout]), sample(10, []),
    sample(12, [timeout]), sample(14, [timeout], { signature: 'old' }), sample(16, [ok(5)])];
  const result = aggregateConnectivity(rows, config, { since, until });
  expect(result.incidents).toHaveLength(4);
  expect(result.incidents.find((i) => i.observations === 2)).toMatchObject({ start: since.toISOString(), endReason: 'observation-gap' });
  expect(result.incidents.some((i) => i.endReason === 'missing-observation')).toBe(true);
  expect(result.gaps).toHaveLength(2);
  expect(result.configurations).toHaveLength(2);
  expect(result.configurations[1]).toMatchObject({ current: false });
});

test('empty, stale, future, disabled, changed and incomplete observations cannot report healthy', () => {
  const result = aggregateConnectivity([], config, { since, until });
  expect(result).toMatchObject({ status: 'unknown', sampleCount: 0, coverage: { percent: 0 }, gapCount: 1 });
  expect(result.probes.every((p) => p.p95Ms === null)).toBe(true);
  const valid = sample(59, [ok(10), ok(10, 'cloudflare')]);
  expect(recentStatus(valid, config, until)).toBe('ok');
  for (const row of [null, sample(0, valid.probes), sample(61, valid.probes), sample(59, []),
    sample(59, [ok(10)]), { ...valid, signature: 'old' }]) expect(recentStatus(row, config, until)).toBe('unknown');
  expect(recentStatus(valid, { ...config, enabled: false }, until)).toBe('unknown');
});

test('legacy timeouts do not become success latencies, and no private fields or signatures escape analytics', () => {
  const result = aggregateConnectivity([sample(58, [timeout, { name: 'cloudflare', outcome: 'http_status', statusCode: 404,
    errorCode: 'https://private.example', url: 'private', body: 'secret' }], { monitorVersion: undefined, intervalMs: undefined,
    privateUrl: 'secret', notification: 'failed', lastAttemptAt: since })], config, { since, until });
  expect(result.samples[0].monitorVersion).toBe('legacy');
  expect(result.probes[0].p95Ms).toBeNull();
  expect(result.probes[1].counts.http_error).toBe(1);
  expect(result.notifications.failed).toBe(1);
  expect(result.alertAttempts).toHaveLength(1);
  expect(JSON.stringify(result)).not.toMatch(/private|secret|signature/);
});

test('duplicate rounds do not inflate coverage; out-of-range samples are excluded; nearest-rank percentile', () => {
  const result = aggregateConnectivity([sample(-1, []), sample(60, []), sample(0, []), sample(0, [])], config, { since, until, truncated: true });
  expect(result).toMatchObject({ sampleCount: 2, truncated: true, coverage: { occupiedSlots: 1 } });
  expect(percentile([], .95)).toBeNull();
  expect(percentile([50, 10, 30, 20, 40], .5)).toBe(30);
});


test('large windows retain full statistics but bound detailed JSON and alert metadata', () => {
  const finish = new Date(+since + 1440 * 60000);
  const rows = Array.from({ length: 700 }, (_, i) => sample(i * 2, [ok(i)], { notification: 'attempted' }));
  const result = aggregateConnectivity(rows, config, { since, until: finish });
  expect(result).toMatchObject({ sampleCount: 700, detailsTruncated: true, detailLimit: 360 });
  expect(result.samples).toHaveLength(360);
  expect(result.probes[0].observed).toBe(700);
  expect(result.alertAttempts).toHaveLength(200);
  expect(result.alertAttempts[0]).not.toHaveProperty('probes');
  expect(result.notifications.attempted).toBe(700);
});

const timed = (dnsMs, totalMs, name = 'publicApp', extra = {}) => ({
  ...ok(totalMs, name), timings: { dnsMs, totalMs }, ...extra,
});
const summaryFor = (rows, name = 'publicApp') => aggregateConnectivity(rows, config, { since, until })
  .probes.find((probe) => probe.name === name);

test('derives post-DNS per sample before nearest-rank percentiles in summaries and aligned bins', () => {
  // p95(total) - p95(DNS) = 100; actual p95(post-DNS) = 900.
  const rows = [sample(0, [timed(1000, 1100)]), sample(0.1, [timed(10, 910)]),
    sample(0.2, [timed(20, 30, 'cloudflare')]), sample(0.21, [timed(2, 7, 'internet')])];
  const result = aggregateConnectivity(rows, config, { since, until });
  expect(result.probes.find((p) => p.name === 'publicApp')).toMatchObject({
    p95Ms: 1100, successDurations: {
      dnsMs: { observations: 2, p50Ms: 10, p95Ms: 1000 },
      postDnsMs: { observations: 2, p50Ms: 100, p95Ms: 900 },
    },
  });
  expect(result.bins[0].probes.publicApp.successDurations.postDnsMs).toEqual({ observations: 2, p50Ms: 100, p95Ms: 900 });
  expect(result.bins[0].probes.cloudflare.successDurations.postDnsMs.p95Ms).toBe(10);
  expect(result.bins[0].probes.internet.successDurations.postDnsMs.p95Ms).toBe(5);
  expect(result.bins[1].probes).toEqual({});
});

test('legacy totals and missing boundaries remain unknown with independent observation counts', () => {
  const result = summaryFor([sample(0, [ok(800, 'publicApp')]), sample(2, [timed(50, undefined)]),
    sample(4, [timed(null, 400)]), sample(6, [timed(0, 0)])]);
  expect(result).toMatchObject({ successCount: 4, latencyObservations: 3, successDurations: {
    dnsMs: { observations: 2, p50Ms: 0, p95Ms: 50 },
    postDnsMs: { observations: 1, p50Ms: 0, p95Ms: 0 },
    tcpMs: { observations: 0, p50Ms: null, p95Ms: null },
  } });
});

test.each([null, undefined, '100', NaN, Infinity, -1])('invalid/missing DNS %s cannot become zero or post-DNS latency', (dnsMs) => {
  const result = summaryFor([sample(0, [timed(dnsMs, 500)])]);
  expect(result.successDurations.dnsMs).toEqual({ observations: 0, p50Ms: null, p95Ms: null });
  expect(result.successDurations.postDnsMs.observations).toBe(0);
});

test.each([
  { dnsMs: 501, totalMs: 500 },
  { dnsMs: 50, tcpMs: 40, totalMs: 500 },
  { dnsMs: 50, tcpMs: 80, tlsMs: 100, ttfbMs: 90, totalMs: 500 },
])('nonmonotonic milestones do not produce misleading derived timings: %j', (timings) => {
  const result = summaryFor([sample(0, [{ ...ok(500, 'publicApp'), timings }])]);
  expect(Object.values(result.successDurations).every((metric) => metric.observations === 0)).toBe(true);
  expect(result.p95Ms).toBe(500);
});

test('connection/TLS/response durations use adjacent milestones, with honest local/DB applicability', () => {
  const probes = [{ ...ok(200, 'publicApp'), timings: { dnsMs: 20, tcpMs: 50, tlsMs: 90, ttfbMs: 170, totalMs: 200 } }];
  const diagnostics = [{ ...ok(8, 'localHealth'), timings: { tcpMs: 2, ttfbMs: 7, totalMs: 8 } },
    { ...ok(4, 'database'), timings: { totalMs: 4 } }];
  const result = aggregateConnectivity([sample(0, probes, { diagnostics })], config, { since, until });
  expect(result.samples[0].probes[0].phaseDurations).toEqual({ dnsMs: 20, postDnsMs: 180, tcpMs: 30, tlsMs: 40, headersMs: 80, bodyMs: 30 });
  expect(result.samples[0].probes[1].phaseDurations).toEqual({ dnsMs: null, postDnsMs: null, tcpMs: 2, tlsMs: null, headersMs: 5, bodyMs: 1 });
  expect(Object.values(result.samples[0].probes[2].phaseDurations).every((value) => value === null)).toBe(true);
});

test.each(['timeout', 'http_status', 'unexpected_response', 'oversized', 'dns_error', 'connection_error', 'unsafe_address', 'unavailable'])('excludes %s durations from every success metric, retaining partial details', (outcome) => {
  const result = aggregateConnectivity([sample(0, [timed(1900, 5000, 'publicApp', { outcome, failurePhase: 'headers',
    timings: { dnsMs: 1900, tcpMs: 1910, tlsMs: 1930, totalMs: 5000 } })])], config, { since, until });
  const probe = result.probes.find((p) => p.name === 'publicApp');
  expect(probe.p95Ms).toBeNull();
  expect(Object.values(probe.successDurations).every((metric) => metric.observations === 0 && metric.p95Ms === null)).toBe(true);
  expect(result.bins[0].probes.publicApp.successDurations.postDnsMs.p95Ms).toBeNull();
  expect(result.samples[0].probes[0].phaseDurations.postDnsMs).toBe(3100);
});

test.each([
  ['dns', { totalMs: 5000 }, 5000],
  ['tcp', { dnsMs: 1900, totalMs: 5000 }, 3100],
  ['tls', { dnsMs: 1900, tcpMs: 1910, totalMs: 5000 }, 3090],
  ['headers', { tlsMs: 1930, totalMs: 5000 }, 3070],
  ['body', { ttfbMs: 2000, totalMs: 5000 }, 3000],
  ['contract', { ttfbMs: 2000, totalMs: 5000 }, null],
  ['tls', { dnsMs: 1900, totalMs: 5000 }, null],
  ['dns', {}, null],
  ['dns', { dnsMs: 1900, totalMs: 5000 }, null],
  ['tls', { tcpMs: 6000, totalMs: 5000 }, null],
  ['untrusted phase', { totalMs: 5000 }, null],
  [undefined, { totalMs: 5000 }, null],
])('timeout phase %s uses only recorded, valid boundaries (%j)', (failurePhase, timings, elapsedMs) => {
  const result = summaryFor([sample(0, [timed(null, 5000, 'publicApp', { outcome: 'timeout', failurePhase, timings })])]);
  expect(result.latestProbe.timeout).toEqual({ phase: ['untrusted phase', undefined].includes(failurePhase) ? null : failurePhase, elapsedMs });
});

test('full-window phase statistics survive detail truncation, without changing inputs', () => {
  const rows = Array.from({ length: 400 }, (_, i) => sample(i / 10, [timed(i, i + 100)]));
  const before = JSON.stringify(rows);
  const result = aggregateConnectivity(rows, config, { since, until });
  expect(result.samples).toHaveLength(360);
  expect(result.probes.find((p) => p.name === 'publicApp').successDurations.postDnsMs).toEqual({ observations: 400, p50Ms: 100, p95Ms: 100 });
  expect(JSON.stringify(rows)).toBe(before);
});
