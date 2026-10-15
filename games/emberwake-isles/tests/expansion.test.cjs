const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const D = require('../js/data'), W = require('../js/world'), G = require('../js/game'), S = require('../js/saves'), Chart = require('../js/cartography'), M = require('../js/mesher');
const legacyRaw = fs.readFileSync(require.resolve('./fixtures/v1-save.json'), 'utf8');
const golden = require('./fixtures/v1-terrain.json');
const copy = v => JSON.parse(JSON.stringify(v));
const digest = v => crypto.createHash('sha256').update(v).digest('hex');
class Memory {
  constructor() { this.data = new Map(); }
  getItem(k) { if (this.deny) throw new Error('denied'); return this.data.get(k) || null; }
  setItem(k, v) { if (this.deny || this.fail === k) throw new Error('quota'); this.data.set(k, v); }
  removeItem(k) { this.data.delete(k); }
}
function aim(g, x, y, z) { const o = g.eye(); g.state.player.yaw = Math.atan2(o.x - x, o.z - z); g.state.player.pitch = Math.atan2(y - o.y, Math.hypot(x - o.x, z - o.z)); }
function tick(g, seconds, input = {}) { for (let n = 0; n < seconds * 60; n++) g.step(input, 1 / 60); }
function encounter() {
  const g = new G.Game(); g.paused = false;
  const i = D.islands.find(i => i.enemies);
  Object.assign(g.state.player, { x: i.x - 13.5, z: i.z - 12.5, y: g.world.top(i.x - 13.5, i.z - 12.5) });
  g.encounters.step(0);
  const a = g.encounters.actors[0];
  Object.assign(g.state.player, { x: a.x, z: a.z - 2, y: a.y }); aim(g, a.x, a.y + .5, a.z);
  return { g, a, i };
}
function swing(g, a) { aim(g, a.x, a.y + .5, a.z); g.state.time += .56; return g.encounters.hit(); }
test('all 63 original voxel identities are immutable', () => assert.deepEqual(D.blocks.slice(0, golden.blocks.length).map(b => b.key), golden.blocks));
test('507 frozen v1 chunks across three seeds are byte-identical after expansion', () => {
  for (const [seed, x, z, expected] of golden.chunks) assert.equal(digest(new W.World(seed).generate(x, z)), expected, `${seed}:${x},${z}`);
});
test('full old-map height and biome fingerprints are unchanged for three seeds', () => {
  for (const [seed, expected] of golden.columns) {
    const h = crypto.createHash('sha256');
    for (let z = -512; z < 512; z += 4) for (let x = -512; x < 512; x += 4) h.update(JSON.stringify(W.column(x, z, seed)));
    assert.equal(h.digest('hex'), expected);
  }
});
test('new islands plus noise margins lie outside the entire old square and inside safe sea', () => {
  for (const i of D.islands.slice(5)) {
    assert(Math.abs(i.x) - i.rx * 1.07 > D.legacy.extent);
    assert(Math.hypot(i.x, i.z) + Math.max(i.rx, i.rz) * 1.07 < D.C.warning);
    for (const seed of [0, 12, 741092]) assert(W.column(i.x, i.z, seed).h > 25);
  }
});
test('both new caves expose their required ore, with safe open entrances for ten seeds', () => {
  for (let seed = 0; seed < 10; seed++) {
    const w = new W.World(seed);
    for (const island of D.islands.slice(5)) {
      const c = w.networks.find(c => c.island === island.id), [x, y, z] = c.entrance;
      assert(!w.solid(x, y, z)); assert(w.solid(x, y - 1, z) || w.solid(x, y - 2, z));
      let ore = 0;
      for (const path of c.paths) for (const [px, py, pz] of path) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = -2; dy <= 5; dy++) if (w.get(px + dx, py + dy, pz + dz) === D.ids[island.ore]) ore++;
      assert(ore > 5, `${island.id}, seed ${seed}`);
    }
  }
});
test('v1 migration preserves every existing field and adds only schema and expedition defaults', () => {
  const old = JSON.parse(legacyRaw), migrated = S.decode(legacyRaw), { expedition, ...rest } = migrated;
  assert.deepEqual(rest, { ...old, version: 2 });
  assert.deepEqual(expedition, { projects: { reed: 0, amber: 0 }, defeated: 0, creatures: {} });
  const g = new G.Game(migrated); g.world.unload(665, 220, 1);
  assert.equal(g.world.get(0, 12, 0), D.ids.marble);
  assert.equal(g.world.get(-140, 10, 60), 0);
  assert.deepEqual(g.state.harvests['chest:-209,15,100'], { crystal: 8 });
  assert.equal(g.state.crops['-207,14,100'].ready, 400);
});
test('same storage keys load v1 without writing; first v2 save keeps exact v1 backup', () => {
  const mem = new Memory(), saves = new S.Saves(mem); mem.setItem(saves.key(2), legacyRaw); mem.setItem('unrelated', 'keep');
  const loaded = saves.load(2); assert(loaded.ok); assert.equal(mem.getItem(saves.key(2)), legacyRaw);
  assert(saves.save(2, loaded.state).ok); assert.equal(mem.getItem(saves.key(2, 'backup')), legacyRaw);
  assert.equal(saves.load(2, true).state.version, 2); assert.equal(mem.getItem('unrelated'), 'keep');
});
test('migration write quota failures preserve original primary and backup', () => {
  for (const suffix of ['save', 'backup']) {
    const mem = new Memory(), saves = new S.Saves(mem); mem.setItem(saves.key(1), legacyRaw); mem.setItem(saves.key(1, 'backup'), legacyRaw); mem.fail = saves.key(1, suffix);
    assert(!saves.save(1, saves.load(1).state).ok); assert.equal(mem.getItem(saves.key(1)), legacyRaw); assert.equal(mem.getItem(saves.key(1, 'backup')), legacyRaw);
  }
});
test('old terminal marker still ends voyage after boundary expansion; explicit recovery works', () => {
  const mem = new Memory(), saves = new S.Saves(mem); mem.setItem(saves.key(1), legacyRaw); saves.terminal(1);
  assert.equal(saves.load(1).state.status, 'dead'); assert(!saves.save(1, S.decode(legacyRaw)).ok);
  assert.equal(saves.load(1, false, true).state.status, 'alive'); assert.equal(mem.getItem(saves.key(1)), legacyRaw);
});
test('v1 data is validated under old coordinates, IDs and items before migration', () => {
  const edits = [s => s.player.x = 600, s => s.inventory.jade = 1, s => s.edits['40,0'] = [[4000, 2]], s => s.edits['0,0'] = [[4000, D.ids.jadeTile]], s => s.version = 3, s => s.expedition = {}];
  for (const edit of edits) { const s = JSON.parse(legacyRaw); edit(s); assert.throws(() => S.decode(JSON.stringify(s))); }
});
test('expanded travel, buildings, encounters, nursery timers and restoration round trip', () => {
  const g = new G.Game(S.decode(legacyRaw)); g.state.player.x = 660; g.state.player.z = 220; g.state.player.y = g.world.top(660, 220);
  g.world.set(650, 40, 221, D.ids.bambooPlanter); g.state.placed['650,40,221'] = D.ids.bambooPlanter; g.state.harvests['650,40,221'] = g.state.time + 90;
  g.state.inventory.jade = 4; g.state.discoveries.push('amber'); g.state.expedition.projects.amber = 1; g.state.expedition.defeated = 3;
  g.state.expedition.creatures['amber:0'] = { health: 0, respawn: g.state.time + 300 };
  const restored = S.decode(JSON.stringify(g.snapshot())); assert.deepEqual(restored, g.snapshot());
  assert.equal(new G.Game(restored).world.get(650, 40, 221), D.ids.bambooPlanter);
  for (const change of [s => s.expedition.creatures.evil = { health: 1, respawn: 0 }, s => s.expedition.projects.amber = 3, s => s.expedition.creatures['amber:0'].respawn = s.time + 301, s => s.player.x = 1100]) {
    const bad = copy(restored); change(bad); assert.throws(() => S.validate(bad));
  }
});
test('local and full charts include off-grid player islands and remove them after mining', () => {
  const w = new W.World(), before = Chart.raster(w, 16, 64, 0, 0), local = Chart.color(w, 1, 1);
  w.set(1, 12, 1, D.ids.jadeTile); assert.notDeepEqual(Chart.color(w, 1, 1), local);
  assert.notDeepEqual(Chart.raster(w, 16, 64).data, before.data);
  assert.equal(w.waterAt(1, 11.5, 1), true, 'ocean remains wet below a floating island');
  w.set(1, 12, 1, 0); assert.deepEqual(Chart.raster(w, 16, 64).data, before.data); assert(w.waterAt(1, 11.5, 1));
});
test('mining natural island down to the sea changes chart and water across unload/reload', () => {
  const w = new W.World(), x = -310, z = 5, h = W.column(x, z, w.seed).h;
  const before = Chart.color(w, x, z);
  for (let y = h; y >= D.C.sea; y--) w.set(x, y, z, 0);
  assert(w.mapColumn(x, z).h < D.C.sea); assert.notDeepEqual(Chart.color(w, x, z), before); assert(w.waterAt(x, 11, z));
  w.unload(600, 0, 1); const count = w.chunks.size;
  for (let n = 0; n < 10; n++) Chart.raster(w, 32, 32, x, z);
  assert.equal(w.chunks.size, count);
  assert.deepEqual(Chart.color(new W.World(w.seed, w.serialize()), x, z), Chart.color(w, x, z));
  w.set(x, 12, z, D.ids.log); assert(w.mapColumn(x, z).h >= D.C.sea, 'placed logs also count as land');
});
test('original islands spawn no enemies; Honeycomb has exactly six bounded actors', () => {
  const g = new G.Game(); g.encounters.step(0); assert.equal(g.encounters.actors.length, 0);
  const e = encounter(); assert.equal(e.g.encounters.actors.length, 6); assert(e.g.encounters.actors.every(a => a.alive));
});
test('three barehanded hits defeat a mite atomically, reward once and persist cooldown', () => {
  const { g, a } = encounter();
  assert(swing(g, a)); assert.equal(g.state.expedition.creatures[a.id].health, 2);
  assert(swing(g, a)); assert.equal(g.state.expedition.creatures[a.id].health, 1);
  assert(swing(g, a)); assert.equal(g.state.expedition.defeated, 1); assert.equal(g.state.inventory.fossil, 1); assert(!swing(g, a));
  const clone = new G.Game(S.decode(JSON.stringify(g.snapshot()))); clone.encounters.step(0); assert(!clone.encounters.actors[0].alive);
  clone.state.time += 301; clone.encounters.step(0); assert(clone.encounters.actors[0].alive);
});
test('staff defeats in one hit; empty hotbar weapon gives no unowned bonus', () => {
  for (const owned of [false, true]) { const { g, a } = encounter(); g.state.hotbar[0] = 'bambooStaff'; if (owned) g.state.inventory.bambooStaff = 1; swing(g, a); assert.equal(g.state.expedition.creatures[a.id].health, owned ? 0 : 2); }
});
test('melee reach and solid walls stop attacks; pack-full kill consumes no reward or claim', () => {
  const { g, a } = encounter(); g.state.player.z = a.z - 5; assert(!swing(g, a));
  g.state.player.z = a.z - 2;
  const x = Math.floor(a.x), z = Math.floor(a.z - 1); g.world.set(x, a.y + 1, z, D.ids.plank); g.world.set(x, a.y, z, D.ids.plank);
  assert(!swing(g, a)); g.world.set(x, a.y + 1, z, 0); g.world.set(x, a.y, z, 0);
  g.state.inventory = { log: 999, stone: 801 }; swing(g, a); swing(g, a); swing(g, a);
  assert.equal(g.state.expedition.creatures[a.id].health, 1); assert.equal(g.state.expedition.defeated, 0);
});
test('actors cannot follow into ocean, through walls, beyond home leash or onto other islands', () => {
  const { g, a, i } = encounter();
  assert.equal(g.encounters.homeGround(0, 0, i, a.home), null);
  assert.equal(g.encounters.homeGround(i.x + 85, i.z, i, a.home), null);
  Object.assign(g.state.player, { x: i.x + 90, z: i.z, y: 11.5 });
  for (let n = 0; n < 600; n++) g.encounters.step(.05);
  for (const actor of g.encounters.actors) assert(Math.hypot(actor.x - actor.home.x, actor.z - actor.home.z) <= 13);
  Object.assign(g.state.player, { x: -145, z: 65 }); g.encounters.step(0); assert.equal(g.encounters.actors.length, 0);
});
test('mites cannot kill, attack paused games, or interfere with terminal storm', () => {
  const { g, a } = encounter(); Object.assign(g.state.player, { x: a.x, y: a.y, z: a.z - .8, health: 25 });
  for (let n = 0; n < 20; n++) { g.state.time += 2; g.encounters.step(0); } assert.equal(g.state.player.health, 25);
  g.paused = true; const state = JSON.stringify(g.snapshot()); tick(g, 3, { mine: true }); assert.equal(JSON.stringify(g.snapshot()), state);
  g.state.status = 'disaster'; tick(g, 6.1, { mine: true }); assert.equal(g.state.status, 'dead'); assert.equal(g.state.expedition.defeated, 0);
});
test('restoration gates consume supplies once and unlock useful furnishing recipes', () => {
  const g = new G.Game(), island = D.islands.find(i => i.id === 'reed');
  g.state.discoveries.push('reed'); const recipe = D.recipes.find(r => r.id === 'reedOrgan');
  g.world.set(-207, 14, 100, D.ids.artisans); g.state.placed['-207,14,100'] = D.ids.artisans;
  g.state.inventory = { ...recipe.cost }; assert.match(g.recipeStatus(recipe).reason, /Restore/);
  const before = copy(g.state.inventory); assert(!g.restoreProject(island)); assert.deepEqual(g.state.inventory, before);
  g.state.inventory = { bamboo: 8, rope: 2 }; assert(g.restoreProject(island)); assert.equal(g.state.expedition.projects.reed, 1);
  g.state.inventory = { jade: 4, paper: 3 }; assert(g.restoreProject(island)); assert.equal(g.state.inventory.pearl, 3);
  g.state.inventory = { ...recipe.cost }; assert(g.craft('reedOrgan')); const inv = copy(g.state.inventory); g.restoreProject(island); assert.deepEqual(g.state.inventory, inv);
});
test('apiary requires three defeats before accepting materials; project progression survives load', () => {
  const g = new G.Game(), island = D.islands.find(i => i.id === 'amber'); g.state.inventory = { ochre: 6 };
  assert(!g.restoreProject(island)); assert.equal(g.state.inventory.ochre, 6);
  g.state.expedition.defeated = 3; assert(g.restoreProject(island)); assert.equal(g.state.inventory.fossil, 2);
  assert.equal(S.decode(JSON.stringify(g.snapshot())).expedition.projects.amber, 1);
});
test('nursery is renewable, paused timers do not progress, and harvest drives new cooking', () => {
  const g = new G.Game(); g.paused = false; const p = g.state.player;
  const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z) - 2, k = W.key(x, y, z);
  g.world.set(x, y, z, D.ids.bambooPlanter); g.state.placed[k] = D.ids.bambooPlanter; aim(g, x + .5, y + .5, z + .5);
  g.interact(); assert.equal(g.state.inventory.bambooShoot, 2); g.interact(); assert.equal(g.state.inventory.bambooShoot, 2);
  g.paused = true; tick(g, 91); assert.equal(g.state.time, 0);
  g.paused = false; tick(g, 91); aim(g, x + .5, y + .5, z + .5); g.interact(); assert.equal(g.state.inventory.bambooShoot, 4);
  g.state.inventory.carrot = 1; const station = W.key(x + 2, y, z); g.world.set(x + 2, y, z, D.ids.galley); g.state.placed[station] = D.ids.galley;
  assert(g.craft('shootSoup')); g.state.player.food = 10; assert(g.eat('shootSoup')); assert(g.state.player.food >= 75); assert.equal(g.state.buff, 240);
});
test('atlas grows past 64 slots and all new furnishing shapes have valid mesh UVs', () => {
  assert.equal(D.atlas.height, 176); assert.equal(D.blocks.length, 85);
  for (const b of D.blocks.slice(63)) if (b.shape) assert(M.shapes[b.shape], b.key);
});
test('empty-pack route sails the expansion, mines jade, builds nursery and restores organ stage', () => {
  const g = new G.Game(), controller = {};
  require('./progression.cjs').runProgression(g, D, W, { controller });
  const result = require('./expansion-progression.cjs').runExpansion(g, D, W, controller);
  assert(result.state.discoveries.includes('reed')); assert(result.state.inventory.jade > 0); assert(result.state.inventory.bambooStaff);
  assert.equal(result.state.expedition.projects.reed, 1); assert(result.state.stats.harvest >= 2); assert(result.state.stats.sailed > 1200);
  assert.deepEqual(S.decode(JSON.stringify(result.state)), result.state);
});
test('newly placed or relocated nurseries must grow before harvesting, preventing instant duplication', () => {
  const g = new G.Game(); g.paused = false; g.state.inventory.bambooPlanter = 1; g.state.hotbar[0] = 'bambooPlanter';
  const p = g.state.player, x = Math.floor(p.x), z = Math.floor(p.z) - 2, y = g.world.top(x, z) - 1;
  aim(g, x + .5, y + .9, z + .5); assert(g.place());
  const k = Object.keys(g.state.placed).find(k => g.state.placed[k] === D.ids.bambooPlanter), q = k.split(',').map(Number);
  aim(g, q[0] + .5, q[1] + .5, q[2] + .5); g.interact(); assert(!g.state.inventory.bambooShoot);
  assert.equal(g.state.harvests[k], g.state.time + 90);
  assert.doesNotThrow(() => S.validate(g.snapshot()));
});
test('map surface rebuild batches edited columns per chunk without retaining terrain memory', () => {
  const edits = { '0,0': Array.from({ length: 256 }, (_, n) => [12 * 256 + n, D.ids.bambooPlank]) };
  const w = new W.World(12, edits), generate = w.generate.bind(w); let generated = 0;
  w.generate = (...args) => { generated++; return generate(...args); };
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) assert.equal(w.mapColumn(x, z).h, 12);
  assert.equal(generated, 1); assert.equal(w.chunks.size, 0); assert.equal(w.mapSurfaces.size, 256);
});

test('ocean bridges retain swimming water and cannot conceal an obstructed boat launch', () => {
  const g = new G.Game(); g.paused = false;
  g.world.set(0, 20, 0, D.ids.plank);
  assert(g.world.waterAt(.5, 11.5, .5)); assert(g.world.mapColumn(0, 0).h >= D.C.sea);
  Object.assign(g.state.player, { x: .5, y: 10, z: .5 });
  tick(g, 2); assert(g.state.player.y > 11);
  g.world.set(0, 12, 0, D.ids.plank); g.state.inventory.raft = 1;
  assert(!g.launchBoat('raft')); assert.equal(g.state.boats.length, 0); assert.equal(g.state.inventory.raft, 1);
});
test('import and new-voyage replacement abort on any backup write error, not only quota errors', () => {
  const mem = new Memory(), saves = new S.Saves(mem); mem.setItem(saves.key(1), legacyRaw);
  mem.fail = saves.key(1, 'backup');
  assert(!saves.import(1, legacyRaw).ok); assert.equal(mem.getItem(saves.key(1)), legacyRaw);
  assert(!saves.create(1, G.fresh(42)).ok); assert.equal(mem.getItem(saves.key(1)), legacyRaw);
});
