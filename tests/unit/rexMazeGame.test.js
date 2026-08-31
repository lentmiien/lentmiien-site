const fs = require('fs');
const path = require('path');

const gameRoot = path.join(process.cwd(), 'games', 'rex_maze');
const roarMeter = require(path.join(gameRoot, 'js', 'roar-meter'));

describe('Rex Maze roar recovery', () => {
  test('recovers slowly and accelerates with active level time and collisions', () => {
    const startingRate = roarMeter.getRecoveryRate(0, 0);
    const laterRate = roarMeter.getRecoveryRate(120, 0);
    const postCollisionRate = roarMeter.getRecoveryRate(120, 1);
    const secondCollisionRate = roarMeter.getRecoveryRate(120, 2);

    expect(startingRate).toBe(roarMeter.BASE_RECOVERY_PER_SECOND);
    expect(startingRate * 60).toBeLessThan(10);
    expect(laterRate).toBeGreaterThan(startingRate);
    expect(postCollisionRate - laterRate).toBeCloseTo(
      roarMeter.COLLISION_RECOVERY_BONUS_PER_SECOND
    );
    expect(secondCollisionRate - postCollisionRate).toBeCloseTo(
      roarMeter.COLLISION_RECOVERY_BONUS_PER_SECOND
    );
  });

  test('applies elapsed recovery without exceeding a full meter', () => {
    expect(roarMeter.recoverRoar(40, 10, 0, 0)).toBeCloseTo(41);
    expect(roarMeter.recoverRoar(40, 10, 120, 2)).toBeGreaterThan(41);
    expect(roarMeter.recoverRoar(99, 60, 600, 3)).toBe(roarMeter.MAX_ROAR);
  });

  test('ignores invalid or negative timing values', () => {
    expect(roarMeter.getRecoveryRate(-60, -2)).toBe(roarMeter.BASE_RECOVERY_PER_SECOND);
    expect(roarMeter.recoverRoar(25, -10, 60, 1)).toBe(25);
    expect(roarMeter.recoverRoar(25, Number.NaN, 60, 1)).toBe(25);
  });

  test('loads recovery before the game and wires collision refills into the level lifecycle', () => {
    const html = fs.readFileSync(path.join(gameRoot, 'index.html'), 'utf8');
    const gameSource = fs.readFileSync(path.join(gameRoot, 'js', 'game.js'), 'utf8');
    const collisionStart = gameSource.indexOf('function handleRaptorCollision()');
    const collisionEnd = gameSource.indexOf('function useScent()', collisionStart);
    const collisionSource = gameSource.slice(collisionStart, collisionEnd);

    expect(html.indexOf('js/roar-meter.js')).toBeLessThan(html.indexOf('js/game.js'));
    expect(gameSource).toContain('state.roarRecoveryUpdatedAt = state.levelStartedAt;');
    expect(gameSource).toContain('state.roar = roarMeter.recoverRoar(');
    expect(collisionSource).toContain('state.hits += 1;');
    expect(collisionSource).toContain('state.roar = roarMeter.MAX_ROAR;');
    expect(collisionSource).toContain('faster recovery for this maze');
  });
});
