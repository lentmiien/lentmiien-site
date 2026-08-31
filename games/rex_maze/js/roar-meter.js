(function exposeRoarMeter(root, factory) {
  const roarMeter = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = roarMeter;
    return;
  }

  root.RexMazeRoarMeter = Object.freeze(roarMeter);
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const MAX_ROAR = 100;
  const BASE_RECOVERY_PER_SECOND = 0.1;
  const COLLISION_RECOVERY_BONUS_PER_SECOND = 0.2;
  const TIME_RECOVERY_BONUS_PER_MINUTE = 0.025;
  const MAX_TIME_RECOVERY_BONUS_PER_SECOND = 0.4;

  function nonNegativeNumber(value) {
    return Number.isFinite(value) ? Math.max(0, value) : 0;
  }

  function getRecoveryRate(elapsedSeconds, collisionCount) {
    const activeMinutes = nonNegativeNumber(elapsedSeconds) / 60;
    const collisions = Math.floor(nonNegativeNumber(collisionCount));
    const timeBonus = Math.min(
      MAX_TIME_RECOVERY_BONUS_PER_SECOND,
      activeMinutes * TIME_RECOVERY_BONUS_PER_MINUTE
    );

    return BASE_RECOVERY_PER_SECOND
      + collisions * COLLISION_RECOVERY_BONUS_PER_SECOND
      + timeBonus;
  }

  function recoverRoar(currentRoar, deltaSeconds, elapsedSeconds, collisionCount) {
    const roar = Math.min(MAX_ROAR, nonNegativeNumber(currentRoar));
    const activeDelta = nonNegativeNumber(deltaSeconds);
    if (roar >= MAX_ROAR || activeDelta === 0) return roar;

    return Math.min(
      MAX_ROAR,
      roar + getRecoveryRate(elapsedSeconds, collisionCount) * activeDelta
    );
  }

  return {
    MAX_ROAR,
    BASE_RECOVERY_PER_SECOND,
    COLLISION_RECOVERY_BONUS_PER_SECOND,
    TIME_RECOVERY_BONUS_PER_MINUTE,
    MAX_TIME_RECOVERY_BONUS_PER_SECOND,
    getRecoveryRate,
    recoverRoar
  };
}));
