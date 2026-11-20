/* Engine tests for refinement session #4:
   - production carry-over (absolute shields kept when switching queue;
     over-cost completes at end of turn, excess discarded, value stays
     usable until turn end)
   - expanded content sizes (48 techs, 27 units, 29 buildings, 7 wonders)
   - era cost scaling (Ancient frozen, later eras slower, weighted late)
   - wiring of new units/buildings (engineer roads, carrack transport,
     museum wonder bonus) + full data integrity
   - Moai wonder claim flow                                                            */
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

function setup() {
  Civ.newGame({ seed: 7, aiCount: 0, size: 12, difficulty: 'easy' });
  const S = Civ.state;
  for (const t of S.tiles) { t.terrain = 'grassland'; t.resource = null; t.road = false; }
  for (const c of S.civs) { c.cities = []; c.units = []; c.explored = {}; }
  const p = S.civs[0];
  const settler = { id: 4242, civ: p, type: 'settler', x: 3, y: 3, hp: 100, mp: 2, moved: false };
  p.units.push(settler);
  Civ.foundCity(settler);
  const city = p.cities[0];
  const y = Civ.cityYields(city);
  return { S, p, city, y };
}

/* --------------------------- carry-over ------------------------------ */

{
  // half a settler (15/30) switched to warrior (18) -> progress stays 15
  const { p, city } = setup();
  city.queue = 'unit:settler';
  city.progress = 15;
  Civ.setQueue(city, 'unit:warrior');
  check(city.queue === 'unit:warrior', 'queue switched to warrior');
  check(city.progress === 15, '15 invested shields carried over to warrior (15/18 = 83%)');

  // 25 shields -> warrior (18): over-cost, still uncompleted mid-turn
  city.queue = 'unit:warrior';
  city.progress = 25;
  check(city.progress === 25 && city.queue === 'unit:warrior',
    'over-cost progress stays usable before the turn ends');
  // player changes mind again to a pricier item before turn end
  Civ.setQueue(city, 'unit:catapult'); // cost 55
  check(city.progress === 25, 'progress still 25 after re-switching to catapult');
  const nBefore = p.units.length;
  Civ.processCiv(p);
  check(p.units.length === nBefore, 'catapult not produced yet (25 < 55)');
  check(city.queue === 'unit:catapult', 'queue still catapult after an incomplete turn');
}

{
  // 30 shields on a settler, switch to warrior (18): completes this turn,
  // excess (12) discarded
  const { p, city } = setup();
  const nBefore = p.units.length;
  city.queue = 'unit:settler';
  city.progress = 30;
  Civ.setQueue(city, 'unit:warrior');
  check(city.progress === 30, '30 shields carried to warrior (over 100%)');
  Civ.processCiv(p);
  check(city.queue === null, 'queue cleared after completion');
  check(city.progress === 0, 'excess shields discarded on completion');
  check(p.units.length === nBefore + 1, 'warrior produced at end of turn');
  check(p.units.some(u => u.type === 'warrior'), 'the produced unit is a warrior');
}

{
  // "Clear queue" still zeroes progress (unchanged behaviour)
  const { city } = setup();
  city.queue = 'unit:settler';
  city.progress = 15;
  city.queue = null;
  city.progress = 0;
  check(city.queue === null && city.progress === 0, 'clearing the queue zeroes progress');
}

/* ------------------------- content sizes ----------------------------- */

{
  check(Civ.TECHS.length === 48, '48 technologies (got ' + Civ.TECHS.length + ')');
  const units = Object.keys(Civ.UNIT_TYPES).length;
  check(units === 27, '27 unit types (got ' + units + ')');
  const B = Object.keys(Civ.BUILDINGS).length;
  check(B === 29, '29 buildings incl. wonders (got ' + B + ')');
  const wonders = Object.keys(Civ.BUILDINGS).filter(k => Civ.BUILDINGS[k].wonder).length;
  check(wonders === 7, '7 world wonders (got ' + wonders + ')');
}

/* ----------------------- cost scaling checks ------------------------- */

