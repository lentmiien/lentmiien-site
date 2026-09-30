const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/data.js'),
  W = require('../js/world.js'),
  G = require('../js/game.js'),
  S = require('../js/saves.js'),
  M = require('../js/mesher.js');
const {
  C,
  ids: B
} = D;
class Memory {
  constructor() {
    this.data = new Map();
    this.fail = null;
  }
  getItem(k) {
    if (this.fail === 'access') throw new Error('denied');
    return this.data.get(k) || null;
  }
  setItem(k, v) {
    if (this.fail === 'quota' || this.fail === k) {
      const e = new Error('quota exceeded');
      e.name = 'QuotaExceededError';
      throw e;
    }
    this.data.set(k, v);
  }
  removeItem(k) {
    if (this.fail === 'access') throw new Error('denied');
    this.data.delete(k);
  }
}
function fixture() {
  const game = new G.Game();
  game.paused = false;
  return game;
}
function aim(g, x, y, z) {
  const e = g.eye(),
    dx = x - e.x,
    dy = y - e.y,
    dz = z - e.z;
  g.state.player.yaw = Math.atan2(-dx, -dz);
  g.state.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}
function put(g, id, x = -207, y = 14, z = 100) {
  assert(g.world.set(x, y, z, B[id]));
  g.state.placed[W.key(x, y, z)] = B[id];
  return W.key(x, y, z);
}
function step(g, t, input = {}) {
  for (let j = 0; j < Math.ceil(t * 60); j++) g.step(input, 1 / 60);
}
test('catalog has 5 substantial unique biomes, 4 islets and 66 implemented recipes', () => {
  assert.equal(D.islands.length, 5);
  assert.equal(new Set(D.islands.map(i => i.biome)).size, 5);
  assert.equal(D.islets.length, 4);
  assert.equal(D.recipes.length, 66);
  assert(D.islands.every(i => i.rx >= 80 && i.rz >= 75));
  assert.equal(new Set(D.recipes.map(r => r.id)).size, 66);
});
test('same seed gives identical terrain and alternate seeds change relief', () => {
  const a = new W.World(12),
    b = new W.World(12),
    c = new W.World(13);
  assert.deepEqual(a.generate(-10, 4), b.generate(-10, 4));
  assert.notDeepEqual(a.generate(-10, 4), c.generate(-10, 4));
});
test('all island centers stand above sea and channels separate neighbors', () => {
  for (const i of D.islands) assert(W.column(i.x, i.z, 22).h > C.sea + 12);
  for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) {
    const i = D.islands[a],
      j = D.islands[b];
    assert(Math.hypot(i.x - j.x, i.z - j.z) > i.rx + j.rx + 25);
  }
  for (const i of D.islets) assert(W.column(i.x, i.z, 22).h > C.sea);
});
test('spawn is grounded, body-clear and adjacent to food and driftwood for 20 seeds', () => {
  for (let seed = 0; seed < 20; seed++) {
    const g = new G.Game(G.fresh(seed)),
      p = g.state.player;
    assert(!g.collides(p.x, p.y, p.z));
    assert(g.world.solid(p.x, p.y - .1, p.z));
    assert(g.world.starterProps().some(q => Math.hypot(q[0] - p.x, q[2] - p.z) < 8));
  }
});
test('five entrance trails connect all three cave branches and chambers with walkable ramps', () => {
  const world = new W.World(741092);
  for (const cave of world.networks) {
    const all = cave.paths.flat();
    const xmin = Math.floor(Math.min(...all.map(p => p[0]))) - 4,
      xmax = Math.ceil(Math.max(...all.map(p => p[0]))) + 7,
      zmin = Math.floor(Math.min(...all.map(p => p[2]))) - 7,
      zmax = Math.ceil(Math.max(...all.map(p => p[2]))) + 7;
    const start = [Math.floor(cave.entrance[0]), Math.floor(cave.entrance[2])],
      queue = [start],
      seen = new Set([start.join(',')]);
    for (let n = 0; n < queue.length; n++) {
      const [x, z] = queue[n],
        floor = W.caveColumn(x, z, [cave])[0];
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx,
          nz = z + dz,
          k = `${nx},${nz}`;
        if (nx < xmin || nx > xmax || nz < zmin || nz > zmax || seen.has(k)) continue;
        const [f, h] = W.caveColumn(nx, nz, [cave]);
        if (!Number.isFinite(f) || Math.abs(f - floor) > 1) continue;
        assert(h - f >= 3);
        assert([0, B.relic].includes(world.get(nx, f, nz)));
        assert.equal(world.get(nx, f + 1, nz), 0);
        seen.add(k);
        queue.push([nx, nz]);
      }
    }
    assert(queue.length > 300, `${cave.island} has real volume`);
    for (const path of cave.paths) {
      const end = path.at(-1);
      assert(seen.has(`${Math.floor(end[0])},${Math.floor(end[2])}`), `${cave.island} branch reachable`);
    }
    const [x, y, z] = cave.entrance;
    assert.equal(world.get(x, y, z), 0);
    assert.equal(world.get(x, y + 1, z), 0);
    assert.equal(world.get(x, y + 5, z), 0);
  }
});
test('cave walls expose coal, copper, iron and volcanic prism resources', () => {
  const w = new W.World();
  for (const cave of w.networks) {
    const found = new Set();
    for (const path of cave.paths) for (const [x, y, z] of path) for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let yy = y - 2; yy <= y + 5; yy++) found.add(w.get(x + dx, yy, z + dz));
    assert(found.has(B.copperOre));
    assert(found.has(B.ironOre));
    assert(found.has(B.coalOre));
    if (cave.island === 'cinder') assert(found.has(B.crystalOre));
  }
});
test('bounded world prevents bedrock edit and rejects outside coordinates', () => {
  const w = new W.World();
  assert.equal(w.set(0, 0, 0, 0), false);
  assert.equal(w.set(512, 2, 0, B.stone), false);
  assert.equal(w.set(0, 80, 0, B.stone), false);
  assert.equal(w.set(0, 2, 0, 999), false);
  assert.equal(w.set(.1, 2, 0, 0), false);
});
test('modified chunks survive unloading and reconstruct identically', () => {
  const w = new W.World();
  w.set(-201, 20, 86, B.plank);
  w.set(-200, 18, 87, 0);
  const before = w.get(-201, 20, 86);
  w.unload(300, -300, 3);
  assert(!w.chunks.has('-13,5'));
  assert.equal(w.get(-201, 20, 86), before);
  assert.equal(w.get(-200, 18, 87), 0);
  const copy = new W.World(w.seed, w.serialize());
  assert.equal(copy.get(-201, 20, 86), B.plank);
});
test('recipe graph reaches every output from actual natural resources without gate cycles', () => {
  const available = new Set(['log', 'fiber', 'resin', 'seed', 'berry', 'dirt', 'sand', 'clay', 'shell', 'fish', 'pearl', 'carrot', 'grain']),
    stations = new Set(),
    crafts = new Set();
  let tier = 0;
  for (let pass = 0; pass < 12; pass++) {
    for (const b of D.blocks) {
      if (b.tier <= tier && b.tier !== 99 && ['stone', 'copperOre', 'ironOre', 'coalOre', 'crystalOre', 'basalt'].includes(b.key)) available.add(b.drop || b.key);
    }
    for (const r of D.recipes) {
      assert(D.items[r.out]);
      assert(r.count > 0);
      assert(!r.station || D.items[r.station]?.block);
      for (const id of Object.keys(r.cost)) assert(D.items[id]);
      if (Object.keys(r.cost).every(k => available.has(k)) && (!r.station || stations.has(r.station))) {
        available.add(r.out);
        crafts.add(r.id);
        if (D.items[r.out].block) stations.add(r.out);
        tier = Math.max(tier, D.items[r.out].tool || 0);
      }
    }
  }
  assert.deepEqual(D.recipes.filter(r => !crafts.has(r.id)).map(r => r.id), []);
});
test('atomic craft consumes ingredients, yields correct batch output and records progression', () => {
  const g = fixture();
  g.state.inventory = {
    log: 3
  };
  assert(g.craft('plank', 2));
  assert.deepEqual(g.state.inventory, {
    log: 1,
    plank: 8
  });
  assert(g.state.crafted.includes('plank'));
  const old = JSON.stringify(g.state.inventory);
  assert(!g.craft('plank', 2));
  assert.equal(JSON.stringify(g.state.inventory), old);
});
test('craft requires nearby station and discovery independently', () => {
  const g = fixture();
  g.state.inventory = {
    clay: 10,
    coal: 5,
    copper: 10
  };
  assert(!g.craft('tile'));
  const k = put(g, 'kiln');
  assert(!g.craft('tile'));
  g.state.discoveries.push('dunes');
  assert(g.craft('tile'));
  g.state.player.x += 20;
  assert(!g.craft('tile'));
  assert(k);
});
test('all 66 recipes change inventory correctly when their requirements are met', () => {
  for (const r of D.recipes) {
    const g = fixture();
    g.state.inventory = {
      ...r.cost
    };
    g.state.discoveries = D.islands.map(i => i.id);
    if (r.station) put(g, r.station);
    const before = G.total(g.state.inventory);
    assert(g.craft(r.id), r.id);
    assert.equal(g.state.inventory[r.out], r.count);
    assert.equal(G.total(g.state.inventory), before - Object.values(r.cost).reduce((a, b) => a + b, 0) + r.count);
  }
});
test('inventory rejects overflow, negative, unknown and fractional deltas without mutation', () => {
  const inv = {
    log: 999
  };
  for (const delta of [{
    log: 1
  }, {
    log: -1000
  }, {
    noSuchItem: 1
  }, {
    log: .5
  }]) assert.equal(G.change(inv, delta), null);
  assert.deepEqual(inv, {
    log: 999
  });
  assert.equal(G.change({
    log: 999,
    stone: 800
  }, {
    dirt: 2
  }), null);
});
test('stone cannot be mined with hands; correct pick works and wall occludes blocks behind', () => {
  const g = fixture();
  const p = g.state.player;
  g.world.set(-208, 14, 99, B.stone);
  g.world.set(-208, 14, 98, B.copperOre);
  aim(g, -207.5, 14.5, 99.5);
  g.mine(5);
  assert.equal(g.world.get(-208, 14, 99), B.stone);
  g.state.inventory.woodPick = 1;
  g.state.hotbar[0] = 'woodPick';
  assert(g.mine(5));
  assert.equal(g.world.get(-208, 14, 99), 0);
  assert.equal(g.world.get(-208, 14, 98), B.copperOre);
  assert.equal(g.state.inventory.stone, 1);
});
test('ray reach is bounded and first occupied cell controls placement', () => {
  const w = new W.World();
  w.set(0, 30, 0, B.plank);
  w.set(0, 30, -1, B.stone);
  assert.equal(w.ray({
    x: .5,
    y: 30.5,
    z: 7
  }, {
    x: 0,
    y: 0,
    z: -1
  }), null);
  const hit = w.ray({
    x: .5,
    y: 30.5,
    z: 3
  }, {
    x: 0,
    y: 0,
    z: -1
  });
  assert.equal(hit.id, B.plank);
  assert.deepEqual(hit.prev, [0, 30, 1]);
});
test('placement consumes block exactly once and rejects own body', () => {
  const g = fixture(),
    p = g.state.player;
  g.state.inventory.plank = 2;
  g.state.hotbar[0] = 'plank';
  aim(g, p.x, p.y - 1, p.z);
  assert(!g.place());
  assert.equal(g.state.inventory.plank, 2);
  aim(g, -206.5, 12.5, 101.5);
  assert(g.place(), g.message);
  assert.equal(g.state.inventory.plank, 1);
  assert.equal(Object.keys(g.state.placed).length, 1);
});
test('shaped furniture colliders match slab, table legs and air around torch', () => {
  const g = fixture();
  g.world.set(0, 30, 0, B.slab);
  assert(g.collides(.5, 30.45, .5));
  assert(!g.collides(.5, 30.51, .5));
  g.world.set(2, 30, 0, B.torch);
  assert(!g.collides(1.95, 30.8, .5));
});
test('chunk mesher culls interior faces and emits no per-voxel meshes', () => {
  const w = new W.World();
  const arr = new Uint8Array(80 * 256);
  arr[30 * 256 + 8 * 16 + 8] = B.plank;
  arr[30 * 256 + 8 * 16 + 9] = B.plank;
  w.chunks.set('0,0', arr);
  const mesh = M.mesh(w, 0, 0);
  assert.equal(mesh.indices.length, 10 * 6);
  assert.equal(mesh.positions.length, 10 * 12);
  for (const v of mesh.positions) assert(Number.isFinite(v));
});
test('walking collides with terrain, jumping rises and settles', () => {
  const g = fixture();
  step(g, .2);
  const start = {
    ...g.state.player
  };
  step(g, .12, {
    jump: true
  });
  assert(g.state.player.y > start.y + .1);
  step(g, 2);
  assert(Math.abs(g.state.player.y - start.y) < .08);
  assert(!g.collides(g.state.player.x, g.state.player.y, g.state.player.z));
});
test('swimming buoyancy prevents drowning and never has an oxygen timer', () => {
  const g = fixture();
  Object.assign(g.state.player, {
    x: 0,
    y: 9,
    z: 0
  });
  step(g, 10);
  assert(g.state.player.y > 10.5);
  assert.equal(g.state.player.health, 100);
});
test('raft uses actual inventory, moves faster than swim, moors and boards', () => {
  const g = fixture();
  Object.assign(g.state.player, {
    x: 0,
    y: 11.5,
    z: 0,
    yaw: 0
  });
  g.state.inventory.raft = 1;
  g.state.hotbar[0] = 'raft';
  assert(g.place());
  assert.equal(g.state.inventory.raft, undefined);
  assert.equal(g.state.boats.length, 1);
  step(g, 1, {
    forward: true
  });
  assert(g.state.player.z < -13);
  assert(g.state.stats.sailed > 13);
  g.interact();
  assert.equal(g.state.player.boat, null);
  g.interact();
  assert.equal(g.state.player.boat, 1);
});
test('boat cannot drive through a solid shore', () => {
  const g = fixture();
  Object.assign(g.state.player, {
    x: 0,
    y: 11.5,
    z: 0,
    yaw: 0
  });
  g.state.inventory.raft = 1;
  g.state.hotbar[0] = 'raft';
  g.place();
  for (let x = -2; x <= 2; x++) g.world.set(x, 12, -3, B.stone);
  step(g, 2, {
    forward: true
  });
  assert(g.state.player.z > -3);
});
test('hunger and cold are forgiving and cannot cause ordinary game over', () => {
  const g = fixture();
  Object.assign(g.state.player, {
    x: 225,
    z: 65,
    y: 70,
    food: 0,
    warmth: 0,
    health: 25
  });
  step(g, 2);
  assert.equal(g.state.status, 'alive');
  assert(g.state.player.health >= 25);
});
test('food and tea improve status and apply bounded warmth buff', () => {
  const g = fixture();
  g.state.inventory = {
    tea: 1,
    stew: 1
  };
  g.state.player.food = 5;
  assert(g.eat('tea'));
  assert.equal(g.state.buff, 180);
  assert.equal(g.state.player.food, 25);
  assert(g.eat('stew'));
  assert.equal(g.state.player.food, 90);
  assert(!g.eat('stew'));
});
test('renewable bushes harvest without destroying terrain and enforce game-time regrowth', () => {
  const g = fixture();
  const [x, y, z] = g.world.starterProps().find(p => p[3] === B.berryBush);
  Object.assign(g.state.player, {
    x: x + .5,
    y: y,
    z: z + 3
  });
  aim(g, x + .5, y + .4, z + .5);
  g.interact();
  assert.equal(g.state.inventory.berry, 4);
  g.interact();
  assert.equal(g.state.inventory.berry, 4);
  g.state.time += 101;
  g.interact();
  assert.equal(g.state.inventory.berry, 8);
  assert.equal(g.world.get(x, y, z), B.berryBush);
});
test('farming plants, waters, matures and yields renewable seed plus useful food', () => {
  const g = fixture(),
    k = put(g, 'farmland', -208, 14, 100);
  g.state.inventory = {
    seed: 1,
    wateringCan: 1
  };
  aim(g, -207.5, 14.15, 100.5);
  g.interact();
  assert(g.state.crops[k]);
  const first = g.state.crops[k].ready;
  g.state.hotbar[0] = 'wateringCan';
  g.interact();
  assert.equal(g.state.crops[k].ready, first - 40);
  g.interact();
  assert.equal(g.state.crops[k].ready, first - 40);
  g.state.time += 111;
  g.interact();
  assert.equal(g.state.inventory.seed, 2);
  assert.equal(g.state.stats.harvest, 1);
  assert.equal(g.state.inventory.carrot, 3);
});
test('fishing requires low water sight and staying still; fourth catch yields pearl', () => {
  const g = fixture();
  Object.assign(g.state.player, {
    x: 0,
    y: 11.5,
    z: 0,
    yaw: 0,
    pitch: 0
  });
  g.state.inventory.rod = 1;
  g.state.hotbar[0] = 'rod';
  for (let n = 0; n < 4; n++) {
    g.interact();
    step(g, 6.1);
  }
  assert.equal(g.state.inventory.fish, 4);
  assert.equal(g.state.inventory.pearl, 1);
  g.interact();
  g.state.player.x += 3;
  step(g, .1);
  assert.equal(g.fishing, 0);
});
test('chest transfers are atomic, nearby-only, persistent and cannot lose items on mining', () => {
  const g = fixture(),
    k = put(g, 'chest', -208, 14, 100);
  g.state.inventory = {
    log: 10
  };
  assert(g.transfer(k, 'log', 8, true));
  assert.equal(g.state.inventory.log, 2);
  assert.equal(g.state.harvests['chest:' + k].log, 8);
  assert(!g.transfer(k, 'log', 9, false));
  aim(g, -207.5, 14.4, 100.5);
  g.mine(10);
  assert.equal(g.world.get(-208, 14, 100), B.chest);
  assert(g.transfer(k, 'log', 8, false));
  assert.equal(g.state.inventory.log, 10);
});
test('luxury rewards variety and bounded layout/architecture, never cheap duplicates', () => {
  const g = fixture();
  for (let j = 0; j < 80; j++) put(g, 'chair', -215 + j % 10, 14, 95 + Math.floor(j / 10));
  const cheap = g.luxury().points;
  assert(cheap < 30);
  let n = 0;
  for (const b of D.blocks.filter(b => b.category)) {
    put(g, b.key, -214 + n % 8, 14, 95 + Math.floor(n / 8));
    n++;
  }
  assert(g.luxury().points > cheap + 80);
});
test('discovery unlocks island recipes and secrets reward only once', () => {
  const g = fixture(),
    i = D.islands[2],
    x = i.x + 12,
    z = i.z - 10,
    y = W.column(x, z, g.state.seed).h + 1;
  Object.assign(g.state.player, {
    x: x + .5,
    z: z + 3,
    y
  });
  aim(g, x + .5, y + .5, z + .5);
  step(g, .1);
  assert(g.state.discoveries.includes('dunes'));
  g.interact();
  assert(g.state.secrets.includes('dunes'));
  const pearls = g.state.inventory.pearl;
  g.interact();
  assert.equal(g.state.inventory.pearl, pearls);
});
for (const boat of [false, true]) test(`outer boundary is terminal for ${boat ? 'boat' : 'swimmer'} despite pause, UI, returning and reload`, () => {
  const mem = new Memory(),
    saves = new S.Saves(mem),
    g = fixture();
  assert(saves.create(1, g.snapshot()).ok);
  g.journal = () => saves.terminal(1);
  Object.assign(g.state.player, {
    x: 489.9,
    z: 0,
    y: 11.5,
    yaw: -Math.PI / 2
  });
  if (boat) {
    g.state.inventory.raft = 1;
    g.state.hotbar[0] = 'raft';
    assert(g.place());
  }
  step(g, .1, {
    forward: true
  });
  assert.equal(g.state.status, 'disaster');
  g.paused = true;
  g.state.player.x = 0;
  g.interact();
  g.returnCamp();
  assert.equal(g.state.status, 'disaster');
  assert.equal(saves.load(1).state.status, 'dead');
  assert(!saves.save(1, g.snapshot()).ok);
  step(g, 6.1);
  assert.equal(g.state.status, 'dead');
  assert.equal(saves.load(1, false, true).state.status, 'alive');
  assert.equal(saves.load(1).state.status, 'alive');
});
test('crossing fails visibly before transition if terminal journal cannot persist', () => {
  const g = fixture();
  g.journal = () => false;
  Object.assign(g.state.player, {
    x: 489.9,
    z: 0,
    y: 11.5,
    yaw: -Math.PI / 2
  });
  step(g, .2, {
    forward: true
  });
  assert.equal(g.state.status, 'alive');
  assert(g.state.player.x < 490);
  assert(g.saveBlocked);
  assert.match(g.message, /storage/);
});
test('no currents push an idle novice toward the storm', () => {
  const g = fixture();
  Object.assign(g.state.player, {
    x: 440,
    z: 0,
    y: 11
  });
  step(g, 20);
  assert.equal(g.state.player.x, 440);
  assert.equal(g.state.player.z, 0);
});
test('pause freezes farming, fishing, food and time; load has no offline catch-up', () => {
  const g = fixture();
  g.paused = true;
  const before = JSON.stringify(g.snapshot());
  step(g, 20);
  assert.equal(JSON.stringify(g.snapshot()), before);
  const state = S.decode(JSON.stringify(g.snapshot()));
  assert.equal(state.time, g.state.time);
});
test('save round trip retains mining, buildings, farm, vessel, progress and settings', () => {
  const g = fixture();
  g.world.set(-202, 18, 95, 0);
  const k = put(g, 'farmland', -207, 14, 100);
  g.state.crops[k] = {
    type: 'grain',
    ready: 110,
    watered: false
  };
  put(g, 'lantern', -206, 14, 100);
  g.state.inventory = {
    log: 5,
    copperPick: 1
  };
  g.state.discoveries = ['tropic', 'forest'];
  g.state.crafted = ['plank'];
  g.state.settings.sound = true;
  g.state.boats = [{
    id: 1,
    type: 'raft',
    x: 0,
    z: 0,
    yaw: 0
  }];
  const mem = new Memory(),
    saves = new S.Saves(mem);
  assert(saves.save(1, g.snapshot()).ok);
  const loaded = saves.load(1);
  assert(loaded.ok, loaded.error);
  assert.deepEqual(loaded.state, g.snapshot());
  const copy = new G.Game(loaded.state);
  assert.equal(copy.world.get(-206, 14, 100), B.lantern);
  assert.equal(copy.world.get(-202, 18, 95), 0);
});
test('three slots and backups are isolated; unrelated storage is untouched', () => {
  const mem = new Memory(),
    saves = new S.Saves(mem);
  mem.setItem('unrelated', 'keep');
  for (let slot = 1; slot <= 3; slot++) {
    const s = G.fresh(slot);
    s.name = `Camp ${slot}`;
    assert(saves.save(slot, s).ok);
    s.time = 15;
    assert(saves.save(slot, s).ok);
  }
  for (let slot = 1; slot <= 3; slot++) {
    assert.equal(saves.load(slot).state.seed, slot);
    assert.equal(saves.load(slot, true).state.time, 0);
  }
  assert.equal(mem.getItem('unrelated'), 'keep');
});
test('quota during primary write preserves both prior primary and valid backup', () => {
  const mem = new Memory(),
    saves = new S.Saves(mem),
    s = G.fresh();
  assert(saves.save(1, s).ok);
  s.time = 5;
  assert(saves.save(1, s).ok);
  mem.fail = saves.key(1);
  s.time = 10;
  assert(!saves.save(1, s).ok);
  assert.equal(saves.load(1).state.time, 5);
  assert.equal(saves.load(1, true).state.time, 5);
});
test('quota during backup write never replaces primary', () => {
  const mem = new Memory(),
    saves = new S.Saves(mem),
    s = G.fresh();
  saves.save(1, s);
  mem.fail = saves.key(1, 'backup');
  s.time = 10;
  assert(!saves.save(1, s).ok);
  assert.equal(saves.load(1).state.time, 0);
});
test('denied storage produces errors without silent reset', () => {
  const mem = new Memory(),
    saves = new S.Saves(mem);
  mem.fail = 'access';
  assert(!saves.save(1, G.fresh()).ok);
  assert(!saves.load(1).ok);
  assert(saves.inspect(1).error);
});
test('corrupt primary does not overwrite previous valid backup when saving', () => {
  const mem = new Memory(),
    saves = new S.Saves(mem),
    s = G.fresh();
  saves.save(1, s);
  s.time = 2;
  saves.save(1, s);
  mem.setItem(saves.key(1), '{broken');
  assert(!saves.load(1).ok);
  s.time = 3;
  assert(saves.save(1, s).ok);
  assert.equal(saves.load(1, true).state.time, 0);
});
for (const [name, mutate] of [['schema', s => s.version = 99], ['unknown field', s => s.admin = true], ['unknown item', s => s.inventory.fake = 4], ['negative count', s => s.inventory.log = -1], ['fractional count', s => s.inventory.log = 1.5], ['infinite player', s => s.player.x = Infinity], ['outside coordinate', s => s.player.x = 900], ['terminal location as living', s => s.player.x = 500], ['unbounded name', s => s.name = 'x'.repeat(1000)], ['bad voxel ID', s => s.edits = {
  '0,0': [[999, 255]]
}], ['bedrock editing', s => s.edits = {
  '0,0': [[0, 5]]
}], ['duplicate edit', s => s.edits = {
  '0,0': [[300, 5], [300, 6]]
}], ['orphan garden', s => s.crops = {
  '0,20,0': {
    type: 'grain',
    ready: 30,
    watered: false
  }
}], ['orphan chest', s => s.harvests = {
  'chest:0,20,0': {
    log: 1
  }
}], ['orphan boat', s => s.player.boat = 9], ['script item', s => s.hotbar[0] = '<img onerror=alert(1)>'], ['unknown progress', s => s.discoveries = ['fake']], ['unbounded timer', s => s.time = 1e12]]) test('save validation rejects ' + name, () => {
  const s = G.fresh();
  mutate(s);
  assert.throws(() => S.decode(JSON.stringify(s)));
});
test('malformed, null, primitive and oversized imports preserve slot and backup', () => {
  const mem = new Memory(),
    saves = new S.Saves(mem),
    s = G.fresh();
  saves.save(1, s);
  saves.save(1, s);
  const old = mem.getItem(saves.key(1));
  for (const raw of ['{', 'null', '12', '"text"', ' '.repeat(S.MAX + 1)]) {
    assert(!saves.import(1, raw).ok);
    assert.equal(mem.getItem(saves.key(1)), old);
  }
});
test('saved names containing markup remain data, never a rendering context', () => {
  const s = G.fresh();
  s.name = '<img src=x onerror=alert(1)>';
  assert.equal(S.decode(JSON.stringify(s)).name, s.name);
  const fs = require('node:fs');
  const ui = fs.readFileSync(require.resolve('../js/boot.js'), 'utf8');
  assert(!/innerHTML|outerHTML|insertAdjacentHTML|eval\(/.test(ui));
});
test('explicit checkpoint restore does not erase the saved world', () => {
  const mem = new Memory(),
    saves = new S.Saves(mem),
    s = G.fresh();
  saves.save(1, s);
  saves.terminal(1);
  const raw = mem.getItem(saves.key(1));
  const result = saves.load(1, false, true);
  assert(result.ok);
  assert.equal(mem.getItem(saves.key(1)), raw);
  assert.equal(result.state.status, 'alive');
});
test('underground caves below sea level are dry; ocean remains buoyant', () => {
  const g = fixture(),
    c = g.world.networks[0],
    end = c.chamber;
  assert.equal(g.world.waterAt(end[0], end[1] + .1, end[2]), false);
  Object.assign(g.state.player, {
    x: end[0] + .5,
    y: end[1] + .02,
    z: end[2] + .5
  });
  step(g, 2);
  assert(g.state.player.y < 6);
  assert(g.grounded);
  assert(g.world.waterAt(0, 10, 0));
});
test('fresh-start normal-action progression gathers, crafts, mines, sails, farms and cooks', () => {
  const {
    runProgression
  } = require('./progression.cjs');
  const g = fixture();
  const result = runProgression(g, D, W);
  assert(result.state.inventory.copperPick);
  assert(result.state.discoveries.includes('forest'));
  assert(result.state.stats.sailed > 650);
  assert(result.state.stats.harvest > 0);
  assert(result.state.crafted.includes('grilledFish'));
  const storage = new Memory(),
    saves = new S.Saves(storage);
  assert(saves.save(1, result.state).ok);
  const loaded = saves.load(1);
  assert(loaded.ok);
  assert.deepEqual(loaded.state, result.state);
});
test('all authored cave paths are physically walkable both directions across 10 seeds', () => {
  for (let seed = 0; seed < 10; seed++) {
    const g = new G.Game(G.fresh(seed));
    g.paused = false;
    for (const cave of g.world.networks) for (const path of cave.paths) {
      const nodes = [...path, ...path.slice(0, -1).reverse()];
      const [x, y, z] = nodes[0];
      Object.assign(g.state.player, {
        x: x + .5,
        y: y + .01,
        z: z + .5
      });
      g.velocity = 0;
      for (const node of nodes.slice(1)) {
        let reached = false;
        for (let n = 0; n < 1600; n++) {
          const p = g.state.player,
            dx = node[0] + .5 - p.x,
            dz = node[2] + .5 - p.z;
          if (Math.hypot(dx, dz) < .7) {
            reached = true;
            break;
          }
          p.yaw = Math.atan2(-dx, -dz);
          g.step({
            forward: true
          }, 1 / 60);
        }
        assert(reached, `${seed} ${cave.island} ${node}`);
        assert(!g.world.waterAt(g.state.player.x, g.state.player.y, g.state.player.z));
      }
    }
  }
});
test('underground caches are discoverable, persistent and pay only once', () => {
  const g = fixture(),
    c = g.world.networks[0],
    [x, y, z] = c.chamber;
  Object.assign(g.state.player, {
    x: x + .5,
    y: y + .01,
    z: z + .5
  });
  aim(g, x + .5, y + .5, z + 3.5);
  g.interact();
  assert(g.state.caveFinds.includes('tropic'));
  assert.equal(g.state.inventory.pearl, 1);
  g.interact();
  assert.equal(g.state.inventory.pearl, 1);
  const restored = S.decode(JSON.stringify(g.snapshot()));
  assert(restored.caveFinds.includes('tropic'));
});
test('save bounds include legitimate jumps above maximum building height', () => {
  const state = G.fresh(); state.player.y = 81.3;
  assert.equal(S.decode(JSON.stringify(state)).player.y, 81.3);
  state.player.y = 85; assert.throws(() => S.validate(state));
});
test('expired renewable resource timers are pruned during play, keeping saves bounded', () => {
  const g = fixture(); g.state.time = 201; g.state.harvests['-208,13,99'] = 200;
  step(g, .1); assert.equal(g.state.harvests['-208,13,99'], undefined);
});
test('visible warning waters slow vessels, allowing time to turn back before the final line', () => {
  const g = fixture(); Object.assign(g.state.player, { x: 410, y: 11.5, z: 0, yaw: -Math.PI / 2 });
  g.state.inventory.cutter = 1; g.state.hotbar[0] = 'cutter'; assert(g.place());
  step(g, 1, { forward: true }); assert(g.state.player.x < 419);
  g.state.player.yaw = Math.PI / 2; step(g, 2, { forward: true }); assert(g.state.player.x < 405);
  assert.equal(g.state.status, 'alive');
});
test('full packs do not consume unique treasure claims or falsely report successful fishing', () => {
  const g = fixture(), i = D.islands[0], x = i.x + 12, z = i.z - 10, y = W.column(x, z, g.state.seed).h + 1;
  g.state.inventory = { log: 999, stone: 801 };
  Object.assign(g.state.player, { x: x + .5, y, z: z + 3 }); aim(g, x + .5, y + .5, z + .5);
  assert(!g.interact()); assert.equal(g.state.secrets.length, 0); assert.match(g.message, /Pack full/);
  const c = g.world.networks[0], [cx, cy, cz] = c.chamber;
  Object.assign(g.state.player, { x: cx + .5, y: cy + .01, z: cz + .5 }); aim(g, cx + .5, cy + .5, cz + 3.5);
  assert(!g.interact()); assert.equal(g.state.caveFinds.length, 0);
  Object.assign(g.state.player, { x: 0, y: 11.5, z: 0, yaw: 0, pitch: 0 });
  g.state.inventory = { log: 999, stone: 800, rod: 1 }; g.state.hotbar[0] = 'rod';
  g.interact(); step(g, 6.1); assert.equal(g.state.stats.fish, 0); assert.equal(g.state.inventory.fish, undefined); assert.match(g.message, /Pack full/);
});
test('a 12,000-block estate survives bounded JSON storage and world reconstruction', () => {
  const g = fixture();
  for (let x = 0; x < 100; x++) for (let z = 0; z < 120; z++) put(g, (x + z) % 13 === 0 ? 'lantern' : 'plank', x, 20, z);
  const snapshot = g.snapshot(), encoded = JSON.stringify(snapshot);
  assert(encoded.length < S.MAX); assert.equal(Object.keys(snapshot.placed).length, 12000);
  const memory = new Memory(), saves = new S.Saves(memory); assert(saves.save(1, snapshot).ok);
  const restored = saves.load(1); assert(restored.ok); assert.deepEqual(restored.state.placed, snapshot.placed);
  const copy = new G.Game(restored.state);
  for (let x = 0; x < 100; x += 7) for (let z = 0; z < 120; z += 11) assert.equal(copy.world.get(x, 20, z), (x + z) % 13 === 0 ? B.lantern : B.plank);
  copy.world.unload(-300, -300, 3); assert.equal(copy.world.get(99, 20, 119), B.plank);
});
