import { createWorld } from './world.js';

const $ = id => document.getElementById(id);
const initial = globalThis.MoonPhysics.createState();
const ground = globalThis.MoonTerrain;
const flight = globalThis.MoonPhysics.buildFlight(ground.height(initial.x, initial.z));
const world = await createWorld($('scene'), flight);
let time = flight.timeAtAltitude(24);
let playing = false;
let preview = true;
let speed = 1;
let lastFrame = 0;
let lastAnnouncement = '';
let uiHidden = false;
let resumeAfterNotes = false;
const formatTime = seconds => `${Math.floor(Math.abs(seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.abs(seconds) % 60).toString().padStart(2, '0')}`;
const cameraNames = { tracking: '01 / TRACKING CAMERA', wide: '02 / WIDE SURVEY', surface: '03 / SURFACE CAMERA', onboard: '04 / COMMANDER’S WINDOW' };

function announce(message) {
  if (message === lastAnnouncement) return;
  $('announcement').textContent = message;
  lastAnnouncement = message;
}
function setPlaying(value) {
  playing = value;
  $('playIcon').textContent = playing ? 'Ⅱ' : '▶';
  $('playLabel').textContent = playing ? 'Pause' : 'Play';
  $('playButton').setAttribute('aria-label', playing ? 'Pause descent' : 'Play descent');
  lastFrame = performance.now();
  updateInstruments(flight.sample(time));
}
function leavePreview() {
  preview = false;
  $('intro').hidden = true;
  $('flightSummary').hidden = false;
}
function start() {
  leavePreview(); time = 0; world.setView('tracking'); selectCamera('tracking'); setPlaying(true);
  announce('Descent started from one thousand metres.');
}
function togglePlayback() {
  if (preview || time >= flight.duration) { start(); return; }
  setPlaying(!playing);
  announce(playing ? 'Descent resumed.' : 'Descent paused.');
}
function selectCamera(name) {
  if (!Object.hasOwn(cameraNames, name)) return;
  world.setView(name);
  for (const button of document.querySelectorAll('[data-camera]')) button.setAttribute('aria-pressed', String(button.dataset.camera === name));
  $('viewName').textContent = cameraNames[name];
  $('viewHint').textContent = name === 'tracking' || name === 'wide' ? 'DRAG TO ORBIT · SCROLL TO ZOOM' : name === 'surface' ? 'FIXED OBSERVER · 1.7 m ABOVE REGOLITH' : 'LOOKING FORWARD AND DOWN · CREW ABOARD';
}
function toggleInterface() {
  uiHidden = !uiHidden;
  $('experience').classList.toggle('clean', uiHidden);
  $('showInterface').hidden = !uiHidden;
}
function updateInstruments(state) {
  const agl = Math.max(0, state.altitude - ground.height(state.x, state.z));
  $('altitude').textContent = agl >= 100 ? Math.round(agl).toLocaleString('en-US') : agl.toFixed(1);
  $('altitudeBar').style.width = `${Math.max(0, Math.min(100, agl / 10))}%`;
  $('velocity').textContent = Math.max(0, -state.verticalSpeed).toFixed(2);
  $('groundSpeed').textContent = Math.hypot(state.vx, state.vz).toFixed(2);
  $('throttle').textContent = `${Math.round(state.throttle * 100)}%`;
  $('throttleBar').style.width = `${state.throttle * 100}%`;
  $('fuel').textContent = `${Math.round(state.fuel).toLocaleString('en-US')} kg`;
  $('engineState').textContent = state.engine ? 'THROTTLE MODULATING' : 'ENGINE STOPPED';
  $('clock').textContent = `T ${time < flight.contactTime ? '−' : '+'} ${formatTime(time - flight.contactTime)}`;
  $('phase').textContent = state.phase.toUpperCase();
  $('telemetryState').textContent = preview ? 'PREVIEW' : playing ? 'LIVE' : 'HELD';
  $('timeline').value = time;
  $('timeline').setAttribute('aria-valuetext', `${Math.round(agl)} metres above ground; ${state.phase}; ${formatTime(time)} elapsed`);
  if (state.resting) {
    $('flightTitle').textContent = 'Tranquility Base.';
    $('flightSubtitle').textContent = 'The crew is down. The dust returns to the Moon.';
  } else if (state.contact) {
    $('flightTitle').textContent = 'Contact. We’re down.';
    $('flightSubtitle').textContent = `Touchdown ${state.touchdownSpeed.toFixed(2)} m/s · engine stopped · gear settling`;
  } else {
    $('flightTitle').textContent = state.altitude < 25 ? 'Easy does it.' : 'Down to the Moon.';
    $('flightSubtitle').textContent = state.engine ? 'Guidance is flying. You have the view.' : 'Contact light. Descent engine stopped.';
  }
  $('statusText').textContent = preview ? 'SYSTEMS READY · PREVIEW AT 24 m' : time >= flight.duration ? 'LANDING COMPLETE · CREW ON THE SURFACE' : !playing ? 'SIMULATION PAUSED' : state.contact ? 'SURFACE OPERATIONS · DUST SETTLING' : 'GUIDANCE ACTIVE · ALL SYSTEMS NOMINAL';
  if (!preview && state.contact) announce('Touchdown. The engine is stopped and the crew has landed.');
}

