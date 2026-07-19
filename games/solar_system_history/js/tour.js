import { CHAPTERS, TODAY_INDEX, TOUR_EVENTS, formatTimeOffset } from './events.js';
import { NarrationController } from './narration.js';
import { SolarScene } from './scene.js';

const dom = {
  experience: document.getElementById('experience'),
  canvas: document.getElementById('spaceCanvas'),
  fallbackScene: document.getElementById('fallbackScene'),
  fallbackImage: document.querySelector('#fallbackScene img'),
  eraLabel: document.getElementById('eraLabel'),
  dateCounter: document.getElementById('dateCounter'),
  statusAnnouncer: document.getElementById('statusAnnouncer'),
  eventCard: document.getElementById('eventCard'),
  eventEyebrow: document.getElementById('eventEyebrow'),
  eventTitle: document.getElementById('eventTitle'),
  eventSummary: document.getElementById('eventSummary'),
  eventContext: document.getElementById('eventContext'),
  confidenceBadge: document.getElementById('confidenceBadge'),
  transcriptText: document.getElementById('transcriptText'),
  narrationState: document.getElementById('narrationState'),
  narrationLabel: document.getElementById('narrationLabel'),
  narrationAudio: document.getElementById('narrationAudio'),
  interstitial: document.getElementById('interstitial'),
  interstitialImage: document.getElementById('interstitialImage'),
  artTitle: document.getElementById('artTitle'),
  introOverlay: document.getElementById('introOverlay'),
  todayOverlay: document.getElementById('todayOverlay'),
  outroOverlay: document.getElementById('outroOverlay'),
  startButton: document.getElementById('startButton'),
  pauseButton: document.getElementById('pauseButton'),
  pauseLabel: document.getElementById('pauseLabel'),
  narrationButton: document.getElementById('narrationButton'),
  captionsButton: document.getElementById('captionsButton'),
  motionButton: document.getElementById('motionButton'),
  skipButton: document.getElementById('skipButton'),
  futureButton: document.getElementById('futureButton'),
  replayAtTodayButton: document.getElementById('replayAtTodayButton'),
  replayButton: document.getElementById('replayButton'),
  infoButton: document.getElementById('infoButton'),
  introInfoButton: document.getElementById('introInfoButton'),
  outroInfoButton: document.getElementById('outroInfoButton'),
  scienceDialog: document.getElementById('scienceDialog'),
  currentSources: document.getElementById('currentSources'),
  timeline: document.getElementById('timeline'),
  timelineFill: document.getElementById('timelineFill'),
  timelineMarkers: document.getElementById('timelineMarkers'),
  timelineCurrent: document.getElementById('timelineCurrent'),
  timelineTotal: document.getElementById('timelineTotal'),
  futureLabel: document.getElementById('futureLabel')
};

const mediaMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const state = {
  phase: 'intro',
  currentIndex: 0,
  currentEvent: TOUR_EVENTS[0],
  userPaused: false,
  visibilityPaused: false,
  dialogPaused: false,
  captions: true,
  narration: true,
  reducedMotion: mediaMotionPreference.matches,
  futureUnlocked: false,
  runToken: 0,
  skipResolver: null,
  gateResolver: null,
  outroResolver: null
};

const artworkCache = new Map();

const narrator = new NarrationController(dom.narrationAudio);
const solarScene = new SolarScene(dom.canvas, {
  reduceMotion: state.reducedMotion,
  onFallback: () => {
    dom.fallbackScene.hidden = false;
    dom.experience.classList.add('has-static-fallback');
  }
});

solarScene.init();
solarScene.setPaused(true);
buildTimeline();
applyMotionPreference();
updateTimeline(0);
updateSources(TOUR_EVENTS[0]);
dom.experience.dataset.captions = 'on';
dom.experience.dataset.paused = 'false';
dom.timelineTotal.textContent = String(TOUR_EVENTS.length).padStart(2, '0');

requestAnimationFrame(() => dom.introOverlay.classList.add('is-visible'));

