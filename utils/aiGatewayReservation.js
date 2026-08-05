function asFiniteNumber(value) {
  if (value === null || typeof value === 'undefined' || value === '') {
    return null;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asBoolean(value) {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

function formatState(value) {
  const state = typeof value === 'string' ? value.trim() : '';
  if (!state) return 'Unknown';

  return state
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatEpoch(value) {
  const epoch = asFiniteNumber(value);
  if (epoch === null) return null;
  const milliseconds = epoch > 1e11 ? epoch : epoch * 1000;
  return new Date(milliseconds).toLocaleString();
}

function formatSeconds(value) {
  const seconds = asFiniteNumber(value);
  if (seconds === null) return null;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds % 1 === 0 ? 0 : 1)} s`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.round(seconds % 60);
    return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function unwrapReservation(rawReservation) {
  if (!rawReservation || typeof rawReservation !== 'object' || Array.isArray(rawReservation)) {
    return null;
  }

  if (rawReservation.reservation
    && typeof rawReservation.reservation === 'object'
    && !Array.isArray(rawReservation.reservation)) {
    return {
      ...rawReservation.reservation,
      container_name: rawReservation.reservation.container_name
        ?? rawReservation.container_name,
      container_state: rawReservation.reservation.container_state
        ?? rawReservation.container_state
        ?? rawReservation.state_after,
    };
  }

  return rawReservation;
}

function normalizeAiGatewayReservation(rawReservation) {
  const reservation = unwrapReservation(rawReservation);
  if (!reservation) return null;

  const active = asBoolean(reservation.active);
  const service = typeof reservation.service === 'string' && reservation.service.trim()
    ? reservation.service.trim()
    : null;
  const phase = typeof reservation.phase === 'string' && reservation.phase.trim()
    ? reservation.phase.trim()
    : null;
  const containerName = typeof reservation.container_name === 'string' && reservation.container_name.trim()
    ? reservation.container_name.trim()
    : null;
  const containerState = typeof reservation.container_state === 'string' && reservation.container_state.trim()
    ? reservation.container_state.trim()
    : null;
  const createdAt = asFiniteNumber(reservation.created_at);
  const lastActivityAt = asFiniteNumber(reservation.last_activity_at);
  const expiresAt = asFiniteNumber(reservation.expires_at);
  const idleTimeoutSec = asFiniteNumber(reservation.idle_timeout_sec);
  const defaultIdleTimeoutSec = asFiniteNumber(reservation.default_idle_timeout_sec);
  const idleSec = asFiniteNumber(reservation.idle_sec);
  const remainingSec = asFiniteNumber(reservation.remaining_sec);
  const blockedQueueDepth = asFiniteNumber(reservation.blocked_queue_depth);
  const dispatchPaused = asBoolean(reservation.dispatch_paused);
  const lastError = typeof reservation.last_error === 'string' && reservation.last_error.trim()
    ? reservation.last_error.trim()
    : null;

  return {
    active,
    statusDisplay: active === true ? 'Reserved' : (active === false ? 'Not reserved' : 'Unknown'),
    id: typeof reservation.id === 'string' ? reservation.id : null,
    service,
    affinity: typeof reservation.affinity === 'string' ? reservation.affinity : null,
    phase,
    phaseDisplay: phase ? formatState(phase) : (active === false ? 'Idle' : 'Unknown'),
    createdAt,
    createdAtDisplay: formatEpoch(createdAt),
    lastActivityAt,
    lastActivityAtDisplay: formatEpoch(lastActivityAt),
    expiresAt,
    expiresAtDisplay: formatEpoch(expiresAt),
    idleTimeoutSec,
    idleTimeoutDisplay: formatSeconds(idleTimeoutSec),
    defaultIdleTimeoutSec,
    defaultIdleTimeoutDisplay: formatSeconds(defaultIdleTimeoutSec),
    idleSec,
    idleDisplay: formatSeconds(idleSec),
    remainingSec,
    remainingDisplay: formatSeconds(remainingSec),
    blockedQueueDepth: blockedQueueDepth === null ? null : Math.max(0, Math.trunc(blockedQueueDepth)),
    dispatchPaused,
    containerName,
    containerState,
    containerStateDisplay: containerState ? formatState(containerState) : 'Unknown',
    lastError,
  };
}

function buildAiGatewayReservationRequest(body) {
  const input = body && typeof body === 'object' ? body : {};
  const containerId = typeof input.container_id === 'string'
    ? input.container_id.trim()
    : (typeof input.containerId === 'string' ? input.containerId.trim() : '');
  if (!containerId) {
    throw new TypeError('Container id is required.');
  }

  const request = {
    container_id: containerId,
    wait: typeof input.wait === 'undefined' ? true : asBoolean(input.wait) === true,
  };
  const rawIdleTimeout = input.idle_timeout_sec ?? input.idleTimeoutSec;
  if (rawIdleTimeout !== null && typeof rawIdleTimeout !== 'undefined' && rawIdleTimeout !== '') {
    const idleTimeoutSec = asFiniteNumber(rawIdleTimeout);
    if (idleTimeoutSec === null || idleTimeoutSec <= 0) {
      throw new TypeError('Idle timeout must be a finite number greater than zero.');
    }
    request.idle_timeout_sec = idleTimeoutSec;
  }

  return request;
}

module.exports = {
  buildAiGatewayReservationRequest,
  normalizeAiGatewayReservation,
};
