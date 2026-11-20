/* Regression test: enemy units must block pass-through (including diagonal
   corner-cutting), be valid adjacent attack targets (melee), while allowing
   legitimate detours when movement points permit. */
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
  for (const t of S.tiles) { t.terrain = 'grassland'; t.resource = null; }
  const p = S.civs[0];
  p.cities = [];
  p.units = [];
  const e = { id: 99, name: 'Enemy', color: '#fff', isAI: false, techs: {}, atWar: {}, explored: {}, cities: [], units: [] };
  S.civs.push(e);
  return { S, p, e };
}

{
  // warrior mp=2, single enemy at (6,5): detours around need >2 mp with
  // corner-cutting disabled, so (7,5) must be unreachable
  const { p, e } = setup();
  const u = { id: 1, civ: p, type: 'warrior', x: 5, y: 5, hp: 100, mp: 2, moved: false };
  p.units.push(u);
  e.units.push({ id: 2, civ: e, type: 'warrior', x: 6, y: 5, hp: 100, mp: 2, moved: false });
  const reach = Civ.reachable(u);
  check(reach.has('6,5'), 'adjacent enemy tile is an attack target');
  check(!reach.has('7,5'), 'no pass-through of enemy within mp=2 (corner-cut blocked)');
  check(reach.has('4,5') && reach.has('5,4'), 'open neighbors still reachable');
}

{
  // full-height enemy wall at x=4: nothing can cross it
  const { p, e } = setup(12);
  const u = { id: 1, civ: p, type: 'rocket', x: 3, y: 1, hp: 100, mp: 7, moved: false };
  p.units.push(u);
  for (let y = 0; y < 12; y++) {
    e.units.push({ id: 100 + y, civ: e, type: 'warrior', x: 4, y, hp: 100, mp: 2, moved: false });
  }
  const reach = Civ.reachable(u);
  check(reach.has('4,1'), 'enemy on the wall is an adjacent attack target');
  check(!reach.has('5,1'), 'cannot cross a full enemy wall (no pass-through)');
  check(reach.has('3,2'), 'open side tile reachable');
}

{
  // same wall but with a gap at y=3: rocket mp=9 can slip through the gap
  const { p, e } = setup(12);
  const u = { id: 1, civ: p, type: 'rocket', x: 1, y: 1, hp: 100, mp: 9, moved: false };
  p.units.push(u);
  e.units.push(
    { id: 2, civ: e, type: 'warrior', x: 4, y: 0, hp: 100, mp: 2, moved: false },
    { id: 3, civ: e, type: 'warrior', x: 4, y: 1, hp: 100, mp: 2, moved: false },
    { id: 4, civ: e, type: 'warrior', x: 4, y: 2, hp: 100, mp: 2, moved: false },
  );
  const reach = Civ.reachable(u);
  check(reach.has('5,3'), 'gap in the wall is passable when mp allows');
}

{
  // naval: enemy ship blocks, mp=3 too small to detour around it
  const { p, e, S } = setup(12);
  for (const t of S.tiles) t.terrain = 'ocean';
  const u = { id: 1, civ: p, type: 'ship', x: 5, y: 5, hp: 100, mp: 3, moved: false };
  p.units.push(u);
  e.units.push({ id: 2, civ: e, type: 'ship', x: 6, y: 5, hp: 100, mp: 3, moved: false });
  const reach = Civ.reachable(u);
  check(reach.has('6,5'), 'adjacent enemy ship = attack target');
  check(!reach.has('7,5'), 'naval pass-through blocked within mp');
}

{
  // NEW stacking semantics: friendly-occupied tiles are valid destinations
  // (you may stack on / enter & leave your own units), and corner-cutting
  // past a friendly is allowed because a friendly does not block a corner.
  const { p } = setup(12);
  const u = { id: 1, civ: p, type: 'warrior', x: 5, y: 5, hp: 100, mp: 1, moved: false };
  p.units.push(u);
  p.units.push({ id: 3, civ: p, type: 'warrior', x: 6, y: 5, hp: 100, mp: 1, moved: false });
  const reach = Civ.reachable(u);
  check(reach.has('6,5'), 'friendly-occupied tile IS a valid destination (stacking)');
  check(reach.has('6,6'), 'diagonal corner-cut past a friendly is allowed');
  u.mp = 2;
  const reach2 = Civ.reachable(u);
  check(reach2.has('6,6') && reach2.has('6,5'), 'stacking still valid with more mp');
}

{
  // but an ENEMY on a corner still blocks that diagonal (no free corner-cut)
  const { p, e } = setup(12);
  const u = { id: 1, civ: p, type: 'warrior', x: 5, y: 5, hp: 100, mp: 1, moved: false };
  p.units.push(u);
  e.units.push({ id: 3, civ: e, type: 'warrior', x: 6, y: 5, hp: 100, mp: 1, moved: false });
  const reach = Civ.reachable(u);
  check(reach.has('6,5'), 'enemy adjacent tile is an attack target');
  check(!reach.has('6,6'), 'diagonal corner-cut past an ENEMY is blocked');
}

console.log(failures ? `FAILED (${failures})` : 'ALL PASS');
process.exit(failures ? 1 : 0);
