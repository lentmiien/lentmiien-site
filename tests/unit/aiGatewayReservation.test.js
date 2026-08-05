const {
  buildAiGatewayReservationRequest,
  normalizeAiGatewayReservation,
} = require('../../utils/aiGatewayReservation');

describe('AI Gateway GPU reservation helpers', () => {
  test('normalizes an inactive reservation and its Gateway default timeout', () => {
    const reservation = normalizeAiGatewayReservation({
      active: false,
      service: null,
      default_idle_timeout_sec: 900,
      blocked_queue_depth: 0,
    });

    expect(reservation).toMatchObject({
      active: false,
      statusDisplay: 'Not reserved',
      service: null,
      phaseDisplay: 'Idle',
      defaultIdleTimeoutSec: 900,
      defaultIdleTimeoutDisplay: '15m',
      blockedQueueDepth: 0,
    });
  });

  test('normalizes the active reservation nested in mutation responses', () => {
    const reservation = normalizeAiGatewayReservation({
      state_after: 'running',
      reservation: {
        active: true,
        id: 'reservation-1',
        service: 'ollama',
        affinity: 'ollama',
        phase: 'release_failed',
        created_at: 1_754_000_000,
        last_activity_at: 1_754_000_100,
        idle_timeout_sec: 900,
        idle_sec: 25.5,
        remaining_sec: 874.5,
        expires_at: 1_754_001_000,
        dispatch_paused: true,
        blocked_queue_depth: 3,
        last_error: 'VRAM reclaim failed',
      },
    });

    expect(reservation).toMatchObject({
      active: true,
      statusDisplay: 'Reserved',
      service: 'ollama',
      phase: 'release_failed',
      phaseDisplay: 'Release Failed',
      idleTimeoutSec: 900,
      remainingSec: 874.5,
      dispatchPaused: true,
      blockedQueueDepth: 3,
      containerState: 'running',
      containerStateDisplay: 'Running',
      lastError: 'VRAM reclaim failed',
    });
    expect(reservation.createdAtDisplay).toEqual(expect.any(String));
    expect(reservation.expiresAtDisplay).toEqual(expect.any(String));
  });

  test('builds the documented reservation body and defaults to waiting', () => {
    expect(buildAiGatewayReservationRequest({
      container_id: ' ollama ',
      idle_timeout_sec: '1200',
    })).toEqual({
      container_id: 'ollama',
      idle_timeout_sec: 1200,
      wait: true,
    });

    expect(buildAiGatewayReservationRequest({
      containerId: 'comfyui',
      wait: false,
    })).toEqual({
      container_id: 'comfyui',
      wait: false,
    });
  });

  test.each([
    [{}, 'Container id is required.'],
    [{ container_id: 'ollama', idle_timeout_sec: 0 }, 'Idle timeout must be a finite number greater than zero.'],
    [{ container_id: 'ollama', idle_timeout_sec: 'never' }, 'Idle timeout must be a finite number greater than zero.'],
  ])('rejects an invalid reservation request', (body, message) => {
    expect(() => buildAiGatewayReservationRequest(body)).toThrow(message);
  });
});
