/* Local browser shell. Test drivers are deliberately absent from runtime. */
(async function () {
  'use strict';
  const $ = id => document.getElementById(id);
  let sim, view, screen = 'menu', selected = 'selene', mode = 'standard', last = 0, resultShown = false, ready = false;
  let input, audioContext, oscillator, gain, sound = false, stored;
  let helpFrom = 'menu';
  const notice = text => { $('notice').textContent = text; };
  function fatal() {
    ready = false; input?.clear(); sim?.pause();
    if (gain && audioContext) gain.gain.setTargetAtTime(0, audioContext.currentTime, .03);
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    $('failure').hidden = false; $('launch').disabled = true;
  }
  $('reload').onclick = () => location.reload();
  try {
    if (!globalThis.Descent || !globalThis.DescentInput || !globalThis.DescentRecords) throw new Error('Local module unavailable');
    input = new DescentInput.Input();
    sim = new Descent.Simulation();
    try { stored = window.localStorage; } catch { notice('Local records are unavailable. You can still fly.'); }
    const { Renderer } = await import('./renderer.mjs');
    view = new Renderer($('scene'));
    ready = true;
  } catch { fatal(); return; }
  $('scene').addEventListener('webglcontextlost', e => { e.preventDefault(); fatal(); });
  function stopControls() {
    input.clear(); sim.state.main = sim.state.left = sim.state.right = false;
    for (const button of document.querySelectorAll('[data-control]')) button.classList.remove('held');
    if (gain) gain.gain.setTargetAtTime(0, audioContext.currentTime, .03);
  }
  function audioStart() {
    try {
      if (!audioContext) {
        const Context = window.AudioContext || window.webkitAudioContext;
        audioContext = new Context();
        oscillator = audioContext.createOscillator(); gain = audioContext.createGain();
        oscillator.type = 'sawtooth'; oscillator.frequency.value = 48;
        const filter = audioContext.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 200;
        gain.gain.value = 0; oscillator.connect(filter); filter.connect(gain); gain.connect(audioContext.destination); oscillator.start();
      }
      audioContext.resume().catch(() => { notice('Sound is unavailable. Flight controls still work.'); });
    } catch { sound = false; notice('Sound is unavailable. Flight controls still work.'); }
  }
  $('mute').onclick = () => {
    sound = !sound; if (sound) audioStart();
    $('mute').textContent = sound ? 'Sound on' : 'Sound off'; $('mute').setAttribute('aria-pressed', String(sound));
  };
  function updateSelection() {
    const stage = DescentWorld.getStage(selected), records = DescentRecords.read(stored);
    $('planetNumber').textContent = `EXPEDITION ${String(stage.index + 1).padStart(2, '0')} / 06`;
    $('planetName').textContent = stage.name; $('planetSubtitle').textContent = stage.subtitle; $('briefing').textContent = stage.briefing;
    $('gravity').textContent = `${stage.gravity.toFixed(1)} m/s²`;
    $('best').textContent = records[selected] === undefined ? 'Uncharted' : `${Descent.grade(records[selected])} / ${(records[selected] * 100).toFixed(1)}%`;
    for (const button of $('planets').children) {
      button.setAttribute('aria-pressed', String(button.dataset.stage === selected));
      const best = records[button.dataset.stage];
      button.querySelector('small').textContent = best === undefined ? `WORLD ${String(+button.dataset.index + 1).padStart(2, '0')}` : `LANDED / RANK ${Descent.grade(best)}`;
    }
  }
  for (const stage of DescentWorld.stages) {
    const button = document.createElement('button'); button.className = 'planet'; button.dataset.stage = stage.id; button.dataset.index = stage.index;
    button.style.setProperty('--planet-color', '#' + stage.colors[1].toString(16).padStart(6, '0'));
    const number = document.createElement('small'), name = document.createElement('strong'), gravity = document.createElement('span');
    name.textContent = stage.name; gravity.textContent = `${stage.gravity.toFixed(1)} m/s²`;
    button.append(number, name, gravity); $('planets').append(button);
    button.onclick = () => { selected = stage.id; stopControls(); sim.reset(selected, mode); view.build(stage); updateSelection(); };
  }
  document.querySelectorAll('input[name=mode]').forEach(radio => radio.onchange = () => { mode = radio.value; });
  function closeDialogs() { for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close(); }
  function launch() {
    if (!ready) return;
    closeDialogs(); stopControls(); sim.reset(selected, mode); view.build(sim.stage); resultShown = false; screen = 'flight'; last = 0;
    $('menu').hidden = true; $('hud').hidden = false; $('pause').hidden = false;
    $('flightStage').textContent = `${sim.stage.name.toUpperCase()} / ${sim.stage.gravity.toFixed(1)} m/s²`;
    $('flightMode').textContent = mode === 'practice' ? 'PRACTICE ∞ · NO RANK' : 'STANDARD · FUEL RANKED';
    $('launch').blur(); if (sound) audioStart();
  }
  function menu() {
    closeDialogs(); stopControls(); screen = 'menu'; sim.reset(selected, mode); view.build(sim.stage);
    $('menu').hidden = false; $('hud').hidden = true; $('pause').hidden = true; updateSelection(); $('launch').focus();
  }
  function pause() {
    if (screen !== 'flight' || !['flying', 'settling'].includes(sim.state.status)) return;
    stopControls(); sim.pause(); screen = 'pause'; $('pauseDialog').showModal(); $('resume').focus();
  }
  function resume() { if (screen !== 'pause') return; stopControls(); sim.pause(false); screen = 'flight'; $('pauseDialog').close(); last = 0; }
  function help() {
    if (screen === 'help' || screen === 'result') return;
    helpFrom = screen; stopControls(); sim.pause(); closeDialogs(); screen = 'help'; $('helpDialog').showModal(); $('closeHelp').focus();
  }
  function closeHelp() {
    $('helpDialog').close(); screen = helpFrom;
    if (screen === 'pause') $('pauseDialog').showModal();
    else { sim.pause(false); last = 0; }
  }
  $('launch').onclick = launch; $('pause').onclick = pause; $('resume').onclick = resume; $('help').onclick = help; $('closeHelp').onclick = closeHelp;
  document.querySelectorAll('[data-action=retry]').forEach(button => button.onclick = launch);
  document.querySelectorAll('[data-action=menu]').forEach(button => button.onclick = menu);
  $('next').onclick = () => { selected = DescentWorld.stages[(sim.stage.index + 1) % 6].id; launch(); };
  $('clearRecords').onclick = () => { try { stored.removeItem(DescentRecords.KEY); notice('Local standard records cleared.'); updateSelection(); } catch { notice('Local records are unavailable.'); } };
  for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('cancel', e => { e.preventDefault(); if (screen === 'pause') resume(); else if (screen === 'help') closeHelp(); });
  window.addEventListener('keydown', e => {
    if (e.target.matches('input,select,textarea')) return;
    if (screen === 'flight' && DescentInput.bindings[e.code]) { e.preventDefault(); input.key(e.code, true); }
    if (e.repeat) return;
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (screen === 'flight') { e.preventDefault(); pause(); }
      else if (screen === 'pause') { e.preventDefault(); resume(); }
    }
    if (e.code === 'KeyR' && ['flight', 'pause', 'result'].includes(screen)) { e.preventDefault(); launch(); }
    if (e.code === 'KeyH' && ['flight', 'menu', 'pause'].includes(screen)) { e.preventDefault(); help(); }
  });
  window.addEventListener('keyup', e => { if (input.key(e.code, false) && screen === 'flight') e.preventDefault(); });
  window.addEventListener('blur', () => { stopControls(); pause(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { stopControls(); pause(); } });
  for (const button of document.querySelectorAll('[data-control]')) {
    button.addEventListener('pointerdown', e => {
      if (screen !== 'flight' || sim.state.status !== 'flying') return;
      e.preventDefault(); button.setPointerCapture(e.pointerId); input.pointers.set(e.pointerId, button.dataset.control);
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(event, e => { input.pointers.delete(e.pointerId); });
    button.addEventListener('contextmenu', e => e.preventDefault());
  }
  function result() {
    resultShown = true; screen = 'result'; stopControls();
    const s = sim.state, success = s.status === 'landed', practice = mode === 'practice';
    $('resultEyebrow').textContent = `${sim.stage.name.toUpperCase()} / ${practice ? 'PRACTICE' : 'STANDARD'}`;
    $('resultMark').textContent = success ? (practice ? '∞' : Descent.grade(s.touchdown.fraction)) : '↺';
    $('resultTitle').textContent = success ? 'A beautiful arrival.' : 'Another approach.';
    $('resultText').textContent = success ? practice ? 'Practice landing complete. Unlimited fuel, no grade, and standard records are untouched.' : `${s.fuel.toFixed(1)} of ${sim.stage.fuel} units brought home · ${(s.touchdown.fraction * 100).toFixed(1)}% fuel remaining.` : s.reason;
    $('resultDetail').textContent = success ? `Touchdown: ${Math.abs(s.touchdown.vy).toFixed(2)} m/s down · ${Math.abs(s.touchdown.vx).toFixed(2)} m/s sideways · ${Math.abs(s.touchdown.tilt * 180 / Math.PI).toFixed(1)}° tilt.${practice ? '' : ' Rank is based only on fuel: S ≥70%, A ≥50%, B ≥30%, C ≥10%, D <10%.'}` : 'Lift clear of the obstacles, brake before the pad, and finish upright. Retry starts with a fresh tank.';
    if (success && !practice && !DescentRecords.save(stored, sim)) notice('Landing complete. Local record could not be saved.');
    $('next').hidden = !success; $('next').textContent = sim.stage.index === 5 ? 'Return to Selene' : 'Next planet';
    $('resultDialog').showModal(); (success ? $('next') : $('resultDialog').querySelector('[data-action=retry]')).focus();
  }
  function hud() {
    const s = sim.state, safe = Descent.safety(s);
    $('fuelLabel').textContent = mode === 'practice' ? 'PRACTICE FUEL' : 'FUEL RESERVE';
    $('fuelValue').textContent = mode === 'practice' ? '∞ unlimited' : `${s.fuel.toFixed(1)} / 160`;
    $('fuelBar').style.width = `${mode === 'practice' ? 100 : s.fuel / sim.stage.fuel * 100}%`;
    $('horizontal').textContent = `${Math.abs(s.vx).toFixed(1)} ${s.vx < -.1 ? '←' : s.vx > .1 ? '→' : '·'}`;
    $('vertical').textContent = `${Math.abs(s.vy).toFixed(1)} ${s.vy > .1 ? '↑' : s.vy < -.1 ? '↓' : '·'}`;
    $('height').textContent = `${s.y.toFixed(1)} m`;
    $('spin').textContent = `${Math.abs(s.omega * 180 / Math.PI).toFixed(0)}°/s spin`;
    $('tilt').textContent = `${Math.abs(s.angle * 180 / Math.PI).toFixed(0)}° ${s.angle < -.02 ? '↶' : s.angle > .02 ? '↷' : '·'}`;
    for (const [id, value] of [['horizontal', safe.horizontal], ['vertical', safe.vertical], ['tilt', safe.tilt && safe.spin]]) $(id).className = value ? 'safe' : 'unsafe';
    const dx = sim.stage.goal.x - s.x;
    $('goalDirection').textContent = `Arrival ${Math.abs(dx) < 1 ? '↓' : dx < 0 ? '←' : '→'} ${Math.abs(dx).toFixed(0)} m${view.goalVisible() ? '' : ' · off screen'} · speed in m/s`;
    $('hint').textContent = s.status === 'settling' ? 'Contact confirmed. Landing gear settling…' : s.grounded === 'start' ? 'Short MAIN burns lift you. Release early to coast upward.' : Math.abs(dx) < 8 ? (Object.values(safe).every(Boolean) ? 'Landing speeds are safe. Keep both feet inside the gold lights.' : 'Brake and straighten. Gold instruments need attention.') : s.y < sim.stage.cruise - 2 ? (s.vy > 2 && s.y + s.vy * s.vy / (2 * sim.stage.gravity) > sim.stage.cruise ? 'Release MAIN and coast upward. Tilt once clear of the ridges.' : `Pulse MAIN to climb · suggested crossing height ${sim.stage.cruise} m`) : 'Tilt to travel. Tilt against your motion and burn to brake.';
    const values = input.values();
    for (const button of document.querySelectorAll('[data-control]')) button.classList.toggle('held', values[button.dataset.control] && screen === 'flight');
  }
  function frame(time) {
    if (!ready) return;
    const dt = last ? Math.min((time - last) / 1000, .1) : 0; last = time;
    if (screen === 'flight') {
      sim.advance(dt, input.values()); hud();
      if (!resultShown && ['landed', 'crashed'].includes(sim.state.status)) result();
    }
    if (gain) {
      const active = sound && screen === 'flight' && !sim.state.paused;
      gain.gain.setTargetAtTime(active ? sim.state.main ? .035 : sim.state.left || sim.state.right ? .012 : 0 : 0, audioContext.currentTime, .025);
      oscillator.frequency.setTargetAtTime(sim.state.main ? 48 : 110, audioContext.currentTime, .03);
    }
    try {
      const preview = screen === 'menu' || (screen === 'help' && helpFrom === 'menu');
      view.render(preview ? { ...sim.state, x: 17, y: 23, angle: -.16 } : sim.state, screen === 'flight' || preview ? dt : 0, preview);
    } catch { fatal(); return; }
    requestAnimationFrame(frame);
  }
  updateSelection(); $('launch').textContent = 'Launch expedition →'; $('launch').disabled = false;
  requestAnimationFrame(frame);
})();
