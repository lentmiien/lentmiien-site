(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const W = window.CommonsWorld;
  let renderer, socket, state, lastNearby = '', toastTimer, awaiting = false, lastStateAt = 0;
  let connectionEpoch = 0;
  const held = new Set();
  let touch = { x: 0, y: 0 }, lastInput = '';
  const errors = {
    UNAUTHORIZED: 'Access expired or is unavailable. Sign in and reload this page.',
    SESSION_EXPIRED: 'Your session needs to reconnect. Reload to continue.',
    ROOM_FULL: 'All village places are in use. Try again when a villager leaves.',
    VILLAGE_FULL: 'All twelve cottages have been reserved. The village cannot accept another resident.',
    ROOM_UNAVAILABLE: 'The village cannot open right now. Storage or another room owner may be unavailable. Try again shortly.',
    SAVE_UNAVAILABLE: 'Saving is unavailable. The village has paused to protect your progress. Retry shortly; movement since the last save may be lost.',
    TAKEN_OVER: 'Your account entered from another tab or device. Enter here to take over again.',
    TOO_FAR: 'Move a little closer to that place.', PRIVATE_HOUSE: 'This cottage belongs to another villager. Your cottage number is in Field notes.',
    NEED_LANTERN: 'Make a lantern at Willow Workshop first.', NPC_BUSY: 'Mori needs a moment. Try again in fifteen seconds.',
    BUSY: 'One moment, please.', INVALID_INPUT: 'Please use a short message of up to 400 characters.',
  };
  function toast(text) { $('toast').textContent = text; $('toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 5500); }
  function stopMovement() { held.clear(); touch = { x: 0, y: 0 }; sendInput(true); }
  function showCover(text) {
    connectionEpoch++; awaiting = false; $('npc-send').disabled = false;
    stopMovement(); $('status').textContent = text; $('enter').textContent = 'Enter the Commons'; $('enter').disabled = !renderer;
    $('cover').hidden = false; $('online').textContent = 'Offline';
    if ($('interaction').open) $('interaction').close();
    if ($('guide').open) $('guide').close();
  }
  function update(snapshot) {
    if (snapshot.version !== W.VERSION) { socket.disconnect(); showCover('The village has changed. Reload this page for the new version.'); return; }
    state = snapshot; lastStateAt = Date.now(); renderer.update(snapshot);
    const clock = W.clock(snapshot.serverTime), self = snapshot.self;
    $('phase').textContent = clock.phase; $('time').textContent = `${clock.time} · Tokyo`;
    $('online').textContent = `${snapshot.online} / ${snapshot.maxOnline} here`;
    $('place').textContent = self.scene === 'home' ? `Your cottage · ${self.plot + 1}` : self.x < 16 ? 'The woodland path' : self.y > 29 ? 'The garden lane' : 'The village square';
    $('home-hint').textContent = `Your cottage is number ${self.plot + 1} on the ${self.plot < 6 ? 'north' : 'south'} lane. Each lane runs west to east, six cottages across.`;
    $('identity').textContent = `Cottage ${self.plot + 1} · ${self.plot < 6 ? 'North' : 'South'} lane`;
    $('discoveries').textContent = `${self.discoveries.length} / 3`;
    $('petals').textContent = `${self.petals} petals`;
    $('lantern').textContent = self.lantern ? 'Made with care' : 'Not yet made';
    $('blooms').textContent = snapshot.blooms;
    const saveAge = Date.now() - new Date(snapshot.savedAt).getTime();
    $('save-status').textContent = saveAge < 10000 ? 'Progress saved · movement saves every 5s' : 'Waiting for the next save…';
    const nearby = W.nearby(self);
    const key = nearby.map(l => l.id).join(',');
    if (key !== lastNearby) {
      lastNearby = key; $('nearby-list').replaceChildren();
      for (const place of nearby) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = place.kind === 'home' && place.plot === self.plot ? 'Your cottage' : place.name;
        button.addEventListener('click', () => interact(place.id)); $('nearby-list').append(button);
      }
      if (!nearby.length) { const p = document.createElement('p'); p.textContent = 'Walk towards a place to discover it.'; $('nearby-list').append(p); }
    }
    $('interact').disabled = !nearby.length || awaiting;
    $('interact').textContent = nearby.length ? `Visit ${nearby[0].kind === 'npc' ? 'Mori' : nearby[0].kind === 'home' ? 'cottage' : nearby[0].kind === 'exit' ? 'village' : nearby[0].kind === 'garden' ? 'garden' : 'nearby place'}` : 'Explore nearby';
  }
  function sendInput(force = false) {
    if (!socket?.connected || !state) return;
    const blocked = $('interaction').open || $('guide').open || !$('cover').hidden || document.hidden;
    const x = blocked ? 0 : touch.x || Number(held.has('d') || held.has('arrowright')) - Number(held.has('a') || held.has('arrowleft'));
    const y = blocked ? 0 : touch.y || Number(held.has('s') || held.has('arrowdown')) - Number(held.has('w') || held.has('arrowup'));
    const key = `${x},${y}`;
    if (force || x || y || key !== lastInput) { socket.emit('input', { x, y }); lastInput = key; }
  }
  function command(event, data, retry = true, connection = socket, epoch = connectionEpoch) {
    return new Promise(resolve => {
      if (epoch !== connectionEpoch || connection !== socket || !connection?.connected) return resolve({ error: 'UNAUTHORIZED' });
      connection.timeout(event === 'talk' ? 16000 : 6000).emit(event, data, (error, result) => {
        if (epoch !== connectionEpoch || connection !== socket || !connection.connected) return resolve({ error: 'UNAUTHORIZED' });
        if (error && event === 'action' && retry) {
          toast('Confirming the saved action…');
          return resolve(command(event, data, false, connection, epoch)); // Retry only on the originating connection, with the same receipt.
        }
        resolve(error ? { error: 'BUSY', uncertain: true } : result || { error: 'BUSY' });
      });
    });
  }
  async function interact(target) {
    if (awaiting || !state) return;
    const epoch = connectionEpoch;
    awaiting = true; stopMovement();
    const result = await command('action', { id: crypto.randomUUID(), target });
    if (epoch !== connectionEpoch) return;
    awaiting = false;
    if (result.error) return toast(errors[result.error] || 'That action is unavailable.');
    if (!$('cover').hidden) return;
    const location = W.locations.find(l => l.id === target);
    $('dialog-title').textContent = location?.name || (target === 'exit' ? 'Back to the village' : 'A little warmth');
    $('dialog-text').textContent = result.message || '';
    $('portal').hidden = !result.href;
    // Server allowlist, also checked here: model text never creates a destination.
    if (['/chat5/top', '/commons/diagnostics'].includes(result.href)) { $('portal').href = result.href; $('portal').textContent = result.label; }
    else $('portal').hidden = true;
    $('gallery').hidden = !result.gallery; $('npc-form').hidden = !result.npc; $('npc-answer').textContent = '';
    if (['exit'].includes(target)) return toast(result.message);
    $('interaction').showModal();
  }
  $('enter').addEventListener('click', () => {
    if (!renderer) return;
    socket?.disconnect(); connectionEpoch++; awaiting = false; $('npc-send').disabled = false;
    $('enter').disabled = true; $('status').textContent = 'Finding your place in the village…';
    socket = window.io('/commons', { auth: { csrf: document.querySelector('meta[name="csrf-token"]').content },
      path: '/commons/socket.io', transports: ['websocket'], forceNew: true, reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1500, reconnectionDelayMax: 5000 });
    socket.on('joined', snapshot => { $('cover').hidden = true; lastNearby = '__new__'; update(snapshot); $('world').focus({ preventScroll: true }); toast(`Welcome home. Cottage ${snapshot.self.plot + 1} is yours.`); });
    socket.on('state', update);
    socket.on('closed', ({ code }) => { socket.io.reconnection(false); showCover(errors[code] || 'The village connection closed.'); });
    socket.on('connect_error', error => {
      if (error.message === 'UNAUTHORIZED') socket.io.reconnection(false);
      showCover(errors[error.message] || 'Connection unavailable. Please try again.');
    });
    socket.on('disconnect', reason => { if ($('cover').hidden) showCover(reason === 'io server disconnect' ? 'The village paused. Enter again when ready.' : 'Connection interrupted. Reconnecting…'); });
    socket.io.on('reconnect_failed', () => showCover('Reconnection did not succeed. Try entering again.'));
  });
  $('interact').addEventListener('click', () => { const p = state && W.nearby(state.self)[0]; if (p) interact(p.id); });
  $('wave').addEventListener('click', async () => { const result = await command('emote', 'Hello!'); if (result.error) toast(errors[result.error] || 'Unable to wave.'); });
  $('close-dialog').addEventListener('click', () => $('interaction').close());
  $('help').addEventListener('click', () => { stopMovement(); $('guide').showModal(); });
  $('close-guide').addEventListener('click', () => $('guide').close());
  $('zoom-in').addEventListener('click', () => renderer?.zoom(.15)); $('zoom-out').addEventListener('click', () => renderer?.zoom(-.15));
  $('reduced-motion').checked = matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('reduced-motion').addEventListener('change', () => { if (renderer) renderer.reducedMotion = $('reduced-motion').checked; });
  $('npc-form').addEventListener('submit', async event => {
    event.preventDefault(); const text = $('npc-text').value.trim(); if (!text) return;
    const epoch = connectionEpoch;
    $('npc-send').disabled = true; $('npc-answer').textContent = 'Mori is listening… You can close this and keep exploring.';
    const result = await command('talk', { text });
    if (epoch !== connectionEpoch) return;
    $('npc-send').disabled = false;
    $('npc-answer').textContent = result.error ? errors[result.error] || 'Mori is unavailable.' : `${result.mode === 'llm' ? 'AI reply' : result.mode === 'fallback' ? 'Local reply · AI unavailable' : 'Local scripted reply'}\n${result.text}`;
  });
  window.addEventListener('keydown', event => {
    if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(event.target.tagName) || $('interaction').open || $('guide').open || !$('cover').hidden) return;
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) { event.preventDefault(); if (!event.repeat) { held.add(key); sendInput(); } }
    if (key === 'e' && !event.repeat) { event.preventDefault(); $('interact').click(); }
  });
  window.addEventListener('keyup', event => { held.delete(event.key.toLowerCase()); sendInput(); });
  window.addEventListener('blur', stopMovement); document.addEventListener('visibilitychange', stopMovement);
  document.querySelectorAll('.movement button').forEach(button => {
    button.addEventListener('pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); touch = { x: Number(button.dataset.x), y: Number(button.dataset.y) }; sendInput(true); });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(name, () => { touch = { x: 0, y: 0 }; sendInput(true); });
  });
  setInterval(() => { sendInput(); if (state && $('cover').hidden && Date.now() - lastStateAt > 6000) { stopMovement(); toast('Waiting for the village connection…'); } }, 100);
  function loadImage(src) { return new Promise((resolve, reject) => { const image = new Image(); const timer = setTimeout(reject, 15000); image.onload = () => { clearTimeout(timer); resolve(image); }; image.onerror = () => { clearTimeout(timer); reject(new Error('Art unavailable')); }; image.src = src; }); }
  Promise.all([loadImage('/commons/village-atlas.v1.webp'), loadImage('/commons/blue-hour.v1.webp'), loadImage('/commons/scenery-atlas.v1.webp'), loadImage('/commons/cottage.v1.webp')]).then(([atlas, painting, scenery, cottage]) => {
    if (!window.io || !W || !window.CommonsRenderer) throw new Error('Client unavailable');
    renderer = new window.CommonsRenderer($('world'), atlas, painting, scenery, cottage);
    $('status').textContent = 'Your place will be saved. Leave whenever you like.'; $('enter').disabled = false;
  }).catch(() => { $('status').textContent = 'The village art or connection library could not load. Reload this page to try again.'; });
}());
