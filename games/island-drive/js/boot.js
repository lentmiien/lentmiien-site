/* Static browser entry. Errors remain visible even when a module or WebGL fails. */
'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  let failed = false,
    ready = false,
    mode = 'menu',
    selected = 'rover',
    wide = false,
    renderer,
    sim,
    world,
    mapImage;
  let soundEnabled = false,
    audioContext,
    oscillator,
    engineGain,
    last = 0,
    toastUntil = 0,
    uiClock = 0;
  let returnFromHelp = 'menu',
    returnFromMap = 'drive';
  const held = new Set(),
    touch = new Map();
  const welcome = new Audio('assets/audio/welcome.wav');
  welcome.preload = 'none';
  function fatal(message) {
    failed = true;
    clearInput();
    if (sim) sim.pause(true);
    welcome.pause();
    if (engineGain) engineGain.gain.value = 0;
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    $('loading').hidden = true;
    $('menu').hidden = true;
    $('hud').hidden = true;
    $('failure').hidden = false;
    $('failureMessage').textContent = message;
  }
  $('reload').addEventListener('click', () => location.reload());
  window.addEventListener('error', () =>
    fatal(
      'The game could not continue. A local script or graphics resource failed. Check that the game folder is complete, then reload.'
    )
  );
  window.addEventListener('unhandledrejection', () =>
    fatal(
      'The graphics engine could not finish loading. Enable WebGL 2, check the local game files, then reload.'
    )
  );
  $('scene').addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    fatal(
      'The graphics connection was lost. Close other graphics-heavy tabs, then reload to begin a new drive.'
    );
  });
  const timeout = setTimeout(() => {
    if (!ready)
      fatal(
        'Loading took too long. Check the connection and that all local game files are present, then reload.'
      );
  }, 30000);
  function image(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Missing local artwork'));
      img.src = src;
    });
  }
  function clearInput() {
    held.clear();
    touch.clear();
    for (const b of document.querySelectorAll('[data-input]')) b.classList.remove('pressed');
  }
  function input() {
    const is = (name) => held.has(name) || [...touch.values()].includes(name);
    return {
      throttle: (is('forward') ? 1 : 0) - (is('reverse') ? 1 : 0),
      steer: (is('right') ? 1 : 0) - (is('left') ? 1 : 0),
      brake: is('brake'),
    };
  }
  function toast(message) {
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastUntil = performance.now() + 3300;
  }
  function time(seconds) {
    return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60)
      .toString()
      .padStart(2, '0')}`;
  }
  function stats(target) {
    const s = sim.state;
    const values = [
      [sim.quality.toFixed(0) + '/100', 'Driving quality'],
      [(s.distance / 1000).toFixed(2) + ' km', 'Distance'],
      [time(s.elapsed), 'Driving time'],
      [
        (s.distance ? (s.roadDistance / s.distance) * 100 : 100).toFixed(1) + '%',
        'On-road distance',
      ],
      [String(s.collisions), 'Collisions'],
      [String(s.collected), 'Discoveries'],
      [Math.round(s.topSpeed * 3.6) + ' km/h', 'Top speed'],
      [sim.car.name, 'Your car'],
    ];
    $(target).replaceChildren(
      ...values.map(([value, label]) => {
        const div = document.createElement('div');
        div.className = 'stat';
        const strong = document.createElement('strong');
        strong.textContent = value;
        const span = document.createElement('span');
        span.textContent = label;
        div.append(strong, span);
        return div;
      })
    );
  }
  function silence() {
    if (engineGain) engineGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08);
  }
  function pause() {
    if (mode !== 'drive') return;
    clearInput();
    mode = 'pause';
    sim.pause(true);
    silence();
    stats('pauseStats');
    $('pauseDialog').showModal();
    $('resume').focus();
  }
  function resume() {
    $('pauseDialog').close();
    clearInput();
    sim.pause(false);
    mode = 'drive';
    last = performance.now();
    $('scene').focus({ preventScroll: true });
  }
  function begin() {
    if (!ready || failed) return;
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    welcome.pause();
    $('audioCaption').hidden = true;
    $('welcome').textContent = '♪ Listen to the welcome';
    sim.restart(selected);
    renderer.setCar(sim.car);
    clearInput();
    mode = 'drive';
    last = performance.now();
    $('menu').hidden = true;
    $('hud').hidden = false;
    $('toast').hidden = true;
    $('scene').focus({ preventScroll: true });
    toast('Take your time. Gold markers are places to explore.');
    updateHud();
  }
  function menu() {
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    mode = 'menu';
    sim.pause(true);
    clearInput();
    silence();
    sim.restart(selected);
    renderer.setCar(sim.car);
    $('menu').hidden = false;
    $('hud').hidden = true;
    $('toast').hidden = true;
    $('start').focus();
  }
  function help() {
    returnFromHelp = mode;
    if (mode === 'drive') {
      sim.pause(true);
      mode = 'help';
    }
    if (mode === 'pause') $('pauseDialog').close();
    mode = 'help';
    clearInput();
    silence();
    $('helpDialog').showModal();
    $('closeHelp').focus();
  }
  function closeHelp() {
    $('helpDialog').close();
    if (returnFromHelp === 'drive') resume();
    else if (returnFromHelp === 'pause') {
      mode = 'pause';
      $('pauseDialog').showModal();
      $('resume').focus();
    } else {
      mode = 'menu';
      $('menuHelp').focus();
    }
  }
  function openMap() {
    if (!ready || !['drive', 'pause'].includes(mode)) return;
    returnFromMap = mode;
    if (mode === 'pause') $('pauseDialog').close();
    sim.pause(true);
    mode = 'map';
    clearInput();
    silence();
    drawMap($('bigMap'), true);
    $('mapDialog').showModal();
    $('closeMap').focus();
  }
  function closeMap() {
    $('mapDialog').close();
    if (returnFromMap === 'pause') {
      mode = 'pause';
      $('pauseDialog').showModal();
      $('resume').focus();
    } else resume();
  }
  const descriptions = {
    rover: 'Light, calm and planted. The easiest way to get to know the island.',
    tourer: 'More pace, more weight. A smooth all-rounder that rewards measured steering.',
    sport: 'Fast on the straights, demanding in the bends. Brake early and give corners room.',
  };
  for (const b of document.querySelectorAll('[data-car]'))
    b.addEventListener('click', () => {
      selected = b.dataset.car;
      for (const card of document.querySelectorAll('[data-car]')) {
        const active = card === b;
        card.classList.toggle('selected', active);
        card.setAttribute('aria-pressed', String(active));
      }
      $('carDescription').textContent = descriptions[selected];
      if (ready) {
        sim.restart(selected);
        renderer.setCar(sim.car);
      }
    });
  $('start').addEventListener('click', begin);
  $('again').addEventListener('click', begin);
  $('restart').addEventListener('click', begin);
  $('changeCar').addEventListener('click', menu);
  $('endCars').addEventListener('click', menu);
  $('pause').addEventListener('click', pause);
  $('resume').addEventListener('click', resume);
  $('help').addEventListener('click', help);
  $('menuHelp').addEventListener('click', help);
  $('closeHelp').addEventListener('click', closeHelp);
  for (const id of ['mapButton', 'minimapButton', 'pauseMap'])
    $(id).addEventListener('click', openMap);
  $('closeMap').addEventListener('click', closeMap);
  for (const [id, handler] of [
    ['pauseDialog', resume],
    ['helpDialog', closeHelp],
    ['mapDialog', closeMap],
    ['endDialog', () => {}],
  ])
    $(id).addEventListener('cancel', (e) => {
      e.preventDefault();
      handler();
    });
  $('welcome').addEventListener('click', async () => {
    if (!welcome.paused) {
      welcome.pause();
      $('welcome').textContent = '♪ Listen to the welcome';
      return;
    }
    $('audioCaption').hidden = false;
    try {
      welcome.currentTime = 0;
      await welcome.play();
      $('welcome').textContent = 'Ⅱ Stop welcome';
    } catch {
      toast('Welcome audio is unavailable. The transcript is shown below.');
    }
  });
  welcome.addEventListener('ended', () => {
    $('welcome').textContent = '♪ Listen to the welcome';
  });
  welcome.addEventListener('error', () => {
    if (!$('audioCaption').hidden)
      toast('Welcome audio is unavailable. You can read the transcript.');
  });
  $('sound').addEventListener('click', async () => {
    try {
      if (!audioContext) {
        const Context = window.AudioContext || window.webkitAudioContext;
        if (!Context) throw new Error('Audio unsupported');
        audioContext = new Context();
        oscillator = audioContext.createOscillator();
        engineGain = audioContext.createGain();
        const filter = audioContext.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 280;
        oscillator.type = 'triangle';
        oscillator.frequency.value = 35;
        engineGain.gain.value = 0;
        oscillator.connect(filter);
        filter.connect(engineGain);
        engineGain.connect(audioContext.destination);
        oscillator.start();
      }
      await audioContext.resume();
      soundEnabled = !soundEnabled;
      $('sound').textContent = soundEnabled ? 'Sound on' : 'Sound off';
      $('sound').setAttribute('aria-pressed', String(soundEnabled));
      if (!soundEnabled) silence();
    } catch {
      soundEnabled = false;
      toast('Sound is unavailable in this browser. Driving works without it.');
    }
  });
  const keyMap = {
    KeyW: 'forward',
    ArrowUp: 'forward',
    KeyS: 'reverse',
    ArrowDown: 'reverse',
    KeyA: 'left',
    ArrowLeft: 'left',
    KeyD: 'right',
    ArrowRight: 'right',
    Space: 'brake',
  };
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLButtonElement && (e.code === 'Space' || e.code === 'Enter')) return;
    if (e.repeat && ['KeyP', 'Escape', 'KeyM', 'KeyC'].includes(e.code)) return;
    if (mode === 'drive' && keyMap[e.code]) {
      e.preventDefault();
      held.add(keyMap[e.code]);
    }
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (mode === 'drive') {
        e.preventDefault();
        pause();
      } else if (mode === 'pause' && e.code === 'KeyP') {
        e.preventDefault();
        resume();
      }
    }
    if (e.code === 'KeyM') {
      if (mode === 'drive') openMap();
      else if (mode === 'map') closeMap();
    }
    if (e.code === 'KeyC' && mode === 'drive') {
      wide = !wide;
      toast(wide ? 'Wide chase camera' : 'Close chase camera');
    }
  });
  window.addEventListener('keyup', (e) => {
    if (keyMap[e.code]) held.delete(keyMap[e.code]);
  });
  window.addEventListener('blur', () => {
    clearInput();
    welcome.pause();
    pause();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInput();
      welcome.pause();
      pause();
    }
  });
  for (const b of document.querySelectorAll('[data-input]')) {
    b.addEventListener('pointerdown', (e) => {
      if (mode !== 'drive') return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      touch.set(e.pointerId, b.dataset.input);
      b.classList.add('pressed');
    });
    const release = (e) => {
      touch.delete(e.pointerId);
      b.classList.remove('pressed');
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', release);
    b.addEventListener('lostpointercapture', release);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  function drawMap(canvas, large = false) {
    const ctx = canvas.getContext('2d'),
      size = canvas.width,
      scale = size / world.size;
    const pos = (p) => [(p.x + world.size / 2) * scale, (p.z + world.size / 2) * scale];
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(mapImage, 0, 0, size, size);
    if (large) {
      ctx.textAlign = 'center';
      ctx.font = 'bold 16px sans-serif';
      ctx.lineWidth = 5;
      for (const l of world.landmarks) {
        const [x, y] = pos(l);
        ctx.strokeStyle = '#203a3c';
        ctx.strokeText(l.name, x, y - 12);
        ctx.fillStyle = '#ffefc9';
        ctx.fillText(l.name, x, y - 12);
      }
      ctx.font = '16px sans-serif';
      ctx.fillText('HARBOUR TOWN', size * 0.34, size * 0.64);
      ctx.fillText('PINE VALLEY', size * 0.24, size * 0.42);
      ctx.fillText('N ↑', size - 40, 42);
    }
    for (const p of sim.checkpoints) {
      const [x, y] = pos(p);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = '#ffc247';
      ctx.strokeStyle = '#292e32';
      ctx.lineWidth = 2;
      const r = large ? 8 : 4;
      ctx.fillRect(-r, -r, r * 2, r * 2);
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      ctx.restore();
    }
    const [x, y] = pos(sim.state);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-sim.state.heading);
    ctx.beginPath();
    const r = large ? 12 : 7;
    ctx.moveTo(0, r);
    ctx.lineTo(-r * 0.7, -r);
    ctx.lineTo(0, -r * 0.5);
    ctx.lineTo(r * 0.7, -r);
    ctx.closePath();
    ctx.strokeStyle = '#16242b';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.restore();
  }
  function updateHud() {
    const s = sim.state,
      kmh = Math.hypot(s.vx, s.vz) * 3.6;
    $('quality').textContent = sim.quality.toFixed(0);
    $('surface').textContent = s.onRoad ? 'On the road' : 'Off-road · reduced grip';
    $('roadName').textContent = world.roadAt(s.x, s.z).name;
    $('speed').textContent = Math.round(kmh);
    $('gear').textContent = s.speed < -0.5 ? 'R' : kmh < 1 ? 'N' : 'D';
    $('speedBar').style.width = `${Math.min(100, (kmh / (sim.car.top * 3.6)) * 100)}%`;
    $('distance').textContent = (s.distance / 1000).toFixed(2) + ' km';
    $('time').textContent = time(s.elapsed);
    $('collected').textContent = s.collected;
    $('collisions').textContent = s.collisions;
    let nearest = null,
      distance = Infinity;
    for (const p of sim.checkpoints) {
      const d = Math.hypot(p.x - s.x, p.z - s.z);
      if (d < distance) {
        distance = d;
        nearest = p;
      }
    }
    const angle = Math.atan2(nearest.x - s.x, nearest.z - s.z) - s.heading;
    $('direction').style.transform = `rotate(${-angle}rad)`;
    $('waypoint').textContent = nearest.name;
    $('wayDistance').textContent = `${Math.round(distance)} m direct · follow roads / map`;
    drawMap($('minimap'));
  }
  function frame(now) {
    if (failed) return;
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000 || 0, 0.1);
    last = now;
    if (mode === 'drive') {
      sim.update(dt, input());
      for (const event of sim.drainEvents()) {
        if (event.type === 'collision')
          toast('Contact · −5 quality. Your car is fine. Reverse to clear.');
        if (event.type === 'checkpoint')
          toast('Place discovered · a new gold marker is on the map.');
        if (event.type === 'water') {
          mode = 'ended';
          clearInput();
          silence();
          stats('endStats');
          $('endDialog').showModal();
          $('again').focus();
        }
      }
      if (soundEnabled && engineGain) {
        oscillator.frequency.setTargetAtTime(
          30 + Math.abs(sim.state.speed) * 2,
          audioContext.currentTime,
          0.08
        );
        engineGain.gain.setTargetAtTime(
          mode === 'drive' ? 0.022 : 0,
          audioContext.currentTime,
          0.1
        );
      }
    }
    renderer.render(sim, dt, mode === 'menu' ? 'menu' : 'drive', wide);
    uiClock += dt;
    if (uiClock > 0.1) {
      updateHud();
      uiClock = 0;
    }
    if (now > toastUntil) $('toast').hidden = true;
  }
  async function boot() {
    try {
      if (!window.IslandWorld || !window.IslandSimulation) throw new Error('Missing simulation');
      const [{ IslandRenderer }, terrain, map] = await Promise.all([
        import('./renderer.mjs'),
        image('assets/images/terrain.png'),
        image('assets/images/island-map.svg'),
        ...['rover', 'tourer', 'sport', 'coast-poster'].map((name) =>
          image(`assets/images/${name}.svg`)
        ),
      ]);
      if (failed) return;
      world = window.IslandWorld.createWorld();
      sim = new window.IslandSimulation.Simulation(world, Math.floor(Math.random() * 2147483647));
      mapImage = map;
      renderer = new IslandRenderer($('scene'), world, terrain);
      renderer.setCar(sim.car);
      ready = true;
      clearTimeout(timeout);
      $('loading').hidden = true;
      $('menu').hidden = false;
      $('start').disabled = false;
      $('start').textContent = 'Start your drive →';
      window.addEventListener('resize', () => renderer.resize());
      last = performance.now();
      requestAnimationFrame(frame);
    } catch {
      clearTimeout(timeout);
      fatal(
        'The island could not load. This game needs WebGL 2 and its complete local assets folder. Try a current browser with hardware acceleration enabled, then reload.'
      );
    }
  }
  boot();
})();
