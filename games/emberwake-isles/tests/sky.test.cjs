const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const D = require('../js/data');
const W = require('../js/world');
const { Game, fresh } = require('../js/game');
const S = require('../js/saves');
const chart = require('../js/cartography');
const { climbFromSea } = require('./sky-climb.cjs');
const balcony = require('./fixtures/v3-balcony.json');

function look(g, x, y, z) {
  const eye = g.eye();
  g.state.player.yaw = Math.atan2(eye.x - x, eye.z - z);
  g.state.player.pitch = Math.atan2(y - eye.y, Math.hypot(x - eye.x, z - eye.z));
}
function ticks(g, count, input = {}) {
  for (let i = 0; i < count; i++) g.step(input, 1 / 60);
}
const oldHash = fs.readFileSync(require.resolve('./fixtures/v3-sky-sectors-sha256.txt'), 'utf8').trim();
test('338 sector chunks preserve every released solid and old seabed at the original map and storm bounds', () => {
  const w = new W.World(741092), h = crypto.createHash('sha256'), current = crypto.createHash('sha256');
  assert.deepEqual([D.C.extent, D.C.height, D.C.sea, D.C.warning, D.C.danger, D.C.border], [1536, 80, 12, 1380, 1450, 1500]);
  for (const [x, z] of [[852,-804],[-488,504]]) for (let dz = -6; dz <= 6; dz++) for (let dx = -6; dx <= 6; dx++) {
    const cells = w.generate(Math.floor(x / 16) + dx, Math.floor(z / 16) + dz);
    current.update(cells);
    h.update(cells.map(id => id >= 127 ? 0 : id));
    w.chunks.clear();
  }
  assert.equal(h.digest('hex'), oldHash);
  assert.equal(current.digest('hex'), fs.readFileSync(require.resolve('./fixtures/v4-sky-sectors-sha256.txt'), 'utf8').trim());
  assert.equal(D.ids.portal, 126);
});

test('a released balcony, pad, player, camp and inventory survive migration and remain a valid v4 checkpoint', () => {
  const state = S.decode(JSON.stringify(balcony)), { sky, version, ...fields } = state;
  assert.deepEqual({ ...fields, version: 3 }, balcony);
  assert.equal(version, 4);
  assert.deepEqual(sky, { berths: [1, 0], clear: [], finds: [] });
  const g = new Game(state);
  assert.equal(g.standingPortal(), '852,50,-804');
  assert.deepEqual(g.state.player, balcony.player);
  assert.equal(g.world.get(852, 51, -804), 0);
  assert(!g.collides(g.state.player.x, g.state.player.y, g.state.player.z));
  assert.equal(g.world.sky.sites[0].x, 708);
  g.world.sky.prepare(); assert.equal(g.world.sky.vaults.size, 4);
  assert.deepEqual(S.decode(JSON.stringify(g.snapshot())), g.snapshot());
});

test('crowded former airspace keeps clearance around buildings and still has both islands and four recoverable coffers', () => {
  const old = structuredClone(balcony);
  for (const site of D.sky.sites) for (let i = 0; i < D.sky.moorings.length; i++) {
    const pos = D.sky.moor(site, i);
    const x = pos.x - 20, z = pos.z - 9, y = site.base + 1;
    const key = Math.floor(x / 16) + ',' + Math.floor(z / 16);
    (old.edits[key] ||= []).push([y * 256 + (z & 15) * 16 + (x & 15), D.ids.stone]);
    old.placed[[x, y, z].join(',')] = D.ids.stone;
  }
  const state = S.decode(JSON.stringify(old)), g = new Game(state);
  assert(state.sky.clear.length > 0);
  for (const [key, id] of Object.entries(old.placed)) {
    const [x, y, z] = W.decodeKey(key);
    assert.equal(g.world.get(x,y,z), id);
    if (id === D.ids.stone) assert.equal(g.world.get(x,y+2,z), 0);
  }
  g.world.sky.prepare(); assert.equal(g.world.sky.vaults.size, 4);
  for (const key of g.world.sky.vaults.keys()) assert.equal(g.world.get(...W.decodeKey(key)), D.ids.skyCoffer);
  assert.deepEqual(S.decode(JSON.stringify(g.snapshot())), g.snapshot());
});

