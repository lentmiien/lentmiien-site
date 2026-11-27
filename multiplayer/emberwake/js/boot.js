import { Renderer } from './renderer.js';
import { Audio } from './audio.js';
const D = window.EWData,
  W = window.EWWorld,
  G = window.EWGame;
const $ = id => document.getElementById(id),
  audio = new Audio(),
  panel = $('panel'),
  content = $('panelContent');
let game,
  renderer,
  socket,
  pose,
  myNumber,
  checkpoint = 0,
  sender;
let started = false,
  ended = false,
  tab = 'Journal',
  keys = {},
  mining = false;
let last = 0,
  lastHud = 0,
  noticeTime = 0,
  noticeSerial = -1,
  hotSignature = '';
let category = 'All',
  query = '',
  batch = 1,
  jumpQueued = false,
  seq = 0,
  lastInput = '',
  sentAt = 0;
let peers = [],
  bases = [],
  portalLatch = null,
  refreshCraft,
  uiSignature = '';

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
  img.loading = 'lazy';
  img.decoding = 'async';
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
  sendInput();
}
function notice(text) {
  game.notify(text);
  $('panelFoot').textContent = text;
}
function failure(error) {
  leaveScreen(
    'Rendering unavailable',
    'WebGL 2 and the local game assets are required. Enable hardware acceleration and reload the harbor.'
  );
  console.error('Emberwake renderer failed', error);
}
function leaveScreen(title, message) {
  if (ended) return;
  ended = true;
  started = false;
  clearInterval(sender);
  if (panel.open) panel.close();
  if (document.pointerLockElement) document.exitPointerLock();
  socket?.disconnect();
  for (const id of ['loading', 'welcome', 'hud', 'storm']) $(id).hidden = true;
  $('exitTitle').textContent = title;
  $('fatalText').textContent = message;
  $('fatal').hidden = false;
  renderer?.dispose();
  renderer = null;
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
    p?.catch(() =>
      notice('Mouse capture was declined. Click the world to try again; Esc opens your field notes.')
    );
  } catch {
    notice('Click the world to capture the mouse.');
  }
}
function closePanel() {
  if (game.openChest) act({ op: 'closeChest' });
  panel.close();
  clearInputs();
  if (started && game.state.status === 'alive') lock();
}
function openPanel(name = 'Journal') {
  if (!started || game.state.status === 'disaster') return;
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
  for (const name of ['Journal', 'Pack', 'Craft', 'Chart', 'Camp', 'Crew', 'Help']) {
    const b = button(
      name,
      () => {
        tab = name;
        renderPanel();
      },
      tab === name ? 'active' : ''
    );
    b.setAttribute('aria-current', tab === name ? 'page' : 'false');
    tabs.append(b);
  }
  content.replaceChildren();
  content.className = '';
  if (tab === 'Pack') packPage();
  if (tab === 'Craft') craftPage();
  if (tab === 'Journal') journalPage();
  if (tab === 'Chart' || tab === 'Portal crossings') chartPage();
  if (tab === 'Camp') campPage();
  if (tab === 'Crew') crewPage();
  if (tab === 'Help') helpPage();
  $('panelFoot').textContent =
    'The world continues while anyone is aboard. Your progress is saved to your account.';
}
function objectives() {
  const s = game.state;
  return [
    [
      s.stats.mined >= 6,
      'Gather driftwood on the beach',
      'Hold left click on six logs. Logs also yield resin. Press E at a berry bush for food, fiber and seeds.'
    ],
    [
      s.crafted.includes('woodPick') && s.crafted.includes('bench'),
      'Make a place to work',
      'Tab → Craft: turn logs into planks; craft a workbench and a driftwood pick. Assign them in Pack. Right click places the bench.'
    ],
    [
      s.crafted.includes('stonePick'),
      'Follow the cave trail',
      'Chart marks every cave entrance. A driftwood pick mines stone and copper. Craft a stone pick at your bench to mine iron.'
    ],
    [
      s.crafted.includes('kiln') && s.crafted.includes('copperPick'),
      'Warm the forge',
      'Gather clay on the low shores, coal and copper underground. A kiln smelts copper; make a copper pick for prism seams.'
    ],
    [
      s.crafted.includes('raft'),
      'Raise a small sail',
      'Eight logs and four ropes at a bench make a raft. Wade into water, select it, then right click to launch and board.'
    ],
    [
      s.discoveries.length >= 3,
      'A wider horizon',
      'Visit three islands. Discovery unlocks regional designs. Landmarks contain optional stories and pearls.'
    ],
    [
      s.stats.harvest > 0 && s.stats.fish > 0,
      'Set a generous table',
      'Place a garden bed and press E with a seed in your pack. Cast a fishing rod toward low open water with E; stay still for six seconds.'
    ],
    [
      s.crafted.includes('artisans'),
      'Learn the finer crafts',
      'Smelt iron at a forge; weave cloth at a loom. Build an artisan table for stonework, instruments and late luxuries.'
    ],
    [
      game.luxury().points >= 95,
      'A home worth returning to',
      'Place your harbor pennant to anchor your camp. Furnish within 24 blocks: light, rest, gardens, art, water, music, and thoughtful architecture. Reach 95 comfort.'
    ],
    [
      D.legacy.islands.every(id => s.secrets.includes(id)) && game.luxury().points >= 135,
      'Become a tidekeeper',
      'Find five quiet stories and build a 135-comfort sanctuary. Then keep building: this is your archipelago.'
    ]
  ];
}
function journalPage() {
  const s = game.state;
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
  right.append(el('h3', 'Your harbor pennant'));
  paragraph(
    'Your last hotbar slot holds a pennant. Place it beyond the landing beach and at least 76 m from every treasure. Its 64 m radius protects your whole camp from seabed to sky. Mine it to move home. You return here after a storm.',
    right
  );
  right.append(el('h3', 'Salvage log · ' + s.salvaged.length + '/5'));
  paragraph(
    'Three flooded passages and two sealed land chambers hold salvage for every sailor. There is no oxygen timer. Swim down with C and up with Space. Press E on a coffer.',
    right
  );
  for (const find of game.world.soundings)
    paragraph((s.salvaged.includes(find.id) ? '✓ ' : '○ ') + find.name + ' · ' + find.hint, right);
  right.append(el('h3', 'The floating islands'));
  paragraph(
    'Take a pick and building supplies. Sail to a wingtip or a fork, dive to the seabed and build beside the cliff. Jump and place blocks beneath you until you can step across. A portal makes the return trip quick.',
    right
  );
  for (const site of game.world.sky.sites) {
    const found = site.vaults.filter(v => s.sky.finds.includes(v.id)).length;
    right.append(el('h3', site.name + ' · ' + found + '/2 treasures'));
    paragraph(site.biome + ' · ' + site.x + ', ' + site.z, right);
    for (const v of site.vaults) {
      if (s.sky.finds.includes(v.id)) paragraph('✓ ' + D.items[v.reward].name + '. ' + v.story, right);
      else if (s.discoveries.includes(site.id)) paragraph(v.clue, right);
    }
  }
  right.append(el('h3', 'Tideglass portals'));
  paragraph(
    'At a workbench, craft a portal from four glass, two copper ingots and four stone. Place pads at the stops you want to connect. Step onto one and choose an exit on the chart. Mine a pad to move it.',
    right
  );
  right.append(el('h3', 'The Spectrum Shores'));
  paragraph(
    'Sail to the four outer islands for sculpture stone. Hold left click to gather the colored layers by hand, equip a stone from your pack, then right click a face to build. Each shore also has pigment seams for a driftwood pick, and a local creature that drops the same pigment.',
    right
  );
  for (const i of D.islands.filter(i => i.shades))
    paragraph(
      `${i.name} (${i.x}, ${i.z}) · ${i.colors.map(([shade]) => shade).join(', ')} · ${i.creature}`,
      right
    );
  paragraph(
    'For a seven-band arch, stack scarlet, tangerine, sunflower, emerald, cobalt, indigo and violet in nested curves. Mix all four pigments with clay at a kiln for a striped mosaic.',
    right
  );
  right.append(el('h3', 'Outer gardens'));
  paragraph(
    'Sail west to Reedglass Haven or east to Honeycomb Isle. Their coordinates are on the chart. Mine their caves for jade and amber, gather bamboo, and build a renewable bamboo nursery. The crew shares progress on each island restoration.',
    right
  );
  for (const [id, stages] of Object.entries(D.projects)) {
    const progress = game.state.expedition.projects[id],
      island = D.islands.find(i => i.id === id);
    right.append(el('h3', `${island.landmark} · ${progress}/${stages.length}`));
    for (const [n, stage] of stages.entries())
      paragraph(
        `${n < progress ? '✓' : '○'} ${stage.name}: ${Object.entries(stage.cost)
          .map(([item, count]) => `${count} ${D.items[item].name}`)
          .join(
            ', '
          )}${stage.defeats ? `; shoo ${stage.defeats} mites (${game.state.expedition.defeated} so far)` : ''}. ${stage.unlock ? `Unlocks ${D.items[stage.unlock].name}.` : 'Awards regional materials.'}`,
        right
      );
    paragraph(
      'Bring supplies to the gold surface tablet and press E to restore one stage. Completing both stages creates a rest stop and unlocks a special camp furnishing.',
      right
    );
  }
  right.append(el('h3', 'Notes washed ashore'));
  paragraph(
    `Cave collection: ${game.state.caveFinds.length} / ${D.islands.length} tidekeeper caches. Explore the deepest chamber on each island; each cache rewards you once.`,
    right
  );
  paragraph(
    'No rush. Honeycomb Isle and the four Spectrum Shores have gentle creatures: three barehanded hits or one staff hit shoo one. They stay on their island and cannot kill you. Hunger takes over two hours to empty and never kills you. Berries regrow; tools never break. Cold calls for a cloak, tea, or a warm home.',
    right
  );
  for (const id of game.state.secrets) {
    const index = D.islands.findIndex(i => i.id === id);
    right.append(el('h3', D.islands[index].landmark));
    paragraph(D.lore[index], right);
  }
  if (!game.state.secrets.length)
    paragraph(
      'Look for gold tablets near each island’s heart. The chart gives their locations; the stories are yours to find.',
      right
    );
  paragraph(
    `The expanded sea is finite. Warnings begin at radius ${D.C.warning}; danger buoys at ${D.C.danger}. Crossing radius ${D.C.border} sweeps you home with your pack. Leaving during the storm still sends you home.`,
    right
  );
}
function packPage() {
  const s = game.state;
  paragraph(
    `Pack ${G.total(s.inventory)} / ${D.C.pack} · Click an item to assign it to hotbar slot ${s.selected + 1}. Select another slot with 1–8 or below.`
  );
  const toolbar = el('div', undefined, 'toolbar');
  for (let n = 0; n < 8; n++)
    toolbar.append(
      button(
        `${n + 1}: ${D.items[s.hotbar[n]].name}`,
        () => {
          act({ op: 'select', slot: n });
        },
        s.selected === n ? 'primary' : ''
      )
    );
  content.append(toolbar);
  const grid = el('div', undefined, 'pack');
  for (const [id, n] of Object.entries(s.inventory).sort((a, b) =>
    D.items[a[0]].name.localeCompare(D.items[b[0]].name)
  )) {
    const b = button('', () => {
      act({ op: 'assign', slot: s.selected, item: id });
    });
    b.append(icon(id), el('span', D.items[id].name), el('b', `× ${n}`));
    grid.append(b);
  }
  content.append(grid);
  if (!Object.keys(s.inventory).length)
    paragraph('An empty pack, an open shore. Gather the driftwood ahead; press E at a sunberry bush.');
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
      const chestRoom = 4000 - G.total(s.harvests['chest:' + k] || {});
      for (const [id, owned] of Object.entries(s.inventory)) {
        const n = Math.min(owned, chestRoom, D.C.stack - (s.harvests['chest:' + k]?.[id] || 0));
        if (n > 0 && id !== 'baseMarker')
          a.append(
            button(`Store ${n} ${D.items[id].name}`, () => {
              act({ op: 'transfer', item: id, count: n, deposit: true });
            })
          );
      }
      const packRoom = D.C.pack - G.total(s.inventory);
      for (const [id, stored] of Object.entries(s.harvests['chest:' + k] || {})) {
        const n = Math.min(stored, packRoom, D.C.stack - (s.inventory[id] || 0));
        if (n > 0)
          b.append(
            button(`Take ${n} ${D.items[id].name}`, () => {
              act({ op: 'transfer', item: id, count: n, deposit: false });
            })
          );
      }
      split.append(a, b);
      content.append(split);
    }
  }
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
  const summary = el(
    'p',
    `${D.recipes.length} recipes · Stations work within 7 blocks · ${
      game.stations().size
        ? Array.from(game.stations())
            .map(k => D.items[k].name)
            .join(', ')
        : 'No nearby stations'
    }`,
    'caption'
  );
  content.append(summary);
  const grid = el('div', undefined, 'grid');
  content.append(grid);
  const fill = () => {
    grid.replaceChildren();
    for (const r of D.recipes) {
      if (category !== 'All' && r.category !== category) continue;
      if (
        query &&
        !`${D.items[r.out].name} ${Object.keys(r.cost)
          .map(k => D.items[k].name)
          .join(' ')}`
          .toLowerCase()
          .includes(query.toLowerCase())
      )
        continue;
      const card = el('article', undefined, 'card'),
        title = el('h3');
      title.append(icon(r.out), el('span', D.items[r.out].name));
      card.append(title);
      paragraph(
        `${r.category} · makes ${r.count * batch}${r.station ? ' · ' + D.items[r.station].name : ' · hand craft'}`,
        card
      );
      const cost = el('div', undefined, 'cost');
      for (const [id, n] of Object.entries(r.cost)) {
        const have = game.state.inventory[id] || 0;
        cost.append(
          el(
            'span',
            `${D.items[id].name} ${have}/${n * batch}`,
            'chip' + (have < n * batch ? ' missing' : '')
          )
        );
      }
      card.append(cost);
      if (r.discovery) paragraph(`Discover ${D.destinations.find(i => i.id === r.discovery).name}`, card);
      const status = game.recipeStatus(r, batch),
        b = button(status.ok ? 'Craft' : status.reason, () => {
          act({ op: 'craft', item: r.id, count: batch }, () => audio.effect('craft'));
        });
      b.disabled = !started || !status.ok;
      b.dataset.recipe = r.id;
      card.append(b);
      grid.append(card);
    }
  };
  refreshCraft = fill;
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
let baseMap,
  lastChart = 0;
