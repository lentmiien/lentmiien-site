/* Engine tests for refinement session #1:
   - domains (land<->water separation, ships vs land, air flies anywhere)
   - settler costCap (crosses any land terrain, never stuck)
   - roads (settler action, movement cost reduction, tile rules)
   - wonders (claim/owner, yield bonuses, completion flow, Great Wall def)
   - stacking (friendly units share tiles, enter/leave city tiles)
   - city cap constant (feedback #7)                                       */
const fs = require('fs');
const path = require('path');
global.window = {};
for (const f of ['data.js', 'mapgen.js', 'game.js', 'ai.js']) {
  (new Function(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8')))();
}
const Civ = global.window.Civ;

let failures = 0;
const check = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg);
  if (!cond) failures++;
};

function setup(size) {
  Civ.newGame({ seed: 7, aiCount: 0, size: size || 12, difficulty: 'easy' });
  const S = Civ.state;
  for (const t of S.tiles) { t.terrain = 'grassland'; t.resource = null; t.road = false; }
  // wipe all starting cities/units -> fully clean map, no interference
  for (const c of S.civs) { c.cities = []; c.units = []; c.explored = {}; }
  const p = S.civs[0];
  return { S, p, e: S.civs[1] };
}
function unit(civ, type, x, y) {
  const T = Civ.UNIT_TYPES[type];
  const u = { id: 9000 + Math.floor(Math.random() * 1e6), civ, type, x, y, hp: 100, mp: T.mp, moved: false };
  civ.units.push(u);
  return u;
}
function tile(S, x, y) { return S.tiles[Civ.idx(x, y)]; }

/* ----------------------------- domains ------------------------------ */

{
  // land unit over water
  const { S, p } = setup();
  const t = tile(S, 5, 5);
  check(Civ.moveCost({ type: 'warrior' }, { terrain: 'ocean' }) === Infinity,
    'warrior cannot enter ocean (moveCost Infinity)');
  check(Civ.moveCost({ type: 'settler' }, { terrain: 'ocean' }) === Infinity,
    'settler cannot swim (moveCost Infinity)');
  for (const t of S.tiles) t.terrain = 'ocean';
  const w = unit(p, 'warrior', 5, 5);   // stranded on open water
  check(Civ.reachable(w).size === 0, 'warrior on open water has no reachable land tiles');
}

{
  // ship over land
  const { S, p } = setup();
  for (const t of S.tiles) t.terrain = 'ocean';
  tile(S, 6, 5).terrain = 'grassland';
  check(Civ.moveCost({ type: 'ship' }, tile(S, 6, 5)) === Infinity,
    'ship cannot enter land (moveCost Infinity)');
  const sh = unit(p, 'ship', 5, 5);
  const reach = Civ.reachable(sh);
  check(!reach.has('6,5'), 'ship cannot move onto a land tile');
  check(reach.has('4,5') && reach.has('5,4'), 'ship still moves on open water');
}

{
  // land unit cannot cross water to reach land beyond
  const { S, p } = setup();
  for (const t of S.tiles) t.terrain = 'ocean';
  tile(S, 4, 5).terrain = 'grassland';
  tile(S, 6, 5).terrain = 'grassland';
  const w = unit(p, 'warrior', 4, 5);
  const reach = Civ.reachable(w);
  check(!reach.has('6,5'), 'warrior cannot reach the other shore across water');
}

{
  // air unit flies over everything (water, mountains, forest)
  const { S, p } = setup();
  for (const t of S.tiles) t.terrain = 'ocean';
  tile(S, 4, 5).terrain = 'grassland';
  tile(S, 6, 5).terrain = 'mountains';
  tile(S, 5, 6).terrain = 'forest';
  check(Civ.moveCost({ type: 'plane' }, { terrain: 'ocean' }) === 1, 'plane cost over ocean is 1');
  check(Civ.moveCost({ type: 'plane' }, { terrain: 'mountains' }) === 1, 'plane cost over mountains is 1');
  const pl = unit(p, 'plane', 5, 5);
  const reach = Civ.reachable(pl);
  check(reach.has('4,5') && reach.has('6,5') && reach.has('5,6'),
    'plane reaches land, mountains and forest alike');
}

