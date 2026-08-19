'use strict';

(() => {
  const story = window.SCALE_STORY;
  if (!story?.scenes?.length) return;

  const { scenes, sources, meta } = story;
  const dom = {
    experience: document.getElementById('experience'),
    skipLink: document.getElementById('skipLink'),
    backControl: document.getElementById('backControl'),
    brandLockup: document.getElementById('brandLockup'),
    brandSubtitle: document.getElementById('brandSubtitle'),
    topbar: document.querySelector('.topbar'),
    introOverlay: document.getElementById('introOverlay'),
    introKicker: document.getElementById('introKicker'),
    introTitle: document.getElementById('introTitle'),
    introSubtitle: document.getElementById('introSubtitle'),
    introLede: document.getElementById('introLede'),
    chooseLanguage: document.getElementById('chooseLanguage'),
    introStats: document.getElementById('introStats'),
    introScenesLabel: document.getElementById('introScenesLabel'),
    introDuration: document.getElementById('introDuration'),
    introDurationLabel: document.getElementById('introDurationLabel'),
    introQuizzesLabel: document.getElementById('introQuizzesLabel'),
    startButton: document.getElementById('startButton'),
    startEyebrow: document.getElementById('startEyebrow'),
    startLabel: document.getElementById('startLabel'),
    headphoneNote: document.getElementById('headphoneNote'),
    openingCoordinate: document.getElementById('openingCoordinate'),
    languageSwitches: [...document.querySelectorAll('.language-switch')],
    languageButtons: [...document.querySelectorAll('[data-language]')],
    storyStage: document.getElementById('storyStage'),
    storyCard: document.getElementById('storyCard'),
    storyEyebrow: document.getElementById('storyEyebrow'),
    storyScale: document.getElementById('storyScale'),
    storyTitle: document.getElementById('storyTitle'),
    storyLede: document.getElementById('storyLede'),
    factsHeading: document.getElementById('factsHeading'),
    factGrid: document.getElementById('factGrid'),
    storyNote: document.getElementById('storyNote'),
    quizBlock: document.getElementById('quizBlock'),
    scaleTermLabel: document.getElementById('scaleTermLabel'),
    scaleTermWord: document.getElementById('scaleTermWord'),
    scaleTermMeaning: document.getElementById('scaleTermMeaning'),
    chapterChip: document.getElementById('chapterChip'),
    chapterChipText: document.getElementById('chapterChipText'),
    currentNumber: document.getElementById('currentNumber'),
    totalNumber: document.getElementById('totalNumber'),
    progressLabel: document.getElementById('progressLabel'),
    progressDots: document.getElementById('progressDots'),
    scaleRailFill: document.getElementById('scaleRailFill'),
    scaleRailMarker: document.getElementById('scaleRailMarker'),
    journeyNav: document.getElementById('journeyNav'),
    previousButton: document.getElementById('previousButton'),
    previousLabel: document.getElementById('previousLabel'),
    nextButton: document.getElementById('nextButton'),
    nextButtonLabel: document.getElementById('nextButtonLabel'),
    panelButton: document.getElementById('panelButton'),
    panelButtonText: document.getElementById('panelButtonText'),
    captionButton: document.getElementById('captionButton'),
    captionButtonText: document.getElementById('captionButtonText'),
    closeTranscriptButton: document.getElementById('closeTranscriptButton'),
    transcriptCard: document.getElementById('transcriptCard'),
    transcriptTitle: document.getElementById('transcriptTitle'),
    transcriptText: document.getElementById('transcriptText'),
    soundButton: document.getElementById('soundButton'),
    soundButtonText: document.getElementById('soundButtonText'),
    replayNarrationButton: document.getElementById('replayNarrationButton'),
    narrationStatus: document.getElementById('narrationStatus'),
    narrationLabel: document.getElementById('narrationLabel'),
    audioProgress: document.getElementById('audioProgress'),
    audioProgressTrack: document.getElementById('audioProgressTrack'),
    narrationAudio: document.getElementById('narrationAudio'),
    infoButton: document.getElementById('infoButton'),
    infoDialog: document.getElementById('infoDialog'),
    infoCloseButton: document.getElementById('infoCloseButton'),
    infoKicker: document.getElementById('infoKicker'),
    infoTitle: document.getElementById('infoTitle'),
    controlsTitle: document.getElementById('controlsTitle'),
    controlsText: document.getElementById('controlsText'),
    panelHelp: document.getElementById('panelHelp'),
    accessibilityTitle: document.getElementById('accessibilityTitle'),
    accessibilityText: document.getElementById('accessibilityText'),
    mediaTitle: document.getElementById('mediaTitle'),
    mediaText: document.getElementById('mediaText'),
    voiceTitle: document.getElementById('voiceTitle'),
    voiceText: document.getElementById('voiceText'),
    accuracyTitle: document.getElementById('accuracyTitle'),
    accuracyText: document.getElementById('accuracyText'),
    sourcesTitle: document.getElementById('sourcesTitle'),
    sourcesNote: document.getElementById('sourcesNote'),
    sourceList: document.getElementById('sourceList'),
    statusAnnouncer: document.getElementById('statusAnnouncer'),
    sceneImages: [
      document.getElementById('sceneImageA'),
      document.getElementById('sceneImageB'),
    ],
    canvas: document.getElementById('atmosphereCanvas'),
    metaDescription: document.querySelector('meta[name="description"]'),
  };

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const storedLanguage = safeStorageGet('smallLargeLanguage');
  const browserLanguage = String(navigator.language || '').toLowerCase().startsWith('ja') ? 'ja' : 'en';
  const initialLanguage = meta.languages.includes(storedLanguage) ? storedLanguage : browserLanguage;
  const storedSound = safeStorageGet('smallLargeSound');
  const storedPanel = safeStorageGet('smallLargePanel');

  const state = {
    started: false,
    index: 0,
    language: initialLanguage,
    sound: storedSound !== 'off',
    panelPreferred: storedPanel !== 'hidden',
    panelVisible: true,
    captions: false,
    reducedMotion: motionPreference.matches,
    visibleImage: 0,
    imageToken: 0,
    transcriptToken: 0,
    transcriptCache: new Map(),
    answers: new Map(),
    visited: new Set(),
    dialogWasPlaying: false,
    visibilityWasPlaying: false,
    warmStarted: false,
  };

  function copy() {
    return story.ui[state.language];
  }

  function content(scene = scenes[state.index]) {
    return scene[state.language];
  }

  function format(template, values) {
    return Object.entries(values).reduce(
      (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
      template,
    );
  }

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
      // Storage can be unavailable in private or embedded browsing contexts.
    }
  }

  function announce(message) {
    dom.statusAnnouncer.textContent = '';
    window.setTimeout(() => {
      dom.statusAnnouncer.textContent = message;
    }, 20);
  }

  function setNarrationState(status, label) {
    dom.narrationStatus.dataset.state = status;
    dom.narrationLabel.textContent = label;
  }

  class TonePlayer {
    constructor() {
      this.context = null;
    }

    unlock() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return;
      if (!this.context) this.context = new AudioContextClass();
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    }

    play(correct) {
      if (!state.sound || !this.context) return;
      const now = this.context.currentTime;
      const notes = correct ? [392, 523.25, 659.25] : [293.66, 246.94];
      notes.forEach((frequency, index) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = index === 0 ? 'sine' : 'triangle';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * 0.07);
        gain.gain.exponentialRampToValueAtTime(correct ? 0.025 : 0.014, now + index * 0.07 + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.07 + 0.27);
        oscillator.connect(gain);
        gain.connect(this.context.destination);
        oscillator.start(now + index * 0.07);
        oscillator.stop(now + index * 0.07 + 0.29);
      });
    }
  }

  class NarrationController {
    constructor(audio) {
      this.audio = audio;
      this.playToken = 0;
      this.activeSceneId = '';
      this.activeLanguage = '';
      this.bindEvents();
    }

    bindEvents() {
      this.audio.addEventListener('playing', () => {
        setNarrationState('playing', copy().narrationPlaying);
      });

      this.audio.addEventListener('pause', () => {
        if (!this.audio.ended && this.audio.currentTime > 0 && this.audio.src) {
          setNarrationState('paused', copy().narrationPaused);
        }
      });

      this.audio.addEventListener('ended', () => {
        updateAudioProgress(100);
        setNarrationState('complete', copy().narrationComplete);
      });

      this.audio.addEventListener('timeupdate', () => {
        if (!Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
        updateAudioProgress(Math.min(100, this.audio.currentTime / this.audio.duration * 100));
      });

      this.audio.addEventListener('error', () => {
        if (!this.audio.src) return;
        setNarrationState('error', copy().narrationError);
      });
    }

    source(scene) {
      return `${meta.audioBase}/${state.language}/${scene.id}.mp3`;
    }

    play(scene, restart = false) {
      this.stop(false);
      this.activeSceneId = scene.id;
      this.activeLanguage = state.language;
      if (!state.sound) {
        setNarrationState('muted', copy().narrationMuted);
        return;
      }

      const token = ++this.playToken;
      updateAudioProgress(0);
      setNarrationState('loading', copy().narrationLoading);
      this.audio.src = this.source(scene);
      this.audio.currentTime = 0;
      this.audio.preload = 'auto';
      const playPromise = this.audio.play();

      if (playPromise) {
        playPromise.catch(() => {
          if (token !== this.playToken) return;
          setNarrationState('ready', restart ? copy().narrationBlocked : copy().narrationBlocked);
        });
      }
    }

    stop(resetState = true) {
      this.playToken += 1;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.activeSceneId = '';
      this.activeLanguage = '';
      updateAudioProgress(0);
      if (resetState) {
        setNarrationState(state.sound ? 'ready' : 'muted', state.sound ? copy().narrationReady : copy().narrationMuted);
      }
    }

    pause() {
      if (!this.audio.paused) this.audio.pause();
    }

    resume() {
      if (!state.sound || !this.audio.src || this.audio.ended) return;
      this.audio.play().catch(() => setNarrationState('ready', copy().narrationBlocked));
    }

    isPlaying() {
      return !this.audio.paused && !this.audio.ended && Boolean(this.audio.src);
    }
  }

  class Atmosphere {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas?.getContext('2d') || null;
      this.motes = [];
      this.frame = 0;
      this.lastTime = 0;
      this.running = false;
      this.tone = 'human';
      this.resize = this.resize.bind(this);
      this.animate = this.animate.bind(this);
    }

    start() {
      if (!this.context || state.reducedMotion || this.running) return;
      this.running = true;
      this.resize();
      window.addEventListener('resize', this.resize, { passive: true });
      this.frame = requestAnimationFrame(this.animate);
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.frame);
      window.removeEventListener('resize', this.resize);
      if (this.context) this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
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
      const count = window.innerWidth < 760 ? 16 : 30;
      this.motes = Array.from({ length: count }, () => ({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        radius: (0.35 + Math.random() * 1.1) * ratio,
        speed: (0.035 + Math.random() * 0.1) * ratio,
        drift: (Math.random() - 0.5) * 0.07 * ratio,
        alpha: 0.07 + Math.random() * 0.17,
        phase: Math.random() * Math.PI * 2,
      }));
    }

    animate(time) {
      if (!this.running) return;
      if (time - this.lastTime < 34) {
        this.frame = requestAnimationFrame(this.animate);
        return;
      }
      this.lastTime = time;
      const palette = {
        quantum: '25, 227, 227',
        atomic: '112, 168, 255',
        molecular: '198, 156, 255',
        bio: '23, 198, 150',
        earthy: '232, 168, 103',
        human: '255, 194, 71',
        ocean: '110, 207, 246',
        city: '255, 106, 31',
        planet: '121, 184, 255',
        space: '168, 185, 214',
        solar: '255, 106, 31',
        galaxy: '216, 173, 255',
        finale: '255, 194, 71',
      };
      const color = palette[this.tone] || palette.human;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.motes.forEach((mote) => {
        mote.y -= mote.speed;
        mote.x += mote.drift + Math.sin(time * 0.0004 + mote.phase) * 0.022;
        if (mote.y < -5) {
          mote.y = this.canvas.height + 5;
          mote.x = Math.random() * this.canvas.width;
        }
        this.context.beginPath();
        this.context.fillStyle = `rgba(${color}, ${mote.alpha})`;
        this.context.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
        this.context.fill();
      });
      this.frame = requestAnimationFrame(this.animate);
    }
  }

  const tonePlayer = new TonePlayer();
  const narrator = new NarrationController(dom.narrationAudio);
  const atmosphere = new Atmosphere(dom.canvas);

  function updateAudioProgress(percent) {
    const rounded = Math.round(percent);
    dom.audioProgress.style.width = `${percent}%`;
    dom.audioProgressTrack.setAttribute('aria-valuenow', String(rounded));
  }

  function updateStaticLanguage() {
    const t = copy();
    document.documentElement.lang = state.language;
    document.title = t.documentTitle;
    dom.metaDescription?.setAttribute('content', t.description);
    dom.skipLink.textContent = t.skip;
    dom.backControl.setAttribute('aria-label', t.back);
    dom.brandLockup.setAttribute('aria-label', `${t.documentTitle}. ${t.brandSubtitle}`);
    dom.brandSubtitle.textContent = t.brandSubtitle;
    dom.topbar.setAttribute('aria-label', t.storyLabel);
    dom.introKicker.textContent = t.introKicker;
    dom.introTitle.textContent = t.introTitle;
    dom.introSubtitle.textContent = t.introSubtitle;
    dom.introLede.textContent = t.introLede;
    dom.chooseLanguage.textContent = t.chooseLanguage;
    dom.introScenesLabel.textContent = t.introScenes;
    dom.introDuration.textContent = t.introDuration;
    dom.introDurationLabel.textContent = t.introDurationLabel;
    dom.introQuizzesLabel.textContent = t.introQuizzes;
    dom.introStats.setAttribute('aria-label', `${scenes.length} ${t.introScenes}; ${t.introDuration}; ${meta.quizCount} ${t.introQuizzes}`);
    dom.startEyebrow.textContent = t.startEyebrow;
    dom.startLabel.textContent = t.start;
    dom.headphoneNote.lastChild.textContent = ` ${t.headphone}`;
    dom.openingCoordinate.textContent = t.openingCoordinate;
    dom.storyStage.setAttribute('aria-label', t.storyLabel);
    dom.panelButtonText.textContent = t.panelShort;
    dom.captionButtonText.textContent = t.captionsShort;
    dom.soundButtonText.textContent = t.soundShort;
    dom.infoButton.setAttribute('aria-label', t.infoOpen);
    dom.previousLabel.textContent = t.previous;
    dom.previousButton.setAttribute('aria-label', t.previousAria);
    dom.closeTranscriptButton.setAttribute('aria-label', t.transcriptClose);
    dom.transcriptTitle.textContent = t.transcriptTitle;
    dom.scaleTermLabel.textContent = t.scaleWord;
    dom.factsHeading.textContent = t.factsLabel;
    dom.infoKicker.textContent = t.infoKicker;
    dom.infoTitle.textContent = t.infoTitle;
    dom.infoCloseButton.setAttribute('aria-label', t.infoClose);
    dom.controlsTitle.textContent = t.controlsTitle;
    dom.controlsText.textContent = t.controlsText;
    dom.panelHelp.textContent = t.panelHelp;
    dom.accessibilityTitle.textContent = t.accessibilityTitle;
    dom.accessibilityText.textContent = t.accessibilityText;
    dom.mediaTitle.textContent = t.mediaTitle;
    dom.mediaText.textContent = t.mediaText;
    dom.voiceTitle.textContent = t.voiceTitle;
    dom.voiceText.textContent = t.voiceText;
    dom.accuracyTitle.textContent = t.accuracyTitle;
    dom.accuracyText.textContent = t.accuracyText;
    dom.sourcesTitle.textContent = t.sourcesTitle;
    dom.sourcesNote.textContent = t.sourcesNote;
    dom.languageSwitches.forEach((switcher) => switcher.setAttribute('aria-label', t.languageLabel));
    dom.languageButtons.forEach((button) => {
      const language = button.dataset.language;
      button.setAttribute('aria-pressed', String(language === state.language));
      button.setAttribute('aria-label', language === 'en' ? t.english : t.japanese);
    });
    updatePanelButton();
    updateCaptionButton();
    updateSoundButton();
    renderSources();
    localizeProgress();
  }

  function renderSources() {
    const fragment = document.createDocumentFragment();
    sources.forEach((source) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.label;
      item.append(link);
      fragment.append(item);
    });
    dom.sourceList.replaceChildren(fragment);
  }

  function buildProgress() {
    const fragment = document.createDocumentFragment();
    scenes.forEach((scene, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.className = `progress-dot${scene.kind === 'quiz' ? ' is-quiz' : ''}`;
      button.type = 'button';
      button.dataset.index = String(index);
      button.addEventListener('click', () => {
        tonePlayer.unlock();
        setScene(index, { narrate: true, focus: true, announceScene: true });
      });
      item.append(button);
      fragment.append(item);
    });
    dom.progressDots.replaceChildren(fragment);
    dom.totalNumber.textContent = String(scenes.length).padStart(2, '0');
    localizeProgress();
  }

  function localizeProgress() {
    const t = copy();
    dom.progressDots.setAttribute('aria-label', format(t.progressAria, { total: scenes.length }));
    [...dom.progressDots.querySelectorAll('.progress-dot')].forEach((button, index) => {
      button.setAttribute('aria-label', format(t.progressScene, {
        number: index + 1,
        title: scenes[index][state.language].title,
      }));
    });
  }

  function renderScene() {
    const scene = scenes[state.index];
    const c = content(scene);
    const t = copy();
    state.visited.add(scene.id);

    dom.experience.dataset.tone = scene.tone;
    dom.experience.dataset.layout = scene.layout;
    dom.experience.style.setProperty('--scene-focal', scene.focal || '50% 50%');
    atmosphere.setTone(scene.tone);

    dom.storyEyebrow.textContent = c.chapter;
    dom.storyScale.textContent = scene.scale;
    dom.storyTitle.textContent = c.title;
    dom.storyLede.textContent = c.lede;
    dom.storyNote.textContent = c.note;
    dom.chapterChipText.textContent = c.chapter;
    dom.progressLabel.textContent = c.chapter.replace(/^\d+\s*·\s*/, '');
    dom.currentNumber.textContent = String(state.index + 1).padStart(2, '0');
    dom.scaleTermWord.textContent = c.term[0];
    dom.scaleTermMeaning.textContent = `${c.term[1]} · ${c.term[2]}`;
    dom.factGrid.replaceChildren(...c.facts.map(createFact));
    renderQuiz(scene, c);

    dom.previousButton.disabled = state.index === 0;
    const isFinale = scene.kind === 'finale';
    dom.nextButtonLabel.textContent = isFinale ? t.restart : t.next;
    dom.nextButton.setAttribute('aria-label', isFinale ? t.restartAria : t.nextAria);

    [...dom.progressDots.querySelectorAll('.progress-dot')].forEach((button, index) => {
      const progressScene = scenes[index];
      button.classList.toggle('is-current', index === state.index);
      button.classList.toggle('is-visited', state.visited.has(progressScene.id));
      if (index === state.index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });

    const physicalPosition = scene.kind === 'finale'
      ? ((scenes.find((item) => item.id === 'human').order + 20) / 42.6) * 100
      : ((scene.order + 20) / 42.6) * 100;
    dom.scaleRailMarker.style.left = `${Math.max(0, Math.min(100, physicalPosition))}%`;
    dom.scaleRailFill.style.width = `${state.index / (scenes.length - 1) * 100}%`;
    applyPanelForScene(scene);
    loadTranscript(scene);
    setNarrationState(state.sound ? 'ready' : 'muted', state.sound ? t.narrationReady : t.narrationMuted);
    changeArtwork(scene.image, scene.focal);
  }

  function createFact(fact) {
    const item = document.createElement('div');
    item.className = 'fact-item';
    const value = document.createElement('strong');
    const label = document.createElement('b');
    const caption = document.createElement('small');
    value.textContent = fact[0];
    label.textContent = fact[1];
    caption.textContent = fact[2];
    item.append(value, label, caption);
    return item;
  }

  function renderQuiz(scene, c) {
    dom.quizBlock.replaceChildren();
    if (!c.quiz) {
      dom.quizBlock.hidden = true;
      return;
    }

    const t = copy();
    const answer = state.answers.get(scene.id);
    const kicker = document.createElement('p');
    kicker.className = 'quiz-kicker';
    kicker.textContent = t.quizKicker;
    const title = document.createElement('h2');
    title.id = 'quizQuestion';
    title.textContent = c.quiz.question;
    const options = document.createElement('div');
    options.className = 'quiz-options';

    c.quiz.options.forEach((option, index) => {
      const button = document.createElement('button');
      button.className = 'quiz-option';
      button.type = 'button';
      button.dataset.answer = String(index);
      button.setAttribute('aria-label', format(t.answerAria, { number: index + 1, answer: option }));
      const number = document.createElement('i');
      number.textContent = String(index + 1);
      const label = document.createElement('span');
      label.textContent = option;
      button.append(number, label);
      if (answer !== undefined) {
        button.disabled = true;
        button.classList.toggle('is-selected', index === answer);
        button.classList.toggle('is-correct', index === c.quiz.answer);
      } else {
        button.addEventListener('click', () => answerQuiz(scene, index));
      }
      options.append(button);
    });

    dom.quizBlock.append(kicker, title, options);
    if (answer !== undefined) dom.quizBlock.append(createQuizFeedback(c, answer));
    dom.quizBlock.hidden = false;
  }

  function createQuizFeedback(c, answer) {
    const feedback = document.createElement('p');
    feedback.className = 'quiz-feedback';
    const verdict = document.createElement('strong');
    verdict.textContent = answer === c.quiz.answer ? copy().quizCorrect : copy().quizIncorrect;
    feedback.append(verdict, document.createTextNode(` ${c.quiz.explanation}`));
    return feedback;
  }

  function answerQuiz(scene, answer) {
    const c = content(scene);
    if (!c.quiz || state.answers.has(scene.id)) return;
    state.answers.set(scene.id, answer);
    tonePlayer.unlock();
    tonePlayer.play(answer === c.quiz.answer);
    renderQuiz(scene, c);
    announce(`${answer === c.quiz.answer ? copy().quizCorrect : copy().quizIncorrect} ${c.quiz.explanation}`);
  }

  function answerQuizByKeyboard(key) {
    const scene = scenes[state.index];
    const c = content(scene);
    if (!c.quiz || state.answers.has(scene.id)) return false;
    const index = Number(key) - 1;
    if (index < 0 || index >= c.quiz.options.length) return false;
    answerQuiz(scene, index);
    return true;
  }

  function applyPanelForScene(scene) {
    const quizNeedsPanel = scene.kind === 'quiz' && !state.answers.has(scene.id);
    state.panelVisible = quizNeedsPanel || state.panelPreferred;
    dom.experience.dataset.panel = state.panelVisible ? 'visible' : 'hidden';
    updatePanelButton();
  }

  function setPanelVisible(visible, userInitiated = false) {
    state.panelVisible = visible;
    if (userInitiated) {
      state.panelPreferred = visible;
      safeStorageSet('smallLargePanel', visible ? 'visible' : 'hidden');
    }
    dom.experience.dataset.panel = visible ? 'visible' : 'hidden';
    updatePanelButton();
    if (userInitiated) announce(visible ? copy().statusPanelShown : copy().statusPanelHidden);
  }

  function updatePanelButton() {
    const t = copy();
    dom.panelButton.setAttribute('aria-pressed', String(state.panelVisible));
    dom.panelButton.setAttribute('aria-label', state.panelVisible ? t.panelHide : t.panelShow);
  }

  function setCaptions(visible, announceChange = true) {
    state.captions = visible;
    dom.transcriptCard.hidden = !visible;
    updateCaptionButton();
    if (announceChange) announce(visible ? copy().statusCaptionsShown : copy().statusCaptionsHidden);
    if (visible) dom.transcriptCard.scrollTop = 0;
  }

  function updateCaptionButton() {
    const t = copy();
    dom.captionButton.setAttribute('aria-pressed', String(state.captions));
    dom.captionButton.setAttribute('aria-label', state.captions ? t.captionsHide : t.captionsShow);
  }

  function setSound(enabled, announceChange = true) {
    state.sound = enabled;
    safeStorageSet('smallLargeSound', enabled ? 'on' : 'off');
    if (!enabled) {
      narrator.pause();
      setNarrationState('muted', copy().narrationMuted);
    } else if (state.started) {
      tonePlayer.unlock();
      if (dom.narrationAudio.src && !dom.narrationAudio.ended) narrator.resume();
      else narrator.play(scenes[state.index]);
    }
    updateSoundButton();
    if (announceChange) announce(enabled ? copy().statusSoundOn : copy().statusSoundOff);
  }

  function updateSoundButton() {
    const t = copy();
    dom.soundButton.setAttribute('aria-pressed', String(state.sound));
    dom.soundButton.setAttribute('aria-label', state.sound ? t.soundOff : t.soundOn);
  }

  async function loadTranscript(scene) {
    const language = state.language;
    const key = `${language}:${scene.id}`;
    const token = ++state.transcriptToken;
    const fallback = scene[language].narration;
    dom.transcriptText.textContent = copy().transcriptLoading;
    dom.transcriptCard.dataset.fallback = 'false';

    if (state.transcriptCache.has(key)) {
      dom.transcriptText.textContent = state.transcriptCache.get(key);
      return;
    }

    try {
      const response = await fetch(`${meta.audioBase}/${language}/${scene.id}.txt`, { cache: 'force-cache' });
      if (!response.ok) throw new Error(`Transcript returned ${response.status}`);
      const transcript = (await response.text()).trim();
      if (!transcript) throw new Error('Transcript was empty');
      state.transcriptCache.set(key, transcript);
      if (token === state.transcriptToken && language === state.language) dom.transcriptText.textContent = transcript;
    } catch (error) {
      if (token !== state.transcriptToken || language !== state.language) return;
      dom.transcriptCard.dataset.fallback = 'true';
      dom.transcriptText.textContent = fallback;
      if (state.captions) announce(copy().transcriptError);
    }
  }

  function changeArtwork(source, focal = '50% 50%') {
    const token = ++state.imageToken;
    const incomingIndex = state.visibleImage === 0 ? 1 : 0;
    const incoming = dom.sceneImages[incomingIndex];
    const outgoing = dom.sceneImages[state.visibleImage];
    incoming.style.objectPosition = focal;
    incoming.src = source;

    const reveal = () => {
      if (token !== state.imageToken) return;
      incoming.classList.add('is-visible');
      outgoing.classList.remove('is-visible');
      state.visibleImage = incomingIndex;
    };

    if (incoming.complete && incoming.naturalWidth) {
      if (incoming.decode) incoming.decode().then(reveal).catch(reveal);
      else reveal();
      return;
    }

    incoming.addEventListener('load', reveal, { once: true });
    incoming.addEventListener('error', () => {
      if (token === state.imageToken) announce(state.language === 'ja' ? 'この場面の画像を読み込めませんでした。' : 'This scene artwork could not be loaded.');
    }, { once: true });
  }

  function warmArtwork() {
    if (state.warmStarted) return;
    state.warmStarted = true;
    const uniqueSources = [...new Set(scenes.map((scene) => scene.image))]
      .filter((source) => source !== meta.openingImage);
    let index = 0;

    const warmNext = () => {
      if (index >= uniqueSources.length) return;
      const image = new Image();
      image.decoding = 'async';
      image.onload = image.onerror = () => {
        index += 1;
        window.setTimeout(warmNext, 100);
      };
      image.src = uniqueSources[index];
    };

    if ('requestIdleCallback' in window) window.requestIdleCallback(warmNext, { timeout: 1300 });
    else window.setTimeout(warmNext, 500);
  }

  function setScene(index, options = {}) {
    const { narrate = false, focus = false, announceScene = false } = options;
    if (!state.started || index < 0 || index >= scenes.length) return;
    state.index = index;
    renderScene();
    if (narrate) narrator.play(scenes[index]);
    else narrator.stop(false);
    if (focus && state.panelVisible) {
      window.setTimeout(() => dom.storyCard.focus({ preventScroll: true }), state.reducedMotion ? 0 : 320);
    }
    if (announceScene) {
      const message = format(copy().statusScene, {
        current: index + 1,
        total: scenes.length,
        title: content().title,
      });
      announce(message);
    }
  }

  function startJourney() {
    tonePlayer.unlock();
    state.started = true;
    state.index = 0;
    state.visited.clear();
    dom.experience.dataset.phase = 'story';
    dom.introOverlay.hidden = true;
    dom.storyStage.hidden = false;
    dom.chapterChip.hidden = false;
    dom.panelButton.hidden = false;
    dom.captionButton.hidden = false;
    dom.soundButton.hidden = false;
    renderScene();
    narrator.play(scenes[0]);
    atmosphere.start();
    warmArtwork();
    window.setTimeout(() => dom.storyCard.focus({ preventScroll: true }), state.reducedMotion ? 0 : 450);
    announce(copy().statusStarted);
  }

  function returnToIntro() {
    narrator.stop();
    state.started = false;
    state.index = 0;
    state.answers.clear();
    state.visited.clear();
    setCaptions(false, false);
    dom.experience.dataset.phase = 'intro';
    dom.experience.dataset.tone = 'human';
    dom.experience.dataset.layout = 'left';
    dom.storyStage.hidden = true;
    dom.introOverlay.hidden = false;
    dom.chapterChip.hidden = true;
    dom.panelButton.hidden = true;
    dom.captionButton.hidden = true;
    dom.soundButton.hidden = true;
    setPanelVisible(state.panelPreferred);
    changeArtwork(meta.openingImage, '50% 52%');
    dom.startButton.focus({ preventScroll: true });
  }

  function setLanguage(language, options = {}) {
    if (!meta.languages.includes(language)) return;
    const changed = language !== state.language;
    state.language = language;
    safeStorageSet('smallLargeLanguage', language);
    updateStaticLanguage();
    if (state.started) {
      renderScene();
      if (options.narrate !== false) narrator.play(scenes[state.index]);
    }
    if (changed && options.announce !== false) announce(copy().statusLanguage);
  }

  function openInfo() {
    state.dialogWasPlaying = narrator.isPlaying();
    if (state.dialogWasPlaying) narrator.pause();
    if (typeof dom.infoDialog.showModal === 'function') dom.infoDialog.showModal();
    else dom.infoDialog.setAttribute('open', '');
  }

  function closeInfo() {
    if (typeof dom.infoDialog.close === 'function') dom.infoDialog.close();
    else dom.infoDialog.removeAttribute('open');
  }

  function handleInfoClosed() {
    if (state.dialogWasPlaying && state.sound && state.started) narrator.resume();
    state.dialogWasPlaying = false;
    dom.infoButton.focus({ preventScroll: true });
  }

  function handleKeyboard(event) {
    const dialogOpen = dom.infoDialog.open || dom.infoDialog.hasAttribute('open');
    if (dialogOpen) {
      if (event.key === 'Escape') closeInfo();
      return;
    }

    const key = event.key.toLowerCase();
    if (key === 'l') {
      event.preventDefault();
      setLanguage(state.language === 'en' ? 'ja' : 'en', { announce: true, narrate: state.started });
      return;
    }
    if (key === 'i') {
      event.preventDefault();
      openInfo();
      return;
    }
    if (!state.started) return;
    if (['1', '2', '3'].includes(event.key) && answerQuizByKeyboard(event.key)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (state.index < scenes.length - 1) setScene(state.index + 1, { narrate: true, focus: true, announceScene: true });
      else returnToIntro();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (state.index > 0) setScene(state.index - 1, { narrate: true, focus: true, announceScene: true });
    } else if (key === 'r') {
      event.preventDefault();
      tonePlayer.unlock();
      narrator.play(scenes[state.index], true);
    } else if (key === 'c') {
      event.preventDefault();
      setCaptions(!state.captions);
    } else if (key === 'm') {
      event.preventDefault();
      setSound(!state.sound);
    } else if (key === 'p') {
      event.preventDefault();
      setPanelVisible(!state.panelVisible, true);
    }
  }

  function bindEvents() {
    dom.languageButtons.forEach((button) => {
      button.addEventListener('click', () => {
        tonePlayer.unlock();
        setLanguage(button.dataset.language, { announce: state.started, narrate: state.started });
      });
    });
    dom.startButton.addEventListener('click', startJourney);
    dom.previousButton.addEventListener('click', () => {
      tonePlayer.unlock();
      if (state.index > 0) setScene(state.index - 1, { narrate: true, focus: true, announceScene: true });
    });
    dom.nextButton.addEventListener('click', () => {
      tonePlayer.unlock();
      if (state.index < scenes.length - 1) setScene(state.index + 1, { narrate: true, focus: true, announceScene: true });
      else returnToIntro();
    });
    dom.panelButton.addEventListener('click', () => setPanelVisible(!state.panelVisible, true));
    dom.captionButton.addEventListener('click', () => setCaptions(!state.captions));
    dom.closeTranscriptButton.addEventListener('click', () => {
      setCaptions(false);
      dom.captionButton.focus({ preventScroll: true });
    });
    dom.soundButton.addEventListener('click', () => {
      tonePlayer.unlock();
      setSound(!state.sound);
    });
    dom.replayNarrationButton.addEventListener('click', () => {
      tonePlayer.unlock();
      narrator.play(scenes[state.index], true);
    });
    dom.infoButton.addEventListener('click', openInfo);
    dom.infoCloseButton.addEventListener('click', closeInfo);
    dom.infoDialog.addEventListener('close', handleInfoClosed);
    dom.infoDialog.addEventListener('click', (event) => {
      const bounds = dom.infoDialog.getBoundingClientRect();
      const outside = event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
      if (outside) closeInfo();
    });
    document.addEventListener('keydown', handleKeyboard);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        state.visibilityWasPlaying = narrator.isPlaying();
        if (state.visibilityWasPlaying) narrator.pause();
      } else if (state.visibilityWasPlaying && state.sound && state.started) {
        narrator.resume();
        state.visibilityWasPlaying = false;
      }
    });

    const handleMotionChange = (event) => {
      state.reducedMotion = event.matches;
      if (state.reducedMotion) atmosphere.stop();
      else if (state.started) atmosphere.start();
    };
    if (motionPreference.addEventListener) motionPreference.addEventListener('change', handleMotionChange);
    else motionPreference.addListener(handleMotionChange);
  }

  buildProgress();
  bindEvents();
  setLanguage(initialLanguage, { announce: false, narrate: false });
  setPanelVisible(state.panelPreferred);
  updateCaptionButton();
  updateSoundButton();
})();