test('v3 rejects future content and v4 bounds every berth, clearance and treasure identifier', () => {
  for (const change of [s => s.inventory.sailMantle = 1, s => s.discoveries.push('kestrel'), s => s.crafted.push('micaSconce'), s => s.sky = {}, s => s.edits['0,0'] = [[5000, 130]]]) {
    const raw = structuredClone(balcony); change(raw); assert.throws(() => S.validate(raw));
  }
  const cell = [Math.floor(852/4), Math.floor(-804/4), 3];
  for (const bad of [{ berths: [0] }, { berths: [0,9] }, { berths: [1.1,0] }, { clear: [[0,0,3]] }, { clear: [cell,cell] },
    { clear: [[cell[0],cell[1],1<<14]] }, { clear: [['x',5,8]] }, { clear: Array(2401).fill(cell) }, { finds: ['aviator','aviator'] },
    { finds: ['<img>'] }, { mystery: 1 }]) {
    const state = fresh(); Object.assign(state.sky, bad); assert.throws(() => S.validate(state));
  }
  const invalid = fresh(); invalid.inventory.skyCoffer = 1; assert.throws(() => S.validate(invalid));
  const state = fresh(); state.sky.finds = ['aviator']; state.sky.clear = [cell];
  assert.deepEqual(S.validate(state), state);
});

test('both authored silhouettes have broad exposed decks, concave rims, abundant quarry blocks and open water below', () => {
  for (const seed of [4, 741092, 1846326]) {
    const w = new W.World(seed);
    for (const site of w.sky.sites) {
      const counts = new Map(), points = [];
      for (let cx = Math.floor((site.x-site.rx)/16); cx <= Math.floor((site.x+site.rx)/16); cx++) {
        for (let cz = Math.floor((site.z-site.rz)/16); cz <= Math.floor((site.z+site.rz)/16); cz++) {
          const cells = w.generate(cx,cz);
          for (const id of cells) if (id >= 127) counts.set(id, (counts.get(id) || 0) + 1);
        }
      }
      for (const material of site.materials) assert(counts.get(D.ids[material]) > 100, material);
      let dividedRows = 0;
      for (let z = site.z-site.rz; z <= site.z+site.rz; z++) {
        let runs = 0, land = false;
        for (let x = site.x-site.rx; x <= site.x+site.rx; x++) {
          const span = w.sky.profile(x,z);
          if (span) {
            assert(span.bottom > D.C.sea + 12 && span.top < D.C.height-9);
            points.push([x,z]); if (!land) runs++;
          }
          land = !!span;
        }
        if (runs >= 2) dividedRows++;
      }
      assert(points.length > 2900 && dividedRows > 12);
      for (const [x,z] of points.filter((_, i) => i % 71 === 0)) {
        assert(w.waterAt(x, D.C.sea-.5,z));
        assert.equal(w.get(x,D.C.sea+6,z), 0);
        assert.equal(w.islandAt(x,D.C.sea,z), null);
      }
      if (site.window) {
        assert.equal(w.sky.profile(site.x, site.z+11), null);
        assert(w.mapColumn(site.x,site.z+11).h < D.C.sea);
      }
    }
    w.sky.prepare(); assert.equal(w.sky.vaults.size, 4);
  }
});

for (const site of D.sky.sites) test('sail, dive, build a tower and step onto ' + site.name + ' through normal controls', () => {
  const g = new Game(), result = climbFromSea(g, D, site);
  assert(result.blocksPlaced >= 35 && result.blocksPlaced <= 65);
  assert(result.sailed >= 13);
  assert.equal(g.encounters.actors.length, 0);
  const recovered = new Game(S.decode(JSON.stringify(g.snapshot())));
  assert(recovered.state.discoveries.includes(site.id));
  assert.equal(Object.keys(recovered.state.placed).length, result.blocksPlaced);
  assert(!recovered.collides(recovered.state.player.x, recovered.state.player.y, recovered.state.player.z));
});