function buildTimeline() {
  const fragment = document.createDocumentFragment();
  TOUR_EVENTS.forEach((event, index) => {
    const marker = document.createElement('li');
    marker.className = 'timeline-marker';
    marker.dataset.index = String(index);
    marker.title = `${event.date}: ${event.title}`;
    if (event.chapter === CHAPTERS.future.id) marker.classList.add('is-locked');
    if (event.id === 'today') marker.classList.add('is-today');
    fragment.append(marker);
  });
  dom.timelineMarkers.append(fragment);
}

function updateTimeline(currentIndex) {
  dom.timelineCurrent.textContent = String(currentIndex + 1).padStart(2, '0');
  const progress = currentIndex / Math.max(1, TOUR_EVENTS.length - 1) * 100;
  dom.timelineFill.style.width = `${progress}%`;

  [...dom.timelineMarkers.children].forEach((marker, index) => {
    marker.classList.toggle('is-current', index === currentIndex);
    marker.classList.toggle('is-complete', index < currentIndex);
    const isFuture = TOUR_EVENTS[index].chapter === CHAPTERS.future.id;
    marker.classList.toggle('is-locked', isFuture && !state.futureUnlocked);
  });
}

function setEra(chapterId) {
  const chapter = Object.values(CHAPTERS).find((candidate) => candidate.id === chapterId) || CHAPTERS.deepTime;
  dom.experience.dataset.era = chapter.id;
  dom.eraLabel.textContent = chapter.label;
}

function updateEventCard(event, transcript) {
  dom.eventEyebrow.textContent = event.eyebrow;
  dom.eventTitle.textContent = event.title;
  dom.eventSummary.textContent = event.summary;
  dom.eventContext.textContent = event.context;
  dom.confidenceBadge.textContent = event.confidence;
  dom.transcriptText.textContent = transcript;
  document.title = `${event.title} · Orrery`;
  updateSources(event);
  dom.statusAnnouncer.textContent = `${event.date}. ${event.title}.`;

  if (!solarScene.available && event.image) {
    dom.fallbackImage.src = event.image;
  }
}

function updateSources(event) {
  dom.currentSources.replaceChildren();
  event.sources.forEach(([label, url]) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = label;
    item.append(link);
    dom.currentSources.append(item);
  });
}

function interpolateStoryTime(start, end, progress) {
  if (start === end) return end;
  if (start === 0 || end === 0 || Math.sign(start) !== Math.sign(end)) {
    return start + (end - start) * progress;
  }

  const sign = Math.sign(start);
  const startLog = Math.log10(Math.abs(start) + 1);
  const endLog = Math.log10(Math.abs(end) + 1);
  const value = Math.pow(10, startLog + (endLog - startLog) * progress) - 1;
  return value * sign;
}

function isInteractionPaused() {
  return state.userPaused || state.visibilityPaused || state.dialogPaused;
}

function syncPausedState() {
  const freezeScene = isInteractionPaused() || state.phase === 'event' || state.phase === 'today' || state.phase === 'outro';
  solarScene.setPaused(freezeScene);
  narrator.setUserPaused(isInteractionPaused());
}

function waitReal(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function waitTour(milliseconds, token, onProgress = () => {}) {
  return new Promise((resolve) => {
    let elapsed = 0;
    let lastFrame = performance.now();

    const frame = (now) => {
      if (token !== state.runToken) {
        resolve(false);
        return;
      }

      if (!isInteractionPaused()) {
        elapsed += Math.min(64, now - lastFrame);
        onProgress(Math.min(1, elapsed / milliseconds));
      }
      lastFrame = now;

      if (elapsed >= milliseconds) {
        resolve(true);
      } else {
        requestAnimationFrame(frame);
      }
    };

    requestAnimationFrame(frame);
  });
}

function preloadArtwork(source) {
  if (!source) return Promise.resolve(null);
  if (artworkCache.has(source)) return artworkCache.get(source);

  const ready = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.loading = 'eager';
    image.addEventListener('load', () => resolve(image), { once: true });
    image.addEventListener('error', () => reject(new Error(`Unable to load artwork: ${source}`)), { once: true });
    image.src = source;
  }).then(async (image) => {
    try {
      await image.decode();
    } catch (error) {
      // A completed load is still safe to display when decode() is unavailable.
    }
    return image;
  }).catch((error) => {
    artworkCache.delete(source);
    throw error;
  });

  artworkCache.set(source, ready);
  return ready;
}

