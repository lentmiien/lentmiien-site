const { spawnSync } = require('child_process');
const { clockEvidence, boundedRunWire } = require('../../services/localAi/clock');
const { Gateway } = require('../../services/localAi/gateway');
const { runWire } = require('../../services/localAi/policy');
const HOUR = 3600000;
const now = Date.parse('2026-10-17T00:35:04.135Z');
function sample(siteNow = now, gatewayNow = now, rtt = 50, headers = {}) {
  return clockEvidence({ date: new Date(gatewayNow).toUTCString(), ...headers }, siteNow - rtt, siteNow, rtt, 100);
}
describe('bounded Gateway HTTP clock', () => {
  test.each([-119000, -36000, 0, 36000, 119000])('manual bounds enclose Date precision and skew %i', skew => {
    const site = now + skew;
    const wire = boundedRunWire('manual', new Date(site), sample(site), 100, new Date(site + 5 * HOUR));
    expect(+new Date(wire.deadline)).toBeLessThanOrEqual(now + 5 * HOUR);
    expect(+new Date(wire.deadline)).toBeLessThanOrEqual(site + 5 * HOUR);
    expect(+new Date(wire.not_before)).toBeLessThan(now + 60000);
    expect(+new Date(wire.deadline) - +new Date(wire.not_before)).toBeLessThan(5 * HOUR);
  });
  test.each([
    { date: 'bad' }, { date: '2026-10-17T00:35:04Z' }, { date: ['Sat, 17 Oct 2026 00:35:04 GMT'] },
    { date: new Date(now - 121000).toUTCString() }, { date: new Date(now + 121000).toUTCString() },
    { age: '1' }, { age: 'invalid' }, { 'cf-cache-status': 'HIT' }, { 'x-cache': 'HIT' },
  ])('rejects malformed/stale/cached evidence %j', headers => expect(() => sample(now, now, 50, headers)).toThrow('gateway_clock_uncertain'));
  test('rejects absent Date, excessive RTT, local clock steps and stale samples', () => {
    expect(() => sample(now, now, 2001)).toThrow('gateway_clock_uncertain');
    expect(() => clockEvidence({}, now, now, 0, 100)).toThrow('gateway_clock_uncertain');
    expect(() => clockEvidence({ date: new Date(now).toUTCString() }, now - 1000, now, 10, 100)).toThrow('gateway_clock_uncertain');
    for (const age of [-1, 5001]) expect(() => boundedRunWire('manual', new Date(now + age), sample(), 100 + age, new Date(now + 5 * HOUR))).toThrow('gateway_clock_uncertain');
    expect(() => boundedRunWire('manual', new Date(now + 10000), sample(), 100, new Date(now + 5 * HOUR))).toThrow('gateway_clock_uncertain');
  });
  test('initial waiting time and original anchored budget survive later cohorts and restarts', () => {
    const click = now - HOUR, absolute = new Date(click + 5 * HOUR), site = now + 36000;
    const first = boundedRunWire('manual', new Date(site), sample(site), 100, absolute);
    const later = site + HOUR;
    const second = boundedRunWire('manual', new Date(later), sample(later, now + HOUR), 100, absolute, new Date(first.deadline));
    expect(second.deadline).toBe(first.deadline);
    expect(+new Date(first.deadline)).toBeLessThanOrEqual(+absolute - 36000);
  });
  test.each(['2026-10-16T15:59:59Z', '2026-10-16T16:00:00Z', '2026-10-16T20:59:58Z', '2026-10-16T21:00:00Z'])('automatic uncertainty across 01/06 fails closed: %s', date => {
    const time = Date.parse(date);
    expect(() => boundedRunWire('automatic', new Date(time), sample(time, time), 100)).toThrow('gateway_clock_window_uncertain');
  });
  test('manual cutoff ambiguity fails closed and deadlines never cross 06 JST', () => {
    const time = Date.parse('2026-10-16T20:59:00Z');
    const wire = boundedRunWire('manual', new Date(time), sample(time, time), 100, new Date(time + 5 * HOUR));
    expect(wire.deadline).toBe('2026-10-16T20:59:59.000Z');
    const cutoff = time + 60000;
    expect(() => boundedRunWire('manual', new Date(cutoff), sample(cutoff, cutoff), 100, new Date(cutoff + 5 * HOUR))).toThrow('gateway_clock_window_uncertain');
  });
  test('automatic dispatch waits for Gateway 01 and refuses Gateway 06 despite Site skew', () => {
    for (const [site, gateway] of [
      ['2026-10-16T16:00:20Z', '2026-10-16T15:59:44Z'],
      ['2026-10-16T20:59:40Z', '2026-10-16T21:00:16Z'],
    ]) {
      const local = Date.parse(site), remote = Date.parse(gateway);
      expect(() => boundedRunWire('automatic', new Date(local), sample(local, remote), 100)).toThrow('gateway_clock_window_uncertain');
    }
  });
  test('Date refreshed one second ago plus full-second precision remains conservative', () => {
    const evidence = sample(now, now - 1900, 2000);
    const wire = boundedRunWire('manual', new Date(now), evidence, 100, new Date(now + 5 * HOUR));
    expect(+new Date(wire.deadline)).toBeLessThan(now + 5 * HOUR);
    expect(+new Date(wire.not_before)).toBeLessThan(now + 60000);
  });
  test('fresh passive capabilities probe bypasses caches and never uses readiness observed_at', async () => {
    const http = { request: jest.fn().mockResolvedValue({ data: { protocol: 'durable-local-ai' }, headers: { date: new Date(now).toUTCString() } }) };
    let mono = 0;
    const gateway = new Gateway({ http, now: () => now, monotonic: () => mono++, getConfig: () => ({ origin: 'http://gateway.test', token: 'x'.repeat(40), client: 'site-test' }) });
    expect((await gateway.admissionClock()).clock.lower).toBeLessThan(now);
    await gateway.admissionClock();
    const requests = http.request.mock.calls.map(([request]) => request);
    expect(requests[0]).toMatchObject({ method: 'GET', maxRedirects: 0, timeout: 15000, headers: { 'Cache-Control': 'no-cache, no-store', Pragma: 'no-cache' } });
    expect(requests[0].url).toMatch(/^http:\/\/gateway.test\/batch\/capabilities\?clock_probe=/);
    expect(requests[0].url).not.toBe(requests[1].url);
    http.request.mockResolvedValueOnce({ status: 200, data: { observed_at: new Date(now).toISOString() }, headers: {} });
    await expect(gateway.admissionClock()).rejects.toMatchObject({ code: 'gateway_clock_uncertain', httpStatus: 200 });
  });
});

