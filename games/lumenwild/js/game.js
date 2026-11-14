(function () {
  'use strict';
  const C = window.Lumenwild;
  const $ = id => document.getElementById(id);
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const art = (index, className = '') => {
    const image = make('img', className);
    image.src = `assets/prop-${index}.webp`; image.alt = ''; return image;
  };
  const guardianArt = (id, frame = 0, className = 'guardian-portrait') => {
    const image = make('img', className); image.src = `assets/boss-${id}-${frame}.webp`; image.alt = ''; return image;
  };
  const renderer = new window.LumenwildRenderer($('world'), $('minimap'));
  const dialog = $('dialog');
  let profile = C.profile(), game = null, playing = false, ready = false;
  let dialogKind = '', dialogLocked = false, previousFocus = null;
  let held = null, lastAction = 0, lastFrame = 0, toastUntil = 0, lastAmbient = 0;
  let saveTimer = null, storageFailed = false, assetsFailed = false, lastHud = 0, lastCheckpoint = 0;

  class Sound {
    constructor() { this.context = null; this.master = null; }
    enable() {
      try {
        if (!this.context) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (!AudioContext) return;
          this.context = new AudioContext(); this.master = this.context.createGain();
          this.master.gain.value = .08; this.master.connect(this.context.destination);
        }
        this.context.resume().catch(() => {});
      } catch { /* A browser can disable audio; gameplay remains available. */ }
    }
    note(frequency, duration = .18, delay = 0, type = 'sine', volume = 1) {
      if (!profile.sound || !this.context || this.context.state !== 'running') return;
      const now = this.context.currentTime + delay;
      const oscillator = this.context.createOscillator(), envelope = this.context.createGain();
      oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, now);
      envelope.gain.setValueAtTime(0, now); envelope.gain.linearRampToValueAtTime(volume, now + .014);
      envelope.gain.exponentialRampToValueAtTime(.001, now + duration);
      oscillator.connect(envelope); envelope.connect(this.master);
      oscillator.start(now); oscillator.stop(now + duration + .03);
      oscillator.onended = () => { oscillator.disconnect(); envelope.disconnect(); };
    }
    play(type) {
      if (type === 'move') this.note(120, .045, 0, 'triangle', .18);
      if (['pickup', 'chest', 'memory', 'relic', 'landmark'].includes(type)) { this.note(659, .18); this.note(988, .27, .07); }
      if (['seed', 'puzzleSolved', 'restored', 'bossDefeated', 'courierHome'].includes(type)) [392, 494, 587, 784].forEach((n, i) => this.note(n, .6, i * .12, 'sine', .7));
      if (['bossStart', 'bossPhase'].includes(type)) [147, 220, 294].forEach((n, i) => this.note(n, .8, i * .15, 'triangle', .5));
      if (type === 'bossWarning') { this.note(196, .4, 0, 'sine', .4); this.note(294, .4, .12, 'sine', .3); }
      if (type === 'bossImpact') this.note(73, .25, 0, 'triangle', .5);
      if (type === 'sweep') { this.note(260, .12, 0, 'triangle', .4); this.note(520, .12, .04, 'sine', .3); }
      if (type === 'shift') [220, 330, 440].forEach((n, i) => this.note(n, .5, i * .06, 'sine', .5));
      if (type === 'hurt') this.note(92, .18, 0, 'triangle', .9);
      if (['freed', 'parry'].includes(type)) { this.note(440, .23); this.note(660, .3, .06); }
      if (type === 'heal') { this.note(523, .35); this.note(784, .45, .1); }
      if (['bomb', 'art'].includes(type)) { this.note(70, .35, 0, 'triangle', 1); this.note(880, .5, .05, 'sine', .5); }
      if (type === 'dash') this.note(390, .17, 0, 'sine', .4);
      if (type === 'rune') this.note(523, .28);
    }
    quiet() { if (this.context?.state === 'running') this.context.suspend().catch(() => {}); }
  }
  const sound = new Sound();

  function storageNotice(text) {
    $('storageNotice').textContent = text;
    $('storageNotice').hidden = false;
  }

  function load() {
    try {
      const saved = C.readSave(localStorage.getItem(C.SAVE_KEY));
      profile = saved.profile; game = saved.game;
      if (saved.migrated && !saved.invalid) $('loadStatus').textContent = 'Your original camp and expedition are ready. New paths await.';
      if (saved.invalid) storageNotice('An unreadable expedition was left behind. Valid camp progress has been kept where possible.');
    } catch {
      storageFailed = true;
      storageNotice('Browser storage is unavailable. You can play, but this session’s progress cannot be saved.');
    }
  }

  function save(immediate = false) {
    if (game) C.syncDiscoveries(profile, game);
    clearTimeout(saveTimer);
    const write = () => {
      try {
        localStorage.setItem(C.SAVE_KEY, C.writeSave(profile, game && ['playing', 'blessing'].includes(game.status) ? game : null));
        $('saveStatus').textContent = 'Your journey is saved';
        if (storageFailed) { storageFailed = false; $('storageNotice').hidden = true; }
      } catch {
        storageFailed = true;
        $('saveStatus').textContent = 'Progress is not saved';
        storageNotice('Your browser could not save this journey. Keep this page open to continue playing.');
      }
    };
    if (immediate) write(); else saveTimer = setTimeout(write, 180);
  }

  function setSound() {
    $('soundButton').setAttribute('aria-pressed', String(profile.sound));
    $('soundButton').setAttribute('aria-label', profile.sound ? 'Mute sound' : 'Enable sound');
    $('soundButton').querySelector('span').textContent = profile.sound ? 'Sound on' : 'Sound off';
  }

  function camp() {
    playing = false; held = null;
    $('playScreen').hidden = true; $('campScreen').hidden = false; $('pauseButton').hidden = true;
    $('campLight').textContent = profile.light;
    $('campWins').textContent = `${C.medals(profile)} / ${C.BIOMES.length * 3}`;
    $('campMemories').textContent = `${profile.memories.length} / ${C.MEMORIES.length}`;
    $('guardianProgress').textContent = `${C.GUARDIANS.filter(b => profile.guardians[b.id]).length} / 3 guardians awakened · ${C.guardianMedals(profile)} / 9 trial seals · ${profile.rescues} fireflies home`;
    $('gentleMode').checked = profile.gentle;
    $('continueButton').hidden = !game || !['playing', 'blessing'].includes(game.status);
    $('mainAction').classList.toggle('secondary', !$('continueButton').hidden);
    if (!$('continueButton').hidden) $('continueDetail').textContent = `${game.biome.name} · ${game.seeds}/3 heartseeds${game.daily ? ' · daily' : ''}`;
    const selected = C.TRAILS.find(t => t.id === profile.selectedTrail && C.trailUnlocked(profile, t.id)) || C.TRAILS[0];
    profile.selectedTrail = selected.id;
    $('selectedJourney').textContent = `${selected.name} · ${selected.route.length} regions`;
    $('mainAction').querySelector('span').replaceChildren(document.createTextNode('Begin your journey'), make('small', '', selected.name));
    $('workshopDetail').textContent = `${Object.values(profile.upgrades).reduce((a, b) => a + b, 0)} / 27 upgrades · ${C.ARTS.filter(a => C.artUnlocked(profile, a.id)).length} / ${C.ARTS.length} arts · ${C.CHARMS.filter(c => c.id !== 'none' && C.charmUnlocked(profile, c.id)).length} / 4 charms`;
    setSound();
  }

  function toast(text, duration = 3300) {
    if (!text) return;
    $('toast').textContent = text; $('toast').hidden = false; toastUntil = performance.now() + duration;
  }

  function updateHud() {
    if (!game) return;
    const stats = game.stats(), region = game.biome;
    $('healthText').textContent = `${game.player.hp} / ${stats.maxHp}`;
    $('hearts').setAttribute('aria-label', `${game.player.hp} of ${stats.maxHp} hearts`);
    const healthKey = `${game.player.hp}:${stats.maxHp}`;
    if ($('hearts').dataset.health !== healthKey) {
      $('hearts').dataset.health = healthKey;
      $('hearts').replaceChildren(...Array.from({ length: stats.maxHp }, (_, i) => make('span', `heart${i < game.player.hp ? '' : ' empty'}`)));
    }
    $('seedCount').replaceChildren(document.createTextNode(`${game.seeds} `), make('span', '', '/ 3'));
    $('lightCount').textContent = game.light;
    $('phaseName').textContent = game.phase ? 'Echo' : 'Bloom';
    $('phaseIcon').textContent = game.phase ? '☾' : '☼';
    $('phaseButton').classList.toggle('echo', !!game.phase);
    $('phaseButton').setAttribute('aria-label', `In ${game.phase ? 'Echo' : 'Bloom'}. Shift to ${game.phase ? 'Bloom' : 'Echo'}.`);
    $('chapterLabel').textContent = `${game.daily ? 'DAILY · ' : game.gentle ? 'GENTLE · ' : ''}REGION ${game.depth + 1} / ${game.journey.length}${game.tier > 1 ? ` · TIER ${game.tier}` : ''}`;
    $('regionName').textContent = region.name; $('regionSubtitle').textContent = region.subtitle;
    const landmarks = game.map.entities.filter(e => e.type === 'landmark'), relic = game.map.entities.find(e => e.type === 'relic');
    $('regionQuest').textContent = game.trail === 'trial' ? 'A guardian trial · no maze to repeat' : landmarks.length ? `Landmarks ${landmarks.filter(e => e.done).length} / 3 · ${relic?.done ? 'Relic found' : 'Relic waiting'}` : 'An original journey · new paths await at camp';
    $('objectiveText').textContent = game.boss?.state === 'active' ? 'Dodge the warning. Strike the open heart. Escape pauses or lets you leave.' : game.seeds === 3 ? game.boss?.state === 'sleeping' ? 'Heartseeds ready. Find the guardian’s arena and press E.' : 'All heartseeds found. Return to the waygate and press E.' : `Find ${3 - game.seeds} heartseed${game.seeds === 2 ? '' : 's'}. Explore Bloom and Echo.`;
    if (game.carrying) $('objectiveText').textContent += ' A firefly needs a ride to the waygate.';
    if (game.guideTurns) $('objectiveText').textContent += ` Thread: ${game.guideTurns} actions.`;
    for (const [key, label] of [['attack', 'Ready'], ['shift', 'Shift world'], ['dash', 'Dash ahead'], ['guard', 'Reflect a hit']]) {
      $(`${key}Cooldown`).textContent = game.cooldowns[key] > 0 ? `${game.cooldowns[key].toFixed(1)}s` : label;
      document.querySelector(`[data-action="${key}"]`).classList.toggle('recovering', game.cooldowns[key] > 0);
    }
    const equipped = C.ARTS.find(a => a.id === game.art);
    $('equippedArtName').textContent = equipped.name;
    $('equippedArtImage').src = `assets/prop-${equipped.icon}.webp`;
    $('focusCount').textContent = `${Math.floor(game.focus)} / ${stats.maxFocus} focus · ${equipped.cost} to cast`;
    document.querySelector('[data-action="art"]').classList.toggle('recovering', game.focus < equipped.cost || game.cooldowns.art > 0);
    for (const [key, label] of [['medicine', 'heal 5'], ['bomb', 'burst'], ['thread', 'find a path']]) {
      $(`${key}Count`).textContent = `× ${game.inventory[key]} · ${label}`;
      document.querySelector(`[data-action="${key}"]`).setAttribute('aria-label', `${key}: ${game.inventory[key]} remaining. ${label}.`);
    }
    const nearby = game.nearby();
    $('interactPrompt').hidden = !nearby;
    if (nearby) $('interactPrompt').querySelector('span').textContent = { portal: game.carrying ? 'Bring the firefly home' : game.seeds === 3 ? 'Restore the garden' : 'The waygate', chest: 'Open treasure cache', well: 'Drink from the spring', shrine: 'Read the runes', landmark: nearby.done ? region.feature === 'spores' ? 'Travel through the roots' : 'Ride the ferry' : `Restore ${region.landmark}${['stars', 'auroras'].includes(region.feature) ? ` ${nearby.number}` : ''}`, trader: 'Visit the wayfarer', loom: 'Turn the fold loom', guardian: 'Meet the guardian' }[nearby.type];
    const boss = game.boss, active = boss?.state === 'active';
    $('guardianHud').hidden = !active; $('stage').classList.toggle('boss-active', !!active);
    if (active) {
      $('guardianName').textContent = C.GUARDIANS.find(b => b.id === boss.id).name;
      $('guardianStage').textContent = `PHASE ${boss.stage} / 3 · ${boss.hp} / ${boss.maxHp}`;
      $('guardianHealth').max = boss.maxHp; $('guardianHealth').value = boss.hp;
      $('guardianHud').classList.toggle('opening', boss.mode === 'recovery');
      $('guardianPattern').textContent = boss.mode === 'recovery' ? `Open heart · double damage · ${boss.timer.toFixed(1)}s` : boss.mode === 'windup' ? `${boss.attack} · ${boss.realm === -1 ? 'both worlds' : boss.realm ? '☾ Echo only' : '☼ Bloom only'} · ${boss.timer.toFixed(1)}s` : boss.mode === 'transition' ? 'A new pattern gathers · find your footing.' : 'The guardian stirs. Find your footing.';
    }
    $('blessingSummary').textContent = game.blessings.length ? game.blessings.map(id => C.BLESSINGS.find(b => b.id === id).name).join(' · ') : 'A small lantern can change everything.';
    renderer.drawMap(game);
  }

  function openDialog(kind, eyebrow, title, locked = false) {
    held = null;
    if (!dialog.open) previousFocus = document.activeElement;
    dialogKind = kind; dialogLocked = locked;
    dialog.classList.toggle('map-dialog', ['map', 'journeys', 'workshop', 'journal', 'trials'].includes(kind));
    $('dialogEyebrow').textContent = eyebrow;
    $('dialogTitle').textContent = title;
    $('dialogBody').replaceChildren(); $('dialogActions').replaceChildren();
    $('closeDialog').hidden = locked;
    if (!dialog.open) dialog.showModal();
    requestAnimationFrame(() => {
      const first = locked ? $('dialogBody').querySelector('button') || $('dialogActions').querySelector('button') : $('closeDialog');
      first?.focus();
    });
    return $('dialogBody');
  }

  function closeDialog() {
    dialogLocked = false; dialog.close();
  }

  function button(label, handler, primary = true) {
    const element = make('button', `primary-button${primary ? '' : ' secondary'}`, label);
    element.type = 'button'; element.addEventListener('click', handler);
    $('dialogActions').append(element); return element;
  }

  function play() {
    if (!game || !ready) return;
    playing = true; held = null;
    $('campScreen').hidden = true; $('playScreen').hidden = false; $('pauseButton').hidden = false;
    renderer.resize(); renderer.reset(game); updateHud();
    $('world').focus();
    if (profile.sound) sound.enable();
    if (game.status === 'blessing') blessings();
    else if (game.turn === 0 && profile.runs === 0) {
      const body = openDialog('welcome', 'YOUR FIRST STEPS', 'Keep a little light with you.');
      body.append(make('p', '', 'You are Pip, the last lantern keeper. Three heartseeds are scattered through each garden. Bring them back to the waygate where you arrived.'));
      const grid = make('div', 'guide-grid');
      for (const [icon, title, text] of [[1, 'Wander and discover', 'Move with WASD, arrows, a swipe, or the direction pad. Walk over glowing finds to collect them.'], [8, 'Unfold the world', 'Q switches Bloom and Echo, opening different paths. Some heartseeds only exist in one world.'], [6, 'You can fight back', 'Space sweeps your lantern. Enemy rings count down in real time. Dodge, guard with G, or use your lantern gale with R.'], [4, 'Never truly lost', 'M opens your atlas. A guiding thread (3) traces a route to the next heartseed, then home.']]) {
        const card = make('div', 'guide-card'); card.append(art(icon), make('h3', '', title), make('p', '', text)); grid.append(card);
      }
      body.append(grid, make('p', '', 'There is no expedition deadline. Escape, the atlas, and every reading dialog pause the world. Save and continue whenever you like.'));
      button('Light the lantern →', () => { closeDialog(); toast('Your first starlight is just to the right. Follow your curiosity.', 5500); });
    } else toast('Enemy rings count down in real time. G guards · R uses your art · Escape pauses.', 5500);
  }

  function start(daily = false, options = {}) {
    if (!ready) return;
    const begin = () => {
      if (dialog.open) closeDialog();
      const date = new Date().toISOString().slice(0, 10);
      const seed = daily ? C.hash(`lumenwild:${date}`) : crypto.getRandomValues(new Uint32Array(1))[0];
      if (game && !game.settled) { game.status = 'returned'; C.bankExpedition(profile, game); }
      game = C.createExpedition(profile, { seed, daily, ...options });
      if (!game) { camp(); return; }
      save(true); play();
    };
    if (game && ['playing', 'blessing'].includes(game.status)) {
      const body = openDialog('replace', 'A NEW PATH', 'Bring this expedition home?');
      body.append(make('p', '', 'Your starlight, relics, journal pages, and completed regional surveys will be brought home before you start the new journey.'));
      button('Begin a new journey', begin);
      button('Keep my expedition', closeDialog, false);
    } else begin();
  }

  function events() {
    const pending = game.events.splice(0);
    renderer.effects(pending, game);
    for (const event of pending) sound.play(event.type);
    const meaningful = pending.filter(e => e.text && !['pickup', 'warning', 'bossWarning'].includes(e.type));
    const message = meaningful.at(-1) || pending.find(e => e.text);
    if (message && message.type !== 'memory') toast(message.text, message.type === 'hurt' ? 4500 : 3300);
    const memory = pending.find(e => e.type === 'memory');
    if (memory) {
      const body = openDialog('memory', 'A MEMORY FOUND', C.MEMORIES[memory.memory][0]);
      body.append(art(11, 'result-art'), make('p', '', C.MEMORIES[memory.memory][1]), make('p', '', 'This page is now in your journal, even if the expedition ends.'));
      button('Carry it with you →', closeDialog);
    }
    const relic = pending.find(e => e.type === 'relic');
    if (relic && !memory) {
      const found = C.RELICS[relic.relic], body = openDialog('relic', 'A RELIC FOUND', found.name);
      body.append(art(found.icon, 'result-art'), make('p', '', 'A piece of this region’s story, now safe in your collection. Relics help complete surveys and unlock lantern arts.'));
      button('Carry it home →', closeDialog);
    }
    if (pending.some(e => e.type === 'puzzle')) puzzle();
    if (pending.some(e => e.type === 'trader')) trader();
    if (pending.some(e => e.type === 'challenge' || e.type === 'bossRetry')) guardianEncounter(pending.some(e => e.type === 'bossRetry'));
    if (pending.some(e => e.type === 'bossDefeated') && game.trail !== 'trial') guardianVictory();
    updateHud(); save();
    if (game.status === 'blessing') blessings();
    if (['won', 'lost', 'returned'].includes(game.status)) finish();
  }

  function act(action, direction) {
    if (!playing || !game || dialog.open || document.hidden) return;
    const now = performance.now();
    if (action === 'move' && now - lastAction < 105) return;
    // Abilities take priority over held movement. A sweep or tonic must never
    // disappear because a walking repeat happened a few milliseconds earlier.
    if (action !== 'move' && held) held.next = now + 230;
    lastAction = now;
    if (profile.sound) sound.enable();
    game.act(action, direction);
    events();
  }

  function blessings() {
    const body = openDialog('blessing', 'A GARDEN RESTORED', 'The roots remember you.', true);
    body.append(art(14, 'result-art'), make('p', '', `${game.biome.name} is alive again. Choose a blessing to carry into ${C.BIOMES[game.journey[game.depth + 1]].name}. Your hearts refill, and you receive a tonic and a guiding thread.`));
    const grid = make('div', 'blessing-grid');
    for (const blessing of game.choices()) {
      const card = make('button', 'blessing-card'); card.type = 'button'; card.dataset.blessing = blessing.id;
      const copy = make('span'); copy.append(make('strong', '', blessing.name), make('small', '', blessing.text));
      card.append(art(blessing.icon), copy);
      card.addEventListener('click', () => {
        if (!game.chooseBlessing(blessing.id)) return;
        closeDialog(); renderer.reset(game); updateHud(); save(true);
        toast(`${game.biome.name} · ${blessing.name} is yours`, 5000); sound.play('restored');
      }); grid.append(card);
    }
    body.append(grid);
    button('Save and return to camp', () => { save(true); closeDialog(); camp(); }, false);
  }

  function finish() {
    held = null;
    if (!C.bankExpedition(profile, game)) return;
    const won = game.status === 'won', trail = C.TRAILS.find(t => t.id === game.trail);
    const unlocked = won && trail ? C.TRAILS.filter(t => t.requires === trail.id) : [];
    const trial = game.trail === 'trial' && won;
    const body = openDialog('result', trial ? 'A GUARDIAN TRIAL COMPLETE' : won ? 'A PATH RESTORED' : 'EVERY JOURNEY LEAVES A LITTLE LIGHT', trial ? 'An old promise, kept.' : won ? 'And the world opened.' : 'Home is a light left on.', true);
    body.append(trial ? guardianArt(game.boss.id, 3) : art(won ? game.biome.landmarkIcon : 10, 'result-art'));
    body.append(make('p', '', trial ? `${C.GUARDIANS.find(b => b.id === game.boss.id).name} remembers your light. ${game.tier < 3 ? 'The next trial tier is ready in the world atlas.' : 'The radiant seal is yours. Every tier of this guardian is restored.'}` : unlocked.length ? `${trail.name} is complete. ${unlocked.map(t => t.name).join(' and ')} ${unlocked.length > 1 ? 'are' : 'is'} now open on your world atlas.` : won ? 'Your lantern has brought life back to this path. Look in your atlas for regional secrets, missing relics, and the next survey medal.' : 'Every piece of starlight and every discovery comes home with you. Your completed regions count towards their surveys.'));
    const stats = make('div', 'result-stats');
    for (const [value, title] of [[game.light + (game.medalReward || 0) + (game.guardianReward || 0), 'Starlight brought home'], [game.score, 'Expedition score'], [game.kills, 'Creatures freed']]) {
      const box = make('div'); box.append(make('strong', '', value), make('span', '', title)); stats.append(box);
    }
    body.append(stats, make('p', '', `${profile.memories.length} / ${C.MEMORIES.length} memories · ${profile.relics.length} / ${C.RELICS.length} relics · ${C.medals(profile)} / ${C.BIOMES.length * 3} survey medals. New visits favour discoveries you have not found yet.`));
    save(true);
    button('Back to the keeper’s camp →', () => { game = null; closeDialog(); camp(); save(true); });
  }

  function puzzle() {
    const shrine = game.nearby();
    if (!shrine || shrine.type !== 'shrine') return;
    const body = openDialog('puzzle', 'THE THREE-NOTE SHRINE', 'A song in two worlds.');
    const symbols = ['☼', '☾', '✧'], names = ['Sun', 'Moon', 'Star'];
    body.append(make('p', '', 'Bloom remembers the first two notes. Echo remembers the last. Read both sides of the garden, then play all three notes in order. A wrong note resets the song, without taking a heart.'));
    const clue = make('div', 'rune-clue');
    shrine.sequence.forEach((symbol, i) => {
      const known = game.phase === 0 ? i < 2 : i === 2;
      const tile = make('span', '', known ? symbols[symbol] : '·');
      tile.setAttribute('aria-label', known ? names[symbol] : 'Hidden in the other world'); clue.append(tile);
    });
    body.append(clue);
    const choices = make('div', 'rune-buttons');
    const status = make('p', 'rune-progress', `${shrine.progress} / 3 notes awakened`); status.setAttribute('role', 'status');
    symbols.forEach((symbol, i) => {
      const choice = make('button', '', symbol); choice.type = 'button'; choice.setAttribute('aria-label', `Play ${names[i]} note`);
      choice.addEventListener('click', () => {
        game.solveRune(i); renderer.effects(game.events, game);
        game.events.forEach(e => sound.play(e.type));
        status.textContent = game.events.at(-1)?.text || '';
        game.events = [];
        updateHud(); save();
        if (shrine.done) {
          choices.querySelectorAll('button').forEach(b => { b.disabled = true; });
          $('dialogActions').replaceChildren();
          button('Carry the song with you →', closeDialog);
        }
      }); choices.append(choice);
    });
    body.append(choices, status);
    button('Read the other world', () => {
      if (game.shiftCooldown) {
        status.textContent = `The fold needs ${game.shiftCooldown.toFixed(1)} seconds. Leave the shrine briefly to let it recover; time is paused while you read.`;
        return;
      }
      closeDialog(); lastAction = 0; act('shift');
      if (game.status === 'playing' && !dialog.open) puzzle();
    });
    button('Leave the shrine', closeDialog, false);
  }

  function pause() {
    if (!playing || !game || dialog.open) return;
    const body = openDialog('pause', 'REST YOUR PAWS', 'The garden can wait.');
    body.append(make('p', '', 'Your expedition is saved in this browser. You can return to camp and continue this exact journey later.'));
    button('Keep wandering →', closeDialog);
    if (game.boss?.state === 'active') button('Leave the arena and prepare again', () => { game.retreatBoss(); closeDialog(); events(); }, false);
    button('Save and return to camp', () => { save(true); closeDialog(); camp(); }, false);
    button('Finish early and bank discoveries', () => { game.status = 'returned'; closeDialog(); finish(); }, false);
  }

  function trader() {
    const body = openDialog('trader', 'THE WANDERING WAYFARER', 'A little help along the path.');
    body.append(art(72, 'result-art'), make('p', '', `You have ${game.light} starlight in this expedition. The wayfarer can share one bundle before moving on. Camp savings stay at camp.`));
    for (const [id, label, price, text] of [['tonic', 'Moonberry bundle', 6, 'Two tonics and three hearts of healing.'], ['supplies', 'Trail supplies', 8, 'Two seedbombs and a guiding thread.'], ['chart', 'A map of small wonders', 10, 'Mark heartseeds, relics, landmarks, the firefly, and the guardian. Refill focus and gain a long guiding thread.']]) {
      const card = make('div', 'trade-offer'); card.append(make('h3', '', label), make('p', '', text)); body.append(card);
      const buy = button(`${label} · ${price} starlight`, () => {
        if (game.trade(id)) { closeDialog(); events(); }
        else toast('Your satchel is full, or you need more expedition starlight.');
      });
      buy.disabled = game.light < price || id === 'tonic' && game.inventory.medicine === 9 && game.player.hp === game.stats().maxHp || id === 'supplies' && game.inventory.bomb === 9 && game.inventory.thread === 9;
    }
    button('Keep exploring', closeDialog, false);
  }

  function guardianEncounter(retry = false) {
    const boss = game.boss, spec = C.GUARDIANS.find(b => b.id === boss?.id);
    if (!spec || boss.state !== 'sleeping') return;
    const body = openDialog('guardian', retry ? 'YOUR LANTERN CATCHES YOU' : spec.epithet.toUpperCase(), spec.name);
    body.append(guardianArt(spec.id), make('p', '', retry ? 'That was a chance to learn. Your hearts and the supplies you entered with have been restored. Try again, or return to the maze whenever you like.' : spec.intro), make('p', 'region-mechanic', spec.hint));
    body.append(make('p', '', 'Every attack leaves an open heart: your strikes deal double damage during this recovery. Guardian attacks keep their pattern when you fold or cast an art. G still reflects a hit.'));
    body.append(make('p', '', `${game.records[game.region].landmark ? 'All landmarks restored: attack warnings last longer. ' : game.trail !== 'trial' ? 'Restoring all three regional landmarks gives longer attack warnings. ' : ''}Hearts and focus refill when the encounter begins. You can save mid-fight, or leave through the pause menu.`));
    button(retry ? 'Try the encounter again →' : 'Raise your lantern →', () => { if (game.startBoss()) { closeDialog(); events(); } });
    button('A little more time to prepare', closeDialog, false);
  }

  function guardianVictory() {
    const spec = C.GUARDIANS.find(b => b.id === game.boss.id), skill = C.ARTS.find(a => a.id === spec.art);
    const body = openDialog('guardianVictory', 'AN OLD FRIEND, REMEMBERED', `${spec.name} awakens.`);
    body.append(guardianArt(spec.id, 3), make('p', '', 'The old promise is kept. The guardian lowers its head, and the garden begins to breathe again.'), make('p', 'region-mechanic', `${skill.name} and a guardian charm are now available in the workshop. Guardian trials let you return straight to the encounter, with three mastery tiers.`), make('p', '', 'Your hearts and focus are restored. Bring the heartseeds to the waygate to finish this region, or stay a little longer to explore.'));
    button('Carry the morning with you →', closeDialog);
  }

  function atlas() {
    if (!playing || !game || dialog.open) return;
    const body = openDialog('map', `THE ATLAS · ${game.phase ? 'ECHO' : 'BLOOM'}`, game.biome.name);
    const canvas = make('canvas', 'atlas'); canvas.width = 820; canvas.height = Math.round(820 * game.map.h / game.map.w);
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Discovered paths, items, the waygate, and your current location. Unexplored paths are hidden.');
    body.append(canvas); renderer.drawMap(game, canvas, true);
    const legend = make('div', 'map-legend');
    for (const [symbol, label] of [['●', 'You'], ['✦', 'Heartseed'], ['◉', 'Waygate'], ['☼ / ☾', 'Folded paths'], ['♜', 'Guardian arena']]) {
      const item = make('span'); item.append(make('b', '', symbol), document.createTextNode(label)); legend.append(item);
    }
    game.recordSurvey();
    body.append(make('p', 'region-mechanic', `${game.biome.clue} · ${game.map.entities.filter(e => e.type === 'landmark' && e.done).length}/3 landmarks · ${game.records[game.region].explored}% explored`));
    body.append(legend, make('p', '', 'Threads guide a carried firefly home first, then lead to a heartseed, the guardian, or the waygate. Blue rings on the trail mean shift worlds there. Fold looms swap nearby shortcuts; their affected paths are revealed on this atlas.'));
    button('Back to the garden →', closeDialog);
    const thread = button(`Use a guiding thread (${game.inventory.thread})`, () => {
      closeDialog(); lastAction = 0; act('thread'); if (!dialog.open) atlas();
    }, false);
    thread.disabled = game.inventory.thread === 0;
  }

  function journal() {
    const body = openDialog('journal', 'THE KEEPER’S JOURNAL', 'Small things, remembered.');
    const known = new Set([...profile.memories, ...(game?.memories || [])]);
    const relics = new Set([...profile.relics, ...(game?.relics || [])]);
    body.append(make('p', '', `${known.size} / ${C.MEMORIES.length} memories · ${relics.size} / ${C.RELICS.length} relics. Each new visit favours pages and relics you have yet to discover. Every find stays with you.`));
    C.BIOMES.forEach((region, i) => {
      const section = make('details', 'journal-region-section');
      const summary = make('summary');
      summary.append(art(region.landmarkIcon), make('strong', '', region.name), make('small', '', `${region.memories.filter(id => known.has(id)).length}/6 pages · ${C.RELICS.filter(r => r.region === i && relics.has(r.id)).length}/3 relics`));
      section.append(summary);
      const shelf = make('div', 'relic-shelf');
      for (const relic of C.RELICS.filter(r => r.region === i)) {
        const found = relics.has(relic.id), card = make('div', `relic-card${found ? '' : ' undiscovered'}`);
        card.append(art(relic.icon), make('span', '', found ? relic.name : 'An undiscovered relic')); shelf.append(card);
      }
      section.append(shelf);
      for (const id of region.memories) {
        const [title, text] = C.MEMORIES[id], entry = make('article', `journal-entry${known.has(id) ? '' : ' locked'}`);
        entry.append(make('h3', '', known.has(id) ? title : 'An unwritten page'), make('p', '', known.has(id) ? text : 'A memory is waiting somewhere in this region.')); section.append(entry);
      }
      body.append(section);
    });
    button(playing ? 'Back to the garden →' : 'Back to camp →', closeDialog);
  }

  function journeys() {
    const body = openDialog('journeys', 'THE WORLD BEYOND THE FOLD', 'There is always another path.');
    const illustration = make('img', 'journey-illustration'); illustration.src = 'assets/guardians-atlas.webp';
    illustration.alt = 'New paths through flooded bell towers, glowing mushroom warrens, storm bridges, desert ruins, silk gardens, and an aurora-lit crown.';
    body.append(illustration, make('p', '', 'Choose a chapter, or revisit an unlocked region for its missing discoveries. Every journey can be saved and continued later.'));
    const trails = make('div', 'trail-grid');
    C.TRAILS.forEach(trail => {
      const unlocked = C.trailUnlocked(profile, trail.id), card = make('button', `trail-card${profile.selectedTrail === trail.id ? ' selected' : ''}`);
      card.type = 'button'; card.disabled = !unlocked; card.dataset.trail = trail.id;
      const text = make('span'); text.append(make('strong', '', trail.name), make('small', '', trail.subtitle), make('small', 'trail-state', unlocked ? `${trail.route.length} regions · ${profile.trails[trail.id] ? 'Restored' : 'Awaiting your light'}` : `Finish ${C.TRAILS.find(t => t.id === trail.requires).name}`));
      card.append(art(trail.icon), text);
      card.addEventListener('click', () => { profile.selectedTrail = trail.id; save(true); closeDialog(); camp(); }); trails.append(card);
    });
    body.append(trails, make('h3', 'section-title', 'The waking guardians'), make('p', '', 'Meet three guardians in the new chapters. Awaken each once to unlock its art, charm, and direct arena rematches. Each new trial seal brings 40 starlight.'));
    const bosses = make('div', 'guardian-grid');
    C.GUARDIANS.forEach(spec => {
      const rank = profile.guardians[spec.id], card = make('button', 'guardian-card'); card.type = 'button'; card.dataset.guardian = spec.id;
      card.disabled = !rank;
      card.append(guardianArt(spec.id, rank ? 3 : 0), make('strong', '', spec.name), make('span', 'survey-stars', '✦'.repeat(rank) + '◇'.repeat(3 - rank)), make('small', '', rank ? 'Enter a guardian trial →' : `Waiting in ${C.BIOMES[spec.region].name}`));
      card.addEventListener('click', () => guardianTrial(spec)); bosses.append(card);
    });
    body.append(bosses, make('h3', 'section-title', 'The regional survey'), make('p', '', 'Bronze: restore a region. Silver: two visits completed, four pages, two relics, 65% explored. Gold: three visits, every page and relic, the regional secret, and 85% explored. Each medal awards 25 starlight; medals open the higher camp upgrades.'));
    const regions = make('div', 'region-grid');
    C.BIOMES.forEach((region, i) => {
      const unlocked = C.regionUnlocked(profile, i), rank = C.medal(profile, i), record = profile.regions[i];
      const card = make('button', 'region-card'); card.type = 'button'; card.disabled = !unlocked; card.dataset.region = i;
      const artPanel = make('span', 'region-art'); artPanel.style.backgroundImage = `url(assets/tile-${region.tile}.webp)`; artPanel.append(art(region.landmarkIcon));
      card.append(artPanel, make('strong', '', region.name), make('span', 'survey-stars', '✦'.repeat(rank) + '◇'.repeat(3 - rank)), make('small', '', unlocked ? `${record.clears} restored · ${record.explored}% explored` : 'A later chapter'), make('small', '', `${region.memories.filter(id => profile.memories.includes(id)).length}/6 pages · ${profile.relics.filter(id => C.RELICS[id].region === i).length}/3 relics`));
      card.addEventListener('click', () => regionVisit(i)); regions.append(card);
    });
    body.append(regions); button('Back to camp →', closeDialog);
  }

  function guardianTrial(spec) {
    const body = openDialog('trials', 'GUARDIAN TRIALS', spec.name);
    body.append(guardianArt(spec.id, 3), make('p', '', spec.hint), make('p', '', 'Go straight to the arena with your camp equipment. Trials have no heartseed hunt and do not advance regional surveys. Win a tier to open the next; each guardian has three trial seals. Failed attempts restore your starting supplies.'));
    for (let tier = 1; tier <= 3; tier += 1) {
      const enter = button(`${['Remembered', 'Resonant', 'Radiant'][tier - 1]} · tier ${['I', 'II', 'III'][tier - 1]}${profile.guardians[spec.id] >= tier ? ' · sealed' : ''}`, () => start(false, { trail: 'trial', region: spec.region, tier }), tier === Math.min(3, profile.guardians[spec.id] + 1));
      enter.disabled = tier > profile.guardians[spec.id] + 1;
      enter.dataset.trialTier = tier;
    }
    button('Back to the world atlas', journeys, false);
  }

  function regionVisit(index) {
    const region = C.BIOMES[index], body = openDialog('region', 'A REGIONAL EXPEDITION', region.name);
    body.append(art(region.landmarkIcon, 'result-art'), make('p', '', region.clue), make('p', '', 'A fresh maze in one region. Bring three heartseeds to the waygate to complete the visit. Explore for the three landmarks, three journal pages, and a regional relic before returning.'));
    if (region.guardian) body.append(make('p', 'region-mechanic', 'This region has a guardian. Gather the heartseeds, then visit its arena. Restoring all landmarks gives longer warnings during the encounter.'));
    button('Wander this region →', () => start(false, { trail: 'survey', region: index }));
    if (profile.regions[index].clears > 0) {
      body.append(make('p', '', 'Optional deeper surveys strengthen creatures and slightly shorten their warnings. They award more starlight and score. The number of enemies stays the same.'));
      button('Deep survey · tier II', () => start(false, { trail: 'survey', region: index, tier: 2 }), false);
      button('Wild survey · tier III', () => start(false, { trail: 'survey', region: index, tier: 3 }), false);
    }
    button('Back to the world atlas', journeys, false);
  }

  function workshop() {
    const body = openDialog('workshop', 'THE KEEPER’S WORKSHOP', 'A camp that grows with you.');
    body.append(make('p', '', `${profile.light} starlight · ${C.medals(profile)} / ${C.BIOMES.length * 3} survey medals. Upgrades and equipped arts apply to your next expedition. Existing journeys keep their starting kit.`));
    const upgrades = make('div', 'upgrade-list');
    for (const upgrade of C.UPGRADES) {
      const level = profile.upgrades[upgrade.id], cost = upgrade.costs[level], requirement = C.upgradeRequirement(profile, upgrade.id);
      const card = make('button', 'upgrade'); card.type = 'button'; card.dataset.upgrade = upgrade.id;
      card.disabled = cost === undefined || profile.light < cost || C.medals(profile) < requirement;
      const copy = make('span', 'upgrade-copy');
      copy.append(make('strong', '', upgrade.name), make('small', '', upgrade.text), make('small', '', requirement > C.medals(profile) ? `Requires ${requirement} survey medals` : `Level ${level} of ${upgrade.costs.length}`));
      const price = make('span', 'upgrade-price', cost === undefined ? 'Complete' : `${cost} ✦`);
      price.append(make('small', 'upgrade-level', '●'.repeat(level) + '○'.repeat(upgrade.costs.length - level)));
      card.append(art(upgrade.icon), copy, price);
      card.addEventListener('click', () => { if (C.buyUpgrade(profile, upgrade.id)) { sound.play('seed'); save(true); camp(); workshop(); } }); upgrades.append(card);
    }
    body.append(upgrades, make('h3', 'section-title', 'Choose a lantern art'), make('p', '', 'Press R to cast your equipped art. Focus recharges during exploration; freeing creatures and reflecting attacks restore it faster. Springs and solved shrines refill it.'));
    const arts = make('div', 'art-grid');
    C.ARTS.forEach(skill => {
      const unlocked = C.artUnlocked(profile, skill.id), selected = profile.selectedArt === skill.id, capacity = 3 + profile.upgrades.focus + (profile.selectedCharm === 'firefly' && C.charmUnlocked(profile, 'firefly') ? 1 : 0);
      const card = make('button', `art-card${selected ? ' selected' : ''}`); card.type = 'button'; card.disabled = !unlocked || capacity < skill.cost; card.dataset.art = skill.id;
      const copy = make('span'); copy.append(make('strong', '', skill.name), make('small', '', skill.text), make('small', 'trail-state', !unlocked ? skill.requirement : capacity < skill.cost ? `Needs ${skill.cost} focus capacity · upgrade The deep well` : `${selected ? 'Equipped · ' : ''}${skill.cost} focus`));
      card.append(art(skill.icon), copy); card.addEventListener('click', () => { profile.selectedArt = skill.id; save(true); workshop(); }); arts.append(card);
    });
    body.append(arts, make('h3', 'section-title', 'A keepsake for the road'), make('p', '', `${profile.rescues} fireflies brought home. Equip one charm for your next expedition; guardian charms are gifts from awakened guardians.`));
    const charms = make('div', 'art-grid');
    C.CHARMS.forEach(charm => {
      const unlocked = C.charmUnlocked(profile, charm.id), selected = profile.selectedCharm === charm.id;
      const card = make('button', `art-card${selected ? ' selected' : ''}`); card.type = 'button'; card.dataset.charm = charm.id; card.disabled = !unlocked;
      const copy = make('span'); copy.append(make('strong', '', charm.name), make('small', '', charm.text), make('small', 'trail-state', unlocked ? selected ? 'Equipped' : 'Ready for your lantern' : charm.requirement));
      card.append(art(charm.icon), copy); card.addEventListener('click', () => {
        profile.selectedCharm = charm.id;
        const capacity = 3 + profile.upgrades.focus + (charm.id === 'firefly' ? 1 : 0);
        if (C.ARTS.find(a => a.id === profile.selectedArt).cost > capacity) profile.selectedArt = 'gust';
        save(true); workshop();
      }); charms.append(card);
    });
    body.append(charms); button('Back to camp →', () => { closeDialog(); camp(); });
  }

  function help() {
    const body = openDialog('help', 'THE FIELD GUIDE', 'A few things before you wander.');
    body.append(make('p', '', 'Find three heartseeds in each region, then return to the starting waygate and interact. Chapters open new parts of the world atlas. Regional surveys, relics, landmarks, and journal pages reward a longer detour.'));
    const grid = make('div', 'guide-grid');
    for (const [icon, title, text] of [[8, 'A world that folds', 'Bloom opens golden paths; Echo opens blue paths. Q folds the world on ordinary ground and briefly dazes nearby creatures. Landmarks can open permanent shortcuts.'], [23, 'Read the warning', 'Enemy warning rings count down even if you stand still. Space deals damage but does not cancel an attack. G reflects a strike; R, bombs, and folding can interrupt. Dodge out of marked tiles.'], [3, 'A full little satchel', 'Tonics heal five hearts. Seedbombs damage and daze creatures within four tiles, stopping at walls. Threads guide you for forty actions, including realm changes.'], [9, 'Listen to the ruins', 'Shrines hide a three-note song across both worlds. Three regional landmarks restore a secret. Ferry bells carry you across the marsh; star anchors wake in numbered order.']]) {
      const card = make('div', 'guide-card'); card.append(art(icon), make('h3', '', title), make('p', '', text)); grid.append(card);
    }
    body.append(grid, make('h3', 'section-title', 'Small detours, large discoveries'), make('p', '', 'The wayfarer trades expedition starlight for tonics, supplies, or a map. Carry a lost firefly to the waygate for a reward; three rescues unlock a charm. Fold looms swap the nearby Bloom and Echo shortcuts without closing the ordinary paths.'));
    body.append(make('h3', 'section-title', 'Meet the guardians'), make('p', '', 'Complete The Amber Frontier to open The Rainbound Wilds. The Bellkeeper and Tempest Roc await there; Where Dawn Begins leads to the Dawn Hart. Collect three heartseeds, approach the arena, and press E. Guardians have three phases, visible warning shapes, and double-damage recovery windows. Arts cannot cancel their attacks. Failed attempts restore your starting arena supplies, and the pause menu lets you leave. Win once to unlock a new art, charm, and direct trials on the world atlas.'));
    const table = make('table', 'control-table');
    for (const [keys, description] of [['WASD / arrows', 'Move · hold a direction to keep walking'], ['Space', 'Lantern sweep · a short recovery between strikes'], ['G / R', 'Timed mirror guard / equipped lantern art'], ['Q / Shift', 'Fold between worlds / dash in your facing direction'], ['E', 'Use caches, springs, shrines, landmarks, and waygates'], ['1 / 2 / 3', 'Tonic / seedbomb / guiding thread'], ['M / J / Escape', 'Atlas / journal / pause'], ['Touch', 'Direction pad, swipe the garden, or tap an ability']]) {
      const row = make('tr'); row.append(make('td', '', keys), make('td', '', description)); table.append(row);
    }
    body.append(table, make('p', '', 'Every menu and reading dialog pauses combat. Switching tabs also pauses. Enemy damage has a brief grace period so several creatures cannot hit together. Gentle journeys give longer warnings and reduce damage.'));
    const creatures = make('div', 'guide-grid');
    C.ENEMIES.forEach((enemy, i) => {
      const card = make('div', 'guide-card'), image = make('img'); image.src = `assets/enemy-${i * 4}.webp`; image.alt = '';
      card.append(image, make('h3', '', enemy.name), make('p', '', enemy.hint)); creatures.append(card);
    });
    body.append(creatures);
    body.append(make('p', '', 'Starlight is banked when an expedition ends, win or lose. Spend it on permanent camp upgrades. Daily expeditions use the same UTC date seed and standard starting equipment; camp bonuses and gentle mode do not apply. Saves stay in this browser and do not sync between devices.'));
    button('I’m ready to wander →', closeDialog);
  }

  function settings() {
    const body = openDialog('settings', 'BY THE CAMPFIRE', 'Make the journey yours.');
    body.append(make('p', '', `Best expedition: ${profile.best} points. Best daily expedition: ${profile.dailyBest} points. ${profile.runs} completed journeys.`));
    body.append(make('p', '', 'Gentle journey adds three hearts, two tonics, longer enemy warnings, and reduces incoming damage to one heart. Change it at camp before starting a new expedition. Sound is optional. Reduced motion follows your device preference.'));
    body.append(make('p', '', 'Progress is stored only in this browser. Reset removes this game’s camp upgrades, journal, records, and saved expedition.'));
    button('Back to camp', closeDialog);
    button('Reset progress…', () => {
      const warning = openDialog('reset', 'START AFRESH', 'Put the old journal away?');
      warning.append(make('p', '', 'This permanently clears your Lumenwild progress in this browser. It does not affect other games.'));
      button('Keep my progress', closeDialog);
      button('Reset Lumenwild', () => {
        clearTimeout(saveTimer); profile = C.profile(); game = null; sound.quiet();
        try { localStorage.removeItem(C.SAVE_KEY); } catch { storageNotice('The browser could not remove stored progress.'); }
        closeDialog(); camp();
      }, false);
    }, false);
  }

  $('journeysButton').addEventListener('click', journeys);
  $('workshopButton').addEventListener('click', workshop);
  $('mainAction').addEventListener('click', () => start());
  $('dailyButton').addEventListener('click', () => start(true));
  $('continueButton').addEventListener('click', play);
  $('gentleMode').addEventListener('change', event => { profile.gentle = event.target.checked; save(true); });
  $('soundButton').addEventListener('click', () => {
    profile.sound = !profile.sound;
    if (profile.sound) { sound.enable(); sound.note(660, .35); } else sound.quiet();
    setSound(); save();
  });
  $('helpButton').addEventListener('click', help);
  $('pauseButton').addEventListener('click', pause);
  $('mapButton').addEventListener('click', atlas);
  $('phaseButton').addEventListener('click', () => act('shift'));
  $('interactPrompt').addEventListener('click', () => act('interact'));
  $('journalButton').addEventListener('click', journal);
  $('playJournal').addEventListener('click', journal);
  $('settingsButton').addEventListener('click', settings);
  $('closeDialog').addEventListener('click', () => { if (!dialogLocked) closeDialog(); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!dialogLocked) closeDialog(); });
  dialog.addEventListener('close', () => {
    // Native close events are queued. A different dialog may already have
    // opened (for example, the other half of a rune clue).
    if (dialog.open) return;
    held = null; dialogKind = ''; dialogLocked = false;
    if (playing) $('world').focus(); else if (previousFocus?.isConnected && !previousFocus.hidden) previousFocus.focus();
  });
  document.querySelectorAll('[data-action]').forEach(element => element.addEventListener('click', () => act(element.dataset.action)));

  const directions = { ArrowUp: 0, KeyW: 0, ArrowRight: 1, KeyD: 1, ArrowDown: 2, KeyS: 2, ArrowLeft: 3, KeyA: 3 };
  const actions = { Space: 'attack', KeyG: 'guard', KeyR: 'art', KeyQ: 'shift', ShiftLeft: 'dash', ShiftRight: 'dash', KeyE: 'interact', Digit1: 'medicine', Digit2: 'bomb', Digit3: 'thread', Period: 'wait' };
  window.addEventListener('keydown', event => {
    if (!playing || event.ctrlKey || event.metaKey || event.altKey || event.target instanceof HTMLInputElement) return;
    if (dialog.open) {
      if (!event.repeat && ((event.code === 'KeyM' && dialogKind === 'map') || (event.code === 'KeyJ' && dialogKind === 'journal'))) { event.preventDefault(); closeDialog(); }
      return;
    }
    if (event.code in directions || event.code in actions || ['Escape', 'KeyM', 'KeyJ'].includes(event.code)) event.preventDefault();
    if (event.repeat) return;
    if (event.code in directions) { held = { dir: directions[event.code], key: event.code, next: performance.now() + 230 }; act('move', held.dir); }
    else if (event.code in actions) act(actions[event.code]);
    else if (event.code === 'Escape') pause();
    else if (event.code === 'KeyM') atlas();
    else if (event.code === 'KeyJ') journal();
  });
  window.addEventListener('keyup', event => { if (held?.key === event.code) held = null; });
  document.querySelectorAll('[data-dir]').forEach(element => {
    element.addEventListener('pointerdown', event => {
      if (!playing || dialog.open) return;
      event.preventDefault(); element.setPointerCapture(event.pointerId);
      held = { dir: Number(element.dataset.dir), pointer: event.pointerId, next: performance.now() + 230 };
      act('move', held.dir);
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(name, event => { if (held?.pointer === event.pointerId) held = null; });
  });
  let swipe = null;
  $('world').addEventListener('pointerdown', event => { swipe = { x: event.clientX, y: event.clientY, id: event.pointerId }; $('world').setPointerCapture(event.pointerId); });
  $('world').addEventListener('pointerup', event => {
    if (!swipe || event.pointerId !== swipe.id) return;
    const dx = event.clientX - swipe.x, dy = event.clientY - swipe.y; swipe = null;
    if (Math.hypot(dx, dy) > 18) act('move', Math.abs(dx) > Math.abs(dy) ? dx > 0 ? 1 : 3 : dy > 0 ? 2 : 0);
  });
  $('world').addEventListener('pointercancel', () => { swipe = null; });
  window.addEventListener('blur', () => { held = null; swipe = null; if (playing && !dialog.open) pause(); sound.quiet(); save(true); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { held = null; if (playing && !dialog.open) pause(); sound.quiet(); save(true); }
  });
  window.addEventListener('pagehide', () => { held = null; save(true); });

  function frame(now) {
    const dt = Math.min(.05, (now - lastFrame) / 1000 || .016); lastFrame = now;
    if (playing && game && !document.hidden) {
      if (!dialog.open && game.status === 'playing') {
        game.update(dt);
        if (game.events.length) events();
        if (now - lastHud > 100) { updateHud(); lastHud = now; }
        if (now - lastCheckpoint > 2000) { save(true); lastCheckpoint = now; }
      }
      if (!dialog.open && held && now >= held.next) { held.next = now + 165; act('move', held.dir); }
      if (!dialog.open) renderer.draw(game, now / 1000, dt);
      if (now > toastUntil) $('toast').hidden = true;
      if (profile.sound && !dialog.open && now - lastAmbient > 8000) {
        lastAmbient = now; [196, 294, 440].forEach((frequency, i) => sound.note(frequency, 4, i * .6, 'sine', .07));
      }
    }
    requestAnimationFrame(frame);
  }

  load(); camp();
  $('dailyDate').textContent = `${new Date().toISOString().slice(0, 10)} UTC · same seed, standard kit`;
  renderer.load((done, total) => { $('loadStatus').textContent = `Preparing the garden · ${done} / ${total}`; }).then(missing => {
    ready = true; assetsFailed = missing.length > 0;
    $('mainAction').disabled = false; $('dailyButton').disabled = false;
    $('loadStatus').textContent = assetsFailed ? 'Some artwork could not load. Reload for the complete garden.' : 'Ready when you are. Your journey saves automatically.';
  });
  requestAnimationFrame(frame);
}());
