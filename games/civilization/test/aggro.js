/* Aggressive headless bot: expands, researches, and conquers.
   Verifies city capture, elimination, and the victory path. */
const fs = require('fs');
const path = require('path');
global.window = {};
for (const f of ['data.js', 'mapgen.js', 'game.js', 'ai.js']) {
  const code = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
  (new Function(code))();
}
const Civ = global.window.Civ;

const seed = parseInt(process.argv[2] || '12345', 10);
const turns = parseInt(process.argv[3] || '400', 10);
const difficulty = process.argv[4] || 'normal';
Civ.newGame({ seed, aiCount: 3, size: 32, difficulty });
const S = Civ.state;
const p = S.civs[0];

function strongest() {
  let best = null;
  for (const u of p.units) if (Civ.UNIT_TYPES[u.type].atk > 0 && (!best || Civ.UNIT_TYPES[u.type].atk > Civ.UNIT_TYPES[best.type].atk)) best = u;
  return best;
}

function playerBot() {
  // research: prefer unlock-heavy techs, fallback cheapest
  if (!p.currentTech) {
    const av = Civ.availableTechs(p);
    if (av.length) {
      av.sort((a, b) => (b.unlockU ? 2 : 0) + (b.bonus ? 1 : 0) - (a.unlockU ? 2 : 0) - (a.bonus ? 1 : 0) || a.cost - b.cost);
      p.currentTech = av[0].id;
    }
  }
  // production
  for (const c of p.cities) {
    if (c.queue) continue;
    const milCount = p.units.filter(u => Civ.UNIT_TYPES[u.type].atk > 0).length;
    const milTarget = 2 + p.cities.length;
    if (p.cities.length < 6 && !p.cities.some(x => x.queue === 'unit:settler')) {
      c.queue = 'unit:settler';
    } else if (milCount < milTarget) {
      const mils = ['rifleman', 'musketeer', 'knight', 'cannon', 'archer', 'horseman', 'warrior'].filter(t => Civ.unitUnlocked(p, t));
      c.queue = 'unit:' + (mils[0] || 'warrior');
    } else {
      const wantB = ['library', 'farm', 'barracks', 'university', 'factory', 'powerplant'].filter(b => !c.buildings[b] && Civ.buildingUnlocked(p, b));
      if (wantB.length) c.queue = 'building:' + wantB[0];
      // else idle — no unit spam
    }
  }
  // settle: walk away from own cities until a legal spot, then found
  function canSettle(x, y) {
    if (!Civ.TERRAIN[Civ.tileAt(x, y).terrain].land) return false;
    if (Civ.cityAt(x, y)) return false;
    for (const c of S.civs) {
      for (const city of c.cities) {
        const d = Math.max(Math.abs(city.x - x), Math.abs(city.y - y));
        if (c === p && d < 3) return false;
        if (c !== p && d < 2) return false;
      }
    }
    return true;
  }
  for (const u of p.units.slice()) {
    if (u.type !== 'settler' || u.hp <= 0) continue;
    if (canSettle(u.x, u.y)) { Civ.foundCity(u); continue; }
    // step toward the tile with max clearance from all cities
    const set = Civ.reachable(u);
    if (!set.size) continue;
    let best = null, bestClear = -1;
    for (const k of set) {
      const [x, y] = k.split(',').map(Number);
      if (!Civ.TERRAIN[Civ.tileAt(x, y).terrain].land) continue;
      let minD = 1e9;
      for (const c of S.civs) for (const city of c.cities) {
        minD = Math.min(minD, Math.max(Math.abs(city.x - x), Math.abs(city.y - y)));
      }
      if (minD > bestClear) { bestClear = minD; best = { x, y }; }
    }
    if (best) {
      Civ.moveUnit(u, best.x, best.y);
      if (canSettle(u.x, u.y)) Civ.foundCity(u);
    }
  }
  // attack: gather up to 10 strongest units near the nearest enemy city and besiege
  const mils = p.units.filter(x => Civ.UNIT_TYPES[x.type].atk > 0).sort((a, b) => Civ.UNIT_TYPES[b.type].atk - Civ.UNIT_TYPES[a.type].atk);
  if (mils.length >= 4 && p.cities.length >= 2) {
    let target = null, td = 1e9;
    for (const o of S.civs) {
      if (o === p || o.eliminated) continue;
      for (const c of o.cities) {
        let bestNear = 1e9;
        for (const m of mils.slice(0, 10)) bestNear = Math.min(bestNear, Math.abs(c.x - m.x) + Math.abs(c.y - m.y));
        if (bestNear < td) { td = bestNear; target = { x: c.x, y: c.y }; }
      }
    }
    if (target) {
      // closest 10 units form the siege gang; march if they are far
      const gang = mils
        .map(m => ({ m, d: Math.abs(m.x - target.x) + Math.abs(m.y - target.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 10)
        .map(o => o.m);
      for (const u of gang) {
        for (let step = 0; step < 4; step++) {
          if (u.hp <= 0 || !p.units.includes(u)) break;
          const d = Math.abs(target.x - u.x) + Math.abs(target.y - u.y);
          if (d <= 1) {
            const enemy = Civ.enemyOn(u, target.x, target.y);
            if (enemy) { Civ.doCombat(u, enemy); break; }
            break; // city already captured or no defender
          }
          if (d > 20) {
            // march toward the target this step
            const set2 = Civ.reachable(u);
            if (!set2.size) break;
            let b2 = null, bd2 = d;
            for (const k of set2) {
              const [x, y] = k.split(',').map(Number);
              const dd = Math.abs(x - target.x) + Math.abs(y - target.y);
              if (dd < bd2) { bd2 = dd; b2 = { x, y }; }
            }
            if (!b2) break;
            Civ.moveUnit(u, b2.x, b2.y);
            continue;
          }
          const set = Civ.reachable(u);
          if (!set.size) break;
          let best = null, bd = d;
          for (const k of set) {
            const [x, y] = k.split(',').map(Number);
            const dd = Math.abs(x - target.x) + Math.abs(y - target.y);
            if (dd < bd) { bd = dd; best = { x, y }; }
          }
          if (!best) break;
          Civ.moveUnit(u, best.x, best.y);
        }
      }
    }
  }

}

let errors = 0;
const t0 = Date.now();
try {
  for (let i = 0; i < turns; i++) {
    playerBot();
    Civ.endTurn();
    if (S.winner) break;
  }
} catch (e) { errors++; console.error('RUNTIME ERROR:', e.stack || e); }

console.log(`seed=${seed} diff=${difficulty} turn=${S.turn} winner=${S.winner} ms=${Date.now() - t0}`);
console.log(`  player: cities=${p.cities.length} units=${p.units.length} techs=${Object.keys(p.techs).length} gold=${Math.floor(p.gold)}`);
for (const c of S.civs.slice(1)) {
  console.log(`  ${c.name.padEnd(10)} ${c.eliminated ? 'ELIMINATED' : 'alive'} cities=${c.cities.length} units=${c.units.length} techs=${Object.keys(c.techs).length} war=${p.atWar[c.id] ? 'YES' : 'no'}`);
}
console.log('errors:', errors);
process.exitCode = errors ? 1 : 0;