/* --------------------------- settler costCap -------------------------- */

{
  // with a cost-3 terrain (synthetic), settler caps at costCap=2 but
  // a regular land unit pays the full 3
  const { S, p } = setup();
  const forest = Civ.TERRAIN.forest;
  const orig = forest.cost;
  forest.cost = 3;
  try {
    const t = tile(S, 6, 5);
    t.terrain = 'forest';
    check(Civ.moveCost({ type: 'settler' }, t) === 2, 'settler pays capped cost (2) on cost-3 terrain');
    check(Civ.moveCost({ type: 'warrior' }, t) === 3, 'warrior pays full cost (3) on cost-3 terrain');
    const st = unit(p, 'settler', 5, 5);
    check(Civ.reachable(st).has('6,5'), 'settler with mp=2 still enters cost-3 terrain (never stuck)');
    const w = unit(p, 'warrior', 4, 5);
    check(!Civ.reachable(w).has('6,5'), 'warrior with mp=2 cannot enter cost-3 terrain');
  } finally {
    forest.cost = orig;
  }
}

{
  // with the real data table (max cost 2), settlers cross every land type
  const { S, p } = setup();
  for (const t of S.tiles) t.terrain = 'desert';
  const st = unit(p, 'settler', 5, 5);
  const reach = Civ.reachable(st);
  check(reach.has('4,5') && reach.has('6,5') && reach.has('5,4') && reach.has('5,6'),
    'settler crosses every desert neighbor (no stuck terrain)');
}

/* ------------------------------- roads ------------------------------- */

{
  const { S, p } = setup();
  const st = unit(p, 'settler', 5, 5);
  check(Civ.buildRoad(st) === true, 'settler builds a road on its tile');
  check(tile(S, 5, 5).road === true, 'road flag set on the tile');
  check(st.mp === 0 && st.moved === true, 'road building consumes the turn');
  check(Civ.buildRoad(st) === false, 'cannot build a second road on the same tile');
}

{
  const { S, p } = setup();
  const w = unit(p, 'warrior', 5, 5);
  check(Civ.buildRoad(w) === false, 'warrior cannot build roads');
  check(tile(S, 5, 5).road === false, 'no road created by a non-settler');
}

{
  const { S, p } = setup();
  for (const t of S.tiles) t.terrain = 'ocean';
  const stO = unit(p, 'settler', 5, 5);   // stranded on water
  check(Civ.buildRoad(stO) === false, 'no road on an ocean tile');
  for (const t of S.tiles) t.terrain = 'grassland';
  tile(S, 5, 5).terrain = 'mountains';
  const stM = unit(p, 'settler', 5, 5);   // stranded on a mountain
  check(Civ.buildRoad(stM) === false, 'no road on mountains');
}

{
  // road cuts land movement cost to 1
  const { S, p } = setup();
  const t = tile(S, 6, 5);
  t.terrain = 'forest';   // base cost 2
  check(Civ.moveCost({ type: 'warrior' }, t) === 2, 'forest costs 2 before the road');
  t.road = true;
  check(Civ.moveCost({ type: 'warrior' }, t) === 1, 'forest costs 1 with a road');
}

/* ------------------------------ wonders ------------------------------ */

{
  const { S, p, e } = setup();
  check(Civ.wonderClaimed('pyramid') === false, 'wonder unclaimed at game start');
  Civ.claimWonder('pyramid', e);
  check(Civ.wonderClaimed('pyramid') === true, 'wonder claimed');
  check(Civ.wonderOwner('pyramid') === e, 'wonder owner is the claiming civ');
  check(Civ.civHasWonder(e, 'pyramid') === true && Civ.civHasWonder(p, 'pyramid') === false,
    'civHasWonder distinguishes owner from rival');
}

