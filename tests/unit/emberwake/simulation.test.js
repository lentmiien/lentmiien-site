const D = require('../../../multiplayer/emberwake/js/data');
const W = require('../../../multiplayer/emberwake/js/world');
const G = require('../../../multiplayer/emberwake/js/game');
const State = require('../../../services/emberwake/state');
const { Simulation } = require('../../../services/emberwake/simulation');
const { validAction, validInput } = require('../../../services/emberwake/protocol');
const alice = 'a'.repeat(24),
  bob = 'b'.repeat(24);

function voyage(seed = 74621) {
  const sea = new Simulation(State.initial(seed));
  return { sea, a: sea.connect(alice), b: sea.connect(bob) };
}
function floor(sea, x, y, z) {
  for (let dx = -3; dx <= 3; dx++)
    for (let dz = -3; dz <= 4; dz++) sea.world.set(x + dx, y - 1, z + dz, D.ids.sand);
}
function look(g, x, y, z) {
  const e = g.eye(),
    dx = x + 0.5 - e.x,
    dy = y + 0.5 - e.y,
    dz = z + 0.5 - e.z;
  Object.assign(g.state.player, { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) });
}
function stand(g, x, y, z) {
  Object.assign(g.state.player, { x, y: y + 0.01, z, boat: null });
  g.velocity = 0;
}
function input(sea, g, keys, now) {
  const p = g.state.player;
  sea.input(g, { seq: g.inputSeq + 1, keys, yaw: p.yaw, pitch: p.pitch }, now);
}
function item(g, id, n = 1) {
  g.state.inventory[id] = n;
  g.state.hotbar[0] = id;
  g.state.selected = 0;
}
function place(sea, g, id, x, y, z) {
  stand(g, x + 0.5, y, z + 2.5);
  look(g, x, y - 1, z);
  item(g, id);
  expect(g.target().prev).toEqual([x, y, z]);
  return sea.action(g, { op: 'place' }).ok;
}
function mine(sea, players, n = 40) {
  for (let t = 0; t < n; t++) {
    const now = (t + 1) * 50;
    for (const p of players) input(sea, p, 128, now);
    sea.tick(0.05, now);
  }
}
test('the first miner to complete earns the only log, resin and edit; crafting consumes that inventory', () => {
  const { sea, a, b } = voyage();
  floor(sea, 100, 61, 0);
  sea.world.set(100, 61, 0, D.ids.log);
  sea.takeDelta();
  stand(a, 100.5, 61, 2.5);
  stand(b, 101.5, 61, 2.5);
  look(a, 100, 61, 0);
  look(b, 100, 61, 0);
  mine(sea, [b], 4);
  mine(sea, [a, b], 25);
  expect(b.state.inventory.log).toBe(1);
  expect(a.state.inventory.log).toBeUndefined();
  expect(b.state.inventory.resin).toBe(1);
  expect(sea.takeDelta().blocks.filter(([x, y, z]) => x === 100 && y === 61 && z === 0)).toEqual([
    [100, 61, 0, 0, 0]
  ]);
  expect(sea.action(b, { op: 'craft', item: 'plank', count: 1 }).ok).toBe(true);
  expect(b.state.inventory.log).toBeUndefined();
  expect(b.state.inventory.plank).toBeGreaterThan(0);
  expect(sea.action(a, { op: 'craft', item: 'plank', count: 1 }).ok).toBe(false);
  expect(State.decode(sea.checkpoint()).crew).toHaveLength(2);
});
test('an equipped faster tool may finish first after joining a mining race late', () => {
  const { sea, a, b } = voyage();
  floor(sea, 100, 61, 0);
  sea.world.set(100, 61, 0, D.ids.log);
  stand(a, 100.5, 61, 2.5);
  stand(b, 101.5, 61, 2.5);
  look(a, 100, 61, 0);
  look(b, 100, 61, 0);
  const axe = Object.keys(D.items).find(k => D.items[k].axe);
  item(b, axe);
  mine(sea, [a], 2);
  mine(sea, [a, b], 20);
  expect(b.state.inventory.log).toBe(1);
  expect(a.state.inventory.log).toBeUndefined();
});
test('personal receipt and the exact reward for every new coffer survive departure and reload', () => {
  const { sea, a, b } = voyage();
  for (const site of sea.world.soundings) {
    const [x, y, z] = site.chest;
    for (const g of [a, b]) {
      stand(g, x + 0.5, y, z + 1.5);
      look(g, x, y, z);
      expect(g.target().id).toBe(D.ids.tideCoffer);
      const before = { ...g.state.inventory };
      expect(sea.action(g, { op: 'use' }).ok).toBe(true);
      for (const [id, count] of Object.entries(site.loot))
        expect(g.state.inventory[id]).toBe((before[id] || 0) + count);
      expect(sea.action(g, { op: 'use' }).ok).toBe(false);
    }
  }
  expect(a.state.inventory).toEqual(b.state.inventory);
  sea.disconnect(alice);
  const restored = new Simulation(State.decode(sea.checkpoint()));
  expect(restored.connect(alice).state.salvaged).toHaveLength(5);
  expect(restored.connect(bob).state.inventory).toEqual(a.state.inventory);
});
test.each([1, 74621, 2147483646])(
  'all three drowned treasures have a continuous swimmable entrance under an intact roof, seed %i',
  seed => {
    const { sea, a } = voyage(seed);
    expect(sea.world.soundings).toHaveLength(5);
    for (const site of sea.world.soundings.filter(s => s.flooded)) {
      const path = [];
      for (let x = -22; x <= 0; x++) path.push([x, 3]);
      for (let z = 2; z >= -4; z--) path.push([0, z]);
      for (const [dx, dz] of path) {
        const x = site.x + dx + 0.5,
          z = site.z + dz + 0.5;
        expect(a.collides(x, 6.01, z)).toBe(false);
        expect(sea.world.waterAt(x, 6.01, z)).toBe(true);
      }
      expect(sea.world.solid(site.x, 8, site.z - 2)).toBe(true);
      expect(sea.world.get(...site.chest)).toBe(D.ids.tideCoffer);
    }
  }
);
test('a shared chest supports concurrent viewers, a single withdrawal and reach checks after opening', () => {
  const { sea, a, b } = voyage();
  floor(sea, 100, 61, 0);
  expect(place(sea, a, 'chest', 100, 61, 0)).toBe(true);
  stand(b, 101.5, 61, 2.5);
  for (const g of [a, b]) {
    look(g, 100, 61, 0);
    expect(sea.action(g, { op: 'use' }).chest).toBe('100,61,0');
  }
  item(a, 'plank', 3);
  const command = { op: 'transfer', item: 'plank', count: 3 };
  expect(sea.action(a, { ...command, deposit: true }).ok).toBe(true);
  expect(sea.frame(b, sea.takeDelta(), 0).self.stock).toEqual({ plank: 3 });
  expect(sea.action(b, { ...command, deposit: false }).ok).toBe(true);
  expect(sea.action(a, { ...command, deposit: false }).ok).toBe(false);
  expect(a.state.inventory.plank).toBeUndefined();
  expect(b.state.inventory.plank).toBe(3);
  expect(sea.action(b, { ...command, deposit: true }).ok).toBe(true);
  stand(b, 106.5, 61, 2.5);
  expect(sea.action(b, { ...command, deposit: false }).ok).toBe(false);
  expect(sea.frame(b, sea.takeDelta(), 0).self.stock).toEqual({});
  expect(sea.joined(a).state.harvests).toEqual({});
  expect(State.decode(sea.checkpoint()).harvests['chest:100,61,0']).toEqual({ plank: 3 });
});
test('pennant ownership protects a cylinder and stations, remains offline, and can be reclaimed', () => {
  const { sea, a, b } = voyage();
  floor(sea, 100, 61, 0);
  floor(sea, 150, 61, 0);
  expect(place(sea, a, 'baseMarker', 100, 61, 0)).toBe(true);
  expect(a.state.inventory.baseMarker).toBeUndefined();
  expect(place(sea, a, 'bench', 99, 61, 0)).toBe(true);
  expect(a.stations().has('bench')).toBe(true);
  stand(b, 101.5, 61, 2.5);
  look(b, 100, 61, 0);
  expect(b.stations().has('bench')).toBe(false);
  expect(sea.action(b, { op: 'use' }).ok).toBe(false);
  mine(sea, [b], 32);
  expect(sea.world.get(100, 61, 0)).toBe(D.ids.baseMarker);
  expect(place(sea, b, 'plank', 150, 61, 0)).toBe(false);
  expect(sea.canBuild(b.crew.number, 164, 0)).toBe(false);
  expect(sea.canBuild(b.crew.number, 165, 0)).toBe(true);
  sea.disconnect(alice);
  const next = new Simulation(State.decode(sea.checkpoint()));
  const owner = next.connect(alice);
  expect(next.canBuild(b.crew.number, 100, 0)).toBe(false);
  stand(owner, 100.5, 61, 2.5);
  look(owner, 100, 61, 0);
  mine(next, [owner], 32);
  expect(owner.state.base).toBe(null);
  expect(owner.state.inventory.baseMarker).toBe(1);
  expect(next.canBuild(b.crew.number, 100, 0)).toBe(true);
  expect(State.decode(next.checkpoint()).crew).toHaveLength(2);
});
test('treasure reserves include sky vaults, underground caches and drowned coffers at every elevation; bases may not overlap', () => {
  const { sea, a, b } = voyage();
  expect(sea.treasures.length).toBe(31);
  for (const site of sea.treasures) {
    const x = Math.floor(site.x),
      z = Math.floor(site.z);
    floor(sea, x, 75, z);
    expect(place(sea, a, 'baseMarker', x, 75, z)).toBe(false);
    expect(a.state.base).toBe(null);
  }
  floor(sea, 100, 61, 0);
  floor(sea, 197, 61, 0);
  expect(place(sea, a, 'baseMarker', 100, 61, 0)).toBe(true);
  expect(place(sea, b, 'baseMarker', 197, 61, 0)).toBe(false);
  expect(b.message).toMatch(/128/);
});
test('shared portals carry visitors inside a protected base; storm and interrupted storm respawn at the personal pennant', () => {
  const { sea, a, b } = voyage();
  floor(sea, 100, 61, 0);
  floor(sea, -100, 61, -90);
  expect(place(sea, a, 'baseMarker', 100, 61, 0)).toBe(true);
  expect(place(sea, a, 'portal', 102, 61, 0)).toBe(true);
  expect(place(sea, b, 'portal', -100, 61, -90)).toBe(true);
  stand(b, -99.5, 61.175, -89.5);
  expect(sea.action(b, { op: 'travel', exit: '102,61,0' }).ok).toBe(true);
  expect(b.state.player.x).toBe(102.5);
  expect(sea.canBuild(b.crew.number, 102, 0)).toBe(false);
  for (const interrupted of [false, true]) {
    stand(a, D.C.border + 0.2, 12, 0);
    a.crossBoundary(a.state.player.x, 0);
    expect(a.state.status).toBe('disaster');
    if (interrupted) {
      sea.disconnect(alice);
      const restored = new Simulation(State.decode(sea.checkpoint())).connect(alice);
      expect(restored.state.status).toBe('alive');
      expect(restored.state.player.x).toBeCloseTo(100.5);
    } else {
      for (let i = 0; i < 122; i++) sea.tick(0.05, i * 50);
      expect(a.state.player.x).toBeCloseTo(100.5);
      expect(a.state.status).toBe('alive');
    }
  }
});
test('another player is visible but cannot be struck or entombed with a placement; only one pilot can board a vessel', () => {
  const { sea, a, b } = voyage();
  floor(sea, 100, 61, 0);
  stand(b, 100.5, 61, 0.5);
  stand(a, 100.5, 61, 2.5);
  look(a, 100, 60, 0);
  item(a, 'plank');
  expect(sea.action(a, { op: 'place' }).ok).toBe(false);
  expect(a.message).toMatch(/standing/);
  mine(sea, [a], 8);
  expect(b.state.player.health).toBe(100);
  const frame = sea.frame(a, sea.takeDelta(), 0);
  expect(frame.peers[0].name).toBe('Tern');
  expect(frame.peers[0].inventory).toBeUndefined();
  expect(JSON.stringify(frame)).not.toContain(bob);
  for (const p of [a, b]) stand(p, 610, 12, 100);
  item(a, 'raft');
  expect(sea.action(a, { op: 'place' }).ok).toBe(true);
  expect(sea.action(b, { op: 'use' }).ok).toBe(false);
  expect(b.state.player.boat).toBe(null);
  sea.disconnect(alice);
  expect(sea.action(b, { op: 'use' }).ok).toBe(true);
});
test('bounded input accepts intents and rejects state, target coordinates, invalid catalog IDs or counts', () => {
  expect(validInput({ seq: 1, keys: 255, yaw: 0, pitch: 0 })).toBe(true);
  for (const p of [{ keys: -1 }, { yaw: NaN }, { pitch: 5 }, { x: 100 }, { seq: 0 }])
    expect(validInput({ seq: 1, keys: 0, yaw: 0, pitch: 0, ...p })).toBe(false);
  for (const p of [
    { op: 'place', x: 0 },
    { op: 'assign', slot: 0, item: '__proto__' },
    { op: 'craft', item: 'plank', count: 21 },
    { op: 'travel', exit: 123 },
    { op: 'transfer', item: 'log', deposit: false, count: -1 },
    { op: 'damage' },
    { op: 'resume' }
  ])
    expect(validAction(p)).toBe(false);
});
test('checkpoint validation bounds edits, amounts, claims and shape; restarted world is deterministic', () => {
  const { sea, a } = voyage();
  const snapshot = State.decode(sea.checkpoint());
  expect(new Simulation(snapshot).world.networks).toEqual(sea.world.networks);
  expect(() => State.decode('bad')).toThrow();
  expect(() => State.decode(' '.repeat(State.MAX_BYTES + 1))).toThrow();
  for (const change of [
    s => (s.crew[0].data.inventory.stone = -1),
    s => (s.crew[0].data.salvaged = ['bad']),
    s => (s.crew[0].data.base = '100,1,0'),
    s => (s.crew[0].data.player.x = 99999),
    s => (s.edits = { '0,0': [[555, D.ids.tideCoffer]] }),
    s => (s.crew[0].data.inventory.baseMarker = 2),
    s => (s.crew[1].user = alice)
  ]) {
    const copy = JSON.parse(JSON.stringify(snapshot));
    change(copy);
    expect(() => State.decode(JSON.stringify(copy))).toThrow();
  }
  expect(a.state.inventory).toEqual({ baseMarker: 1 });
});