const protocol = process.env.LOCAL_AI_GATEWAY_CHECKOUT && process.env.LOCAL_AI_GATEWAY_PYTHON ? describe : describe.skip;
protocol('exact d566158 Gateway router and SQLite journal (offline)', () => {
  test('skew/precision/RTT/cutoff bounds, immutable replay and original rejection', () => {
    const cases = [];
    for (const mode of ['manual', 'automatic']) {
      for (const base of [Date.parse('2026-10-16T16:00:10Z'), Date.parse('2026-10-16T20:59:40Z'), now]) {
        if (mode === 'automatic' && base === now) continue;
        for (const skew of [-119000, -36000, 0, 36000, 119000]) {
          for (const rtt of [0, 2000]) {
            const site = base + skew;
            let wire;
            try { wire = boundedRunWire(mode, new Date(site), sample(site, base, rtt), 100, new Date(runWire('manual', new Date(site)).deadline)); }
            catch (error) { expect(error.code).toBe('gateway_clock_window_uncertain'); continue; }
            const id = `case_${cases.length}`;
            cases.push({ id, now: base, wire });
            cases.push({ id, now: base + 6 * HOUR, wire }); // immutable replay before bounds validation
          }
        }
      }
    }
    const invalid = runWire('manual', new Date(now + 36000));
    cases.push({ id: 'old_skewed_wire', now, wire: invalid });
    cases.push({ id: 'old_skewed_wire', now: now + 40000, wire: invalid });
    cases.push({ id: 'old_skewed_wire', now: now + 40000, wire: { ...invalid, deadline: new Date(now + HOUR).toISOString() } });
    const result = spawnSync(process.env.LOCAL_AI_GATEWAY_PYTHON, ['tests/helpers/localAiPinnedValidator.py', process.env.LOCAL_AI_GATEWAY_CHECKOUT], {
      input: JSON.stringify(cases), encoding: 'utf8', timeout: 30000,
    });
    expect(result.stderr).toBe(''); expect(result.status).toBe(0);
    const responses = JSON.parse(result.stdout);
    for (const response of responses.slice(0, -3)) expect(response.status).toBe(200);
    expect(responses.at(-3)).toMatchObject({ status: 422, body: { detail: { code: 'invalid_manual_deadline' } } });
    expect(responses.at(-2)).toMatchObject({ status: 200, body: { status: 'open', operations: [] } });
    expect(responses.at(-1)).toMatchObject({ status: 409, body: { detail: { code: 'immutable_run_conflict' } } });
  });
});
