'use strict';

(() => {
  const slides = window.STORY_SLIDES || [];
  if (!slides.length) return;

  const dom = {
    experience: document.getElementById('experience'),
    introOverlay: document.getElementById('introOverlay'),
    startButton: document.getElementById('startButton'),
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
    narrationAudio: document.getElementById('narrationAudio'),
    infoButton: document.getElementById('infoButton'),
    infoDialog: document.getElementById('infoDialog'),
    statusAnnouncer: document.getElementById('statusAnnouncer'),
    sceneImages: [
      document.getElementById('sceneImageA'),
      document.getElementById('sceneImageB'),
    ],
    canvas: document.getElementById('atmosphereCanvas'),
  };

  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const savedSound = safeStorageGet('kardashevSound');
  const savedPanel = safeStorageGet('kardashevPanel');
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
    correctAnswers: 0,
    dialogWasPlaying: false,
    visibilityWasPlaying: false,
  };

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
      const notes = kind === 'correct' ? [392, 523.25, 659.25] : kind === 'discover' ? [261.63, 329.63] : [196];
      notes.forEach((frequency, index) => {
        const oscillator = this.context.createOscillator();
        const gain = this.context.createGain();
        oscillator.type = index === 0 ? 'sine' : 'triangle';
        oscillator.frequency.value = frequency;
        const start = now + index * 0.07;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(kind === 'correct' ? 0.026 : 0.014, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
        oscillator.connect(gain);
        gain.connect(this.context.destination);
        oscillator.start(start);
        oscillator.stop(start + 0.27);
      });
    }
  }

  class NarrationController {
    constructor(audio) {
      this.audio = audio;
      this.playToken = 0;
      this.activeSlide = null;
      this.audio.volume = 0.92;
      this.bindEvents();
    }

    bindEvents() {
      this.audio.addEventListener('playing', () => {
        setNarrationState('playing', 'English narration playing');
      });

      this.audio.addEventListener('pause', () => {
        if (!this.audio.ended && this.audio.currentTime > 0 && this.audio.src) {
          setNarrationState('paused', 'Narration paused');
        }
      });

      this.audio.addEventListener('ended', () => {
        dom.audioProgress.style.width = '100%';
        setNarrationState('complete', 'Narration complete · replay available');
      });

      this.audio.addEventListener('timeupdate', () => {
        if (!Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
        const progress = Math.min(100, this.audio.currentTime / this.audio.duration * 100);
        dom.audioProgress.style.width = `${progress}%`;
      });

      this.audio.addEventListener('error', () => {
        if (!this.audio.src) return;
        setNarrationState('error', 'Audio unavailable · transcript ready');
        dom.statusAnnouncer.textContent = 'Narration could not be played. The transcript remains available.';
      });
    }

    play(slide, restart = false) {
      this.stop(false);
      this.activeSlide = slide;
      if (!state.sound) {
        setNarrationState('muted', 'Narration muted');
        return;
      }

      const token = ++this.playToken;
      dom.audioProgress.style.width = '0%';
      setNarrationState('loading', 'Loading English narration');
      this.audio.src = `assets/audio/${slide.audio}.mp3`;
      this.audio.currentTime = 0;
      this.audio.preload = 'auto';
      const playPromise = this.audio.play();

      if (playPromise) {
        playPromise.catch(() => {
          if (token !== this.playToken) return;
          setNarrationState('ready', restart ? 'Use replay to try again' : 'Press replay to hear this scene');
        });
      }
    }

    stop(resetState = true) {
      this.playToken += 1;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      dom.audioProgress.style.width = '0%';
      if (resetState) {
        setNarrationState('ready', state.sound ? 'Narration ready' : 'Narration muted');
      }
    }

    pause() {
      if (!this.audio.paused) this.audio.pause();
    }

    resume() {
      if (!state.sound || !this.audio.src || this.audio.ended) return;
      this.audio.play().catch(() => setNarrationState('ready', 'Press replay to hear this scene'));
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
      this.tone = 'signal';
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
        radius: (0.35 + Math.random() * 1.15) * ratio,
        speed: (0.025 + Math.random() * 0.07) * ratio,
        drift: (Math.random() - 0.5) * 0.035 * ratio,
        alpha: 0.06 + Math.random() * 0.2,
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
        signal: '255, 194, 71',
        earth: '77, 180, 255',
        planet: '25, 227, 227',
        lunar: '255, 194, 71',
        stellar: '255, 173, 66',
        forge: '255, 106, 31',
        galactic: '190, 156, 255',
        silence: '125, 183, 255',
        horizon: '255, 194, 71',
      };
      const color = palette[this.tone] || palette.signal;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.motes.forEach((mote) => {
        mote.y -= mote.speed;
        mote.x += mote.drift + Math.sin(time * 0.00025 + mote.phase) * 0.018;
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
      // Storage may be unavailable in private or embedded contexts.
    }
  }

  function setNarrationState(status, label) {
    dom.narrationStatus.dataset.state = status;
    dom.narrationLabel.textContent = label;
  }

  function buildProgress() {
    const fragment = document.createDocumentFragment();
    slides.forEach((slide, index) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.className = 'progress-dot';
      button.type = 'button';
      button.dataset.index = String(index);
      button.setAttribute('aria-label', `Go to scene ${index + 1} of ${slides.length}: ${slide.title}`);
      button.addEventListener('click', () => setSlide(index, { narrate: true, focus: true }));
      item.append(button);
      fragment.append(item);
    });
    dom.progressDots.append(fragment);
    dom.totalNumber.textContent = String(slides.length).padStart(2, '0');
    dom.progressDots.setAttribute('aria-label', `All ${slides.length} scenes`);
  }

  function warmArtwork() {
    const sources = [...new Set(slides.slice(1).map((slide) => slide.image))];
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

  function setBackground(slide, immediate = false) {
    const token = ++state.imageToken;
    const currentImage = dom.sceneImages[state.visibleImage];
    const nextIndex = state.visibleImage === 0 ? 1 : 0;
    const nextImage = dom.sceneImages[nextIndex];

    dom.experience.style.setProperty('--scene-focal', slide.focal || '50% 50%');
    if (currentImage.getAttribute('src') === slide.image && !immediate) return;
    nextImage.src = slide.image;
    const reveal = () => {
      if (token !== state.imageToken) return;
      nextImage.classList.add('is-visible');
      currentImage.classList.remove('is-visible');
      state.visibleImage = nextIndex;
    };
    const fail = () => {
      if (token === state.imageToken) {
        dom.statusAnnouncer.textContent = 'This scene’s artwork could not be loaded. The story remains available.';
      }
    };

    if (immediate || (nextImage.complete && nextImage.naturalWidth > 0)) {
      requestAnimationFrame(reveal);
    } else {
      nextImage.addEventListener('load', reveal, { once: true });
      nextImage.addEventListener('error', fail, { once: true });
    }
  }

  function createFactGrid(details) {
    const grid = document.createElement('div');
    grid.className = `fact-grid${details.length === 4 ? ' has-four' : ''}`;
    details.forEach((detail) => {
      const item = document.createElement('div');
      item.className = 'fact-item';
      const value = document.createElement('strong');
      const label = document.createElement('b');
      const caption = document.createElement('small');
      value.textContent = detail.value;
      label.textContent = detail.label;
      caption.textContent = detail.caption;
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

  function renderQuiz(slide) {
    const wrap = document.createElement('div');
    wrap.className = 'quiz-wrap';
    const question = document.createElement('p');
    question.className = 'quiz-question';
    question.textContent = slide.question;
    const options = document.createElement('div');
    options.className = 'quiz-options';
    options.setAttribute('role', 'group');
    options.setAttribute('aria-label', slide.question);
    const answered = state.answers.get(slide.id);

    slide.options.forEach((label, index) => {
      const option = document.createElement('button');
      option.className = 'quiz-option';
      option.type = 'button';
      option.dataset.key = String(index + 1);
      const key = document.createElement('span');
      key.textContent = String(index + 1);
      const copy = document.createElement('b');
      copy.textContent = label;
      option.append(key, copy);
      if (answered) {
        option.disabled = true;
        option.classList.toggle('is-correct', index === slide.answer);
        option.classList.toggle('is-selected', index === answered.selection);
        option.classList.toggle('is-dimmed', index !== slide.answer && index !== answered.selection);
      } else {
        option.addEventListener('click', () => answerQuiz(slide, index));
      }
      options.append(option);
    });

    wrap.append(question, options);
    if (answered) {
      const feedback = document.createElement('p');
      feedback.className = 'quiz-feedback';
      const lead = document.createElement('strong');
      lead.textContent = answered.correct ? 'Signal locked.' : 'New coordinate.';
      feedback.append(lead, document.createTextNode(slide.explanation));
      wrap.append(feedback);
    }
    return wrap;
  }

  function createFinaleScore() {
    const panel = document.createElement('div');
    panel.className = 'finale-score';
    const copy = document.createElement('span');
    const label = document.createElement('small');
    const title = document.createElement('strong');
    const score = document.createElement('b');
    const replay = document.createElement('button');
    label.textContent = 'Discoveries visited';
    title.textContent = state.answers.size === 3
      ? 'All three signals found'
      : 'Every discovery remains on the route';
    score.textContent = `${state.answers.size} / 3`;
    replay.className = 'replay-journey';
    replay.type = 'button';
    replay.textContent = 'Restart the ascent ↺';
    replay.addEventListener('click', restartJourney);
    copy.append(label, title);
    panel.append(copy, score, replay);
    return panel;
  }

  function renderStoryBody(slide) {
    dom.storyBody.replaceChildren();
    if (slide.kind === 'quiz') {
      dom.storyBody.append(renderQuiz(slide));
      return;
    }

    dom.storyBody.append(createFactGrid(slide.details));
    if (slide.note) dom.storyBody.append(createNote(slide.note));
    if (slide.kind === 'finale') dom.storyBody.append(createFinaleScore());
  }

  function renderTerm(term) {
    const label = document.createElement('small');
    const name = document.createElement('strong');
    const meaning = document.createElement('em');
    label.textContent = term.label;
    name.textContent = term.name;
    meaning.textContent = term.meaning;
    dom.fieldTerm.replaceChildren(label, name, meaning);
  }

  function updateProgress(slide) {
    dom.currentNumber.textContent = String(state.index + 1).padStart(2, '0');
    dom.progressLabel.textContent = slide.progress;
    dom.chapterChipText.textContent = slide.chapter;
    [...dom.progressDots.querySelectorAll('.progress-dot')].forEach((dot, index) => {
      dot.classList.toggle('is-current', index === state.index);
      dot.classList.toggle('is-complete', index < state.index);
      dot.setAttribute('aria-current', index === state.index ? 'step' : 'false');
    });
  }

  function updateNavigation(slide) {
    dom.previousButton.disabled = state.index === 0;
    const unansweredQuiz = slide.kind === 'quiz' && !state.answers.has(slide.id);
    dom.nextButton.disabled = unansweredQuiz;
    dom.nextButtonLabel.textContent = slide.kind === 'finale'
      ? 'Restart'
      : unansweredQuiz ? 'Choose to continue' : 'Next';
    dom.nextButton.setAttribute('aria-label', slide.kind === 'finale'
      ? 'Restart the ascent from the first scene'
      : unansweredQuiz ? 'Choose an answer before continuing' : 'Go to the next scene');
  }

  function syncPanelForSlide(slide, announce = false) {
    const quizRequiresPanel = slide.kind === 'quiz';
    const visible = quizRequiresPanel || state.panelPreferred;
    const changed = visible !== state.panelVisible;

    state.panelVisible = visible;
    dom.experience.dataset.panel = visible ? 'visible' : 'hidden';
    dom.storyCard.setAttribute('aria-hidden', String(!visible));
    dom.storyCard.toggleAttribute('inert', !visible);
    dom.panelButton.disabled = quizRequiresPanel;
    dom.panelButton.setAttribute('aria-pressed', String(visible));

    const label = quizRequiresPanel
      ? 'The story panel stays visible until this discovery is answered'
      : visible ? 'Hide the story panel' : 'Show the story panel';
    dom.panelButton.setAttribute('aria-label', label);
    dom.panelButton.title = label;

    if (announce && changed) {
      dom.statusAnnouncer.textContent = visible
        ? 'Story panel shown.'
        : 'Story panel hidden. Artwork, narration, and navigation remain available.';
    }
  }

  function togglePanel() {
    const slide = slides[state.index];
    if (slide.kind === 'quiz') {
      dom.statusAnnouncer.textContent = 'The story panel remains visible until this discovery is answered.';
      return;
    }
    state.panelPreferred = !state.panelPreferred;
    safeStorageSet('kardashevPanel', state.panelPreferred ? 'visible' : 'hidden');
    syncPanelForSlide(slide, true);
  }

  function fetchTranscript(slide) {
    const token = ++state.transcriptToken;
    dom.transcriptText.textContent = 'Loading transcript…';
    if (state.transcriptCache.has(slide.audio)) {
      dom.transcriptText.textContent = state.transcriptCache.get(slide.audio);
      return;
    }

    fetch(`assets/audio/${slide.audio}.txt`, { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`Transcript returned ${response.status}`);
        return response.text();
      })
      .then((text) => {
        const transcript = text.trim() || slide.lede;
        state.transcriptCache.set(slide.audio, transcript);
        if (token === state.transcriptToken) dom.transcriptText.textContent = transcript;
      })
      .catch(() => {
        if (token === state.transcriptToken) {
          dom.transcriptText.textContent = `${slide.lede} Full transcript unavailable.`;
        }
      });
  }

  function setSlide(index, options = {}) {
    if (!state.started) return;
    const nextIndex = Math.max(0, Math.min(slides.length - 1, index));
    const slide = slides[nextIndex];
    const changed = nextIndex !== state.index;

    narrator.stop(false);
    state.index = nextIndex;
    dom.storyCard.classList.remove('is-visible');
    dom.experience.dataset.tone = slide.tone;
    dom.experience.dataset.layout = slide.layout;
    atmosphere.setTone(slide.tone);
    setBackground(slide, !changed && nextIndex === 0);

    dom.storyEyebrow.textContent = slide.eyebrow;
    dom.storyDate.textContent = slide.date;
    dom.storyTitle.textContent = slide.title;
    dom.storyLede.textContent = slide.lede;
    renderStoryBody(slide);
    renderTerm(slide.term);
    updateProgress(slide);
    updateNavigation(slide);
    syncPanelForSlide(slide);
    fetchTranscript(slide);
    document.title = `${slide.title} · Kardashev Civilizations`;
    dom.statusAnnouncer.textContent = `Scene ${state.index + 1} of ${slides.length}. ${slide.title}`;
    dom.storyCard.scrollTop = 0;

    requestAnimationFrame(() => requestAnimationFrame(() => {
      dom.storyCard.classList.add('is-visible');
      if (options.focus) {
        const focusTarget = state.panelVisible ? dom.storyCard : dom.nextButton;
        focusTarget.focus({ preventScroll: true });
      }
    }));

    if (options.narrate !== false) narrator.play(slide);
  }

  function answerQuiz(slide, selection) {
    if (state.answers.has(slide.id)) return;
    const correct = selection === slide.answer;
    state.answers.set(slide.id, { selection, correct });
    if (correct) state.correctAnswers += 1;
    renderStoryBody(slide);
    updateNavigation(slide);
    tonePlayer.play(correct ? 'correct' : 'discover');
    dom.statusAnnouncer.textContent = correct
      ? `Signal locked. ${slide.explanation}`
      : `New coordinate. ${slide.explanation}`;
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
    dom.soundButton.setAttribute('aria-pressed', String(state.sound));
    dom.soundButton.setAttribute('aria-label', state.sound ? 'Mute narration' : 'Turn narration on');
    dom.introOverlay.classList.add('is-leaving');
    atmosphere.start();
    setSlide(0, { narrate: true, focus: true });
    window.setTimeout(() => {
      dom.introOverlay.hidden = true;
    }, state.reducedMotion ? 30 : 760);
  }

  function restartJourney() {
    state.answers.clear();
    state.correctAnswers = 0;
    tonePlayer.play('navigate');
    setSlide(0, { narrate: true, focus: true });
  }

  function goNext() {
    const slide = slides[state.index];
    if (slide.kind === 'quiz' && !state.answers.has(slide.id)) return;
    tonePlayer.unlock();
    tonePlayer.play('navigate');
    if (state.index === slides.length - 1) restartJourney();
    else setSlide(state.index + 1, { narrate: true, focus: true });
  }

  function goPrevious() {
    if (state.index <= 0) return;
    tonePlayer.unlock();
    tonePlayer.play('navigate');
    setSlide(state.index - 1, { narrate: true, focus: true });
  }

  function toggleSound() {
    state.sound = !state.sound;
    safeStorageSet('kardashevSound', state.sound ? 'on' : 'off');
    dom.soundButton.setAttribute('aria-pressed', String(state.sound));
    dom.soundButton.setAttribute('aria-label', state.sound ? 'Mute narration' : 'Turn narration on');
    if (state.sound) {
      tonePlayer.unlock();
      narrator.play(slides[state.index]);
      dom.statusAnnouncer.textContent = 'Narration turned on.';
    } else {
      narrator.stop(false);
      setNarrationState('muted', 'Narration muted');
      dom.statusAnnouncer.textContent = 'Narration muted.';
    }
  }

  function setCaptions(visible) {
    state.captions = Boolean(visible);
    dom.transcriptCard.hidden = !state.captions;
    dom.captionButton.setAttribute('aria-pressed', String(state.captions));
    dom.captionButton.setAttribute('aria-label', state.captions ? 'Hide transcript' : 'Show transcript');
    dom.statusAnnouncer.textContent = state.captions ? 'Transcript shown.' : 'Transcript hidden.';
  }

  function openInfo() {
    state.dialogWasPlaying = narrator.isPlaying();
    narrator.pause();
    if (typeof dom.infoDialog.showModal === 'function') dom.infoDialog.showModal();
    else dom.infoDialog.setAttribute('open', '');
  }

  function chooseQuizByKeyboard(key) {
    const slide = slides[state.index];
    if (slide.kind !== 'quiz' || state.answers.has(slide.id)) return false;
    const selection = Number(key) - 1;
    if (selection < 0 || selection >= slide.options.length) return false;
    answerQuiz(slide, selection);
    return true;
  }

  function handleKeydown(event) {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (dom.infoDialog.open) return;
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target?.isContentEditable) return;
    const key = event.key.toLowerCase();
    const globalShortcuts = ['r', 'c', 'm', 'p'];
    const isQuizNumber = /^[1-3]$/.test(event.key);
    if ((target instanceof HTMLButtonElement || target instanceof HTMLAnchorElement)
      && event.key !== 'Escape' && !globalShortcuts.includes(key) && !isQuizNumber) return;

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
      tonePlayer.unlock();
      narrator.play(slides[state.index], true);
    } else if (key === 'c') {
      event.preventDefault();
      setCaptions(!state.captions);
    } else if (key === 'm') {
      event.preventDefault();
      toggleSound();
    } else if (key === 'p') {
      event.preventDefault();
      togglePanel();
    } else if (event.key === 'Escape' && state.captions) {
      event.preventDefault();
      setCaptions(false);
    }
  }

  dom.startButton.addEventListener('click', startExperience);
  dom.previousButton.addEventListener('click', goPrevious);
  dom.nextButton.addEventListener('click', goNext);
  dom.panelButton.addEventListener('click', togglePanel);
  dom.soundButton.addEventListener('click', toggleSound);
  dom.captionButton.addEventListener('click', () => setCaptions(!state.captions));
  dom.closeTranscriptButton.addEventListener('click', () => setCaptions(false));
  dom.replayNarrationButton.addEventListener('click', () => {
    tonePlayer.unlock();
    if (!state.sound) toggleSound();
    else narrator.play(slides[state.index], true);
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
    if (state.reducedMotion) atmosphere.stop();
    else if (state.started) atmosphere.start();
  };
  if (typeof motionPreference.addEventListener === 'function') {
    motionPreference.addEventListener('change', handleMotionChange);
  } else {
    motionPreference.addListener(handleMotionChange);
  }

  buildProgress();
  dom.soundButton.setAttribute('aria-pressed', String(state.sound));
})();
