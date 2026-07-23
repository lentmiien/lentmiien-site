(function attachMazeGame(root) {
  'use strict';

  const MAX_MAZE_SIZE = 81;
  const DIRECTIONS = Object.freeze({
    up: Object.freeze({ dx: 0, dy: -1, wall: 0, angle: -Math.PI / 2 }),
    right: Object.freeze({ dx: 1, dy: 0, wall: 1, angle: 0 }),
    down: Object.freeze({ dx: 0, dy: 1, wall: 2, angle: Math.PI / 2 }),
    left: Object.freeze({ dx: -1, dy: 0, wall: 3, angle: Math.PI }),
  });

  const DIRECTION_LIST = Object.freeze([
    Object.freeze({ dx: 0, dy: -1, wall: 0, opposite: 2 }),
    Object.freeze({ dx: 1, dy: 0, wall: 1, opposite: 3 }),
    Object.freeze({ dx: 0, dy: 1, wall: 2, opposite: 0 }),
    Object.freeze({ dx: -1, dy: 0, wall: 3, opposite: 1 }),
  ]);

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function getMazeSize(baseSize, level) {
    const safeBaseSize = Math.max(3, Math.floor(Number(baseSize) || 5));
    const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
    return Math.min(MAX_MAZE_SIZE, safeBaseSize + ((safeLevel - 1) * 2));
  }

  function getSwipeDirection(deltaX, deltaY, threshold = 28) {
    const safeThreshold = Math.max(0, Number(threshold) || 0);
    if (Math.hypot(deltaX, deltaY) < safeThreshold) return null;

    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      return deltaX >= 0 ? 'right' : 'left';
    }
    return deltaY >= 0 ? 'down' : 'up';
  }

  function generateMaze(size, random = Math.random) {
    const safeSize = Math.max(2, Math.floor(Number(size) || 2));
    const maze = Array.from({ length: safeSize }, () => (
      Array.from({ length: safeSize }, () => ({ walls: [true, true, true, true] }))
    ));
    const visited = Array.from({ length: safeSize }, () => Array(safeSize).fill(false));
    const stack = [{ x: 0, y: 0 }];
    visited[0][0] = true;

    while (stack.length) {
      const current = stack[stack.length - 1];
      const candidates = DIRECTION_LIST
        .map((direction) => ({
          ...direction,
          x: current.x + direction.dx,
          y: current.y + direction.dy,
        }))
        .filter(({ x, y }) => (
          x >= 0
          && x < safeSize
          && y >= 0
          && y < safeSize
          && !visited[x][y]
        ));

      if (!candidates.length) {
        stack.pop();
        continue;
      }

      const randomValue = Number(random());
      const normalizedRandom = Number.isFinite(randomValue)
        ? clamp(randomValue, 0, 0.999999999)
        : 0;
      const next = candidates[Math.floor(normalizedRandom * candidates.length)];

      maze[current.x][current.y].walls[next.wall] = false;
      maze[next.x][next.y].walls[next.opposite] = false;
      visited[next.x][next.y] = true;
      stack.push({ x: next.x, y: next.y });
    }

    return maze;
  }

  const internals = Object.freeze({
    MAX_MAZE_SIZE,
    generateMaze,
    getMazeSize,
    getSwipeDirection,
  });

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = internals;
    return;
  }

  root.MazeGameInternals = internals;

  const canvas = document.getElementById('gameCanvas');
  const context = canvas.getContext('2d');
  const gameShell = document.querySelector('.game-shell');
  const gameStage = document.getElementById('gameStage');
  const introOverlay = document.getElementById('introOverlay');
  const levelUpOverlay = document.getElementById('levelUpOverlay');
  const startButton = document.getElementById('startButton');
  const nextLevelButton = document.getElementById('nextLevelButton');
  const previewButton = document.getElementById('previewButton');
  const previewButtonLabel = document.getElementById('previewButtonLabel');
  const viewBadge = document.getElementById('viewBadge');
  const objectiveText = document.getElementById('objectiveText');
  const levelValue = document.getElementById('levelValue');
  const scoreValue = document.getElementById('scoreValue');
  const treasureValue = document.getElementById('treasureValue');
  const treasureTotal = document.getElementById('treasureTotal');
  const toast = document.getElementById('toast');
  const swipeFeedback = document.getElementById('swipeFeedback');
  const stageFlash = document.getElementById('stageFlash');
  const gameAnnouncement = document.getElementById('gameAnnouncement');
  const completedLevelValue = document.getElementById('completedLevelValue');
  const rewardEyebrow = document.getElementById('rewardEyebrow');
  const levelUpTitle = document.getElementById('levelUpTitle');
  const rewardMessage = document.getElementById('rewardMessage');
  const rankUnlock = document.getElementById('rankUnlock');
  const resultTime = document.getElementById('resultTime');
  const resultTreasure = document.getElementById('resultTreasure');
  const resultPoints = document.getElementById('resultPoints');
  const nextLevelButtonLabel = document.getElementById('nextLevelButtonLabel');
  const confetti = document.getElementById('confetti');
  const scoreStat = document.querySelector('.hud-score');
  const challengeButtons = [...document.querySelectorAll('[data-base-size]')];

  const RANKS = Object.freeze([
    Object.freeze({ score: 0, name: 'Wayfinder' }),
    Object.freeze({ score: 500, name: 'Trailblazer' }),
    Object.freeze({ score: 1200, name: 'Cartographer' }),
    Object.freeze({ score: 2500, name: 'Maze Keeper' }),
    Object.freeze({ score: 5000, name: 'Atlas Master' }),
  ]);

  const REALMS = Object.freeze([
    Object.freeze({
      level: 4,
      name: 'Whispering Woods',
      message: 'A new realm opens. Its paths turn beneath a canopy of quiet emberlight.',
    }),
    Object.freeze({
      level: 7,
      name: 'Shimmering Caverns',
      message: 'Crystal corridors catch the atlas light and scatter it into hidden turns.',
    }),
    Object.freeze({
      level: 10,
      name: 'Misty Marshlands',
      message: 'The trail slips into silver fog, but the amber markers still burn bright.',
    }),
    Object.freeze({
      level: 13,
      name: 'Shadow Peaks',
      message: 'The labyrinth climbs into the graphite peaks, where every clear path is earned.',
    }),
  ]);

  const state = {
    phase: 'intro',
    baseSize: 5,
    level: 1,
    mazeSize: 5,
    maze: [],
    player: { x: 0, y: 0 },
    treasures: [],
    totalTreasures: 0,
    collectedTreasures: 0,
    score: 0,
    levelStartScore: 0,
    startTime: 0,
    pausedDuration: 0,
    hiddenAt: 0,
    previewMode: false,
    visitedCells: new Set(),
    lastDirection: 'right',
    activePointer: null,
    toastTimer: 0,
    renderFrame: 0,
    viewport: { width: 1, height: 1, dpr: 1 },
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  };

  function getCssToken(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  const palette = Object.freeze({
    bg: getCssToken('--bg', '#0E0F13'),
    surface1: getCssToken('--surface-1', '#171A20'),
    surface2: getCssToken('--surface-2', '#1B2026'),
    surface3: getCssToken('--surface-3', '#20242A'),
    border: getCssToken('--border', '#262B34'),
    divider: getCssToken('--divider', '#2B313C'),
    text: getCssToken('--text', '#E8ECF2'),
    textSecondary: getCssToken('--text-secondary', '#C1C7D3'),
    textMuted: getCssToken('--text-muted', '#9AA3B2'),
    textInverse: getCssToken('--text-inverse', '#111418'),
    brand: getCssToken('--brand', '#FF6A1F'),
    brandTint: getCssToken('--brand-tint', 'rgba(255, 106, 31, 0.14)'),
    accent: getCssToken('--accent', '#FFC247'),
    accentHover: getCssToken('--accent-hover', '#FFD36F'),
    accentTint: getCssToken('--accent-tint', 'rgba(255, 194, 71, 0.18)'),
    success: getCssToken('--success', '#17C696'),
  });

  function getRank(score) {
    return RANKS.reduce((current, rank) => (score >= rank.score ? rank : current), RANKS[0]);
  }

  function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    return `${minutes}:${String(safeSeconds % 60).padStart(2, '0')}`;
  }

  function getElapsedSeconds() {
    const endTime = state.hiddenAt || performance.now();
    return Math.max(0, (endTime - state.startTime - state.pausedDuration) / 1000);
  }

  function requestRender() {
    if (state.renderFrame) return;
    state.renderFrame = requestAnimationFrame(() => {
      state.renderFrame = 0;
      drawMaze();
    });
  }

  function announce(message) {
    gameAnnouncement.textContent = '';
    requestAnimationFrame(() => {
      gameAnnouncement.textContent = message;
    });
  }

  function showToast(message) {
    window.clearTimeout(state.toastTimer);
    toast.classList.remove('is-visible');
    toast.textContent = message;
    void toast.offsetWidth;
    toast.classList.add('is-visible');
    state.toastTimer = window.setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 1800);
  }

  function bumpScore() {
    scoreStat.classList.remove('is-bumped');
    void scoreStat.offsetWidth;
    scoreStat.classList.add('is-bumped');
    window.setTimeout(() => scoreStat.classList.remove('is-bumped'), 450);
  }

  function showSwipeFeedback(direction) {
    swipeFeedback.classList.remove('is-active');
    swipeFeedback.dataset.direction = direction;
    void swipeFeedback.offsetWidth;
    swipeFeedback.classList.add('is-active');
  }

  function updateObjective() {
    if (state.previewMode) {
      objectiveText.textContent = 'Overview open · swipes still move one space';
      return;
    }

    const remaining = state.totalTreasures - state.collectedTreasures;
    if (remaining === 0 && state.totalTreasures > 0) {
      objectiveText.textContent = 'All amber found · head for the jade gate';
    } else if (remaining === 1) {
      objectiveText.textContent = '1 amber remains · the jade gate awaits';
    } else {
      objectiveText.textContent = `${remaining} amber remain · reach the jade gate`;
    }
  }

  function updateHud() {
    levelValue.textContent = String(state.level);
    scoreValue.textContent = state.score.toLocaleString('en-US');
    treasureValue.textContent = String(state.collectedTreasures);
    treasureTotal.textContent = String(state.totalTreasures);
    updateObjective();
  }

  function setPreviewMode(enabled, options = {}) {
    if (state.phase !== 'playing') return;

    state.previewMode = Boolean(enabled);
    previewButton.setAttribute('aria-pressed', String(state.previewMode));
    previewButtonLabel.textContent = state.previewMode ? 'Follow player' : 'Full maze';
    viewBadge.hidden = !state.previewMode;
    gameStage.classList.toggle('is-preview', state.previewMode);
    updateObjective();
    requestRender();

    const message = state.previewMode
      ? `Full maze overview. Level ${state.level} is ${state.mazeSize} by ${state.mazeSize} cells.`
      : 'Follow view restored. The explorer is centered.';
    announce(message);
    if (!options.silent) showToast(state.previewMode ? 'Full maze overview' : 'Following explorer');
    if (!options.preserveFocus) canvas.focus({ preventScroll: true });
  }

  function togglePreview() {
    setPreviewMode(!state.previewMode);
  }

  function shuffle(array) {
    for (let index = array.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
    }
    return array;
  }

  function placeTreasures() {
    const availableCells = [];
    for (let x = 0; x < state.mazeSize; x += 1) {
      for (let y = 0; y < state.mazeSize; y += 1) {
        const isStart = x === 0 && y === 0;
        const isExit = x === state.mazeSize - 1 && y === state.mazeSize - 1;
        if (!isStart && !isExit) availableCells.push({ x, y });
      }
    }

    const treasureCount = Math.min(
      availableCells.length,
      12,
      2 + Math.floor((state.level - 1) / 2),
    );
    state.treasures = shuffle(availableCells).slice(0, treasureCount);
    state.totalTreasures = treasureCount;
    state.collectedTreasures = 0;
  }

  function startLevel() {
    state.phase = 'playing';
    state.mazeSize = getMazeSize(state.baseSize, state.level);
    state.maze = generateMaze(state.mazeSize);
    state.player = { x: 0, y: 0 };
    state.visitedCells = new Set(['0,0']);
    state.lastDirection = 'right';
    state.levelStartScore = state.score;
    state.previewMode = false;
    state.pausedDuration = 0;
    state.hiddenAt = 0;
    placeTreasures();
    state.startTime = performance.now();

    previewButton.disabled = false;
    previewButton.setAttribute('aria-pressed', 'false');
    previewButtonLabel.textContent = 'Full maze';
    viewBadge.hidden = true;
    gameStage.classList.remove('is-preview');
    canvas.setAttribute(
      'aria-label',
      `Level ${state.level}, a ${state.mazeSize} by ${state.mazeSize} maze. Swipe across the board, or use the arrow keys or WASD, to move one space.`,
    );
    updateHud();
    requestRender();
    announce(`Level ${state.level} started. ${state.mazeSize} by ${state.mazeSize} maze with ${state.totalTreasures} amber pieces.`);
    showToast(`Level ${state.level} · ${state.mazeSize} × ${state.mazeSize}`);
    canvas.focus({ preventScroll: true });
  }

  function startRun() {
    const selectedChallenge = challengeButtons.find(
      (button) => button.getAttribute('aria-pressed') === 'true',
    );
    state.baseSize = Number(selectedChallenge?.dataset.baseSize) || 5;
    state.level = 1;
    state.score = 0;
    gameShell.inert = false;
    introOverlay.classList.remove('is-open');
    introOverlay.hidden = true;
    startLevel();
  }

  function collectTreasure() {
    const treasureIndex = state.treasures.findIndex(
      ({ x, y }) => x === state.player.x && y === state.player.y,
    );
    if (treasureIndex === -1) return;

    state.treasures.splice(treasureIndex, 1);
    state.collectedTreasures += 1;
    const treasurePoints = 25 + ((state.level - 1) * 5);
    state.score += treasurePoints;
    updateHud();
    bumpScore();
    showToast(`Amber found · +${treasurePoints}`);
    announce(`Amber found. ${state.collectedTreasures} of ${state.totalTreasures}.`);
  }

  function calculateLevelReward(elapsedSeconds) {
    const baseReward = 110 + (state.level * 30);
    const routeScale = state.mazeSize * 8;
    const speedReward = Math.max(20, Math.round(115 + routeScale - (elapsedSeconds * 3)));
    const allAmberReward = state.collectedTreasures === state.totalTreasures
      ? 70 + (state.level * 10)
      : 0;
    return baseReward + speedReward + allAmberReward;
  }

  function createConfetti() {
    confetti.replaceChildren();
    if (state.reducedMotion) return;

    const colors = [palette.brand, palette.accent, palette.accentHover, palette.success, palette.text];
    const pieces = Array.from({ length: 30 }, (_, index) => {
      const piece = document.createElement('span');
      const angle = ((Math.PI * 2) / 30) * index + ((Math.random() - 0.5) * 0.34);
      const horizontalDistance = 150 + (Math.random() * Math.min(window.innerWidth * 0.36, 340));
      const verticalDistance = 120 + (Math.random() * Math.min(window.innerHeight * 0.36, 280));
      const horizontal = Math.cos(angle) * horizontalDistance;
      const vertical = (Math.sin(angle) * verticalDistance) + 120;
      piece.style.setProperty('--confetti-x', `${horizontal.toFixed(1)}px`);
      piece.style.setProperty('--confetti-y', `${vertical.toFixed(1)}px`);
      piece.style.setProperty('--confetti-rotation', `${Math.round(360 + (Math.random() * 900))}deg`);
      piece.style.setProperty('--confetti-delay', `${Math.round(Math.random() * 180)}ms`);
      piece.style.setProperty('--confetti-color', colors[index % colors.length]);
      return piece;
    });
    confetti.append(...pieces);
  }

  function openLevelReward(elapsedSeconds, pointsEarned) {
    const nextLevel = state.level + 1;
    const nextSize = getMazeSize(state.baseSize, nextLevel);
    const previousRank = getRank(state.levelStartScore);
    const currentRank = getRank(state.score);
    const newRealm = REALMS.find((realm) => realm.level === nextLevel);

    completedLevelValue.textContent = String(state.level);
    levelUpTitle.textContent = `Level ${nextLevel} unlocked!`;
    rewardEyebrow.textContent = newRealm ? `Realm unlocked · ${newRealm.name}` : 'Path complete';
    rewardMessage.textContent = newRealm
      ? newRealm.message
      : nextSize > state.mazeSize
        ? `The atlas shifts. A larger ${nextSize} × ${nextSize} labyrinth is taking shape.`
        : 'The atlas has reached its grandest scale. The next path will be newly carved.';
    resultTime.textContent = formatTime(elapsedSeconds);
    resultTreasure.textContent = `${state.collectedTreasures} / ${state.totalTreasures}`;
    resultPoints.textContent = `+${pointsEarned.toLocaleString('en-US')}`;
    nextLevelButtonLabel.textContent = `Enter level ${nextLevel}`;

    const unlockedRank = currentRank.score > previousRank.score;
    rankUnlock.hidden = !unlockedRank;
    rankUnlock.textContent = unlockedRank ? `New rank · ${currentRank.name}` : '';

    createConfetti();
    gameShell.inert = true;
    levelUpOverlay.hidden = false;
    requestAnimationFrame(() => {
      levelUpOverlay.classList.add('is-open');
      nextLevelButton.focus({ preventScroll: true });
    });
  }

  function completeLevel() {
    if (state.phase !== 'playing') return;

    state.phase = 'celebrating';
    const elapsedSeconds = getElapsedSeconds();
    const reward = calculateLevelReward(elapsedSeconds);
    state.score += reward;
    const pointsEarned = state.score - state.levelStartScore;
    previewButton.disabled = true;
    updateHud();
    bumpScore();

    stageFlash.classList.remove('is-active');
    void stageFlash.offsetWidth;
    stageFlash.classList.add('is-active');
    announce(`Level ${state.level} cleared. ${pointsEarned} points earned.`);

    window.setTimeout(
      () => openLevelReward(elapsedSeconds, pointsEarned),
      state.reducedMotion ? 0 : 420,
    );
  }

  function startNextLevel() {
    levelUpOverlay.classList.remove('is-open');
    levelUpOverlay.hidden = true;
    confetti.replaceChildren();
    gameShell.inert = false;
    state.level += 1;
    startLevel();
  }

  function movePlayer(direction) {
    if (state.phase !== 'playing') return false;

    const movement = DIRECTIONS[direction];
    if (!movement) return false;
    const cell = state.maze[state.player.x][state.player.y];
    state.lastDirection = direction;
    showSwipeFeedback(direction);

    if (cell.walls[movement.wall]) {
      requestRender();
      return false;
    }

    state.player.x = clamp(state.player.x + movement.dx, 0, state.mazeSize - 1);
    state.player.y = clamp(state.player.y + movement.dy, 0, state.mazeSize - 1);
    state.visitedCells.add(`${state.player.x},${state.player.y}`);
    collectTreasure();
    updateHud();
    requestRender();

    if (state.player.x === state.mazeSize - 1 && state.player.y === state.mazeSize - 1) {
      completeLevel();
    }
    return true;
  }

  function resizeCanvas() {
    const bounds = gameStage.getBoundingClientRect();
    const width = Math.max(1, Math.round(bounds.width));
    const height = Math.max(1, Math.round(bounds.height));
    const dpr = clamp(window.devicePixelRatio || 1, 1, 2.5);

    state.viewport = { width, height, dpr };
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    requestRender();
  }

  function drawRoundedRect(x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + safeRadius, y);
    context.lineTo(x + width - safeRadius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
    context.lineTo(x + width, y + height - safeRadius);
    context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
    context.lineTo(x + safeRadius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
    context.lineTo(x, y + safeRadius);
    context.quadraticCurveTo(x, y, x + safeRadius, y);
    context.closePath();
  }

  function drawBackdrop(width, height) {
    context.fillStyle = palette.bg;
    context.fillRect(0, 0, width, height);

    const glow = context.createRadialGradient(
      width * 0.5,
      height * 0.46,
      0,
      width * 0.5,
      height * 0.46,
      Math.max(width, height) * 0.66,
    );
    glow.addColorStop(0, palette.accentTint);
    glow.addColorStop(0.36, palette.brandTint);
    glow.addColorStop(1, 'rgba(14, 15, 19, 0)');
    context.globalAlpha = 0.2;
    context.fillStyle = glow;
    context.fillRect(0, 0, width, height);
    context.globalAlpha = 1;

    context.strokeStyle = palette.divider;
    context.lineWidth = 1;
    context.globalAlpha = 0.13;
    const gridStep = 48;
    context.beginPath();
    for (let x = -height; x < width + height; x += gridStep) {
      context.moveTo(x, 0);
      context.lineTo(x + height, height);
    }
    context.stroke();
    context.globalAlpha = 1;
  }

  function getCamera() {
    const { width, height } = state.viewport;
    const minimumDimension = Math.min(width, height);
    const padding = state.previewMode
      ? clamp(minimumDimension * 0.055, 14, 38)
      : clamp(minimumDimension * 0.04, 12, 26);

    if (state.previewMode) {
      const cellSize = Math.min(
        (width - (padding * 2)) / state.mazeSize,
        (height - (padding * 2)) / state.mazeSize,
        64,
      );
      const boardWidth = cellSize * state.mazeSize;
      const boardHeight = cellSize * state.mazeSize;
      return {
        cellSize,
        offsetX: (width - boardWidth) / 2,
        offsetY: (height - boardHeight) / 2,
        boardWidth,
        boardHeight,
      };
    }

    const cellSize = clamp(minimumDimension / 8.4, 38, 62);
    const boardWidth = cellSize * state.mazeSize;
    const boardHeight = cellSize * state.mazeSize;
    const desiredX = (width / 2) - ((state.player.x + 0.5) * cellSize);
    const desiredY = (height / 2) - ((state.player.y + 0.5) * cellSize);
    const offsetX = boardWidth <= width - (padding * 2)
      ? (width - boardWidth) / 2
      : clamp(desiredX, width - padding - boardWidth, padding);
    const offsetY = boardHeight <= height - (padding * 2)
      ? (height - boardHeight) / 2
      : clamp(desiredY, height - padding - boardHeight, padding);

    return { cellSize, offsetX, offsetY, boardWidth, boardHeight };
  }

  function isCellVisible(x, y, camera, buffer = 1) {
    const cellX = (x * camera.cellSize) + camera.offsetX;
    const cellY = (y * camera.cellSize) + camera.offsetY;
    const margin = camera.cellSize * buffer;
    return (
      cellX + camera.cellSize >= -margin
      && cellX <= state.viewport.width + margin
      && cellY + camera.cellSize >= -margin
      && cellY <= state.viewport.height + margin
    );
  }

  function drawVisitedCells(camera) {
    context.fillStyle = palette.brandTint;
    state.visitedCells.forEach((key) => {
      const [x, y] = key.split(',').map(Number);
      if (!isCellVisible(x, y, camera)) return;
      const inset = Math.max(1, camera.cellSize * 0.08);
      context.fillRect(
        (x * camera.cellSize) + camera.offsetX + inset,
        (y * camera.cellSize) + camera.offsetY + inset,
        Math.max(0, camera.cellSize - (inset * 2)),
        Math.max(0, camera.cellSize - (inset * 2)),
      );
    });
  }

  function drawMazeWalls(camera) {
    const { cellSize, offsetX, offsetY } = camera;
    context.beginPath();

    for (let x = 0; x < state.mazeSize; x += 1) {
      for (let y = 0; y < state.mazeSize; y += 1) {
        if (!isCellVisible(x, y, camera)) continue;
        const cell = state.maze[x][y];
        const screenX = (x * cellSize) + offsetX;
        const screenY = (y * cellSize) + offsetY;

        if (cell.walls[0]) {
          context.moveTo(screenX, screenY);
          context.lineTo(screenX + cellSize, screenY);
        }
        if (cell.walls[3]) {
          context.moveTo(screenX, screenY);
          context.lineTo(screenX, screenY + cellSize);
        }
        if (x === state.mazeSize - 1 && cell.walls[1]) {
          context.moveTo(screenX + cellSize, screenY);
          context.lineTo(screenX + cellSize, screenY + cellSize);
        }
        if (y === state.mazeSize - 1 && cell.walls[2]) {
          context.moveTo(screenX, screenY + cellSize);
          context.lineTo(screenX + cellSize, screenY + cellSize);
        }
      }
    }

    context.strokeStyle = state.previewMode ? palette.textMuted : palette.textSecondary;
    context.globalAlpha = state.previewMode ? 0.82 : 0.68;
    context.lineWidth = state.previewMode
      ? clamp(cellSize * 0.09, 0.8, 2.1)
      : clamp(cellSize * 0.055, 1.5, 3);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.stroke();
    context.globalAlpha = 1;
  }

  function drawStart(camera) {
    if (!isCellVisible(0, 0, camera)) return;
    const { cellSize, offsetX, offsetY } = camera;
    const centerX = offsetX + (cellSize / 2);
    const centerY = offsetY + (cellSize / 2);

    context.save();
    context.strokeStyle = palette.textMuted;
    context.globalAlpha = 0.42;
    context.lineWidth = clamp(cellSize * 0.045, 0.8, 1.7);
    context.setLineDash([Math.max(2, cellSize * 0.12), Math.max(2, cellSize * 0.09)]);
    context.beginPath();
    context.arc(centerX, centerY, cellSize * 0.28, 0, Math.PI * 2);
    context.stroke();
    context.restore();
  }

  function drawExit(camera) {
    const x = state.mazeSize - 1;
    const y = state.mazeSize - 1;
    if (!isCellVisible(x, y, camera)) return;

    const { cellSize, offsetX, offsetY } = camera;
    const screenX = (x * cellSize) + offsetX;
    const screenY = (y * cellSize) + offsetY;
    const inset = clamp(cellSize * 0.16, 1.2, 9);
    const size = cellSize - (inset * 2);

    context.save();
    context.shadowColor = palette.success;
    context.shadowBlur = state.previewMode ? clamp(cellSize * 0.5, 2, 12) : 18;
    context.fillStyle = palette.success;
    context.globalAlpha = 0.22;
    drawRoundedRect(screenX + inset, screenY + inset, size, size, Math.max(1, size * 0.2));
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = palette.success;
    context.lineWidth = clamp(cellSize * 0.055, 1, 2.5);
    context.stroke();
    context.shadowBlur = 0;

    if (cellSize >= 14) {
      context.fillStyle = palette.success;
      context.fillRect(
        screenX + (cellSize * 0.39),
        screenY + (cellSize * 0.3),
        Math.max(1, cellSize * 0.055),
        cellSize * 0.4,
      );
      context.beginPath();
      context.moveTo(screenX + (cellSize * 0.43), screenY + (cellSize * 0.31));
      context.lineTo(screenX + (cellSize * 0.69), screenY + (cellSize * 0.4));
      context.lineTo(screenX + (cellSize * 0.43), screenY + (cellSize * 0.5));
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  function drawTreasures(camera) {
    const { cellSize, offsetX, offsetY } = camera;
    state.treasures.forEach(({ x, y }) => {
      if (!isCellVisible(x, y, camera)) return;
      const centerX = (x * cellSize) + offsetX + (cellSize / 2);
      const centerY = (y * cellSize) + offsetY + (cellSize / 2);
      const radius = clamp(cellSize * 0.19, 1.4, 10);

      context.save();
      context.translate(centerX, centerY);
      context.rotate(Math.PI / 4);
      context.shadowColor = palette.accent;
      context.shadowBlur = state.previewMode ? clamp(cellSize * 0.35, 1, 8) : 12;
      context.fillStyle = palette.accent;
      drawRoundedRect(-radius, -radius, radius * 2, radius * 2, radius * 0.28);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = palette.accentHover;
      context.globalAlpha = 0.78;
      context.fillRect(-radius * 0.5, -radius * 0.5, radius * 0.5, radius * 0.5);
      context.restore();
    });
  }

  function drawPlayer(camera) {
    const { cellSize, offsetX, offsetY } = camera;
    const centerX = (state.player.x * cellSize) + offsetX + (cellSize / 2);
    const centerY = (state.player.y * cellSize) + offsetY + (cellSize / 2);
    const radius = clamp(cellSize * 0.29, 2.2, 17);

    context.save();
    context.shadowColor = palette.brand;
    context.shadowBlur = state.previewMode ? clamp(cellSize * 0.75, 3, 14) : 22;
    context.fillStyle = palette.brand;
    context.beginPath();
    context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    context.fill();
    context.shadowBlur = 0;
    context.strokeStyle = palette.accent;
    context.lineWidth = clamp(cellSize * 0.055, 1, 2.5);
    context.stroke();

    if (cellSize >= 10) {
      context.translate(centerX, centerY);
      context.rotate(DIRECTIONS[state.lastDirection].angle);
      context.fillStyle = palette.textInverse;
      context.beginPath();
      context.moveTo(radius * 0.72, 0);
      context.lineTo(-radius * 0.32, radius * 0.42);
      context.lineTo(-radius * 0.12, 0);
      context.lineTo(-radius * 0.32, -radius * 0.42);
      context.closePath();
      context.fill();
    }
    context.restore();
  }

  function drawMaze() {
    const { width, height, dpr } = state.viewport;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    drawBackdrop(width, height);
    if (!state.maze.length) return;

    const camera = getCamera();
    context.save();
    context.fillStyle = palette.surface1;
    context.shadowColor = 'rgba(0, 0, 0, 0.42)';
    context.shadowBlur = state.previewMode ? 24 : 0;
    context.fillRect(camera.offsetX, camera.offsetY, camera.boardWidth, camera.boardHeight);
    context.shadowBlur = 0;
    context.strokeStyle = palette.border;
    context.lineWidth = 1;
    context.strokeRect(camera.offsetX, camera.offsetY, camera.boardWidth, camera.boardHeight);
    context.restore();

    drawVisitedCells(camera);
    drawStart(camera);
    drawExit(camera);
    drawTreasures(camera);
    drawMazeWalls(camera);
    drawPlayer(camera);
  }

  function handleKeyDown(event) {
    const key = event.key.toLowerCase();
    const directionByKey = {
      arrowup: 'up',
      w: 'up',
      arrowright: 'right',
      d: 'right',
      arrowdown: 'down',
      s: 'down',
      arrowleft: 'left',
      a: 'left',
    };

    if (directionByKey[key] && state.phase === 'playing') {
      event.preventDefault();
      if (!event.repeat) movePlayer(directionByKey[key]);
      return;
    }

    if (key === 'm' && state.phase === 'playing') {
      event.preventDefault();
      if (!event.repeat) togglePreview();
      return;
    }

    if (key === 'escape' && state.phase === 'playing' && state.previewMode) {
      event.preventDefault();
      setPreviewMode(false);
    }
  }

  function handlePointerDown(event) {
    if (state.phase !== 'playing') return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.preventDefault();
    state.activePointer = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.focus({ preventScroll: true });
  }

  function handlePointerUp(event) {
    if (!state.activePointer || state.activePointer.id !== event.pointerId) return;
    event.preventDefault();

    const deltaX = event.clientX - state.activePointer.x;
    const deltaY = event.clientY - state.activePointer.y;
    const threshold = event.pointerType === 'mouse' ? 34 : 26;
    const direction = getSwipeDirection(deltaX, deltaY, threshold);
    state.activePointer = null;
    if (direction) movePlayer(direction);
  }

  function clearPointer(event) {
    if (!state.activePointer || state.activePointer.id !== event.pointerId) return;
    state.activePointer = null;
  }

  function handleVisibilityChange() {
    if (state.phase !== 'playing') return;
    if (document.hidden && !state.hiddenAt) {
      state.hiddenAt = performance.now();
    } else if (!document.hidden && state.hiddenAt) {
      state.pausedDuration += performance.now() - state.hiddenAt;
      state.hiddenAt = 0;
    }
  }

  function bindEvents() {
    startButton.addEventListener('click', startRun);
    nextLevelButton.addEventListener('click', startNextLevel);
    previewButton.addEventListener('click', togglePreview);

    challengeButtons.forEach((button) => {
      button.addEventListener('click', () => {
        challengeButtons.forEach((candidate) => {
          candidate.setAttribute('aria-pressed', String(candidate === button));
        });
      });
    });

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', clearPointer);
    canvas.addEventListener('lostpointercapture', clearPointer);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('gesturestart', (event) => event.preventDefault(), { passive: false });

    if ('ResizeObserver' in window) {
      new ResizeObserver(resizeCanvas).observe(gameStage);
    } else {
      window.addEventListener('resize', resizeCanvas);
    }
  }

  function init() {
    bindEvents();
    resizeCanvas();
    updateHud();
    drawMaze();
    startButton.focus({ preventScroll: true });
  }

  init();
}(typeof globalThis !== 'undefined' ? globalThis : this));
