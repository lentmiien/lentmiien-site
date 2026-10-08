jest.mock('../../utils/logger', () => ({ warning: jest.fn() }));
const { normalizeMonitoring, createMonitoringService } = require('../../services/aiGatewayMonitoringService');
const NOW = Date.parse('2026-10-08T09:00:00Z');
function fixture(container = {}, probe = {}) {
  return {
    health: { ok: true, status: 'ok', failures: [], upstreams: { voicevox: { ok: true, status_code: 200, ...probe } }, containers: {} },
    containers: { docker_available: true, containers: [{ id: 'voicevox', state: 'running', running: true, default_state: 'running', gpu_role: 'none', idle_warm: false, auto_start_for_job: false, post_job: 'none', ...container }] },
    queue: { running: true, closed: false, active: null, queue_depth: 0 },
    reservation: { active: false, service: null },
  };
}
const first = raw => normalizeMonitoring(raw, NOW).services[0];
test('stopped required Voicevox is unavailable despite degraded HTTP 200 and repeated evidence', () => {
  const raw = fixture({ state: 'exited', running: false }, { ok: false, error: 'private error' });
  raw.health.ok = false;
  raw.health.failures = [{ id: 'voicevox', kind: 'upstream', detail: 'secret' }, { id: 'voicevox', kind: 'container', detail: 'private' }];
  const result = normalizeMonitoring(raw, NOW);
  expect(result.status).toBe('Gateway reports degradation');
  expect(result.services).toHaveLength(1);
  expect(result.services[0]).toMatchObject({ availability: 'Unavailable — expected running', guidance: 'voicevox', model: 'Unknown' });
  expect(result.services[0].evidence.filter(line => line.startsWith('Gateway failure'))).toHaveLength(2);
});
test('healthy CPU responsiveness does not invent model readiness or GPU residency', () => {
  expect(first(fixture())).toMatchObject({ tone: 'normal', availability: 'Responsive', model: 'Unknown', owner: 'None observed' });
  expect(first(fixture()).policy).toContain('GPU role: none');
});
test('recoverable heavy suspension is on demand and makes no stop-cause claim', () => {
  const service = first(fixture({ gpu_role: 'heavy', state: 'exited', running: false, default_state: 'managed', auto_start_for_job: true }, { ok: true, status: 'suspended', reason: 'gpu_idle', recoverable: true }));
  expect(service).toMatchObject({ availability: 'Available on demand', tone: 'normal', model: 'Unknown' });
  expect(service.evidence.join(' ')).toContain('stop cause and maintenance intent are unknown');
});
test.each(['missing', 'not_found', 'unknown', 'error', 'inspection_error'])('%s never becomes healthy idle merely because Docker is available', state => {
  expect(first(fixture({ gpu_role: 'heavy', state }, { ok: true, status: 'suspended', recoverable: true })).tone).not.toBe('normal');
});
test('unrecoverable stopped GPU needs preparation investigation', () => {
  expect(first(fixture({ gpu_role: 'heavy', state: 'exited' }, { status: 'suspended', ok: false, recoverable: false }))).toMatchObject({ availability: 'Automatic startup unavailable', guidance: 'preparation' });
});
test.each([
  [{ model_state: 'not_loaded' }, 'Unloaded'], [{ model_state: 'ready' }, 'Ready'],
  [{ model_ready: true }, 'Ready'], [{ model_ready: false }, 'Not ready'],
  [null, 'Unknown'], [[], 'Unknown'], [42, 'Unknown'], ['ready', 'Unknown'],
])('model readiness uses only supported structured signals %p', (json, model) => {
  expect(first(fixture({ gpu_role: 'heavy' }, { json })).model).toBe(model);
});
test.each(['preparing', 'running', 'cleaning'])('aggregate busy wins over nested timeout during %s', phase => {
  const raw = fixture({ gpu_role: 'heavy' }, { ok: true, status: 'busy', probe: { ok: false, timeout: true } });
  raw.queue.active = { service: 'voicevox|private-affinity', phase };
  expect(first(raw)).toMatchObject({ availability: 'Busy / owned work', tone: 'normal', owner: `Job: ${phase}` });
});
test('embeddings defer warming during training or reservation without alarm', () => {
  const raw = fixture({ gpu_role: 'resident', idle_warm: true, state: 'exited' }, { ok: true, status: 'suspended', recoverable: true });
  raw.queue.active = { service: 'lentmiien_training|private-affinity', phase: 'running' };
  raw.reservation = { active: true, service: 'heavy', phase: 'active', dispatch_paused: true };
  const result = normalizeMonitoring(raw, NOW);
  expect(result.services[0]).toMatchObject({ availability: 'Suspended — idle warming deferred', tone: 'normal' });
  expect(result.context.join(' ')).toContain('lentmiien_training');
  expect(result.context.join(' ')).toContain('dispatch paused: true');
  expect(result.context.join(' ')).not.toContain('private-affinity');
});
test('reservation ownership and manager verified unloading are separate observations', () => {
  const raw = fixture({ gpu_role: 'heavy' }, { json: { model_state: 'not_loaded' } });
  raw.reservation = { active: true, service: 'voicevox', phase: 'active' };
  raw.health.gpu_resource_manager = { verified_unloaded_services: ['voicevox'] };
  expect(first(raw)).toMatchObject({ model: 'Unloaded', owner: 'Reservation: active', tone: 'normal' });
  expect(first(raw).evidence.join(' ')).toContain('not a per-service VRAM measurement');
});
test('semantic errors and manager/release failures surface; sticky hook errors stay historical', () => {
  const raw = fixture({}, { semantic_error: 'private model path' });
  raw.health.gpu_resource_manager = { degraded: true, degraded_reason: 'private reason' };
  raw.reservation = { active: true, service: 'voicevox', phase: 'release_failed' };
  raw.queue.last_hook_error = 'private history';
  const result = normalizeMonitoring(raw, NOW);
  expect(result.status).toBe('Gateway reports degradation');
  expect(result.services[0].tone).toBe('failure');
  expect(result.context.join(' ')).toMatch(/Resource manager degraded/);
  expect(result.context.join(' ')).toMatch(/Historical queue hook error/);
  expect(JSON.stringify(result)).not.toContain('private');
});
test('catalog deduplicates and prevents legacy health aliases from creating cards', () => {
  const raw = fixture();
  raw.containers.containers.push({ ...raw.containers.containers[0] });
  raw.health.containers.lentmiienlm_train = { state: 'running' };
  expect(normalizeMonitoring(raw, NOW).services).toHaveLength(1);
});
test('disagreeing non-atomic snapshots do not display healthy', () => {
  const raw = fixture(); raw.health.containers.voicevox = { state: 'exited' };
  expect(first(raw).tone).toBe('unknown');
});
test.each([null, {}, [], '<html>', { containers: [null] }])('malformed catalog fails closed %p', containers => {
  const result = normalizeMonitoring({ ...fixture(), containers }, NOW);
  expect(result.complete).toBe(false);
  expect(result.services[0]).toMatchObject({ state: 'unknown', tone: 'unknown' });
  expect(result.services[0].policy).toContain('GPU role: unknown');
});
test('failed health keeps container evidence but removes prior availability', () => {
  const result = normalizeMonitoring({ ...fixture(), health: null }, NOW);
  expect(result.status).toBe('Health monitoring unavailable');
  expect(result.complete).toBe(false);
  expect(result.services[0]).toMatchObject({ state: 'running', availability: 'Health unavailable', tone: 'unknown' });
});
test('arbitrary payloads, URLs, identifiers, paths, errors and job IDs never leave sanitizer', () => {
  const raw = fixture({}, { json: { error: 'SECRET', text: 'PERSONAL', model_state: '<script>SECRET</script>' }, error: 'http://user:SECRET@host/private', semantic_error: '/private/SECRET' });
  raw.queue.active = { id: 'SECRET', service: '<script>SECRET</script>', phase: 'SECRET' };
  raw.containers.containers.push({ id: '<script>SECRET</script>' });
  raw.health.failures = [{ kind: 'SECRET', id: 'SECRET', detail: 'SECRET' }];
  expect(JSON.stringify(normalizeMonitoring(raw, NOW))).not.toMatch(/SECRET|PERSONAL|<script>|\/private/);
});