for (const site of D.sky.sites) test(site.name + ' quarry yields all five materials through the pick and each can be built back', () => {
  const g = new Game(), w = g.world, p = g.state.player;
  g.paused = false;
  g.state.inventory = { woodPick: 1 }; g.state.hotbar[0] = 'woodPick';
  const acquired = new Set();
  for (let z = site.z - 23; z <= site.z + 20 && acquired.size < 5; z += 5) {
    for (let x = site.x - 30; x <= site.x + 30 && acquired.size < 5; x += 7) {
      const span = w.sky.profile(x,z);
      if (!span || w.top(x,z) !== span.top+1) continue;
      Object.assign(p, { x:x+.5, y:span.top+1.01, z:z+.5, yaw:0, pitch:-1.48 });
      g.velocity = 0;
      for (let y = span.top; y >= span.bottom; y--) {
        const block = D.blocks[g.target()?.id];
        if (!block || !site.materials.includes(block.key)) break;
        assert(g.mine(2), g.message); acquired.add(block.key);
        ticks(g,26);
      }
    }
  }
  assert.deepEqual(acquired, new Set(site.materials));
  Object.assign(p,{x:.5,y:30,z:2.5}); w.set(0,29,0,D.ids.stone);
  for (const key of site.materials) {
    g.state.hotbar[0] = key; look(g,.5,29.96,.5);
    assert(g.place(),g.message); assert.equal(w.get(0,30,0),D.ids[key]);
    g.state.hotbar[0]='woodPick'; assert(g.mine(2),g.message);
  }
});

test('fishing and sailing beneath a sky island leave its discovery gated until landing', () => {
  const g = new Game(), site = g.world.sky.sites[0], p = g.state.player; g.paused = false;
  Object.assign(p, { x: site.x+.5, z: site.z+.5, y: D.C.sea-.5, yaw:0, pitch:0 });
  g.state.inventory = { rod:1, raft:1 }; g.state.hotbar[0] = 'rod';
  assert(g.interact()); ticks(g, 380);
  assert.equal(g.state.stats.fish, 1);
  assert(g.launchBoat('raft')); ticks(g, 40, { forward: true });
  assert(g.state.stats.sailed > 8); assert(!g.state.discoveries.includes(site.id)); assert.equal(g.encounters.actors.length, 0);
});

test('the local chart follows excavated sky, visible sea and a newly built block after unload and save', () => {
  const g = new Game(), w = g.world, x = 852, z = -804;
  assert(w.mapColumn(x,z).h > 45);
  for (let y = D.C.height-1; y >= 24; y--) if (w.get(x,y,z)) w.set(x,y,z,0);
  assert(w.mapColumn(x,z).h < D.C.sea);
  assert.deepEqual(chart.color(w,x,z), [32,63,80]);
  w.set(x,48,z,D.ids.roseSpar);
  const map = chart.raster(w,1,1,x+.5,z+.5);
  w.unload(0,0,3);
  const loaded = new Game(S.decode(JSON.stringify(g.snapshot()))).world;
  assert.equal(loaded.get(x,48,z), D.ids.roseSpar);
  assert.equal(loaded.mapColumn(x,z).h, 48);
  assert(loaded.waterAt(x,D.C.sea-.5,z));
  assert.deepEqual(chart.raster(loaded,1,1,x+.5,z+.5).data,map.data);
});