async function showOverlay(element) {
  element.hidden = false;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  element.classList.add('is-visible');
}

async function hideOverlay(element) {
  if (element.hidden) return;
  element.classList.remove('is-visible');
  await waitReal(state.reducedMotion ? 130 : 700);
  element.hidden = true;
}

async function showEventCard() {
  dom.eventCard.hidden = false;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  dom.eventCard.classList.add('is-visible');
}

async function hideEventCard() {
  if (dom.eventCard.hidden) return;
  dom.eventCard.classList.remove('is-visible');
  await waitReal(state.reducedMotion ? 100 : 430);
  dom.eventCard.hidden = true;
}

async function showInterstitial(event, token) {
  if (!event.image) return;

  let artwork;
  try {
    artwork = await preloadArtwork(event.image);
  } catch (error) {
    return;
  }
  if (token !== state.runToken || !artwork) return;

  // Keep the old artwork fully hidden until the replacement has loaded and
  // decoded. This prevents browsers from briefly painting the previous frame.
  dom.interstitial.classList.remove('is-visible');
  dom.interstitial.hidden = true;
  dom.interstitialImage.src = artwork.currentSrc || artwork.src;
  dom.interstitialImage.alt = event.imageAlt || '';
  dom.artTitle.textContent = event.title;
  try {
    await dom.interstitialImage.decode();
  } catch (error) {
    // The browser can still paint an image even if decode() is unavailable or interrupted.
  }
  if (token !== state.runToken) return;

  // Re-start the restrained Ken Burns drift for each newly swapped image.
  dom.interstitialImage.style.animation = 'none';
  void dom.interstitialImage.offsetWidth;
  dom.interstitialImage.style.removeProperty('animation');
  dom.interstitial.hidden = false;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  dom.interstitial.classList.add('is-visible');
}

async function hideInterstitial() {
  if (dom.interstitial.hidden) return;
  dom.interstitial.classList.remove('is-visible');
  await waitReal(state.reducedMotion ? 100 : 760);
  dom.interstitial.hidden = true;
}

function makeSkipPromise() {
  return new Promise((resolve) => {
    state.skipResolver = () => {
      state.skipResolver = null;
      narrator.stop('continued');
      if (state.userPaused) {
        state.userPaused = false;
        updatePauseButton();
        syncPausedState();
      }
      resolve('continued');
    };
  });
}

async function presentEvent(event, token) {
  state.phase = 'event';
  dom.experience.dataset.phase = 'event';
  syncPausedState();

  const transcript = await narrator.loadTranscript(event);
  if (token !== state.runToken) return false;
  updateEventCard(event, transcript);
  setNarrationStatus('loading');

  await Promise.all([
    showEventCard(),
    showInterstitial(event, token)
  ]);
  if (token !== state.runToken) return false;

  const skipPromise = makeSkipPromise();
  const dwell = waitTour(state.reducedMotion ? Math.min(event.dwell, 4000) : event.dwell, token);
  const narration = narrator.play(event.id);
  await Promise.race([
    Promise.all([dwell, narration]),
    skipPromise
  ]);

  state.skipResolver = null;
  narrator.stop('event-complete');
  if (token !== state.runToken) return false;

  await Promise.all([
    hideEventCard(),
    hideInterstitial()
  ]);
  state.phase = 'travel';
  dom.experience.dataset.phase = 'travel';
  syncPausedState();
  return true;
}

async function travelToEvent(event, previousEvent, index, token) {
  state.phase = 'travel';
  state.currentIndex = index;
  state.currentEvent = event;
  dom.experience.dataset.phase = 'travel';
  setEra(event.chapter);
  updateTimeline(index);
  updateSources(event);
  syncPausedState();
  void preloadArtwork(event.image).catch(() => {});

  const startTime = previousEvent?.time ?? event.time;
  const duration = state.reducedMotion ? 520 : (index === 0 ? 2600 : 3600);
  const onProgress = (progress) => {
    const storyTime = interpolateStoryTime(startTime, event.time, progress);
    dom.dateCounter.textContent = progress > 0.965 ? event.date : formatTimeOffset(storyTime);
  };

  if (solarScene.available) {
    await solarScene.transitionTo(event, duration, onProgress);
  } else {
    await waitTour(duration, token, onProgress);
  }

  if (token !== state.runToken) return false;
  dom.dateCounter.textContent = event.date;
  return true;
}