$('beginButton').disabled = false;
$('beginButton').textContent = 'Begin descent  ↗';
$('playButton').disabled = false;
$('timeline').disabled = false;
$('timeline').max = flight.duration;
$('beginButton').addEventListener('click', start);
$('playButton').addEventListener('click', togglePlayback);
$('restartButton').addEventListener('click', start);
$('speed').addEventListener('change', event => {
  const value = Number(event.target.value);
  speed = [1, 2, 5].includes(value) ? value : 1;
});
$('timeline').addEventListener('input', event => {
  const value = Number(event.target.value);
  if (!Number.isFinite(value)) return;
  leavePreview(); time = Math.min(flight.duration, Math.max(0, value)); setPlaying(false);
});
for (const button of document.querySelectorAll('[data-camera]')) button.addEventListener('click', () => selectCamera(button.dataset.camera));
const phaseTimes = { approach: 0, terminal: flight.timeAtAltitude(60), contact: flight.timeAtAltitude(5), settled: flight.contactTime + 9 };
for (const button of document.querySelectorAll('[data-phase]')) button.addEventListener('click', () => {
  leavePreview(); time = phaseTimes[button.dataset.phase]; setPlaying(false);
  announce(`${button.textContent.trim()}. Paused for inspection.`);
});
$('showInterface').addEventListener('click', toggleInterface);
$('notesButton').addEventListener('click', () => {
  resumeAfterNotes = playing; setPlaying(false); $('notes').showModal();
});
$('closeNotes').addEventListener('click', () => $('notes').close());
$('notes').addEventListener('close', () => { if (resumeAfterNotes && !document.hidden) setPlaying(true); });
$('fullscreenButton').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await $('experience').requestFullscreen();
  } catch { announce('Fullscreen is unavailable in this browser.'); }
});
if (!document.fullscreenEnabled) $('fullscreenButton').hidden = true;
document.addEventListener('fullscreenchange', () => $('fullscreenButton').setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'));
document.addEventListener('keydown', event => {
  if ($('notes').open || /^(INPUT|SELECT|TEXTAREA|BUTTON|A)$/.test(event.target.tagName) || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
  else if (event.code === 'KeyR') start();
  else if (event.code === 'KeyH') toggleInterface();
  else if (/^Digit[1-4]$/.test(event.code)) selectCamera(['tracking', 'wide', 'surface', 'onboard'][Number(event.code.at(-1)) - 1]);
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { setPlaying(false); resumeAfterNotes = false; }
});
$('scene').addEventListener('webglcontextlost', event => {
  event.preventDefault(); setPlaying(false);
  $('failureText').textContent = 'The graphics connection was interrupted. Reload to rebuild the lunar scene.';
  $('failure').hidden = false;
});

let lastUi = -Infinity;
let lastRenderedTime = -1;
let lastPreview = true;
function frame(now) {
  const dt = Math.max(0, Math.min(.1, (now - (lastFrame || now)) / 1000));
  lastFrame = now;
  if (playing) {
    time = Math.min(flight.duration, time + dt * speed);
    if (time >= flight.duration) setPlaying(false);
  }
  const state = flight.sample(time);
  if (now - lastUi > 80) { updateInstruments(state); lastUi = now; }
  if (!document.hidden && (world.isDirty() || lastRenderedTime !== time || lastPreview !== preview)) {
    world.render(state, preview);
    lastRenderedTime = time;
    lastPreview = preview;
  }
  requestAnimationFrame(frame);
}
updateInstruments(flight.sample(time));
requestAnimationFrame(frame);
