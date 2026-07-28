'use strict';

(() => {
  const story = window.DEEP_OCEAN_STORY;
  const scenes = story?.scenes || [];
  if (!story || !scenes.length) return;

  const dom = {
    experience: document.getElementById('experience'),
    skipLink: document.getElementById('skipLink'),
    backControl: document.getElementById('backControl'),
    brandLockup: document.getElementById('brandLockup'),
    brandSubtitle: document.getElementById('brandSubtitle'),
    chapterChip: document.getElementById('chapterChip'),
    chapterChipText: document.getElementById('chapterChipText'),
    chapterDepthText: document.getElementById('chapterDepthText'),
    languageSwitcher: document.getElementById('languageSwitcher'),
    introOverlay: document.getElementById('introOverlay'),
    introOverline: document.getElementById('introOverline'),
    introKicker: document.getElementById('introKicker'),
    introLede: document.getElementById('introLede'),
    introLanguageLabel: document.getElementById('introLanguageLabel'),
    introStats: document.getElementById('introStats'),
    chapterStatLabel: document.getElementById('chapterStatLabel'),
    durationStatLabel: document.getElementById('durationStatLabel'),
    quizStatLabel: document.getElementById('quizStatLabel'),
    startButton: document.getElementById('startButton'),
    startButtonHint: document.getElementById('startButtonHint'),
    startButtonLabel: document.getElementById('startButtonLabel'),
    headphoneNote: document.getElementById('headphoneNote'),
    introCoordinatePrimary: document.getElementById('introCoordinatePrimary'),
    introCoordinateSecondary: document.getElementById('introCoordinateSecondary'),
    storyStage: document.getElementById('storyStage'),
    storyCard: document.getElementById('storyCard'),
    storyEyebrow: document.getElementById('storyEyebrow'),
    storyDepth: document.getElementById('storyDepth'),
    storyTitle: document.getElementById('storyTitle'),
    storyLede: document.getElementById('storyLede'),
    storyBody: document.getElementById('storyBody'),
    depthWord: document.getElementById('depthWord'),
    journeyNav: document.getElementById('journeyNav'),
    previousButton: document.getElementById('previousButton'),
    previousButtonLabel: document.getElementById('previousButtonLabel'),
    nextButton: document.getElementById('nextButton'),
    nextButtonLabel: document.getElementById('nextButtonLabel'),
    currentNumber: document.getElementById('currentNumber'),
    totalNumber: document.getElementById('totalNumber'),
    progressLabel: document.getElementById('progressLabel'),
    progressDots: document.getElementById('progressDots'),
    panelButton: document.getElementById('panelButton'),
    panelControlLabel: document.getElementById('panelControlLabel'),
    captionButton: document.getElementById('captionButton'),
    captionControlLabel: document.getElementById('captionControlLabel'),
    soundButton: document.getElementById('soundButton'),
    soundControlLabel: document.getElementById('soundControlLabel'),
    replayNarrationButton: document.getElementById('replayNarrationButton'),
    narrationStatus: document.getElementById('narrationStatus'),
    narrationLabel: document.getElementById('narrationLabel'),
    audioProgress: document.getElementById('audioProgress'),
    audioProgressTrack: document.getElementById('audioProgressTrack'),
    narrationAudio: document.getElementById('narrationAudio'),
    transcriptCard: document.getElementById('transcriptCard'),
    transcriptHeading: document.getElementById('transcriptHeading'),
    transcriptText: document.getElementById('transcriptText'),
    closeTranscriptButton: document.getElementById('closeTranscriptButton'),
    infoButton: document.getElementById('infoButton'),
    infoDialog: document.getElementById('infoDialog'),
    dialogCloseButton: document.getElementById('dialogCloseButton'),
    infoOverline: document.getElementById('infoOverline'),
    infoTitle: document.getElementById('infoTitle'),
    controlsHeading: document.getElementById('controlsHeading'),
    controlsCopyOne: document.getElementById('controlsCopyOne'),
    controlsCopyTwo: document.getElementById('controlsCopyTwo'),
    controlsCopyThree: document.getElementById('controlsCopyThree'),
    mediaHeading: document.getElementById('mediaHeading'),
    mediaCopyOne: document.getElementById('mediaCopyOne'),
    mediaCopyTwo: document.getElementById('mediaCopyTwo'),
    mediaCopyThree: document.getElementById('mediaCopyThree'),
    sourcesHeading: document.getElementById('sourcesHeading'),
    sourcesIntro: document.getElementById('sourcesIntro'),
    sourceList: document.getElementById('sourceList'),
    statusAnnouncer: document.getElementById('statusAnnouncer'),
    depthMarker: document.getElementById('depthMarker'),
    sceneImages: [
      document.getElementById('sceneImageA'),
      document.getElementById('sceneImageB'),
    ],
    canvas: document.getElementById('atmosphereCanvas'),
  };

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const savedLanguage = safeStorageGet('deepOceanLanguage');
  const browserLanguage = String(navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
  const savedSound = safeStorageGet('deepOceanSound');
  const savedPanel = safeStorageGet('deepOceanPanel');

  const state = {
    started: false,
    index: 0,
    language: ['en', 'ja'].includes(savedLanguage) ? savedLanguage : browserLanguage,
    sound: savedSound !== 'off',
    panelPreferred: savedPanel !== 'hidden',
    panelVisible: true,
    captions: false,
    reducedMotion: motionPreference.matches,
    visibleImage: 0,
    imageToken: 0,
    transcriptToken: 0,
    transcriptCache: new Map(),
    answers: new Map(),
    dialogWasPlaying: false,
    visibilityWasPlaying: false,
    artworkWarmed: false,
  };

  function safeStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      // Storage can be unavailable in private, sandboxed, or embedded contexts.
    }
  }

  function ui() {
    return story.ui[state.language];
  }

  function sceneCopy(scene = scenes[state.index]) {
    return scene.copy[state.language];
  }

  function interpolate(template, values = {}) {
    return String(template).replace(/\{(\w+)\}/g, (match, key) => (
      Object.prototype.hasOwnProperty.call(values, key) ? values[key] : match
    ));
  }

  function announce(message) {
    dom.statusAnnouncer.textContent = '';
    window.requestAnimationFrame(() => {
      dom.statusAnnouncer.textContent = message;
    });
  }

  function setNarrationState(status, label) {
    dom.narrationStatus.dataset.state = status;
    dom.narrationLabel.textContent = label;
  }

  function setAudioProgress(value) {
    const progress = Math.max(0, Math.min(100, Number(value) || 0));
    dom.audioProgress.style.width = `${progress}%`;
    dom.audioProgressTrack.setAttribute('aria-valuenow', String(Math.round(progress)));
  }

  class TonePlayer {
    constructor() {
      this.context = null;
    }

    unlock() {
      if (!this.context) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        this.context = new AudioContextClass();
      }
      if (this.context.state === 'suspended') {
        this.context.resume().catch(() => {});
      }
    }

    play(kind) {
      if (!state.sound || !this.context) return;
      const now = this.context.currentTime;
      const patterns = {
        correct: [523.25, 659.25, 783.99],
        discover: [293.66, 392],
        navigate: [196, 261.63],
      };
      const notes = patterns[kind] || patterns.navigate;
      notes.forEach((frequency, index) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = index === 0 ? 'sine' : 'triangle';
        oscillator.frequency.value = frequency;
        const offset = index * 0.07;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(kind === 'correct' ? 0.028 : 0.014, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.26);
        oscillator.connect(gain);
        gain.connect(this.context.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.28);
      });
    }
  }

  class NarrationController {
    constructor(audio) {
      this.audio = audio;
      this.playToken = 0;
      this.activeScene = null;
      this.bindEvents();
    }

    bindEvents() {
      this.audio.addEventListener('playing', () => {
        setNarrationState('playing', ui().narrationPlaying);
      });

      this.audio.addEventListener('pause', () => {
        if (!this.audio.ended && this.audio.currentTime > 0 && this.audio.src) {
          setNarrationState('paused', ui().narrationPaused);
        }
      });

      this.audio.addEventListener('ended', () => {
        setAudioProgress(100);
        setNarrationState('complete', ui().narrationComplete);
      });

      this.audio.addEventListener('timeupdate', () => {
        if (!Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
        setAudioProgress(this.audio.currentTime / this.audio.duration * 100);
      });

      this.audio.addEventListener('error', () => {
        if (!this.audio.src) return;
        setNarrationState('error', ui().narrationError);
      });
    }

    play(scene, restart = false) {
      this.stop(false);
      this.activeScene = scene;
      if (!state.sound) {
        setNarrationState('muted', ui().narrationMuted);
        return;
      }

      const token = ++this.playToken;
      setAudioProgress(0);
      setNarrationState('loading', ui().narrationLoading);
      this.audio.src = `assets/audio/${state.language}/${scene.audio}.mp3`;
      this.audio.currentTime = 0;
      this.audio.preload = 'auto';
      const playPromise = this.audio.play();
      if (playPromise) {
        playPromise.catch(() => {
          if (token !== this.playToken) return;
          setNarrationState('ready', restart ? ui().narrationPlayPrompt : ui().narrationReady);
        });
      }
    }

    stop(resetState = true) {
      this.playToken += 1;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      setAudioProgress(0);
      if (resetState) {
        setNarrationState('ready', state.sound ? ui().narrationReady : ui().narrationMuted);
      }
    }

    pause() {
      if (!this.audio.paused) this.audio.pause();
    }

    resume() {
      if (!state.sound || !this.audio.src || this.audio.ended) return;
      this.audio.play().catch(() => setNarrationState('ready', ui().narrationPlayPrompt));
    }

    isPlaying() {
      return !this.audio.paused && !this.audio.ended && Boolean(this.audio.src);
    }
  }

  class DeepCurrent {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas?.getContext('2d') || null;
      this.motes = [];
      this.frame = 0;
      this.lastTime = 0;
      this.tone = 'shore';
      this.running = false;
      this.resize = this.resize.bind(this);
      this.animate = this.animate.bind(this);
    }

    start() {
      if (!this.context || state.reducedMotion || this.running) return;
      this.running = true;
      this.resize();
      window.addEventListener('resize', this.resize, { passive: true });
      this.frame = window.requestAnimationFrame(this.animate);
    }

    stop() {
      this.running = false;
      window.cancelAnimationFrame(this.frame);
      window.removeEventListener('resize', this.resize);
      if (this.context) {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }

    setTone(tone) {
      this.tone = tone;
    }

    resize() {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      this.canvas.width = Math.floor(window.innerWidth * ratio);
      this.canvas.height = Math.floor(window.innerHeight * ratio);
      this.canvas.style.width = `${window.innerWidth}px`;
      this.canvas.style.height = `${window.innerHeight}px`;
      const count = window.innerWidth < 760 ? 18 : 34;
      this.motes = Array.from({ length: count }, () => ({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        radius: (0.35 + Math.random() * 1.1) * ratio,
        speed: (0.035 + Math.random() * 0.09) * ratio,
        drift: (Math.random() - 0.5) * 0.065 * ratio,
        alpha: 0.06 + Math.random() * 0.16,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    animate(time) {
      if (!this.running) return;
      if (time - this.lastTime < 34) {
        this.frame = window.requestAnimationFrame(this.animate);
        return;
      }
      this.lastTime = time;
      const palettes = {
        shore: '255, 194, 71',
        sunlit: '25, 227, 227',
        twilight: '85, 204, 255',
        midnight: '102, 173, 255',
        vent: '255, 106, 31',
        abyss: '203, 193, 235',
        hadal: '163, 210, 235',
        trench: '255, 194, 71',
        surface: '255, 194, 71',
      };
      const color = palettes[this.tone] || palettes.twilight;
      const rises = this.tone === 'shore' || this.tone === 'sunlit';
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.motes.forEach((mote) => {
        mote.y += rises ? -mote.speed : mote.speed;
        mote.x += mote.drift + Math.sin(time * 0.00028 + mote.phase) * 0.022;
        if (mote.y < -5) mote.y = this.canvas.height + 5;
        if (mote.y > this.canvas.height + 5) mote.y = -5;
        if (mote.x < -5) mote.x = this.canvas.width + 5;
        if (mote.x > this.canvas.width + 5) mote.x = -5;
        this.context.beginPath();
        this.context.fillStyle = `rgba(${color}, ${mote.alpha})`;
        this.context.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
        this.context.fill();
      });
      this.frame = window.requestAnimationFrame(this.animate);
    }
  }

  const tones = new TonePlayer();
  const narrator = new NarrationController(dom.narrationAudio);
  const current = new DeepCurrent(dom.canvas);

  function syncLanguageButtons() {
    document.querySelectorAll('[data-language]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.language === state.language));
    });
    dom.languageSwitcher.setAttribute('aria-label', ui().languageLabel);
  }

  function renderSources() {
    const fragment = document.createDocumentFragment();
    story.sources.forEach((source) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.title[state.language];
      item.append(link);
      fragment.append(item);
    });
    dom.sourceList.replaceChildren(fragment);
  }

  function updateProgressAria() {
    const languageUi = ui();
    const dots = [...dom.progressDots.querySelectorAll('.progress-dot')];
    dots.forEach((dot, index) => {
      dot.setAttribute('aria-label', interpolate(languageUi.progressSceneAria, {
        number: index + 1,
        title: sceneCopy(scenes[index]).title,
      }));
    });
    dom.progressDots.setAttribute('aria-label', interpolate(languageUi.scenesLabel, {
      count: scenes.length,
    }));
  }

  function localizeStaticUi() {
    const languageUi = ui();
    document.documentElement.lang = languageUi.documentLanguage;
    dom.experience.dataset.language = state.language;
    document.title = state.started
      ? `${sceneCopy().title} · ${languageUi.pageTitle}`
      : languageUi.pageTitle;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = languageUi.metaDescription;

    dom.skipLink.textContent = languageUi.skipLink;
    dom.backControl.setAttribute('aria-label', languageUi.backToGames);
    dom.brandLockup.setAttribute('aria-label', languageUi.brandLabel);
    dom.brandSubtitle.textContent = languageUi.brandSubtitle;
    dom.infoButton.setAttribute('aria-label', languageUi.infoOpen);
    dom.panelControlLabel.textContent = languageUi.panelControl;
    dom.captionControlLabel.textContent = languageUi.captionsControl;
    dom.soundControlLabel.textContent = languageUi.soundControl;
    dom.storyStage.setAttribute('aria-label', languageUi.storyStageLabel);
    dom.journeyNav.setAttribute('aria-label', languageUi.navigationLabel);

    dom.introOverline.textContent = languageUi.introOverline;
    dom.introKicker.textContent = languageUi.introKicker;
    dom.introLede.textContent = languageUi.introLede;
    dom.introLanguageLabel.textContent = languageUi.introLanguageLabel;
    dom.introStats.setAttribute('aria-label', languageUi.introStatsLabel);
    dom.chapterStatLabel.textContent = languageUi.chapterStatLabel;
    dom.durationStatLabel.textContent = languageUi.durationStatLabel;
    dom.quizStatLabel.textContent = languageUi.quizStatLabel;
    dom.startButtonHint.textContent = languageUi.startHint;
    dom.startButtonLabel.textContent = languageUi.startLabel;
    dom.headphoneNote.lastChild.textContent = ` ${languageUi.headphoneNote}`;
    dom.introCoordinatePrimary.textContent = languageUi.introCoordinatePrimary;
    dom.introCoordinateSecondary.textContent = languageUi.introCoordinateSecondary;
    const englishVoice = document.querySelector('.intro-language-options [data-language="en"] small');
    const japaneseVoice = document.querySelector('.intro-language-options [data-language="ja"] small');
    if (englishVoice) englishVoice.textContent = languageUi.introEnglishVoice;
    if (japaneseVoice) japaneseVoice.textContent = languageUi.introJapaneseVoice;

    dom.previousButtonLabel.textContent = languageUi.previous;
    dom.previousButton.setAttribute('aria-label', languageUi.previousAria);
    dom.replayNarrationButton.setAttribute('aria-label', languageUi.narrationReplay);
    dom.audioProgressTrack.setAttribute('aria-label', languageUi.narrationProgress);
    dom.transcriptHeading.textContent = languageUi.transcriptHeading;
    dom.transcriptCard.setAttribute('aria-label', languageUi.transcriptAria);
    dom.closeTranscriptButton.setAttribute('aria-label', languageUi.transcriptClose);

    dom.infoOverline.textContent = languageUi.infoOverline;
    dom.infoTitle.textContent = languageUi.infoTitle;
    dom.dialogCloseButton.setAttribute('aria-label', languageUi.infoClose);
    dom.controlsHeading.textContent = languageUi.controlsHeading;
    dom.controlsCopyOne.textContent = languageUi.controlsCopyOne;
    dom.controlsCopyTwo.textContent = languageUi.controlsCopyTwo;
    dom.controlsCopyThree.textContent = languageUi.controlsCopyThree;
    dom.mediaHeading.textContent = languageUi.mediaHeading;
    dom.mediaCopyOne.textContent = languageUi.mediaCopyOne;
    dom.mediaCopyTwo.textContent = languageUi.mediaCopyTwo;
    dom.mediaCopyThree.textContent = languageUi.mediaCopyThree;
    dom.sourcesHeading.textContent = languageUi.sourcesHeading;
    dom.sourcesIntro.textContent = languageUi.sourcesIntro;

    syncLanguageButtons();
    renderSources();
    updateProgressAria();
    syncSoundControl();
    syncCaptionControl();
    if (state.started) syncPanelForScene(scenes[state.index]);
    else setNarrationState('ready', state.sound ? languageUi.narrationReady : languageUi.narrationMuted);
  }

  function buildProgress() {
    const fragment = document.createDocumentFragment();
    scenes.forEach((scene, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const ring = document.createElement('i');
      button.className = `progress-dot is-${scene.kind}`;
      button.type = 'button';
      button.dataset.index = String(index);
      button.append(ring);
      button.addEventListener('click', () => {
        tones.unlock();
        setScene(index, { narrate: true, focus: true });
      });
      item.append(button);
      fragment.append(item);
    });
    dom.progressDots.append(fragment);
    dom.totalNumber.textContent = String(scenes.length).padStart(2, '0');
    updateProgressAria();
  }

  function warmArtwork() {
    if (state.artworkWarmed) return;
    state.artworkWarmed = true;
    const opening = scenes[0].image;
    const sources = [...new Set(scenes.map((scene) => scene.image))]
      .filter((source) => source !== opening);
    const load = () => {
      sources.forEach((source, index) => {
        window.setTimeout(() => {
          const image = new Image();
          image.decoding = 'async';
          image.src = source;
        }, index * 180);
      });
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(load, { timeout: 1800 });
    } else {
      window.setTimeout(load, 500);
    }
  }

  function setBackground(scene, immediate = false) {
    dom.experience.style.setProperty('--scene-position-desktop', scene.focal.desktop);
    dom.experience.style.setProperty('--scene-position-mobile', scene.focal.mobile);
    const token = ++state.imageToken;
    const currentImage = dom.sceneImages[state.visibleImage];
    const nextIndex = state.visibleImage === 0 ? 1 : 0;
    const nextImage = dom.sceneImages[nextIndex];

    if (currentImage.getAttribute('src') === scene.image && !immediate) return;
    nextImage.src = scene.image;
    const reveal = () => {
      if (token !== state.imageToken) return;
      nextImage.classList.add('is-visible');
      currentImage.classList.remove('is-visible');
      state.visibleImage = nextIndex;
    };

    if (immediate || nextImage.complete) {
      window.requestAnimationFrame(reveal);
    } else {
      nextImage.addEventListener('load', reveal, { once: true });
      nextImage.addEventListener('error', reveal, { once: true });
    }
  }

  function createFactGrid(facts) {
    const grid = document.createElement('div');
    grid.className = 'fact-grid';
    facts.forEach((fact) => {
      const item = document.createElement('div');
      const value = document.createElement('strong');
      const label = document.createElement('b');
      const caption = document.createElement('small');
      item.className = 'fact-item';
      value.textContent = fact.value;
      label.textContent = fact.label;
      caption.textContent = fact.caption;
      item.append(value, label, caption);
      grid.append(item);
    });
    return grid;
  }

  function createNote(text) {
    const note = document.createElement('p');
    note.className = 'story-note';
    note.textContent = text;
    return note;
  }

  function renderQuiz(scene, copy) {
    const languageUi = ui();
    const wrap = document.createElement('div');
    const question = document.createElement('p');
    const options = document.createElement('div');
    const answered = state.answers.get(scene.id);
    wrap.className = 'quiz-wrap';
    question.className = 'quiz-question';
    question.textContent = copy.question;
    options.className = 'quiz-options';
    options.setAttribute('role', 'group');
    options.setAttribute('aria-label', interpolate(languageUi.quizGroup, {
      question: copy.question,
    }));

    copy.options.forEach((label, index) => {
      const option = document.createElement('button');
      const key = document.createElement('span');
      const text = document.createElement('span');
      option.className = 'quiz-option';
      option.type = 'button';
      option.dataset.key = String(index + 1);
      key.className = 'quiz-key';
      key.textContent = String(index + 1);
      text.textContent = label;
      option.setAttribute('aria-label', interpolate(languageUi.quizOption, {
        number: index + 1,
        label,
      }));
      option.append(key, text);

      if (answered) {
        option.disabled = true;
        option.classList.toggle('is-correct', index === scene.answer);
        option.classList.toggle('is-selected', index === answered.selection);
        option.classList.toggle('is-dimmed', index !== scene.answer && index !== answered.selection);
      } else {
        option.addEventListener('click', () => answerQuiz(scene, index));
      }
      options.append(option);
    });

    wrap.append(question, options);
    if (answered) {
      const feedback = document.createElement('p');
      const lead = document.createElement('strong');
      feedback.className = 'quiz-feedback';
      lead.textContent = answered.correct
        ? languageUi.quizCorrectLead
        : languageUi.quizDiscoverLead;
      feedback.append(lead, document.createTextNode(copy.explanation));
      wrap.append(feedback);
    }
    return wrap;
  }

  function createFinaleScore() {
    const languageUi = ui();
    const panel = document.createElement('div');
    const copy = document.createElement('span');
    const label = document.createElement('small');
    const title = document.createElement('strong');
    const score = document.createElement('b');
    const replay = document.createElement('button');
    panel.className = 'finale-score';
    label.textContent = languageUi.finaleVisitedLabel;
    title.textContent = state.answers.size === story.meta.quizzes
      ? languageUi.finaleComplete
      : languageUi.finaleIncomplete;
    score.textContent = `${state.answers.size} / ${story.meta.quizzes}`;
    replay.className = 'replay-journey';
    replay.type = 'button';
    replay.textContent = languageUi.restart;
    replay.addEventListener('click', restartJourney);
    copy.append(label, title);
    panel.append(copy, score, replay);
    return panel;
  }

  function renderStoryBody(scene, copy) {
    dom.storyBody.replaceChildren();
    if (scene.kind === 'quiz') {
      dom.storyBody.append(renderQuiz(scene, copy));
      return;
    }
    dom.storyBody.append(createFactGrid(copy.facts));
    if (copy.note) dom.storyBody.append(createNote(copy.note));
    if (scene.kind === 'finale') dom.storyBody.append(createFinaleScore());
  }

  function renderTerm(term) {
    const label = document.createElement('small');
    const name = document.createElement('strong');
    const meaning = document.createElement('em');
    label.textContent = ui().depthWord;
    name.textContent = term.name;
    meaning.textContent = `${term.pronunciation[state.language]} · ${term.meaning[state.language]}`;
    dom.depthWord.replaceChildren(label, name, meaning);
  }

  function updateDepth(scene) {
    const position = Math.max(0, Math.min(100, scene.depth / story.meta.maximumDepth * 100));
    dom.depthMarker.style.top = `${position}%`;
  }

  function updateProgress(scene, copy) {
    dom.currentNumber.textContent = String(state.index + 1).padStart(2, '0');
    dom.progressLabel.textContent = copy.progress;
    dom.chapterChipText.textContent = copy.progress;
    dom.chapterDepthText.textContent = copy.depthLabel;
    [...dom.progressDots.querySelectorAll('.progress-dot')].forEach((dot, index) => {
      dot.classList.toggle('is-current', index === state.index);
      dot.classList.toggle('is-visited', index < state.index || state.answers.has(scenes[index].id));
      dot.classList.toggle('is-answered', state.answers.has(scenes[index].id));
      if (index === state.index) dot.setAttribute('aria-current', 'step');
      else dot.removeAttribute('aria-current');
    });
    updateDepth(scene);
  }

  function updateNavigation(scene) {
    const languageUi = ui();
    const unansweredQuiz = scene.kind === 'quiz' && !state.answers.has(scene.id);
    dom.previousButton.disabled = state.index === 0;
    dom.nextButton.disabled = unansweredQuiz;
    if (scene.kind === 'finale') {
      dom.nextButtonLabel.textContent = languageUi.returnToSurface;
      dom.nextButton.setAttribute('aria-label', languageUi.returnToSurfaceAria);
    } else if (unansweredQuiz) {
      dom.nextButtonLabel.textContent = languageUi.answerToContinue;
      dom.nextButton.setAttribute('aria-label', languageUi.answerToContinueAria);
    } else {
      dom.nextButtonLabel.textContent = languageUi.next;
      dom.nextButton.setAttribute('aria-label', languageUi.nextAria);
    }
  }

  function syncPanelForScene(scene, shouldAnnounce = false) {
    const languageUi = ui();
    const quizForcesPanel = scene.kind === 'quiz';
    const visible = quizForcesPanel || state.panelPreferred;
    const changed = visible !== state.panelVisible;
    state.panelVisible = visible;
    dom.experience.dataset.panel = visible ? 'visible' : 'hidden';
    dom.storyCard.setAttribute('aria-hidden', String(!visible));
    dom.storyCard.inert = !visible;
    dom.panelButton.disabled = quizForcesPanel;
    dom.panelButton.setAttribute('aria-pressed', String(visible));

    const label = quizForcesPanel
      ? languageUi.panelQuizLocked
      : visible ? languageUi.panelHide : languageUi.panelShow;
    dom.panelButton.setAttribute('aria-label', label);
    dom.panelButton.title = label;

    if (shouldAnnounce && changed) {
      announce(visible
        ? languageUi.panelShownAnnouncement
        : languageUi.panelHiddenAnnouncement);
    }
  }

  function togglePanel() {
    const scene = scenes[state.index];
    if (scene.kind === 'quiz') return;
    state.panelPreferred = !state.panelPreferred;
    safeStorageSet('deepOceanPanel', state.panelPreferred ? 'visible' : 'hidden');
    syncPanelForScene(scene, true);
  }

  function syncCaptionControl() {
    const languageUi = ui();
    dom.captionButton.setAttribute('aria-pressed', String(state.captions));
    dom.captionButton.setAttribute('aria-expanded', String(state.captions));
    dom.captionButton.setAttribute('aria-label', state.captions
      ? languageUi.captionsHide
      : languageUi.captionsShow);
  }

  function setCaptions(visible, shouldAnnounce = true) {
    state.captions = Boolean(visible);
    dom.transcriptCard.hidden = !state.captions;
    syncCaptionControl();
    if (shouldAnnounce) {
      announce(state.captions
        ? ui().captionsShownAnnouncement
        : ui().captionsHiddenAnnouncement);
    }
  }

  function syncSoundControl() {
    const languageUi = ui();
    dom.soundButton.setAttribute('aria-pressed', String(state.sound));
    dom.soundButton.setAttribute('aria-label', state.sound
      ? languageUi.soundOff
      : languageUi.soundOn);
  }

  function toggleSound() {
    state.sound = !state.sound;
    safeStorageSet('deepOceanSound', state.sound ? 'on' : 'off');
    syncSoundControl();
    if (state.sound) {
      tones.unlock();
      narrator.play(scenes[state.index]);
      announce(ui().soundOnAnnouncement);
    } else {
      narrator.stop(false);
      setNarrationState('muted', ui().narrationMuted);
      announce(ui().soundOffAnnouncement);
    }
  }

  function fetchTranscript(scene) {
    const languageUi = ui();
    const language = state.language;
    const cacheKey = `${language}:${scene.audio}`;
    const token = ++state.transcriptToken;
    dom.transcriptText.textContent = languageUi.transcriptLoading;
    if (state.transcriptCache.has(cacheKey)) {
      dom.transcriptText.textContent = state.transcriptCache.get(cacheKey);
      return;
    }

    fetch(`assets/audio/${language}/${scene.audio}.txt`, { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`Transcript returned ${response.status}`);
        return response.text();
      })
      .then((text) => {
        const transcript = text.trim();
        if (!transcript) throw new Error('Transcript was empty');
        state.transcriptCache.set(cacheKey, transcript);
        if (token === state.transcriptToken && language === state.language) {
          dom.transcriptText.textContent = transcript;
        }
      })
      .catch(() => {
        if (token === state.transcriptToken && language === state.language) {
          dom.transcriptText.textContent = languageUi.transcriptError;
        }
      });
  }

  function setScene(index, options = {}) {
    if (!state.started) return;
    const nextIndex = Math.max(0, Math.min(scenes.length - 1, index));
    const scene = scenes[nextIndex];
    const copy = sceneCopy(scene);
    const changed = nextIndex !== state.index;

    narrator.stop(false);
    state.index = nextIndex;
    dom.storyCard.classList.remove('is-visible');
    dom.experience.dataset.tone = scene.tone;
    dom.experience.dataset.layout = scene.layout;
    current.setTone(scene.tone);
    setBackground(scene, options.immediate || (!changed && nextIndex === 0));

    dom.storyEyebrow.textContent = copy.eyebrow;
    dom.storyDepth.textContent = copy.depthLabel;
    dom.storyTitle.textContent = copy.title;
    dom.storyLede.textContent = copy.lede;
    renderStoryBody(scene, copy);
    renderTerm(scene.term);
    updateProgress(scene, copy);
    updateNavigation(scene);
    syncPanelForScene(scene);
    fetchTranscript(scene);
    document.title = `${copy.title} · ${ui().pageTitle}`;
    dom.storyCard.scrollTop = 0;

    if (options.announce !== false) {
      announce(interpolate(ui().sceneAnnouncement, {
        number: state.index + 1,
        count: scenes.length,
        title: copy.title,
      }));
    }

    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      dom.storyCard.classList.add('is-visible');
      if (options.focus) {
        const focusTarget = state.panelVisible ? dom.storyCard : dom.nextButton;
        focusTarget.focus({ preventScroll: true });
      }
    }));

    if (options.narrate !== false) narrator.play(scene);
  }

  function answerQuiz(scene, selection) {
    if (state.answers.has(scene.id)) return;
    const copy = sceneCopy(scene);
    const correct = selection === scene.answer;
    state.answers.set(scene.id, { selection, correct });
    renderStoryBody(scene, copy);
    updateNavigation(scene);
    updateProgress(scene, copy);
    tones.play(correct ? 'correct' : 'discover');
    announce(interpolate(
      correct ? ui().quizCorrectAnnouncement : ui().quizDiscoverAnnouncement,
      { explanation: copy.explanation },
    ));
    const feedback = dom.storyBody.querySelector('.quiz-feedback');
    if (feedback) {
      feedback.tabIndex = -1;
      window.requestAnimationFrame(() => {
        feedback.scrollIntoView({
          behavior: state.reducedMotion ? 'auto' : 'smooth',
          block: 'nearest',
        });
        feedback.focus({ preventScroll: true });
      });
    }
  }

  function setLanguage(language, options = {}) {
    if (!['en', 'ja'].includes(language)) return;
    const changed = language !== state.language;
    state.language = language;
    safeStorageSet('deepOceanLanguage', language);
    localizeStaticUi();

    if (state.started) {
      setScene(state.index, {
        narrate: state.sound,
        focus: false,
        immediate: true,
        announce: false,
      });
    }

    if (changed && options.announce !== false) {
      announce(ui().languageChanged);
    }
  }

  function startExperience() {
    if (state.started) return;
    state.started = true;
    tones.unlock();
    warmArtwork();
    dom.experience.dataset.phase = 'story';
    dom.storyStage.hidden = false;
    dom.chapterChip.hidden = false;
    dom.panelButton.hidden = false;
    dom.captionButton.hidden = false;
    dom.soundButton.hidden = false;
    syncSoundControl();
    syncCaptionControl();
    dom.introOverlay.classList.add('is-leaving');
    current.start();
    setScene(0, { narrate: true, focus: true, immediate: true });
    window.setTimeout(() => {
      dom.introOverlay.hidden = true;
    }, state.reducedMotion ? 30 : 760);
  }

  function restartJourney() {
    state.answers.clear();
    tones.unlock();
    tones.play('navigate');
    setScene(0, { narrate: true, focus: true });
  }

  function goNext() {
    const scene = scenes[state.index];
    if (scene.kind === 'quiz' && !state.answers.has(scene.id)) return;
    tones.unlock();
    tones.play('navigate');
    if (state.index === scenes.length - 1) restartJourney();
    else setScene(state.index + 1, { narrate: true, focus: true });
  }

  function goPrevious() {
    if (state.index <= 0) return;
    tones.unlock();
    tones.play('navigate');
    setScene(state.index - 1, { narrate: true, focus: true });
  }

  function openInfo() {
    state.dialogWasPlaying = narrator.isPlaying();
    narrator.pause();
    if (typeof dom.infoDialog.showModal === 'function') {
      dom.infoDialog.showModal();
    } else {
      dom.infoDialog.setAttribute('open', '');
    }
  }

  function chooseQuizByKeyboard(key) {
    const scene = scenes[state.index];
    if (scene.kind !== 'quiz' || state.answers.has(scene.id)) return false;
    const selection = Number(key) - 1;
    if (selection < 0 || selection >= sceneCopy(scene).options.length) return false;
    answerQuiz(scene, selection);
    return true;
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (dom.infoDialog.open) return;
    const key = event.key.toLowerCase();
    const interactive = event.target.closest('button, a, input, select, textarea, [contenteditable="true"]');
    const globalShortcuts = ['r', 'c', 'm', 'p', 'l'];
    if (interactive && !globalShortcuts.includes(key)) return;

    if (!state.started && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      startExperience();
      return;
    }
    if (!state.started) return;

    if (chooseQuizByKeyboard(event.key)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      goNext();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      goPrevious();
    } else if (key === 'r') {
      event.preventDefault();
      tones.unlock();
      if (!state.sound) toggleSound();
      else narrator.play(scenes[state.index], true);
    } else if (key === 'c') {
      event.preventDefault();
      setCaptions(!state.captions);
    } else if (key === 'm') {
      event.preventDefault();
      toggleSound();
    } else if (key === 'p') {
      event.preventDefault();
      togglePanel();
    } else if (key === 'l') {
      event.preventDefault();
      setLanguage(state.language === 'en' ? 'ja' : 'en');
    } else if (event.key === 'Escape' && state.captions) {
      event.preventDefault();
      setCaptions(false);
    }
  }

  document.querySelectorAll('[data-language]').forEach((button) => {
    button.addEventListener('click', () => setLanguage(button.dataset.language));
  });
  dom.startButton.addEventListener('click', startExperience);
  dom.previousButton.addEventListener('click', goPrevious);
  dom.nextButton.addEventListener('click', goNext);
  dom.panelButton.addEventListener('click', togglePanel);
  dom.captionButton.addEventListener('click', () => setCaptions(!state.captions));
  dom.soundButton.addEventListener('click', toggleSound);
  dom.replayNarrationButton.addEventListener('click', () => {
    tones.unlock();
    if (!state.sound) toggleSound();
    else narrator.play(scenes[state.index], true);
  });
  dom.closeTranscriptButton.addEventListener('click', () => {
    setCaptions(false);
    dom.captionButton.focus({ preventScroll: true });
  });
  dom.infoButton.addEventListener('click', openInfo);
  dom.infoDialog.addEventListener('close', () => {
    if (state.dialogWasPlaying) narrator.resume();
    state.dialogWasPlaying = false;
  });
  dom.infoDialog.addEventListener('click', (event) => {
    if (event.target === dom.infoDialog) dom.infoDialog.close();
  });
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      state.visibilityWasPlaying = narrator.isPlaying();
      narrator.pause();
    } else if (state.visibilityWasPlaying) {
      narrator.resume();
      state.visibilityWasPlaying = false;
    }
  });

  const handleMotionChange = (event) => {
    state.reducedMotion = event.matches;
    if (state.reducedMotion) current.stop();
    else if (state.started) current.start();
  };
  if (typeof motionPreference.addEventListener === 'function') {
    motionPreference.addEventListener('change', handleMotionChange);
  } else {
    motionPreference.addListener(handleMotionChange);
  }

  buildProgress();
  localizeStaticUi();
  setLanguage(state.language, { announce: false });
})();
