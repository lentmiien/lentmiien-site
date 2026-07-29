'use strict';

(() => {
  const story = window.GALAXY_CENTER_STORY;
  const scenes = story?.scenes || [];
  const ui = story?.ui || {};
  if (!scenes.length) return;

  const dom = {
    experience: document.getElementById('experience'),
    skipLink: document.getElementById('skipLink'),
    backControl: document.getElementById('backControl'),
    brandLockup: document.getElementById('brandLockup'),
    introOverlay: document.getElementById('introOverlay'),
    startButton: document.getElementById('startButton'),
    storyStage: document.getElementById('storyStage'),
    storyCard: document.getElementById('storyCard'),
    storyEyebrow: document.getElementById('storyEyebrow'),
    storyLocation: document.getElementById('storyLocation'),
    storyTitle: document.getElementById('storyTitle'),
    storyLede: document.getElementById('storyLede'),
    storyBody: document.getElementById('storyBody'),
    signalWord: document.getElementById('signalWord'),
    chapterChip: document.getElementById('chapterChip'),
    chapterChipText: document.getElementById('chapterChipText'),
    chapterWaypointText: document.getElementById('chapterWaypointText'),
    currentNumber: document.getElementById('currentNumber'),
    totalNumber: document.getElementById('totalNumber'),
    progressLabel: document.getElementById('progressLabel'),
    progressDots: document.getElementById('progressDots'),
    routeMarker: document.getElementById('routeMarker'),
    previousButton: document.getElementById('previousButton'),
    nextButton: document.getElementById('nextButton'),
    nextButtonLabel: document.getElementById('nextButtonLabel'),
    panelButton: document.getElementById('panelButton'),
    panelControlLabel: document.getElementById('panelControlLabel'),
    captionButton: document.getElementById('captionButton'),
    captionControlLabel: document.getElementById('captionControlLabel'),
    closeTranscriptButton: document.getElementById('closeTranscriptButton'),
    transcriptCard: document.getElementById('transcriptCard'),
    transcriptText: document.getElementById('transcriptText'),
    soundButton: document.getElementById('soundButton'),
    soundControlLabel: document.getElementById('soundControlLabel'),
    replayNarrationButton: document.getElementById('replayNarrationButton'),
    narrationStatus: document.getElementById('narrationStatus'),
    narrationLabel: document.getElementById('narrationLabel'),
    audioProgressTrack: document.getElementById('audioProgressTrack'),
    audioProgress: document.getElementById('audioProgress'),
    narrationAudio: document.getElementById('narrationAudio'),
    infoButton: document.getElementById('infoButton'),
    infoDialog: document.getElementById('infoDialog'),
    infoCloseButton: document.getElementById('infoCloseButton'),
    sourceList: document.getElementById('sourceList'),
    statusAnnouncer: document.getElementById('statusAnnouncer'),
    sceneImages: [
      document.getElementById('sceneImageA'),
      document.getElementById('sceneImageB'),
    ],
    canvas: document.getElementById('atmosphereCanvas'),
  };

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const savedSound = safeStorageGet('galaxyCenterSound');
  const savedPanel = safeStorageGet('galaxyCenterPanel');
  const state = {
    started: false,
    index: 0,
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
  };

  class InterfaceTonePlayer {
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
      const notes = kind === 'discovery'
        ? [392, 523.25, 659.25]
        : [293.66, 392];

      notes.forEach((frequency, index) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = index === 0 ? 'sine' : 'triangle';
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + index * 0.07);
        gain.gain.exponentialRampToValueAtTime(
          kind === 'discovery' ? 0.025 : 0.012,
          now + index * 0.07 + 0.018,
        );
        gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.07 + 0.28);
        oscillator.connect(gain);
        gain.connect(this.context.destination);
        oscillator.start(now + index * 0.07);
        oscillator.stop(now + index * 0.07 + 0.3);
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
        setNarrationState('playing', ui.narrationPlaying);
      });

      this.audio.addEventListener('pause', () => {
        if (!this.audio.ended && this.audio.currentTime > 0 && this.audio.src) {
          setNarrationState('paused', ui.narrationPaused);
        }
      });

      this.audio.addEventListener('ended', () => {
        setAudioProgress(100);
        setNarrationState('complete', ui.narrationComplete);
      });

      this.audio.addEventListener('timeupdate', () => {
        if (!Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
        setAudioProgress(Math.min(100, this.audio.currentTime / this.audio.duration * 100));
      });

      this.audio.addEventListener('error', () => {
        if (!this.audio.src) return;
        setNarrationState('error', ui.narrationError);
      });
    }

    play(scene, restart = false) {
      this.stop(false);
      this.activeScene = scene;
      if (!state.sound) {
        setNarrationState('muted', ui.narrationMuted);
        return;
      }

      const token = ++this.playToken;
      setAudioProgress(0);
      setNarrationState('loading', ui.narrationLoading);
      this.audio.src = `assets/audio/${scene.audio}.mp3`;
      this.audio.currentTime = 0;
      this.audio.preload = 'auto';
      const playPromise = this.audio.play();

      if (playPromise) {
        playPromise.catch(() => {
          if (token !== this.playToken) return;
          setNarrationState('ready', restart ? ui.narrationPlayPrompt : ui.narrationPlayPrompt);
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
        setNarrationState('ready', state.sound ? ui.narrationReady : ui.narrationMuted);
      }
    }

    pause() {
      if (!this.audio.paused) this.audio.pause();
    }

    resume() {
      if (!state.sound || !this.audio.src || this.audio.ended) return;
      this.audio.play().catch(() => setNarrationState('ready', ui.narrationPlayPrompt));
    }

    isPlaying() {
      return !this.audio.paused && !this.audio.ended && Boolean(this.audio.src);
    }
  }

  class GalacticAtmosphere {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas?.getContext('2d') || null;
      this.stars = [];
      this.frame = 0;
      this.lastTime = 0;
      this.tone = 'home';
      this.running = false;
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
      const count = window.innerWidth < 760 ? 24 : 46;
      this.stars = Array.from({ length: count }, () => ({
        x: Math.random() * this.canvas.width,
        y: Math.random() * this.canvas.height,
        radius: (0.25 + Math.random() * 0.9) * ratio,
        speed: (0.012 + Math.random() * 0.028) * ratio,
        drift: (Math.random() - 0.5) * 0.012 * ratio,
        alpha: 0.08 + Math.random() * 0.28,
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
        home: '255, 194, 71',
        neighbor: '255, 144, 92',
        ember: '255, 106, 31',
        nursery: '112, 214, 255',
        disk: '104, 184, 255',
        pulsar: '91, 222, 255',
        cmz: '245, 119, 220',
        heart: '255, 150, 70',
        finale: '255, 194, 71',
      };
      const color = palette[this.tone] || palette.home;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

      this.stars.forEach((star) => {
        star.y -= star.speed;
        star.x += star.drift + Math.sin(time * 0.00025 + star.phase) * 0.008;
        if (star.y < -3) {
          star.y = this.canvas.height + 3;
          star.x = Math.random() * this.canvas.width;
        }
        const twinkle = 0.74 + Math.sin(time * 0.0014 + star.phase) * 0.26;
        this.context.beginPath();
        this.context.fillStyle = `rgba(${color}, ${star.alpha * twinkle})`;
        this.context.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
        this.context.fill();
      });
      this.frame = requestAnimationFrame(this.animate);
    }
  }

  const tonePlayer = new InterfaceTonePlayer();
  const narrator = new NarrationController(dom.narrationAudio);
  const atmosphere = new GalacticAtmosphere(dom.canvas);

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

  function format(template, replacements) {
    return Object.entries(replacements).reduce(
      (copy, [key, value]) => copy.replaceAll(`{${key}}`, String(value)),
      template,
    );
  }

  function setAudioProgress(value) {
    const rounded = Math.round(value);
    dom.audioProgress.style.width = `${value}%`;
    dom.audioProgressTrack.setAttribute('aria-valuenow', String(rounded));
  }

  function setNarrationState(status, label) {
    dom.narrationStatus.dataset.state = status;
    dom.narrationLabel.textContent = label;
  }

  function applyShellCopy() {
    document.documentElement.lang = ui.documentLanguage;
    document.title = ui.pageTitle;
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = ui.metaDescription;
    dom.skipLink.textContent = ui.skipLink;
    dom.backControl.setAttribute('aria-label', ui.backToGames);
    dom.brandLockup.setAttribute('aria-label', ui.brandLabel);
    dom.infoButton.setAttribute('aria-label', ui.infoOpen);
    dom.storyStage.setAttribute('aria-label', ui.storyStageLabel);
    dom.panelControlLabel.textContent = ui.panelControl;
    dom.captionControlLabel.textContent = ui.captionsControl;
    dom.soundControlLabel.textContent = ui.soundControl;
    dom.replayNarrationButton.setAttribute('aria-label', ui.narrationReplay);
    dom.audioProgressTrack.setAttribute('aria-label', ui.narrationProgress);
    dom.transcriptCard.setAttribute('aria-label', ui.transcriptAria);
    dom.closeTranscriptButton.setAttribute('aria-label', ui.transcriptClose);
  }

  function buildSources() {
    const fragment = document.createDocumentFragment();
    story.sources.forEach((source) => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = source.title;
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
      button.className = 'progress-dot';
      button.type = 'button';
      button.dataset.index = String(index);
      button.setAttribute(
        'aria-label',
        format(ui.progressSceneAria, { number: index + 1, title: scene.copy.title }),
      );
      button.addEventListener('click', () => setScene(index, { narrate: true, focus: true }));
      item.append(button);
      fragment.append(item);
    });
    dom.progressDots.replaceChildren(fragment);
    dom.totalNumber.textContent = String(scenes.length).padStart(2, '0');
    dom.progressDots.setAttribute('aria-label', format(ui.scenesLabel, { count: scenes.length }));
  }

  function warmArtwork() {
    const sources = [...new Set(scenes.slice(1).map((scene) => scene.image))];
    let sourceIndex = 0;

    const warmNext = (deadline) => {
      while (
        sourceIndex < sources.length
        && (!deadline || deadline.timeRemaining() > 4 || deadline.didTimeout)
      ) {
        const image = new Image();
        image.decoding = 'async';
        image.src = sources[sourceIndex];
        sourceIndex += 1;
        if (!deadline) break;
      }

      if (sourceIndex >= sources.length) return;
      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(warmNext, { timeout: 1800 });
      } else {
        window.setTimeout(() => warmNext(null), 240);
      }
    };

    if ('requestIdleCallback' in window) {
      window.requestIdleCallback(warmNext, { timeout: 1200 });
    } else {
      window.setTimeout(() => warmNext(null), 300);
    }
  }

  function applySceneFocus(scene) {
    dom.experience.style.setProperty('--scene-focus-desktop', scene.focal.desktop);
    dom.experience.style.setProperty('--scene-focus-mobile', scene.focal.mobile);
  }

  function setBackground(scene, immediate = false) {
    const token = ++state.imageToken;
    const currentImage = dom.sceneImages[state.visibleImage];
    const nextIndex = state.visibleImage === 0 ? 1 : 0;
    const nextImage = dom.sceneImages[nextIndex];
    applySceneFocus(scene);

    if (currentImage.getAttribute('src') === scene.image && !immediate) {
      currentImage.style.objectPosition = scene.focal.desktop;
      return;
    }

    nextImage.src = scene.image;
    nextImage.style.objectPosition = scene.focal.desktop;
    const reveal = () => {
      if (token !== state.imageToken) return;
      nextImage.classList.add('is-visible');
      currentImage.classList.remove('is-visible');
      state.visibleImage = nextIndex;
    };

    if (immediate || nextImage.complete) {
      requestAnimationFrame(reveal);
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

  function renderQuiz(scene) {
    const copy = scene.copy;
    const wrap = document.createElement('div');
    wrap.className = 'quiz-wrap';
    const question = document.createElement('p');
    question.className = 'quiz-question';
    question.textContent = copy.question;
    const options = document.createElement('div');
    options.className = 'quiz-options';
    options.setAttribute('role', 'group');
    options.setAttribute('aria-label', format(ui.quizGroup, { question: copy.question }));
    const answered = state.answers.get(scene.id);

    copy.options.forEach((label, index) => {
      const option = document.createElement('button');
      const key = document.createElement('kbd');
      const text = document.createElement('span');
      option.className = 'quiz-option';
      option.type = 'button';
      option.dataset.key = String(index + 1);
      option.setAttribute(
        'aria-label',
        format(ui.quizOption, { number: index + 1, label }),
      );
      key.textContent = String(index + 1);
      text.textContent = label;
      option.append(key, text);

      if (answered) {
        option.disabled = true;
        option.classList.toggle('is-correct', index === copy.answer);
        option.classList.toggle('is-selected', index === answered.selection);
        option.classList.toggle(
          'is-dimmed',
          index !== copy.answer && index !== answered.selection,
        );
      } else {
        option.addEventListener('click', () => answerQuiz(scene, index));
      }
      options.append(option);
    });

    wrap.append(question, options);
    if (answered) {
      const feedback = document.createElement('p');
      feedback.className = 'quiz-feedback';
      const lead = document.createElement('strong');
      lead.textContent = answered.correct ? ui.quizCorrectLead : ui.quizDiscoverLead;
      feedback.append(lead, document.createTextNode(copy.explanation));
      wrap.append(feedback);
    }
    return wrap;
  }

  function createFinalePanel() {
    const panel = document.createElement('div');
    panel.className = 'finale-panel';
    const copy = document.createElement('span');
    const label = document.createElement('small');
    const title = document.createElement('strong');
    const visited = document.createElement('b');
    const replay = document.createElement('button');
    label.textContent = ui.finaleVisitedLabel;
    title.textContent = state.answers.size === story.meta.quizzes
      ? ui.finaleComplete
      : ui.finaleIncomplete;
    visited.textContent = `${state.answers.size} / ${story.meta.quizzes}`;
    replay.className = 'replay-journey';
    replay.type = 'button';
    replay.textContent = ui.restart;
    replay.addEventListener('click', restartJourney);
    copy.append(label, title);
    panel.append(copy, visited, replay);
    return panel;
  }

  function renderStoryBody(scene) {
    dom.storyBody.replaceChildren();
    if (scene.kind === 'quiz') {
      dom.storyBody.append(renderQuiz(scene));
      return;
    }

    dom.storyBody.append(createFactGrid(scene.copy.facts));
    if (scene.copy.note) dom.storyBody.append(createNote(scene.copy.note));
    if (scene.kind === 'finale') dom.storyBody.append(createFinalePanel());
  }

  function renderTerm(term) {
    const label = document.createElement('small');
    const word = document.createElement('strong');
    const meaning = document.createElement('em');
    label.textContent = ui.signalWord;
    word.textContent = term.name;
    meaning.textContent = `${term.meaning} · ${term.pronunciation}`;
    dom.signalWord.replaceChildren(label, word, meaning);
  }

  function updateProgress(scene) {
    dom.currentNumber.textContent = String(state.index + 1).padStart(2, '0');
    dom.progressLabel.textContent = scene.copy.progress;
    dom.chapterChipText.textContent = scene.copy.progress;
    dom.chapterWaypointText.textContent = scene.waypoint;
    dom.routeMarker.style.setProperty(
      '--route-progress',
      `${state.index / Math.max(1, scenes.length - 1) * 100}%`,
    );

    [...dom.progressDots.querySelectorAll('.progress-dot')].forEach((dot, index) => {
      dot.classList.toggle('is-current', index === state.index);
      dot.classList.toggle('is-visited', index < state.index);
      dot.classList.toggle('is-quiz', scenes[index].kind === 'quiz');
      dot.setAttribute('aria-current', index === state.index ? 'step' : 'false');
    });
  }

  function updateNavigation(scene) {
    dom.previousButton.disabled = state.index === 0;
    const unansweredQuiz = scene.kind === 'quiz' && !state.answers.has(scene.id);
    dom.nextButton.disabled = unansweredQuiz;
    dom.nextButtonLabel.textContent = scene.kind === 'finale'
      ? ui.restartLabel
      : unansweredQuiz ? ui.answerToContinue : ui.next;
    dom.nextButton.setAttribute(
      'aria-label',
      scene.kind === 'finale'
        ? ui.restartAria
        : unansweredQuiz ? ui.answerToContinueAria : ui.nextAria,
    );
  }

  function syncPanelForScene(scene, announce = false) {
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
      ? ui.panelQuizLocked
      : visible ? ui.panelHide : ui.panelShow;
    dom.panelButton.setAttribute('aria-label', label);
    dom.panelButton.title = label;

    if (announce && changed) {
      dom.statusAnnouncer.textContent = visible
        ? ui.panelShownAnnouncement
        : ui.panelHiddenAnnouncement;
    }
  }

  function togglePanel() {
    const scene = scenes[state.index];
    if (scene.kind === 'quiz') return;
    state.panelPreferred = !state.panelPreferred;
    safeStorageSet(
      'galaxyCenterPanel',
      state.panelPreferred ? 'visible' : 'hidden',
    );
    syncPanelForScene(scene, true);
  }

  function fetchTranscript(scene) {
    const token = ++state.transcriptToken;
    dom.transcriptText.textContent = ui.transcriptLoading;
    if (state.transcriptCache.has(scene.audio)) {
      dom.transcriptText.textContent = state.transcriptCache.get(scene.audio);
      return;
    }

    fetch(`assets/audio/${scene.audio}.txt`, { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`Transcript returned ${response.status}`);
        return response.text();
      })
      .then((text) => {
        const transcript = text.trim() || scene.copy.lede;
        state.transcriptCache.set(scene.audio, transcript);
        if (token === state.transcriptToken) {
          dom.transcriptText.textContent = transcript;
        }
      })
      .catch(() => {
        if (token === state.transcriptToken) {
          dom.transcriptText.textContent = `${ui.transcriptError} ${scene.copy.lede}`;
        }
      });
  }

  function setScene(index, options = {}) {
    if (!state.started) return;
    const nextIndex = Math.max(0, Math.min(scenes.length - 1, index));
    const scene = scenes[nextIndex];
    const changed = nextIndex !== state.index;

    narrator.stop(false);
    state.index = nextIndex;
    dom.storyCard.classList.remove('is-visible');
    dom.experience.dataset.tone = scene.tone;
    dom.experience.dataset.layout = scene.layout;
    atmosphere.setTone(scene.tone);
    setBackground(scene, !changed && nextIndex === 0);

    dom.storyEyebrow.textContent = scene.copy.eyebrow;
    dom.storyLocation.textContent = scene.copy.location;
    dom.storyTitle.textContent = scene.copy.title;
    dom.storyLede.textContent = scene.copy.lede;
    renderStoryBody(scene);
    renderTerm(scene.term);
    updateProgress(scene);
    updateNavigation(scene);
    syncPanelForScene(scene);
    fetchTranscript(scene);
    document.title = `${scene.copy.title} · Galactic Center`;
    dom.statusAnnouncer.textContent = format(ui.sceneAnnouncement, {
      number: state.index + 1,
      count: scenes.length,
      title: scene.copy.title,
    });
    dom.storyCard.scrollTop = 0;

    requestAnimationFrame(() => requestAnimationFrame(() => {
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
    const correct = selection === scene.copy.answer;
    state.answers.set(scene.id, { selection, correct });
    renderStoryBody(scene);
    updateNavigation(scene);
    tonePlayer.play('discovery');
    dom.statusAnnouncer.textContent = correct
      ? format(ui.quizCorrectAnnouncement, { explanation: scene.copy.explanation })
      : format(ui.quizDiscoverAnnouncement, { explanation: scene.copy.explanation });

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
    syncSoundButton();
    dom.introOverlay.classList.add('is-leaving');
    atmosphere.start();
    setScene(0, { narrate: true, focus: true });
    window.setTimeout(() => {
      dom.introOverlay.hidden = true;
    }, state.reducedMotion ? 30 : 780);
  }

  function restartJourney() {
    state.answers.clear();
    tonePlayer.play('navigate');
    setScene(0, { narrate: true, focus: true });
  }

  function goNext() {
    const scene = scenes[state.index];
    if (scene.kind === 'quiz' && !state.answers.has(scene.id)) return;
    tonePlayer.unlock();
    tonePlayer.play('navigate');
    if (state.index === scenes.length - 1) {
      restartJourney();
    } else {
      setScene(state.index + 1, { narrate: true, focus: true });
    }
  }

  function goPrevious() {
    if (state.index <= 0) return;
    tonePlayer.unlock();
    tonePlayer.play('navigate');
    setScene(state.index - 1, { narrate: true, focus: true });
  }

  function syncSoundButton() {
    dom.soundButton.setAttribute('aria-pressed', String(state.sound));
    dom.soundButton.setAttribute('aria-label', state.sound ? ui.soundOff : ui.soundOn);
  }

  function toggleSound() {
    state.sound = !state.sound;
    safeStorageSet('galaxyCenterSound', state.sound ? 'on' : 'off');
    syncSoundButton();
    if (state.sound) {
      tonePlayer.unlock();
      narrator.play(scenes[state.index]);
      dom.statusAnnouncer.textContent = ui.soundOnAnnouncement;
    } else {
      narrator.stop(false);
      setNarrationState('muted', ui.narrationMuted);
      dom.statusAnnouncer.textContent = ui.soundOffAnnouncement;
    }
  }

  function setCaptions(visible, focus = false) {
    state.captions = Boolean(visible);
    dom.transcriptCard.hidden = !state.captions;
    dom.captionButton.setAttribute('aria-pressed', String(state.captions));
    dom.captionButton.setAttribute('aria-expanded', String(state.captions));
    dom.captionButton.setAttribute(
      'aria-label',
      state.captions ? ui.captionsHide : ui.captionsShow,
    );
    dom.statusAnnouncer.textContent = state.captions
      ? ui.captionsShownAnnouncement
      : ui.captionsHiddenAnnouncement;
    if (state.captions && focus) {
      requestAnimationFrame(() => dom.transcriptCard.focus({ preventScroll: true }));
    }
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

  function closeInfo() {
    if (typeof dom.infoDialog.close === 'function') {
      dom.infoDialog.close();
    } else {
      dom.infoDialog.removeAttribute('open');
      if (state.dialogWasPlaying) narrator.resume();
      state.dialogWasPlaying = false;
    }
  }

  function chooseQuizByKeyboard(key) {
    const scene = scenes[state.index];
    if (scene.kind !== 'quiz' || state.answers.has(scene.id)) return false;
    const selection = Number(key) - 1;
    if (selection < 0 || selection >= scene.copy.options.length) return false;
    answerQuiz(scene, selection);
    return true;
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (dom.infoDialog.open) return;
    const target = event.target;
    const key = event.key.toLowerCase();
    const globalShortcuts = ['r', 'c', 'm', 'p'];

    if (!state.started && (event.key === 'Enter' || event.key === ' ')) {
      if (target === dom.startButton || target === document.body) {
        event.preventDefault();
        startExperience();
      }
      return;
    }
    if (!state.started) return;

    if (event.key === 'Escape' && state.captions) {
      event.preventDefault();
      setCaptions(false);
      dom.captionButton.focus({ preventScroll: true });
      return;
    }

    if (chooseQuizByKeyboard(event.key)) {
      event.preventDefault();
      return;
    }

    if (
      target instanceof HTMLButtonElement
      || target instanceof HTMLAnchorElement
      || target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
    ) {
      if (!globalShortcuts.includes(key)) return;
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
      narrator.play(scenes[state.index], true);
    } else if (key === 'c') {
      event.preventDefault();
      setCaptions(!state.captions, !state.captions);
    } else if (key === 'm') {
      event.preventDefault();
      toggleSound();
    } else if (key === 'p') {
      event.preventDefault();
      togglePanel();
    }
  }

  dom.startButton.addEventListener('click', startExperience);
  dom.previousButton.addEventListener('click', goPrevious);
  dom.nextButton.addEventListener('click', goNext);
  dom.panelButton.addEventListener('click', togglePanel);
  dom.soundButton.addEventListener('click', toggleSound);
  dom.captionButton.addEventListener('click', () => setCaptions(!state.captions, !state.captions));
  dom.closeTranscriptButton.addEventListener('click', () => {
    setCaptions(false);
    dom.captionButton.focus({ preventScroll: true });
  });
  dom.replayNarrationButton.addEventListener('click', () => {
    tonePlayer.unlock();
    if (!state.sound) toggleSound();
    else narrator.play(scenes[state.index], true);
  });
  dom.infoButton.addEventListener('click', openInfo);
  dom.infoCloseButton.addEventListener('click', closeInfo);
  dom.infoDialog.addEventListener('close', () => {
    if (state.dialogWasPlaying) narrator.resume();
    state.dialogWasPlaying = false;
  });
  dom.infoDialog.addEventListener('click', (event) => {
    if (event.target === dom.infoDialog) closeInfo();
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

  applyShellCopy();
  buildSources();
  buildProgress();
  syncSoundButton();
})();
