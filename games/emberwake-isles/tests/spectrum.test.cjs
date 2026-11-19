const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const D = require('../js/data'), W = require('../js/world'), G = require('../js/game'), S = require('../js/saves');
const voyage = require('./fixtures/v2-voyage.json');
const shores = D.islands.filter(i => i.shades);

test('Outer Gardens voyage and 1,849 prior terrain chunks survive the expansion', () => {
  assert.deepEqual(S.decode(JSON.stringify(voyage)), { ...voyage, version: 3 });
  const w = new W.World(voyage.seed), h = crypto.createHash('sha256');
  for (let z = -64; z < 64; z += 3) for (let x = -64; x < 64; x += 3) {
    h.update(w.generate(x, z)); w.chunks.clear();
  }
  assert.equal(h.digest('hex'), fs.readFileSync(require.resolve('./fixtures/v2-sha256.txt'), 'utf8').trim());
  assert.equal(shores.length, 4);
  for (const i of shores) {
    assert(Math.max(Math.abs(i.x) - i.rx * 1.07, Math.abs(i.z) - i.rz * 1.07) > D.gardens.extent);
    assert(Math.hypot(i.x, i.z) + Math.max(i.rx, i.rz) * 1.07 < D.C.warning);
  }
});
test('historical validation retains the released pack, island, actor and terrain bounds', () => {
  for (const mutate of [s => s.inventory.plank = 1000, s => s.inventory.irisPigment = 1, s => s.edits['80,0'] = [[1024, 2]],
    s => s.expedition.creatures['poppy:1'] = { health: 2, respawn: 0 }, s => s.discoveries.push('iris'), s => s.hotbar[0] = 'fernStone2']) {
    const bad = structuredClone(voyage); mutate(bad); assert.throws(() => S.validate(bad));
  }
});
test('large sculpture supplies save, transfer to a chest and obey individual and total limits', () => {
  const g = new G.Game(S.decode(JSON.stringify(voyage)));
  g.state.inventory = { irisStone1: 12000, fernStone0: 12000 };
  const k = '-209,15,100'; g.state.harvests['chest:' + k] = {};
  assert(g.transfer(k, 'irisStone1', 4000, true)); assert(!g.transfer(k, 'irisStone1', 1, true));
  assert.deepEqual(S.decode(JSON.stringify(g.snapshot())), g.snapshot());
  assert(g.transfer(k, 'irisStone1', 4000, false)); assert(!g.give({ poppyPigment: 1 }));
  for (const inventory of [{ irisStone1: 12001 }, { irisStone1: 12000, fernStone0: 12000, log: 1 }]) {
    assert.throws(() => S.validate({ ...g.snapshot(), inventory }));
  }
});

function aim(g, x, y, z) {
  const eye = g.eye();
  g.state.player.yaw = Math.atan2(eye.x - x, eye.z - z);
  g.state.player.pitch = Math.atan2(y - eye.y, Math.hypot(x - eye.x, z - eye.z));
}
for (const i of shores) test(i.name + ' exposes five reusable surface colors, pigment and its own weak species', () => {
  const g = new G.Game(S.decode(JSON.stringify(voyage))); g.paused = false;
  const samples = new Map(), freq = new Map();
  for (let x = i.x - 65; x < i.x + 65; x += 2) for (let z = i.z - 60; z < i.z + 60; z += 2) {
    const h = W.column(x, z, g.state.seed).h, id = D.blocks[g.world.get(x, h, z)].key;
    freq.set(id, (freq.get(id) || 0) + 1);
    if (g.world.get(x, h + 1, z) === 0) samples.set(id, [x, h, z]);
  }
  for (const key of [...i.shades, i.ore]) {
    assert(freq.get(key) > (key === i.ore ? 10 : 100), key);
    const [x, y, z] = samples.get(key);
    assert.equal(g.world.mapColumn(x, z).color, D.blocks[D.ids[key]].color);
    Object.assign(g.state.player, { x: x + .5, y: y + 1.01, z: z + .5 }); g.state.player.pitch = -1.48; g.state.player.yaw = 0;
    g.state.hotbar[0] = key === i.ore ? 'ironPick' : 'log'; g.state.selected = 0;
    assert.equal(g.target().id, D.ids[key]); assert(g.mine(2)); assert(g.state.inventory[D.blocks[D.ids[key]].drop || key]);
    if (key !== i.ore) {
      g.state.hotbar[0] = key;
      // Place against a side face from the freshly cut recess.
      Object.assign(g.state.player, { x: x + .5, y: y + 1.1, z: z + 2.5 });
      aim(g, x + .5, y - .1, z + .5);
      const hit = g.target();
      assert(hit); assert(g.place(), g.message);
      assert.equal(g.world.get(...hit.prev), D.ids[key]);
    }
  }
  Object.assign(g.state.player, { x: i.x, z: i.z, y: g.world.top(i.x, i.z) });
  g.encounters.step(0); const actor = g.encounters.actors[0];
  assert.equal(actor.species.name, i.creature); assert.equal(g.encounters.actors.length, 6);
  Object.assign(g.state.player, { x: actor.x, y: actor.y, z: actor.z - 2 }); aim(g, actor.x, actor.y + .5, actor.z);
  g.state.hotbar[0] = 'log';
  for (let n = 0; n < 3; n++) { g.state.time += .6; assert(g.encounters.hit()); }
  assert(!actor.alive); assert.equal(g.state.expedition.defeated, voyage.expedition.defeated);
  assert(g.state.inventory[i.id + 'Pigment'] >= 3);
  const restored = S.decode(JSON.stringify(g.snapshot())); assert.equal(restored.expedition.creatures[actor.id].health, 0);
  Object.assign(g.state.player, { x: 0, z: 0 }); g.encounters.step(0); assert.equal(g.encounters.actors.length, 0);
});