async function runSequence(startIndex = 0) {
  const token = ++state.runToken;
  dom.pauseButton.disabled = false;
  state.userPaused = false;
  updatePauseButton();

  for (let index = startIndex; index < TOUR_EVENTS.length; index += 1) {
    if (token !== state.runToken) return;
    const event = TOUR_EVENTS[index];
    const previousEvent = index > 0 ? TOUR_EVENTS[index - 1] : null;
    const arrived = await travelToEvent(event, previousEvent, index, token);
    if (!arrived || token !== state.runToken) return;

    const presented = await presentEvent(event, token);
    if (!presented || token !== state.runToken) return;

    if (event.id === 'today') {
      const choice = await showTodayGate(token);
      if (choice !== 'future' || token !== state.runToken) return;
    }
  }

  if (token === state.runToken) await showOutro(token);
}

async function startTour() {
  dom.startButton.disabled = true;
  void narrator.unlock();
  await hideOverlay(dom.introOverlay);
  dom.experience.dataset.phase = 'travel';
  state.phase = 'travel';
  runSequence(0);
}

async function showTodayGate(token) {
  state.phase = 'today';
  dom.experience.dataset.phase = 'today';
  dom.pauseButton.disabled = true;
  syncPausedState();
  await showOverlay(dom.todayOverlay);
  if (token !== state.runToken) return 'cancelled';
  dom.futureButton.focus({ preventScroll: true });

  return new Promise((resolve) => {
    state.gateResolver = resolve;
  });
}

async function unlockFuture() {
  if (state.phase !== 'today') return;
  state.futureUnlocked = true;
  dom.timeline.classList.add('is-future-unlocked');
  dom.futureLabel.textContent = 'Modelled future';
  updateTimeline(state.currentIndex);
  const resolve = state.gateResolver;
  state.gateResolver = null;
  await hideOverlay(dom.todayOverlay);
  state.phase = 'travel';
  dom.experience.dataset.phase = 'travel';
  dom.pauseButton.disabled = false;
  syncPausedState();
  resolve?.('future');
}

async function showOutro(token) {
  state.phase = 'outro';
  dom.experience.dataset.phase = 'outro';
  dom.pauseButton.disabled = true;
  syncPausedState();
  await showOverlay(dom.outroOverlay);
  if (token === state.runToken) dom.replayButton.focus({ preventScroll: true });
}

async function restartTour() {
  const oldGateResolver = state.gateResolver;
  state.gateResolver = null;
  state.runToken += 1;
  oldGateResolver?.('cancelled');
  state.skipResolver?.();
  state.skipResolver = null;
  narrator.stop('restart');
  state.futureUnlocked = false;
  state.userPaused = false;
  dom.timeline.classList.remove('is-future-unlocked');
  dom.futureLabel.textContent = 'Future locked';

  await Promise.all([
    hideOverlay(dom.todayOverlay),
    hideOverlay(dom.outroOverlay),
    hideEventCard(),
    hideInterstitial()
  ]);

  state.phase = 'travel';
  dom.experience.dataset.phase = 'travel';
  dom.pauseButton.disabled = false;
  updatePauseButton();
  runSequence(0);
}

function togglePause() {
  if (['intro', 'today', 'outro'].includes(state.phase)) return;
  state.userPaused = !state.userPaused;
  updatePauseButton();
  syncPausedState();
}

function updatePauseButton() {
  dom.pauseButton.setAttribute('aria-pressed', String(state.userPaused));
  dom.pauseButton.setAttribute('aria-label', state.userPaused ? 'Resume the tour' : 'Pause the tour');
  dom.pauseLabel.textContent = state.userPaused ? 'Resume' : 'Pause';
  dom.experience.dataset.paused = String(state.userPaused);
  if (state.userPaused && state.phase === 'event') {
    dom.statusAnnouncer.textContent = 'Tour paused. Chapter details are now visible.';
  }
}