{
  // yield bonus applies to ALL cities of the owner only
  const { S, p, e } = setup();
  const stA = unit(p, 'settler', 3, 3);
  Civ.foundCity(stA);
  const cityA = p.cities[0];
  const stB = unit(e, 'settler', 9, 9);
  Civ.foundCity(stB);
  const cityB = e.cities[0];
  const beforeA = Civ.cityYields(cityA).f, beforeB = Civ.cityYields(cityB).f;
  Civ.claimWonder('pyramid', e);   // +2 food & +2 prod to every city of the owner
  const afterA = Civ.cityYields(cityA).f, afterB = Civ.cityYields(cityB).f;
  check(afterB - beforeB === 2, 'owner city gains the wonder food bonus (+2)');
  check(afterA === beforeA, 'rival city gets no bonus for a wonder it does not own');
}

{
  // completion flow: first finisher claims, second finisher wastes effort
  const { S, p, e } = setup();
  const stA = unit(p, 'settler', 3, 3);
  Civ.foundCity(stA);
  const cityA = p.cities[0];
  const y = Civ.cityYields(cityA);
  cityA.queue = 'building:pyramid';
  cityA.progress = 350 - y.p;   // completes exactly this turn
  Civ.processCiv(p);
  check(cityA.queue === null, 'production queue cleared after completion');
  check(Civ.civHasWonder(p, 'pyramid'), 'city completion claims the wonder');
  check(cityA.wonder === 'pyramid', 'completed city records its wonder');

  const stB = unit(e, 'settler', 9, 9);
  Civ.foundCity(stB);
  const cityB = e.cities[0];
  const yB = Civ.cityYields(cityB);
  cityB.queue = 'building:pyramid';
  cityB.progress = 350 - yB.p;
  Civ.processCiv(e);
  check(cityB.wonder === undefined, 'second city does not record a claimed wonder');
  check(Civ.civHasWonder(p, 'pyramid'), 'ownership stays with the first finisher');
  check(S.log.some(l => /wasted/i.test(l.msg)), 'wasted completion is logged');
}

{
  // Great Wall: +5 defense for the owner's city defenders
  function scenario(withWonder) {
    const { S, p, e } = setup();
    if (withWonder) Civ.claimWonder('greatwall', e);
    const st = unit(e, 'settler', 6, 6);
    Civ.foundCity(st);
    const city = e.cities[0];
    const def = unit(e, 'warrior', 6, 6);   // defends in its own city
    const att = unit(p, 'musketeer', 6, 5); // atk 8, melee reach
    Civ.doCombat(att, def);
    return def.hp;
  }
  const noWall = scenario(false);
  const withWall = scenario(true);
  check(noWall === 20, 'without Great Wall the defender takes 80 damage (hp 20)');
  check(withWall === 47, 'with Great Wall the defender takes 53 damage (hp 47)');
}

/* ------------------------------ stacking ----------------------------- */

{
  const { S, p } = setup();
  const a = unit(p, 'warrior', 5, 5);
  const b = unit(p, 'archer', 6, 5);
  check(Civ.moveUnit(b, 5, 5) === true, 'friendly unit can move onto a friendly unit');
  check(Civ.unitsOn(5, 5).length === 2, 'both units now share the tile');
  check(b.mp === 0, 'stacking move consumed movement');
  check(Civ.moveUnit(b, 6, 5) === true, 'unit can leave the stack again');
  check(Civ.unitsOn(5, 5).length === 1, 'only the original unit remains on the tile');
}

{
  // enter and leave a friendly city square
  const { S, p } = setup();
  const st = unit(p, 'settler', 8, 8);
  Civ.foundCity(st);
  const w = unit(p, 'warrior', 8, 7);
  check(Civ.moveUnit(w, 8, 8) === true, 'unit can move onto its own city square');
  check(Civ.unitsOn(8, 8).some(u => u.type === 'warrior'), 'warrior is inside the city');
  check(Civ.moveUnit(w, 8, 9) === true, 'unit can leave its own city square');
  check(!Civ.unitsOn(8, 8).some(u => u.type === 'warrior'), 'city square is clear again');
}

/* ------------------------------ city cap ----------------------------- */

{
  check(Civ.MAX_CITIES === 20, 'city cap is 20 (settlers can keep being built, feedback #7)');
}

console.log(failures ? `FAILED (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
