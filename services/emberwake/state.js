'use strict';

const D = require('../../multiplayer/emberwake/js/data');
const { fresh } = require('../../multiplayer/emberwake/js/game');
const Soundings = require('../../multiplayer/emberwake/js/soundings');
const { column } = require('../../multiplayer/emberwake/js/world');

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CREW = 64;
const MAX_ONLINE = 8;
const SHARED = ['placed', 'crops', 'harvests', 'boats', 'expedition'];
const PERSONAL = [
  'player',
  'inventory',
  'hotbar',
  'selected',
  'discoveries',
  'secrets',
  'caveFinds',
  'crafted',
  'stats',
  'camp',
  'status',
  'disaster',
  'buff',
  'settings',
  'base',
  'salvaged'
];
function fields(obj, names) {
  return Object.fromEntries(names.map(key => [key, obj[key]]));
}
function initial(seed) {
  const s = fresh(seed);
  return { version: 1, seed, time: 0, edits: {}, ...fields(s, SHARED), crew: [] };
}
function personal(s) {
  return { ...fields(s, PERSONAL), skyFinds: s.sky.finds };
}
function valid(value) {
  if (!value) throw Error('Invalid Emberwake checkpoint');
}
function integer(n, low, high) {
  return Number.isSafeInteger(n) && n >= low && n <= high;
}
function finite(n, low, high) {
  return Number.isFinite(n) && n >= low && n <= high;
}
function plain(v) {
  return v && Object.getPrototypeOf(v) === Object.prototype;
}
function exact(obj, names) {
  valid(plain(obj) && Object.keys(obj).length === names.length && names.every(k => Object.hasOwn(obj, k)));
}
function coords(key) {
  valid(typeof key === 'string' && /^-?\d{1,4},\d{1,2},-?\d{1,4}$/.test(key));
  const [x, y, z] = key.split(',').map(Number);
  valid(
    [x, y, z].join(',') === key && integer(x, -1536, 1535) && integer(z, -1536, 1535) && integer(y, 1, 79)
  );
  return [x, y, z];
}
const forbidden = new Set(['bedrock', 'relic', 'skyCoffer', 'tideCoffer']);
function carry(id) {
  return Object.hasOwn(D.items, id) && !forbidden.has(id);
}
function stock(obj, limit = D.C.pack) {
  valid(plain(obj));
  let sum = 0;
  for (const [id, n] of Object.entries(obj)) {
    valid(carry(id) && integer(n, 1, D.C.stack));
    sum += n;
  }
  valid(sum <= limit);
}
function list(arr, allowed) {
  valid(
    Array.isArray(arr) &&
      arr.length <= allowed.length &&
      new Set(arr).size === arr.length &&
      arr.every(x => allowed.includes(x))
  );
}
function position(p) {
  valid(plain(p) && finite(p.x, -1536, 1535.99) && finite(p.y, 0, 84) && finite(p.z, -1536, 1535.99));
}
function validate(s) {
  exact(s, ['version', 'seed', 'time', 'edits', ...SHARED, 'crew']);
  valid(s.version === 1 && integer(s.seed, 0, 2147483647) && finite(s.time, 0, 1e10) && plain(s.edits));
  const edits = new Map();
  for (const [key, cells] of Object.entries(s.edits)) {
    const [cx, cz] = key.split(',').map(Number);
    valid(integer(cx, -96, 95) && integer(cz, -96, 95) && key === cx + ',' + cz && Array.isArray(cells));
    for (const pair of cells) {
      valid(Array.isArray(pair) && pair.length === 2);
      const [index, id] = pair;
      valid(
        integer(index, 256, 20479) && integer(id, 0, D.blocks.length - 1) && !forbidden.has(D.blocks[id].key)
      );
      const cell = [cx * 16 + (index % 16), Math.floor(index / 256), cz * 16 + ((index >> 4) & 15)].join(',');
      valid(!edits.has(cell) && edits.size < D.C.maxEdits);
      edits.set(cell, id);
    }
  }
  valid(plain(s.placed) && Object.keys(s.placed).length <= 12000);
  const markers = new Set();
  for (const [key, id] of Object.entries(s.placed)) {
    coords(key);
    valid(id > 0 && edits.get(key) === id);
    if (id === D.ids.baseMarker) markers.add(key);
  }
  valid(plain(s.crops) && Object.keys(s.crops).length <= 512);
  for (const [key, c] of Object.entries(s.crops)) {
    valid(
      s.placed[key] === D.ids.farmland &&
        plain(c) &&
        ['carrot', 'grain'].includes(c.type) &&
        finite(c.ready, 0, s.time + 111) &&
        typeof c.watered === 'boolean'
    );
  }
  valid(plain(s.harvests) && Object.keys(s.harvests).length <= 16384);
  for (const [key, v] of Object.entries(s.harvests)) {
    if (key.startsWith('chest:')) {
      valid(s.placed[key.slice(6)] === D.ids.chest);
      stock(v, 4000);
      valid(!v.baseMarker);
    } else valid(/^-?\d{1,4},\d{1,2},-?\d{1,4}$/.test(key) && finite(v, 0, s.time + 181));
  }
  valid(
    Array.isArray(s.boats) && s.boats.length <= 64 && new Set(s.boats.map(b => b.id)).size === s.boats.length
  );
  for (const b of s.boats)
    valid(
      integer(b.id, 1, 1e9) &&
        ['raft', 'cutter'].includes(b.type) &&
        finite(b.x, -1536, 1536) &&
        finite(b.z, -1536, 1536) &&
        finite(b.yaw, -Math.PI, Math.PI)
    );
  const e = s.expedition;
  exact(e, ['projects', 'defeated', 'creatures']);
  exact(e.projects, Object.keys(D.projects));
  for (const [id, n] of Object.entries(e.projects)) valid(integer(n, 0, D.projects[id].length));
  valid(integer(e.defeated, 0, 1e10) && plain(e.creatures));
  const actors = D.islands
    .filter(i => i.enemies)
    .flatMap(i => Array.from({ length: 6 }, (_, n) => i.id + ':' + n));
  for (const [id, v] of Object.entries(e.creatures))
    valid(actors.includes(id) && plain(v) && integer(v.health, 0, 3) && finite(v.respawn, 0, s.time + 301));
  valid(Array.isArray(s.crew) && s.crew.length <= MAX_CREW);
  const ids = new Set(),
    numbers = new Set(),
    seats = new Set(),
    ground = D.islands.map(i => i.id),
    salvage = Soundings.sites(s.seed, column).map(f => f.id);
  for (const r of s.crew) {
    exact(r, ['user', 'number', 'data']);
    valid(
      /^[0-9a-f]{24}$/.test(r.user) &&
        !ids.has(r.user) &&
        integer(r.number, 1, MAX_CREW) &&
        !numbers.has(r.number)
    );
    ids.add(r.user);
    numbers.add(r.number);
    const p = r.data;
    exact(p, [...PERSONAL, 'skyFinds']);
    position(p.player);
    position(p.camp);
    valid(finite(p.player.yaw, -Math.PI, Math.PI) && finite(p.player.pitch, -1.5, 1.5));
    for (const key of ['food', 'health', 'warmth']) valid(finite(p.player[key], 0, 100));
    valid(
      ['alive', 'disaster', 'dead'].includes(p.status) && finite(p.disaster, 0, 6.1) && finite(p.buff, 0, 300)
    );
    const boat = p.player.boat;
    if (boat !== null) {
      valid(
        s.boats.some(b => b.id === boat && Math.hypot(b.x - p.player.x, b.z - p.player.z) < 0.2) &&
          !seats.has(boat)
      );
      seats.add(boat);
    }
    stock(p.inventory);
    valid(p.base === null ? p.inventory.baseMarker === 1 : markers.delete(p.base) && !p.inventory.baseMarker);
    valid(
      Array.isArray(p.hotbar) && p.hotbar.length === 8 && p.hotbar.every(carry) && integer(p.selected, 0, 7)
    );
    list(
      p.discoveries,
      D.destinations.map(i => i.id)
    );
    list(p.secrets, ground);
    list(p.caveFinds, ground);
    list(p.salvaged, salvage);
    list(
      p.skyFinds,
      D.sky.sites.flatMap(i => i.vaults.map(v => v.id))
    );
    list(
      p.crafted,
      D.recipes.map(r => r.id)
    );
    exact(p.stats, ['mined', 'placed', 'fish', 'harvest', 'sailed']);
    valid(
      Object.values(p.stats).every(n => finite(n, 0, 1e10)) &&
        plain(p.settings) &&
        typeof p.settings.sound === 'boolean' &&
        finite(p.settings.sensitivity, 0.25, 3) &&
        integer(p.settings.view, 3, 5)
    );
  }
  valid(markers.size === 0 && [...numbers].every(n => n <= numbers.size));
  return s;
}
function encode(s) {
  const raw = JSON.stringify(validate(s));
  valid(Buffer.byteLength(raw) <= MAX_BYTES);
  return raw;
}
function decode(raw) {
  valid(typeof raw === 'string' && Buffer.byteLength(raw) <= MAX_BYTES);
  return validate(JSON.parse(raw));
}
module.exports = {
  fields,
  SHARED,
  PERSONAL,
  initial,
  personal,
  encode,
  decode,
  validate,
  coords,
  carry,
  integer,
  finite,
  plain,
  MAX_BYTES,
  MAX_CREW,
  MAX_ONLINE
};
