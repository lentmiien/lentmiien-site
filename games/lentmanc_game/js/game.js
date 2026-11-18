'use strict';

(() => {
  const characters = window.GAME_CHARACTERS;
  const mapData = window.GAME_MAPS;
  const story = window.GAME_STORY;
  const AudioController = window.GameAudio;
  const mapArt = window.GAME_MAP_ART;

  if (!characters || !mapData || !story || !AudioController || !mapArt || !window.createMapRenderer) {
    const loadingStatus = document.getElementById('loadingStatus');
    if (loadingStatus) {
      loadingStatus.textContent = 'The game data could not be loaded. Reload the page to try again.';
    }
    return;
  }

  const SAVE_KEY = 'theGreatAdventure.save.v1';
  const SETTINGS_KEY = 'theGreatAdventure.settings.v1';
  const SAVE_VERSION = 1;
  const MAX_TRANSCRIPT_ENTRIES = 400;
  const INTERACTION_RANGE = 1.35;
  const PLAYER_RADIUS = 0.28;
  const movementKeys = new Set();
  const directionKeyMap = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    w: 'up',
    W: 'up',
    s: 'down',
    S: 'down',
    a: 'left',
    A: 'left',
    d: 'right',
    D: 'right',
  };

  const dom = {
    shell: document.getElementById('gameShell'),
    loadingScreen: document.getElementById('loadingScreen'),
    loadingStatus: document.getElementById('loadingStatus'),
    loadingProgress: document.getElementById('loadingProgress'),
    titleScreen: document.getElementById('titleScreen'),
    titleStars: document.getElementById('titleStars'),
    newGameButton: document.getElementById('newGameButton'),
    continueButton: document.getElementById('continueButton'),
    continueDetail: document.getElementById('continueDetail'),
    titleAudioButton: document.getElementById('titleAudioButton'),
    settingsButton: document.getElementById('settingsButton'),
    helpButton: document.getElementById('helpButton'),
    creditsButton: document.getElementById('creditsButton'),
    storageNote: document.getElementById('storageNote'),

    gameScreen: document.getElementById('gameScreen'),
    gameMain: document.getElementById('gameMain'),
    worldCanvas: document.getElementById('worldCanvas'),
    mapAccessibleSummary: document.getElementById('mapAccessibleSummary'),
    chapterKicker: document.getElementById('chapterKicker'),
    mapName: document.getElementById('mapName'),
    mapSubtitle: document.getElementById('mapSubtitle'),
    objectiveText: document.getElementById('objectiveText'),
    partyRail: document.getElementById('partyRail'),
    partyList: document.getElementById('partyList'),
    weatherLayer: document.getElementById('weatherLayer'),
    interactionPrompt: document.getElementById('interactionPrompt'),
    interactionPromptText: document.getElementById('interactionPromptText'),
    checkpointToast: document.getElementById('checkpointToast'),
    checkpointToastText: document.getElementById('checkpointToastText'),
    touchControls: document.getElementById('touchControls'),
    touchInteractButton: document.getElementById('touchInteractButton'),
    gameMapButton: document.getElementById('gameMapButton'),
    gameTranscriptButton: document.getElementById('gameTranscriptButton'),
    gameAudioButton: document.getElementById('gameAudioButton'),
    pauseButton: document.getElementById('pauseButton'),

    sceneOverlay: document.getElementById('sceneOverlay'),
    sceneArtWrap: document.getElementById('sceneArtWrap'),
    sceneArt: document.getElementById('sceneArt'),
    sceneArtFallback: document.getElementById('sceneArtFallback'),
    sceneChapter: document.getElementById('sceneChapter'),
    sceneTitle: document.getElementById('sceneTitle'),
    sceneMapButton: document.getElementById('sceneMapButton'),
    sceneHistoryButton: document.getElementById('sceneHistoryButton'),
    scenePauseButton: document.getElementById('scenePauseButton'),
    dialogueCard: document.getElementById('dialogueCard'),
    speakerPortraitWrap: document.getElementById('speakerPortraitWrap'),
    speakerPortrait: document.getElementById('speakerPortrait'),
    speakerMonogram: document.getElementById('speakerMonogram'),
    speakerRole: document.getElementById('speakerRole'),
    speakerName: document.getElementById('speakerName'),
    expressionLabel: document.getElementById('expressionLabel'),
    dialogueText: document.getElementById('dialogueText'),
    choiceRegion: document.getElementById('choiceRegion'),
    choicePrompt: document.getElementById('choicePrompt'),
    choiceList: document.getElementById('choiceList'),
    replayVoiceButton: document.getElementById('replayVoiceButton'),
    advanceButton: document.getElementById('advanceButton'),
    advanceButtonText: document.getElementById('advanceButtonText'),
    voiceCaption: document.getElementById('voiceCaption'),
    voiceCaptionText: document.getElementById('voiceCaptionText'),
    voiceProgress: document.getElementById('voiceProgress'),
    voiceAudio: document.getElementById('voiceAudio'),

    travelOverlay: document.getElementById('travelOverlay'),
    travelMapImage: document.getElementById('travelMapImage'),
    travelRouteLayer: document.getElementById('travelRouteLayer'),
    travelMapMarkers: document.getElementById('travelMapMarkers'),
    travelerToken: document.getElementById('travelerToken'),
    travelTitle: document.getElementById('travelTitle'),
    travelFromName: document.getElementById('travelFromName'),
    travelToName: document.getElementById('travelToName'),
    travelDescription: document.getElementById('travelDescription'),
    travelNarration: document.getElementById('travelNarration'),
    travelNarrationText: document.getElementById('travelNarrationText'),
    travelMode: document.getElementById('travelMode'),
    travelSpan: document.getElementById('travelSpan'),
    travelChapterRail: document.getElementById('travelChapterRail'),
    travelMapSummary: document.getElementById('travelMapSummary'),
    travelReplayButton: document.getElementById('travelReplayButton'),
    travelContinueButton: document.getElementById('travelContinueButton'),
    travelContinueText: document.getElementById('travelContinueText'),

    gameOverOverlay: document.getElementById('gameOverOverlay'),
    gameOverTitle: document.getElementById('gameOverTitle'),
    gameOverReason: document.getElementById('gameOverReason'),
    gameOverLesson: document.getElementById('gameOverLesson'),
    retryCheckpointButton: document.getElementById('retryCheckpointButton'),
    retryCheckpointLabel: document.getElementById('retryCheckpointLabel'),
    gameOverTitleButton: document.getElementById('gameOverTitleButton'),
    gameOverRestartButton: document.getElementById('gameOverRestartButton'),

    endingOverlay: document.getElementById('endingOverlay'),
    endingImage: document.getElementById('endingImage'),
    endingNumber: document.getElementById('endingNumber'),
    endingTitle: document.getElementById('endingTitle'),
    endingSubtitle: document.getElementById('endingSubtitle'),
    endingSummary: document.getElementById('endingSummary'),
    endingConsequence: document.getElementById('endingConsequence'),
    endingEchoes: document.getElementById('endingEchoes'),
    endingLibraryButton: document.getElementById('endingLibraryButton'),
    endingTitleButton: document.getElementById('endingTitleButton'),
    endingTranscriptButton: document.getElementById('endingTranscriptButton'),
    endingRestartButton: document.getElementById('endingRestartButton'),
    endingReplayButton: document.getElementById('endingReplayButton'),

    libraryDialog: document.getElementById('libraryDialog'),
    libraryTitle: document.getElementById('libraryTitle'),
    characterLibraryCount: document.getElementById('characterLibraryCount'),
    characterLibraryList: document.getElementById('characterLibraryList'),
    locationLibraryCount: document.getElementById('locationLibraryCount'),
    locationLibraryList: document.getElementById('locationLibraryList'),

    pauseDialog: document.getElementById('pauseDialog'),
    pauseCheckpointName: document.getElementById('pauseCheckpointName'),
    resumeButton: document.getElementById('resumeButton'),
    saveNowButton: document.getElementById('saveNowButton'),
    pauseMapButton: document.getElementById('pauseMapButton'),
    pauseRetryButton: document.getElementById('pauseRetryButton'),
    pauseSettingsButton: document.getElementById('pauseSettingsButton'),
    pauseHelpButton: document.getElementById('pauseHelpButton'),
    pauseTranscriptButton: document.getElementById('pauseTranscriptButton'),
    pauseTitleButton: document.getElementById('pauseTitleButton'),

    settingsDialog: document.getElementById('settingsDialog'),
    settingsForm: document.getElementById('settingsForm'),
    voiceMutedSetting: document.getElementById('voiceMutedSetting'),
    voiceVolumeSetting: document.getElementById('voiceVolumeSetting'),
    voiceVolumeOutput: document.getElementById('voiceVolumeOutput'),
    autoVoiceSetting: document.getElementById('autoVoiceSetting'),
    textSpeedSetting: document.getElementById('textSpeedSetting'),
    highContrastSetting: document.getElementById('highContrastSetting'),
    reducedMotionSetting: document.getElementById('reducedMotionSetting'),
    decorativeMotionSetting: document.getElementById('decorativeMotionSetting'),

    helpDialog: document.getElementById('helpDialog'),
    creditsDialog: document.getElementById('creditsDialog'),
    transcriptDialog: document.getElementById('transcriptDialog'),
    transcriptLocation: document.getElementById('transcriptLocation'),
    transcriptCount: document.getElementById('transcriptCount'),
    transcriptList: document.getElementById('transcriptList'),
    worldMapDialog: document.getElementById('worldMapDialog'),
    worldMapImage: document.getElementById('worldMapImage'),
    worldMapRouteLayer: document.getElementById('worldMapRouteLayer'),
    worldMapMarkers: document.getElementById('worldMapMarkers'),
    worldMapCurrentName: document.getElementById('worldMapCurrentName'),
    worldMapCurrentRegion: document.getElementById('worldMapCurrentRegion'),
    worldMapCurrentDescription: document.getElementById('worldMapCurrentDescription'),
    worldMapJourneyList: document.getElementById('worldMapJourneyList'),
    saveStatus: document.getElementById('saveStatus'),
  };

  const ctx = dom.worldCanvas.getContext('2d', { alpha: false });
  const mapImages = new Map();
  const drawExploration = window.createMapRenderer(mapArt, characters, mapImages);
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const storage = createStorageAdapter();
  let settings = loadSettings();
  let state = createInitialState(settings);
  let currentMap = mapData.maps[state.mapId];
  let currentScreen = 'loading';
  let activeScene = null;
  let nearestInteraction = null;
  let typing = null;
  let typingTimer = null;
  let selectedChoiceIndex = 0;
  let lastFrameTime = performance.now();
  let lastSaveMovementTime = 0;
  let animationTime = 0;
  let checkpointToastTimer = null;
  let statusTimer = null;
  let canvasCssWidth = 1280;
  let canvasCssHeight = 720;
  let camera = { x: 0, y: 0 };
  let playerMovedThisFrame = false;
  let pausedByVisibility = false;

  const audio = new AudioController({
    element: dom.voiceAudio,
    captionElement: dom.voiceCaption,
    captionTextElement: dom.voiceCaptionText,
    progressElement: dom.voiceProgress,
    status: announce,
    getSettings: () => settings,
  });

  const mapSummaries = {
    birchwood: 'Birchwood is a compact forest crossed by a southern path. Three mushroom patches are spread west, center, and east; a weathered stone stands in the northeast.',
    willowmere: 'Willowmere’s ruined homes occupy the west. A memorial and abandoned shield stand near the center. Rowanstead Farm is intact in the east.',
    greenwake: 'Greenwake is divided by two canal rows and a central bridge. Mira waits south of the water, with an old sluice wheel to the east.',
    ashfinger: 'Ashfinger’s flooded canal cuts across the map. The mill lanes and Mira are south of the water; the royal crystal site is in the northeast.',
    cinder_thumb: 'Cinder Thumb is split by lava and a narrow central crossing. Steam vents line both sides. Bram waits in the southwest and the royal causeway is northeast.',
    crown_city: 'Crown City’s secret rooms connect along a central path. Lucen is in the northwest archive, Mara in the southeast workshop, and Cael waits between them.',
    frostcrown: 'Frostcrown is a snowy ring surrounded by black water and ice cliffs. The final circle lies at its center. Cael waits on the southwest approach.',
  };

  const weatherByMap = {
    birchwood: '',
    willowmere: 'ash',
    greenwake: '',
    ashfinger: 'rain',
    cinder_thumb: 'ash',
    crown_city: '',
    frostcrown: 'snow',
  };

  function createStorageAdapter() {
    let available = false;
    let reason = '';
    try {
      const probeKey = `${SAVE_KEY}.probe`;
      window.localStorage.setItem(probeKey, '1');
      window.localStorage.removeItem(probeKey);
      available = true;
    } catch (error) {
      reason = error.message;
    }

    return {
      get available() {
        return available;
      },
      get reason() {
        return reason;
      },
      get(key) {
        if (!available) return null;
        try {
          return window.localStorage.getItem(key);
        } catch (error) {
          available = false;
          reason = error.message;
          return null;
        }
      },
      set(key, value) {
        if (!available) return false;
        try {
          window.localStorage.setItem(key, value);
          return true;
        } catch (error) {
          available = false;
          reason = error.message;
          return false;
        }
      },
      remove(key) {
        if (!available) return false;
        try {
          window.localStorage.removeItem(key);
          return true;
        } catch (error) {
          available = false;
          reason = error.message;
          return false;
        }
      },
    };
  }

  function loadSettings() {
    const defaults = {
      voiceMuted: false,
      voiceVolume: 0.8,
      autoVoice: true,
      textSpeed: 'fast',
      highContrast: false,
      reducedMotion: motionPreference.matches,
      reducedMotionExplicit: false,
      decorativeMotion: !motionPreference.matches,
    };

    const raw = storage.get(SETTINGS_KEY);
    if (!raw) return defaults;
    try {
      const parsed = JSON.parse(raw);
      return {
        ...defaults,
        ...parsed,
        voiceVolume: clamp(Number(parsed.voiceVolume), 0, 1),
        textSpeed: ['relaxed', 'fast', 'instant'].includes(parsed.textSpeed) ? parsed.textSpeed : defaults.textSpeed,
      };
    } catch (error) {
      console.warn('[The great adventure] Invalid settings were ignored:', error.message);
      storage.remove(SETTINGS_KEY);
      return defaults;
    }
  }

  function createInitialState(currentSettings) {
    const spawn = mapData.maps.birchwood.spawns.find((entry) => entry.id === 'grove');
    return {
      version: SAVE_VERSION,
      started: false,
      updatedAt: null,
      mapId: 'birchwood',
      spawnId: 'grove',
      player: {
        x: spawn.x,
        y: spawn.y,
        facing: spawn.facing,
      },
      completedScenes: [],
      completedInteractions: [],
      flags: {
        mushroomsGathered: 0,
        truthScore: 0,
        bramTrust: 0,
        caelTrust: 0,
        miraTrust: 0,
      },
      clues: [],
      items: [],
      encounters: {},
      objective: 'Gather coppercaps, moonbells, and fox-ears.',
      visitedMaps: ['birchwood'],
      journeyLog: [],
      pendingTravel: null,
      checkpoint: null,
      ending: null,
      transcript: [],
      playTimeMs: 0,
      settings: { ...currentSettings },
    };
  }

  function normalizeSave(candidate) {
    if (!candidate || candidate.version !== SAVE_VERSION || !mapData.maps[candidate.mapId]) {
      return null;
    }
    if (!candidate.player || !Number.isFinite(candidate.player.x) || !Number.isFinite(candidate.player.y)) {
      return null;
    }
    const normalized = {
      ...createInitialState(settings),
      ...candidate,
      started: true,
      completedScenes: Array.isArray(candidate.completedScenes) ? candidate.completedScenes.filter((id) => story.scenes[id]) : [],
      completedInteractions: Array.isArray(candidate.completedInteractions) ? candidate.completedInteractions.filter((id) => typeof id === 'string') : [],
      flags: candidate.flags && typeof candidate.flags === 'object' ? candidate.flags : {},
      clues: Array.isArray(candidate.clues) ? candidate.clues : [],
      items: Array.isArray(candidate.items) ? candidate.items : [],
      encounters: candidate.encounters && typeof candidate.encounters === 'object' ? candidate.encounters : {},
      visitedMaps: Array.isArray(candidate.visitedMaps)
        ? candidate.visitedMaps.filter((id) => mapData.maps[id])
        : ['birchwood'],
      journeyLog: Array.isArray(candidate.journeyLog)
        ? candidate.journeyLog.filter((entry) => (
          entry
          && mapData.maps[entry.fromMapId]
          && mapData.maps[entry.toMapId]
        ))
        : [],
      transcript: Array.isArray(candidate.transcript) ? candidate.transcript.slice(-MAX_TRANSCRIPT_ENTRIES) : [],
      settings: { ...settings },
    };
    if (!normalized.visitedMaps.includes(normalized.mapId)) normalized.visitedMaps.push(normalized.mapId);
    const pendingScene = candidate.pendingTravel?.sceneId
      ? story.scenes[candidate.pendingTravel.sceneId]
      : null;
    normalized.pendingTravel = pendingScene?.onComplete?.travel
      && mapData.maps[candidate.pendingTravel.fromMapId]
      ? {
        sceneId: candidate.pendingTravel.sceneId,
        fromMapId: candidate.pendingTravel.fromMapId,
      }
      : null;
    normalized.flags.mushroomsGathered = Number(normalized.flags.mushroomsGathered) || 0;
    normalized.flags.truthScore = Number(normalized.flags.truthScore) || 0;
    normalized.flags.bramTrust = Number(normalized.flags.bramTrust) || 0;
    normalized.flags.caelTrust = Number(normalized.flags.caelTrust) || 0;
    normalized.flags.miraTrust = Number(normalized.flags.miraTrust) || 0;
    return normalized;
  }

  function readSave({ removeInvalid = true } = {}) {
    const raw = storage.get(SAVE_KEY);
    if (!raw) return null;
    try {
      const parsed = normalizeSave(JSON.parse(raw));
      if (!parsed && removeInvalid) {
        storage.remove(SAVE_KEY);
        announce('A damaged save was ignored. You can begin a new adventure safely.');
      }
      return parsed;
    } catch (error) {
      console.warn('[The great adventure] Invalid save was ignored:', error.message);
      if (removeInvalid) storage.remove(SAVE_KEY);
      announce('A damaged save was ignored. You can begin a new adventure safely.');
      return null;
    }
  }

  function persistSettings() {
    state.settings = { ...settings };
    if (!storage.set(SETTINGS_KEY, JSON.stringify(settings))) {
      updateStorageNotice();
    }
  }

  function persistState(message = '') {
    if (!state.started) return false;
    state.updatedAt = new Date().toISOString();
    state.settings = { ...settings };
    const saved = storage.set(SAVE_KEY, JSON.stringify(state));
    if (message) {
      announce(saved ? message : 'Progress is held for this session, but local storage is unavailable.');
    }
    updateContinueButton();
    return saved;
  }

  function updateStorageNotice() {
    if (storage.available) {
      dom.storageNote.textContent = 'Progress saves locally after scenes and checkpoints.';
    } else {
      dom.storageNote.textContent = 'Local storage is unavailable. This session remains playable, but progress will not survive a reload.';
      dom.storageNote.style.color = 'var(--warning)';
    }
  }

  function updateContinueButton() {
    const saved = readSave({ removeInvalid: false });
    dom.continueButton.disabled = !saved;
    if (!saved) {
      dom.continueDetail.textContent = 'No journey saved';
      return;
    }
    if (saved.ending && story.endings[saved.ending]) {
      dom.continueDetail.textContent = `Completed · ${story.endings[saved.ending].title}`;
      return;
    }
    const map = mapData.maps[saved.mapId];
    dom.continueDetail.textContent = `${map.name} · ${formatPlayTime(saved.playTimeMs)}`;
  }

  function showLoadingProgress(percent, text) {
    dom.loadingProgress.style.width = `${clamp(percent, 0, 100)}%`;
    if (text) dom.loadingStatus.textContent = text;
  }

  function preloadImage(src) {
    return new Promise((resolve) => {
      const image = new Image();
      const done = (ok) => resolve({ src, ok });
      image.onload = () => {
        if (src === mapArt.terrain || src === mapArt.sprites) mapImages.set(src, image);
        done(true);
      };
      image.onerror = () => done(false);
      image.src = src;
    });
  }

  async function initialize() {
    applySettingsToUi();
    bindEvents();
    createTitleStars();
    updateStorageNotice();
    updateContinueButton();
    showLoadingProgress(12, 'Opening the map of the Hand…');

    const initialAssets = [...story.assets.initial, mapArt.terrain, mapArt.sprites];
    let finished = 0;
    await Promise.all(initialAssets.map((asset) => preloadImage(asset).then((result) => {
      finished += 1;
      const percent = 12 + (finished / initialAssets.length) * 78;
      showLoadingProgress(percent, result.ok ? 'Preparing Willowmere…' : 'Preparing a text fallback…');
      return result;
    })));

    showLoadingProgress(100, 'The path is ready.');
    await wait(settings.reducedMotion ? 10 : 260);
    showTitle();

    const warmAssets = () => story.assets.deferred.forEach((asset) => {
      const image = new Image();
      image.decoding = 'async';
      image.src = asset;
    });
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(warmAssets, { timeout: 2500 });
    } else {
      window.setTimeout(warmAssets, 700);
    }

    resizeCanvas();
    requestAnimationFrame(gameLoop);
  }

  function createTitleStars() {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 28; index += 1) {
      const spark = document.createElement('i');
      const seed = hash(index + 91, index * 7 + 13);
      spark.style.left = `${42 + (seed % 56)}%`;
      spark.style.top = `${30 + ((seed * 13) % 65)}%`;
      spark.style.setProperty('--duration', `${5 + (seed % 6)}s`);
      spark.style.setProperty('--drift', `${-18 + (seed % 37)}px`);
      spark.style.animationDelay = `${-(seed % 90) / 10}s`;
      fragment.appendChild(spark);
    }
    dom.titleStars.replaceChildren(fragment);
  }

  function showTitle() {
    clearTyping();
    movementKeys.clear();
    activeScene = null;
    nearestInteraction = null;
    audio.stop(true);
    closeAllDialogs();
    dom.loadingScreen.hidden = true;
    dom.gameScreen.hidden = true;
    dom.sceneOverlay.hidden = true;
    dom.travelOverlay.hidden = true;
    dom.gameOverOverlay.hidden = true;
    dom.endingOverlay.hidden = true;
    dom.titleScreen.hidden = false;
    dom.shell.dataset.screen = 'title';
    currentScreen = 'title';
    updateContinueButton();
    updateAudioButtons();
    window.setTimeout(() => dom.newGameButton.focus(), 30);
  }

  function showGame() {
    dom.titleScreen.hidden = true;
    dom.loadingScreen.hidden = true;
    dom.gameOverOverlay.hidden = true;
    dom.endingOverlay.hidden = true;
    dom.travelOverlay.hidden = true;
    dom.gameScreen.hidden = false;
    dom.gameScreen.inert = false;
    dom.shell.dataset.screen = 'game';
    currentScreen = 'game';
    resizeCanvas();
    updateHud();
    updateParty();
  }

  function beginNewGame({ skipConfirmation = false } = {}) {
    if (!skipConfirmation && readSave({ removeInvalid: false })) {
      const confirmed = window.confirm('Start a new adventure? The current save will be replaced when the first scene completes.');
      if (!confirmed) return;
    }
    audio.unlock();
    settings = { ...settings };
    state = createInitialState(settings);
    state.started = true;
    currentMap = mapData.maps.birchwood;
    setMap('birchwood', 'grove');
    showGame();
    startScene(story.initialScene);
  }

  function continueGame() {
    const saved = readSave();
    if (!saved) {
      updateContinueButton();
      announce('No valid save is available.');
      return;
    }
    audio.unlock();
    state = saved;
    settings = { ...settings, ...saved.settings };
    applySettingsToUi();
    currentMap = mapData.maps[state.mapId];
    showGame();
    setMap(state.mapId, null, { preservePosition: true });
    if (state.pendingTravel) {
      showTravelTransition();
    } else if (state.ending && story.endings[state.ending]) {
      showEnding(state.ending);
    } else {
      announce(`Continued at ${currentMap.name}.`);
    }
  }

  function setMap(mapId, spawnId = null, options = {}) {
    const map = mapData.maps[mapId];
    if (!map) {
      announce('That location could not be loaded. Returning to Birchwood.');
      return setMap('birchwood', 'grove');
    }
    currentMap = map;
    state.mapId = mapId;
    if (!Array.isArray(state.visitedMaps)) state.visitedMaps = [];
    if (!state.visitedMaps.includes(mapId)) state.visitedMaps.push(mapId);
    if (spawnId) {
      const spawn = map.spawns.find((entry) => entry.id === spawnId) || map.spawns[0];
      state.spawnId = spawn.id;
      state.player = {
        x: spawn.x,
        y: spawn.y,
        facing: spawn.facing || 'down',
      };
    } else if (!options.preservePosition) {
      const spawn = map.spawns[0];
      state.spawnId = spawn.id;
      state.player = {
        x: spawn.x,
        y: spawn.y,
        facing: spawn.facing || 'down',
      };
    }
    camera = { x: 0, y: 0 };
    nearestInteraction = null;
    updateHud();
    updateParty();
    updateInteractionPrompt();
    renderMap(true);
  }

  function updateHud() {
    if (!currentMap) return;
    dom.chapterKicker.textContent = currentMap.chapter;
    dom.mapName.textContent = currentMap.name;
    dom.mapSubtitle.textContent = currentMap.subtitle;
    dom.objectiveText.textContent = state.objective || 'Explore and speak with the people nearby.';
    dom.worldCanvas.setAttribute('aria-label', `Top-down exploration view of ${currentMap.name}. ${currentMap.ambience}`);
    dom.mapAccessibleSummary.textContent = mapSummaries[currentMap.id] || currentMap.ambience;
    const weather = weatherByMap[currentMap.id] || '';
    if (weather) dom.weatherLayer.dataset.weather = weather;
    else dom.weatherLayer.removeAttribute('data-weather');
  }

  function updateParty() {
    const memberIds = [];
    if (state.flags.bramJoined) memberIds.push('bram');
    if (state.flags.miraJoined) memberIds.push('mira');
    if (state.flags.caelConfessed) memberIds.push('cael');
    if (state.flags.workshopResolved && state.mapId === 'frostcrown') memberIds.push('mara');
    dom.partyRail.hidden = memberIds.length === 0;
    const fragment = document.createDocumentFragment();
    memberIds.forEach((id) => {
      const character = characters[id];
      const chip = document.createElement('span');
      chip.className = 'party-chip';
      chip.style.setProperty('--chip-color', character.accent);
      chip.innerHTML = '<i aria-hidden="true"></i>';
      chip.append(document.createTextNode(character.shortName));
      fragment.appendChild(chip);
    });
    dom.partyList.replaceChildren(fragment);
  }

  function evaluate(condition) {
    if (!condition) return true;
    if (Array.isArray(condition)) return condition.every(evaluate);
    if (condition.all) return condition.all.every(evaluate);
    if (condition.any) return condition.any.some(evaluate);
    if (condition.not) return !evaluate(condition.not);
    if (condition.flag) {
      const value = state.flags[condition.flag];
      if (Object.prototype.hasOwnProperty.call(condition, 'equals')) return value === condition.equals;
      if (condition.truthy === true) return Boolean(value);
      if (condition.truthy === false) return !value;
      return Boolean(value);
    }
    if (condition.counter) {
      const value = Number(state.flags[condition.counter]) || 0;
      if (Number.isFinite(condition.gte) && value < condition.gte) return false;
      if (Number.isFinite(condition.lte) && value > condition.lte) return false;
      if (Number.isFinite(condition.equals) && value !== condition.equals) return false;
      return true;
    }
    if (condition.completed) return state.completedScenes.includes(condition.completed);
    if (condition.interaction) return state.completedInteractions.includes(condition.interaction);
    if (condition.ending) return state.ending === condition.ending;
    return true;
  }

  function getVisibleMapItems() {
    if (!currentMap) return [];
    return [...currentMap.npcs, ...currentMap.interactions].filter(item => evaluate(item.when));
  }

  function getItemCenter(item) {
    return { x: item.x + 0.5, y: item.y + 0.5 };
  }

  function findNearestInteraction(items = getVisibleMapItems()) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const item of items) {
      const point = getItemCenter(item);
      const distance = Math.hypot(state.player.x - point.x, state.player.y - point.y);
      if (distance <= INTERACTION_RANGE && distance < nearestDistance) {
        nearest = item;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  function updateInteractionPrompt(items) {
    nearestInteraction = findNearestInteraction(items);
    if (!nearestInteraction || activeScene || currentScreen !== 'game') {
      dom.interactionPrompt.hidden = true;
      dom.touchInteractButton.setAttribute('aria-label', 'Interact');
      return;
    }
    const isComplete = state.completedInteractions.includes(nearestInteraction.id);
    const label = isComplete && nearestInteraction.repeatSceneId
      ? nearestInteraction.label.replace(/^(Inspect|Pick|Enter|Approach|Study|Map|Listen|Tie|Open|Release|Help|Hear|Warn)\s+/i, 'Review ')
      : nearestInteraction.label;
    if (dom.interactionPrompt.hidden || dom.interactionPromptText.textContent !== label) {
      dom.interactionPromptText.textContent = label;
      dom.touchInteractButton.setAttribute('aria-label', label);
      dom.interactionPrompt.hidden = false;
    }
  }

  function interact() {
    if (activeScene) {
      advanceScene();
      return;
    }
    nearestInteraction = findNearestInteraction();
    if (!nearestInteraction) {
      announce('Nothing nearby needs Aren’s attention.');
      return;
    }
    if (nearestInteraction.requires && !evaluate(nearestInteraction.requires)) {
      announce(nearestInteraction.lockedMessage || 'That route is not available yet.');
      audio.playInterfaceTone('danger');
      return;
    }
    const completed = state.completedInteractions.includes(nearestInteraction.id);
    const sceneId = completed && nearestInteraction.repeatSceneId
      ? nearestInteraction.repeatSceneId
      : nearestInteraction.sceneId;
    if (!sceneId || !story.scenes[sceneId]) {
      announce('This interaction has no story data.');
      return;
    }
    audio.unlock();
    startScene(sceneId, nearestInteraction.id);
  }

  function startScene(sceneId, interactionId = null) {
    const scene = story.scenes[sceneId];
    if (!scene) {
      announce(`Scene “${sceneId}” could not be found.`);
      return;
    }
    clearTyping();
    movementKeys.clear();
    audio.stop(false);
    activeScene = {
      scene,
      stepIndex: 0,
      interactionId,
      choiceOptions: [],
    };
    selectedChoiceIndex = 0;
    dom.gameOverOverlay.hidden = true;
    dom.endingOverlay.hidden = true;
    dom.travelOverlay.hidden = true;
    dom.gameScreen.inert = true;
    dom.sceneOverlay.hidden = false;
    dom.sceneChapter.textContent = scene.chapter || currentMap?.chapter || 'The great adventure';
    dom.sceneTitle.textContent = scene.title || 'Story';
    setSceneArt(scene);
    processSceneStep();
  }

  function setSceneArt(scene) {
    const fallbackText = dom.sceneArtFallback.querySelector('p');
    const fallbackDescription = scene.imageAlt || 'The scene continues through dialogue and narration.';
    fallbackText.textContent = fallbackDescription;
    if (!scene.image) {
      dom.sceneArt.hidden = true;
      dom.sceneArtFallback.hidden = false;
      return;
    }
    dom.sceneArt.hidden = true;
    dom.sceneArtFallback.hidden = false;
    fallbackText.textContent = `Loading ${scene.title || 'the next scene'}…`;
    dom.sceneArt.alt = scene.imageAlt || '';
    dom.sceneArt.onload = () => {
      dom.sceneArt.hidden = false;
      dom.sceneArtFallback.hidden = true;
    };
    dom.sceneArt.onerror = () => {
      dom.sceneArt.hidden = true;
      dom.sceneArtFallback.hidden = false;
      fallbackText.textContent = fallbackDescription;
      announce('A scene illustration could not be loaded. The complete story continues in text.');
    };
    dom.sceneArt.src = scene.image;
    if (dom.sceneArt.complete && dom.sceneArt.naturalWidth > 0) {
      dom.sceneArt.hidden = false;
      dom.sceneArtFallback.hidden = true;
    }
  }

  function processSceneStep() {
    if (!activeScene) return;
    const { scene } = activeScene;
    while (activeScene.stepIndex < scene.steps.length) {
      const step = scene.steps[activeScene.stepIndex];
      if (!evaluate(step.when)) {
        activeScene.stepIndex += 1;
        continue;
      }
      if (step.type === 'effect') {
        applyEffect(step.effect);
        activeScene.stepIndex += 1;
        continue;
      }
      if (step.type === 'line' || step.type === 'narration') {
        showDialogueStep(step);
        return;
      }
      if (step.type === 'choice') {
        showChoiceStep(step);
        return;
      }
      if (step.type === 'gameover') {
        showGameOver(step);
        return;
      }
      if (step.type === 'ending') {
        completeActiveScene();
        showEnding(step.endingId);
        return;
      }
      activeScene.stepIndex += 1;
    }
    finishActiveScene();
  }

  function showDialogueStep(step) {
    const isNarration = step.type === 'narration';
    const speaker = isNarration ? characters.narrator : (characters[step.speaker] || characters.system);
    dom.dialogueText.hidden = false;
    dom.speakerName.textContent = speaker.name;
    dom.speakerRole.textContent = isNarration ? 'Storyteller' : speaker.role;
    dom.expressionLabel.textContent = step.expression || (isNarration ? 'narration' : 'neutral');
    dom.dialogueText.dataset.narration = String(isNarration);
    dom.dialogueCard.style.setProperty('--speaker-color', speaker.accent || 'var(--accent)');
    dom.speakerPortraitWrap.style.setProperty('--speaker-color', speaker.accent || 'var(--accent)');
    dom.speakerPortraitWrap.style.setProperty('--speaker-tint', hexToRgba(speaker.accent || '#ffc247', 0.16));

    if (speaker.portrait) {
      dom.speakerPortrait.hidden = false;
      dom.speakerPortrait.src = speaker.portrait;
      dom.speakerPortrait.alt = speaker.portraitAlt || `${speaker.name} portrait`;
      dom.speakerMonogram.hidden = true;
      dom.speakerPortrait.onerror = () => {
        dom.speakerPortrait.hidden = true;
        dom.speakerMonogram.hidden = false;
        dom.speakerMonogram.textContent = speaker.shortName?.charAt(0) || speaker.name.charAt(0);
        announce(`${speaker.name}’s portrait could not be loaded. Dialogue remains available.`);
      };
    } else {
      dom.speakerPortrait.hidden = true;
      dom.speakerPortrait.removeAttribute('src');
      dom.speakerMonogram.hidden = false;
      dom.speakerMonogram.textContent = isNarration ? '◇' : (speaker.shortName?.charAt(0) || '•');
    }

    dom.choiceRegion.hidden = true;
    dom.choiceList.replaceChildren();
    dom.advanceButton.hidden = false;
    dom.advanceButtonText.textContent = activeScene.stepIndex === activeScene.scene.steps.length - 1 ? 'Continue' : 'Continue';
    dom.replayVoiceButton.disabled = !step.audio;
    addTranscript({
      type: isNarration ? 'narration' : 'line',
      speakerId: speaker.id,
      speakerName: speaker.name,
      text: step.text,
      sceneId: activeScene.scene.id,
      mapId: state.mapId,
    });
    beginTypewriter(step.text);
    if (step.audio) {
      audio.play(step.audio);
    } else {
      audio.showCaption('');
    }
    window.setTimeout(() => dom.advanceButton.focus({ preventScroll: true }), 20);
  }

  function beginTypewriter(text) {
    clearTyping();
    const instant = settings.textSpeed === 'instant' || settings.reducedMotion;
    if (instant) {
      dom.dialogueText.textContent = text;
      typing = null;
      return;
    }
    const charactersInText = Array.from(text);
    const perTick = settings.textSpeed === 'relaxed' ? 1 : 2;
    const interval = settings.textSpeed === 'relaxed' ? 28 : 18;
    typing = { text, characters: charactersInText, index: 0 };
    dom.dialogueText.textContent = '';
    typingTimer = window.setInterval(() => {
      if (!typing) return;
      typing.index = Math.min(typing.characters.length, typing.index + perTick);
      dom.dialogueText.textContent = typing.characters.slice(0, typing.index).join('');
      if (typing.index >= typing.characters.length) clearTyping(false);
    }, interval);
  }

  function clearTyping(reveal = true) {
    if (typingTimer) {
      window.clearInterval(typingTimer);
      typingTimer = null;
    }
    if (typing && reveal) dom.dialogueText.textContent = typing.text;
    typing = null;
  }

  function showChoiceStep(step) {
    clearTyping();
    audio.showCaption('');
    dom.dialogueText.hidden = true;
    dom.speakerName.textContent = 'Your choice';
    dom.speakerRole.textContent = activeScene.scene.kind === 'encounter' ? 'Story encounter' : 'Decision';
    dom.expressionLabel.textContent = 'choose';
    dom.dialogueText.textContent = '';
    dom.dialogueText.dataset.narration = 'false';
    dom.speakerPortrait.hidden = true;
    dom.speakerPortrait.removeAttribute('src');
    dom.speakerMonogram.hidden = false;
    dom.speakerMonogram.textContent = '◇';
    dom.choicePrompt.textContent = step.prompt || 'Choose a response.';
    dom.choiceRegion.hidden = false;
    dom.advanceButton.hidden = true;
    dom.replayVoiceButton.disabled = true;

    const options = (step.options || []).filter((option) => evaluate(option.when));
    activeScene.choiceOptions = options;
    selectedChoiceIndex = clamp(selectedChoiceIndex, 0, Math.max(0, options.length - 1));
    const fragment = document.createDocumentFragment();
    options.forEach((option, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'choice-button';
      button.dataset.choiceIndex = String(index);
      const danger = /reckless|game over|overwhelming|cannot succeed/i.test(`${option.hint || ''} ${option.text}`);
      button.dataset.danger = String(danger);

      const number = document.createElement('b');
      number.textContent = String(index + 1);
      number.setAttribute('aria-hidden', 'true');
      const copy = document.createElement('span');
      const label = document.createElement('strong');
      label.textContent = option.text;
      copy.appendChild(label);
      if (option.hint) {
        const hint = document.createElement('small');
        hint.textContent = option.hint;
        copy.appendChild(hint);
      }
      button.append(number, copy);
      button.addEventListener('click', () => selectChoice(index));
      fragment.appendChild(button);
    });
    dom.choiceList.replaceChildren(fragment);
    updateChoiceFocus();
    window.setTimeout(() => {
      const first = dom.choiceList.querySelector('.choice-button');
      first?.focus({ preventScroll: true });
    }, 20);
  }

  function updateChoiceFocus() {
    const buttons = [...dom.choiceList.querySelectorAll('.choice-button')];
    buttons.forEach((button, index) => button.classList.toggle('is-focused', index === selectedChoiceIndex));
  }

  function selectChoice(index) {
    if (!activeScene || !activeScene.choiceOptions?.length) return;
    const option = activeScene.choiceOptions[index];
    if (!option) return;
    audio.unlock();
    addTranscript({
      type: 'choice',
      speakerId: 'aren',
      speakerName: 'Choice',
      text: option.text,
      sceneId: activeScene.scene.id,
      mapId: state.mapId,
    });
    applyEffects(option.effects || []);

    if (option.next) {
      const nextScene = story.scenes[option.next];
      completeActiveScene();
      if (nextScene?.kind !== 'gameover') persistState();
      startScene(option.next);
      return;
    }

    activeScene.stepIndex += 1;
    selectedChoiceIndex = 0;
    processSceneStep();
  }

  function advanceScene() {
    if (!activeScene) return;
    if (typing) {
      clearTyping(true);
      return;
    }
    const currentStep = activeScene.scene.steps[activeScene.stepIndex];
    if (currentStep?.type === 'choice') return;
    if (currentStep?.type === 'gameover' || currentStep?.type === 'ending') return;
    audio.stop(false);
    activeScene.stepIndex += 1;
    processSceneStep();
  }

  function completeActiveScene() {
    if (!activeScene) return null;
    const completed = activeScene;
    if (!state.completedScenes.includes(completed.scene.id)) {
      state.completedScenes.push(completed.scene.id);
    }
    if (completed.interactionId && !state.completedInteractions.includes(completed.interactionId)) {
      state.completedInteractions.push(completed.interactionId);
    }
    return completed;
  }

  function finishActiveScene() {
    if (!activeScene) return;
    clearTyping();
    audio.stop(false);
    const completed = completeActiveScene();
    const completion = completed.scene.onComplete || {};
    activeScene = null;
    applyEffects(completion.effects || []);
    if (completion.travel) {
      state.pendingTravel = {
        sceneId: completed.scene.id,
        fromMapId: state.mapId,
      };
      persistState();
      showTravelTransition();
      return;
    }
    applyEffects(completion.effectsAfterTravel || []);
    if (completion.checkpoint) {
      createCheckpoint(completion.checkpoint, completion.next || null);
    }
    updateHud();
    updateParty();
    persistState();
    if (completion.next) {
      startScene(completion.next);
      return;
    }
    dom.sceneOverlay.hidden = true;
    dom.gameScreen.inert = false;
    dom.voiceCaption.hidden = true;
    updateInteractionPrompt();
    dom.worldCanvas.focus({ preventScroll: true });
  }

  function getPendingTravelDetails() {
    const pending = state.pendingTravel;
    const scene = pending?.sceneId ? story.scenes[pending.sceneId] : null;
    const completion = scene?.onComplete || null;
    const travel = completion?.travel || null;
    const fromMapId = pending?.fromMapId;
    const toMapId = travel?.mapId;
    if (!scene || !travel || !mapData.maps[fromMapId] || !mapData.maps[toMapId]) return null;
    const journey = mapData.world?.journeys?.[`${fromMapId}:${toMapId}`] || {
      mode: 'Overland',
      span: 'Across the Hand',
      via: [],
      description: `The party leaves ${mapData.maps[fromMapId].name} and continues toward ${mapData.maps[toMapId].name}.`,
    };
    return {
      pending,
      scene,
      completion,
      travel,
      fromMapId,
      toMapId,
      fromMap: mapData.maps[fromMapId],
      toMap: mapData.maps[toMapId],
      journey,
    };
  }

  function showTravelTransition() {
    const details = getPendingTravelDetails();
    if (!details) {
      state.pendingTravel = null;
      dom.travelOverlay.hidden = true;
      dom.gameScreen.inert = false;
      persistState();
      announce('The saved journey transition was incomplete. Exploration has resumed safely.');
      return;
    }

    clearTyping();
    movementKeys.clear();
    activeScene = null;
    dom.sceneOverlay.hidden = true;
    dom.gameOverOverlay.hidden = true;
    dom.endingOverlay.hidden = true;
    dom.gameScreen.inert = true;
    dom.travelOverlay.hidden = false;

    dom.travelTitle.textContent = `Toward ${details.toMap.name}`;
    dom.travelFromName.textContent = details.fromMap.name;
    dom.travelToName.textContent = details.toMap.name;
    dom.travelDescription.textContent = details.journey.description;
    dom.travelMode.textContent = details.journey.mode;
    dom.travelSpan.textContent = details.journey.span;
    dom.travelContinueText.textContent = `Arrive in ${details.toMap.name}`;
    dom.travelMapSummary.textContent = `Traveling from ${details.fromMap.name}, ${mapData.world.locations[details.fromMapId]?.region || 'Asterra'}, to ${details.toMap.name}, ${mapData.world.locations[details.toMapId]?.region || 'Asterra'}.`;

    renderWorldMap(dom.travelRouteLayer, dom.travelMapMarkers, {
      departure: details.fromMapId,
      destination: details.toMapId,
    });
    renderTravelChapterRail(details.fromMapId, details.toMapId);
    positionTravelerToken(details.fromMapId, details.toMapId);

    const narration = details.journey.narration || '';
    dom.travelNarration.hidden = !narration;
    dom.travelNarrationText.textContent = narration;
    dom.travelReplayButton.disabled = !details.journey.audio;
    if (details.journey.audio) {
      if (narration) {
        addTranscript({
          type: 'narration',
          speakerId: 'narrator',
          speakerName: 'Narrator',
          text: narration,
          sceneId: `travel_${details.scene.id}`,
          mapId: details.fromMapId,
        });
      }
      audio.play(details.journey.audio);
    } else {
      audio.showCaption('');
    }

    announce(`Journey map: ${details.fromMap.name} to ${details.toMap.name}.`);
    window.setTimeout(() => dom.travelContinueButton.focus({ preventScroll: true }), 40);
  }

  function positionTravelerToken(fromMapId, toMapId) {
    const from = mapData.world?.locations?.[fromMapId];
    const to = mapData.world?.locations?.[toMapId];
    if (!from || !to) {
      dom.travelerToken.hidden = true;
      return;
    }
    dom.travelerToken.hidden = false;
    dom.travelerToken.classList.remove('is-moving');
    dom.travelerToken.style.setProperty('--from-x', `${from.x}%`);
    dom.travelerToken.style.setProperty('--from-y', `${from.y}%`);
    dom.travelerToken.style.setProperty('--to-x', `${to.x}%`);
    dom.travelerToken.style.setProperty('--to-y', `${to.y}%`);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => dom.travelerToken.classList.add('is-moving'));
    });
  }

  function renderTravelChapterRail(fromMapId, toMapId) {
    const visited = new Set(state.visitedMaps || []);
    const orderedMapIds = [...visited];
    if (!orderedMapIds.includes(toMapId)) orderedMapIds.push(toMapId);
    mapData.mapOrder.forEach((mapId) => {
      if (!orderedMapIds.includes(mapId)) orderedMapIds.push(mapId);
    });
    const fragment = document.createDocumentFragment();
    orderedMapIds.forEach((mapId, index) => {
      const item = document.createElement('li');
      let markerState = visited.has(mapId) ? 'visited' : 'unvisited';
      if (mapId === fromMapId) markerState = 'departure';
      if (mapId === toMapId) markerState = 'destination';
      item.dataset.state = markerState;
      const chapter = document.createElement('small');
      chapter.textContent = `STOP ${index + 1}`;
      const name = document.createElement('strong');
      name.textContent = mapData.maps[mapId].name.replace(' & Rowanstead', '');
      item.append(chapter, name);
      fragment.appendChild(item);
    });
    dom.travelChapterRail.replaceChildren(fragment);
  }

  function renderWorldMap(routeLayer, markerLayer, options = {}) {
    if (!routeLayer || !markerLayer || !mapData.world) return;
    const svgNamespace = routeLayer.namespaceURI;
    const routeFragment = document.createDocumentFragment();
    const loggedJourneys = Array.isArray(state.journeyLog) ? state.journeyLog : [];

    loggedJourneys.forEach((entry) => {
      const pathData = getJourneyPath(entry.fromMapId, entry.toMapId);
      if (!pathData) return;
      const path = document.createElementNS(svgNamespace, 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('class', 'route-past');
      routeFragment.appendChild(path);
    });

    if (options.departure && options.destination) {
      const activePathData = getJourneyPath(options.departure, options.destination);
      if (activePathData) {
        const path = document.createElementNS(svgNamespace, 'path');
        path.setAttribute('d', activePathData);
        path.setAttribute('class', 'route-active');
        routeFragment.appendChild(path);
      }
    }
    routeLayer.replaceChildren(routeFragment);

    const visited = new Set(state.visitedMaps || []);
    const markerFragment = document.createDocumentFragment();
    Object.entries(mapData.world.locations).forEach(([mapId, location]) => {
      const marker = document.createElement('span');
      marker.className = 'world-marker';
      marker.style.left = `${location.x}%`;
      marker.style.top = `${location.y}%`;
      marker.dataset.side = location.labelSide || 'right';
      let markerState = visited.has(mapId) ? 'visited' : 'unknown';
      if (mapId === options.current) markerState = 'current';
      if (mapId === options.departure) markerState = 'departure';
      if (mapId === options.destination) markerState = 'destination';
      marker.dataset.state = markerState;

      const dot = document.createElement('i');
      const label = document.createElement('span');
      const name = document.createElement('strong');
      name.textContent = location.name;
      const region = document.createElement('small');
      region.textContent = location.region;
      label.append(name, region);
      marker.append(dot, label);
      markerFragment.appendChild(marker);
    });
    markerLayer.replaceChildren(markerFragment);
  }

  function getJourneyPath(fromMapId, toMapId) {
    const from = mapData.world?.locations?.[fromMapId];
    const to = mapData.world?.locations?.[toMapId];
    if (!from || !to) return '';
    const journey = mapData.world.journeys?.[`${fromMapId}:${toMapId}`];
    const points = [[from.x, from.y], ...(journey?.via || []), [to.x, to.y]];
    return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  }

  function completeTravelTransition() {
    const details = getPendingTravelDetails();
    if (!details) {
      showTravelTransition();
      return;
    }
    audio.stop(true);
    state.pendingTravel = null;
    if (!Array.isArray(state.journeyLog)) state.journeyLog = [];
    const lastJourney = state.journeyLog[state.journeyLog.length - 1];
    if (lastJourney?.fromMapId !== details.fromMapId || lastJourney?.toMapId !== details.toMapId) {
      state.journeyLog.push({
        fromMapId: details.fromMapId,
        toMapId: details.toMapId,
        sceneId: details.scene.id,
      });
    }
    dom.travelOverlay.hidden = true;
    setMap(details.toMapId, details.travel.spawnId);
    applyEffects(details.completion.effectsAfterTravel || []);
    if (details.completion.checkpoint) {
      createCheckpoint(details.completion.checkpoint, details.completion.next || null);
    }
    updateHud();
    updateParty();
    persistState();
    announce(`Arrived in ${details.toMap.name}.`);
    if (details.completion.next) {
      startScene(details.completion.next);
      return;
    }
    dom.gameScreen.inert = false;
    updateInteractionPrompt();
    dom.worldCanvas.focus({ preventScroll: true });
  }

  function openWorldMap() {
    if (!state.started || currentScreen !== 'game') return;
    const location = mapData.world?.locations?.[state.mapId];
    renderWorldMap(dom.worldMapRouteLayer, dom.worldMapMarkers, { current: state.mapId });
    dom.worldMapCurrentName.textContent = location?.name || currentMap?.name || 'Asterra';
    dom.worldMapCurrentRegion.textContent = location?.region || currentMap?.subtitle || '';
    dom.worldMapCurrentDescription.textContent = location?.description || currentMap?.ambience || '';

    const fragment = document.createDocumentFragment();
    (state.visitedMaps || []).forEach((mapId, index) => {
      const visitedLocation = mapData.world?.locations?.[mapId];
      if (!visitedLocation) return;
      const item = document.createElement('li');
      if (mapId === state.mapId) item.setAttribute('aria-current', 'location');
      const number = document.createElement('b');
      number.textContent = String(index + 1);
      const label = document.createElement('span');
      label.textContent = `${visitedLocation.name} · ${visitedLocation.region}`;
      item.append(number, label);
      fragment.appendChild(item);
    });
    dom.worldMapJourneyList.replaceChildren(fragment);
    showDialog(dom.worldMapDialog);
  }

  function applyEffects(effects) {
    effects.forEach(applyEffect);
    updateHud();
    updateParty();
  }

  function applyEffect(effect) {
    if (!effect || !effect.type) return;
    if (effect.when && !evaluate(effect.when)) return;
    switch (effect.type) {
      case 'set':
        state.flags[effect.key] = effect.value;
        break;
      case 'increment':
        state.flags[effect.key] = (Number(state.flags[effect.key]) || 0) + (Number(effect.amount) || 0);
        break;
      case 'addItem':
        if (!state.items.some((item) => item.id === effect.id)) {
          state.items.push({ id: effect.id, name: effect.name || effect.id });
        }
        break;
      case 'addClue':
        if (!state.clues.some((clue) => clue.id === effect.id)) {
          state.clues.push({
            id: effect.id,
            name: effect.name || effect.id,
            description: effect.description || '',
          });
        }
        break;
      case 'objective':
        state.objective = effect.text || '';
        break;
      case 'encounter':
        state.encounters[effect.id] = effect.outcome || 'complete';
        break;
      case 'checkpoint':
        createCheckpoint(effect.label || 'Story checkpoint', activeScene?.scene.id || null);
        break;
      default:
        console.warn('[The great adventure] Unknown effect:', effect.type);
    }
  }

  function createCheckpoint(label, retrySceneId = null) {
    const snapshot = deepClone(state);
    snapshot.checkpoint = null;
    const checkpoint = {
      label,
      mapId: state.mapId,
      createdAt: new Date().toISOString(),
      retrySceneId,
      snapshot,
    };
    state.checkpoint = checkpoint;
    dom.checkpointToastText.textContent = label;
    dom.checkpointToast.hidden = false;
    if (checkpointToastTimer) window.clearTimeout(checkpointToastTimer);
    checkpointToastTimer = window.setTimeout(() => {
      dom.checkpointToast.hidden = true;
    }, settings.reducedMotion ? 1600 : 2800);
    audio.playInterfaceTone('checkpoint');
    persistState();
  }

  function retryCheckpoint() {
    const checkpoint = state.checkpoint;
    if (!checkpoint?.snapshot) {
      announce('No checkpoint is available yet.');
      return;
    }
    const snapshot = normalizeSave({ ...deepClone(checkpoint.snapshot), started: true });
    if (!snapshot) {
      announce('The checkpoint could not be restored.');
      return;
    }
    const preservedCheckpoint = {
      label: checkpoint.label,
      mapId: checkpoint.mapId,
      createdAt: checkpoint.createdAt,
      retrySceneId: checkpoint.retrySceneId,
      snapshot: deepClone(checkpoint.snapshot),
    };
    snapshot.checkpoint = preservedCheckpoint;
    snapshot.settings = { ...settings };
    state = snapshot;
    activeScene = null;
    clearTyping();
    audio.stop(true);
    closeAllDialogs();
    dom.gameOverOverlay.hidden = true;
    dom.endingOverlay.hidden = true;
    showGame();
    setMap(state.mapId, null, { preservePosition: true });
    persistState(`Returned to checkpoint: ${checkpoint.label}.`);
    if (checkpoint.retrySceneId && story.scenes[checkpoint.retrySceneId]) {
      startScene(checkpoint.retrySceneId);
    } else {
      dom.worldCanvas.focus({ preventScroll: true });
    }
  }

  function showGameOver(step) {
    clearTyping();
    audio.stop(true);
    dom.sceneOverlay.hidden = true;
    dom.travelOverlay.hidden = true;
    dom.gameOverTitle.textContent = step.title || 'The story ends here';
    dom.gameOverReason.textContent = step.reason || 'A dangerous choice ended the journey.';
    dom.gameOverLesson.textContent = step.lesson || 'Return to the checkpoint and choose another approach.';
    const checkpointLabel = state.checkpoint?.label || 'the last checkpoint';
    dom.retryCheckpointLabel.textContent = `Return to ${checkpointLabel}`;
    dom.retryCheckpointButton.disabled = !state.checkpoint;
    dom.gameScreen.inert = true;
    dom.gameOverOverlay.hidden = false;
    audio.playInterfaceTone('danger');
    window.setTimeout(() => dom.retryCheckpointButton.focus(), 30);
  }

  function showEnding(endingId) {
    const ending = story.endings[endingId];
    if (!ending) {
      announce('The ending data could not be loaded.');
      return;
    }
    clearTyping();
    activeScene = null;
    state.ending = endingId;
    state.objective = 'Journey complete.';
    dom.sceneOverlay.hidden = true;
    dom.travelOverlay.hidden = true;
    dom.gameOverOverlay.hidden = true;
    dom.gameScreen.inert = true;
    dom.endingImage.src = ending.image;
    dom.endingImage.alt = ending.imageAlt;
    dom.endingImage.onerror = () => {
      announce('The ending illustration could not be loaded. The complete epilogue remains in text.');
      dom.endingImage.hidden = true;
    };
    dom.endingImage.onload = () => {
      dom.endingImage.hidden = false;
    };
    dom.endingNumber.textContent = `ENDING ${ending.number} OF 3`;
    dom.endingTitle.textContent = ending.title;
    dom.endingSubtitle.textContent = ending.subtitle;
    dom.endingSummary.textContent = ending.summary;
    dom.endingConsequence.textContent = ending.consequence;
    dom.endingOverlay.style.setProperty('--ending-color', ending.color);
    populateEndingEchoes();
    dom.endingOverlay.hidden = false;
    persistState('Journey complete. The ending has been saved.');
    window.setTimeout(() => dom.endingTitle.focus(), 40);
  }

  function populateEndingEchoes() {
    const echoes = [];
    if (state.flags.savedVillage) {
      const savedName = state.flags.savedVillage === 'greenwake' ? 'Greenwake' : 'Ashfinger';
      const lostName = state.flags.lostVillage === 'greenwake' ? 'Greenwake' : 'Ashfinger';
      echoes.push(`${savedName} remembers the warning and the hands that stayed. ${lostName} is named in Lucen’s first public memorial.`);
    }
    if (state.flags.miraJoined) {
      echoes.push('Mira carries the rescued villages’ testimony into the new settlement of the gate.');
    } else {
      echoes.push('Mira remains in Greenwake, building a signal network so the fingers never wait alone again.');
    }
    if (state.flags.foundRoyalJournal) {
      echoes.push('Elara’s own words become part of the public record, preventing her illness from being used as an excuse.');
    }
    if (state.flags.savedPalaceRecords) {
      echoes.push('Lucen publishes the preserved palace records instead of asking Asterra to trust a cleaner royal story.');
    } else if (state.flags.protectedMara) {
      echoes.push('Mara repairs the Starling and opens the first civilian route between the distant fingers.');
    }
    if (state.flags.memorialVisited) {
      echoes.push('Aren keeps the pale Willowmere ribbon. It remains a memory, never an order.');
    }

    const fragment = document.createDocumentFragment();
    echoes.slice(0, 4).forEach((text) => {
      const entry = document.createElement('div');
      entry.className = 'ending-echo';
      entry.textContent = text;
      fragment.appendChild(entry);
    });
    dom.endingEchoes.replaceChildren(fragment);
  }

  function createLibraryMedia({ image, imageAlt, name, accent }) {
    const media = document.createElement('span');
    media.className = 'library-entry-media';
    media.style.setProperty('--library-accent', accent || 'var(--accent)');

    const fallback = document.createElement('span');
    fallback.className = 'library-entry-fallback';
    fallback.setAttribute('aria-hidden', 'true');
    fallback.textContent = name.slice(0, 1).toUpperCase();

    if (image) {
      const portrait = document.createElement('img');
      portrait.src = image;
      portrait.alt = imageAlt || '';
      portrait.loading = 'lazy';
      portrait.decoding = 'async';
      fallback.hidden = true;
      portrait.addEventListener('error', () => {
        portrait.hidden = true;
        fallback.hidden = false;
      }, { once: true });
      media.append(portrait);
    }
    media.append(fallback);
    return media;
  }

  function appendLibraryFact(list, label, value) {
    if (!value) return;
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    list.append(term, detail);
  }

  function createLibraryEntry({
    id,
    name,
    subtitle,
    image,
    imageAlt,
    accent,
    summary,
    facts,
    sections,
    open = false,
  }) {
    const details = document.createElement('details');
    details.className = 'library-entry';
    details.dataset.entryId = id;
    details.style.setProperty('--library-accent', accent || 'var(--accent)');
    details.open = open;

    const heading = document.createElement('summary');
    heading.append(createLibraryMedia({ image, imageAlt, name, accent }));

    const title = document.createElement('span');
    title.className = 'library-entry-title';
    const titleName = document.createElement('strong');
    titleName.textContent = name;
    const titleSubtitle = document.createElement('small');
    titleSubtitle.textContent = subtitle;
    title.append(titleName, titleSubtitle);

    const disclosure = document.createElement('span');
    disclosure.className = 'library-entry-disclosure';
    disclosure.setAttribute('aria-hidden', 'true');
    heading.append(title, disclosure);

    const body = document.createElement('div');
    body.className = 'library-entry-body';
    const introduction = document.createElement('p');
    introduction.className = 'library-entry-summary';
    introduction.textContent = summary;
    body.append(introduction);

    const factList = document.createElement('dl');
    factList.className = 'library-entry-facts';
    facts.forEach(([label, value]) => appendLibraryFact(factList, label, value));
    body.append(factList);

    sections.forEach(([sectionTitle, copy]) => {
      const section = document.createElement('section');
      const subheading = document.createElement('h4');
      subheading.textContent = sectionTitle;
      const paragraph = document.createElement('p');
      paragraph.textContent = copy;
      section.append(subheading, paragraph);
      body.append(section);
    });

    details.append(heading, body);
    return details;
  }

  function renderLibrary() {
    const library = story.library || { characters: [], locations: [] };
    const characterFragment = document.createDocumentFragment();
    const locationFragment = document.createDocumentFragment();

    library.characters.forEach((entry, index) => {
      const character = entry.characterId ? characters[entry.characterId] : null;
      const name = entry.name || character?.name || entry.id;
      const accent = entry.accent || character?.accent || 'var(--accent)';
      characterFragment.append(createLibraryEntry({
        id: entry.id,
        name,
        subtitle: entry.epithet,
        image: entry.image || character?.portrait,
        imageAlt: entry.imageAlt || character?.portraitAlt,
        accent,
        summary: entry.summary,
        facts: [
          ['Role', entry.role || character?.role],
          ['Pronouns', entry.pronouns || character?.pronouns],
          ['Age', entry.ageLabel || (character?.age ? String(character.age) : 'Not recorded')],
          ['Home', entry.home],
        ],
        sections: [
          ['In the story', entry.journey],
          ['Remember', entry.keepsake],
        ],
        open: index === 0,
      }));
    });

    library.locations.forEach((entry) => {
      const mappedLocation = entry.mapId ? mapData.world.locations[entry.mapId] : null;
      const name = entry.name || mappedLocation?.name || entry.id;
      const region = entry.region || mappedLocation?.region || 'Asterra';
      const enteredVeyra = entry.id === 'veyra' && state.ending === 'open_sky';
      let visited = entry.knownOnly !== true;
      if (entry.mapId) visited = Boolean(state.ending) || state.visitedMaps.includes(entry.mapId);
      if (entry.id === 'veyra') visited = enteredVeyra;
      locationFragment.append(createLibraryEntry({
        id: entry.id,
        name,
        subtitle: region,
        image: entry.image,
        imageAlt: entry.imageAlt,
        accent: entry.id === 'veyra' ? characters.cael.accent : 'var(--accent)',
        summary: entry.summary,
        facts: [
          ['World', entry.id === 'veyra' ? 'Veyra' : 'Asterra'],
          ['Journey record', visited ? 'Visited in this completed journey' : 'Known through testimony and records'],
        ],
        sections: [
          ['Place in the story', entry.story],
          ['What remains', entry.memory],
        ],
      }));
    });

    dom.characterLibraryCount.textContent = String(library.characters.length);
    dom.characterLibraryCount.setAttribute('aria-label', `${library.characters.length} character entries`);
    dom.locationLibraryCount.textContent = String(library.locations.length);
    dom.locationLibraryCount.setAttribute('aria-label', `${library.locations.length} location entries`);
    dom.characterLibraryList.replaceChildren(characterFragment);
    dom.locationLibraryList.replaceChildren(locationFragment);
  }

  function openLibrary() {
    if (!state.ending || !story.endings[state.ending]) {
      announce('The journey archive unlocks after completing an ending.');
      return;
    }
    renderLibrary();
    showDialog(dom.libraryDialog);
  }

  function addTranscript(entry) {
    const duplicateKey = `${entry.sceneId}:${activeScene?.stepIndex ?? 'choice'}:${entry.type}`;
    const recent = state.transcript[state.transcript.length - 1];
    if (recent?.key === duplicateKey && recent.text === entry.text) return;
    state.transcript.push({
      ...entry,
      key: duplicateKey,
      timestamp: Date.now(),
    });
    if (state.transcript.length > MAX_TRANSCRIPT_ENTRIES) {
      state.transcript = state.transcript.slice(-MAX_TRANSCRIPT_ENTRIES);
    }
  }

  function renderTranscript() {
    dom.transcriptLocation.textContent = currentMap?.name || 'Asterra';
    dom.transcriptCount.textContent = `${state.transcript.length} ${state.transcript.length === 1 ? 'entry' : 'entries'}`;
    if (!state.transcript.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-transcript';
      empty.textContent = 'Spoken lines, narration, and choices will appear here.';
      dom.transcriptList.replaceChildren(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    state.transcript.forEach((entry) => {
      const item = document.createElement('li');
      item.className = 'transcript-entry';
      item.dataset.type = entry.type;
      const character = characters[entry.speakerId] || characters.system;
      item.style.setProperty('--entry-color', character.accent || 'var(--text-secondary)');
      const name = document.createElement('strong');
      name.textContent = entry.speakerName;
      const copy = document.createElement('span');
      copy.textContent = entry.text;
      item.append(name, copy);
      fragment.appendChild(item);
    });
    dom.transcriptList.replaceChildren(fragment);
    window.setTimeout(() => {
      dom.transcriptList.scrollTop = dom.transcriptList.scrollHeight;
    }, 20);
  }

  function openTranscript() {
    renderTranscript();
    showDialog(dom.transcriptDialog);
  }

  function openPause() {
    if (currentScreen !== 'game' || !dom.gameOverOverlay.hidden || !dom.endingOverlay.hidden) return;
    dom.pauseCheckpointName.textContent = state.checkpoint?.label || 'No checkpoint yet';
    dom.pauseRetryButton.disabled = !state.checkpoint;
    if (!dom.voiceAudio.paused) {
      pausedByVisibility = true;
      dom.voiceAudio.pause();
    }
    showDialog(dom.pauseDialog);
  }

  function showDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDialog(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === 'function' && dialog.open) dialog.close();
    else dialog.removeAttribute('open');
  }

  function closeAllDialogs() {
    [dom.pauseDialog, dom.settingsDialog, dom.helpDialog, dom.creditsDialog, dom.transcriptDialog, dom.worldMapDialog, dom.libraryDialog]
      .forEach(closeDialog);
  }

  function anyDialogOpen() {
    return [dom.pauseDialog, dom.settingsDialog, dom.helpDialog, dom.creditsDialog, dom.transcriptDialog, dom.worldMapDialog, dom.libraryDialog]
      .some((dialog) => Boolean(dialog?.open));
  }

  function openSettings() {
    syncSettingsControls();
    showDialog(dom.settingsDialog);
  }

  function syncSettingsControls() {
    dom.voiceMutedSetting.checked = settings.voiceMuted;
    dom.voiceVolumeSetting.value = String(Math.round(settings.voiceVolume * 100));
    dom.voiceVolumeOutput.textContent = `${Math.round(settings.voiceVolume * 100)}%`;
    dom.autoVoiceSetting.checked = settings.autoVoice;
    dom.textSpeedSetting.value = settings.textSpeed;
    dom.highContrastSetting.checked = settings.highContrast;
    dom.reducedMotionSetting.checked = settings.reducedMotion;
    dom.decorativeMotionSetting.checked = settings.decorativeMotion;
  }

  function readSettingsControls() {
    settings.voiceMuted = dom.voiceMutedSetting.checked;
    settings.voiceVolume = Number(dom.voiceVolumeSetting.value) / 100;
    settings.autoVoice = dom.autoVoiceSetting.checked;
    settings.textSpeed = dom.textSpeedSetting.value;
    settings.highContrast = dom.highContrastSetting.checked;
    settings.reducedMotion = dom.reducedMotionSetting.checked;
    settings.reducedMotionExplicit = true;
    settings.decorativeMotion = dom.decorativeMotionSetting.checked;
    applySettingsToUi();
    persistSettings();
    if (state.started) persistState();
  }

  function applySettingsToUi() {
    dom.shell.dataset.motion = settings.reducedMotion ? 'reduced' : 'full';
    dom.shell.dataset.decorative = settings.decorativeMotion ? 'on' : 'off';
    dom.shell.dataset.contrast = settings.highContrast ? 'high' : 'standard';
    audio?.applySettings?.();
    updateAudioButtons();
    syncSettingsControls();
  }

  function updateAudioButtons() {
    const pressed = String(settings.voiceMuted);
    [dom.titleAudioButton, dom.gameAudioButton].forEach((button) => {
      if (!button) return;
      button.setAttribute('aria-pressed', pressed);
      button.setAttribute('aria-label', settings.voiceMuted ? 'Unmute voice audio' : 'Mute voice audio');
    });
  }

  function toggleVoiceMute() {
    settings.voiceMuted = !settings.voiceMuted;
    applySettingsToUi();
    persistSettings();
    if (state.started) persistState();
    announce(settings.voiceMuted ? 'Voice muted. Captions remain on.' : 'Voice unmuted.');
  }

  function restartAdventure() {
    const confirmed = window.confirm('Restart the adventure from Birchwood? The current journey will be replaced.');
    if (!confirmed) return;
    storage.remove(SAVE_KEY);
    closeAllDialogs();
    dom.gameOverOverlay.hidden = true;
    dom.endingOverlay.hidden = true;
    beginNewGame({ skipConfirmation: true });
  }

  function saveAndReturnToTitle() {
    persistState('Progress saved.');
    showTitle();
  }

  function announce(message) {
    if (!message || !dom.saveStatus) return;
    dom.saveStatus.textContent = message;
    dom.saveStatus.classList.add('is-visible');
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      dom.saveStatus.classList.remove('is-visible');
      dom.saveStatus.textContent = '';
    }, 3600);
  }

  function resizeCanvas() {
    if (!ctx) return;
    const rect = dom.worldCanvas.getBoundingClientRect();
    canvasCssWidth = Math.max(1, Math.round(rect.width || window.innerWidth));
    canvasCssHeight = Math.max(1, Math.round(rect.height || window.innerHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    dom.worldCanvas.width = Math.round(canvasCssWidth * dpr);
    dom.worldCanvas.height = Math.round(canvasCssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderMap(true);
  }

  function gameLoop(timestamp) {
    const delta = Math.min(0.05, Math.max(0, (timestamp - lastFrameTime) / 1000));
    lastFrameTime = timestamp;
    animationTime += delta;
    const canMove = currentScreen === 'game'
      && dom.gameScreen.hidden === false
      && !activeScene
      && dom.travelOverlay.hidden
      && anyDialogOpen() === false
      && dom.gameOverOverlay.hidden
      && dom.endingOverlay.hidden
      && document.visibilityState !== 'hidden';

    playerMovedThisFrame = false;
    if (canMove) {
      updateMovement(delta);
      state.playTimeMs += delta * 1000;
      const items = getVisibleMapItems();
      updateInteractionPrompt(items);
      renderMap(false, items);
    }

    if (playerMovedThisFrame && timestamp - lastSaveMovementTime > 12000) {
      lastSaveMovementTime = timestamp;
      persistState();
    }
    requestAnimationFrame(gameLoop);
  }

  function updateMovement(delta) {
    let dx = 0;
    let dy = 0;
    if (movementKeys.has('left')) dx -= 1;
    if (movementKeys.has('right')) dx += 1;
    if (movementKeys.has('up')) dy -= 1;
    if (movementKeys.has('down')) dy += 1;
    if (!dx && !dy) return;

    const magnitude = Math.hypot(dx, dy);
    dx /= magnitude;
    dy /= magnitude;
    const speed = 3.25;
    const distance = speed * delta;
    const oldX = state.player.x;
    const oldY = state.player.y;

    if (Math.abs(dx) > Math.abs(dy)) state.player.facing = dx < 0 ? 'left' : 'right';
    else state.player.facing = dy < 0 ? 'up' : 'down';

    const nextX = state.player.x + dx * distance;
    const nextY = state.player.y + dy * distance;
    if (canOccupy(nextX, state.player.y)) state.player.x = nextX;
    if (canOccupy(state.player.x, nextY)) state.player.y = nextY;
    playerMovedThisFrame = Math.abs(state.player.x - oldX) > 0.0001 || Math.abs(state.player.y - oldY) > 0.0001;
  }

  function canOccupy(x, y) {
    const samples = [
      [x - PLAYER_RADIUS, y - PLAYER_RADIUS],
      [x + PLAYER_RADIUS, y - PLAYER_RADIUS],
      [x - PLAYER_RADIUS, y + PLAYER_RADIUS],
      [x + PLAYER_RADIUS, y + PLAYER_RADIUS],
    ];
    return samples.every(([sampleX, sampleY]) => {
      const tileX = Math.floor(sampleX);
      const tileY = Math.floor(sampleY);
      if (tileY < 0 || tileY >= currentMap.tiles.length || tileX < 0 || tileX >= currentMap.tiles[0].length) return false;
      const symbol = currentMap.tiles[tileY][tileX];
      return !mapData.legend[symbol]?.solid;
    });
  }

  function renderMap(forceCamera, items = getVisibleMapItems()) {
    if (!ctx || !currentMap || currentScreen !== 'game' || canvasCssWidth <= 1 || canvasCssHeight <= 1) return;
    const width = currentMap.tiles[0].length;
    const height = currentMap.tiles.length;
    const desiredColumns = canvasCssWidth < 680 ? 10 : 17;
    const tileSize = Math.max(30, canvasCssWidth / width, canvasCssHeight / height,
      Math.min(canvasCssWidth / desiredColumns, canvasCssHeight / 9.5));
    const worldWidth = width * tileSize;
    const worldHeight = height * tileSize;
    const maxCameraX = Math.max(0, worldWidth - canvasCssWidth);
    const maxCameraY = Math.max(0, worldHeight - canvasCssHeight);
    const targetX = clamp(state.player.x * tileSize - canvasCssWidth / 2, 0, maxCameraX);
    const targetY = clamp(state.player.y * tileSize - canvasCssHeight / 2, 0, maxCameraY);
    if (forceCamera || settings.reducedMotion) {
      camera.x = targetX;
      camera.y = targetY;
    } else {
      camera.x += (targetX - camera.x) * 0.11;
      camera.y += (targetY - camera.y) * 0.11;
    }

    const view = { ...camera, size: tileSize, width: canvasCssWidth, height: canvasCssHeight };
    const time = settings.decorativeMotion && !settings.reducedMotion ? animationTime : 0;
    drawExploration(ctx, currentMap, view, {
      player: state.player,
      items,
      completed: state.completedInteractions,
      nearest: nearestInteraction,
      time,
      walking: playerMovedThisFrame,
    });
  }

  function bindEvents() {
    dom.newGameButton.addEventListener('click', () => beginNewGame());
    dom.continueButton.addEventListener('click', continueGame);
    dom.settingsButton.addEventListener('click', openSettings);
    dom.helpButton.addEventListener('click', () => showDialog(dom.helpDialog));
    dom.creditsButton.addEventListener('click', () => showDialog(dom.creditsDialog));
    dom.titleAudioButton.addEventListener('click', toggleVoiceMute);
    dom.gameAudioButton.addEventListener('click', toggleVoiceMute);
    dom.gameMapButton.addEventListener('click', openWorldMap);
    dom.gameTranscriptButton.addEventListener('click', openTranscript);
    dom.sceneMapButton.addEventListener('click', openWorldMap);
    dom.sceneHistoryButton.addEventListener('click', openTranscript);
    dom.pauseButton.addEventListener('click', openPause);
    dom.scenePauseButton.addEventListener('click', openPause);
    dom.advanceButton.addEventListener('click', advanceScene);
    dom.replayVoiceButton.addEventListener('click', () => audio.replay());
    dom.travelReplayButton.addEventListener('click', () => audio.replay());
    dom.travelContinueButton.addEventListener('click', completeTravelTransition);
    dom.touchInteractButton.addEventListener('click', () => {
      audio.unlock();
      interact();
    });

    dom.retryCheckpointButton.addEventListener('click', retryCheckpoint);
    dom.gameOverTitleButton.addEventListener('click', showTitle);
    dom.gameOverRestartButton.addEventListener('click', restartAdventure);
    dom.endingLibraryButton.addEventListener('click', openLibrary);
    dom.endingTitleButton.addEventListener('click', showTitle);
    dom.endingTranscriptButton.addEventListener('click', openTranscript);
    dom.endingRestartButton.addEventListener('click', restartAdventure);
    dom.endingReplayButton?.addEventListener('click', () => audio.replay());

    dom.resumeButton.addEventListener('click', () => closeDialog(dom.pauseDialog));
    dom.saveNowButton.addEventListener('click', () => persistState('Progress saved locally.'));
    dom.pauseMapButton.addEventListener('click', () => {
      closeDialog(dom.pauseDialog);
      openWorldMap();
    });
    dom.pauseRetryButton.addEventListener('click', () => {
      closeDialog(dom.pauseDialog);
      retryCheckpoint();
    });
    dom.pauseSettingsButton.addEventListener('click', () => {
      closeDialog(dom.pauseDialog);
      openSettings();
    });
    dom.pauseHelpButton.addEventListener('click', () => {
      closeDialog(dom.pauseDialog);
      showDialog(dom.helpDialog);
    });
    dom.pauseTranscriptButton.addEventListener('click', () => {
      closeDialog(dom.pauseDialog);
      openTranscript();
    });
    dom.pauseTitleButton.addEventListener('click', () => {
      closeDialog(dom.pauseDialog);
      saveAndReturnToTitle();
    });

    [
      dom.voiceMutedSetting,
      dom.voiceVolumeSetting,
      dom.autoVoiceSetting,
      dom.textSpeedSetting,
      dom.highContrastSetting,
      dom.reducedMotionSetting,
      dom.decorativeMotionSetting,
    ].forEach((control) => {
      control.addEventListener('input', () => {
        dom.voiceVolumeOutput.textContent = `${dom.voiceVolumeSetting.value}%`;
        readSettingsControls();
      });
      control.addEventListener('change', readSettingsControls);
    });

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', () => movementKeys.clear());
    window.addEventListener('resize', resizeCanvas, { passive: true });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', () => {
      if (state.started) persistState();
    });

    document.querySelectorAll('[data-direction]').forEach((button) => {
      const direction = button.dataset.direction;
      const hold = (event) => {
        event.preventDefault();
        audio.unlock();
        movementKeys.add(direction);
        button.classList.add('is-held');
        try {
          button.setPointerCapture?.(event.pointerId);
        } catch (error) {
          // Some embedded browsers expose pointer capture without accepting synthetic IDs.
        }
      };
      const release = (event) => {
        event.preventDefault();
        movementKeys.delete(direction);
        button.classList.remove('is-held');
        try {
          button.releasePointerCapture?.(event.pointerId);
        } catch (error) {
          // Releasing an already-ended pointer is harmless.
        }
      };
      button.addEventListener('pointerdown', hold);
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('pointerleave', (event) => {
        if (event.buttons === 0) release(event);
      });
    });

    dom.sceneArt.addEventListener('error', () => {
      dom.sceneArt.hidden = true;
      dom.sceneArtFallback.hidden = false;
    });
    dom.endingImage.addEventListener('error', () => {
      dom.endingImage.hidden = true;
    });
    [dom.travelMapImage, dom.worldMapImage].forEach((image) => {
      image.addEventListener('error', () => {
        image.hidden = true;
        image.parentElement.dataset.imageFailed = 'true';
        announce('The painted world chart could not be loaded. Location labels and route information remain available.');
      });
    });

    motionPreference.addEventListener?.('change', (event) => {
      if (!settings.reducedMotionExplicit) {
        settings.reducedMotion = event.matches;
        settings.decorativeMotion = !event.matches;
        applySettingsToUi();
        persistSettings();
      }
    });
  }

  function handleKeyDown(event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    audio.unlock();
    if (anyDialogOpen()) {
      if (event.key === 'Escape') {
        const openDialog = [dom.libraryDialog, dom.worldMapDialog, dom.transcriptDialog, dom.settingsDialog, dom.helpDialog, dom.creditsDialog, dom.pauseDialog]
          .find((dialog) => dialog.open);
        closeDialog(openDialog);
      }
      return;
    }
    if (!dom.gameOverOverlay.hidden || !dom.endingOverlay.hidden) return;

    if (!dom.travelOverlay.hidden) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'e' || event.key === 'E') {
        event.preventDefault();
        completeTravelTransition();
        return;
      }
      if (event.key === 't' || event.key === 'T') {
        event.preventDefault();
        openTranscript();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        openPause();
      }
      return;
    }

    if (activeScene) {
      if (event.key === 'm' || event.key === 'M') {
        event.preventDefault();
        openWorldMap();
        return;
      }
      const currentStep = activeScene.scene.steps[activeScene.stepIndex];
      if (currentStep?.type === 'choice') {
        if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
          event.preventDefault();
          selectedChoiceIndex = (selectedChoiceIndex + 1) % activeScene.choiceOptions.length;
          updateChoiceFocus();
          dom.choiceList.querySelectorAll('.choice-button')[selectedChoiceIndex]?.focus({ preventScroll: true });
          return;
        }
        if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
          event.preventDefault();
          selectedChoiceIndex = (selectedChoiceIndex - 1 + activeScene.choiceOptions.length) % activeScene.choiceOptions.length;
          updateChoiceFocus();
          dom.choiceList.querySelectorAll('.choice-button')[selectedChoiceIndex]?.focus({ preventScroll: true });
          return;
        }
        if (/^[1-4]$/.test(event.key)) {
          const choiceIndex = Number(event.key) - 1;
          if (choiceIndex < activeScene.choiceOptions.length) {
            event.preventDefault();
            selectChoice(choiceIndex);
          }
          return;
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          selectChoice(selectedChoiceIndex);
          return;
        }
      }
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'e' || event.key === 'E') {
        event.preventDefault();
        advanceScene();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        openPause();
      }
      return;
    }

    const direction = directionKeyMap[event.key];
    if (direction && currentScreen === 'game') {
      event.preventDefault();
      movementKeys.add(direction);
      return;
    }
    if (currentScreen === 'game' && (event.key === 'Enter' || event.key === ' ' || event.key === 'e' || event.key === 'E')) {
      event.preventDefault();
      interact();
      return;
    }
    if (currentScreen === 'game' && (event.key === 't' || event.key === 'T')) {
      event.preventDefault();
      openTranscript();
      return;
    }
    if (currentScreen === 'game' && (event.key === 'm' || event.key === 'M')) {
      event.preventDefault();
      openWorldMap();
      return;
    }
    if (currentScreen === 'game' && event.key === 'Escape') {
      event.preventDefault();
      openPause();
    }
  }

  function handleKeyUp(event) {
    const direction = directionKeyMap[event.key];
    if (direction) movementKeys.delete(direction);
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') {
      movementKeys.clear();
      if (!dom.voiceAudio.paused) {
        pausedByVisibility = true;
        dom.voiceAudio.pause();
      }
      if (state.started) persistState();
    } else if (pausedByVisibility) {
      pausedByVisibility = false;
      announce('Voice paused while the page was hidden. Use Replay to hear the line again.');
    }
  }

  function formatPlayTime(milliseconds) {
    const totalMinutes = Math.max(0, Math.floor((Number(milliseconds) || 0) / 60000));
    if (totalMinutes < 1) return 'just begun';
    return `${totalMinutes} min`;
  }

  function deepClone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function clamp(value, minimum, maximum) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return minimum;
    return Math.min(maximum, Math.max(minimum, numeric));
  }

  function hash(x, y) {
    let value = Math.imul((x + 11) | 0, 374761393) ^ Math.imul((y + 17) | 0, 668265263);
    value = (value ^ (value >>> 13)) >>> 0;
    return value;
  }

  function hexToRgba(hex, alpha) {
    const value = String(hex).replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(value)) return `rgba(255, 194, 71, ${alpha})`;
    const red = parseInt(value.slice(0, 2), 16);
    const green = parseInt(value.slice(2, 4), 16);
    const blue = parseInt(value.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  window.GreatAdventureGame = Object.freeze({
    saveKey: SAVE_KEY,
    settingsKey: SETTINGS_KEY,
    saveVersion: SAVE_VERSION,
    getState: () => deepClone(state),
    evaluate,
    retryCheckpoint,
  });

  initialize();
})();
