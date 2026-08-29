const MAX_TIMEOUT_DELAY_MS = 2_147_000_000;

function scheduleSessionExpiry(expiresAt, onExpire, options = {}) {
  const maxDelayMs = options.maxDelayMs || MAX_TIMEOUT_DELAY_MS;
  const now = options.now || Date.now;
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  let timer = null;
  let cancelled = false;

  const scheduleNext = () => {
    if (cancelled) return;
    const remainingMs = expiresAt - now();
    if (remainingMs <= 0) {
      onExpire();
      return;
    }
    timer = setTimer(scheduleNext, Math.min(remainingMs, maxDelayMs));
    timer?.unref?.();
  };

  scheduleNext();
  return () => {
    cancelled = true;
    if (timer) clearTimer(timer);
  };
}

module.exports = { MAX_TIMEOUT_DELAY_MS, scheduleSessionExpiry };
