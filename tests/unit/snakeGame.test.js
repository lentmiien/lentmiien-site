const {
  PRESETS,
  SnakeGame,
  normalizeSettings,
} = require('../../games/snake/js/snake-engine');

const placeHead = (game, x, y) => {
  game.snake = [{ x, y }];
  game.direction = { x: 0, y: 0 };
  game.queuedDirection = { x: 0, y: 0 };
  game.food = { x: game.settings.boardSize - 1, y: game.settings.boardSize - 1 };
};

describe('SnakeGame', () => {
  test('keeps the legacy Simple and Classic presets distinct', () => {
    const simple = normalizeSettings(PRESETS.simple);
    const classic = normalizeSettings(PRESETS.classic);

    expect(simple).toMatchObject({
      speedMs: 1250,
      collisionMode: 'brake',
      pointsPerFood: 1,
      powerFoods: true,
      portals: false,
      emberRush: false,
    });
    expect(classic).toMatchObject({
      speedMs: 100,
      collisionMode: 'crash',
      pointsPerFood: 10,
      powerFoods: false,
      portals: false,
      emberRush: false,
    });
  });

  test('grows and scores when regular food is collected', () => {
    const game = new SnakeGame(PRESETS.classic, { random: () => 0.5 });
    const center = Math.floor(game.settings.boardSize / 2);
    placeHead(game, center, center);
    game.food = { x: center + 1, y: center };

    game.setDirection('right');
    const events = game.step(1000);

    expect(game.score).toBe(10);
    expect(game.snake).toHaveLength(2);
    expect(game.regularFoodEaten).toBe(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'consumed', item: 'food', points: 10 }),
    ]));
  });

  test('crash collisions end a Classic run', () => {
    const game = new SnakeGame(PRESETS.classic, { random: () => 0.5 });
    placeHead(game, 0, 0);

    game.setDirection('left');
    const events = game.step(1000);

    expect(game.status).toBe('over');
    expect(game.endReason).toBe('wall');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'gameOver', reason: 'wall' }),
    ]));
  });

  test('brake collisions stop a Simple run without ending it', () => {
    const game = new SnakeGame(PRESETS.simple, { random: () => 0.5 });
    placeHead(game, 0, 0);

    game.setDirection('left');
    const events = game.step(1000);

    expect(game.status).toBe('running');
    expect(game.direction).toEqual({ x: 0, y: 0 });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'braked', kind: 'wall' }),
    ]));
  });

  test('wrap rules move the head to the opposite edge', () => {
    const game = new SnakeGame({ ...PRESETS.classic, collisionMode: 'wrap' }, { random: () => 0.5 });
    placeHead(game, 0, 4);

    game.setDirection('left');
    const events = game.step(1000);

    expect(game.snake[0]).toEqual({ x: game.settings.boardSize - 1, y: 4 });
    expect(game.status).toBe('running');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'wrapped' }),
    ]));
  });

  test('rift portals move the head between distant cells', () => {
    const game = new SnakeGame(PRESETS.ember, { random: () => 0.5 });
    placeHead(game, 5, 5);
    game.portals = [{ x: 6, y: 5 }, { x: 14, y: 12 }];
    game.portalExpiresAt = 10000;

    game.setDirection('right');
    const events = game.step(1000);

    expect(game.snake[0]).toEqual({ x: 14, y: 12 });
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'teleported',
        from: { x: 6, y: 5 },
        to: { x: 14, y: 12 },
      }),
    ]));
  });

  test('every fourth Ember fruit starts a timed rush', () => {
    const game = new SnakeGame(PRESETS.ember, { random: () => 0.5 });
    const center = Math.floor(game.settings.boardSize / 2);
    placeHead(game, center, center);
    game.regularFoodEaten = 3;
    game.food = { x: center + 1, y: center };

    game.setDirection('right');
    const events = game.step(1000);

    expect(game.rushMotes).toHaveLength(5);
    expect(game.rushExpiresAt).toBe(8000);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'rushStarted', count: 5 }),
    ]));
  });

  test('pausing freezes timed mechanics', () => {
    const game = new SnakeGame(PRESETS.ember, { random: () => 0.5 });
    game.status = 'running';
    game.bonusFood = { x: 1, y: 1 };
    game.bonusExpiresAt = 2000;

    game.pause(1000);
    game.resume(4000);

    expect(game.bonusExpiresAt).toBe(5000);
    game.updateTime(4500);
    expect(game.bonusFood).toEqual({ x: 1, y: 1 });
  });
});