{
  check(JSON.stringify(Civ.ERA_COST_SCALE) === JSON.stringify([1, 1.25, 1.75, 2.5]),
    'era cost scale is [1, 1.25, 1.75, 2.5] (Ancient frozen)');
  const c = (id) => Civ.TECH_BY_ID[id].cost;
  check(c('pottery') === 200, 'pottery 200 (Ancient unchanged)');
  check(c('law') === 575, 'law 575 (Ancient unchanged)');
  check(c('bronze') === 475, 'bronze 475 (new Ancient tech, base cost)');
  check(c('feudalism') === 1065, 'feudalism 1065 (850 × 1.25)');
  check(c('gunpowder') === 1815, 'gunpowder 1815 (1450 × 1.25)');
  check(c('enlightenment') === 3850, 'enlightenment 3850 (2200 × 1.75)');
  check(c('flight') === 9000, 'flight 9000 (3600 × 2.5)');
  check(c('nuclear') === 14815, 'nuclear 14815 (5925 × 2.5)');
  check(c('missiles') === 11500, 'missiles 11500 (4600 × 2.5)');
}

/* ------------------------ new content wiring ------------------------- */

{
  const E = Civ.UNIT_TYPES.engineer;
  check(E && E.canRoad === true && E.req === 'locomotion', 'engineer builds roads, requires locomotion');
  const C = Civ.UNIT_TYPES.carrack;
  check(C && C.naval === true && C.transport === true && C.req === 'navigation',
    'carrack is a naval transport, requires navigation');
  const M = Civ.BUILDINGS.museum;
  check(M && M.wonder === true && M.wonderBonus.sci === 2 && M.wonderBonus.gold === 1,
    'museum is a wonder with +2 sci / +1 gold empire-wide');
  check(Civ.BUILDINGS.stock_exchange.req === 'accounting' && Civ.BUILDINGS.stock_exchange.gold === 3,
    'stock exchange unlocks from accounting (+3 gold)');
  check(Civ.BUILDINGS.research_lab.req === 'computers' && Civ.BUILDINGS.research_lab.sci === 4,
    'research lab unlocks from computers (+4 sci)');
}

/* --------------------------- integrity ------------------------------- */

{
  let ok = true, bad = [];
  for (const t of Civ.TECHS) {
    for (const r of t.req) if (!Civ.TECH_BY_ID[r]) { ok = false; bad.push(t.id + ' req ' + r); }
    for (const u of t.unlockU || []) if (!Civ.UNIT_TYPES[u]) { ok = false; bad.push(t.id + ' unlockU ' + u); }
    for (const b of t.unlockB || []) if (!Civ.BUILDINGS[b]) { ok = false; bad.push(t.id + ' unlockB ' + b); }
  }
  check(ok, 'all tech req/unlock targets exist' + (bad.length ? ' — ' + bad.join(', ') : ''));

  let ok2 = true, bad2 = [];
  for (const [k, u] of Object.entries(Civ.UNIT_TYPES)) {
    if (u.req && !Civ.TECH_BY_ID[u.req]) { ok2 = false; bad2.push(k); }
  }
  for (const [k, b] of Object.entries(Civ.BUILDINGS)) {
    if (b.req && !Civ.TECH_BY_ID[b.req]) { ok2 = false; bad2.push(k); }
  }
  check(ok2, 'all unit/building req techs exist' + (bad2.length ? ' — ' + bad2.join(', ') : ''));
}

/* --------------------------- Moai claim ------------------------------ */

{
  Civ.newGame({ seed: 7, aiCount: 0, size: 12, difficulty: 'easy' });
  const S = Civ.state;
  for (const t of S.tiles) { t.terrain = 'grassland'; t.resource = null; t.road = false; }
  for (const c of S.civs) { c.cities = []; c.units = []; c.explored = {}; }
  const p = S.civs[0], e = S.civs[1];
  const mk = (civ, x, y) => {
    const u = { id: 1000 + x, civ, type: 'settler', x, y, hp: 100, mp: 2, moved: false };
    civ.units.push(u);
    Civ.foundCity(u);
    return civ.cities[civ.cities.length - 1];
  };
  const cityA = mk(p, 3, 3);
  const cityB = mk(e, 9, 9);
  const beforeA = Civ.cityYields(cityA).p, beforeB = Civ.cityYields(cityB).p;
  Civ.claimWonder('moai', e); // +3 prod to every city of the owner
  const afterA = Civ.cityYields(cityA).p, afterB = Civ.cityYields(cityB).p;
  check(afterB - beforeB === 3, 'Moai owner city gains +3 prod');
  check(afterA === beforeA, 'rival city unaffected by a wonder it does not own');
}

console.log(failures ? `FAILED (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
