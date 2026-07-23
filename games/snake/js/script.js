(function startSnakeUi() {
  'use strict';

  const {
    DEFAULT_SETTINGS,
    PRESETS,
    SnakeGame,
    normalizeSettings,
  } = window.SnakeEngine || {};

  if (!SnakeGame) {
    throw new Error('Ember Snake could not load its game engine.');
  }

  const STORAGE_KEYS = {
    settings: 'emberSnake.settings.v2',
    best: 'emberSnake.best.v2',
  };
  const PRESET_MATCH_KEYS = [
    'speedMs',
    'boardSize',
    'collisionMode',
    'pointsPerFood',
    'growthPerFood',
    'powerFoods',
    'portals',
    'emberRush',
    'speedRamp',
  ];
  const KEY_DIRECTIONS = {
    ArrowUp: 'up',
    KeyW: 'up',
    ArrowDown: 'down',
    KeyS: 'down',
    ArrowLeft: 'left',
    KeyA: 'left',
    ArrowRight: 'right',
    KeyD: 'right',
  };

  const elements = {
    shell: document.querySelector('.arcade-shell'),
    setupScreen: document.getElementById('setup-screen'),
    playScreen: document.getElementById('play-screen'),
    settingsForm: document.getElementById('settings-form'),
    presetButtons: [...document.querySelectorAll('[data-preset]')],
    presetStatus: document.getElementById('preset-status'),
    speed: document.getElementById('speed-setting'),
    speedOutput: document.getElementById('speed-output'),
    board: document.getElementById('board-setting'),
    points: document.getElementById('points-setting'),
    pointsOutput: document.getElementById('points-output'),
    growth: document.getElementById('growth-setting'),
    powerFoods: document.getElementById('power-foods-setting'),
    portals: document.getElementById('portals-setting'),
    rush: document.getElementById('rush-setting'),
    speedRamp: document.getElementById('speed-ramp-setting'),
    sound: document.getElementById('sound-setting'),
    runSummary: document.getElementById('run-summary'),
    canvas: document.getElementById('game-canvas'),
    boardFrame: document.getElementById('board-frame'),
    boardPrompt: document.getElementById('board-prompt'),
    boardFlash: document.getElementById('board-flash'),
    roundMode: document.getElementById('round-mode'),
    roundTitle: document.getElementById('round-title'),
    score: document.getElementById('score-value'),
    length: document.getElementById('length-value'),
    best: document.getElementById('best-value'),
    comboStat: document.getElementById('combo-stat'),
    combo: document.getElementById('combo-value'),
    pauseButton: document.getElementById('pause-button'),
    restartButton: document.getElementById('restart-button'),
    rushMeter: document.getElementById('rush-meter'),
    rushMeterFill: document.getElementById('rush-meter-fill'),
    rushCount: document.getElementById('rush-count'),
    objectiveText: document.getElementById('objective-text'),
    foodLegendCopy: document.getElementById('food-legend-copy'),
    legendBonus: document.querySelector('[data-legend="bonus"]'),
    legendHazard: document.querySelector('[data-legend="hazard"]'),
    legendPortals: document.querySelector('[data-legend="portals"]'),
    legendRush: document.querySelector('[data-legend="rush"]'),
    touchButtons: [...document.querySelectorAll('[data-direction]')],
    dialog: document.getElementById('game-dialog'),
    dialogEyebrow: document.getElementById('dialog-eyebrow'),
    dialogTitle: document.getElementById('dialog-title'),
    dialogCopy: document.getElementById('dialog-copy'),
    dialogScore: document.getElementById('dialog-score'),
    dialogLength: document.getElementById('dialog-length'),
    dialogFood: document.getElementById('dialog-food'),
    dialogPrimary: document.getElementById('dialog-primary'),
    dialogPrimaryHint: document.querySelector('#dialog-primary small'),
    dialogPrimaryLabel: document.querySelector('#dialog-primary b'),
    dialogRestart: document.getElementById('dialog-restart'),
    dialogSettings: document.getElementById('dialog-settings'),
    toast: document.getElementById('toast'),
    announcement: document.getElementById('game-announcement'),
  };

  const context = elements.canvas.getContext('2d');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const colorTokens = readColorTokens();

  let game = null;
  let currentSettings = normalizeSettings(readStoredJson(STORAGE_KEYS.settings) || DEFAULT_SETTINGS);
  let bestScore = readStoredNumber(STORAGE_KEYS.best);
  let canvasSize = 720;
  let canvasScale = 1;
  let lastMoveAt = 0;
  let animationFrame = 0;
  let particles = [];
  let swipeStart = null;
  let toastTimer = 0;
  let audioContext = null;
  let dialogMode = '';
  let dialogPreviousFocus = null;

  initialize();

  function initialize() {
    writeSettingsToForm(currentSettings);
    syncSettingsUi();
    bindEvents();
    observeCanvasSize();
    animationFrame = window.requestAnimationFrame(frame);
  }

  function bindEvents() {
    elements.presetButtons.forEach(button => {
      button.addEventListener('click', () => applyPreset(button.dataset.preset));
    });

    elements.settingsForm.addEventListener('input', syncSettingsUi);
    elements.settingsForm.addEventListener('change', syncSettingsUi);
    elements.settingsForm.addEventListener('submit', event => {
      event.preventDefault();
      startRun();
    });

    elements.pauseButton.addEventListener('click', openPauseDialog);
    elements.restartButton.addEventListener('click', restartRun);
    elements.dialogPrimary.addEventListener('click', handleDialogPrimary);
    elements.dialogRestart.addEventListener('click', restartRun);
    elements.dialogSettings.addEventListener('click', showSetup);

    elements.touchButtons.forEach(button => {
      button.addEventListener('pointerdown', event => {
        event.preventDefault();
        steer(button.dataset.direction);
      });
    });

    elements.canvas.addEventListener('pointerdown', beginSwipe);
    elements.canvas.addEventListener('pointerup', endSwipe);
    elements.canvas.addEventListener('pointercancel', cancelSwipe);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('resize', resizeCanvas);
  }

  function applyPreset(presetId) {
    const preset = PRESETS[presetId];
    if (!preset) {
      return;
    }

    const keepSound = elements.sound.checked;
    writeSettingsToForm({ ...preset, sound: keepSound });
    syncSettingsUi();
  }

  function writeSettingsToForm(settings) {
    const normalized = normalizeSettings(settings);
    elements.speed.value = String(normalized.speedMs);
    elements.board.value = String(normalized.boardSize);
    elements.points.value = String(normalized.pointsPerFood);
    elements.growth.value = String(normalized.growthPerFood);
    elements.powerFoods.checked = normalized.powerFoods;
    elements.portals.checked = normalized.portals;
    elements.rush.checked = normalized.emberRush;
    elements.speedRamp.checked = normalized.speedRamp;
    elements.sound.checked = normalized.sound;

    const collisionInput = elements.settingsForm.querySelector(
      `input[name="collisionMode"][value="${normalized.collisionMode}"]`,
    );
    if (collisionInput) {
      collisionInput.checked = true;
    }
  }

  function readSettingsFromForm() {
    const collision = elements.settingsForm.querySelector('input[name="collisionMode"]:checked');
    return normalizeSettings({
      speedMs: elements.speed.value,
      boardSize: elements.board.value,
      collisionMode: collision ? collision.value : 'crash',
      pointsPerFood: elements.points.value,
      growthPerFood: elements.growth.value,
      powerFoods: elements.powerFoods.checked,
      portals: elements.portals.checked,
      emberRush: elements.rush.checked,
      speedRamp: elements.speedRamp.checked,
      sound: elements.sound.checked,
    });
  }

  function syncSettingsUi() {
    const settings = readSettingsFromForm();
    const matchedPreset = findMatchingPreset(settings);
    const movesPerSecond = (1000 / settings.speedMs).toFixed(settings.speedMs >= 500 ? 1 : 0);

    elements.speedOutput.value = `${settings.speedMs} ms · ${movesPerSecond}/s`;
    elements.speedOutput.textContent = elements.speedOutput.value;
    elements.pointsOutput.value = String(settings.pointsPerFood);
    elements.pointsOutput.textContent = elements.pointsOutput.value;
    elements.presetStatus.textContent = matchedPreset ? `${matchedPreset.name} preset` : 'Custom rules';

    elements.presetButtons.forEach(button => {
      const isSelected = Boolean(matchedPreset && button.dataset.preset === matchedPreset.id);
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });

    const speedName = describeSpeed(settings.speedMs);
    const collisionName = {
      brake: 'Brake collisions',
      crash: 'Crash walls',
      wrap: 'Wrap edges',
    }[settings.collisionMode];
    const enabledMechanics = [
      settings.powerFoods && 'power fruit',
      settings.portals && 'rifts',
      settings.emberRush && 'rushes',
      settings.speedRamp && 'speed ramp',
    ].filter(Boolean);
    const mechanicSummary = enabledMechanics.length
      ? enabledMechanics.join(' · ')
      : 'pure rules';

    elements.runSummary.textContent = `${speedName} · ${settings.boardSize} × ${settings.boardSize} · ${collisionName} · ${mechanicSummary}`;
  }

  function findMatchingPreset(settings) {
    return Object.values(PRESETS).find(preset => (
      PRESET_MATCH_KEYS.every(key => preset[key] === settings[key])
    )) || null;
  }

  function describeSpeed(speedMs) {
    if (speedMs <= 95) {
      return 'Blazing';
    }
    if (speedMs <= 190) {
      return 'Balanced';
    }
    if (speedMs <= 360) {
      return 'Steady';
    }
    if (speedMs <= 780) {
      return 'Relaxed';
    }
    return 'Leisurely';
  }

  function startRun() {
    currentSettings = readSettingsFromForm();
    writeStoredJson(STORAGE_KEYS.settings, currentSettings);
    ensureAudioContext();
    game = new SnakeGame(currentSettings);
    game.drainEvents();
    particles = [];
    lastMoveAt = performance.now();

    elements.setupScreen.hidden = true;
    elements.playScreen.hidden = false;
    document.body.classList.add('is-playing');
    closeDialog(false);
    configurePlayScreen();
    window.scrollTo({ top: 0, behavior: 'auto' });

    window.requestAnimationFrame(() => {
      resizeCanvas();
      render(performance.now());
      elements.canvas.focus({ preventScroll: true });
    });

    announce('Run ready. Choose a direction to begin.');
  }

  function restartRun() {
    if (!currentSettings) {
      return;
    }

    game = new SnakeGame(currentSettings);
    game.drainEvents();
    particles = [];
    lastMoveAt = performance.now();
    closeDialog(false);
    configurePlayScreen();
    render(performance.now());
    elements.canvas.focus({ preventScroll: true });
    announce('Run restarted. Choose a direction to begin.');
  }

  function configurePlayScreen() {
    const matchedPreset = findMatchingPreset(currentSettings);
    elements.roundMode.textContent = `${matchedPreset ? matchedPreset.name : 'Custom'} rules`;
    elements.roundTitle.textContent = currentSettings.collisionMode === 'brake'
      ? 'Find a path through the glow'
      : 'Follow the glow';
    elements.foodLegendCopy.textContent = `+${currentSettings.pointsPerFood} points · +${currentSettings.growthPerFood} length`;
    elements.legendBonus.hidden = !currentSettings.powerFoods;
    elements.legendHazard.hidden = !currentSettings.powerFoods;
    elements.legendPortals.hidden = !currentSettings.portals;
    elements.legendRush.hidden = !currentSettings.emberRush;
    elements.boardPrompt.classList.remove('is-hidden');
    updateHud(performance.now());
  }

  function showSetup() {
    if (game && game.status === 'running') {
      game.pause(performance.now());
    }

    closeDialog(false);
    game = null;
    particles = [];
    elements.playScreen.hidden = true;
    elements.setupScreen.hidden = false;
    document.body.classList.remove('is-playing');
    writeSettingsToForm(currentSettings);
    syncSettingsUi();
    window.scrollTo({ top: 0, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
    elements.settingsForm.querySelector('[data-preset].is-selected, [data-preset]').focus({ preventScroll: true });
  }

  function steer(direction) {
    if (!game || !elements.dialog.hidden || game.status === 'over' || game.status === 'won') {
      return;
    }

    const wasReady = game.status === 'ready' || (
      game.direction.x === 0 && game.direction.y === 0
    );
    if (game.setDirection(direction)) {
      elements.boardPrompt.classList.add('is-hidden');
      if (wasReady) {
        lastMoveAt = performance.now();
      }
      drainAndHandleEvents(performance.now());
    }
  }

  function frame(now) {
    if (game) {
      if (game.status === 'running') {
        game.updateTime(now);
        drainAndHandleEvents(now);

        const directionChosen = game.queuedDirection.x !== 0 || game.queuedDirection.y !== 0;
        if (directionChosen) {
          let speed = game.currentSpeedMs();
          let steps = 0;

          while (now - lastMoveAt >= speed && steps < 2 && game.status === 'running') {
            const events = game.step(now);
            handleGameEvents(events, now);
            lastMoveAt += speed;
            speed = game.currentSpeedMs();
            steps += 1;
          }

          if (now - lastMoveAt > speed * 3) {
            lastMoveAt = now;
          }
        }
      }

      render(now);
      updateHud(now);
    }

    animationFrame = window.requestAnimationFrame(frame);
  }

  function drainAndHandleEvents(now) {
    if (game) {
      handleGameEvents(game.drainEvents(), now);
    }
  }

  function handleGameEvents(events, now) {
    events.forEach(event => {
      switch (event.type) {
        case 'consumed':
          handleConsumed(event, now);
          break;
        case 'spawned':
          if (event.item === 'bonus') {
            showToast('Golden fruit appeared · triple points');
          } else if (event.item === 'hazard') {
            showToast('Void fruit appeared · tempting, but costly');
          }
          break;
        case 'portalsOpened':
          burst(event.portals[0], colorTokens.info, 9, now);
          burst(event.portals[1], colorTokens.accent, 9, now);
          showToast('A rift pair opened across the board');
          playSound('portal');
          announce('Rift portals opened.');
          break;
        case 'teleported':
          burst(event.from, colorTokens.info, 11, now);
          burst(event.to, colorTokens.accent, 14, now);
          flashBoard();
          playSound('portal');
          vibrate(16);
          break;
        case 'portalFizzle':
          showToast('The blocked rift folded in on itself');
          break;
        case 'rushStarted':
          showToast(`Ember Rush · collect ${event.count} sparks`);
          playSound('rush');
          announce(`Ember Rush started. ${event.count} sparks appeared.`);
          break;
        case 'rushCleared':
          showToast(`Rush cleared · +${event.points} bonus`);
          playSound('clear');
          flashBoard();
          announce(`Ember Rush cleared for ${event.points} bonus points.`);
          break;
        case 'rushEnded':
          showToast(`${event.missed} rush ${event.missed === 1 ? 'spark' : 'sparks'} faded`);
          break;
        case 'braked':
          elements.boardPrompt.classList.remove('is-hidden');
          elements.boardPrompt.querySelector('strong').textContent = 'Path blocked';
          elements.boardPrompt.querySelector('p span').textContent = 'Choose a safe new direction';
          showToast(event.kind === 'wall' ? 'Soft stop · choose another direction' : 'Trail ahead · choose another direction');
          playSound('brake');
          vibrate(30);
          announce('Path blocked. Choose another direction.');
          break;
        case 'wrapped':
          burst(event.position, colorTokens.accent, 7, now);
          break;
        case 'gameOver':
          showEndDialog(event.reason, false);
          break;
        case 'won':
          showEndDialog('cleared', true);
          break;
        default:
          break;
      }
    });
  }

  function handleConsumed(event, now) {
    const head = game.snake[0];
    const details = {
      food: {
        color: colorTokens.brand,
        sound: 'food',
        message: `Ember fruit. ${event.points} points.`,
      },
      bonus: {
        color: colorTokens.accent,
        sound: 'bonus',
        message: `Golden fruit. ${event.points} points.`,
      },
      hazard: {
        color: colorTokens.indigo,
        sound: 'hazard',
        message: `Void fruit. ${Math.abs(event.points)} points lost and tail shortened.`,
      },
      rush: {
        color: colorTokens.accent,
        sound: 'spark',
        message: `Rush spark. ${event.points} points.`,
      },
    }[event.item];

    if (!details) {
      return;
    }

    burst(head, details.color, event.item === 'food' ? 10 : 16, now);
    playSound(details.sound);

    if (event.item === 'bonus') {
      showToast(`Golden fruit · +${event.points}`);
      flashBoard();
      vibrate([14, 20, 14]);
    } else if (event.item === 'hazard') {
      showToast(`Void fruit · ${event.points} points · tail −3`);
      vibrate(55);
    } else {
      vibrate(10);
    }

    if (game.score > bestScore) {
      bestScore = game.score;
      writeStoredNumber(STORAGE_KEYS.best, bestScore);
    }

    announce(details.message);
  }

  function updateHud(now) {
    if (!game) {
      return;
    }

    elements.score.textContent = String(game.score);
    elements.length.textContent = String(game.snake.length);
    elements.best.textContent = String(Math.max(bestScore, game.score));

    const multiplier = game.scoreMultiplier(now);
    elements.comboStat.hidden = multiplier <= 1;
    elements.combo.textContent = `×${multiplier}`;

    const rushActive = game.rushMotes.length > 0 && game.rushExpiresAt > now;
    elements.rushMeter.hidden = !rushActive;
    if (rushActive) {
      const remaining = Math.max(0, game.rushExpiresAt - now);
      elements.rushMeterFill.style.transform = `scaleX(${Math.min(1, remaining / 7000)})`;
      elements.rushCount.textContent = `${game.rushMotes.length} left`;
    }

    if (rushActive) {
      elements.objectiveText.textContent = `Collect ${game.rushMotes.length} rush ${game.rushMotes.length === 1 ? 'spark' : 'sparks'}`;
    } else if (game.bonusFood) {
      elements.objectiveText.textContent = 'Golden fruit active · triple points';
    } else if (game.portals.length) {
      elements.objectiveText.textContent = 'Rifts open · take a shortcut';
    } else {
      elements.objectiveText.textContent = 'Collect the ember fruit';
    }
  }

  function openPauseDialog() {
    if (!game || game.status === 'over' || game.status === 'won') {
      return;
    }

    if (game.status === 'running') {
      game.pause(performance.now());
      drainAndHandleEvents(performance.now());
    }

    dialogMode = 'pause';
    populateDialogStats();
    elements.dialogEyebrow.textContent = 'Run paused';
    elements.dialogTitle.textContent = 'Hold that thought.';
    elements.dialogCopy.textContent = 'The glow is suspended and every timer is frozen.';
    elements.dialogPrimaryHint.textContent = 'Same board';
    elements.dialogPrimaryLabel.textContent = 'Resume run';
    elements.dialogRestart.hidden = false;
    openDialog();
  }

  function showEndDialog(reason, won) {
    if (!game || dialogMode === 'end') {
      return;
    }

    dialogMode = 'end';
    if (game.score > bestScore) {
      bestScore = game.score;
      writeStoredNumber(STORAGE_KEYS.best, bestScore);
    }

    const messages = {
      wall: ['Trail ended', 'The edge caught you.', 'One sharp turn from another run.'],
      self: ['Trail ended', 'You crossed your own path.', 'The next line is waiting to be drawn.'],
      trapped: ['No open path', 'Every route closed around you.', 'A different rule mix may open things up.'],
      consumed: ['Lost to the void', 'That fruit took the last of your tail.', 'Risk is part of the recipe.'],
      cleared: ['Board mastered', 'Every cell belongs to the serpent.', 'That is as complete as a Snake run gets.'],
    };
    const [eyebrow, title, copy] = messages[reason] || messages.wall;

    populateDialogStats();
    elements.dialogEyebrow.textContent = won ? 'Perfect run' : eyebrow;
    elements.dialogTitle.textContent = title;
    elements.dialogCopy.textContent = copy;
    elements.dialogPrimaryHint.textContent = 'Same rules';
    elements.dialogPrimaryLabel.textContent = 'Play again';
    elements.dialogRestart.hidden = true;
    openDialog();
    playSound(won ? 'clear' : 'gameOver');
    vibrate(won ? [25, 35, 25] : [70, 40, 100]);
    announce(`${title}. Final score ${game.score}.`);
  }

  function populateDialogStats() {
    elements.dialogScore.textContent = String(game ? game.score : 0);
    elements.dialogLength.textContent = String(game ? game.snake.length : 1);
    elements.dialogFood.textContent = String(game
      ? game.regularFoodEaten + game.bonusFoodEaten + game.rushMotesEaten
      : 0);
  }

  function openDialog() {
    dialogPreviousFocus = document.activeElement;
    elements.dialog.hidden = false;
    elements.shell.inert = true;
    window.requestAnimationFrame(() => elements.dialogPrimary.focus());
  }

  function closeDialog(restoreFocus = true) {
    if (elements.dialog.hidden) {
      return;
    }

    elements.dialog.hidden = true;
    elements.shell.inert = false;
    dialogMode = '';
    if (restoreFocus && dialogPreviousFocus instanceof HTMLElement) {
      dialogPreviousFocus.focus({ preventScroll: true });
    }
    dialogPreviousFocus = null;
  }

  function handleDialogPrimary() {
    if (dialogMode === 'pause') {
      if (game && game.status === 'paused') {
        game.resume(performance.now());
        drainAndHandleEvents(performance.now());
      }
      lastMoveAt = performance.now();
      closeDialog(false);
      elements.canvas.focus({ preventScroll: true });
      announce('Run resumed.');
      return;
    }

    restartRun();
  }

  function handleKeydown(event) {
    if (!elements.dialog.hidden) {
      handleDialogKeydown(event);
      return;
    }

    if (!game || elements.playScreen.hidden) {
      return;
    }

    const direction = KEY_DIRECTIONS[event.code];
    if (direction) {
      event.preventDefault();
      steer(direction);
      return;
    }

    if (event.code === 'KeyP' || event.code === 'Space') {
      event.preventDefault();
      openPauseDialog();
    } else if (event.code === 'Escape') {
      event.preventDefault();
      openPauseDialog();
    } else if (event.code === 'KeyR' && (game.status === 'over' || game.status === 'won')) {
      event.preventDefault();
      restartRun();
    }
  }

  function handleDialogKeydown(event) {
    if (event.code === 'Escape' && dialogMode === 'pause') {
      event.preventDefault();
      handleDialogPrimary();
      return;
    }

    if (event.code !== 'Tab') {
      return;
    }

    const focusable = [...elements.dialog.querySelectorAll('button:not([hidden]):not(:disabled)')];
    if (!focusable.length) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleVisibilityChange() {
    if (document.hidden && game && game.status === 'running' && elements.dialog.hidden) {
      openPauseDialog();
    }
  }

  function beginSwipe(event) {
    if (!game || !elements.dialog.hidden) {
      return;
    }

    swipeStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    elements.canvas.setPointerCapture?.(event.pointerId);
  }

  function endSwipe(event) {
    if (!swipeStart || swipeStart.id !== event.pointerId) {
      return;
    }

    const deltaX = event.clientX - swipeStart.x;
    const deltaY = event.clientY - swipeStart.y;
    const distance = Math.hypot(deltaX, deltaY);
    swipeStart = null;

    if (distance < 18) {
      elements.canvas.focus({ preventScroll: true });
      return;
    }

    if (Math.abs(deltaX) > Math.abs(deltaY)) {
      steer(deltaX > 0 ? 'right' : 'left');
    } else {
      steer(deltaY > 0 ? 'down' : 'up');
    }
  }

  function cancelSwipe() {
    swipeStart = null;
  }

  function observeCanvasSize() {
    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(resizeCanvas);
      observer.observe(elements.boardFrame);
    }
    resizeCanvas();
  }

  function resizeCanvas() {
    const bounds = elements.boardFrame.getBoundingClientRect();
    if (!bounds.width) {
      return;
    }

    canvasSize = Math.max(280, Math.round(bounds.width));
    canvasScale = Math.min(window.devicePixelRatio || 1, 2);
    const pixelSize = Math.round(canvasSize * canvasScale);
    if (elements.canvas.width !== pixelSize || elements.canvas.height !== pixelSize) {
      elements.canvas.width = pixelSize;
      elements.canvas.height = pixelSize;
      elements.canvas.style.width = `${canvasSize}px`;
      elements.canvas.style.height = `${canvasSize}px`;
    }
  }

  function render(now) {
    if (!game || !canvasSize) {
      return;
    }

    context.setTransform(canvasScale, 0, 0, canvasScale, 0, 0);
    context.clearRect(0, 0, canvasSize, canvasSize);
    drawBoard();

    const cellSize = canvasSize / game.settings.boardSize;
    drawPortals(cellSize, now);
    drawRushMotes(cellSize, now);
    drawFruit(game.food, 'food', cellSize, now);
    drawFruit(game.bonusFood, 'bonus', cellSize, now);
    drawFruit(game.hazardFood, 'hazard', cellSize, now);
    drawSnake(cellSize);
    drawParticles(cellSize, now);
    drawVignette();
  }

  function drawBoard() {
    const background = context.createLinearGradient(0, 0, canvasSize, canvasSize);
    background.addColorStop(0, colorTokens.surface2);
    background.addColorStop(0.58, colorTokens.surface1);
    background.addColorStop(1, colorTokens.bg);
    context.fillStyle = background;
    context.fillRect(0, 0, canvasSize, canvasSize);

    const glow = context.createRadialGradient(
      canvasSize * 0.51,
      canvasSize * 0.43,
      0,
      canvasSize * 0.51,
      canvasSize * 0.43,
      canvasSize * 0.72,
    );
    glow.addColorStop(0, 'rgba(255, 106, 31, 0.055)');
    glow.addColorStop(0.6, 'rgba(255, 194, 71, 0.018)');
    glow.addColorStop(1, 'rgba(14, 15, 19, 0)');
    context.fillStyle = glow;
    context.fillRect(0, 0, canvasSize, canvasSize);

    const cellSize = canvasSize / game.settings.boardSize;
    context.save();
    context.strokeStyle = colorTokens.divider;
    context.globalAlpha = game.settings.boardSize >= 24 ? 0.32 : 0.46;
    context.lineWidth = Math.max(0.5, 1 / canvasScale);
    context.beginPath();
    for (let index = 1; index < game.settings.boardSize; index += 1) {
      const coordinate = Math.round(index * cellSize) + 0.5 / canvasScale;
      context.moveTo(coordinate, 0);
      context.lineTo(coordinate, canvasSize);
      context.moveTo(0, coordinate);
      context.lineTo(canvasSize, coordinate);
    }
    context.stroke();
    context.restore();
  }

  function drawPortals(cellSize, now) {
    game.portals.forEach((portal, index) => {
      const center = cellCenter(portal, cellSize);
      const pulse = 1 + Math.sin(now / 190 + index * Math.PI) * 0.08;
      const color = index === 0 ? colorTokens.info : colorTokens.accent;

      context.save();
      context.translate(center.x, center.y);
      context.scale(0.65, 1);
      context.shadowColor = color;
      context.shadowBlur = cellSize * 0.42;
      context.strokeStyle = color;
      context.lineWidth = Math.max(1.5, cellSize * 0.1);
      context.globalAlpha = 0.9;
      context.beginPath();
      context.ellipse(0, 0, cellSize * 0.32 * pulse, cellSize * 0.39 * pulse, 0, 0, Math.PI * 2);
      context.stroke();

      context.globalAlpha = 0.38;
      context.lineWidth = Math.max(1, cellSize * 0.045);
      context.beginPath();
      context.ellipse(0, 0, cellSize * 0.43 * pulse, cellSize * 0.47 * pulse, 0, 0, Math.PI * 2);
      context.stroke();
      context.restore();
    });
  }

  function drawRushMotes(cellSize, now) {
    game.rushMotes.forEach((mote, index) => {
      const center = cellCenter(mote, cellSize);
      const pulse = 0.86 + Math.sin(now / 130 + index) * 0.13;

      context.save();
      context.translate(center.x, center.y);
      context.rotate(now / 850 + index);
      context.shadowColor = colorTokens.accent;
      context.shadowBlur = cellSize * 0.48;
      context.fillStyle = index % 2 ? colorTokens.brand : colorTokens.accent;
      drawStarPath(context, 0, 0, cellSize * 0.3 * pulse, cellSize * 0.11 * pulse, 4);
      context.fill();
      context.restore();
    });
  }

  function drawFruit(position, type, cellSize, now) {
    if (!position) {
      return;
    }

    const center = cellCenter(position, cellSize);
    const pulse = 1 + Math.sin(now / 180 + position.x) * 0.045;
    const radius = cellSize * 0.29 * pulse;

    context.save();
    context.translate(center.x, center.y);

    if (type === 'hazard') {
      context.shadowColor = colorTokens.indigo;
      context.shadowBlur = cellSize * 0.46;
      context.strokeStyle = colorTokens.indigo;
      context.lineWidth = Math.max(1.4, cellSize * 0.095);
      context.beginPath();
      context.arc(0, 0, radius, 0, Math.PI * 2);
      context.stroke();
      context.globalAlpha = 0.68;
      context.beginPath();
      context.arc(0, 0, radius * 0.54, now / 280, now / 280 + Math.PI * 1.55);
      context.stroke();
      context.fillStyle = colorTokens.bg;
      context.beginPath();
      context.arc(0, 0, radius * 0.22, 0, Math.PI * 2);
      context.fill();
      context.restore();
      drawEntityTimer(position, cellSize, game.hazardExpiresAt - now, 12000, colorTokens.indigo);
      return;
    }

    const color = type === 'bonus' ? colorTokens.accent : colorTokens.brand;
    const highlight = type === 'bonus' ? colorTokens.accentHover : colorTokens.brandHover;
    const fruitGradient = context.createRadialGradient(
      -radius * 0.32,
      -radius * 0.4,
      radius * 0.08,
      0,
      0,
      radius * 1.15,
    );
    fruitGradient.addColorStop(0, highlight);
    fruitGradient.addColorStop(0.45, color);
    fruitGradient.addColorStop(1, type === 'bonus' ? colorTokens.accentActive : colorTokens.brandActive);

    context.shadowColor = color;
    context.shadowBlur = cellSize * 0.46;
    context.fillStyle = fruitGradient;
    context.beginPath();
    context.moveTo(0, -radius);
    context.bezierCurveTo(radius * 0.74, -radius * 0.9, radius, -radius * 0.1, radius * 0.72, radius * 0.6);
    context.bezierCurveTo(radius * 0.42, radius * 1.05, -radius * 0.42, radius * 1.05, -radius * 0.72, radius * 0.6);
    context.bezierCurveTo(-radius, -radius * 0.1, -radius * 0.74, -radius * 0.9, 0, -radius);
    context.closePath();
    context.fill();

    context.shadowBlur = 0;
    context.fillStyle = colorTokens.success;
    context.beginPath();
    context.ellipse(radius * 0.24, -radius * 1.03, radius * 0.42, radius * 0.17, -0.48, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = 'rgba(255, 255, 255, 0.42)';
    context.beginPath();
    context.ellipse(-radius * 0.34, -radius * 0.32, radius * 0.13, radius * 0.26, -0.45, 0, Math.PI * 2);
    context.fill();
    context.restore();

    if (type === 'bonus') {
      drawEntityTimer(position, cellSize, game.bonusExpiresAt - now, 8000, colorTokens.accent);
    }
  }

  function drawEntityTimer(position, cellSize, remaining, duration, color) {
    if (remaining <= 0) {
      return;
    }

    const center = cellCenter(position, cellSize);
    const progress = Math.min(1, remaining / duration);
    context.save();
    context.strokeStyle = color;
    context.globalAlpha = 0.62;
    context.lineWidth = Math.max(1, cellSize * 0.045);
    context.beginPath();
    context.arc(
      center.x,
      center.y,
      cellSize * 0.43,
      -Math.PI / 2,
      -Math.PI / 2 + Math.PI * 2 * progress,
    );
    context.stroke();
    context.restore();
  }

  function drawSnake(cellSize) {
    if (!game.snake.length) {
      return;
    }

    const bodyWidth = cellSize * 0.68;
    const bodyOffset = (cellSize - bodyWidth) / 2;

    context.save();
    context.fillStyle = colorTokens.surface3;
    for (let index = 1; index < game.snake.length; index += 1) {
      const current = game.snake[index];
      const previous = game.snake[index - 1];
      const deltaX = Math.abs(current.x - previous.x);
      const deltaY = Math.abs(current.y - previous.y);
      if (deltaX + deltaY !== 1) {
        continue;
      }

      const first = cellCenter(current, cellSize);
      const second = cellCenter(previous, cellSize);
      context.fillRect(
        Math.min(first.x, second.x) - (deltaY ? bodyWidth / 2 : 0),
        Math.min(first.y, second.y) - (deltaX ? bodyWidth / 2 : 0),
        deltaX ? Math.abs(second.x - first.x) : bodyWidth,
        deltaY ? Math.abs(second.y - first.y) : bodyWidth,
      );
    }
    context.restore();

    for (let index = game.snake.length - 1; index >= 1; index -= 1) {
      const segment = game.snake[index];
      const progress = game.snake.length <= 2 ? 1 : 1 - index / game.snake.length;
      const x = segment.x * cellSize + bodyOffset;
      const y = segment.y * cellSize + bodyOffset;

      context.save();
      context.shadowColor = colorTokens.brand;
      context.shadowBlur = cellSize * (0.08 + progress * 0.08);
      roundedRectPath(context, x, y, bodyWidth, bodyWidth, cellSize * 0.24);
      context.fillStyle = colorTokens.surface3;
      context.fill();
      context.globalAlpha = 0.28 + progress * 0.42;
      context.strokeStyle = colorTokens.brand;
      context.lineWidth = Math.max(1, cellSize * 0.065);
      context.stroke();

      context.globalAlpha = 0.14 + progress * 0.12;
      context.fillStyle = colorTokens.text;
      roundedRectPath(
        context,
        x + bodyWidth * 0.2,
        y + bodyWidth * 0.16,
        bodyWidth * 0.34,
        bodyWidth * 0.16,
        bodyWidth * 0.08,
      );
      context.fill();
      context.restore();
    }

    drawSnakeHead(cellSize);
  }

  function drawSnakeHead(cellSize) {
    const head = game.snake[0];
    const size = cellSize * 0.82;
    const offset = (cellSize - size) / 2;
    const x = head.x * cellSize + offset;
    const y = head.y * cellSize + offset;
    const direction = (
      game.direction.x === 0 && game.direction.y === 0
        ? { x: 1, y: 0 }
        : game.direction
    );

    const headGradient = context.createLinearGradient(x, y, x + size, y + size);
    headGradient.addColorStop(0, colorTokens.surface3);
    headGradient.addColorStop(0.62, colorTokens.surface2);
    headGradient.addColorStop(1, colorTokens.brandActive);

    context.save();
    context.shadowColor = colorTokens.brand;
    context.shadowBlur = cellSize * 0.32;
    roundedRectPath(context, x, y, size, size, cellSize * 0.31);
    context.fillStyle = headGradient;
    context.fill();
    context.strokeStyle = colorTokens.brandHover;
    context.lineWidth = Math.max(1.2, cellSize * 0.085);
    context.stroke();
    context.restore();

    const center = cellCenter(head, cellSize);
    const perpendicular = { x: -direction.y, y: direction.x };
    const eyeForward = cellSize * 0.19;
    const eyeSpread = cellSize * 0.17;
    const eyeRadius = Math.max(1.35, cellSize * 0.085);

    [-1, 1].forEach(side => {
      const eyeX = center.x + direction.x * eyeForward + perpendicular.x * eyeSpread * side;
      const eyeY = center.y + direction.y * eyeForward + perpendicular.y * eyeSpread * side;

      context.save();
      context.shadowColor = colorTokens.accent;
      context.shadowBlur = cellSize * 0.22;
      context.fillStyle = colorTokens.accent;
      context.beginPath();
      context.arc(eyeX, eyeY, eyeRadius, 0, Math.PI * 2);
      context.fill();
      context.shadowBlur = 0;
      context.fillStyle = colorTokens.bg;
      context.beginPath();
      context.arc(
        eyeX + direction.x * eyeRadius * 0.32,
        eyeY + direction.y * eyeRadius * 0.32,
        eyeRadius * 0.43,
        0,
        Math.PI * 2,
      );
      context.fill();
      context.restore();
    });
  }

  function drawParticles(cellSize, now) {
    particles = particles.filter(particle => now - particle.born < particle.life);
    particles.forEach(particle => {
      const age = now - particle.born;
      const progress = age / particle.life;
      const x = (particle.x + particle.vx * age) * cellSize;
      const y = (particle.y + particle.vy * age + particle.gravity * age * age) * cellSize;
      const radius = Math.max(0.7, cellSize * particle.size * (1 - progress));

      context.save();
      context.globalAlpha = 1 - progress;
      context.fillStyle = particle.color;
      context.shadowColor = particle.color;
      context.shadowBlur = cellSize * 0.15;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    });
  }

  function drawVignette() {
    const vignette = context.createRadialGradient(
      canvasSize / 2,
      canvasSize / 2,
      canvasSize * 0.28,
      canvasSize / 2,
      canvasSize / 2,
      canvasSize * 0.73,
    );
    vignette.addColorStop(0, 'rgba(14, 15, 19, 0)');
    vignette.addColorStop(1, 'rgba(14, 15, 19, 0.28)');
    context.fillStyle = vignette;
    context.fillRect(0, 0, canvasSize, canvasSize);
  }

  function burst(position, color, count, now) {
    if (!position || reducedMotion.matches) {
      return;
    }

    for (let index = 0; index < count; index += 1) {
      const angle = Math.random() * Math.PI * 2;
      const velocity = 0.00018 + Math.random() * 0.00032;
      particles.push({
        x: position.x + 0.5,
        y: position.y + 0.5,
        vx: Math.cos(angle) * velocity,
        vy: Math.sin(angle) * velocity,
        gravity: 0.00000018,
        size: 0.035 + Math.random() * 0.055,
        color,
        born: now,
        life: 360 + Math.random() * 320,
      });
    }

    if (particles.length > 120) {
      particles.splice(0, particles.length - 120);
    }
  }

  function cellCenter(position, cellSize) {
    return {
      x: (position.x + 0.5) * cellSize,
      y: (position.y + 0.5) * cellSize,
    };
  }

  function roundedRectPath(targetContext, x, y, width, height, radius) {
    const safeRadius = Math.min(radius, width / 2, height / 2);
    targetContext.beginPath();
    targetContext.moveTo(x + safeRadius, y);
    targetContext.arcTo(x + width, y, x + width, y + height, safeRadius);
    targetContext.arcTo(x + width, y + height, x, y + height, safeRadius);
    targetContext.arcTo(x, y + height, x, y, safeRadius);
    targetContext.arcTo(x, y, x + width, y, safeRadius);
    targetContext.closePath();
  }

  function drawStarPath(targetContext, centerX, centerY, outerRadius, innerRadius, points) {
    targetContext.beginPath();
    for (let index = 0; index < points * 2; index += 1) {
      const radius = index % 2 === 0 ? outerRadius : innerRadius;
      const angle = -Math.PI / 2 + (Math.PI * index) / points;
      const x = centerX + Math.cos(angle) * radius;
      const y = centerY + Math.sin(angle) * radius;
      if (index === 0) {
        targetContext.moveTo(x, y);
      } else {
        targetContext.lineTo(x, y);
      }
    }
    targetContext.closePath();
  }

  function flashBoard() {
    elements.boardFlash.classList.remove('is-active');
    void elements.boardFlash.offsetWidth;
    elements.boardFlash.classList.add('is-active');
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 2600);
  }

  function announce(message) {
    elements.announcement.textContent = '';
    window.requestAnimationFrame(() => {
      elements.announcement.textContent = message;
    });
  }

  function ensureAudioContext() {
    if (!currentSettings.sound || audioContext) {
      return;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioContext = new AudioContextClass();
    }
  }

  function playSound(kind) {
    if (!currentSettings.sound) {
      return;
    }

    ensureAudioContext();
    if (!audioContext) {
      return;
    }

    if (audioContext.state === 'suspended') {
      audioContext.resume().catch(() => {});
    }

    const soundMap = {
      food: [[340, 0.055, 0], [510, 0.075, 0.045]],
      bonus: [[440, 0.07, 0], [660, 0.08, 0.055], [880, 0.12, 0.12]],
      hazard: [[190, 0.13, 0], [120, 0.18, 0.09]],
      spark: [[740, 0.055, 0]],
      rush: [[390, 0.06, 0], [580, 0.07, 0.055], [780, 0.08, 0.11]],
      clear: [[520, 0.08, 0], [680, 0.08, 0.07], [920, 0.18, 0.14]],
      portal: [[260, 0.08, 0], [620, 0.13, 0.055]],
      brake: [[180, 0.08, 0]],
      gameOver: [[260, 0.12, 0], [190, 0.16, 0.1], [120, 0.22, 0.22]],
    };

    (soundMap[kind] || []).forEach(([frequency, duration, delay]) => {
      scheduleTone(frequency, duration, delay, kind === 'hazard' || kind === 'gameOver' ? 'sawtooth' : 'sine');
    });
  }

  function scheduleTone(frequency, duration, delay, type) {
    const startAt = audioContext.currentTime + delay;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    gain.gain.setValueAtTime(0.0001, startAt);
    gain.gain.exponentialRampToValueAtTime(0.045, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.02);
  }

  function vibrate(pattern) {
    if (navigator.vibrate) {
      navigator.vibrate(pattern);
    }
  }

  function readColorTokens() {
    const styles = getComputedStyle(document.documentElement);
    const token = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
    return {
      bg: token('--bg', '#0E0F13'),
      surface1: token('--surface-1', '#171A20'),
      surface2: token('--surface-2', '#1B2026'),
      surface3: token('--surface-3', '#20242A'),
      border: token('--border', '#262B34'),
      divider: token('--divider', '#2B313C'),
      text: token('--text', '#E8ECF2'),
      brand: token('--brand', '#FF6A1F'),
      brandHover: token('--brand-hover', '#FF7C3B'),
      brandActive: token('--brand-active', '#E05F1C'),
      accent: token('--accent', '#FFC247'),
      accentHover: token('--accent-hover', '#FFD36F'),
      accentActive: token('--accent-active', '#E6A92D'),
      success: token('--success', '#17C696'),
      info: token('--info', '#19E3E3'),
      indigo: token('--indigo', '#4656FF'),
    };
  }

  function readStoredJson(key) {
    try {
      return JSON.parse(window.localStorage.getItem(key));
    } catch (_error) {
      return null;
    }
  }

  function writeStoredJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {
      // Storage can be unavailable in private browsing; gameplay does not depend on it.
    }
  }

  function readStoredNumber(key) {
    try {
      const value = Number(window.localStorage.getItem(key));
      return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    } catch (_error) {
      return 0;
    }
  }

  function writeStoredNumber(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (_error) {
      // Keep the in-memory best score when storage is unavailable.
    }
  }
}());
