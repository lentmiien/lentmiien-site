const STOPPED_STATES = new Set(['created', 'exited', 'dead', 'stopped', 'down', 'missing', 'not_found']);
const ACTIVE_STATES = new Set(['running', 'up', 'healthy', 'paused', 'restarting', 'removing', 'starting', 'stopping']);

function stoppedState(state, running) {
  if (running === true || running === 'true') return false;
  if (typeof state === 'string') {
    const normalized = state.trim().toLowerCase();
    if (STOPPED_STATES.has(normalized)) return true;
    if (ACTIVE_STATES.has(normalized)) return false;
    return null;
  }
  return running === false || running === 'false' ? true : null;
}

// /containers is also consumed by the Gateway dashboard. Accept its list and
// keyed-map forms, but never treat missing/unknown ComfyUI state as stopped.
function isComfyUiStopped(payload) {
  const matches = [];
  let visited = 0;
  let truncated = false;
  function visit(value, key = '', depth = 0) {
    if (depth > 5 || ++visited > 1000) { truncated = true; return; }
    if (typeof value === 'string' && key.toLowerCase() === 'comfyui') {
      matches.push(stoppedState(value));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const identities = [key, value.id, value.container_id, value.name, value.container_name,
      value.service, value.compose_service].filter(entry => typeof entry === 'string');
    if (identities.some(entry => entry.toLowerCase() === 'comfyui') || value.gateway_prefix === '/comfy') {
      const state = value.state ?? value.container_state ?? value.status;
      const running = value.running ?? value.is_running;
      matches.push(stoppedState(state, running));
      return;
    }
    const entries = Object.entries(value);
    if (entries.length > 500) truncated = true;
    for (const [childKey, child] of entries.slice(0, 500)) {
      visit(child, childKey, depth + 1);
    }
  }
  visit(payload);
  return matches.length && !truncated && !matches.includes(null) ? matches.every(Boolean) : null;
}

module.exports = { isComfyUiStopped };
