(function attachSnakeEngine(root, factory) {
  const engine = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = engine;
  }

  if (root) {
    root.SnakeEngine = engine;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createSnakeEngine() {
  'use strict';

  const DIRECTIONS = Object.freeze({
    up: Object.freeze({ x: 0, y: -1 }),
    down: Object.freeze({ x: 0, y: 1 }),
    left: Object.freeze({ x: -1, y: 0 }),
    right: Object.freeze({ x: 1, y: 0 }),
  });

  const ZERO_DIRECTION = Object.freeze({ x: 0, y: 0 });
  const COLLISION_MODES = new Set(['easy', 'brake', 'crash', 'wrap']);
  const REFERENCE_BOARD_SIZE = 20;
  // Keep the original clock time for fast runs, then preserve its movement opportunities as play slows.
  const TIMED_ITEM_RULES = Object.freeze({
    bonus: Object.freeze({ minimumMs: 8000, moveBudget: 49 }),
    rush: Object.freeze({ minimumMs: 7000, moveBudget: 43 }),
  });

  const PRESETS = Object.freeze({
    easy: Object.freeze({
      id: 'easy',
      name: 'Easy',
      description: 'Leisurely movement, safe edges, and a trail you can cross without ending the run.',
      speedMs: 1250,
      boardSize: 20,
      collisionMode: 'easy',
      pointsPerFood: 1,
      growthPerFood: 1,
      powerFoods: true,
      portals: false,
      emberRush: true,
      speedRamp: false,
      sound: true,
    }),
    simple: Object.freeze({
      id: 'simple',
      name: 'Simple',
      description: 'Leisurely movement, forgiving collisions, and the original bonus and void fruit.',
      speedMs: 1250,
      boardSize: 20,
      collisionMode: 'brake',
      pointsPerFood: 1,
      growthPerFood: 1,
      powerFoods: true,
      portals: false,
      emberRush: false,
      speedRamp: false,
      sound: true,
    }),
    classic: Object.freeze({
      id: 'classic',
      name: 'Classic',
      description: 'The original fast Snake rules: one fruit, solid walls, and no surprises.',
      speedMs: 100,
      boardSize: 20,
      collisionMode: 'crash',
      pointsPerFood: 10,
      growthPerFood: 1,
      powerFoods: false,
      portals: false,
      emberRush: false,
      speedRamp: false,
      sound: true,
    }),
    ember: Object.freeze({
      id: 'ember',
      name: 'Ember',
      description: 'A balanced run with power fruit, rift shortcuts, spark rushes, and rising speed.',
      speedMs: 165,
      boardSize: 20,
      collisionMode: 'crash',
      pointsPerFood: 10,
      growthPerFood: 1,
      powerFoods: true,
      portals: true,
      emberRush: true,
      speedRamp: true,
      sound: true,
    }),
  });

  const DEFAULT_SETTINGS = Object.freeze({ ...PRESETS.ember });

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function toInteger(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round(number) : fallback;
  }

  function toBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function normalizeSettings(candidate = {}) {
    const fallback = DEFAULT_SETTINGS;
    const collisionMode = COLLISION_MODES.has(candidate.collisionMode)
      ? candidate.collisionMode
      : fallback.collisionMode;

    return {
      id: typeof candidate.id === 'string' ? candidate.id : 'custom',
      name: typeof candidate.name === 'string' ? candidate.name : 'Custom',
      description: typeof candidate.description === 'string' ? candidate.description : '',
      speedMs: clamp(toInteger(candidate.speedMs, fallback.speedMs), 70, 1250),
      boardSize: clamp(toInteger(candidate.boardSize, fallback.boardSize), 14, 30),
      collisionMode,
      pointsPerFood: clamp(toInteger(candidate.pointsPerFood, fallback.pointsPerFood), 1, 10),
      growthPerFood: clamp(toInteger(candidate.growthPerFood, fallback.growthPerFood), 1, 3),
      powerFoods: toBoolean(candidate.powerFoods, fallback.powerFoods),
      portals: toBoolean(candidate.portals, fallback.portals),
      emberRush: toBoolean(candidate.emberRush, fallback.emberRush),
      speedRamp: toBoolean(candidate.speedRamp, fallback.speedRamp),
      sound: toBoolean(candidate.sound, fallback.sound),
    };
  }

  function samePosition(first, second) {
    return Boolean(first && second && first.x === second.x && first.y === second.y);
  }

  function positionKey(position) {
    return `${position.x},${position.y}`;
  }

  function copyDirection(direction) {
    return { x: direction.x, y: direction.y };
  }

  function isZeroDirection(direction) {
    return direction.x === 0 && direction.y === 0;
  }

  class SnakeGame {
    constructor(settings = {}, options = {}) {
      this.random = typeof options.random === 'function' ? options.random : Math.random;
      this.settings = normalizeSettings(settings);
      this.reset();
    }

    reset() {
      const center = Math.floor(this.settings.boardSize / 2);

      this.snake = [{ x: center, y: center }];
      this.direction = copyDirection(ZERO_DIRECTION);
      this.queuedDirection = copyDirection(ZERO_DIRECTION);
      this.pendingGrowth = 0;
      this.score = 0;
      this.moves = 0;
      this.regularFoodEaten = 0;
      this.bonusFoodEaten = 0;
      this.hazardFoodEaten = 0;
      this.rushMotesEaten = 0;
      this.combo = 0;
      this.comboExpiresAt = 0;
      this.pausedAt = 0;
      this.status = 'ready';
      this.endReason = '';
      this.food = null;
      this.bonusFood = null;
      this.bonusExpiresAt = 0;
      this.bonusDurationMs = 0;
      this.hazardFood = null;
      this.hazardExpiresAt = 0;
      this.portals = [];
      this.portalExpiresAt = 0;
      this.rushMotes = [];
      this.rushExpiresAt = 0;
      this.rushDurationMs = 0;
      this.rushPending = false;
      this.waitingForSpace = false;
      this.nextPortalMove = 18 + this.randomInteger(0, 10);
      this.events = [];

      this.food = this.randomEmptyPosition();
      this.emit('reset');
      return this;
    }

    randomInteger(minimum, maximumExclusive) {
      return minimum + Math.floor(this.random() * Math.max(1, maximumExclusive - minimum));
    }

    emit(type, detail = {}) {
      this.events.push({ type, ...detail });
    }

    drainEvents() {
      const events = this.events.slice();
      this.events.length = 0;
      return events;
    }

    setDirection(input) {
      const requested = typeof input === 'string' ? DIRECTIONS[input] : input;

      if (
        !requested
        || !Number.isFinite(requested.x)
        || !Number.isFinite(requested.y)
        || Math.abs(requested.x) + Math.abs(requested.y) !== 1
        || this.status === 'over'
        || this.status === 'won'
      ) {
        return false;
      }

      const reference = isZeroDirection(this.direction) ? this.queuedDirection : this.direction;
      if (
        this.snake.length > 1
        && !this.isEasyMode()
        && requested.x === -reference.x
        && requested.y === -reference.y
      ) {
        return false;
      }

      this.queuedDirection = copyDirection(requested);
      if (this.status === 'ready') {
        this.status = 'running';
        this.emit('started');
      }
      return true;
    }

    pause(now = Date.now()) {
      if (this.status !== 'running') {
        return false;
      }

      this.status = 'paused';
      this.pausedAt = now;
      this.emit('paused');
      return true;
    }

    resume(now = Date.now()) {
      if (this.status !== 'paused') {
        return false;
      }

      const pausedDuration = this.pausedAt ? Math.max(0, now - this.pausedAt) : 0;
      [
        'comboExpiresAt',
        'bonusExpiresAt',
        'hazardExpiresAt',
        'portalExpiresAt',
        'rushExpiresAt',
      ].forEach(key => {
        if (this[key]) {
          this[key] += pausedDuration;
        }
      });

      this.status = 'running';
      this.pausedAt = 0;
      this.emit('resumed');
      return true;
    }

    currentSpeedMs() {
      if (!this.settings.speedRamp) {
        return this.settings.speedMs;
      }

      const rampedSpeed = this.settings.speedMs * (0.965 ** this.regularFoodEaten);
      return Math.max(55, Math.round(rampedSpeed));
    }

    timedItemDurationMs(item) {
      const rule = TIMED_ITEM_RULES[item];
      if (!rule) {
        return 0;
      }

      const boardAdjustedMoves = Math.ceil(
        rule.moveBudget * this.settings.boardSize / REFERENCE_BOARD_SIZE,
      );
      return Math.max(rule.minimumMs, boardAdjustedMoves * this.currentSpeedMs());
    }

    scoreMultiplier(now = Date.now()) {
      if (!this.settings.emberRush || this.combo < 1 || now > this.comboExpiresAt) {
        return 1;
      }

      return Math.min(4, 1 + Math.floor((this.combo - 1) / 2));
    }

    updateTime(now = Date.now()) {
      let spawnSpaceMayHaveChanged = false;

      if (this.bonusFood && now >= this.bonusExpiresAt) {
        this.bonusFood = null;
        this.bonusExpiresAt = 0;
        this.bonusDurationMs = 0;
        spawnSpaceMayHaveChanged = true;
        this.emit('expired', { item: 'bonus' });
      }

      if (this.hazardFood && now >= this.hazardExpiresAt) {
        this.hazardFood = null;
        this.hazardExpiresAt = 0;
        spawnSpaceMayHaveChanged = true;
        this.emit('expired', { item: 'hazard' });
      }

      if (this.portals.length && now >= this.portalExpiresAt) {
        this.portals = [];
        this.portalExpiresAt = 0;
        spawnSpaceMayHaveChanged = true;
        this.emit('expired', { item: 'portals' });
      }

      if (this.rushMotes.length && now >= this.rushExpiresAt) {
        const missed = this.rushMotes.length;
        this.rushMotes = [];
        this.rushExpiresAt = 0;
        this.rushDurationMs = 0;
        spawnSpaceMayHaveChanged = true;
        this.emit('rushEnded', { missed });
      }

      if (this.combo && now >= this.comboExpiresAt) {
        this.combo = 0;
        this.comboExpiresAt = 0;
        this.emit('comboEnded');
      }

      if (this.status === 'running' && spawnSpaceMayHaveChanged) {
        this.maintainRequiredSpawns(now);
      }
    }

    step(now = Date.now()) {
      this.updateTime(now);

      if (this.status !== 'running') {
        return this.drainEvents();
      }

      if (!isZeroDirection(this.queuedDirection)) {
        this.direction = copyDirection(this.queuedDirection);
      }

      if (isZeroDirection(this.direction)) {
        return this.drainEvents();
      }

      const rawHead = {
        x: this.snake[0].x + this.direction.x,
        y: this.snake[0].y + this.direction.y,
      };
      let nextHead = { ...rawHead };
      const outsideBoard = this.isOutsideBoard(nextHead);

      if (outsideBoard && this.settings.collisionMode === 'wrap') {
        nextHead = this.wrapPosition(nextHead);
        this.emit('wrapped', { position: { ...nextHead } });
      } else if (outsideBoard) {
        return this.resolveCollision('wall');
      }

      const enteredPortal = this.portals.findIndex(portal => samePosition(portal, nextHead));
      if (enteredPortal >= 0) {
        const destination = this.portals[enteredPortal === 0 ? 1 : 0];
        const destinationIsOpen = destination && (
          this.isEasyMode()
          || !this.snake.some(segment => samePosition(segment, destination))
        );
        if (destinationIsOpen) {
          nextHead = { ...destination };
          this.emit('teleported', {
            from: { ...this.portals[enteredPortal] },
            to: { ...destination },
          });
        } else {
          this.portals = [];
          this.portalExpiresAt = 0;
          this.emit('portalFizzle');
        }
      }

      const growingOnThisMove = samePosition(nextHead, this.food)
        || samePosition(nextHead, this.bonusFood);
      const tailWillMove = this.pendingGrowth === 0 && !growingOnThisMove;
      const collisionSegments = tailWillMove ? this.snake.slice(0, -1) : this.snake;

      if (
        !this.isEasyMode()
        && collisionSegments.some(segment => samePosition(segment, nextHead))
      ) {
        return this.resolveCollision('self');
      }

      this.snake.unshift(nextHead);
      this.moves += 1;

      let hazardShrink = 0;
      if (samePosition(nextHead, this.food)) {
        this.consumeRegularFood(now);
      } else if (samePosition(nextHead, this.bonusFood)) {
        this.consumeBonusFood(now);
      } else if (samePosition(nextHead, this.hazardFood)) {
        hazardShrink = this.consumeHazardFood();
      } else {
        const moteIndex = this.rushMotes.findIndex(mote => samePosition(mote, nextHead));
        if (moteIndex >= 0) {
          this.consumeRushMote(moteIndex, now);
        }
      }

      if (this.pendingGrowth > 0) {
        this.pendingGrowth -= 1;
      } else {
        this.snake.pop();
      }

      if (hazardShrink > 0) {
        for (let index = 0; index < hazardShrink; index += 1) {
          if (this.snake.length <= 1) {
            if (!this.isEasyMode()) {
              this.finish('consumed');
            }
            break;
          }
          this.snake.pop();
        }
      }

      if (this.status === 'running') {
        this.maintainRequiredSpawns(now);
        if (this.status === 'running' && !this.waitingForSpace) {
          this.maybeSpawnPowerFood(now);
          this.maybeSpawnPortals(now);
        }
      }

      this.emit('moved', { head: { ...this.snake[0] } });
      return this.drainEvents();
    }

    resolveCollision(kind) {
      if (this.settings.collisionMode === 'brake' || this.isEasyMode()) {
        this.direction = copyDirection(ZERO_DIRECTION);
        this.queuedDirection = copyDirection(ZERO_DIRECTION);
        this.emit('braked', { kind });

        if (!this.isEasyMode() && !this.hasAvailableMove()) {
          this.finish('trapped');
        }
      } else {
        this.finish(kind);
      }

      return this.drainEvents();
    }

    finish(reason) {
      if (this.isEasyMode()) {
        return false;
      }

      this.status = reason === 'cleared' ? 'won' : 'over';
      this.endReason = reason;
      this.direction = copyDirection(ZERO_DIRECTION);
      this.queuedDirection = copyDirection(ZERO_DIRECTION);
      this.emit(this.status === 'won' ? 'won' : 'gameOver', { reason });
      return true;
    }

    consumeRegularFood(now) {
      const points = this.awardPoints(this.settings.pointsPerFood, now);
      this.pendingGrowth += this.settings.growthPerFood;
      this.regularFoodEaten += 1;
      this.food = null;
      this.emit('consumed', { item: 'food', points });

      if (this.settings.emberRush && this.regularFoodEaten % 4 === 0) {
        this.rushPending = true;
      }
    }

    consumeBonusFood(now) {
      const points = this.awardPoints(this.settings.pointsPerFood * 3, now);
      this.pendingGrowth += this.settings.growthPerFood + 1;
      this.bonusFoodEaten += 1;
      this.bonusFood = null;
      this.bonusExpiresAt = 0;
      this.bonusDurationMs = 0;
      this.emit('consumed', { item: 'bonus', points });
    }

    consumeHazardFood() {
      const penalty = Math.min(this.score, this.settings.pointsPerFood);
      this.score -= penalty;
      this.combo = 0;
      this.comboExpiresAt = 0;
      this.hazardFoodEaten += 1;
      this.hazardFood = null;
      this.hazardExpiresAt = 0;
      this.emit('consumed', { item: 'hazard', points: -penalty });
      return 3;
    }

    consumeRushMote(index, now) {
      const basePoints = Math.max(1, Math.ceil(this.settings.pointsPerFood / 2));
      const points = this.awardPoints(basePoints, now);
      this.rushMotes.splice(index, 1);
      this.rushMotesEaten += 1;
      this.emit('consumed', { item: 'rush', points });

      if (!this.rushMotes.length) {
        this.rushExpiresAt = 0;
        this.rushDurationMs = 0;
        const clearBonus = this.settings.pointsPerFood * 2 * this.scoreMultiplier(now);
        this.score += clearBonus;
        this.emit('rushCleared', { points: clearBonus });
      }
    }

    awardPoints(basePoints, now) {
      if (this.settings.emberRush) {
        this.combo = now <= this.comboExpiresAt ? this.combo + 1 : 1;
        this.comboExpiresAt = now + 4500;
      }

      const points = basePoints * this.scoreMultiplier(now);
      this.score += points;
      return points;
    }

    maybeSpawnPowerFood(now) {
      if (!this.settings.powerFoods) {
        return;
      }

      const timeAdjustedChance = clamp(this.currentSpeedMs() / 9000, 0.008, 0.12);
      if (!this.bonusFood && this.random() < timeAdjustedChance) {
        this.bonusFood = this.randomEmptyPosition();
        if (this.bonusFood) {
          this.bonusDurationMs = this.timedItemDurationMs('bonus');
          this.bonusExpiresAt = now + this.bonusDurationMs;
          this.emit('spawned', {
            item: 'bonus',
            position: { ...this.bonusFood },
            durationMs: this.bonusDurationMs,
          });
        }
      }

      if (!this.hazardFood && this.random() < timeAdjustedChance * 0.62) {
        this.hazardFood = this.randomEmptyPosition();
        if (this.hazardFood) {
          this.hazardExpiresAt = now + 12000;
          this.emit('spawned', { item: 'hazard', position: { ...this.hazardFood } });
        }
      }
    }

    maybeSpawnPortals(now) {
      if (
        !this.settings.portals
        || this.portals.length
        || this.moves < this.nextPortalMove
      ) {
        return;
      }

      const first = this.randomEmptyPosition();
      if (!first) {
        return;
      }

      const minimumDistance = Math.max(5, Math.floor(this.settings.boardSize / 3));
      const second = this.randomEmptyPosition([first], position => (
        Math.abs(position.x - first.x) + Math.abs(position.y - first.y) >= minimumDistance
      ));

      if (!second) {
        this.nextPortalMove += 8;
        return;
      }

      this.portals = [first, second];
      this.portalExpiresAt = now + 11000;
      this.nextPortalMove = this.moves + this.randomInteger(28, 43);
      this.emit('portalsOpened', {
        portals: this.portals.map(portal => ({ ...portal })),
      });
    }

    spawnRush(now) {
      if (this.rushMotes.length) {
        return false;
      }

      const motes = [];
      for (let index = 0; index < 5; index += 1) {
        const mote = this.randomEmptyPosition(motes);
        if (!mote) {
          break;
        }
        motes.push(mote);
      }

      if (!motes.length) {
        return false;
      }

      this.rushPending = false;
      this.rushMotes = motes;
      this.rushDurationMs = this.timedItemDurationMs('rush');
      this.rushExpiresAt = now + this.rushDurationMs;
      this.emit('rushStarted', {
        count: motes.length,
        expiresAt: this.rushExpiresAt,
        durationMs: this.rushDurationMs,
      });
      return true;
    }

    maintainRequiredSpawns(now) {
      if (this.status !== 'running') {
        return;
      }

      this.ensureRegularFood();
      if (this.status === 'running' && this.rushPending && !this.waitingForSpace) {
        this.spawnRush(now);
      }
    }

    ensureRegularFood() {
      if (this.food || this.status !== 'running') {
        return Boolean(this.food);
      }

      this.food = this.randomEmptyPosition();
      if (this.food) {
        const spaceReopened = this.waitingForSpace;
        this.waitingForSpace = false;
        if (spaceReopened) {
          this.emit('spaceReopened', { position: { ...this.food } });
        }
        return true;
      }

      if (this.isBoardFilledBySnake()) {
        if (this.isEasyMode()) {
          if (!this.waitingForSpace) {
            this.waitingForSpace = true;
            this.emit('boardFilled');
          }
        } else {
          this.finish('cleared');
        }
      }

      return false;
    }

    randomEmptyPosition(extraBlocked = [], predicate = null) {
      const blocked = this.blockedPositionKeys(extraBlocked);
      const available = [];

      for (let y = 0; y < this.settings.boardSize; y += 1) {
        for (let x = 0; x < this.settings.boardSize; x += 1) {
          const position = { x, y };
          if (!blocked.has(positionKey(position)) && (!predicate || predicate(position))) {
            available.push(position);
          }
        }
      }

      if (!available.length) {
        return null;
      }

      return { ...available[Math.floor(this.random() * available.length)] };
    }

    blockedPositionKeys(extraBlocked = []) {
      const positions = [
        ...this.snake,
        this.food,
        this.bonusFood,
        this.hazardFood,
        ...this.portals,
        ...this.rushMotes,
        ...extraBlocked,
      ].filter(Boolean);

      return new Set(positions.map(positionKey));
    }

    isEasyMode() {
      return this.settings.collisionMode === 'easy';
    }

    isBoardFilledBySnake() {
      const occupiedBySnake = new Set(this.snake.map(positionKey));
      return occupiedBySnake.size >= this.settings.boardSize ** 2;
    }

    isOutsideBoard(position) {
      return position.x < 0
        || position.y < 0
        || position.x >= this.settings.boardSize
        || position.y >= this.settings.boardSize;
    }

    wrapPosition(position) {
      const size = this.settings.boardSize;
      return {
        x: (position.x + size) % size,
        y: (position.y + size) % size,
      };
    }

    hasAvailableMove() {
      return Object.values(DIRECTIONS).some(direction => {
        let candidate = {
          x: this.snake[0].x + direction.x,
          y: this.snake[0].y + direction.y,
        };

        if (this.isOutsideBoard(candidate)) {
          if (this.settings.collisionMode !== 'wrap') {
            return false;
          }
          candidate = this.wrapPosition(candidate);
        }

        return !this.snake.slice(0, -1).some(segment => samePosition(segment, candidate));
      });
    }
  }

  return {
    DEFAULT_SETTINGS,
    DIRECTIONS,
    PRESETS,
    SnakeGame,
    normalizeSettings,
    samePosition,
  };
}));