for (const site of D.sky.sites) for (const vault of site.vaults) test(site.name + ' hidden ' + vault.id + ' room can be entered and pays once across reload', () => {
  const g = new Game(), w = g.world, p = g.state.player; g.paused = false; w.sky.prepare();
  const key = [...w.sky.vaults].find(([,v]) => v.id === vault.id)[0];
  const [x,y,z] = W.decodeKey(key);
  assert.equal(w.get(x,y,z), D.ids.skyCoffer);
  if (vault.shaft) {
    const top = w.top(x,z+1);
    Object.assign(p, { x:x+.5, y:top+.01, z:z+1.5, pitch:-1.48, yaw:0 });
    assert.equal(g.target().id, D.ids[site.materials[4]]);
    assert(!g.mine(2));
    g.state.inventory.woodPick = 1; g.state.hotbar[0] = 'woodPick';
    assert(g.mine(2), g.message); ticks(g, 80);
    assert(Math.abs(p.y-y)<.12, 'descended through the plug');
  } else {
    const [dx,dz] = vault.mouth;
    let n = 2;
    while (n < 145 && w.get(x+n*dx,y+3,z+n*dz) === D.ids[site.materials[3]]) n++;
    assert(n > 3 && n < 145);
    assert.equal(w.get(x+n*dx, y+1, z+n*dz), 0, 'outer doorway open');
    Object.assign(p, { x:x+(n-1)*dx+.5, y, z:z+(n-1)*dz+.5, yaw:Math.atan2(dx,dz), pitch:0 });
    assert(!g.collides(p.x,p.y,p.z));
    ticks(g, Math.round((n-2.8)*60/4.7), { forward:true });
  }
  look(g,x+.5,y+.45,z+.5); assert.equal(g.target()?.id,D.ids.skyCoffer);
  g.state.inventory = { stone:12000, sand:12000 };
  assert(!g.interact()); assert.deepEqual(g.state.sky.finds, []);
  g.state.inventory = {};
  assert(g.interact(),g.message);
  assert.deepEqual(g.state.inventory,{ [vault.reward]:1, pearl:3 });
  const loaded = new Game(S.decode(JSON.stringify(g.snapshot())));
  assert.deepEqual(loaded.state.sky.finds,[vault.id]); assert(!loaded.interact());
  assert.deepEqual(loaded.state.inventory,g.state.inventory);
});

test('all eleven designs require their station, consume inputs once and create placeable camp pieces', () => {
  for (const [id,count,cost,station,discovery] of D.sky.pack.recipes) {
    const g = new Game(), p = g.state.player;
    g.state.inventory = { ...cost }; assert(!g.craft(id)); assert.deepEqual(g.state.inventory,cost);
    Object.assign(p,{x:.5,y:30,z:2.5}); g.world.set(2,30,2,D.ids[station]); g.state.placed['2,30,2']=D.ids[station];
    if (discovery) { assert(!g.craft(id)); assert.deepEqual(g.state.inventory,cost); g.state.discoveries.push(discovery); }
    assert(g.craft(id),g.message); assert.deepEqual(g.state.inventory,{[id]:count});
    g.world.set(0,29,0,D.ids.stone); look(g,.5,29.96,.5);
    g.state.hotbar[0]=id; assert(g.place(),g.message); assert.equal(g.world.get(0,30,0),D.ids[id]);
    assert(g.mine(2)); assert.equal(g.state.inventory[id],count);
  }
});

test('the found mantle slows descent and protects landing, and the three furnishings have distinct uses', () => {
  function drop(hasMantle) {
    const g=new Game(),p=g.state.player; g.paused=false;
    Object.assign(p,{x:.5,y:52,z:.5}); g.world.set(0,30,0,D.ids.stone);
    if (hasMantle) g.state.inventory.sailMantle=1;
    ticks(g, 64,{ jump:hasMantle }); const speed=g.velocity;
    for (let i=0; i<600 && !g.grounded; i++) g.step({ jump:hasMantle },1/60);
    return { speed,health:p.health };
  }
  const bare=drop(false), sailed=drop(true);
  assert(bare.speed < -13 && bare.health < 95); assert.equal(sailed.speed,-3); assert.equal(sailed.health,100);
  const g=new Game(),p=g.state.player; Object.assign(p,{x:.5,y:30,z:2.5}); look(g,.5,30.5,.5);
  Object.assign(g.state.camp,{x:.5,y:30,z:-97.5});
  g.world.set(0,30,0,D.ids.sunwheel); assert(g.interact()); assert.match(g.message,/100 m away · bearing 0°/);
  g.world.set(0,30,0,D.ids.nightjarChimes); assert(g.interact()); assert.match(g.message,/five evening notes/);
  assert.equal(D.blocks[D.ids.vesperStar].category,'light'); assert.equal(D.blocks[D.ids.vesperStar].lightColor,'#c18dff');
});
