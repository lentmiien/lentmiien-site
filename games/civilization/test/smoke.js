/* Headless smoke test: runs the engine in Node for N turns. */
const fs = require('fs');
const path = require('path');
global.window = {};
for (const f of ['data.js', 'mapgen.js', 'game.js', 'ai.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  (new Function(code))();
}
const Civ = global.window.Civ;

const seed = parseInt(process.argv[2] || '12345', 10);
const turns = parseInt(process.argv[3] || '200', 10);
const difficulty = process.argv[4] || 'normal';
Civ.newGame({ seed, aiCount: 3, size: 32, difficulty });
const S = Civ.state;

function playerBot() {
  const p = S.civs[0];
  if (!p.currentTech) {
    const av = Civ.availableTechs(p).sort((a, b) => a.cost - b.cost);
    if (av.length) p.currentTech = av[0].id;
  }
  // production: buildings first in a city, then best unit
  for (const c of p.cities) {
    if (c.queue) continue;
    const wantB = ['library', 'barracks', 'farm', 'university'].filter(b => !c.buildings[b] && Civ.buildingUnlocked(p, b));
    if (wantB.length) { c.queue = 'building:' + wantB[0]; continue; }
    const opts = ['rifleman', 'musketeer', 'knight', 'archer', 'warrior'].filter(t => Civ.unitUnlocked(p, t));
    c.queue = 'unit:' + (opts[0] || 'warrior');
  }
  // settle
  for (const u of p.units.slice()) {
    if (u.type !== 'settler' || u.hp <= 0) continue;
    if (Civ.cityAt(u.x, u.y)) {
      const cap = p.cities[0];
      const set = Civ.reachable(u);
      let best = null, bd = -1;
      for (const k of set) {
        const [x, y] = k.split(',').map(Number);
        if (!Civ.TERRAIN[Civ.tileAt(x, y).terrain].land || Civ.cityAt(x, y)) continue;
        const d = Math.max(Math.abs(x - cap.x), Math.abs(y - cap.y));
        if (d > bd) { bd = d; best = { x, y }; }
      }
      if (best) Civ.moveUnit(u, best.x, best.y);
    }
    Civ.foundCity(u);
  }
  // fight back: strongest unit attacks nearest enemy
  if (Object.keys(p.atWar).some(id => p.atWar[id])) {
    let strongest = null;
    for (const u of p.units) if (Civ.UNIT_TYPES[u.type].atk > 0 && (!strongest || Civ.UNIT_TYPES[u.type].atk > Civ.UNIT_TYPES[strongest.type].atk)) strongest = u;
    if (strongest) {
      let target = null, td = 1e9;
      for (const o of S.civs) if (o !== p && !o.eliminated) for (const u2 of o.units) {
        const d = Math.abs(u2.x - strongest.x) + Math.abs(u2.y - strongest.y);
        if (d < td) { td = d; target = u2; }
      }
      if (target && td <= 1) Civ.doCombat(strongest, target);
    }
  }
}

let errors = 0;
try {
  for (let i = 0; i < turns; i++) {
    playerBot();
    Civ.endTurn();
    if (S.winner) break;
  }
} catch (e) {
  errors++;
  console.error('RUNTIME ERROR:', e.stack || e);
}

const p = S.civs[0];
console.log(`seed=${seed} diff=${difficulty} turn=${S.turn} winner=${S.winner} player: cities=${p.cities.length} units=${p.units.length} techs=${Object.keys(p.techs).length}`);
for (const c of S.civs.slice(1)) {
  console.log(`  ${c.name.padEnd(10)} cities=${c.cities.length} units=${c.units.length} techs=${Object.keys(c.techs).length} war=${p.atWar[c.id] ? 'YES' : 'no'}`);
}
console.log('errors:', errors);
process.exitCode = errors ? 1 : 0;
