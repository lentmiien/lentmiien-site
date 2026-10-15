(function () {
  'use strict';

  const { Simulation, MAX_AGE, ageFromTimeline, timelineFromAge, speedFromSlider, sliderFromSpeed } = window.TreeGrowth;
  const sim = new Simulation();
  const get = id => document.getElementById(id);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const format = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
  const integer = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });
  const notes = {
    Seed: 'An oatmeal-sized seed holds the possibility of one of the largest living things on Earth.',
    Seedling: 'A root takes hold. The first delicate needles unfold and begin turning sunlight into new growth.',
    Sapling: 'A slender, pointed crown reaches for the light. Low branches are still close enough to touch.',
    'Young tree': 'Year by year, the trunk thickens. Layers of evergreen branches build a living canopy.',
    'Mature tree': 'Lower branches give way to a high crown. Deeply furrowed bark wraps an increasingly massive trunk.',
    'Ancient giant': 'Centuries settle into the wood. Height changes slowly now, but the great trunk keeps growing.',
  };
  let view, ready = false, failed = false, lastTime = null, elapsed = 0, lastUi = -1, previousStage = '';
  let rafId = 0, wasPlayingBeforeNotes = false, snapCamera = true;

  function showFailure(message) {
    failed = true; ready = false; sim.playing = false;
    cancelAnimationFrame(rafId);
    get('failureText').textContent = message;
    get('failure').hidden = false; get('loading').hidden = true;
    get('app').setAttribute('aria-busy', 'false');
    for (const control of document.querySelectorAll('.time-controls button, .time-controls input, .camera-controls button, .camera-controls input')) control.disabled = true;
  }

  function quantity(element, amount, unit) {
    element.replaceChildren(document.createTextNode(`${amount} `));
    const small = document.createElement('small'); small.textContent = unit; element.append(small);
  }

  function length(value) {
    if (value === 0) return ['—', ''];
    if (value < .01) return [format.format(value * 1000), 'mm'];
    if (value < 1) return [format.format(value * 100), 'cm'];
    return [format.format(value), 'm'];
  }

  function updatePlayback() {
    const ended = sim.age >= MAX_AGE;
    get('playLabel').textContent = ended ? 'Lifetime complete' : sim.playing ? 'Pause growth' : sim.age === 0 ? 'Grow tree' : 'Resume growth';
    get('playIcon').querySelector('use').setAttribute('href', sim.playing ? '#i-pause' : '#i-play');
    get('playButton').disabled = ended || !ready;
    get('timeState').textContent = ended ? '3,000 years. Take a moment to look up.' : sim.playing ? 'A lifetime is unfolding.' : sim.age === 0 ? 'From seed to ancient giant.' : 'Time is still. Take a closer look.';
    get('speedValue').textContent = `${format.format(sim.speed)} ${sim.speed === 1 ? 'year' : 'years'} / sec`;
    get('speed').setAttribute('aria-valuetext', `${format.format(sim.speed)} years per second`);
    get('speed').style.setProperty('--fill', `${sliderFromSpeed(sim.speed) * 100}%`);
  }

  function updateUi() {
    const tree = sim.tree;
    const [height, unit] = tree.height === 0 ? ['0', 'm'] : length(tree.height);
    get('heightValue').textContent = height; get('heightUnit').textContent = unit;
    const years = tree.age < 1 && tree.age > 0 ? [integer.format(tree.age * 365), 'days'] : [format.format(tree.age), 'years'];
    quantity(get('ageValue'), ...years);
    quantity(get('diameterValue'), ...length(tree.diameter));
    quantity(get('crownValue'), ...length(tree.crownSpan));
    quantity(get('carbonValue'), tree.carbon < 1000 ? format.format(tree.carbon) : format.format(tree.carbon / 1000), tree.carbon < 1000 ? 'kg' : 't');
    get('ringsValue').textContent = integer.format(tree.rings);
    get('heightDescription').textContent = tree.age === 0 ? 'Every giant starts here.' : tree.height < 1 ? 'Finding its place in the sunlight.' : `About ${format.format(tree.growthRate * 100)} cm of height this year.`;
    get('timeline').value = String(timelineFromAge(tree.age) * 10000);
    get('timeline').style.setProperty('--fill', `${timelineFromAge(tree.age) * 100}%`);
    get('timeline').setAttribute('aria-valuetext', `${format.format(tree.age)} years, ${tree.stage}`);
    get('scaleLabel').textContent = tree.age < .04 ? '6 mm seed' : `${length(tree.height).join(' ')} tall`;
    if (tree.stage !== previousStage) {
      previousStage = tree.stage;
      get('stage').textContent = tree.stage;
      get('stageNote').textContent = notes[tree.stage];
      get('sceneCaption').textContent = tree.stage === 'Seed' ? 'A single seed. A whole lifetime ahead.' : tree.stage === 'Ancient giant' ? 'Centuries in its branches. Still reaching higher.' : 'New shoots reach out. Another layer of wood takes hold.';
      get('announcement').textContent = `Your tree is now a ${tree.stage.toLowerCase()}.`;
    }
    updatePlayback();
  }

  function seek(age) {
    if (!ready) return;
    sim.playing = false; sim.setAge(age); snapCamera = true;
    updateUi();
  }

  function togglePlayback() {
    if (!ready || get('aboutDialog').open) return;
    sim.toggle(); updatePlayback();
  }

  function setOrbit(enabled) {
    if (!view) return;
    view.autoOrbit = enabled && !reducedMotion;
    get('orbitButton').setAttribute('aria-pressed', String(view.autoOrbit));
  }

  get('playButton').addEventListener('click', togglePlayback);
  get('speed').value = String(Math.round(sliderFromSpeed(sim.speed) * 1000));
  get('speed').addEventListener('input', event => { sim.setSpeed(speedFromSlider(Number(event.target.value) / 1000)); updatePlayback(); });
  get('timeline').addEventListener('input', event => seek(ageFromTimeline(Number(event.target.value) / 10000)));
  for (const button of document.querySelectorAll('[data-age]')) button.addEventListener('click', () => seek(Number(button.dataset.age)));
  get('restartButton').addEventListener('click', () => { sim.reset(); view.resetCamera(0); setOrbit(false); snapCamera = true; updateUi(); get('announcement').textContent = 'A new beginning. Your seed is ready to grow.'; });
  get('elevation').addEventListener('input', event => { view?.setElevation(Number(event.target.value) / 100); get('elevation').setAttribute('aria-valuetext', `${event.target.value} percent of view height`); });
  get('raiseButton').addEventListener('click', () => view?.moveElevation(.08));
  get('lowerButton').addEventListener('click', () => view?.moveElevation(-.08));
  get('zoomInButton').addEventListener('click', () => view?.changeZoom(.82));
  get('zoomOutButton').addEventListener('click', () => view?.changeZoom(1.22));
  get('fitButton').addEventListener('click', () => { view?.resetCamera(); setOrbit(false); });
  get('lockButton').addEventListener('click', () => view?.setFramingLocked(!view.framing.locked));
  get('orbitButton').addEventListener('click', () => setOrbit(!view?.autoOrbit));
  get('reloadButton').addEventListener('click', () => window.location.reload());
  get('aboutButton').addEventListener('click', () => {
    wasPlayingBeforeNotes = sim.playing; sim.playing = false; updatePlayback(); get('aboutDialog').showModal();
  });
  for (const id of ['closeAboutButton', 'backToTreeButton']) get(id).addEventListener('click', () => get('aboutDialog').close());
  get('aboutDialog').addEventListener('close', () => { if (ready && wasPlayingBeforeNotes && sim.age < MAX_AGE) sim.playing = true; updatePlayback(); });
  document.addEventListener('keydown', event => {
    if (event.code !== 'Space' || event.repeat || ['INPUT', 'BUTTON', 'A', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || get('aboutDialog').open) return;
    event.preventDefault(); togglePlayback();
  });
  get('scene').addEventListener('webglcontextlost', event => {
    event.preventDefault(); showFailure('The graphics connection was interrupted. Reload the view to start a new tree.');
  });
  document.addEventListener('visibilitychange', () => {
    lastTime = null;
    if (document.hidden) { cancelAnimationFrame(rafId); view?.pointers.clear(); }
    else if (ready && !failed) rafId = requestAnimationFrame(frame);
  });
  window.addEventListener('pagehide', event => { if (!event.persisted) { cancelAnimationFrame(rafId); view?.dispose(); } });

  function frame(time) {
    if (!ready || failed || document.hidden) return;
    const dt = lastTime === null ? 0 : Math.min(.1, (time - lastTime) / 1000);
    lastTime = time; elapsed += dt;
    sim.tick(dt, document.hidden);
    try {
      // Update bounded geometry at 20 Hz; camera and wind remain frame smooth.
      if (time - lastUi >= 50 || snapCamera) {
        view.updateTree(sim.tree); updateUi(); lastUi = time;
      }
      view.render(dt, elapsed, snapCamera); snapCamera = false;
    } catch {
      showFailure('The 3D view could not continue. Reload the view, or try a browser with hardware acceleration enabled.');
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  async function boot() {
    try {
      const { TreeView } = await import('./renderer.mjs');
      view = new TreeView(get('scene'), reducedMotion, (value, locked = view?.framing.locked || false) => {
        get('elevation').value = String(Math.round(value * 100));
        get('elevation').setAttribute('aria-valuetext', `${Math.round(value * 100)} percent of view height`);
        get('lockButton').setAttribute('aria-pressed', String(locked));
        get('lockButton').title = locked ? 'Camera framing held. Click to allow automatic pullbacks.' : 'Hold camera framing to watch growth';
        get('framingLabel').textContent = locked ? 'FRAMING HELD' : 'ROOM TO GROW';
      });
      view.updateTree(sim.tree); view.render(0, 0, true);
      ready = true;
      get('loading').hidden = true; get('app').setAttribute('aria-busy', 'false');
      for (const control of document.querySelectorAll('.time-controls button, .time-controls input')) control.disabled = false;
      if (reducedMotion) { get('orbitButton').disabled = true; get('orbitButton').title = 'Automatic orbit is off because reduced motion is enabled'; }
      updateUi(); rafId = requestAnimationFrame(frame);
    } catch {
      showFailure('The 3D view needs WebGL 2 and all local game files. Enable hardware acceleration, make sure this page is served over HTTP, then reload.');
    }
  }
  boot();
})();