test('restarting from an active checkpoint moors the last pilot’s raft for the first returning sailor', () => {
  const { sea, a, b } = voyage();
  for (const g of [a, b]) stand(g, 610, 12, 100);
  item(a, 'raft');
  expect(sea.action(a, { op: 'place' }).ok).toBe(true);
  const snapshot = State.decode(sea.checkpoint());
  expect(snapshot.crew[0].data.player.boat).toBe(1);
  const restarted = new Simulation(snapshot),
    first = restarted.connect(bob);
  expect(restarted.action(first, { op: 'use' }).ok).toBe(true);
  expect(State.decode(restarted.checkpoint()).crew[0].data.player.boat).toBe(null);
  const prior = restarted.connect(alice);
  expect(prior.state.player.x).toBe(610);
  expect(restarted.action(prior, { op: 'use' }).ok).toBe(false);
});

test('legacy surface, cave and sky treasures each pay both sailors once, independently of shared restoration stages', () => {
  const { sea, a, b } = voyage(),
    island = D.islands.find(i => i.id === 'reed');
  const cx = island.x + 12,
    cz = island.z - 10;
  const c = sea.world.networks.find(n => n.island === 'forest').chamber;
  const [sky] = sea.world.sky.vaults.keys();
  const points = [[cx, sea.world.surfaceHeight(cx, cz) + 1, cz], [c[0], c[1], c[2] + 3], W.decodeKey(sky)];
  for (const g of [a, b]) {
    for (const [x, y, z] of points) {
      const id = sea.world.get(x, y, z);
      expect([D.ids.skyCoffer, D.ids.relic]).toContain(id);
      // These older structures have independently tested entrances. Isolate their receipt policy.
      g.target = () => ({ id, x, y, z });
      expect(sea.action(g, { op: 'use' }).ok).toBe(true);
      const balance = { ...g.state.inventory };
      sea.action(g, { op: 'use' });
      expect(g.state.inventory).toEqual(balance);
    }
  }
  expect(a.state.inventory).toEqual(b.state.inventory);
  expect(
    State.decode(sea.checkpoint()).crew.every(
      r => r.data.skyFinds.length === 1 && r.data.caveFinds.length === 1 && r.data.secrets.length === 1
    )
  ).toBe(true);
});

