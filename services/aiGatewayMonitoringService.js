const axios = require('axios');
const logger = require('../utils/logger');

const PATHS = { health: '/health', containers: '/containers', queue: '/gpu/queue', reservation: '/gpu/reservation' };
const CACHE_MS = 15000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const record = value => object(value) ? value : {};
const choice = (value, choices, fallback = 'unknown') => choices.includes(value) ? value : fallback;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value) ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const owns = (value, id) => typeof value === 'string' && value.split('|')[0] === id;
const valid = {
  health: value => object(value) && typeof value.ok === 'boolean'
    && object(value.upstreams) && Object.keys(value.upstreams).length <= 200
    && Object.values(value.upstreams).every(probe => object(probe) && typeof probe.ok === 'boolean')
    && Array.isArray(value.failures) && value.failures.length <= 200 && value.failures.every(object),
  containers: value => object(value) && Array.isArray(value.containers) && value.containers.length <= 200 && value.containers.every(entry => object(entry) && identifier(entry.id)),
  queue: value => object(value) && typeof value.running === 'boolean' && (value.active === null || object(value.active)),
  reservation: value => object(value) && typeof value.active === 'boolean',
};

function normalizeMonitoring(raw, now = Date.now()) {
  const sources = Object.keys(PATHS).map(key => ({ key, available: valid[key](raw[key]) }));
  const sourceOk = key => sources.find(source => source.key === key).available;
  const health = sourceOk('health') ? raw.health : {};
  const catalog = sourceOk('containers') ? raw.containers.containers : [];
  const queue = sourceOk('queue') ? raw.queue : {};
  const reservation = sourceOk('reservation') ? raw.reservation : {};
  const manager = record(health.gpu_resource_manager);
  const failures = Array.isArray(health.failures) ? health.failures.slice(0, 200) : [];
  const entries = new Map();
  catalog.slice(0, 200).forEach(entry => {
    if (object(entry) && identifier(entry.id)) entries.set(entry.id, entry);
  });
  // Without the authoritative catalog, show observed upstreams with unknown policy.
  if (!sourceOk('containers')) Object.keys(record(health.upstreams)).slice(0, 200).forEach(id => {
    if (identifier(id)) entries.set(id, { id });
  });
  const services = Array.from(entries, ([id, container]) => {
    const probe = record(record(health.upstreams)[id]);
    const observed = record(record(health.containers)[id]);
    const state = choice(container.state ?? observed.state, ['running', 'exited', 'stopped', 'created', 'paused', 'restarting', 'dead', 'missing', 'not_found', 'unknown', 'error', 'inspection_error']);
    const role = choice(container.gpu_role, ['none', 'resident', 'heavy']);
    const expected = choice(container.default_state, ['running', 'stopped', 'managed']);
    const gpu = role === 'resident' || role === 'heavy';
    const owner = owns(queue.active?.service, id) ? `Job: ${choice(queue.active.phase, ['preparing', 'running', 'cleaning'])}`
      : reservation.active === true && reservation.service === id ? `Reservation: ${choice(reservation.phase, ['activating', 'active', 'expiring', 'stopping', 'release_failed'])}`
        : manager.manual_owner_service === id ? 'Manual GPU owner' : sourceOk('queue') && sourceOk('reservation') ? 'None observed' : 'Unknown (partial monitoring)';
    const evidence = [];
    const serviceFailures = failures.filter(failure => object(failure) && failure.id === id);
    const failureCounts = new Map();
    serviceFailures.forEach(failure => {
      const kind = choice(failure.kind, ['upstream', 'container', 'inspection', 'configuration', 'gpu_resource_manager']);
      failureCounts.set(kind, (failureCounts.get(kind) || 0) + 1);
    });
    failureCounts.forEach((total, kind) => evidence.push(`Gateway failure: ${kind} (${total} report(s); details withheld; inspect host logs)`));
    if (Number.isInteger(probe.status_code) && probe.status_code >= 100 && probe.status_code <= 599) evidence.push(`Probe HTTP ${probe.status_code}`);
    if (probe.timeout === true) evidence.push('Probe timed out');
    if (probe.error || probe.probe_error) evidence.push('Probe error reported (details withheld)');
    if (probe.semantic_error) evidence.push('Semantic/model error reported (details withheld)');
    if (record(probe.probe).timeout === true || record(probe.probe).ok === false) evidence.push('Nested probe failed; aggregate availability takes precedence during owned work');
    const modelJson = record(probe.json);
    let model = modelJson.model_state === 'not_loaded' ? 'Unloaded' : modelJson.model_state === 'ready' || modelJson.model_ready === true ? 'Ready' : modelJson.model_ready === false ? 'Not ready' : 'Unknown';
    if (Array.isArray(manager.verified_unloaded_services) && manager.verified_unloaded_services.includes(id)) {
      evidence.push('Manager verified unloaded snapshot; not a per-service VRAM measurement');
      if (model === 'Unknown') model = 'Unloaded (manager snapshot)';
      else if (model === 'Ready') evidence.push('Model and manager snapshots disagree; refresh after transition');
    }
    const stopped = ['exited', 'stopped', 'created', 'dead'].includes(state);
    const inspectionUnknown = ['unknown', 'error', 'inspection_error'].includes(state);
    let availability = 'Unknown';
    let tone = 'unknown';
    let guidance = 'monitoring';
    const set = (label, level, guide) => { availability = label; tone = level; guidance = guide; };
    if (['missing', 'not_found'].includes(state)) set('Missing / not installed', 'failure', 'missing');
    else if (inspectionUnknown || serviceFailures.some(failure => failure.kind === 'inspection')) set('Inspection unknown', 'unknown', 'monitoring');
    else if (role === 'none' && expected === 'running' && stopped) set('Unavailable — expected running', 'failure', id === 'voicevox' ? 'voicevox' : 'cpu');
    else if (gpu && stopped && probe.recoverable === false) set('Automatic startup unavailable', 'failure', 'preparation');
    else if (!sourceOk('health')) set('Health unavailable', 'unknown', 'monitoring');
    else if (probe.semantic_error || ['error', 'failed'].includes(modelJson.model_state) || (probe.ok === false && probe.status !== 'suspended')) set('Unavailable — probe failed', 'failure', 'probe');
    else if (serviceFailures.length) set('Gateway reports service failure', 'failure', 'probe');
    else if (probe.ok === true && probe.status === 'busy') set('Busy / owned work', 'normal', 'idle');
    else if (gpu && probe.ok === true && probe.status === 'suspended' && probe.recoverable === true) {
      set(container.idle_warm === true ? 'Suspended — idle warming deferred' : 'Available on demand', 'normal', 'idle');
      evidence.push('Recoverable suspension; stop cause and maintenance intent are unknown');
    } else if (probe.ok === true && state === 'running' && container.running !== false) set(model.startsWith('Unloaded') ? 'Responsive — model unloaded' : 'Responsive', 'normal', 'idle');
    else if (['restarting', 'paused'].includes(state) || owner.startsWith('Job:') || owner.startsWith('Reservation:') || owner === 'Manual GPU owner') set('Transition / owned work — readiness unknown', 'unknown', 'queue');
    else if (stopped) set('Stopped — availability unknown', 'unknown', 'monitoring');
    if (id === 'voicevox' && role === 'none' && guidance === 'probe') guidance = 'voicevox';
    if (observed.state && container.state && observed.state !== container.state) {
      evidence.push('Non-atomic container snapshots disagree; refresh after transition');
      if (tone === 'normal') set('Transition — snapshots disagree', 'unknown', 'monitoring');
    }
    if (role === 'resident' && container.idle_warm === true) evidence.push('Idle resident: yields to jobs, reservations or training; warming can be delayed');
    return {
      id, state, availability, tone, model, owner, guidance, evidence: [...new Set(evidence)],
      policy: `GPU role: ${role}; default: ${expected}; idle warm: ${choice(container.idle_warm, [true, false])}; auto-start for job: ${choice(container.auto_start_for_job, [true, false])}; post-job: ${choice(container.post_job, ['none', 'stop', 'unload'])}`,
    };
  });
  services.sort((a, b) => ({ failure: 0, unknown: 1, normal: 2 }[a.tone] - { failure: 0, unknown: 1, normal: 2 }[b.tone]) || a.id.localeCompare(b.id));
  const context = [
    `Scheduler: ${choice(queue.running, [true, false])}; closed: ${choice(queue.closed, [true, false])}; queued: ${count(queue.queue_depth) ?? 'unknown'}. Scheduler running does not mean GPU busy.`,
    `GPU job owner: ${identifier(typeof queue.active?.service === 'string' ? queue.active.service.split('|')[0] : null) || (queue.active === null ? 'none' : 'unknown')}; phase: ${choice(queue.active?.phase, ['preparing', 'running', 'cleaning'])}.`,
    `Reservation: ${reservation.active === true ? 'active' : reservation.active === false ? 'inactive' : 'unknown'}; service: ${identifier(reservation.service) || 'unknown'}; phase: ${choice(reservation.phase, ['activating', 'active', 'expiring', 'stopping', 'release_failed'])}; dispatch paused: ${choice(reservation.dispatch_paused, [true, false])}; blocked: ${count(reservation.blocked_queue_depth) ?? 'unknown'}.`,
    `Manual GPU owner: ${identifier(manager.manual_owner_service) || 'none / unknown'}. Active reservations retain their service and can suppress embeddings. Training may use idle capacity.`,
    `Docker available: ${choice(raw.containers?.docker_available, [true, false])}; telemetry available: ${choice(manager.telemetry_available, [true, false])}. Docker availability alone does not prove inspection succeeded.`,
  ];
  if (manager.degraded === true) context.push('Resource manager degraded: inspect host logs for the reason, ownership, cleanup and host VRAM before further GPU work. Details withheld.');
  if (reservation.phase === 'release_failed') context.push('Reservation release failed: operator investigation required; do not force release or unload.');
  if (queue.last_hook_error) context.push('Historical queue hook error recorded (untimestamped/sticky); not proof of a current failure. Inspect Gateway logs.');
  failures.forEach(failure => {
    if (object(failure)) context.push(`Health failure: ${choice(failure.kind, ['upstream', 'container', 'inspection', 'configuration', 'gpu_resource_manager'])}; service: ${entries.has(failure.id) ? failure.id : 'unmapped / global'}. Details withheld; inspect host logs.`);
  });
  const complete = sources.every(source => source.available);
  return {
    fetchedAt: new Date(now).toISOString(), staleAfterMs: 60000, complete, sources, services,
    status: !sourceOk('health') ? 'Health monitoring unavailable' : health.ok === false || health.status === 'degraded' || services.some(service => service.tone === 'failure') || failures.length || manager.degraded === true || reservation.phase === 'release_failed' ? 'Gateway reports degradation' : 'Gateway reports healthy',
    context: [...new Set(context)],
  };
}