describe('bounded snapshot fetching', () => {
  let clock, http, log, service, raw;
  beforeEach(() => {
    clock = NOW; raw = fixture();
    http = { get: jest.fn(async url => ({ data: raw[Object.entries({ health: '/health', containers: '/containers', queue: '/gpu/queue', reservation: '/gpu/reservation' }).find(([, suffix]) => url.endsWith(suffix))[0]] })), post: jest.fn() };
    log = { warning: jest.fn() };
    service = createMonitoringService({ baseUrl: 'http://gateway.invalid', headers: () => ({ 'X-Admin-Token': 'secret' }), http, log, now: () => clock });
  });
  test('four fixed GETs, no inference/mutations/fanout; cache and single-flight across callers', async () => {
    const [one, two] = await Promise.all([service.get(), service.get()]);
    expect(one).toBe(two); expect(http.get).toHaveBeenCalledTimes(4);
    expect(await service.get()).toBe(one);
    expect(http.post).not.toHaveBeenCalled();
    http.get.mock.calls.forEach(([url, config]) => {
      expect(config).toMatchObject({ timeout: 5000, maxContentLength: 1048576, maxRedirects: 0 });
      expect(config.headers).toEqual(url.endsWith('/containers') ? { 'X-Admin-Token': 'secret' } : {});
      expect(config.validateStatus(503)).toBe(url.endsWith('/health'));
      expect(config.validateStatus(200)).toBe(true);
      expect(config.validateStatus(302)).toBe(false);
    });
    expect(JSON.stringify(one)).not.toContain('secret');
  });
  test('dashboard snapshots seed cache without refetching', async () => {
    service.observe(raw); await service.get(); expect(http.get).not.toHaveBeenCalled();
  });
  test('failed refresh replaces healthy cache; failure transition logged once without payload', async () => {
    await service.get(); clock += 16000;
    http.get.mockRejectedValue(new Error('SECRET token private path'));
    const failed = await service.get();
    expect(failed.services).toEqual([]); expect(failed.complete).toBe(false);
    expect(failed.fetchedAt).toBe(new Date(clock).toISOString());
    clock += 16000; await service.get();
    expect(log.warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(log.warning.mock.calls)).not.toContain('SECRET');
  });
});


test('inspection failure overrides an otherwise successful probe', () => {
  const raw = fixture(); raw.health.failures = [{ kind: 'inspection', id: 'voicevox' }];
  expect(first(raw)).toMatchObject({ tone: 'unknown', availability: 'Inspection unknown' });
});
test('known stopped CPU remains actionable even if health endpoint is unavailable', () => {
  const raw = fixture({ state: 'exited', running: false }); raw.health = null;
  expect(first(raw)).toMatchObject({ tone: 'failure', availability: 'Unavailable — expected running' });
});
test('explicit model failure overrides transport success', () => {
  expect(first(fixture({}, { json: { model_state: 'error' } })).tone).toBe('failure');
});

test('missing Voicevox links to provisioning, not targeted start recovery', () => {
  expect(first(fixture({ state: 'missing', running: false }, { ok: false }))).toMatchObject({ guidance: 'missing', tone: 'failure' });
});