function toggleNarration() {
  state.narration = !state.narration;
  narrator.setEnabled(state.narration);
  dom.narrationButton.setAttribute('aria-pressed', String(state.narration));
  dom.narrationButton.setAttribute('aria-label', state.narration ? 'Turn narration off' : 'Turn narration on');
}

function toggleCaptions() {
  state.captions = !state.captions;
  dom.experience.dataset.captions = state.captions ? 'on' : 'off';
  dom.captionsButton.setAttribute('aria-pressed', String(state.captions));
  dom.captionsButton.setAttribute('aria-label', state.captions ? 'Hide transcript captions' : 'Show transcript captions');
}

function toggleMotion() {
  state.reducedMotion = !state.reducedMotion;
  applyMotionPreference();
}

function applyMotionPreference() {
  dom.experience.classList.toggle('is-reduced-motion', state.reducedMotion);
  dom.motionButton.setAttribute('aria-pressed', String(state.reducedMotion));
  dom.motionButton.setAttribute('aria-label', state.reducedMotion ? 'Use cinematic motion' : 'Use reduced motion');
  solarScene.setReducedMotion(state.reducedMotion);
}

function setNarrationStatus(status) {
  const labels = {
    loading: 'Checking for narration…',
    playing: 'Narration playing',
    paused: 'Narration paused',
    complete: 'Narration complete',
    'transcript-only': `Transcript only · add ${state.currentEvent.id}.mp3`,
    disabled: 'Narration turned off',
    ready: 'Narration ready',
    error: 'Audio unavailable · transcript shown',
    blocked: 'Playback blocked · transcript shown',
    continued: 'Continuing the journey',
    'event-complete': 'Chapter complete'
  };
  dom.narrationLabel.textContent = labels[status] || 'Transcript ready';
  dom.narrationState.classList.toggle('is-playing', status === 'playing');
}

function openScienceDialog() {
  updateSources(state.currentEvent);
  state.dialogPaused = true;
  syncPausedState();
  if (typeof dom.scienceDialog.showModal === 'function') {
    dom.scienceDialog.showModal();
  } else {
    dom.scienceDialog.setAttribute('open', '');
  }
}

function closeScienceDialog() {
  state.dialogPaused = false;
  syncPausedState();
}

dom.startButton.addEventListener('click', startTour);
dom.pauseButton.addEventListener('click', togglePause);
dom.narrationButton.addEventListener('click', toggleNarration);
dom.captionsButton.addEventListener('click', toggleCaptions);
dom.motionButton.addEventListener('click', toggleMotion);
dom.skipButton.addEventListener('click', () => state.skipResolver?.());
dom.futureButton.addEventListener('click', unlockFuture);
dom.replayAtTodayButton.addEventListener('click', restartTour);
dom.replayButton.addEventListener('click', restartTour);
dom.infoButton.addEventListener('click', openScienceDialog);
dom.introInfoButton.addEventListener('click', openScienceDialog);
dom.outroInfoButton.addEventListener('click', openScienceDialog);
dom.scienceDialog.addEventListener('close', closeScienceDialog);
dom.scienceDialog.addEventListener('cancel', () => {
  window.setTimeout(closeScienceDialog, 0);
});

narrator.addEventListener('narrationstate', (event) => {
  setNarrationStatus(event.detail.state);
});

document.addEventListener('visibilitychange', () => {
  state.visibilityPaused = document.hidden;
  syncPausedState();
});

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented || event.target.closest('button, a, input, dialog')) return;
  if (event.key.toLowerCase() === 'p' || event.key === ' ') {
    event.preventDefault();
    togglePause();
  } else if (event.key === 'ArrowRight' && state.phase === 'event') {
    event.preventDefault();
    state.skipResolver?.();
  }
});

window.addEventListener('beforeunload', () => {
  narrator.stop('unload');
  solarScene.destroy();
});
