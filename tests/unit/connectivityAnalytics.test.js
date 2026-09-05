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
