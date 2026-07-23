'use strict';

(() => {
  const experienceData = window.DINO_HISTORY;
  if (!experienceData?.scenes?.length) return;

  const scenes = experienceData.scenes;
  const supportedLanguages = experienceData.supportedLanguages;
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');

  const dom = {
    experience: document.getElementById('experience'),
    backgroundStage: document.getElementById('backgroundStage'),
    sceneImages: [
      document.getElementById('sceneImageA'),
      document.getElementById('sceneImageB'),
    ],
    canvas: document.getElementById('atmosphereCanvas'),
    introOverlay: document.getElementById('introOverlay'),
    startButton: document.getElementById('startButton'),
    introLanguageEnglish: document.getElementById('introLanguageEnglish'),
    introLanguageJapanese: document.getElementById('introLanguageJapanese'),
    languageButton: document.getElementById('languageButton'),
    languageButtonLabel: document.getElementById('languageButtonLabel'),
    storyStage: document.getElementById('storyStage'),
    storyCard: document.getElementById('storyCard'),
    storyEyebrow: document.getElementById('storyEyebrow'),
    storyDate: document.getElementById('storyDate'),
    storyTitle: document.getElementById('storyTitle'),
    storyLede: document.getElementById('storyLede'),
    storyBody: document.getElementById('storyBody'),
    fieldTerm: document.getElementById('fieldTerm'),
    chapterChip: document.getElementById('chapterChip'),
    chapterChipText: document.getElementById('chapterChipText'),
    currentNumber: document.getElementById('currentNumber'),
    totalNumber: document.getElementById('totalNumber'),
    progressLabel: document.getElementById('progressLabel'),
    progressDots: document.getElementById('progressDots'),
    periodCursor: document.getElementById('periodCursor'),
    previousButton: document.getElementById('previousButton'),
    nextButton: document.getElementById('nextButton'),
    nextButtonLabel: document.getElementById('nextButtonLabel'),
    panelButton: document.getElementById('panelButton'),
    captionButton: document.getElementById('captionButton'),
    closeTranscriptButton: document.getElementById('closeTranscriptButton'),
    transcriptCard: document.getElementById('transcriptCard'),
    transcriptText: document.getElementById('transcriptText'),
    soundButton: document.getElementById('soundButton'),
    replayNarrationButton: document.getElementById('replayNarrationButton'),
    narrationStatus: document.getElementById('narrationStatus'),
    narrationLabel: document.getElementById('narrationLabel'),
    audioProgress: document.getElementById('audioProgress'),
    audioProgressTrack: document.getElementById('audioProgressTrack'),
    narrationAudio: document.getElementById('narrationAudio'),
    infoButton: document.getElementById('infoButton'),
    infoDialog: document.getElementById('infoDialog'),
    sourceList: document.getElementById('sourceList'),
    currentSourceBlock: document.getElementById('currentSourceBlock'),
    currentSourceList: document.getElementById('currentSourceList'),
    metaDescription: document.getElementById('metaDescription'),
    statusAnnouncer: document.getElementById('statusAnnouncer'),
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
      // Storage may be unavailable in private, restricted or embedded contexts.
    }
  }

  function getInitialLanguage() {
    const stored = safeStorageGet('dinosaurHistoryLanguage');
    if (supportedLanguages.includes(stored)) return stored;
    const browserLanguages = navigator.languages || [navigator.language];
    return browserLanguages.some((language) => language?.toLowerCase().startsWith('ja')) ? 'ja' : 'en';
  }

  const state = {
    started: false,
    index: 0,
    language: getInitialLanguage(),
    sound: safeStorageGet('dinosaurHistorySound') !== 'off',
    captions: false,
    panelPreferred: safeStorageGet('dinosaurHistoryPanel') !== 'hidden',
    panelVisible: true,
    reducedMotion: motionPreference.matches,
    visibleImage: 0,
    imageToken: 0,
    transcriptToken: 0,
    transcriptCache: new Map(),
    answers: new Map(),
    dialogWasPlaying: false,
    visibilityWasPlaying: false,
  };

  function locale() {
    return experienceData.ui[state.language] || experienceData.ui.en;
  }

  function t(key) {
    return locale()[key] ?? experienceData.ui.en[key] ?? key;
  }

  function interpolate(text, values) {
    return Object.entries(values).reduce(
      (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
      text,
    );
  }

  function sceneCopy(scene) {
    return scene.copy[state.language] || scene.copy.en;
  }

  function currentScene() {
    return scenes[state.index];
  }

  function announce(message) {
    dom.statusAnnouncer.textContent = '';
    window.setTimeout(() => {
      dom.statusAnnouncer.textContent = message;
    }, 10);
  }

  function setNarrationState(status, labelKey) {
    dom.narrationStatus.dataset.state = status;
    dom.narrationLabel.textContent = t(labelKey);
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
      const notes = kind === 'answer' ? [392, 523.25, 659.25] : [261.63, 329.63];
      notes.forEach((frequency, index) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = index === 0 ? 'sine' : 'triangle';
        oscillator.frequency.value = frequency;
        const begins = now + index * 0.07;
        gain.gain.setValueAtTime(0.0001, begins);
        gain.gain.exponentialRampToValueAtTime(kind === 'answer' ? 0.028 : 0.014, begins + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, begins + 0.26);
        oscillator.connect(gain);
        gain.connect(this.context.destination);
        oscillator.start(begins);
        oscillator.stop(begins + 0.28);
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
        setNarrationState('playing', 'narrationPlaying');
      });

      this.audio.addEventListener('pause', () => {
        if (!this.audio.ended && this.audio.currentTime > 0 && this.audio.src) {
          setNarrationState('paused', 'narrationPaused');
        }
      });

      this.audio.addEventListener('ended', () => {
        setAudioProgress(100);
        setNarrationState('complete', 'narrationComplete');
      });

      this.audio.addEventListener('timeupdate', () => {
        if (!Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
        setAudioProgress(this.audio.currentTime / this.audio.duration * 100);
      });

      this.audio.addEventListener('error', () => {
        if (!this.audio.src) return;
        setNarrationState('error', 'narrationError');
      });
    }

    play(scene, restart = false) {
      this.stop(false);
      this.activeScene = scene;

      if (!state.sound) {
        setNarrationState('muted', 'narrationMuted');
        return;
      }

      const token = ++this.playToken;
      setAudioProgress(0);
      setNarrationState('loading', 'narrationLoading');
      this.audio.src = `assets/audio/${state.language}/${scene.audio}.mp3`;
      this.audio.preload = 'auto';
      this.audio.currentTime = 0;

      const playPromise = this.audio.play();
      if (playPromise) {
        playPromise.catch(() => {
          if (token !== this.playToken) return;
          setNarrationState('ready', restart ? 'narrationReady' : 'narrationReady');
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
        setNarrationState(state.sound ? 'ready' : 'muted', state.sound ? 'narrationReady' : 'narrationMuted');
      }
    }

    pause() {
      if (!this.audio.paused) this.audio.pause();
    }

    resume() {
      if (!state.sound || !this.audio.src || this.audio.ended) return;
      this.audio.play().catch(() => setNarrationState('ready', 'narrationReady'));
    }

    isPlaying() {
      return !this.audio.paused && !this.audio.ended && Boolean(this.audio.src);
    }
  }

  class Atmosphere {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext('2d');
      this.frame = 0;
      this.running = false;
      this.lastTime = 0;
      this.tone = 'gateway';
      this.color = '255, 194, 71';
      this.motes = [];
      this.animate = this.animate.bind(this);
      this.resize = this.resize.bind(this);
      window.addEventListener('resize', this.resize, { passive: true });
    }

    setTone(tone) {
      this.tone = tone;
      const computed = getComputedStyle(dom.experience).getPropertyValue('--scene-accent-rgb').trim();
      this.color = computed || '255, 194, 71';
    }

    start() {
      if (state.reducedMotion || !this.context || this.running) return;
      this.running = true;
      this.resize();
      this.frame = requestAnimationFrame(this.animate);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.frame);
      if (this.context) this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    resize() {
      if (!this.context) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      this.canvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
      this.canvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
      const count = window.innerWidth < 700 ? 18 : 34;
      this.motes = Array.from({ length: count }, () => ({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        radius: (0.45 + Math.random() * 1.25) * ratio,
        speed: (0.05 + Math.random() * 0.12) * ratio,
        drift: (Math.random() - 0.5) * 0.08 * ratio,
        alpha: 0.07 + Math.random() * 0.2,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    animate(time) {
      if (!this.running) return;
      if (time - this.lastTime < 32) {
        this.frame = requestAnimationFrame(this.animate);
        return;
      }
      this.lastTime = time;
      const impactDirection = this.tone === 'impact' ? 1 : -1;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.motes.forEach((mote) => {
        mote.y += mote.speed * impactDirection;
        mote.x += mote.drift + Math.sin(time * 0.00035 + mote.phase) * 0.025;
        if (mote.y < -7) mote.y = this.canvas.height + 7;
        if (mote.y > this.canvas.height + 7) mote.y = -7;
        if (mote.x < -7) mote.x = this.canvas.width + 7;
        if (mote.x > this.canvas.width + 7) mote.x = -7;
        this.context.beginPath();
        this.context.fillStyle = `rgba(${this.color}, ${mote.alpha})`;
        this.context.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
        this.context.fill();
      });
      this.frame = requestAnimationFrame(this.animate);
    }
  }

  const tonePlayer = new TonePlayer();
  const narrator = new NarrationController(dom.narrationAudio);
  const atmosphere = new Atmosphere(dom.canvas);

  function applyStaticLocalization() {
    document.documentElement.lang = state.language;
    document.title = state.started
      ? `${sceneCopy(currentScene()).title} · ${t('metaTitle')}`
      : t('metaTitle');
    dom.metaDescription.setAttribute('content', t('metaDescription'));

    document.querySelectorAll('[data-i18n]').forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });

    document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
      element.setAttribute('aria-label', t(element.dataset.i18nAria));
    });

    dom.languageButtonLabel.textContent = state.language === 'en' ? t('japaneseLanguage') : t('englishLanguage');
    dom.languageButton.setAttribute('aria-label', t('switchLanguage'));
    dom.languageButton.title = t('switchLanguage');
    dom.introLanguageEnglish.setAttribute('aria-pressed', String(state.language === 'en'));
    dom.introLanguageJapanese.setAttribute('aria-pressed', String(state.language === 'ja'));
    dom.totalNumber.textContent = String(scenes.length).padStart(2, '0');
    dom.progressDots.setAttribute('aria-label', `${scenes.length} ${t('progressLabel')}`);

    updateSoundControl();
    updateCaptionControl(false);
    updateProgressButtons();
    renderSourceLists();

    if (state.started) {
      updateNavigation(currentScene());
      syncPanelForScene(currentScene());
    }
  }

  function buildProgress() {
    const fragment = document.createDocumentFragment();
    scenes.forEach((scene, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'progress-dot';
      button.type = 'button';
      button.dataset.index = String(index);
      button.dataset.kind = scene.kind;
      button.addEventListener('click', () => setSlide(index, { narrate: true, focus: true }));
      item.append(button);
      fragment.append(item);
    });
    dom.progressDots.append(fragment);
    updateProgressButtons();
  }

  function updateProgressButtons() {
    [...dom.progressDots.querySelectorAll('.progress-dot')].forEach((button, index) => {
      const copy = sceneCopy(scenes[index]);
      button.setAttribute('aria-label', interpolate(t('progressSceneLabel'), {
        number: index + 1,
        title: copy.title,
      }));
    });
  }

  function createSourceLink(source) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = source.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = source.title[state.language] || source.title.en;
    item.append(link);
    return item;
  }

  function renderSourceLists() {
    const allSources = document.createDocumentFragment();
    experienceData.sources.forEach((source) => allSources.append(createSourceLink(source)));
    dom.sourceList.replaceChildren(allSources);

    if (!state.started) {
      dom.currentSourceBlock.hidden = true;
      dom.currentSourceList.replaceChildren();
      return;
    }

    const sourceIds = new Set(currentScene().sources);
    const selectedSources = experienceData.sources.filter((source) => sourceIds.has(source.id));
    const currentSources = document.createDocumentFragment();
    selectedSources.forEach((source) => currentSources.append(createSourceLink(source)));
    dom.currentSourceList.replaceChildren(currentSources);
    dom.currentSourceBlock.hidden = selectedSources.length === 0;
  }

  function warmArtwork() {
    const sources = [...new Set(scenes.slice(1).map((scene) => scene.image))];
    const load = () => {
      sources.forEach((source) => {
        const image = new Image();
        image.decoding = 'async';
        image.src = source;
      });
    };
    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(load, { timeout: 1800 });
    } else {
      window.setTimeout(load, 350);
    }
  }

  function setBackground(scene, immediate = false) {
    const copy = sceneCopy(scene);
    dom.backgroundStage.setAttribute('aria-label', copy.artAlt);
    dom.experience.style.setProperty('--focal-x', `${scene.focal.x}%`);
    dom.experience.style.setProperty('--focal-y', `${scene.focal.y}%`);
    dom.backgroundStage.removeAttribute('data-image-error');

    const currentImage = dom.sceneImages[state.visibleImage];
    if (currentImage.getAttribute('src') === scene.image && !immediate) return;

    const token = ++state.imageToken;
    const nextIndex = state.visibleImage === 0 ? 1 : 0;
    const nextImage = dom.sceneImages[nextIndex];
    nextImage.src = scene.image;

    const reveal = () => {
      if (token !== state.imageToken) return;
      nextImage.classList.add('is-visible');
      currentImage.classList.remove('is-visible');
      state.visibleImage = nextIndex;
    };

    const fail = () => {
      if (token !== state.imageToken) return;
      dom.backgroundStage.dataset.imageError = 'true';
      currentImage.classList.remove('is-visible');
    };

    if (immediate || nextImage.complete) {
      requestAnimationFrame(reveal);
    } else {
      nextImage.addEventListener('load', reveal, { once: true });
      nextImage.addEventListener('error', fail, { once: true });
    }
  }

  function createFactGrid(facts) {
    const grid = document.createElement('div');
    grid.className = 'fact-grid';
    facts.forEach((fact) => {
      const item = document.createElement('div');
      item.className = 'fact-item';
      const value = document.createElement('strong');
      const label = document.createElement('b');
      const caption = document.createElement('small');
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
    const wrapper = document.createElement('div');
    wrapper.className = 'quiz-wrap';
    const question = document.createElement('p');
    question.className = 'quiz-question';
    question.textContent = copy.question;
    const options = document.createElement('div');
    options.className = 'quiz-options';
    options.setAttribute('role', 'group');
    options.setAttribute('aria-label', `${t('quizGroupLabel')}: ${copy.question}`);
    const answered = state.answers.get(scene.id);

    copy.options.forEach((label, index) => {
      const option = document.createElement('button');
      option.className = 'quiz-option';
      option.type = 'button';
      option.dataset.key = String(index + 1);
      option.textContent = label;
      if (answered) {
        option.disabled = true;
        option.classList.toggle('is-correct', index === copy.answer);
        option.classList.toggle('is-selected', index === answered.selection);
        option.classList.toggle('is-dimmed', index !== copy.answer && index !== answered.selection);
      } else {
        option.addEventListener('click', () => answerQuiz(scene, index));
      }
      options.append(option);
    });

    wrapper.append(question, options);
    if (answered) {
      const feedback = document.createElement('p');
      feedback.className = 'quiz-feedback';
      const lead = document.createElement('strong');
      lead.textContent = answered.correct ? t('correctLead') : t('discoveryLead');
      feedback.append(lead, document.createTextNode(copy.explanation));
      wrapper.append(feedback);
    }
    return wrapper;
  }

  function createFinaleScore() {
    const panel = document.createElement('div');
    panel.className = 'finale-score';
    const copy = document.createElement('span');
    const label = document.createElement('small');
    const title = document.createElement('strong');
    const score = document.createElement('b');
    const replay = document.createElement('button');
    label.textContent = t('finaleQuizzesLabel');
    title.textContent = state.answers.size === 3 ? t('finaleComplete') : t('finaleOpen');
    score.textContent = `${state.answers.size} / 3`;
    replay.className = 'replay-journey';
    replay.type = 'button';
    replay.textContent = `${t('restartAction')} ↺`;
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
    label.textContent = t('termLabel');
    name.textContent = term.name;
    name.lang = /[A-Za-z]/.test(term.name) ? 'en' : state.language;
    meaning.textContent = `${term.reading} · ${term.meaning}`;
    dom.fieldTerm.replaceChildren(label, name, meaning);
  }

  function periodPositionFor(scene) {
    const positions = {
      'deep-time-gateway': 2,
      'triassic-beginnings': 14,
      'quiz-periods': 3,
      'jurassic-giants': 42,
      'feathers-before-flight': 55,
      'cretaceous-spinosaurus': 68,
      'gobi-velociraptor': 84,
      'last-neighbors': 96,
      'quiz-neighbors': 96,
      'fossil-detectives': 99,
      'quiz-tracks': 99,
      'chicxulub-impact': 99,
      'birds-continue': 99,
    };
    return positions[scene.id] ?? 50;
  }

  function updateProgress(scene, copy) {
    dom.currentNumber.textContent = String(state.index + 1).padStart(2, '0');
    dom.progressLabel.textContent = copy.progress;
    dom.chapterChipText.textContent = copy.progress;
    dom.experience.style.setProperty('--period-position', `${periodPositionFor(scene)}%`);

    [...dom.progressDots.querySelectorAll('.progress-dot')].forEach((dot, index) => {
      dot.classList.toggle('is-current', index === state.index);
      dot.classList.toggle('is-complete', index < state.index);
      if (index === state.index) {
        dot.setAttribute('aria-current', 'step');
      } else {
        dot.removeAttribute('aria-current');
      }
    });
  }

  function updateNavigation(scene) {
    const unansweredQuiz = scene.kind === 'quiz' && !state.answers.has(scene.id);
    dom.previousButton.disabled = state.index === 0;
    dom.nextButton.disabled = unansweredQuiz;

    if (scene.kind === 'finale') {
      dom.nextButtonLabel.textContent = t('restartNav');
      dom.nextButton.setAttribute('aria-label', t('restartLabel'));
    } else if (unansweredQuiz) {
      dom.nextButtonLabel.textContent = t('answerToContinue');
      dom.nextButton.setAttribute('aria-label', t('answerToContinue'));
    } else {
      dom.nextButtonLabel.textContent = t('next');
      dom.nextButton.setAttribute('aria-label', t('nextLabel'));
    }
    dom.previousButton.setAttribute('aria-label', t('previousLabel'));
  }

  function syncPanelForScene(scene, options = {}) {
    const quizRequiresPanel = scene.kind === 'quiz';
    const visible = quizRequiresPanel || state.panelPreferred;
    const changed = visible !== state.panelVisible;
    const quizOverride = quizRequiresPanel && !state.panelPreferred && !state.panelVisible;
    const focusWasInsidePanel = !visible && dom.storyCard.contains(document.activeElement);

    state.panelVisible = visible;
    if (focusWasInsidePanel) {
      dom.panelButton.focus({ preventScroll: true });
    }
    dom.experience.dataset.panel = visible ? 'visible' : 'hidden';
    dom.storyCard.setAttribute('aria-hidden', String(!visible));
    dom.storyCard.inert = !visible;
    dom.panelButton.disabled = quizRequiresPanel;
    dom.panelButton.setAttribute('aria-pressed', String(visible));

    const label = quizRequiresPanel
      ? t('panelLocked')
      : visible ? t('panelHide') : t('panelShow');
    dom.panelButton.setAttribute('aria-label', label);
    dom.panelButton.title = label;

    if (quizOverride && options.announceQuiz) {
      announce(t('quizRequiredAnnouncement'));
    } else if (changed && options.announce) {
      announce(visible ? t('panelShownAnnouncement') : t('panelHiddenAnnouncement'));
    }
    return { changed, quizOverride, visible };
  }

  function togglePanel() {
    const scene = currentScene();
    if (scene.kind === 'quiz') {
      announce(t('panelLocked'));
      return;
    }
    state.panelPreferred = !state.panelPreferred;
    safeStorageSet('dinosaurHistoryPanel', state.panelPreferred ? 'visible' : 'hidden');
    syncPanelForScene(scene, { announce: true });
  }

  function fetchTranscript(scene) {
    const token = ++state.transcriptToken;
    const language = state.language;
    const cacheKey = `${language}:${scene.audio}`;
    dom.transcriptText.textContent = t('transcriptLoading');

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
        const transcript = text.trim() || sceneCopy(scene).lede;
        state.transcriptCache.set(cacheKey, transcript);
        if (token === state.transcriptToken && language === state.language) {
          dom.transcriptText.textContent = transcript;
        }
      })
      .catch(() => {
        if (token === state.transcriptToken && language === state.language) {
          dom.transcriptText.textContent = `${t('transcriptUnavailable')}\n\n${sceneCopy(scene).lede}`;
        }
      });
  }

  function setSlide(index, options = {}) {
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
    atmosphere.setTone(scene.tone);
    setBackground(scene, !changed && nextIndex === 0);

    dom.storyEyebrow.textContent = copy.eyebrow;
    dom.storyDate.textContent = copy.date;
    dom.storyTitle.textContent = copy.title;
    dom.storyLede.textContent = copy.lede;
    renderStoryBody(scene, copy);
    renderTerm(copy.term);
    updateProgress(scene, copy);
    updateNavigation(scene);
    const panelState = syncPanelForScene(scene, { announceQuiz: false });
    fetchTranscript(scene);
    renderSourceLists();
    document.title = `${copy.title} · ${t('metaTitle')}`;
    dom.storyCard.scrollTop = 0;

    if (options.announce !== false) {
      const sceneMessage = interpolate(t('sceneAnnouncement'), {
        current: state.index + 1,
        total: scenes.length,
        title: copy.title,
      });
      announce(panelState.quizOverride
        ? `${sceneMessage} ${t('quizRequiredAnnouncement')}`
        : sceneMessage);
    }

    requestAnimationFrame(() => requestAnimationFrame(() => {
      dom.storyCard.classList.add('is-visible');
      if (options.focus) {
        const focusTarget = state.panelVisible ? dom.storyCard : dom.nextButton;
        focusTarget.focus({ preventScroll: true });
      }
    }));

    if (options.narrate !== false) narrator.play(scene);
    else setNarrationState(state.sound ? 'ready' : 'muted', state.sound ? 'narrationReady' : 'narrationMuted');
  }

  function answerQuiz(scene, selection) {
    if (state.answers.has(scene.id)) return;
    const copy = sceneCopy(scene);
    const correct = selection === copy.answer;
    state.answers.set(scene.id, { selection, correct });
    renderStoryBody(scene, copy);
    updateNavigation(scene);
    tonePlayer.play('answer');
    announce(`${correct ? t('correctLead') : t('discoveryLead')} ${copy.explanation}`);

    const feedback = dom.storyBody.querySelector('.quiz-feedback');
    if (feedback) {
      feedback.tabIndex = -1;
      requestAnimationFrame(() => {
        feedback.scrollIntoView({
          behavior: state.reducedMotion ? 'auto' : 'smooth',
          block: 'nearest',
        });
        feedback.focus({ preventScroll: true });
      });
    }
  }

  function startExperience() {
    if (state.started) return;
    state.started = true;
    tonePlayer.unlock();
    warmArtwork();
    dom.experience.dataset.phase = 'story';
    dom.storyStage.hidden = false;
    dom.chapterChip.hidden = false;
    dom.panelButton.hidden = false;
    dom.captionButton.hidden = false;
    dom.soundButton.hidden = false;
    dom.introOverlay.classList.add('is-leaving');
    atmosphere.start();
    renderSourceLists();
    setSlide(0, { narrate: true, focus: true, announceQuiz: false });
    window.setTimeout(() => {
      dom.introOverlay.hidden = true;
    }, state.reducedMotion ? 30 : 800);
  }

  function restartJourney() {
    state.answers.clear();
    tonePlayer.play('navigate');
    setSlide(0, { narrate: true, focus: true, announceQuiz: false });
  }

  function goNext() {
    const scene = currentScene();
    if (scene.kind === 'quiz' && !state.answers.has(scene.id)) return;
    tonePlayer.unlock();
    tonePlayer.play('navigate');
    if (state.index === scenes.length - 1) {
      restartJourney();
    } else {
      setSlide(state.index + 1, { narrate: true, focus: true });
    }
  }

  function goPrevious() {
    if (state.index <= 0) return;
    tonePlayer.unlock();
    tonePlayer.play('navigate');
    setSlide(state.index - 1, { narrate: true, focus: true });
  }

  function updateSoundControl() {
    dom.soundButton.setAttribute('aria-pressed', String(state.sound));
    dom.soundButton.setAttribute('aria-label', state.sound ? t('soundOff') : t('soundOn'));
    dom.soundButton.title = state.sound ? t('soundOff') : t('soundOn');
  }

  function toggleSound() {
    state.sound = !state.sound;
    safeStorageSet('dinosaurHistorySound', state.sound ? 'on' : 'off');
    updateSoundControl();
    if (state.sound) {
      tonePlayer.unlock();
      if (state.started) narrator.play(currentScene());
      announce(t('soundOnAnnouncement'));
    } else {
      narrator.stop(false);
      setNarrationState('muted', 'narrationMuted');
      announce(t('soundOffAnnouncement'));
    }
  }

  function updateCaptionControl(announceChange = true) {
    dom.transcriptCard.hidden = !state.captions;
    dom.captionButton.setAttribute('aria-pressed', String(state.captions));
    dom.captionButton.setAttribute('aria-label', state.captions ? t('captionsHide') : t('captionsShow'));
    dom.captionButton.title = state.captions ? t('captionsHide') : t('captionsShow');
    if (announceChange) {
      announce(state.captions ? t('captionsShownAnnouncement') : t('captionsHiddenAnnouncement'));
    }
  }

  function setCaptions(visible) {
    state.captions = Boolean(visible);
    updateCaptionControl(true);
    if (state.captions && state.started) fetchTranscript(currentScene());
  }

  function openInfo() {
    state.dialogWasPlaying = narrator.isPlaying();
    narrator.pause();
    renderSourceLists();
    if (typeof dom.infoDialog.showModal === 'function') {
      dom.infoDialog.showModal();
    } else {
      dom.infoDialog.setAttribute('open', '');
    }
  }

  function applyLanguage(language, options = {}) {
    if (!supportedLanguages.includes(language)) return;
    const changed = language !== state.language;
    if (state.started) narrator.stop(false);
    state.transcriptToken += 1;
    state.language = language;
    safeStorageSet('dinosaurHistoryLanguage', language);
    applyStaticLocalization();

    if (state.started) {
      setSlide(state.index, {
        narrate: state.sound,
        focus: false,
        announce: false,
        announceQuiz: false,
      });
    } else {
      const openingCopy = sceneCopy(scenes[0]);
      dom.backgroundStage.setAttribute('aria-label', openingCopy.artAlt);
    }

    if ((changed || options.forceAnnounce) && options.announce !== false) {
      announce(t('languageChangedAnnouncement'));
    }
  }

  function toggleLanguage() {
    applyLanguage(state.language === 'en' ? 'ja' : 'en', { announce: true });
  }

  function chooseQuizByKeyboard(key) {
    const scene = currentScene();
    if (scene.kind !== 'quiz' || state.answers.has(scene.id)) return false;
    const selection = Number(key) - 1;
    const copy = sceneCopy(scene);
    if (selection < 0 || selection >= copy.options.length) return false;
    answerQuiz(scene, selection);
    return true;
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (dom.infoDialog.open) return;

    const target = event.target;
    const editable = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || target?.isContentEditable;
    if (editable) return;

    if (!state.started) return;
    const key = event.key.toLowerCase();

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
      tonePlayer.unlock();
      if (!state.sound) toggleSound();
      else narrator.play(currentScene(), true);
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
      toggleLanguage();
    } else if (event.key === 'Escape' && state.captions) {
      event.preventDefault();
      setCaptions(false);
    }
  }

  dom.startButton.addEventListener('click', startExperience);
  dom.introLanguageEnglish.addEventListener('click', () => applyLanguage('en', { announce: false }));
  dom.introLanguageJapanese.addEventListener('click', () => applyLanguage('ja', { announce: false }));
  dom.languageButton.addEventListener('click', toggleLanguage);
  dom.previousButton.addEventListener('click', goPrevious);
  dom.nextButton.addEventListener('click', goNext);
  dom.panelButton.addEventListener('click', togglePanel);
  dom.soundButton.addEventListener('click', toggleSound);
  dom.captionButton.addEventListener('click', () => setCaptions(!state.captions));
  dom.closeTranscriptButton.addEventListener('click', () => setCaptions(false));
  dom.replayNarrationButton.addEventListener('click', () => {
    tonePlayer.unlock();
    if (!state.sound) toggleSound();
    else narrator.play(currentScene(), true);
  });
  dom.infoButton.addEventListener('click', openInfo);

  dom.infoDialog.addEventListener('close', () => {
    if (state.dialogWasPlaying) narrator.resume();
    state.dialogWasPlaying = false;
  });

  dom.infoDialog.addEventListener('click', (event) => {
    if (event.target === dom.infoDialog && typeof dom.infoDialog.close === 'function') {
      dom.infoDialog.close();
    }
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
    if (state.reducedMotion) atmosphere.stop();
    else if (state.started) atmosphere.start();
  };

  if (typeof motionPreference.addEventListener === 'function') {
    motionPreference.addEventListener('change', handleMotionChange);
  } else {
    motionPreference.addListener(handleMotionChange);
  }

  buildProgress();
  applyStaticLocalization();
  dom.backgroundStage.setAttribute('aria-label', sceneCopy(scenes[0]).artAlt);
  setNarrationState(state.sound ? 'ready' : 'muted', state.sound ? 'narrationReady' : 'narrationMuted');
})();