function chartPage() {
  const split = el('div', undefined, 'split'),
    wrap = el('div', undefined, 'map-wrap'),
    notes = el('div', undefined, 'notes'),
    canvas = el('canvas');
  canvas.width = 640;
  canvas.height = 640;
  canvas.setAttribute(
    'aria-label',
    'Archipelago chart: north is up, player is white, cave entrances are amber triangles and landmarks are gold stars.'
  );
  wrap.append(canvas);
  split.append(wrap, notes);
  content.append(split);
  const ctx = canvas.getContext('2d');
  if (!baseMap || baseMap.world !== game.world || baseMap.revision !== game.world.revision) {
    const c = document.createElement('canvas'),
      raster = window.EWChart.raster(game.world);
    c.width = raster.width;
    c.height = raster.height;
    c.getContext('2d').putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
    baseMap = { world: game.world, revision: game.world.revision, canvas: c };
  }
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(baseMap.canvas, 0, 0, 640, 640);
  const map = v => ((v + D.C.extent) / (D.C.extent * 2)) * 640;
  ctx.strokeStyle = '#d9b77b';
  ctx.setLineDash([3, 6]);
  for (const r of [D.C.warning, D.C.border]) {
    ctx.beginPath();
    ctx.arc(320, 320, (r / (D.C.extent * 2)) * 640, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = '12px system-ui';
  ctx.textAlign = 'center';
  for (const i of D.islands) {
    ctx.fillStyle = '#fff4dc';
    // Give the close-set original islands labels on opposite sides of the channel.
    ctx.textAlign = ['forest', 'tropic'].includes(i.id)
      ? 'right'
      : ['dunes', 'frost'].includes(i.id)
        ? 'left'
        : 'center';
    ctx.fillText(i.name, map(i.x), map(i.z) + (i.id === 'iris' ? -24 : 33));
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffc247';
    ctx.fillText('✦', map(i.x + 12), map(i.z - 10));
  }
  for (const site of game.world.sky.sites) {
    ctx.fillStyle = '#f4e8d4';
    ctx.fillText(site.name, map(site.x), map(site.z) - 17);
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
  for (const b of bases) {
    ctx.strokeStyle = b.color;
    ctx.beginPath();
    ctx.arc(map(b.x), map(b.z), (64 * 320) / D.C.extent, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = b.color;
    ctx.fillText('⚑', map(b.x), map(b.z));
  }
  for (const peer of peers) {
    ctx.fillStyle = peer.color;
    ctx.beginPath();
    ctx.arc(map(peer.x), map(peer.z), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  const picking = tab === 'Portal crossings';
  const exits = portalMarkers(ctx, map, picking ? game.standingPortal() : null);
  if (picking) {
    portalChart(canvas, notes, exits);
    return;
  }
  if (exits.length)
    paragraph('Turquoise rings mark the crew’s shared portals. Step onto a pad to choose an exit.', notes);
  notes.append(el('h3', 'The sheltered sea'));
  paragraph(
    'The chart and live local map reflect mining and building. Global pixels cover 6 m; the local map shows individual blocks. North is up (−Z). White arrow: you. Colored circles mark protected bases and colored dots mark other sailors. ▲ Safe cave entrances. ✦ Tidekeeper landmarks. Dashed rings: warning waters and the fatal outer boundary.',
    notes
  );
  for (const i of [...D.islands, ...game.world.sky.sites]) {
    notes.append(el('strong', `${game.state.discoveries.includes(i.id) ? '✓' : '○'} ${i.name}`));
    paragraph(
      `${i.biome} · ${i.x}, ${i.z} · ${Math.round(Math.hypot(i.x - p.x, i.z - p.z))} m from you`,
      notes
    );
  }
  paragraph(
    'Allow 10–25 seconds for a short crossing. The Spectrum quarries are farther out. Measure a route on the chart and allow about seven seconds per 100 m by raft. Caves descend along walkable ramps into three branches. Follow the amber entrance mark.',
    notes
  );
}
function portalMarkers(ctx, map, origin) {
  const exits = [];
  for (const [id, block] of Object.entries(game.state.placed)) {
    if (block !== D.ids.portal) continue;
    const [x, y, z] = W.decodeKey(id),
      mx = map(x + 0.5),
      mz = map(z + 0.5);
    ctx.beginPath();
    ctx.arc(mx, mz, 7, 0, Math.PI * 2);
    ctx.fillStyle = id === origin ? '#ffc247' : '#82f5e2';
    ctx.fill();
    ctx.strokeStyle = '#172b39';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(mx, mz, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#173a49';
    ctx.fill();
    if (id !== origin) exits.push({ id, x, y, z, mx, mz });
  }
  if (origin) {
    const [x, , z] = W.decodeKey(origin);
    ctx.beginPath();
    ctx.arc(map(x + 0.5), map(z + 0.5), 10, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffc247';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
  return exits;
}
function portalChart(canvas, notes, exits) {
  exits.sort((a, b) => a.x - b.x || a.z - b.z || a.y - b.y);
  canvas.setAttribute(
    'aria-label',
    'Portal destinations on the world chart. Each exit also appears in the destination list.'
  );
  notes.append(el('h3', 'Choose an exit'));
  paragraph(
    exits.length
      ? 'Select a turquoise marker or choose its coordinates below. Gold marks your entrance.'
      : 'This is the crew’s only portal. Craft another at a workbench and place it where you want to travel.',
    notes
  );
  const list = el('div', undefined, 'portal-exits');
  notes.append(list);
  function travel(exit) {
    act({ op: 'travel', exit: exit.id }, () => {
      portalLatch = exit.id;
      closePanel();
      audio.effect('use');
    });
  }
  function choices(matches, page = 0) {
    list.replaceChildren();
    for (const e of matches.slice(page * 12, page * 12 + 12)) {
      const name = game.world.islandAt(e.x, e.y, e.z)?.name || 'Open sea';
      list.append(button(name + ' · ' + [e.x, e.y, e.z].join(', '), () => travel(e)));
    }
    if (page > 0) list.append(button('Previous exits', () => choices(matches, page - 1)));
    if ((page + 1) * 12 < matches.length) list.append(button('More exits', () => choices(matches, page + 1)));
    if (matches !== exits) list.append(button('Show all exits', () => choices(exits)));
  }
  choices(exits);
  canvas.classList.add('portal-chart');
  canvas.onclick = event => {
    const rect = canvas.getBoundingClientRect();
    const mx = ((event.clientX - rect.left) * canvas.width) / rect.width;
    const mz = ((event.clientY - rect.top) * canvas.height) / rect.height;
    const hits = exits.filter(e => Math.hypot(mx - e.mx, mz - e.mz) <= 14);
    if (hits.length === 1) travel(hits[0]);
    else if (hits.length > 1) {
      choices(hits);
      notice('These portals share a marker. Choose an exit by its coordinates.');
      list.querySelector('button')?.focus();
    }
  };
}
function campPage() {
  const l = game.luxury();
  content.append(el('div', l.points + ' comfort', 'metric'), el('h3', l.rank));
  paragraph(
    `${l.varieties} distinct furnishings · ${l.categories} comfort categories · ${l.architecture} architecture points`
  );
  paragraph(
    'Comfort is measured within 24 blocks of your camp anchor. Place your harbor pennant to move it. Each furnishing design scores once; repeated cheap chairs cannot buy an estate. Mix light, rest, gardens, art, water, knowledge, textiles, music and social spaces. Spread furnishings into several areas; add a floor and roof. Architecture is capped at 18 points.'
  );
  const grid = el('div', undefined, 'grid');
  for (const [rank, threshold] of [
    ['Welcoming homestead', 30],
    ['Coastal retreat', 60],
    ['Island estate', 95],
    ['Tidekeeper sanctuary', 135]
  ]) {
    const card = el('div', undefined, 'card');
    card.append(el('h3', `${l.points >= threshold ? '✓ ' : ''}${rank}`), el('p', `${threshold} comfort`));
    grid.append(card);
  }
  content.append(grid);
  content.append(
    button('Return to camp with your pack', () => {
      act({ op: 'home' }, closePanel);
    })
  );
  paragraph(
    'Camp return is a forgiving unstuck/travel option inside sheltered waters. It is disabled once you enter the boundary warning zone.',
    content,
    'caption'
  );
}
function crewPage() {
  const here = bases.find(b => b.number === myNumber);
  content.className = 'notes';
  content.append(el('h3', peers.length + 1 + ' aboard'));
  paragraph(
    'You sail as ' +
      game.callsign +
      '. Crew callsigns identify players on this chart and above their avatars.'
  );
  for (const p of peers) paragraph(p.name + ' · ' + Math.round(p.x) + ', ' + Math.round(p.z));
  content.append(el('h3', 'Home waters'));
  paragraph(
    here
      ? 'Your pennant stands at ' + [here.x, here.y, here.z].map(Math.floor).join(', ') + '.'
      : 'Equip the harbor pennant in your pack and place it on a block to claim a base.'
  );
  paragraph(
    'Visitors can enter, look around and use any portal. Only the owner can mine, place, harvest or use storage and workstations inside a base. Plain storage outside bases is shared. The first completed withdrawal gets the items.'
  );
  for (const b of bases) paragraph(b.name + ' · 64 m radius · ' + Math.floor(b.x) + ', ' + Math.floor(b.z));
  content.append(el('h3', 'Server checkpoint'));
  paragraph(
    checkpoint
      ? 'Last confirmed write at ' + new Date(checkpoint).toLocaleTimeString() + '.'
      : 'The first checkpoint will be written during play or when you leave.'
  );
  paragraph(
    'The harbor saves every 30 seconds of active play and on departure. Returning to the game restores your location. Joining from another tab or device takes control there.'
  );
  content.append(
    button('Leave the voyage', () =>
      leaveScreen('Back ashore', 'Your character has left the shared world. Reopen the harbor to sail again.')
    )
  );
}
function helpPage() {
  content.className = 'notes';
  const split = el('div', undefined, 'split'),
    a = el('div'),
    b = el('div');
  split.append(a, b);
  content.append(split);
  a.append(el('h3', 'Hands, feet, and a horizon'));
  const controls = [
    ['WASD', 'Walk / swim / sail. Mouse steers your view and vessel.'],
    ['Space / Shift', 'Jump or swim upward / walk faster. C dives while swimming.'],
    [
      'Hold left click',
      'Mine the target, or bonk a nearby island creature. Picks are required for stone and ores.'
    ],
    ['Right click', 'Place selected block; eat selected food; launch selected raft in water.'],
    ['E', 'Use bush, garden, fishing rod, bed, furniture, chest, tablet or vessel.'],
    ['1–8 / mouse wheel', 'Select hotbar slot. Assign any owned item through Pack.'],
    ['Tab / I / B / M / J', 'Field notes / pack / recipes / chart / journal.'],
    ['Esc', 'Release mouse and open field notes. Return to play captures the mouse.'],
    ['F', 'Eat selected food, or a sunberry if you have one.']
  ];
  for (const [key, action] of controls) {
    const p = el('p');
    p.append(el('strong', key + ' · '), document.createTextNode(action));
    a.append(p);
  }
  b.append(el('h3', 'A forgiving life'));
  paragraph(
    'No oxygen timer or tool durability. Honeycomb and each of the four Spectrum Shores host six weak local creatures. Hold left click to shoo them: three hits barehanded, one with a bamboo staff or copper sabre. They rest five minutes after defeat and leave regional materials. They cannot leave their island or kill you. Hunger and cold can lower health to 25, never to death. Rest restores health. Farm beds grow roots or grain based on position; tend with a watering can to accelerate growth. Fishing brings a pearl every fourth catch. World time advances while anyone is aboard. Your food and warmth advance only while you are connected.',
    b
  );
  paragraph(
    'Chests hold 4,000 items each. Campfire cooks fish; galley prepares full meals. Workstations must be placed within seven blocks. Inventory crafting is atomic: failed recipes consume nothing. There is no crafting grid; the recipe book is the full crafting system.',
    b
  );
  paragraph(
    'Crossing the outer storm line carries you back to your pennant, or to the public landing if you have yet to claim a base. Your pack stays with you.',
    b
  );
  paragraph(
    'Use a desktop keyboard and mouse. Press Escape for the field notes and choose Crew to leave.',
    b
  );
  const settings = changes => act({ op: 'settings', ...game.state.settings, ...changes });
  const toolbar = el('div', undefined, 'toolbar');
  toolbar.append(
    button(game.state.settings.sound ? 'Mute sound' : 'Enable gentle sound', () => {
      audio.enable(!game.state.settings.sound);
      settings({ sound: !game.state.settings.sound });
    })
  );
  const range = el('input');
  range.type = 'range';
  range.min = '.25';
  range.max = '3';
  range.step = '.05';
  range.value = game.state.settings.sensitivity;
  range.setAttribute('aria-label', 'Mouse sensitivity');
  range.onchange = () => settings({ sensitivity: Number(range.value) });
  const view = el('select');
  view.setAttribute('aria-label', 'Render distance');
  for (const n of [3, 4, 5]) {
    const option = el(
      'option',
      `${n === 3 ? 'Low' : n === 4 ? 'Balanced' : 'Wide'} view (${(n * 2 + 1) ** 2} chunks)`
    );
    option.value = n;
    view.append(option);
  }
  view.value = game.state.settings.view;
  view.onchange = () => settings({ view: Number(view.value) });
  toolbar.append(el('label', 'Look sensitivity'), range, view);
  content.append(toolbar);
}
const canvas = $('world');
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  failure(new Error('WebGL context lost'));
});
canvas.addEventListener('click', () => {
  if (started && !panel.open && game.state.status === 'alive' && document.pointerLockElement !== canvas)
    lock();
});
canvas.addEventListener('contextmenu', event => event.preventDefault());
canvas.addEventListener('mousedown', event => {
  if (document.pointerLockElement !== canvas || game.paused || game.state.status !== 'alive') return;
  if (event.button === 0) {
    mining = true;
    sendInput();
  }
  if (event.button === 2) act({ op: 'place' }, () => audio.effect('place'));
});
addEventListener('mouseup', () => {
  if (!mining) return;
  mining = false;
  sendInput();
});
addEventListener('mousemove', event => {
  if (document.pointerLockElement !== canvas || game.paused) return;
  const p = game.state.player;
  const yaw = p.yaw - event.movementX * 0.0022 * game.state.settings.sensitivity;
  p.yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  p.pitch = W.clamp(p.pitch - event.movementY * 0.0022 * game.state.settings.sensitivity, -1.49, 1.49);
});
let lastWheel = 0;
canvas.addEventListener(
  'wheel',
  event => {
    if (document.pointerLockElement === canvas) {
      event.preventDefault();
      if (performance.now() - lastWheel > 120) {
        lastWheel = performance.now();
        act({ op: 'select', slot: (game.state.selected + (event.deltaY > 0 ? 1 : 7)) % 8 });
      }
    }
  },
  {
    passive: false
  }
);
addEventListener('keydown', event => {
  if (!started || event.target.matches('input,select,textarea')) return;
  if (/^Digit[1-8]$/.test(event.code)) {
    if (!event.repeat) act({ op: 'select', slot: Number(event.code.slice(-1)) - 1 });
    return;
  }
  if (panel.open) {
    if (event.code === 'Tab') return;
    if (['KeyI', 'KeyB', 'KeyM', 'KeyJ'].includes(event.code)) {
      event.preventDefault();
      openPanel(
        {
          KeyI: 'Pack',
          KeyB: 'Craft',
          KeyM: 'Chart',
          KeyJ: 'Journal'
        }[event.code]
      );
    }
    return;
  }
  if (!started || game.state.status !== 'alive') return;
  if (['Tab', 'KeyI', 'KeyB', 'KeyM', 'KeyJ', 'Escape'].includes(event.code)) {
    event.preventDefault();
    openPanel(
      {
        KeyI: 'Pack',
        KeyB: 'Craft',
        KeyM: 'Chart',
        KeyJ: 'Journal'
      }[event.code] || 'Journal'
    );
    return;
  }
  if (event.repeat) return;
  keys[event.code] = true;
  if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) event.preventDefault();
  if (game.paused) return;
  if (event.code === 'Space') jumpQueued = true;
  if (event.code === 'KeyE') {
    const instrument = D.blocks[game.target()?.id]?.key;
    act({ op: 'use' }, result => {
      audio.effect(
        instrument === 'nightjarChimes'
          ? 'nightjar'
          : ['gramophone', 'reedOrgan'].includes(instrument)
            ? 'music'
            : 'use'
      );
      if (result.chest) openPanel('Pack');
    });
  }
  if (event.code === 'KeyF') act({ op: 'eat' });
  sendInput();
});
addEventListener('keyup', event => {
  delete keys[event.code];
  sendInput();
});
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
      openPanel('Journal');
    }
  }
});
addEventListener('pagehide', () => socket?.disconnect());
let miniSignature = '',
  miniNext = 0;
function hud(now) {
  const s = game.state,
    p = s.player,
    island = game.world.islandAt(p.x, p.y, p.z),
    boat = s.boats.find(b => b.id === p.boat);
  $('location').textContent = boat
    ? 'Under sail · ' + D.items[boat.type].name
    : island?.name || 'The sheltered sea';
  $('coordinates').textContent =
    `${Math.round(p.x)}, ${Math.round(p.z)} · elevation ${Math.floor(p.y)} · day ${1 + Math.floor(s.time / 1200)}`;
  $('health').textContent = `♥ Health ${Math.ceil(p.health)}`;
  $('food').textContent = `◒ Food ${Math.ceil(p.food)}`;
  $('warmth').textContent = `☀ Warmth ${Math.ceil(p.warmth)}`;
  const objective = objectives().find(o => !o[0]);
  $('objectiveText').textContent = objective
    ? `${objective[1]}. ${objective[2]}`
    : 'Your sanctuary is complete. Keep building your own story.';
  const radius = Math.hypot(p.x, p.z);
  $('boundary').hidden = radius < D.C.warning;
  $('boundary').textContent =
    radius > D.C.danger
      ? `DANGER · Turn toward the islands now. Fatal storm in ${Math.max(0, Math.ceil(D.C.border - radius))} m. Crossing sweeps you home.`
      : 'OUTER WATERS · Headwinds slow your sail. Turn toward the islands. Camp return is disabled here.';
  const target = game.target(),
    actor = game.encounters.target();
  $('targetLabel').textContent = actor
    ? `${actor.species.name} · ${s.expedition.creatures[actor.id].health}/3 · hold left click`
    : target
      ? D.blocks[target.id].name +
        (D.blocks[target.id].category ||
        ['berryBush', 'relic', 'skyCoffer', 'tideCoffer'].includes(D.blocks[target.id].key)
          ? ' · E to use'
          : '') +
        (target && D.blocks[target.id].tier > 0 && D.blocks[target.id].tier < 99 ? ' · pick required' : '')
      : game.fishing
        ? `Fishing · ${Math.ceil(game.fishing)}s`
        : '';
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
  if (now >= miniNext) {
    miniNext = now + 750;
    const signature =
      peers.map(o => Math.floor(o.x) + ',' + Math.floor(o.z)).join('/') +
      `:${s.seed}:${Math.floor(p.x)}:${Math.floor(p.z)}:${game.world.revision}:${p.yaw.toFixed(1)}`;
    if (miniSignature !== signature) {
      miniSignature = signature;
      const raster = window.EWChart.raster(game.world, 128, 128, Math.floor(p.x), Math.floor(p.z)),
        ctx = $('miniMap').getContext('2d');
      ctx.putImageData(new ImageData(raster.data, 128, 128), 0, 0);
      for (const o of peers) {
        ctx.fillStyle = o.color;
        ctx.fillRect(62 + Math.floor(o.x) - Math.floor(p.x), 62 + Math.floor(o.z) - Math.floor(p.z), 4, 4);
      }
      ctx.save();
      ctx.translate(64, 64);
      ctx.rotate(-p.yaw);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.moveTo(0, -5);
      ctx.lineTo(3, 4);
      ctx.lineTo(-3, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }
  audio.ambient(s.time, p.y < D.C.sea + 0.5);
}
function sendInput(force = false) {
  if (!started || !socket.connected) return;
  const p = game.state.player;
  const active =
    !game.paused && !panel.open && document.pointerLockElement === canvas && game.state.status === 'alive';
  const bits = [
    keys.KeyW,
    keys.KeyS,
    keys.KeyA,
    keys.KeyD,
    keys.Space || jumpQueued,
    keys.ShiftLeft || keys.ShiftRight,
    keys.KeyC,
    mining
  ];
  const mask = active ? bits.reduce((value, down, n) => (down ? value | (1 << n) : value), 0) : 0;
  const signature = [mask, p.yaw, p.pitch].join(',');
  const now = performance.now();
  if (!force && signature === lastInput && now - sentAt < 200) return;
  socket.emit('input', { seq: ++seq, keys: mask, yaw: p.yaw, pitch: p.pitch });
  jumpQueued = false;
  lastInput = signature;
  sentAt = now;
}
function act(action, success) {
  if (!started || !socket.connected) return;
  sendInput();
  socket.timeout(5000).emit('act', action, (err, result) => {
    if (!started) return;
    if (err) return notice('The harbor has not confirmed that action. Check your pack before retrying.');
    if (!result.ok) return notice(result.message || 'That action is unavailable.');
    success?.(result);
  });
}
function applyFrame(f) {
  if (!game || ended) return;
  const s = game.state;
  pose = f.player;
  for (const key of ['health', 'food', 'warmth', 'boat']) s.player[key] = pose[key];
  Object.assign(s, { time: f.time, status: f.status, disaster: f.disaster, buff: f.buff, boats: f.boats });
  game.mineProgress = f.mining;
  game.fishing = f.fishing;
  const rosterChanged =
    peers.map(p => p.number).join() !== f.peers.map(p => p.number).join() ||
    JSON.stringify(bases) !== JSON.stringify(f.bases);
  peers = f.peers;
  game.peers = peers;
  bases = f.bases;
  game.encounters.actors = f.actors.map(([id, island, x, y, z]) => ({
    id,
    island,
    x,
    y,
    z,
    alive: true,
    home: { x },
    species: D.islands.find(i => i.id === island).species || window.EWActors.mite
  }));
  for (const [x, y, z, id, placed] of f.delta.blocks) {
    game.world.set(x, y, z, id);
    const k = W.key(x, y, z);
    if (placed) s.placed[k] = placed;
    else delete s.placed[k];
  }
  for (const [k, crop] of f.delta.crops) {
    if (crop) s.crops[k] = crop;
    else delete s.crops[k];
  }
  if (f.self) {
    const { skyFinds, chest, stock, ...personal } = f.self;
    Object.assign(s, personal);
    s.sky.finds = skyFinds;
    game.openChest = chest;
    s.harvests = chest ? { ['chest:' + chest]: stock } : {};
  }
  const saved = f.savedAt !== checkpoint;
  checkpoint = f.savedAt;
  $('saveStatus').textContent = checkpoint
    ? 'Saved ' + new Date(checkpoint).toLocaleTimeString()
    : 'Awaiting first checkpoint';
  $('crewTitle').textContent = peers.length + 1 + ' aboard · ' + game.callsign;
  if (panel.open) {
    const movingChart =
      ['Crew', 'Chart'].includes(tab) && performance.now() - lastChart > 1500 && peers.length > 0;
    if (movingChart) lastChart = performance.now();
    const signature = JSON.stringify([
      s.inventory,
      s.hotbar,
      s.selected,
      s.harvests,
      s.settings,
      s.crafted,
      s.discoveries,
      s.expedition.projects
    ]);
    if (uiSignature !== signature || f.delta.blocks.length || rosterChanged || saved || movingChart) {
      if (tab === 'Craft' && refreshCraft) refreshCraft();
      else if (['Pack', 'Crew', 'Chart', 'Portal crossings', 'Camp', 'Help'].includes(tab)) renderPanel();
      uiSignature = signature;
    }
  }
  if (f.notice) notice(f.notice);
  if (s.status === 'disaster' && $('storm').hidden) {
    if (panel.open) panel.close();
    clearInputs();
    $('storm').hidden = false;
    audio.effect('storm');
    if (document.pointerLockElement) document.exitPointerLock();
  } else if (s.status === 'alive' && !$('storm').hidden) {
    $('storm').hidden = true;
    openPanel('Camp');
  }
}
function frame(now) {
  if (ended) return;
  requestAnimationFrame(frame);
  if (!started) return;
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  try {
    const p = game.state.player;
    if (pose) {
      const distance = Math.hypot(pose.x - p.x, pose.y - p.y, pose.z - p.z);
      const blend = distance > 2.5 ? 1 : 1 - Math.exp(-dt * 25);
      for (const axis of ['x', 'y', 'z']) p[axis] += (pose[axis] - p[axis]) * blend;
    }
    const here = game.standingPortal();
    if (portalLatch && here === portalLatch) {
      game.lastPortal = here;
      portalLatch = null;
    }
    if (!portalLatch && !game.paused && game.enteredPortal()) openPanel('Portal crossings');
    if (now - lastHud > 150) {
      hud(now);
      lastHud = now;
    }
    renderer.render(dt);
  } catch (error) {
    failure(error);
  }
}
const reasons = {
  TAKEN_OVER: ['Voyage moved', 'A newer tab or device is now sailing as your character.'],
  MAINTENANCE: [
    'Harbor closed for maintenance',
    'The harbormaster has paused the world. Return after the harbor reopens.'
  ],
  SESSION_ENDED: ['Sign in again', 'Your site session or permission to sail ended.'],
  ROOM_FULL: ['The crew is full', 'Eight sailors are already aboard. Try the harbor again later.'],
  CREW_FULL: ['Berths are full', 'The archipelago has reached its permanent crew limit.'],
  WORLD_BUSY: ['Harbor is changing watch', 'Another server holds the world checkpoint. Try again shortly.'],
  SAVE_UNAVAILABLE: [
    'Harbor checkpoint unavailable',
    'The harbor has stopped play while it recovers its checkpoint.'
  ],
  SERVER_STOPPING: ['Harbor is shutting down', 'Return after the server is available again.'],
  BUSY: ['Harbor connection busy', 'Reopen the harbor for a fresh connection.'],
  INVALID_INPUT: ['Connection ended', 'The harbor closed this connection. Reopen the harbor to join again.']
};
function depart(reason) {
  const message = reasons[reason] || [
    'Connection lost',
    'Reopen the harbor to reconnect at your last server position.'
  ];
  leaveScreen(...message);
}
$('joinGame').onclick = () => {
  if (socket || ended) return;
  document.querySelector('.emberwake-site-nav').hidden = true;
  $('welcome').hidden = true;
  $('loading').hidden = false;
  try {
    socket = window.io('/voyage', {
      path: '/emberwake-online/live',
      transports: ['websocket'],
      autoConnect: false,
      reconnection: false,
      forceNew: true,
      auth: { csrf: document.querySelector('meta[name="csrf-token"]').content }
    });
    socket.on('closed', depart);
    socket.on('disconnect', () => depart());
    socket.on('connect_error', error => depart(error.message));
    socket.on('state', applyFrame);
    socket.on('joined', async snapshot => {
      try {
        myNumber = snapshot.number;
        bases = snapshot.bases;
        game = new G.Game(snapshot.state);
        game.callsign = snapshot.name;
        game.canBuild = (x, z) =>
          !bases.some(
            b =>
              b.number !== myNumber &&
              Math.hypot(Math.floor(x) + 0.5 - b.x, Math.floor(z) + 0.5 - b.z) <=
                window.EWSoundings.baseRadius
          );
        renderer = new Renderer(canvas, game);
        $('loadText').textContent = 'Drawing your landing and the crew’s buildings';
        await renderer.ready;
        if (ended) return;
        started = true;
        $('loading').hidden = true;
        $('hud').hidden = false;
        sender = setInterval(sendInput, 50);
        openPanel('Journal');
        audio.enable(game.state.settings.sound);
        requestAnimationFrame(frame);
      } catch (error) {
        failure(error);
      }
    });
    socket.connect();
  } catch (error) {
    failure(error);
  }
};

$('joinGame').disabled = $('joinGame').dataset.available !== 'true';
