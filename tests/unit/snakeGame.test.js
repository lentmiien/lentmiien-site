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

const boardPath = size => {
  const path = [];
  for (let y = 0; y < size; y += 1) {
    for (let offset = 0; offset < size; offset += 1) {
      path.push({
        x: y % 2 === 0 ? offset : size - 1 - offset,
        y,
      });
    }
  }
  return path;
};

const prepareAlmostFullBoard = game => {
  const path = boardPath(game.settings.boardSize);
  const finalCell = path[path.length - 1];
  const previousCell = path[path.length - 2];
  const approach = {
    x: finalCell.x - previousCell.x,
    y: finalCell.y - previousCell.y,
  };

  game.snake = path.slice(0, -1).reverse();
  game.food = { ...finalCell };
  game.bonusFood = null;
  game.hazardFood = null;
  game.portals = [];
  game.rushMotes = [];
  game.pendingGrowth = 0;
  game.status = 'running';
  game.direction = { ...approach };
  game.queuedDirection = { ...approach };
  game.drainEvents();

  return { finalCell, path, previousCell };
};

describe('SnakeGame', () => {
  test('keeps Easy and the legacy Simple and Classic presets distinct', () => {
    const easy = normalizeSettings(PRESETS.easy);
    const simple = normalizeSettings(PRESETS.simple);
    const classic = normalizeSettings(PRESETS.classic);

    expect(easy).toMatchObject({
      speedMs: 1250,
      collisionMode: 'easy',
      powerFoods: true,
      emberRush: true,
      speedRamp: false,
    });
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

  test('rejects unsupported collision modes', () => {
    expect(normalizeSettings({ collisionMode: 'ghost' }).collisionMode).toBe('crash');
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

  test('Easy mode stops safely at walls without ending the run', () => {
    const game = new SnakeGame(PRESETS.easy, { random: () => 0.5 });
    placeHead(game, 0, 0);

    game.setDirection('left');
    const events = game.step(1000);

    expect(game.status).toBe('running');
    expect(game.endReason).toBe('');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'braked', kind: 'wall' }),
    ]));
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'gameOver' }),
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

  test('Golden fruit and Rush timers grant slow players equivalent movement windows', () => {
    const slowSettings = {
      ...PRESETS.ember,
      speedMs: 1250,
      speedRamp: false,
    };
    const game = new SnakeGame(slowSettings, { random: () => 0 });

    game.maybeSpawnPowerFood(1000);
    game.spawnRush(1000);

    expect(game.bonusDurationMs).toBe(61250);
    expect(game.bonusExpiresAt).toBe(62250);
    expect(game.rushDurationMs).toBe(53750);
    expect(game.rushExpiresAt).toBe(54750);

    game.updateTime(10000);
    expect(game.bonusFood).not.toBeNull();
    expect(game.rushMotes).toHaveLength(5);
  });

  test('timed items retain their existing minimum duration at fast speeds', () => {
    const fastSettings = {
      ...PRESETS.ember,
      speedMs: 70,
      speedRamp: false,
    };
    const game = new SnakeGame(fastSettings, { random: () => 0 });

    game.maybeSpawnPowerFood(1000);
    game.spawnRush(1000);

    expect(game.bonusDurationMs).toBe(8000);
    expect(game.rushDurationMs).toBe(7000);
  });

  test('Easy mode can cross a full trail and resumes fruit spawning when space reopens', () => {
    const game = new SnakeGame({
      ...PRESETS.easy,
      boardSize: 14,
      powerFoods: false,
      emberRush: false,
    }, { random: () => 0 });
    const { finalCell, path, previousCell } = prepareAlmostFullBoard(game);

    const fillEvents = game.step(1000);

    expect(game.snake[0]).toEqual(finalCell);
    expect(new Set(game.snake.map(position => `${position.x},${position.y}`)).size).toBe(14 ** 2);
    expect(game.food).toBeNull();
    expect(game.waitingForSpace).toBe(true);
    expect(game.status).toBe('running');
    expect(fillEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'boardFilled' }),
    ]));

    const reverseIntoTrail = {
      x: previousCell.x - finalCell.x,
      y: previousCell.y - finalCell.y,
    };
    expect(game.setDirection(reverseIntoTrail)).toBe(true);
    const crossingEvents = game.step(2250);

    expect(game.snake[0]).toEqual(previousCell);
    expect(game.snake).toHaveLength(14 ** 2);
    expect(new Set(game.snake.map(position => `${position.x},${position.y}`)).size).toBe((14 ** 2) - 1);
    expect(game.food).toEqual(path[0]);
    expect(game.waitingForSpace).toBe(false);
    expect(game.status).toBe('running');
    expect(crossingEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'spaceReopened', position: path[0] }),
    ]));
  });

  test('non-Easy modes finish only when the snake itself fills the board', () => {
    const settings = {
      ...PRESETS.classic,
      boardSize: 14,
      powerFoods: false,
      emberRush: false,
    };
    const game = new SnakeGame(settings, { random: () => 0 });
    prepareAlmostFullBoard(game);

    const events = game.step(1000);

    expect(game.status).toBe('won');
    expect(game.endReason).toBe('cleared');
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'won', reason: 'cleared' }),
    ]));
  });

  test('a full Easy board defers Rush sparks until cells are free', () => {
    const game = new SnakeGame({
      ...PRESETS.easy,
      boardSize: 14,
      powerFoods: false,
    }, { random: () => 0 });
    const path = boardPath(14);
    game.snake = path.map(position => ({ ...position }));
    game.food = null;
    game.rushPending = true;
    game.status = 'running';
    game.drainEvents();

    game.maintainRequiredSpawns(1000);

    expect(game.food).toBeNull();
    expect(game.rushMotes).toHaveLength(0);
    expect(game.rushPending).toBe(true);
    expect(game.waitingForSpace).toBe(true);

    game.snake.splice(-2, 2);
    game.maintainRequiredSpawns(2000);

    expect(game.food).not.toBeNull();
    expect(game.rushMotes).toHaveLength(1);
    expect(game.rushPending).toBe(false);
    expect(game.waitingForSpace).toBe(false);
  });

  test('temporary items occupying the last open cell do not count as a cleared board', () => {
    const game = new SnakeGame({
      ...PRESETS.classic,
      boardSize: 14,
      powerFoods: false,
    }, { random: () => 0 });
    const path = boardPath(14);
    const lastCell = path[path.length - 1];
    game.snake = path.slice(0, -1);
    game.food = null;
    game.bonusFood = { ...lastCell };
    game.bonusExpiresAt = 2000;
    game.bonusDurationMs = 1000;
    game.status = 'running';
    game.drainEvents();

    game.updateTime(1000);
    expect(game.status).toBe('running');
    expect(game.food).toBeNull();

    game.updateTime(2000);
    expect(game.status).toBe('running');
    expect(game.food).toEqual(lastCell);
  });

  test('Void fruit cannot end an Easy run when the snake is one segment long', () => {
    const game = new SnakeGame({
      ...PRESETS.easy,
      powerFoods: false,
      emberRush: false,
    }, { random: () => 0.5 });
    const center = Math.floor(game.settings.boardSize / 2);
    placeHead(game, center, center);
    game.hazardFood = { x: center + 1, y: center };

    game.setDirection('right');
    const events = game.step(1000);

    expect(game.snake).toHaveLength(1);
    expect(game.status).toBe('running');
    expect(events).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'gameOver' }),
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
