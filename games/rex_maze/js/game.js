(() => {
  'use strict';

  const STORAGE_KEYS = {
    bestScore: 'rexMazeBestScore',
    renown: 'rexMazeRenown',
    sound: 'rexMazeSoundEnabled'
  };

  const DIRECTIONS = [
    { name: 'up', dx: 0, dy: -1, opposite: 2, angle: -Math.PI / 2 },
    { name: 'right', dx: 1, dy: 0, opposite: 3, angle: 0 },
    { name: 'down', dx: 0, dy: 1, opposite: 0, angle: Math.PI / 2 },
    { name: 'left', dx: -1, dy: 0, opposite: 1, angle: Math.PI }
  ];

  const RANKS = [
    { name: 'Hatchling', min: 0, icon: '●' },
    { name: 'Trail Sniffer', min: 700, icon: '◆' },
    { name: 'Bone Scout', min: 1800, icon: '▲' },
    { name: 'Pack Hunter', min: 3500, icon: '✦' },
    { name: 'Canyon Stalker', min: 6000, icon: '★' },
    { name: 'Apex Rex', min: 10000, icon: '♛' },
    { name: 'Cretaceous Legend', min: 16000, icon: '☀' }
  ];

  const BIOMES = [
    { name: 'Fern Hollow', ground: '#29271f', groundAlt: '#302b20', moss: '#78954b', haze: 'rgba(255, 194, 71, 0.045)' },
    { name: 'Obsidian Pass', ground: '#25262a', groundAlt: '#2b2929', moss: '#71834c', haze: 'rgba(255, 106, 31, 0.055)' },
    { name: 'Amber Marsh', ground: '#2c291f', groundAlt: '#353023', moss: '#8ba34e', haze: 'rgba(255, 194, 71, 0.075)' },
    { name: 'Ember Caldera', ground: '#2b2421', groundAlt: '#342722', moss: '#657844', haze: 'rgba(255, 106, 31, 0.08)' },
    { name: 'Moonroot Wilds', ground: '#232728', groundAlt: '#292d2b', moss: '#5c986d', haze: 'rgba(25, 227, 227, 0.035)' }
  ];

  const ASSET_PATHS = {
    rex: 'graphics/rex.webp',
    raptor: 'graphics/raptor.webp',
    meat: 'graphics/meat.webp',
    amber: 'graphics/amber.webp',
    exit: 'graphics/exit.webp'
  };

  const dom = {
    canvas: document.getElementById('gameCanvas'),
    stage: document.getElementById('gameStage'),
    introModal: document.getElementById('introModal'),
    resultModal: document.getElementById('resultModal'),
    pauseModal: document.getElementById('pauseModal'),
    startButton: document.getElementById('startButton'),
    startButtonText: document.getElementById('startButtonText'),
    nextLevelButton: document.getElementById('nextLevelButton'),
    pauseButton: document.getElementById('pauseButton'),
    resumeButton: document.getElementById('resumeButton'),
    restartButton: document.getElementById('restartButton'),
    soundButton: document.getElementById('soundButton'),
    soundIcon: document.getElementById('soundIcon'),
    scentButton: document.getElementById('scentButton'),
    roarButton: document.getElementById('roarButton'),
    scoreValue: document.getElementById('scoreValue'),
    comboValue: document.getElementById('comboValue'),
    levelValue: document.getElementById('levelValue'),
    biomeValue: document.getElementById('biomeValue'),
    meatValue: document.getElementById('meatValue'),
    meatTotal: document.getElementById('meatTotal'),
    gateState: document.getElementById('gateState'),
    rankValue: document.getElementById('rankValue'),
    rankIcon: document.getElementById('rankIcon'),
    rankProgress: document.getElementById('rankProgress'),
    rankCaption: document.getElementById('rankCaption'),
    objectivePill: document.getElementById('objectivePill'),
    objectiveText: document.getElementById('objectiveText'),
    scentStatus: document.getElementById('scentStatus'),
    scentMeter: document.getElementById('scentMeter'),
    roarStatus: document.getElementById('roarStatus'),
    roarMeter: document.getElementById('roarMeter'),
    toast: document.getElementById('toast'),
    screenFlash: document.getElementById('screenFlash'),
    introRank: document.getElementById('introRank'),
    introBest: document.getElementById('introBest'),
    gradeBadge: document.getElementById('gradeBadge'),
    resultEyebrow: document.getElementById('resultEyebrow'),
    resultTitle: document.getElementById('resultTitle'),
    resultSummary: document.getElementById('resultSummary'),
    resultTime: document.getElementById('resultTime'),
    resultSteps: document.getElementById('resultSteps'),
    resultHits: document.getElementById('resultHits'),
    resultBonus: document.getElementById('resultBonus'),
    resultRenown: document.getElementById('resultRenown')
  };

  const ctx = dom.canvas.getContext('2d', { alpha: true });
  const savedSoundPreference = readStorage(STORAGE_KEYS.sound, 'true');

  const state = {
    phase: 'intro',
    level: 1,
    score: 0,
    levelScoreStart: 0,
    combo: 1,
    maxCombo: 1,
    renown: readStoredNumber(STORAGE_KEYS.renown),
    bestScore: readStoredNumber(STORAGE_KEYS.bestScore),
    soundEnabled: savedSoundPreference !== 'false',
    assets: {},
    assetsReady: false,
    grid: [],
    size: 9,
    config: null,
    biome: BIOMES[0],
    player: { x: 0, y: 0, direction: 1, invulnerableMoves: 0 },
    start: { x: 0, y: 0 },
    exit: { x: 0, y: 0 },
    meats: [],
    totalMeat: 0,
    amberRelics: [],
    amberFound: 0,
    tarPits: [],
    raptors: [],
    footprints: [],
    floaters: [],
    steps: 0,
    hits: 0,
    seed: 0,
    random: Math.random,
    board: { x: 0, y: 0, width: 0, height: 0, cell: 32 },
    viewport: { width: 0, height: 0, dpr: 1 },
    levelStartedAt: 0,
    pauseStartedAt: 0,
    totalPausedMs: 0,
    scentUsedAt: 0,
    scentReadyAt: 0,
    scentVisibleUntil: 0,
    scentPath: [],
    roar: 50,
    levelRoarStart: 50,
    roarWaveAt: -Infinity,
    lastMoveAt: -Infinity,
    toastTimer: 0,
    completion: null,
    audio: null
  };

  class SoundBank {
    constructor() {
      this.context = null;
    }

    init() {
      if (this.context || !state.soundEnabled) return;
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      this.context = new AudioContext();
    }

    resume() {
      if (this.context?.state === 'suspended') {
        this.context.resume().catch(() => {});
      }
    }

    tone(frequency, duration, options = {}) {
      if (!state.soundEnabled) return;
      this.init();
      if (!this.context) return;
      this.resume();

      const start = this.context.currentTime + (options.delay || 0);
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = options.type || 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      if (options.endFrequency) {
        oscillator.frequency.exponentialRampToValueAtTime(options.endFrequency, start + duration);
      }
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(options.volume || 0.045, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    }

    play(name) {
      const sounds = {
        meat: () => {
          this.tone(280, 0.13, { type: 'triangle', volume: 0.045 });
          this.tone(420, 0.16, { type: 'triangle', volume: 0.04, delay: 0.08 });
        },
        amber: () => {
          this.tone(520, 0.24, { type: 'sine', volume: 0.04 });
          this.tone(780, 0.3, { type: 'sine', volume: 0.035, delay: 0.08 });
        },
        gate: () => {
          this.tone(180, 0.35, { type: 'triangle', volume: 0.05, endFrequency: 520 });
          this.tone(620, 0.28, { type: 'sine', volume: 0.03, delay: 0.2 });
        },
        scent: () => this.tone(640, 0.3, { type: 'sine', volume: 0.028, endFrequency: 960 }),
        roar: () => {
          this.tone(95, 0.5, { type: 'sawtooth', volume: 0.055, endFrequency: 48 });
          this.tone(62, 0.56, { type: 'square', volume: 0.02, endFrequency: 42 });
        },
        hit: () => this.tone(170, 0.3, { type: 'sawtooth', volume: 0.05, endFrequency: 72 }),
        clear: () => [330, 440, 554, 660].forEach((note, index) => {
          this.tone(note, 0.24, { type: 'triangle', volume: 0.035, delay: index * 0.1 });
        })
      };
      sounds[name]?.();
    }
  }

  function readStorage(key, fallback) {
    try {
      return window.localStorage.getItem(key) ?? fallback;
    } catch (error) {
      return fallback;
    }
  }

  function readStoredNumber(key) {
    const parsed = Number.parseInt(readStorage(key, '0'), 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (error) {
      // Storage is an enhancement; private browsing modes may reject writes.
    }
  }

  function mulberry32(seed) {
    return () => {
      let value = seed += 0x6d2b79f5;
      value = Math.imul(value ^ value >>> 15, value | 1);
      value ^= value + Math.imul(value ^ value >>> 7, value | 61);
      return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
  }

  function makeSeed() {
    if (window.crypto?.getRandomValues) {
      const values = new Uint32Array(1);
      window.crypto.getRandomValues(values);
      return values[0];
    }
    return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
  }

  function randomInt(max) {
    return Math.floor(state.random() * max);
  }

  function shuffle(items) {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const target = randomInt(index + 1);
      [items[index], items[target]] = [items[target], items[index]];
    }
    return items;
  }

  function positionKey(x, y) {
    return `${x},${y}`;
  }

  function samePosition(first, second) {
    return first.x === second.x && first.y === second.y;
  }

  function getRank(renown) {
    let currentIndex = 0;
    for (let index = 0; index < RANKS.length; index += 1) {
      if (renown >= RANKS[index].min) currentIndex = index;
    }
    return {
      current: RANKS[currentIndex],
      next: RANKS[currentIndex + 1] || null,
      index: currentIndex
    };
  }

  function getLevelConfig(level) {
    const size = Math.min(23, 9 + Math.floor((level - 1) / 2) * 2);
    const meatCount = Math.min(8, 3 + Math.floor((level - 1) / 2));
    return {
      size,
      meatCount,
      amberCount: level >= 2 ? Math.min(2, 1 + Math.floor((level - 1) / 7)) : 0,
      raptorCount: level >= 2 ? Math.min(4, 1 + Math.floor((level - 2) / 3)) : 0,
      tarCount: level >= 3 ? Math.min(12, 1 + Math.floor(level * 0.75)) : 0,
      loopCount: Math.min(size, Math.floor(level * 0.7)),
      raptorMoveEvery: level < 4 ? 2 : 1,
      chaseRange: Math.min(10, 4 + Math.floor(level / 2)),
      scentCooldownMs: Math.min(16000, 10500 + level * 350),
      scentDurationMs: Math.max(1900, 3400 - level * 70),
      targetSteps: Math.round(size * size * 0.72 + meatCount * 8),
      parTime: Math.round(size * size * 0.68 + meatCount * 7 + level * 2)
    };
  }

  function createCell() {
    return { walls: [true, true, true, true], visited: false };
  }

  function generateMaze(size) {
    const grid = Array.from({ length: size }, () => Array.from({ length: size }, createCell));
    const origin = { x: 0, y: size - 1 };
    const stack = [origin];
    grid[origin.y][origin.x].visited = true;

    while (stack.length) {
      const current = stack[stack.length - 1];
      const candidates = DIRECTIONS
        .map((direction, index) => ({
          x: current.x + direction.dx,
          y: current.y + direction.dy,
          index,
          opposite: direction.opposite
        }))
        .filter(({ x, y }) => x >= 0 && y >= 0 && x < size && y < size && !grid[y][x].visited);

      if (!candidates.length) {
        stack.pop();
        continue;
      }

      const next = candidates[randomInt(candidates.length)];
      grid[current.y][current.x].walls[next.index] = false;
      grid[next.y][next.x].walls[next.opposite] = false;
      grid[next.y][next.x].visited = true;
      stack.push({ x: next.x, y: next.y });
    }

    for (const row of grid) {
      for (const cell of row) delete cell.visited;
    }

    return grid;
  }

  function addMazeLoops(count) {
    const walls = [];
    for (let y = 0; y < state.size; y += 1) {
      for (let x = 0; x < state.size; x += 1) {
        if (x < state.size - 1 && state.grid[y][x].walls[1]) walls.push({ x, y, direction: 1 });
        if (y < state.size - 1 && state.grid[y][x].walls[2]) walls.push({ x, y, direction: 2 });
      }
    }

    shuffle(walls);
    walls.slice(0, count).forEach(({ x, y, direction }) => {
      const vector = DIRECTIONS[direction];
      state.grid[y][x].walls[direction] = false;
      state.grid[y + vector.dy][x + vector.dx].walls[vector.opposite] = false;
    });
  }

  function getOpenNeighbors(position) {
    const cell = state.grid[position.y]?.[position.x];
    if (!cell) return [];
    return DIRECTIONS.reduce((neighbors, direction, index) => {
      if (cell.walls[index]) return neighbors;
      const x = position.x + direction.dx;
      const y = position.y + direction.dy;
      if (x >= 0 && y >= 0 && x < state.size && y < state.size) {
        neighbors.push({ x, y, direction: index });
      }
      return neighbors;
    }, []);
  }

  function getDistanceMap(origin) {
    const distances = new Map([[positionKey(origin.x, origin.y), 0]]);
    const queue = [{ x: origin.x, y: origin.y }];

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const distance = distances.get(positionKey(current.x, current.y));
      getOpenNeighbors(current).forEach((neighbor) => {
        const key = positionKey(neighbor.x, neighbor.y);
        if (distances.has(key)) return;
        distances.set(key, distance + 1);
        queue.push({ x: neighbor.x, y: neighbor.y });
      });
    }

    return distances;
  }

  function getShortestPath(origin, target) {
    const originKey = positionKey(origin.x, origin.y);
    const targetKey = positionKey(target.x, target.y);
    const previous = new Map();
    const visited = new Set([originKey]);
    const queue = [{ x: origin.x, y: origin.y }];

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      const currentKey = positionKey(current.x, current.y);
      if (currentKey === targetKey) break;

      getOpenNeighbors(current).forEach((neighbor) => {
        const key = positionKey(neighbor.x, neighbor.y);
        if (visited.has(key)) return;
        visited.add(key);
        previous.set(key, currentKey);
        queue.push({ x: neighbor.x, y: neighbor.y });
      });
    }

    if (!visited.has(targetKey)) return [];
    const path = [];
    let cursor = targetKey;
    while (cursor) {
      const [x, y] = cursor.split(',').map(Number);
      path.push({ x, y });
      if (cursor === originKey) break;
      cursor = previous.get(cursor);
    }
    return path.reverse();
  }

  function getFarthestCell(origin) {
    const distances = getDistanceMap(origin);
    let farthest = { ...origin };
    let greatestDistance = -1;
    distances.forEach((distance, key) => {
      if (distance <= greatestDistance) return;
      const [x, y] = key.split(',').map(Number);
      farthest = { x, y };
      greatestDistance = distance;
    });
    return farthest;
  }

  function chooseSpreadCells(candidates, count, anchors = []) {
    const pool = [...candidates];
    const chosen = [];
    while (chosen.length < count && pool.length) {
      let bestIndex = 0;
      let bestScore = -Infinity;
      pool.forEach((candidate, index) => {
        const referencePoints = anchors.concat(chosen);
        const spread = referencePoints.length
          ? Math.min(...referencePoints.map((point) => Math.abs(point.x - candidate.x) + Math.abs(point.y - candidate.y)))
          : 0;
        const score = candidate.distance + spread * 2.2 + state.random() * state.size;
        if (score > bestScore) {
          bestScore = score;
          bestIndex = index;
        }
      });
      chosen.push(pool.splice(bestIndex, 1)[0]);
    }
    return chosen.map(({ x, y }) => ({ x, y }));
  }

  function createCandidates(excluded = new Set()) {
    const distances = getDistanceMap(state.start);
    const candidates = [];
    for (let y = 0; y < state.size; y += 1) {
      for (let x = 0; x < state.size; x += 1) {
        const key = positionKey(x, y);
        if (excluded.has(key)) continue;
        candidates.push({ x, y, distance: distances.get(key) || 0 });
      }
    }
    return candidates;
  }

  function placeLevelObjects() {
    const excluded = new Set([
      positionKey(state.start.x, state.start.y),
      positionKey(state.exit.x, state.exit.y)
    ]);

    let candidates = createCandidates(excluded)
      .filter((candidate) => candidate.distance >= Math.max(4, Math.floor(state.size * 0.6)));
    state.meats = chooseSpreadCells(candidates, state.config.meatCount, [state.start, state.exit])
      .map((position, index) => ({ ...position, id: index, phase: state.random() * Math.PI * 2 }));
    state.totalMeat = state.meats.length;
    state.meats.forEach(({ x, y }) => excluded.add(positionKey(x, y)));

    candidates = createCandidates(excluded);
    state.amberRelics = chooseSpreadCells(candidates, state.config.amberCount, [state.start, state.exit])
      .map((position, index) => ({ ...position, id: index, phase: state.random() * Math.PI * 2 }));
    state.amberRelics.forEach(({ x, y }) => excluded.add(positionKey(x, y)));

    candidates = createCandidates(excluded).filter((candidate) => candidate.distance > state.size);
    state.raptors = chooseSpreadCells(candidates, state.config.raptorCount, [state.start])
      .map((position, index) => ({
        ...position,
        id: index,
        direction: index % 2 ? 3 : 1,
        previous: null,
        stunnedTurns: 0,
        phase: state.random() * Math.PI * 2
      }));
    state.raptors.forEach(({ x, y }) => excluded.add(positionKey(x, y)));

    candidates = shuffle(createCandidates(excluded));
    state.tarPits = candidates.slice(0, state.config.tarCount).map((position, index) => ({
      x: position.x,
      y: position.y,
      phase: index * 0.9 + state.random() * Math.PI
    }));
  }

  function startLevel(forcedSeed) {
    const restarting = forcedSeed !== undefined;
    if (restarting) {
      state.score = state.levelScoreStart;
      state.roar = state.levelRoarStart;
    } else {
      state.levelScoreStart = state.score;
      state.levelRoarStart = Math.max(50, state.roar);
    }
    state.seed = forcedSeed ?? makeSeed();
    state.random = mulberry32(state.seed);
    state.config = getLevelConfig(state.level);
    state.size = state.config.size;
    state.biome = BIOMES[Math.floor((state.level - 1) / 2) % BIOMES.length];
    state.grid = generateMaze(state.size);
    addMazeLoops(state.config.loopCount);
    state.start = { x: 0, y: state.size - 1 };
    state.exit = getFarthestCell(state.start);
    state.player = { ...state.start, direction: 1, invulnerableMoves: 0 };
    placeLevelObjects();

    state.phase = 'playing';
    state.combo = 1;
    state.maxCombo = 1;
    state.steps = 0;
    state.hits = 0;
    state.amberFound = 0;
    state.roar = Math.max(50, state.roar);
    state.footprints = [];
    state.floaters = [];
    state.scentPath = [];
    state.scentVisibleUntil = 0;
    state.scentReadyAt = 0;
    state.scentUsedAt = 0;
    state.roarWaveAt = -Infinity;
    state.levelStartedAt = gameNow();
    state.completion = null;

    updateBoardLayout();
    updateHud();
    showToast(`Maze ${state.level}: ${state.biome.name}`);
    window.setTimeout(() => dom.canvas.focus({ preventScroll: true }), 80);
  }

  function gameNow() {
    return performance.now() - state.totalPausedMs;
  }

  function getElapsedSeconds(now = gameNow()) {
    return Math.max(0, (now - state.levelStartedAt) / 1000);
  }

  function canMove(directionIndex) {
    return !state.grid[state.player.y][state.player.x].walls[directionIndex];
  }

  function movePlayer(directionName) {
    if (state.phase !== 'playing') return;
    const now = gameNow();
    if (now - state.lastMoveAt < 72) return;
    const directionIndex = DIRECTIONS.findIndex(({ name }) => name === directionName);
    if (directionIndex < 0) return;
    state.player.direction = directionIndex;
    state.lastMoveAt = now;

    pulseMoveButton(directionName);
    if (!canMove(directionIndex)) {
      addFloater('blocked', state.player, '#9aa3b2');
      return;
    }

    const direction = DIRECTIONS[directionIndex];
    state.footprints.push({
      x: state.player.x,
      y: state.player.y,
      direction: directionIndex,
      born: now
    });
    state.player.x += direction.dx;
    state.player.y += direction.dy;
    state.steps += 1;

    const hitBeforeRaptorsMove = handleRaptorCollision();
    if (!hitBeforeRaptorsMove) {
      collectAtPlayer();
      if (state.phase !== 'playing') return;
      applyTarPenalty();
      checkExit();
      if (state.phase !== 'playing') return;
      advanceRaptors();
      handleRaptorCollision();
    }

    if (state.player.invulnerableMoves > 0) state.player.invulnerableMoves -= 1;
    if (gameNow() < state.scentVisibleUntil) updateScentPath();
    updateHud();
  }

  function collectAtPlayer() {
    const meatIndex = state.meats.findIndex((meat) => samePosition(meat, state.player));
    if (meatIndex >= 0) {
      state.meats.splice(meatIndex, 1);
      const points = 100 * state.combo;
      addPoints(points, state.player, `+${points}`);
      state.combo = Math.min(5, state.combo + 1);
      state.maxCombo = Math.max(state.maxCombo, state.combo);
      state.roar = Math.min(100, state.roar + 28);
      state.audio.play('meat');

      if (!state.meats.length) {
        state.audio.play('gate');
        showToast('The amber gate is open! Find the exit.');
        dom.objectivePill.classList.add('gate-open');
      } else {
        const remaining = state.meats.length;
        showToast(`${remaining} piece${remaining === 1 ? '' : 's'} of meat still hidden`);
      }
    }

    const amberIndex = state.amberRelics.findIndex((amber) => samePosition(amber, state.player));
    if (amberIndex >= 0) {
      state.amberRelics.splice(amberIndex, 1);
      state.amberFound += 1;
      state.roar = Math.min(100, state.roar + 50);
      state.scentReadyAt = 0;
      addPoints(250 * state.combo, state.player, `Amber +${250 * state.combo}`, '#ffc247');
      state.audio.play('amber');
      showToast('Amber relic! Scent restored and roar charged.');
    }
  }

  function applyTarPenalty() {
    if (!state.tarPits.some((pit) => samePosition(pit, state.player))) return;
    state.steps += 1;
    state.score = Math.max(0, state.score - 10);
    state.combo = 1;
    addFloater('-10 sticky tar', state.player, '#ff7c3b');
    showToast('Sticky tar costs an extra step.');
  }

  function addPoints(points, position, label, color = '#ffc247') {
    state.score += points;
    addFloater(label, position, color);
  }

  function addFloater(text, position, color) {
    state.floaters.push({
      text,
      x: position.x,
      y: position.y,
      color,
      born: gameNow()
    });
  }

  function advanceRaptors() {
    if (!state.raptors.length || state.steps % state.config.raptorMoveEvery !== 0) return;
    const distanceToPlayer = getDistanceMap(state.player);
    const occupied = new Set(state.raptors.map((raptor) => positionKey(raptor.x, raptor.y)));

    state.raptors.forEach((raptor) => {
      if (raptor.stunnedTurns > 0) {
        raptor.stunnedTurns -= 1;
        return;
      }

      occupied.delete(positionKey(raptor.x, raptor.y));
      let options = getOpenNeighbors(raptor)
        .filter((option) => !occupied.has(positionKey(option.x, option.y)));
      if (!options.length) {
        occupied.add(positionKey(raptor.x, raptor.y));
        return;
      }

      const raptorDistance = distanceToPlayer.get(positionKey(raptor.x, raptor.y));
      const isChasing = raptorDistance !== undefined && raptorDistance <= state.config.chaseRange;
      if (isChasing) {
        options.sort((first, second) => {
          const firstDistance = distanceToPlayer.get(positionKey(first.x, first.y)) ?? Infinity;
          const secondDistance = distanceToPlayer.get(positionKey(second.x, second.y)) ?? Infinity;
          return firstDistance - secondDistance;
        });
        options = state.random() < 0.84 ? [options[0]] : options;
      } else if (raptor.previous && options.length > 1) {
        options = options.filter((option) => !samePosition(option, raptor.previous));
      }

      const next = options[randomInt(options.length)];
      raptor.previous = { x: raptor.x, y: raptor.y };
      raptor.x = next.x;
      raptor.y = next.y;
      raptor.direction = next.direction;
      occupied.add(positionKey(raptor.x, raptor.y));
    });
  }

  function handleRaptorCollision() {
    const raptor = state.raptors.find((enemy) => samePosition(enemy, state.player));
    if (!raptor || raptor.stunnedTurns > 0 || state.player.invulnerableMoves > 0) return false;

    state.hits += 1;
    state.score = Math.max(0, state.score - 75);
    state.combo = 1;
    state.player.x = state.start.x;
    state.player.y = state.start.y;
    state.player.invulnerableMoves = 3;
    raptor.stunnedTurns = 2;
    state.scentVisibleUntil = 0;
    state.scentPath = [];
    flashScreen('hit');
    addFloater('-75 ambushed', state.start, '#ff4d4f');
    showToast('Raptor ambush! Rex scrambled back to the trailhead.');
    state.audio.play('hit');
    return true;
  }

  function useScent() {
    if (state.phase !== 'playing') return;
    const now = gameNow();
    if (now < state.scentReadyAt) {
      const wait = Math.ceil((state.scentReadyAt - now) / 1000);
      showToast(`Scent trail returns in ${wait}s`);
      return;
    }

    state.scentUsedAt = now;
    state.scentReadyAt = now + state.config.scentCooldownMs;
    state.scentVisibleUntil = now + state.config.scentDurationMs;
    updateScentPath();
    state.audio.play('scent');
    showToast(state.meats.length ? 'Fresh tracks lead toward the nearest meal.' : 'The gate leaves an amber trail.');
  }

  function updateScentPath() {
    const targets = state.meats.length ? state.meats : [state.exit];
    let shortest = [];
    targets.forEach((target) => {
      const path = getShortestPath(state.player, target);
      if (path.length && (!shortest.length || path.length < shortest.length)) shortest = path;
    });
    state.scentPath = shortest;
  }

  function useRoar() {
    if (state.phase !== 'playing') return;
    if (state.roar < 100) {
      showToast(`Roar is ${Math.round(state.roar)}% charged. Meat and amber refill it.`);
      return;
    }

    const distances = getDistanceMap(state.player);
    const targets = state.raptors.filter((raptor) => {
      const distance = distances.get(positionKey(raptor.x, raptor.y));
      return distance !== undefined && distance <= 4;
    });
    if (!targets.length) {
      showToast('No raptors close enough to hear the roar.');
      return;
    }

    targets.forEach((raptor) => {
      raptor.stunnedTurns = Math.max(raptor.stunnedTurns, 5);
      addFloater('stunned', raptor, '#ffc247');
    });
    state.roar = 0;
    state.roarWaveAt = gameNow();
    addPoints(targets.length * 25, state.player, `Roar +${targets.length * 25}`);
    flashScreen('roar');
    state.audio.play('roar');
    showToast(`${targets.length} raptor${targets.length === 1 ? '' : 's'} stunned for five turns!`);
    updateHud();
  }

  function checkExit() {
    if (!samePosition(state.player, state.exit)) return;
    if (state.meats.length) {
      const remaining = state.meats.length;
      showToast(`The gate needs ${remaining} more piece${remaining === 1 ? '' : 's'} of meat.`);
      addFloater('gate sealed', state.exit, '#ff7c3b');
      return;
    }
    completeLevel();
  }

  function calculatePerformance() {
    const elapsed = getElapsedSeconds();
    const timeRatio = state.config.parTime / Math.max(elapsed, 1);
    const stepRatio = state.config.targetSteps / Math.max(state.steps, 1);
    const cleanRun = state.hits === 0 ? 0.18 : Math.max(0, 0.12 - state.hits * 0.06);
    const performance = timeRatio * 0.46 + stepRatio * 0.38 + cleanRun;
    let grade = 'C';
    if (performance >= 1.18) grade = 'S';
    else if (performance >= 0.93) grade = 'A';
    else if (performance >= 0.7) grade = 'B';

    const speedBonus = Math.max(0, Math.round((state.config.parTime - elapsed) * 5));
    const routeBonus = Math.max(0, (state.config.targetSteps - state.steps) * 3);
    const cleanBonus = state.hits === 0 ? 250 : 0;
    const levelBonus = 120 + state.level * 80;
    const bonus = Math.round(speedBonus + routeBonus + cleanBonus + levelBonus);
    const gradeRenown = { S: 320, A: 230, B: 150, C: 90 }[grade];
    const renown = Math.max(60, Math.round(gradeRenown + state.level * 38 + state.amberFound * 55 - state.hits * 20));
    return { elapsed, grade, bonus, renown, performance };
  }

  function completeLevel() {
    if (state.phase !== 'playing') return;
    state.phase = 'complete';
    const previousRank = getRank(state.renown).current;
    const performance = calculatePerformance();
    state.score += performance.bonus;
    state.bestScore = Math.max(state.bestScore, state.score);
    state.renown += performance.renown;
    const currentRank = getRank(state.renown).current;
    state.completion = performance;

    writeStorage(STORAGE_KEYS.bestScore, state.bestScore);
    writeStorage(STORAGE_KEYS.renown, state.renown);
    state.audio.play('clear');
    updateHud();

    const gradeMessages = {
      S: 'An apex hunt: swift, sharp, and almost impossible to track.',
      A: 'A clean hunt with the raptor pack left far behind.',
      B: 'A strong expedition through a restless jungle.',
      C: 'The gate opened, and every escape makes Rex wiser.'
    };
    const newRankText = currentRank.name !== previousRank.name
      ? ` New rank: ${currentRank.name}!`
      : '';

    dom.gradeBadge.textContent = performance.grade;
    dom.gradeBadge.setAttribute('aria-label', `Performance grade ${performance.grade}`);
    dom.resultEyebrow.textContent = `Maze ${state.level} cleared · Grade ${performance.grade}`;
    dom.resultTitle.textContent = currentRank.name !== previousRank.name
      ? `${currentRank.name} earned!`
      : 'The gate remembers your name.';
    dom.resultSummary.textContent = `${gradeMessages[performance.grade]}${newRankText}`;
    dom.resultTime.textContent = formatTime(performance.elapsed);
    dom.resultSteps.textContent = state.steps.toLocaleString();
    dom.resultHits.textContent = state.hits.toLocaleString();
    dom.resultBonus.textContent = `+${performance.bonus.toLocaleString()}`;
    dom.resultRenown.textContent = `+${performance.renown.toLocaleString()}`;

    window.setTimeout(() => openModal(dom.resultModal, dom.nextLevelButton), 420);
  }

  function pauseGame() {
    if (state.phase !== 'playing') return;
    state.phase = 'paused';
    state.pauseStartedAt = performance.now();
    updateAbilityHud(gameNow());
    openModal(dom.pauseModal, dom.resumeButton);
  }

  function resumeGame() {
    if (state.phase !== 'paused') return;
    state.totalPausedMs += performance.now() - state.pauseStartedAt;
    state.phase = 'playing';
    updateAbilityHud(gameNow());
    closeModal(dom.pauseModal);
    window.setTimeout(() => dom.canvas.focus({ preventScroll: true }), 100);
  }

  function restartLevel() {
    if (state.phase === 'paused') {
      state.totalPausedMs += performance.now() - state.pauseStartedAt;
    }
    closeModal(dom.pauseModal);
    window.setTimeout(() => startLevel(state.seed), 180);
  }

  function openModal(modal, focusTarget) {
    modal.hidden = false;
    requestAnimationFrame(() => {
      modal.classList.add('is-open');
      window.setTimeout(() => focusTarget?.focus(), 120);
    });
  }

  function closeModal(modal) {
    modal.classList.remove('is-open');
    window.setTimeout(() => {
      if (!modal.classList.contains('is-open')) modal.hidden = true;
    }, 230);
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    dom.toast.textContent = message;
    dom.toast.classList.add('is-visible');
    state.toastTimer = window.setTimeout(() => dom.toast.classList.remove('is-visible'), 2200);
  }

  function flashScreen(className) {
    dom.screenFlash.classList.remove('hit', 'roar');
    void dom.screenFlash.offsetWidth;
    dom.screenFlash.classList.add(className);
  }

  function pulseMoveButton(direction) {
    const button = document.querySelector(`[data-direction="${direction}"]`);
    if (!button) return;
    button.classList.add('is-pressed');
    window.setTimeout(() => button.classList.remove('is-pressed'), 90);
  }

  function updateHud() {
    const rank = getRank(state.renown);
    const collected = Math.max(0, state.totalMeat - state.meats.length);
    dom.scoreValue.textContent = Math.round(state.score).toLocaleString();
    dom.comboValue.textContent = `x${state.combo} combo`;
    dom.levelValue.textContent = state.level;
    dom.biomeValue.textContent = state.biome.name;
    dom.meatValue.textContent = collected;
    dom.meatTotal.textContent = state.totalMeat;
    dom.gateState.textContent = state.meats.length ? 'Gate sealed' : 'Gate open';
    dom.rankValue.textContent = rank.current.name;
    dom.rankIcon.textContent = rank.current.icon;

    if (rank.next) {
      const progress = (state.renown - rank.current.min) / (rank.next.min - rank.current.min);
      dom.rankProgress.style.width = `${Math.max(0, Math.min(100, progress * 100))}%`;
      dom.rankCaption.textContent = `${state.renown.toLocaleString()} / ${rank.next.min.toLocaleString()} renown`;
    } else {
      dom.rankProgress.style.width = '100%';
      dom.rankCaption.textContent = `${state.renown.toLocaleString()} renown · maximum rank`;
    }

    if (state.meats.length) {
      const remaining = state.meats.length;
      dom.objectiveText.textContent = `Find ${remaining} more piece${remaining === 1 ? '' : 's'} of meat`;
      dom.objectivePill.classList.remove('gate-open');
    } else {
      dom.objectiveText.textContent = 'The amber gate is open — escape!';
      dom.objectivePill.classList.add('gate-open');
    }

    updateAbilityHud(gameNow());
  }

  function updateAbilityHud(now) {
    if (!state.config) return;
    const scentReady = now >= state.scentReadyAt;
    const scentProgress = scentReady
      ? 1
      : Math.max(0, 1 - (state.scentReadyAt - now) / state.config.scentCooldownMs);
    dom.scentButton.disabled = state.phase !== 'playing' || !scentReady;
    dom.scentMeter.style.width = `${scentProgress * 100}%`;
    dom.scentStatus.textContent = scentReady
      ? 'Ready · Space'
      : `${Math.max(1, Math.ceil((state.scentReadyAt - now) / 1000))}s · Space`;

    const roarReady = state.roar >= 100;
    dom.roarButton.disabled = state.phase !== 'playing' || !roarReady;
    dom.roarMeter.style.width = `${state.roar}%`;
    dom.roarStatus.textContent = roarReady ? 'Ready · R' : `${Math.round(state.roar)}% · R`;
  }

  function formatTime(seconds) {
    const wholeSeconds = Math.max(0, Math.round(seconds));
    const minutes = Math.floor(wholeSeconds / 60);
    const remainder = String(wholeSeconds % 60).padStart(2, '0');
    return `${minutes}:${remainder}`;
  }

  function resizeCanvas() {
    const rect = dom.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (dom.canvas.width !== Math.round(width * dpr) || dom.canvas.height !== Math.round(height * dpr)) {
      dom.canvas.width = Math.round(width * dpr);
      dom.canvas.height = Math.round(height * dpr);
    }
    state.viewport = { width, height, dpr };
    updateBoardLayout();
  }

  function updateBoardLayout() {
    if (!state.size || !state.viewport.width) return;
    const { width, height } = state.viewport;
    const horizontalPadding = width < 560 ? 16 : 32;
    const verticalPadding = width < 560 ? 60 : 72;
    const maximumCell = width > 1100 ? 62 : 54;
    const cell = Math.max(8, Math.min(
      maximumCell,
      Math.floor((width - horizontalPadding) / state.size),
      Math.floor((height - verticalPadding) / state.size)
    ));
    const boardWidth = cell * state.size;
    const boardHeight = cell * state.size;
    state.board = {
      cell,
      width: boardWidth,
      height: boardHeight,
      x: Math.round((width - boardWidth) / 2),
      y: Math.round((height - boardHeight) / 2 + 8)
    };
  }

  function roundRectPath(context, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.arcTo(x + width, y, x + width, y + height, safeRadius);
    context.arcTo(x + width, y + height, x, y + height, safeRadius);
    context.arcTo(x, y + height, x, y, safeRadius);
    context.arcTo(x, y, x + width, y, safeRadius);
    context.closePath();
  }

  function render() {
    const now = gameNow();
    const { width, height, dpr } = state.viewport;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!state.grid.length || !state.board.cell) return;

    drawBoardBase(now);
    drawTarPits(now);
    drawFootprints(now);
    drawScentPath(now);
    drawExit(now);
    drawCollectibles(now);
    drawWalls();
    drawRaptors(now);
    drawPlayer(now);
    drawRoarWave(now);
    drawFloaters(now);
  }

  function drawBoardBase(now) {
    const { x, y, width, height, cell } = state.board;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.56)';
    ctx.shadowBlur = 32;
    ctx.shadowOffsetY = 16;
    roundRectPath(ctx, x - 10, y - 10, width + 20, height + 20, 15);
    ctx.fillStyle = 'rgba(13, 14, 16, 0.88)';
    ctx.fill();
    ctx.shadowColor = 'transparent';

    for (let row = 0; row < state.size; row += 1) {
      for (let column = 0; column < state.size; column += 1) {
        const px = x + column * cell;
        const py = y + row * cell;
        const varied = hashValue(column, row, state.seed) % 3;
        ctx.fillStyle = varied === 0 ? state.biome.groundAlt : state.biome.ground;
        ctx.fillRect(px, py, cell + 0.5, cell + 0.5);
        ctx.fillStyle = state.biome.haze;
        ctx.fillRect(px, py, cell + 0.5, cell + 0.5);

        if (cell >= 18 && hashValue(column + 7, row + 13, state.seed) % 5 === 0) {
          const glint = 0.08 + Math.sin(now / 900 + column + row) * 0.018;
          ctx.fillStyle = `rgba(255, 194, 71, ${glint})`;
          ctx.beginPath();
          ctx.arc(px + cell * 0.25, py + cell * 0.72, Math.max(1, cell * 0.035), 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    ctx.strokeStyle = 'rgba(255, 194, 71, 0.18)';
    ctx.lineWidth = 1;
    roundRectPath(ctx, x - 10, y - 10, width + 20, height + 20, 15);
    ctx.stroke();
    ctx.restore();
  }

  function hashValue(x, y, seed) {
    let value = Math.imul(x + 11, 374761393) + Math.imul(y + 17, 668265263) + seed;
    value = Math.imul(value ^ value >>> 13, 1274126177);
    return (value ^ value >>> 16) >>> 0;
  }

  function cellCenter(position) {
    return {
      x: state.board.x + (position.x + 0.5) * state.board.cell,
      y: state.board.y + (position.y + 0.5) * state.board.cell
    };
  }

  function drawTarPits(now) {
    const cell = state.board.cell;
    state.tarPits.forEach((pit) => {
      const center = cellCenter(pit);
      const pulse = 0.92 + Math.sin(now / 700 + pit.phase) * 0.08;
      const gradient = ctx.createRadialGradient(center.x, center.y, 1, center.x, center.y, cell * 0.38 * pulse);
      gradient.addColorStop(0, 'rgba(14, 11, 13, 0.92)');
      gradient.addColorStop(0.72, 'rgba(34, 23, 25, 0.86)');
      gradient.addColorStop(1, 'rgba(81, 48, 30, 0.18)');
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.ellipse(center.x, center.y + cell * 0.08, cell * 0.38 * pulse, cell * 0.27, -0.12, 0, Math.PI * 2);
      ctx.fill();
      if (cell > 18) {
        ctx.fillStyle = 'rgba(255, 106, 31, 0.2)';
        ctx.beginPath();
        ctx.arc(center.x + Math.sin(now / 500 + pit.phase) * cell * 0.12, center.y, Math.max(1, cell * 0.035), 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  function drawFootprints(now) {
    const cell = state.board.cell;
    state.footprints = state.footprints.filter((footprint) => now - footprint.born < 5200);
    state.footprints.forEach((footprint) => {
      const age = (now - footprint.born) / 5200;
      const center = cellCenter(footprint);
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(DIRECTIONS[footprint.direction].angle);
      ctx.globalAlpha = Math.max(0, 0.24 * (1 - age));
      ctx.fillStyle = '#0e0f13';
      ctx.beginPath();
      ctx.ellipse(-cell * 0.08, 0, cell * 0.045, cell * 0.1, -0.25, 0, Math.PI * 2);
      ctx.ellipse(cell * 0.08, 0, cell * 0.045, cell * 0.1, 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  }

  function drawScentPath(now) {
    if (now >= state.scentVisibleUntil || !state.scentPath.length) return;
    const fade = Math.min(1, (state.scentVisibleUntil - now) / 450);
    ctx.save();
    ctx.globalAlpha = fade;
    state.scentPath.slice(1).forEach((position, index) => {
      const center = cellCenter(position);
      const pulse = 0.75 + Math.sin(now / 150 + index * 0.85) * 0.25;
      const radius = Math.max(1.7, state.board.cell * 0.075 * pulse);
      ctx.fillStyle = index % 2 ? '#ff6a1f' : '#ffc247';
      ctx.shadowColor = '#ffc247';
      ctx.shadowBlur = state.board.cell * 0.2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawImageAt(image, position, size, angle = 0, alpha = 1, verticalOffset = 0) {
    if (!image?.complete || !image.naturalWidth) return false;
    const center = cellCenter(position);
    const ratio = image.naturalWidth / image.naturalHeight;
    const width = ratio >= 1 ? size : size * ratio;
    const height = ratio >= 1 ? size / ratio : size;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(center.x, center.y + verticalOffset);
    ctx.rotate(angle);
    ctx.drawImage(image, -width / 2, -height / 2, width, height);
    ctx.restore();
    return true;
  }

  function drawExit(now) {
    const cell = state.board.cell;
    const center = cellCenter(state.exit);
    const unlocked = !state.meats.length;
    const pulse = 0.9 + Math.sin(now / 360) * 0.08;
    if (unlocked) {
      const glow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, cell * 0.72);
      glow.addColorStop(0, 'rgba(255, 194, 71, 0.5)');
      glow.addColorStop(1, 'rgba(255, 194, 71, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(center.x, center.y, cell * 0.72, 0, Math.PI * 2);
      ctx.fill();
    }
    const drawn = drawImageAt(state.assets.exit, state.exit, cell * (unlocked ? 1.22 * pulse : 1.05), 0, unlocked ? 1 : 0.42);
    if (!drawn) {
      ctx.fillStyle = unlocked ? '#ffc247' : '#4d4b47';
      ctx.fillRect(center.x - cell * 0.28, center.y - cell * 0.35, cell * 0.56, cell * 0.7);
    }
    if (!unlocked && cell >= 20) {
      ctx.fillStyle = '#171a20';
      ctx.strokeStyle = '#ff7c3b';
      ctx.lineWidth = Math.max(1, cell * 0.04);
      roundRectPath(ctx, center.x - cell * 0.12, center.y - cell * 0.03, cell * 0.24, cell * 0.22, cell * 0.04);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(center.x, center.y - cell * 0.03, cell * 0.08, Math.PI, 0);
      ctx.stroke();
    }
  }

  function drawCollectibles(now) {
    const cell = state.board.cell;
    state.meats.forEach((meat) => {
      const bob = Math.sin(now / 320 + meat.phase) * cell * 0.055;
      if (!drawImageAt(state.assets.meat, meat, cell * 0.62, -0.12, 1, bob)) {
        const center = cellCenter(meat);
        ctx.fillStyle = '#ff6a1f';
        ctx.beginPath();
        ctx.arc(center.x, center.y + bob, cell * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    state.amberRelics.forEach((amber) => {
      const bob = Math.sin(now / 260 + amber.phase) * cell * 0.07;
      const center = cellCenter(amber);
      ctx.save();
      ctx.globalAlpha = 0.44;
      ctx.fillStyle = '#ffc247';
      ctx.shadowColor = '#ffc247';
      ctx.shadowBlur = cell * 0.38;
      ctx.beginPath();
      ctx.arc(center.x, center.y + bob, cell * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      drawImageAt(state.assets.amber, amber, cell * 0.52, Math.sin(now / 1000 + amber.phase) * 0.08, 1, bob);
    });
  }

  function drawWalls() {
    const { x: boardX, y: boardY, cell } = state.board;
    const outerWidth = Math.max(2.2, cell * 0.15);
    const innerWidth = Math.max(1.1, cell * 0.075);

    const drawSegment = (x1, y1, x2, y2, seed) => {
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(10, 11, 12, 0.86)';
      ctx.lineWidth = outerWidth;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.strokeStyle = seed % 4 === 0 ? '#66634f' : '#56534b';
      ctx.lineWidth = innerWidth;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (cell >= 24 && seed % 5 === 0) {
        ctx.strokeStyle = state.biome.moss;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = Math.max(1, cell * 0.025);
        ctx.setLineDash([cell * 0.12, cell * 0.18]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
    };

    for (let row = 0; row < state.size; row += 1) {
      for (let column = 0; column < state.size; column += 1) {
        const cellData = state.grid[row][column];
        const left = boardX + column * cell;
        const top = boardY + row * cell;
        const right = left + cell;
        const bottom = top + cell;
        const seed = hashValue(column, row, state.seed);
        if (cellData.walls[0]) drawSegment(left, top, right, top, seed);
        if (cellData.walls[3]) drawSegment(left, top, left, bottom, seed >>> 2);
        if (row === state.size - 1 && cellData.walls[2]) drawSegment(left, bottom, right, bottom, seed >>> 4);
        if (column === state.size - 1 && cellData.walls[1]) drawSegment(right, top, right, bottom, seed >>> 6);
      }
    }
  }

  function drawRaptors(now) {
    const playerDistances = getDistanceMap(state.player);
    state.raptors.forEach((raptor) => {
      const bob = Math.sin(now / 170 + raptor.phase) * state.board.cell * 0.035;
      const alpha = raptor.stunnedTurns > 0 ? 0.64 : 1;
      const angle = DIRECTIONS[raptor.direction]?.angle || 0;
      const drawn = drawImageAt(state.assets.raptor, raptor, state.board.cell * 0.92, angle, alpha, bob);
      if (!drawn) {
        const center = cellCenter(raptor);
        ctx.fillStyle = raptor.stunnedTurns > 0 ? '#9aa3b2' : '#384354';
        ctx.beginPath();
        ctx.arc(center.x, center.y, state.board.cell * 0.25, 0, Math.PI * 2);
        ctx.fill();
      }

      const distance = playerDistances.get(positionKey(raptor.x, raptor.y));
      if (raptor.stunnedTurns > 0) {
        drawRaptorStatus(raptor, '✦', '#ffc247', now);
      } else if (distance !== undefined && distance <= state.config.chaseRange) {
        drawRaptorStatus(raptor, '!', '#ff6a1f', now);
      }
    });
  }

  function drawRaptorStatus(raptor, symbol, color, now) {
    if (state.board.cell < 16) return;
    const center = cellCenter(raptor);
    const y = center.y - state.board.cell * (0.36 + Math.sin(now / 210 + raptor.phase) * 0.04);
    ctx.save();
    ctx.fillStyle = 'rgba(14, 15, 19, 0.88)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center.x, y, Math.max(6, state.board.cell * 0.13), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.font = `900 ${Math.max(8, state.board.cell * 0.17)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(symbol, center.x, y + 0.5);
    ctx.restore();
  }

  function drawPlayer(now) {
    const blink = state.player.invulnerableMoves > 0 && Math.floor(now / 110) % 2 === 0;
    const bob = Math.sin(now / 155) * state.board.cell * 0.025;
    const angle = DIRECTIONS[state.player.direction]?.angle || 0;
    const drawn = drawImageAt(state.assets.rex, state.player, state.board.cell * 1.08, angle, blink ? 0.34 : 1, bob);
    if (!drawn) {
      const center = cellCenter(state.player);
      ctx.fillStyle = '#7ca64c';
      ctx.beginPath();
      ctx.arc(center.x, center.y, state.board.cell * 0.28, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawRoarWave(now) {
    const age = now - state.roarWaveAt;
    if (age < 0 || age > 700) return;
    const center = cellCenter(state.player);
    const progress = age / 700;
    ctx.save();
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = '#ffc247';
    ctx.lineWidth = Math.max(2, state.board.cell * 0.08 * (1 - progress));
    ctx.shadowColor = '#ff6a1f';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(center.x, center.y, state.board.cell * (0.4 + progress * 4.2), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawFloaters(now) {
    state.floaters = state.floaters.filter((floater) => now - floater.born < 1100);
    state.floaters.forEach((floater) => {
      const age = (now - floater.born) / 1100;
      const center = cellCenter(floater);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - age);
      ctx.fillStyle = floater.color;
      ctx.strokeStyle = 'rgba(14, 15, 19, 0.9)';
      ctx.lineWidth = 3;
      ctx.font = `900 ${Math.max(9, Math.min(15, state.board.cell * 0.28))}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const y = center.y - state.board.cell * (0.35 + age * 0.7);
      ctx.strokeText(floater.text, center.x, y);
      ctx.fillText(floater.text, center.x, y);
      ctx.restore();
    });
  }

  function animationLoop() {
    render();
    if (state.phase === 'playing') updateAbilityHud(gameNow());
    requestAnimationFrame(animationLoop);
  }

  function loadImage(path) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${path}`));
      image.src = path;
    });
  }

  async function loadAssets() {
    const entries = Object.entries(ASSET_PATHS);
    const results = await Promise.allSettled(entries.map(async ([name, path]) => [name, await loadImage(path)]));
    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const [name, image] = result.value;
        state.assets[name] = image;
      }
    });
    state.assetsReady = true;
    dom.startButton.disabled = false;
    dom.startButtonText.textContent = results.some((result) => result.status === 'rejected')
      ? 'Start with fallback art'
      : 'Begin expedition';
  }

  function toggleSound() {
    state.soundEnabled = !state.soundEnabled;
    writeStorage(STORAGE_KEYS.sound, state.soundEnabled);
    updateSoundButton();
    if (state.soundEnabled) {
      state.audio.init();
      state.audio.tone(440, 0.12, { type: 'sine', volume: 0.025 });
    }
  }

  function updateSoundButton() {
    dom.soundButton.setAttribute('aria-pressed', String(state.soundEnabled));
    dom.soundButton.setAttribute('aria-label', state.soundEnabled ? 'Mute sound' : 'Enable sound');
    dom.soundIcon.textContent = state.soundEnabled ? '♪' : '×';
  }

  function startNewRun() {
    if (!state.assetsReady) return;
    state.audio.init();
    state.score = 0;
    state.level = 1;
    state.roar = 50;
    closeModal(dom.introModal);
    window.setTimeout(startLevel, 170);
  }

  function handleKeyDown(event) {
    const key = event.key.toLowerCase();
    const directionKeys = {
      arrowup: 'up',
      w: 'up',
      arrowright: 'right',
      d: 'right',
      arrowdown: 'down',
      s: 'down',
      arrowleft: 'left',
      a: 'left'
    };

    if (directionKeys[key]) {
      event.preventDefault();
      movePlayer(directionKeys[key]);
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) useScent();
      return;
    }
    if (key === 'r') {
      event.preventDefault();
      if (!event.repeat) useRoar();
      return;
    }
    if (key === 'p' || key === 'escape') {
      event.preventDefault();
      if (state.phase === 'playing') pauseGame();
      else if (state.phase === 'paused') resumeGame();
    }
  }

  function bindEvents() {
    dom.startButton.addEventListener('click', startNewRun);
    dom.nextLevelButton.addEventListener('click', () => {
      closeModal(dom.resultModal);
      state.level += 1;
      window.setTimeout(startLevel, 190);
    });
    dom.pauseButton.addEventListener('click', () => {
      if (state.phase === 'paused') resumeGame();
      else pauseGame();
    });
    dom.resumeButton.addEventListener('click', resumeGame);
    dom.restartButton.addEventListener('click', restartLevel);
    dom.soundButton.addEventListener('click', toggleSound);
    dom.scentButton.addEventListener('click', useScent);
    dom.roarButton.addEventListener('click', useRoar);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });

    document.querySelectorAll('[data-direction]').forEach((button) => {
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        movePlayer(button.dataset.direction);
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.phase === 'playing') pauseGame();
    });

    if ('ResizeObserver' in window) {
      new ResizeObserver(resizeCanvas).observe(dom.stage);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }
  }

  function init() {
    state.audio = new SoundBank();
    const rank = getRank(state.renown);
    dom.introRank.textContent = rank.current.name;
    dom.introBest.textContent = state.bestScore.toLocaleString();
    updateSoundButton();
    bindEvents();
    resizeCanvas();
    updateHud();
    loadAssets().catch(() => {
      state.assetsReady = true;
      dom.startButton.disabled = false;
      dom.startButtonText.textContent = 'Start with fallback art';
    });
    requestAnimationFrame(animationLoop);
  }

  window.RexMazeInternals = Object.freeze({
    getLevelConfig,
    getRank,
    formatTime,
    mulberry32,
    getSnapshot: () => ({
      phase: state.phase,
      level: state.level,
      size: state.size,
      score: state.score,
      player: { ...state.player },
      exit: { ...state.exit },
      meats: state.meats.map(({ x, y }) => ({ x, y })),
      raptors: state.raptors.map(({ x, y, stunnedTurns }) => ({ x, y, stunnedTurns })),
      tarPits: state.tarPits.map(({ x, y }) => ({ x, y })),
      grid: state.grid.map((row) => row.map((cell) => ({ walls: [...cell.walls] })))
    })
  });

  init();
})();
