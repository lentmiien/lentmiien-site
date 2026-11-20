const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/data');
const { Game } = require('../js/game');
const S = require('../js/saves');

function pad(g, x, z, y = 30) {
  g.world.set(x, y, z, D.ids.portal);
  const id = [x, y, z].join(',');
  g.state.placed[id] = D.ids.portal;
  return id;
}

test('walking or sprinting into a pad opens its chart once per entry', () => {
  for (const sprint of [false, true]) {
    const g = new Game();
    g.paused = false;
    for (let z = -4; z <= 4; z++) g.world.set(0, 29, z, D.ids.stone);
    pad(g, 0, 0);
    Object.assign(g.state.player, { x: .5, y: 30, z: 2.2, yaw: 0 });
    let entries = 0;
    for (let n = 0; n < 55; n++) {
      g.step({ forward: true, sprint }, 1 / 60);
      if (g.enteredPortal()) entries++;
    }
    assert.equal(entries, 1);
  }
});

test('travel rechecks both endpoints, headroom and voyage status, and restores the saved network', () => {
  const g = new Game(), a = pad(g, 0, 0), b = pad(g, 1050, 40), c = pad(g, 1050, 40, 38);
  Object.assign(g.state.player, { x: .5, y: 30.18, z: .5 });
  assert(!g.travelPortal(a));
  assert(!g.travelPortal('0,10,0'));
  g.world.set(1050, 31, 40, D.ids.stone);
  assert(!g.travelPortal(b));
  g.world.set(1050, 31, 40, 0);
  g.state.player.boat = 1;
  assert(!g.travelPortal(b));
  g.state.player.boat = null;
  g.state.status = 'disaster';
  assert(!g.travelPortal(b));
  g.state.status = 'alive';
  assert(g.travelPortal(b));
  assert(!g.enteredPortal());
  const restored = new Game(S.decode(JSON.stringify(g.snapshot())));
  assert.equal(restored.standingPortal(), b);
  assert(!restored.enteredPortal());
  assert(restored.travelPortal(c));
  assert.equal(restored.state.player.y, 38.18);
  restored.state.player.x += 1;
  assert(!restored.travelPortal(a));
});

test('a portal can be crafted, placed, mined and placed again', () => {
  const g = new Game(), p = g.state.player;
  Object.assign(p, { x: .5, y: 30, z: 2.5, yaw: 0, pitch: -Math.atan2(1.63, 2) });
  g.world.set(0, 29, 0, D.ids.stone);
  g.world.set(2, 30, 2, D.ids.bench);
  g.state.placed['2,30,2'] = D.ids.bench;
  g.state.inventory = { glass: 4, copper: 2, stone: 4 };
  assert(g.craft('portal'));
  assert.deepEqual(g.state.inventory, { portal: 1 });
  g.state.hotbar[0] = 'portal'; g.state.selected = 0;
  assert(g.place());
  assert.equal(g.state.placed['0,30,0'], D.ids.portal);
  assert(g.mine(2));
  assert.equal(g.state.placed['0,30,0'], undefined);
  assert.equal(g.state.inventory.portal, 1);
  assert(g.place());
});
