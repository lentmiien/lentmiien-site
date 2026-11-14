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
  const renderer = new window.LumenwildRenderer($('world'), $('minimap'));
  const dialog = $('dialog');
  let profile = C.profile(), game = null, playing = false, ready = false;
  let dialogKind = '', dialogLocked = false, previousFocus = null;
  let held = null, lastAction = 0, lastFrame = 0, toastUntil = 0, lastAmbient = 0;
  let saveTimer = null, storageFailed = false, assetsFailed = false;

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
      if (['pickup', 'chest', 'memory'].includes(type)) { this.note(659, .18); this.note(988, .27, .07); }
      if (['seed', 'puzzleSolved', 'restored'].includes(type)) [392, 494, 587, 784].forEach((n, i) => this.note(n, .6, i * .12, 'sine', .7));
      if (type === 'sweep') { this.note(260, .12, 0, 'triangle', .4); this.note(520, .12, .04, 'sine', .3); }
      if (type === 'shift') [220, 330, 440].forEach((n, i) => this.note(n, .5, i * .06, 'sine', .5));
      if (type === 'hurt') this.note(92, .18, 0, 'triangle', .9);
      if (type === 'defeat') { this.note(440, .23); this.note(660, .3, .06); }
      if (type === 'heal') { this.note(523, .35); this.note(784, .45, .1); }
      if (type === 'bomb') { this.note(70, .35, 0, 'triangle', 1); this.note(880, .5, .05, 'sine', .5); }
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
      if (saved.invalid) storageNotice('An unreadable expedition was left behind. Valid camp progress has been kept where possible.');
    } catch {
      storageFailed = true;
      storageNotice('Browser storage is unavailable. You can play, but this session’s progress cannot be saved.');
    }
  }

  function save(immediate = false) {
    if (game) profile.memories = [...new Set([...profile.memories, ...game.memories])];
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
    $('campWins').textContent = profile.wins;
    $('campMemories').textContent = `${profile.memories.length} / 9`;
    $('gentleMode').checked = profile.gentle;
    $('continueButton').hidden = !game || !['playing', 'blessing'].includes(game.status);
    $('mainAction').classList.toggle('secondary', !$('continueButton').hidden);
    if (!$('continueButton').hidden) $('continueDetail').textContent = `${C.BIOMES[game.depth].name} · ${game.seeds}/3 heartseeds${game.daily ? ' · daily' : ''}`;
    const upgrades = $('upgrades'); upgrades.replaceChildren();
    for (const upgrade of C.UPGRADES) {
      const level = profile.upgrades[upgrade.id], cost = upgrade.costs[level];
      const button = make('button', 'upgrade'); button.type = 'button';
      button.dataset.upgrade = upgrade.id;
      button.disabled = cost === undefined || profile.light < cost;
      const copy = make('span', 'upgrade-copy');
      copy.append(make('strong', '', upgrade.name), make('small', '', upgrade.text));
      const price = make('span', 'upgrade-price', cost === undefined ? 'Complete' : `${cost} ✦`);
      price.append(make('small', 'upgrade-level', '●'.repeat(level) + '○'.repeat(3 - level)));
      button.append(art(upgrade.icon), copy, price);
      button.setAttribute('aria-label', `${upgrade.name}. ${upgrade.text}. Level ${level} of 3. ${cost === undefined ? 'Fully upgraded.' : `Costs ${cost} starlight. You have ${profile.light}.`}`);
      button.addEventListener('click', () => {
        if (C.buyUpgrade(profile, upgrade.id)) { sound.play('seed'); save(true); camp(); }
      });
      upgrades.append(button);
    }
    setSound();
  }

  function toast(text, duration = 3300) {
    if (!text) return;
    $('toast').textContent = text; $('toast').hidden = false; toastUntil = performance.now() + duration;
  }

  function updateHud() {
    if (!game) return;
    const stats = game.stats(), region = C.BIOMES[game.depth];
    $('healthText').textContent = `${game.player.hp} / ${stats.maxHp}`;
    $('hearts').setAttribute('aria-label', `${game.player.hp} of ${stats.maxHp} hearts`);
    $('hearts').replaceChildren(...Array.from({ length: stats.maxHp }, (_, i) => make('span', `heart${i < game.player.hp ? '' : ' empty'}`)));
    $('seedCount').replaceChildren(document.createTextNode(`${game.seeds} `), make('span', '', '/ 3'));
    $('lightCount').textContent = game.light;
    $('phaseName').textContent = game.phase ? 'Echo' : 'Bloom';
    $('phaseIcon').textContent = game.phase ? '☾' : '☼';
    $('phaseButton').classList.toggle('echo', !!game.phase);
    $('phaseButton').setAttribute('aria-label', `In ${game.phase ? 'Echo' : 'Bloom'}. Shift to ${game.phase ? 'Bloom' : 'Echo'}.`);
    $('chapterLabel').textContent = `${game.daily ? 'DAILY · ' : game.gentle ? 'GENTLE · ' : ''}GARDEN 0${game.depth + 1} / 03`;
    $('regionName').textContent = region.name; $('regionSubtitle').textContent = region.subtitle;
    $('objectiveText').textContent = game.seeds === 3 ? 'All heartseeds found. Return to the waygate and press E.' : `Find ${3 - game.seeds} heartseed${game.seeds === 2 ? '' : 's'}. Explore Bloom and Echo.`;
    if (game.guideTurns) $('objectiveText').textContent += ` Thread: ${game.guideTurns} turns.`;
    $('shiftCooldown').textContent = game.shiftCooldown ? `${game.shiftCooldown} turns` : 'Shift world';
    $('dashCooldown').textContent = game.dashCooldown ? `${game.dashCooldown} turns` : 'Dash ahead';
    for (const [key, label] of [['medicine', 'heal 5'], ['bomb', 'burst'], ['thread', 'find a path']]) {
      $(`${key}Count`).textContent = `× ${game.inventory[key]} · ${label}`;
      document.querySelector(`[data-action="${key}"]`).setAttribute('aria-label', `${key}: ${game.inventory[key]} remaining. ${label}.`);
    }
    const nearby = game.nearby();
    $('interactPrompt').hidden = !nearby;
    if (nearby) $('interactPrompt').querySelector('span').textContent = { portal: game.seeds === 3 ? 'Restore the garden' : 'The waygate', chest: 'Open treasure cache', well: 'Drink from the spring', shrine: 'Read the runes' }[nearby.type];
    $('blessingSummary').textContent = game.blessings.length ? game.blessings.map(id => C.BLESSINGS.find(b => b.id === id).name).join(' · ') : 'A small lantern can change everything.';
    renderer.drawMap(game);
  }

  function openDialog(kind, eyebrow, title, locked = false) {
    held = null;
    if (!dialog.open) previousFocus = document.activeElement;
    dialogKind = kind; dialogLocked = locked;
    dialog.classList.toggle('map-dialog', kind === 'map');
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
    else if (game.turn === 0) {
      const body = openDialog('welcome', 'YOUR FIRST STEPS', 'Keep a little light with you.');
      body.append(make('p', '', 'You are Pip, the last lantern keeper. Three heartseeds are scattered through each garden. Bring them back to the waygate where you arrived.'));
      const grid = make('div', 'guide-grid');
      for (const [icon, title, text] of [[1, 'Wander and discover', 'Move with WASD, arrows, a swipe, or the direction pad. Walk over glowing finds to collect them.'], [8, 'Unfold the world', 'Q switches Bloom and Echo, opening different paths. Some heartseeds only exist in one world.'], [6, 'You can fight back', 'Space sweeps your lantern around you. Enemies only act when you do. Red marked tiles warn of their next strike.'], [4, 'Never truly lost', 'M opens your atlas. A guiding thread (3) traces a route to the next heartseed, then home.']]) {
        const card = make('div', 'guide-card'); card.append(art(icon), make('h3', '', title), make('p', '', text)); grid.append(card);
      }
      body.append(grid, make('p', '', 'There is no timer. Stop whenever you like; the garden will wait.'));
      button('Light the lantern →', () => { closeDialog(); toast('Your first starlight is just to the right. Follow your curiosity.', 5500); });
    }
  }

  function start(daily = false) {
    if (!ready) return;
    const begin = () => {
      if (dialog.open) closeDialog();
      const date = new Date().toISOString().slice(0, 10);
      const seed = daily ? C.hash(`lumenwild:${date}`) : crypto.getRandomValues(new Uint32Array(1))[0];
      game = new C.Game({ seed, daily, gentle: profile.gentle, upgrades: profile.upgrades });
      save(true); play();
    };
    if (game && ['playing', 'blessing'].includes(game.status)) {
      const body = openDialog('replace', 'A NEW PATH', 'Leave this expedition behind?');
      body.append(make('p', '', 'Starting a new journey replaces your suspended expedition and its unbanked starlight. Your camp upgrades and discovered memories stay with you.'));
      button('Begin a new journey', begin);
      button('Keep my expedition', closeDialog, false);
    } else begin();
  }

  function events() {
    renderer.effects(game.events, game);
    for (const event of game.events) sound.play(event.type);
    const meaningful = game.events.filter(e => e.text && !['pickup', 'warning'].includes(e.type));
    const message = meaningful.at(-1) || game.events.find(e => e.text);
    if (message && message.type !== 'memory') toast(message.text, message.type === 'hurt' ? 4500 : 3300);
    const memory = game.events.find(e => e.type === 'memory');
    if (memory) {
      const body = openDialog('memory', 'A MEMORY FOUND', C.MEMORIES[memory.memory][0]);
      body.append(art(11, 'result-art'), make('p', '', C.MEMORIES[memory.memory][1]), make('p', '', 'This page is now in your journal, even if the expedition ends.'));
      button('Carry it with you →', closeDialog);
    }
    if (game.events.some(e => e.type === 'puzzle')) puzzle();
    updateHud(); save();
    if (game.status === 'blessing') blessings();
    if (game.status === 'won' || game.status === 'lost') finish();
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
    body.append(art(14, 'result-art'), make('p', '', `${C.BIOMES[game.depth].name} is alive again. Choose a blessing to carry into ${C.BIOMES[game.depth + 1].name}. Your hearts refill, and you receive a tonic and a guiding thread.`));
    const grid = make('div', 'blessing-grid');
    for (const blessing of game.choices()) {
      const card = make('button', 'blessing-card'); card.type = 'button'; card.dataset.blessing = blessing.id;
      const copy = make('span'); copy.append(make('strong', '', blessing.name), make('small', '', blessing.text));
      card.append(art(blessing.icon), copy);
      card.addEventListener('click', () => {
        if (!game.chooseBlessing(blessing.id)) return;
        closeDialog(); renderer.reset(game); updateHud(); save(true);
        toast(`${C.BIOMES[game.depth].name} · ${blessing.name} is yours`, 5000); sound.play('restored');
      }); grid.append(card);
    }
    body.append(grid);
    button('Save and return to camp', () => { save(true); closeDialog(); camp(); }, false);
  }

  function finish() {
    held = null;
    const won = game.status === 'won';
    profile.light = Math.min(999999, profile.light + game.light);
    profile.memories = [...new Set([...profile.memories, ...game.memories])];
    profile.runs += 1;
    if (won) profile.wins += 1;
    profile.best = Math.max(profile.best, game.score);
    if (game.daily) profile.dailyBest = Math.max(profile.dailyBest, game.score);
    const body = openDialog('result', won ? 'THE WORLD-TREE AWAKENS' : 'EVERY JOURNEY LEAVES A LITTLE LIGHT', won ? 'And the garden breathed.' : 'Home is a light left on.', true);
    body.append(art(won ? 14 : 10, 'result-art'));
    body.append(make('p', '', won ? 'Nine heartseeds. Three gardens. One small, stubborn lantern. The branches unfold into dawn, and somewhere, the first moth finds its way home.' : 'Your lantern carries you back to camp. Every piece of starlight and every memory you found comes with you. Rest, grow your camp, and try a different path.'));
    const stats = make('div', 'result-stats');
    for (const [value, title] of [[game.light, 'Starlight brought home'], [game.score, 'Expedition score'], [game.kills, 'Creatures freed']]) {
      const box = make('div'); box.append(make('strong', '', value), make('span', '', title)); stats.append(box);
    }
    body.append(stats, make('p', '', won ? 'Another expedition brings a new labyrinth and new blessings. Your camp, memories, and discoveries will be here.' : 'Tip: sweep to interrupt an attack, shift to daze nearby enemies, and use a tonic before your lantern goes out.'));
    // Clear the checkpoint before presenting the result, so reloading cannot
    // award the same expedition twice.
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
        status.textContent = `The fold needs ${game.shiftCooldown} more turn${game.shiftCooldown > 1 ? 's' : ''}. Step away and return, or wait with the period key.`;
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
    button('Save and return to camp', () => { save(true); closeDialog(); camp(); }, false);
  }

  function atlas() {
    if (!playing || !game || dialog.open) return;
    const body = openDialog('map', `THE ATLAS · ${game.phase ? 'ECHO' : 'BLOOM'}`, C.BIOMES[game.depth].name);
    const canvas = make('canvas', 'atlas'); canvas.width = 820; canvas.height = Math.round(820 * game.map.h / game.map.w);
    canvas.setAttribute('role', 'img'); canvas.setAttribute('aria-label', 'Discovered paths, items, the waygate, and your current location. Unexplored paths are hidden.');
    body.append(canvas); renderer.drawMap(game, canvas, true);
    const legend = make('div', 'map-legend');
    for (const [symbol, label] of [['●', 'You'], ['✦', 'Heartseed'], ['◉', 'Waygate'], ['☼ / ☾', 'Folded paths']]) {
      const item = make('span'); item.append(make('b', '', symbol), document.createTextNode(label)); legend.append(item);
    }
    body.append(legend, make('p', '', 'The atlas remembers where you have been. A guiding thread traces the shortest route to a heartseed, or back to the waygate. Blue rings on the trail mean shift worlds there.'));
    button('Back to the garden →', closeDialog);
    const thread = button(`Use a guiding thread (${game.inventory.thread})`, () => {
      closeDialog(); lastAction = 0; act('thread'); if (!dialog.open) atlas();
    }, false);
    thread.disabled = game.inventory.thread === 0;
  }

  function journal() {
    const body = openDialog('journal', 'THE KEEPER’S JOURNAL', 'Small things, remembered.');
    const known = new Set([...profile.memories, ...(game?.memories || [])]);
    body.append(make('p', '', `${known.size} of 9 memories found. Discover scattered journal pages in each garden. They stay with you between expeditions.`));
    C.MEMORIES.forEach(([title, text], i) => {
      if (i % 3 === 0) body.append(make('p', 'journal-region', C.BIOMES[Math.floor(i / 3)].name.toUpperCase()));
      const entry = make('article', `journal-entry${known.has(i) ? '' : ' locked'}`);
      entry.append(make('h3', '', known.has(i) ? title : 'An unwritten page'), make('p', '', known.has(i) ? text : 'A memory is waiting somewhere in this garden.'));
      body.append(entry);
    });
    button(playing ? 'Back to the garden →' : 'Back to camp →', closeDialog);
  }

  function help() {
    const body = openDialog('help', 'THE FIELD GUIDE', 'A few things before you wander.');
    body.append(make('p', '', 'Find three heartseeds in each garden, then return to your starting waygate and interact. Complete all three gardens to wake the world-tree. Treasure, memories, and rune shrines reward a little detour.'));
    const grid = make('div', 'guide-grid');
    for (const [icon, title, text] of [[8, 'A world that folds', 'Bloom (sun) opens golden paths. Echo (moon) opens blue paths. Shift on ordinary ground. Shifting also dazes nearby creatures.'], [6, 'Fight on your terms', 'The world advances only on your action. Sweep has no cooldown and hits around you. Strikes stun enemies and cancel their wind-up. Bumping a creature also attacks.'], [3, 'A full little satchel', 'Tonics heal five hearts. Seedbombs hit creatures within four tiles, stopping at walls. Threads guide you for forty turns, including realm changes.'], [9, 'Listen to the ruins', 'Optional shrines hide a three-note song across the two worlds. Read the clues in Bloom and Echo. Solve it for supplies, healing, and starlight.']]) {
      const card = make('div', 'guide-card'); card.append(art(icon), make('h3', '', title), make('p', '', text)); grid.append(card);
    }
    body.append(grid);
    const table = make('table', 'control-table');
    for (const [keys, description] of [['WASD / arrows', 'Move · hold a direction to keep walking'], ['Space', 'Lantern sweep · unlimited, interrupts attacks'], ['Q / Shift', 'Fold between worlds / dash in your facing direction'], ['E', 'Open caches, drink at springs, read runes, restore waygates'], ['1 / 2 / 3', 'Tonic / seedbomb / guiding thread'], ['M / J / Escape', 'Atlas / journal / pause'], ['Period (.)', 'Wait one turn'], ['Touch', 'Direction pad, swipe the garden, or tap an ability']]) {
      const row = make('tr'); row.append(make('td', '', keys), make('td', '', description)); table.append(row);
    }
    body.append(table, make('p', '', 'Thorn beetles warn before biting. Wisps aim at the tile where you stand: move out before their next turn. Sentinels hit harder but move slowly. Dash grants protection for that action. Only one creature can hurt you per turn, with a short grace period afterward.'));
    body.append(make('p', '', 'Starlight is banked when an expedition ends, win or lose. Spend it on permanent camp upgrades. Daily expeditions use the same UTC date seed and standard starting equipment; camp bonuses and gentle mode do not apply. Saves stay in this browser and do not sync between devices.'));
    button('I’m ready to wander →', closeDialog);
  }

  function settings() {
    const body = openDialog('settings', 'BY THE CAMPFIRE', 'Make the journey yours.');
    body.append(make('p', '', `Best expedition: ${profile.best} points. Best daily expedition: ${profile.dailyBest} points. ${profile.runs} completed journeys.`));
    body.append(make('p', '', 'Gentle journey adds three hearts and two tonics, and reduces sentinel damage. Change it at camp before starting a new expedition. Sound is optional. Reduced motion follows your device preference.'));
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
  const actions = { Space: 'attack', KeyQ: 'shift', ShiftLeft: 'dash', ShiftRight: 'dash', KeyE: 'interact', Digit1: 'medicine', Digit2: 'bomb', Digit3: 'thread', Period: 'wait' };
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