function createMonitoringService({ baseUrl, headers = () => ({}), http = axios, log = logger, now = Date.now }) {
  let cached;
  let inFlight;
  let lastProblems = '';
  let lastDegradation = '';
  const observe = raw => {
    cached = normalizeMonitoring(raw, now());
    const problems = cached.sources.filter(source => !source.available).map(source => source.key).join(',');
    if (problems && problems !== lastProblems) log.warning('AI Gateway service monitoring incomplete; check endpoint availability and schema', { category: 'ai_gateway', metadata: { endpoints: problems } });
    lastProblems = problems;
    const degradation = cached.status === 'Gateway reports degradation'
      ? cached.services.filter(service => service.tone === 'failure').map(service => service.id).join(',') || 'global' : '';
    if (degradation && degradation !== lastDegradation) log.warning('AI Gateway reports degraded service availability; review monitoring and host logs', { category: 'ai_gateway', metadata: { failedServiceCount: cached.services.filter(service => service.tone === 'failure').length } });
    lastDegradation = degradation;
    return cached;
  };
  const get = async () => {
    if (inFlight) return inFlight;
    if (cached && now() - Date.parse(cached.fetchedAt) < CACHE_MS) return cached;
    inFlight = (async () => {
      const keys = Object.keys(PATHS);
      const results = await Promise.allSettled(keys.map(key => http.get(`${baseUrl}${PATHS[key]}`, {
        timeout: 5000, maxContentLength: 1024 * 1024, maxRedirects: 0,
        headers: key === 'containers' ? headers() : {},
        validateStatus: status => (status >= 200 && status < 300) || (key === 'health' && status === 503),
      })));
      const raw = {};
      results.forEach((result, index) => { if (result.status === 'fulfilled') raw[keys[index]] = result.value.data; });
      return observe(raw);
    })();
    try { return await inFlight; } finally { inFlight = null; }
  };
  return { get, observe };
}

module.exports = { normalizeMonitoring, createMonitoringService };
