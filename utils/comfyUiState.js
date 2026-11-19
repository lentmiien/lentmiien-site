const STOPPED_STATES = new Set(['created', 'exited', 'dead', 'stopped', 'down', 'missing', 'not_found']);
const ACTIVE_STATES = new Set(['running', 'up', 'healthy', 'paused', 'restarting', 'removing', 'starting', 'stopping']);
const CATALOG_KEYS = ['containers', 'managed_containers', 'managedContainers', 'services', 'items', 'data', 'container'];

function stoppedState(entry) {
  const running = entry.running ?? entry.is_running ?? entry.isRunning;
  if (running === true || running === 'true' || running === 1 || running === '1') return false;
  const reportsStopped = running === false || running === 'false' || running === 0 || running === '0';
  if (running != null && !reportsStopped) return null;
  const state = entry.state ?? entry.container_state ?? entry.containerState ?? entry.status;
  if (typeof state === 'string') {
    const normalized = state.trim().toLowerCase();
    if (STOPPED_STATES.has(normalized)) return true;
    if (ACTIVE_STATES.has(normalized)) return false;
    return null;
  }
  return state == null && reportsStopped ? true : null;
}

// Count catalog entries and wrappers. Descriptive fields (ports, aliases, health
// URLs, defaults) are neither additional containers nor lifecycle observations.
function inspectComfyUiState(payload) {
  const matches = [];
  let visited = 0;
  let failure = null;
  function visit(value, key = '', depth = 0, catalog = true) {
    if (failure) return;
    if (depth > 5 || ++visited > 1000) { failure = 'catalog_limit'; return; }
    const identities = [key, value?.id, value?.container_id, value?.containerId, value?.key,
      value?.name, value?.container_name, value?.containerName, value?.service, value?.compose_service];
    if (identities.some(id => typeof id === 'string' && id.trim().toLowerCase() === 'comfyui')
      || (value?.gateway_prefix ?? value?.gatewayPrefix) === '/comfy') {
      if (value?.docker_available != null && value.docker_available !== true) { failure = 'inspection_unavailable'; return; }
      matches.push(stoppedState(typeof value === 'string' ? { state: value } : value || {}));
      return;
    }
    if (!catalog) {
      // An unidentified list element may conceal another observation of this
      // service. A named sibling's metadata need not be traversed.
      if (/^\d+$/.test(key) && !identities.slice(1).some(id => typeof id === 'string')
        && typeof value?.gateway_prefix !== 'string' && typeof value?.gatewayPrefix !== 'string') failure = 'invalid_catalog';
      return;
    }
    if (!value || typeof value !== 'object') return;
    if (value.docker_available != null && value.docker_available !== true) { failure = 'inspection_unavailable'; return; }
    const wrappers = CATALOG_KEYS.filter(name => Object.hasOwn(value, name));
    if (wrappers.length) {
      for (const name of wrappers) visit(value[name], name, depth + 1);
      return;
    }
    // The dashboard also accepts bare arrays and maps keyed by service.
    // Only inspect their immediate entries. A nested default or health block
    // cannot supply a current container observation.
    const entries = Object.entries(value);
    if (entries.length > 500) { failure = 'catalog_limit'; return; }
    for (const [childKey, child] of entries) visit(child, childKey, depth + 1, false);
  }
  visit(payload);
  const reason = failure || (!matches.length ? 'container_missing' : matches.includes(null) ? 'unknown_state' : null);
  return { stopped: reason ? null : matches.every(Boolean), reason };
}

function isComfyUiStopped(payload) {
  return inspectComfyUiState(payload).stopped;
}

module.exports = { inspectComfyUiState, isComfyUiStopped };