test('a full pack leaves a salvage receipt available, and the updated local chart reflects a mined reef fin', () => {
  const { sea, a } = voyage(),
    site = sea.world.soundings[0],
    [x, y, z] = site.chest;
  stand(a, x + 0.5, y, z + 1.5);
  look(a, x, y, z);
  a.state.inventory.pearl = D.C.stack;
  expect(sea.action(a, { op: 'use' }).ok).toBe(false);
  expect(a.state.salvaged).toEqual([]);
  delete a.state.inventory.pearl;
  expect(sea.action(a, { op: 'use' }).ok).toBe(true);
  const [dx, dz, top] = site.fins[0],
    wx = site.x + dx,
    wz = site.z + dz;
  expect(sea.world.mapColumn(wx, wz).h).toBe(top);
  for (let h = top; h >= D.C.sea; h--) sea.world.set(wx, h, wz, 0);
  expect(sea.world.mapColumn(wx, wz).h).toBeLessThan(D.C.sea);
});

test('zero health also restores the owner at their pennant with their inventory', () => {
  const { sea, a } = voyage();
  floor(sea, 100, 61, 0);
  expect(place(sea, a, 'baseMarker', 100, 61, 0)).toBe(true);
  stand(a, 40, 12, 90);
  a.state.inventory.shell = 3;
  a.state.player.health = 0;
  sea.tick(0.05, 50);
  expect(a.state.player.health).toBe(100);
  expect(a.state.player.x).toBeCloseTo(100.5);
  expect(a.state.inventory.shell).toBe(3);
});

test('a boat crossing commits the storm and leaves a recoverable shared vessel even on immediate disconnect', () => {
  const { sea, a } = voyage();
  stand(a, D.C.border - 0.05, 12, 0);
  item(a, 'raft');
  expect(sea.action(a, { op: 'place' }).ok).toBe(true);
  a.state.player.yaw = -Math.PI / 2;
  input(sea, a, 1, 100);
  sea.tick(0.05, 100);
  expect(a.state.status).toBe('disaster');
  expect(a.state.player.boat).toBe(null);
  expect(Math.hypot(sea.shared.boats[0].x, sea.shared.boats[0].z)).toBeCloseTo(D.C.warning + 8);
  sea.disconnect(alice);
  const next = new Simulation(State.decode(sea.checkpoint()));
  const sailor = next.connect(alice);
  expect(sailor.state.status).toBe('alive');
  expect(sailor.state.player.x).toBeCloseTo(next.world.spawn().x);
  expect(next.shared.boats).toHaveLength(1);
});
