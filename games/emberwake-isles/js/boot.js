import { Renderer } from './renderer.js';
import { Audio } from './audio.js';
const D = window.EWData,
  W = window.EWWorld,
  G = window.EWGame,
  S = window.EWSaves;
const $ = id => document.getElementById(id),
  audio = new Audio(),
  panel = $('panel'),
  content = $('panelContent');
let storage;
try {
  storage = window.localStorage;
} catch {
  storage = {
    getItem() {
      throw new Error('Browser storage is unavailable');
    },
    setItem() {
      throw new Error('Browser storage is unavailable');
    },
    removeItem() {
      throw new Error('Browser storage is unavailable');
    }
  };
}
const saves = new S.Saves(storage);
let game = new G.Game(),
  renderer,
  activeSlot = null,
  started = false,
  tab = 'Journal',
  keys = {},
  mining = false,
  last = performance.now(),
  lastSave = 0,
  lastHud = 0,
  noticeTime = 0,
  noticeSerial = -1,
  hotSignature = '',
  stormShown = false,
  category = 'All',
  query = '',
  batch = 1,
  jumpQueued = false;
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function button(text, fn, className) {
  const b = el('button', text, className);
  b.type = 'button';
  b.addEventListener('click', fn);
  return b;
}
function icon(id) {
  const img = el('img');
  img.src = `assets/icons/${id}.svg`;
  img.alt = '';
  img.className = 'icon';
  return img;
}
function paragraph(text, parent = content, className) {
  const p = el('p', text, className);
  parent.append(p);
  return p;
}
function clearInputs() {
  keys = {};
  mining = false;
  jumpQueued = false;
  game.mineProgress = 0;
}
function notice(text) {
  game.notify(text);
  $('panelFoot').textContent = text;
}
function failure(error) {
  $('loading').hidden = true;
  $('fatal').hidden = false;
  game.paused = true;
  clearInputs();
  if (document.pointerLockElement) document.exitPointerLock();
  $('fatalText').textContent = 'The game could not initialize WebGL 2 or its local assets. Your saved slots are untouched. Try an updated desktop browser with hardware acceleration, then reload.';
  console.error('Emberwake rendering initialization failed', error);
}
$('reload').onclick = () => location.reload();
function lock() {
  if (game.state.status !== 'alive' || !started) return;
  game.paused = false;
  canvasLock();
}
function canvasLock() {
  try {
    const p = $('world').requestPointerLock();
    p?.catch(() => notice('Mouse capture was declined. Click the world to try again; Esc opens your field notes.'));
  } catch {
    notice('Click the world to capture the mouse.');
  }
}
function closePanel() {
  panel.close();
  clearInputs();
  if (started && game.state.status === 'alive') lock();
}
function openPanel(name = 'Journal') {
  if (game.state.status === 'disaster') return;
  clearInputs();
  game.paused = true;
  tab = name;
  if (document.pointerLockElement) document.exitPointerLock();
  if (!panel.open) panel.showModal();
  renderPanel();
}
$('resume').onclick = closePanel;
panel.addEventListener('cancel', event => {
  event.preventDefault();
  closePanel();
});
$('menuButton').onclick = () => openPanel('Journal');
function renderPanel() {
  $('panelTitle').textContent = tab;
  const tabs = $('tabs');
  tabs.replaceChildren();
  for (const name of ['Journal', 'Pack', 'Craft', 'Chart', 'Camp', 'Saves', 'Help']) {
    const b = button(name, () => {
      tab = name;
      renderPanel();
    }, tab === name ? 'active' : '');
    b.setAttribute('aria-current', tab === name ? 'page' : 'false');
    tabs.append(b);
  }
  content.replaceChildren();
  content.className = '';
  if (tab === 'Pack') packPage();
  if (tab === 'Craft') craftPage();
  if (tab === 'Journal') journalPage();
  if (tab === 'Chart') chartPage();
  if (tab === 'Camp') campPage();
  if (tab === 'Saves') savesPage();
  if (tab === 'Help') helpPage();
  $('panelFoot').textContent = started ? 'Time rests while these pages are open. Crops grow only while you play.' : 'Choose an empty save slot to begin. Browser data can be cleared: export a backup.';
}
function objectives() {
  const s = game.state;
  return [[s.stats.mined >= 6, 'Gather driftwood on the beach', 'Hold left click on six logs. Logs also yield resin. Press E at a berry bush for food, fiber and seeds.'], [s.crafted.includes('woodPick') && s.crafted.includes('bench'), 'Make a place to work', 'Tab → Craft: turn logs into planks; craft a workbench and a driftwood pick. Assign them in Pack. Right click places the bench.'], [s.crafted.includes('stonePick'), 'Follow the cave trail', 'Chart marks every cave entrance. A driftwood pick mines stone and copper. Craft a stone pick at your bench to mine iron.'], [s.crafted.includes('kiln') && s.crafted.includes('copperPick'), 'Warm the forge', 'Gather clay on the low shores, coal and copper underground. A kiln smelts copper; make a copper pick for prism seams.'], [s.crafted.includes('raft'), 'Raise a small sail', 'Eight logs and four ropes at a bench make a raft. Wade into water, select it, then right click to launch and board.'], [s.discoveries.length >= 3, 'A wider horizon', 'Visit three islands. Discovery unlocks regional designs. Landmarks contain optional stories and pearls.'], [s.stats.harvest > 0 && s.stats.fish > 0, 'Set a generous table', 'Place a garden bed and press E with a seed in your pack. Cast a fishing rod toward low open water with E; stay still for six seconds.'], [s.crafted.includes('artisans'), 'Learn the finer crafts', 'Smelt iron at a forge; weave cloth at a loom. Build an artisan table for stonework, instruments and late luxuries.'], [game.luxury().points >= 95, 'A home worth returning to', 'Rest at a daybed to anchor your camp. Furnish within 24 blocks: light, rest, gardens, art, water, music, and thoughtful architecture. Reach 95 comfort.'], [s.secrets.length === 5 && game.luxury().points >= 135, 'Become a tidekeeper', 'Find five quiet stories and build a 135-comfort sanctuary. Then keep building: this is your archipelago.']];
}
function journalPage() {
  const split = el('div', undefined, 'split'),
    left = el('div', undefined, 'notes'),
    right = el('div', undefined, 'notes');
  split.append(left, right);
  content.append(split);
  left.append(el('h3', 'The road to a sanctuary'));
  const ol = el('ol', undefined, 'objective-list');
  for (const [done, title, description] of objectives()) {
    const li = el('li');
    li.append(el('strong', `${done ? '✓' : '○'} ${title}`, done ? 'done' : ''), el('p', description));
    ol.append(li);
  }
  left.append(ol);
  right.append(el('h3', 'Notes washed ashore'));
  paragraph(`Cave collection: ${game.state.caveFinds.length} / 5 tidekeeper caches. Explore the deepest chamber on each island; each cache rewards you once.`, right);
  paragraph('No monsters. No rush. Hunger takes over two hours to empty and never kills you. Berries regrow; tools never break. Cold calls for a cloak, tea, or a warm home.', right);
  for (const id of game.state.secrets) {
    const index = D.islands.findIndex(i => i.id === id);
    right.append(el('h3', D.islands[index].landmark));
    paragraph(D.lore[index], right);
  }
  if (!game.state.secrets.length) paragraph('Look for gold tablets near each island’s heart. The chart gives their locations; the stories are yours to find.', right);
  paragraph('The sea is finite. Amber warnings begin at radius 405; danger buoys at 450. Crossing radius 490 commits a fatal storm, even if you turn around or reload. Restore a safe checkpoint explicitly afterward.', right);
}
function packPage() {
  const s = game.state;
  paragraph(`Pack ${G.total(s.inventory)} / ${D.C.pack} · Click an item to assign it to hotbar slot ${s.selected + 1}. Select another slot with 1–8 or below.`);
  const toolbar = el('div', undefined, 'toolbar');
  for (let n = 0; n < 8; n++) toolbar.append(button(`${n + 1}: ${D.items[s.hotbar[n]].name}`, () => {
    s.selected = n;
    packPageRefresh();
  }, s.selected === n ? 'primary' : ''));
  content.append(toolbar);
  const grid = el('div', undefined, 'pack');
  for (const [id, n] of Object.entries(s.inventory).sort((a, b) => D.items[a[0]].name.localeCompare(D.items[b[0]].name))) {
    const b = button('', () => {
      s.hotbar[s.selected] = id;
      notice(`${D.items[id].name} assigned to slot ${s.selected + 1}.`);
      renderPanel();
    });
    b.append(icon(id), el('span', D.items[id].name), el('b', `× ${n}`));
    grid.append(b);
  }
  content.append(grid);
  if (!Object.keys(s.inventory).length) paragraph('An empty pack, an open shore. Gather the driftwood ahead; press E at a sunberry bush.');
  const k = game.openChest;
  if (k && s.placed[k] === D.ids.chest) {
    const p = game.state.player,
      [x, y, z] = W.decodeKey(k);
    if (Math.hypot(x - p.x, y - p.y, z - p.z) < 7) {
      content.append(el('h3', 'Cedar chest'));
      paragraph('Click to deposit or withdraw one stack. Empty the chest before mining it.');
      const split = el('div', undefined, 'split'),
        a = el('div'),
        b = el('div');
      for (const [id, n] of Object.entries(s.inventory)) a.append(button(`Store ${n} ${D.items[id].name}`, () => {
        game.transfer(k, id, n, true);
        renderPanel();
      }));
      for (const [id, n] of Object.entries(s.harvests['chest:' + k] || {})) b.append(button(`Take ${n} ${D.items[id].name}`, () => {
        game.transfer(k, id, n, false);
        renderPanel();
      }));
      split.append(a, b);
      content.append(split);
    }
  }
}
function packPageRefresh() {
  content.replaceChildren();
  packPage();
}
function craftPage() {
  const toolbar = el('div', undefined, 'toolbar'),
    search = el('input');
  search.type = 'search';
  search.placeholder = 'Find a recipe or material…';
  search.setAttribute('aria-label', 'Search recipes');
  search.value = query;
  const select = el('select');
  select.setAttribute('aria-label', 'Recipe category');
  for (const name of ['All', 'Materials', 'Equipment', 'Building', 'Camp', 'Kitchen', 'Voyaging']) {
    const option = el('option', name);
    option.value = name;
    select.append(option);
  }
  select.value = category;
  const quantity = el('select');
  quantity.setAttribute('aria-label', 'Craft batch count');
  for (const n of [1, 5, 10]) {
    const option = el('option', `${n} batch${n > 1 ? 'es' : ''}`);
    option.value = n;
    quantity.append(option);
  }
  quantity.value = batch;
  toolbar.append(search, select, quantity);
  content.append(toolbar);
  const summary = el('p', `${D.recipes.length} recipes · Stations work within 7 blocks · ${game.stations().size ? Array.from(game.stations()).map(k => D.items[k].name).join(', ') : 'No nearby stations'}`, 'caption');
  content.append(summary);
  const grid = el('div', undefined, 'grid');
  content.append(grid);
  const fill = () => {
    grid.replaceChildren();
    for (const r of D.recipes) {
      if (category !== 'All' && r.category !== category) continue;
      if (query && !`${D.items[r.out].name} ${Object.keys(r.cost).map(k => D.items[k].name).join(' ')}`.toLowerCase().includes(query.toLowerCase())) continue;
      const card = el('article', undefined, 'card'),
        title = el('h3');
      title.append(icon(r.out), el('span', D.items[r.out].name));
      card.append(title);
      paragraph(`${r.category} · makes ${r.count * batch}${r.station ? ' · ' + D.items[r.station].name : ' · hand craft'}`, card);
      const cost = el('div', undefined, 'cost');
      for (const [id, n] of Object.entries(r.cost)) {
        const have = game.state.inventory[id] || 0;
        cost.append(el('span', `${D.items[id].name} ${have}/${n * batch}`, 'chip' + (have < n * batch ? ' missing' : '')));
      }
      card.append(cost);
      if (r.discovery) paragraph(`Discover ${D.islands.find(i => i.id === r.discovery).name}`, card);
      const status = game.recipeStatus(r, batch),
        b = button(status.ok ? 'Craft' : status.reason, () => {
          if (game.craft(r.id, batch)) audio.effect('craft');
          fill();
          notice(game.message);
        });
      b.disabled = !started || !status.ok;
      b.dataset.recipe = r.id;
      card.append(b);
      grid.append(card);
    }
  };
  search.addEventListener('input', () => {
    query = search.value.slice(0, 60);
    fill();
  });
  select.onchange = () => {
    category = select.value;
    fill();
  };
  quantity.onchange = () => {
    batch = Number(quantity.value);
    fill();
  };
  fill();
}
let baseMap;
function chartPage() {
  const split = el('div', undefined, 'split'),
    wrap = el('div', undefined, 'map-wrap'),
    notes = el('div', undefined, 'notes'),
    canvas = el('canvas');
  canvas.width = 640;
  canvas.height = 640;
  canvas.setAttribute('aria-label', 'Archipelago chart: north is up, player is white, cave entrances are amber triangles and landmarks are gold stars.');
  wrap.append(canvas);
  split.append(wrap, notes);
  content.append(split);
  const ctx = canvas.getContext('2d');
  if (!baseMap || baseMap.seed !== game.state.seed) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const cc = c.getContext('2d'),
      im = cc.createImageData(256, 256);
    for (let z = 0; z < 256; z++) for (let x = 0; x < 256; x++) {
      const col = W.column(x * 4 - 512, z * 4 - 512, game.state.seed),
        color = col.h > D.C.sea ? col.island?.color || '#d0c09a' : col.h > 8 ? '#438b91' : '#203f50';
      const v = col.h > D.C.sea ? .75 + col.h / 100 : 1;
      const k = (z * 256 + x) * 4;
      im.data[k] = parseInt(color.slice(1, 3), 16) * v;
      im.data[k + 1] = parseInt(color.slice(3, 5), 16) * v;
      im.data[k + 2] = parseInt(color.slice(5, 7), 16) * v;
      im.data[k + 3] = 255;
    }
    cc.putImageData(im, 0, 0);
    baseMap = {
      seed: game.state.seed,
      canvas: c
    };
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(baseMap.canvas, 0, 0, 640, 640);
  const map = v => (v + 512) / 1024 * 640;
  ctx.strokeStyle = '#d9b77b';
  ctx.setLineDash([3, 6]);
  for (const r of [405, 490]) {
    ctx.beginPath();
    ctx.arc(320, 320, r / 1024 * 640, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  for (const i of D.islands) {
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(i.name, map(i.x), map(i.z) + 40);
    ctx.fillStyle = '#ffc247';
    ctx.fillText('✦', map(i.x + 12), map(i.z - 10));
  }
  for (const cave of game.world.networks) {
    ctx.fillStyle = '#ffc247';
    ctx.fillText('▲', map(cave.entrance[0]), map(cave.entrance[2]));
  }
  const p = game.state.player;
  ctx.save();
  ctx.translate(map(p.x), map(p.z));
  ctx.rotate(-p.yaw);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(5, 6);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#ff6a1f';
  ctx.fillText('⌂', map(game.state.camp.x), map(game.state.camp.z));
  notes.append(el('h3', 'The sheltered sea'));
  paragraph('North is up (−Z). White arrow: you. Ember house: camp. ▲ Safe cave entrances. ✦ Tidekeeper landmarks. Dashed rings: warning waters and the fatal outer boundary.', notes);
  for (const i of D.islands) {
    notes.append(el('strong', `${game.state.discoveries.includes(i.id) ? '✓' : '○'} ${i.name}`));
    paragraph(`${i.biome} · ${i.x}, ${i.z} · ${Math.round(Math.hypot(i.x - p.x, i.z - p.z))} m from you`, notes);
  }
  paragraph('Sail between shores in roughly 10–25 seconds of open water; exploring a whole island takes several minutes. Caves descend along walkable ramps into three branches. Follow the amber entrance mark.', notes);
}
function campPage() {
  const l = game.luxury();
  content.append(el('div', l.points + ' comfort', 'metric'), el('h3', l.rank));
  paragraph(`${l.varieties} distinct furnishings · ${l.categories} comfort categories · ${l.architecture} architecture points`);
  paragraph('Comfort is measured within 24 blocks of your camp anchor. Rest at a bed to move it. Each furnishing design scores once; repeated cheap chairs cannot buy an estate. Mix light, rest, gardens, art, water, knowledge, textiles, music and social spaces. Spread furnishings into several areas; add a floor and roof. Architecture is capped at 18 points.');
  const grid = el('div', undefined, 'grid');
  for (const [rank, threshold] of [['Welcoming homestead', 30], ['Coastal retreat', 60], ['Island estate', 95], ['Tidekeeper sanctuary', 135]]) {
    const card = el('div', undefined, 'card');
    card.append(el('h3', `${l.points >= threshold ? '✓ ' : ''}${rank}`), el('p', `${threshold} comfort`));
    grid.append(card);
  }
  content.append(grid);
  content.append(button('Return to camp with your pack', () => {
    if (game.returnCamp()) closePanel();else notice(game.message);
  }));
  paragraph('Camp return is a forgiving unstuck/travel option inside sheltered waters. It is disabled once you enter the boundary warning zone.', content, 'caption');
}
async function replaceGame(state, slot) {
  clearInputs();
  if (renderer) renderer.dispose();
  game = new G.Game(state, () => saves.terminal(activeSlot));
  activeSlot = slot;
  started = true;
  stormShown = false;
  lastSave = state.time;
  noticeSerial = -1;
  hotSignature = '';
  baseMap = null;
  $('saveStatus').textContent = `Slot ${slot} · checkpoint ${state.status === 'alive' ? 'loaded' : 'preserved'}`;
  $('welcome').hidden = true;
  $('ending').hidden = true;
  $('storm').hidden = true;
  $('hud').hidden = false;
  $('loading').hidden = false;
  $('loadText').textContent = 'Building nearby chunks…';
  try {
    renderer = new Renderer($('world'), game);
    await renderer.ready;
    for (let n = 0; n < 5; n++) {
      renderer.render();
      await new Promise(r => requestAnimationFrame(r));
    }
    $('loading').hidden = true;
    audio.enable(state.settings.sound);
    if (state.status === 'dead') {
      showEnding();
    } else {
      notice('Welcome ashore. Tab opens your first objectives. Click the world to capture the mouse.');
      game.paused = true;
      openPanel('Journal');
    }
  } catch (e) {
    failure(e);
  }
}
async function newInSlot(slot) {
  const info = saves.inspect(slot);
  if (!info.empty && !confirm(`Replace slot ${slot}? The existing valid primary becomes its previous backup. Export it first if you want to keep multiple worlds.`)) return;
  const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647,
    state = G.fresh(seed);
  state.name = `Island retreat ${slot}`;
  const result = saves.create(slot, state);
  if (!result.ok) {
    openPanel('Saves');
    notice(result.error);
    return;
  }
  if (panel.open) panel.close();
  await replaceGame(state, slot);
  $('saveStatus').textContent = `Slot ${slot} · checkpoint saved`;
}
function saveNow() {
  if (!started || !activeSlot) return false;
  const result = saves.save(activeSlot, game.snapshot());
  $('saveStatus').textContent = result.ok ? `Slot ${activeSlot} · saved at ${Math.floor(game.state.time / 60)} min` : 'Checkpoint not updated';
  if (result.ok) lastSave = game.state.time;else lastSave = game.state.time - 15;
  return result;
}
function exportSave() {
  try {
    const snapshot = game.snapshot();
    S.validate(snapshot);
    const raw = JSON.stringify(snapshot);
    if (raw.length > S.MAX) throw new Error('Export exceeds 2 MB.');
    const a = el('a'),
      url = URL.createObjectURL(new Blob([raw], {
        type: 'application/json'
      }));
    a.href = url;
    a.download = `emberwake-slot-${activeSlot || 'preview'}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    notice('JSON export downloaded. Keep it somewhere safe. Only safe living checkpoints can be imported.');
  } catch (e) {
    notice('Export failed: ' + e.message);
  }
}
function savesPage() {
  paragraph('Three local slots. Autosave every 30 seconds of play in sheltered waters. Each successful write keeps the previous valid primary as backup. Browser data may be cleared; export JSON for durable backup. No data is sent to a server.');
  if (started) {
    const toolbar = el('div', undefined, 'toolbar'),
      name = el('input');
    name.value = game.state.name;
    name.maxLength = 48;
    name.setAttribute('aria-label', 'Camp name');
    toolbar.append(name, button('Rename camp', () => {
      const value = name.value.trim().replace(/[\u0000-\u001f]/g, '');
      if (value) {
        game.state.name = value;
        notice('Camp renamed. Save to keep the name.');
      }
    }), button('Export current JSON', exportSave));
    content.append(toolbar);
  }
  for (let slot = 1; slot <= 3; slot++) {
    const info = saves.inspect(slot),
      card = el('div', undefined, 'slot' + (slot === activeSlot ? ' active' : '')),
      label = el('div'),
      actions = el('div', undefined, 'actions');
    label.append(el('h3', `Slot ${slot} · ${info.empty ? 'Empty' : info.error ? 'Needs recovery' : info.name}`), el('p', info.error || (info.empty ? 'A fresh shore awaits.' : `${Math.floor(info.time / 60)} minutes played${info.terminal ? ' · voyage ended; checkpoint preserved' : ''}`)));
    card.append(label, actions);
    if (started && slot === activeSlot) actions.append(button('Save checkpoint', () => {
      const r = saveNow();
      notice(r.ok ? 'Safe checkpoint saved.' : r.error);
      renderPanel();
      $('panelFoot').textContent = r.ok ? 'Safe checkpoint saved.' : r.error;
    }));
    if (!info.empty) {
      actions.append(button('Load', () => loadSlot(slot, false, false)));
      actions.append(button('Restore safe', () => loadSlot(slot, false, true)));
      actions.append(button('Previous backup', () => loadSlot(slot, true, true)));
    }
    actions.append(button('New voyage', () => newInSlot(slot)));
    const input = el('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      if (file.size > S.MAX) return notice('Import rejected: maximum size is 2 MB.');
      try {
        const raw = await file.text(),
          state = S.decode(raw);
        if (!confirm(`Import “${state.name}” into slot ${slot}? Its previous valid primary will be kept as backup.`)) return;
        const result = saves.import(slot, raw);
        if (!result.ok) notice(result.error);else loadSlot(slot, false, false);
      } catch (e) {
        notice('Import rejected: ' + e.message);
      }
    });
    actions.append(button('Import JSON', () => input.click()), input);
    content.append(card);
  }
  paragraph('After an outer-sea disaster, Load shows the ended voyage. Restore safe explicitly rewinds to the last primary checkpoint. Previous backup recovers the prior successful save. Starting a new voyage replaces only that slot. Corrupt data is never silently reset.', content, 'caption');
}
async function loadSlot(slot, backup, restore) {
  if (started && game.state.status === 'alive' && !confirm('Load this checkpoint? Unsaved progress in the current session will be replaced.')) return;
  const result = saves.load(slot, backup, restore);
  if (!result.ok) {
    notice(result.error);
    return;
  }
  if (panel.open) panel.close();
  await replaceGame(result.state, slot);
}
function helpPage() {
  content.className = 'notes';
  const split = el('div', undefined, 'split'),
    a = el('div'),
    b = el('div');
  split.append(a, b);
  content.append(split);
  a.append(el('h3', 'Hands, feet, and a horizon'));
  const controls = [['WASD', 'Walk / swim / sail. Mouse steers your view and vessel.'], ['Space / Shift', 'Jump or swim upward / walk faster. C dives while swimming.'], ['Hold left click', 'Mine the target. Picks are required for stone and ores.'], ['Right click', 'Place selected block; eat selected food; launch selected raft in water.'], ['E', 'Use bush, garden, fishing rod, bed, furniture, chest, tablet or vessel.'], ['1–8 / mouse wheel', 'Select hotbar slot. Assign any owned item through Pack.'], ['Tab / I / B / M / J', 'Field notes / pack / recipes / chart / journal.'], ['Esc', 'Release mouse and pause. Return to shore resumes and captures mouse.'], ['F', 'Eat selected food, or a sunberry if you have one.']];
  for (const [key, action] of controls) {
    const p = el('p');
    p.append(el('strong', key + ' · '), document.createTextNode(action));
    a.append(p);
  }
  b.append(el('h3', 'A forgiving life'));
  paragraph('No oxygen timer, monsters, weapon combat or tool durability. Hunger and cold can lower health to 25, never to death. Rest restores health. Farm beds grow roots or grain based on position; tend with a watering can to accelerate growth. Fishing brings a pearl every fourth catch. All timers pause in panels; there is no offline growth or starvation.', b);
  paragraph('Chests hold 4,000 items each. Campfire cooks fish; galley prepares full meals. Workstations must be placed within seven blocks. Inventory crafting is atomic: failed recipes consume nothing. There is no crafting grid; the recipe book is the full crafting system.', b);
  paragraph('At the far ocean boundary, warning text escalates before the final crossing. Crossing is terminal and cannot be paused or canceled. Its marker is written before crossing; if storage fails, the crossing is blocked with a message. Safe checkpoints remain recoverable.', b);
  paragraph('Designed for desktop keyboard and mouse. Panels adapt to small windows, but touch movement is not implemented. Use a local HTTP server; file:// module loading is unsupported.', b);
  const toolbar = el('div', undefined, 'toolbar');
  toolbar.append(button(game.state.settings.sound ? 'Mute sound' : 'Enable gentle sound', () => {
    game.state.settings.sound = !game.state.settings.sound;
    audio.enable(game.state.settings.sound);
    renderPanel();
  }));
  const range = el('input');
  range.type = 'range';
  range.min = '.25';
  range.max = '3';
  range.step = '.05';
  range.value = game.state.settings.sensitivity;
  range.setAttribute('aria-label', 'Mouse sensitivity');
  range.oninput = () => game.state.settings.sensitivity = Number(range.value);
  const view = el('select');
  view.setAttribute('aria-label', 'Render distance');
  for (const n of [3, 4, 5]) {
    const option = el('option', `${n === 3 ? 'Low' : n === 4 ? 'Balanced' : 'Wide'} view (${(n * 2 + 1) ** 2} chunks)`);
    option.value = n;
    view.append(option);
  }
  view.value = game.state.settings.view;
  view.onchange = () => game.state.settings.view = Number(view.value);
  toolbar.append(el('label', 'Look sensitivity'), range, view);
  content.append(toolbar);
}
function showEnding() {
  game.paused = true;
  clearInputs();
  if (panel.open) panel.close();
  if (document.pointerLockElement) document.exitPointerLock();
  $('storm').hidden = true;
  $('ending').hidden = false;
}
$('restoreSafe').onclick = () => loadSlot(activeSlot, false, true);
$('endingSaves').onclick = () => openPanel('Saves');
$('newGame').onclick = () => {
  const empty = [1, 2, 3].find(n => saves.inspect(n).empty);
  if (empty) newInSlot(empty);else openPanel('Saves');
};
$('continueGame').onclick = () => openPanel('Saves');
const canvas = $('world');
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  failure(new Error('WebGL context lost'));
});
canvas.addEventListener('click', () => {
  if (started && !panel.open && game.state.status === 'alive' && document.pointerLockElement !== canvas) lock();
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('mousedown', event => {
  if (document.pointerLockElement !== canvas || game.paused || game.state.status !== 'alive') return;
  if (event.button === 0) mining = true;
  if (event.button === 2 && game.place()) audio.effect('place');
});
addEventListener('mouseup', () => {
  mining = false;
});
addEventListener('mousemove', event => {
  if (document.pointerLockElement !== canvas || game.paused) return;
  const p = game.state.player;
  p.yaw = W.clamp((p.yaw - event.movementX * .0022 * game.state.settings.sensitivity) % (Math.PI * 2), -Math.PI * 2, Math.PI * 2);
  p.pitch = W.clamp(p.pitch - event.movementY * .0022 * game.state.settings.sensitivity, -1.49, 1.49);
});
canvas.addEventListener('wheel', event => {
  if (document.pointerLockElement === canvas) {
    event.preventDefault();
    game.state.selected = (game.state.selected + (event.deltaY > 0 ? 1 : 7)) % 8;
  }
}, {
  passive: false
});
addEventListener('keydown', event => {
  if (event.target.matches('input,select,textarea')) return;
  if (/^Digit[1-8]$/.test(event.code)) {
    game.state.selected = Number(event.code.slice(-1)) - 1;
    if (panel.open && tab === 'Pack') renderPanel();
    return;
  }
  if (panel.open) {
    if (event.code === 'Tab') return;
    if (['KeyI', 'KeyB', 'KeyM', 'KeyJ'].includes(event.code)) {
      event.preventDefault();
      openPanel({
        KeyI: 'Pack',
        KeyB: 'Craft',
        KeyM: 'Chart',
        KeyJ: 'Journal'
      }[event.code]);
    }
    return;
  }
  if (!started || game.state.status !== 'alive') return;
  if (['Tab', 'KeyI', 'KeyB', 'KeyM', 'KeyJ', 'Escape'].includes(event.code)) {
    event.preventDefault();
    openPanel({
      KeyI: 'Pack',
      KeyB: 'Craft',
      KeyM: 'Chart',
      KeyJ: 'Journal'
    }[event.code] || 'Journal');
    return;
  }
  if (event.repeat) return;
  keys[event.code] = true;
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) event.preventDefault();
  if (game.paused) return;
  if (event.code === 'Space') jumpQueued = true;
  if (event.code === 'KeyE') {
    game.openChest = null;
    const hit = game.target();
    game.interact();
    audio.effect(hit && D.blocks[hit.id].key === 'gramophone' ? 'music' : 'use');
    if (game.openChest) openPanel('Pack');
  }
  if (event.code === 'KeyF') game.eat(D.items[game.selected()]?.food ? game.selected() : 'berry');
});
addEventListener('keyup', event => delete keys[event.code]);
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== canvas) {
    clearInputs();
    if (started && !panel.open && $('fatal').hidden && game.state.status === 'alive') openPanel('Journal');
  }
});
addEventListener('blur', () => {
  clearInputs();
  if (started && game.state.status === 'alive') openPanel('Journal');
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInputs();
    if (started && game.state.status === 'alive') {
      saveNow();
      openPanel('Journal');
    }
  }
});
addEventListener('beforeunload', () => {
  if (started && game.state.status === 'alive') saveNow();
});
function hud(now) {
  const s = game.state,
    p = s.player,
    col = W.column(p.x, p.z, s.seed),
    boat = s.boats.find(b => b.id === p.boat);
  $('location').textContent = boat ? 'Under sail · ' + D.items[boat.type].name : col.island?.name || 'The sheltered sea';
  $('coordinates').textContent = `${Math.round(p.x)}, ${Math.round(p.z)} · elevation ${Math.floor(p.y)} · day ${1 + Math.floor(s.time / 1200)}`;
  $('health').textContent = `♥ Health ${Math.ceil(p.health)}`;
  $('food').textContent = `◒ Food ${Math.ceil(p.food)}`;
  $('warmth').textContent = `☀ Warmth ${Math.ceil(p.warmth)}`;
  const objective = objectives().find(o => !o[0]);
  $('objectiveText').textContent = objective ? `${objective[1]}. ${objective[2]}` : 'Your sanctuary is complete. Keep building your own story.';
  const radius = Math.hypot(p.x, p.z);
  $('boundary').hidden = radius < D.C.warning;
  $('boundary').textContent = radius > D.C.danger ? `DANGER · Turn toward the islands now. Fatal storm in ${Math.max(0, Math.ceil(D.C.border - radius))} m. Crossing ends this voyage.` : 'OUTER WATERS · Headwinds slow your sail. Turn toward the islands. Saves and camp return are disabled here.';
  const target = game.target();
  $('targetLabel').textContent = target ? D.blocks[target.id].name + (D.blocks[target.id].category || ['berryBush', 'relic'].includes(D.blocks[target.id].key) ? ' · E to use' : '') + (target && D.blocks[target.id].tier > 0 ? ' · pick required' : '') : game.fishing ? `Fishing · ${Math.ceil(game.fishing)}s` : '';
  $('mining').hidden = game.mineProgress <= 0;
  $('mining').value = target ? game.mineProgress / D.blocks[target.id].hardness : 0;
  if (noticeSerial !== game.messageSerial) {
    noticeSerial = game.messageSerial;
    noticeTime = now;
    $('notice').textContent = game.message;
    if (game.message.startsWith('Gathered')) audio.effect('mine');
  }
  if (now - noticeTime > 6500) $('notice').textContent = '';
  const signature = JSON.stringify([s.hotbar, s.inventory, s.selected]);
  if (signature !== hotSignature) {
    hotSignature = signature;
    $('hotbar').replaceChildren();
    s.hotbar.forEach((id, n) => {
      const cell = el('div', undefined, 'hot' + (n === s.selected ? ' active' : ''));
      cell.title = D.items[id].name;
      cell.append(el('small', String(n + 1)), icon(id), el('b', String(s.inventory[id] || 0)));
      $('hotbar').append(cell);
    });
  }
  document.body.classList.toggle('underwater', game.world.waterAt(p.x, p.y + 1.62, p.z));
  audio.ambient(s.time, p.y < D.C.sea + .5);
}
function frame(now) {
  requestAnimationFrame(frame);
  if (!renderer) return;
  const dt = Math.min(.05, (now - last) / 1000);
  last = now;
  try {
    if (started) {
      game.step({
        forward: keys.KeyW,
        back: keys.KeyS,
        left: keys.KeyA,
        right: keys.KeyD,
        jump: keys.Space || jumpQueued,
        sprint: keys.ShiftLeft || keys.ShiftRight,
        down: keys.KeyC,
        mine: mining
      }, dt);
      jumpQueued = false;
      if (game.state.status === 'disaster' && !stormShown) {
        stormShown = true;
        clearInputs();
        if (panel.open) panel.close();
        $('storm').hidden = false;
        audio.effect('storm');
        if (document.pointerLockElement) document.exitPointerLock();
      }
      if (game.state.status === 'dead' && $('ending').hidden && $('loading').hidden) showEnding();
      if (game.state.status === 'alive' && game.state.time - lastSave >= 30) {
        const r = saveNow();
        if (!r.ok) notice(r.error);
      }
      if (now - lastHud > 120) {
        hud(now);
        lastHud = now;
      }
    }
    renderer.render(dt);
  } catch (e) {
    failure(e);
    renderer = null;
  }
}
try {
  renderer = new Renderer(canvas, game);
  await renderer.ready;
  for (let n = 0; n < 10; n++) {
    renderer.render();
    await new Promise(r => requestAnimationFrame(r));
  }
  $('loading').hidden = true;
  $('welcome').hidden = false;
  requestAnimationFrame(frame);
} catch (e) {
  failure(e);
}
