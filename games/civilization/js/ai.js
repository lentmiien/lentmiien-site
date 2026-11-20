/* =====================================================================
 * ai.js — simple heuristic AI opponents
 * ===================================================================== */
window.Civ = window.Civ || {};
(function (Civ) {

  const MAX_CITIES = Civ.MAX_CITIES || 20;   // shared city cap from data.js (feedback #7)
  // difficulty scaling (set by game.js on new game)
  Civ.ai = Civ.ai || {};

  function atWar(civ) {
    return Object.keys(civ.atWar).some(id => civ.atWar[id]);
  }

  function militaryStrength(civ) {
    let s = 0;
    for (const u of civ.units) s += Civ.UNIT_TYPES[u.type].atk;
    return s;
  }

  function bestUnit(civ) {
    // prefer affordable, solid units over exotic ones
    let best = 'warrior', bestAtk = -1;
    let exotic = null, exoticAtk = 0;
    for (const t of Civ.availableUnits(civ)) {
      if (t === 'settler') continue;
      const U = Civ.UNIT_TYPES[t];
      if (U.atk <= 0) continue;
      if (U.cost <= 70) {
        if (U.atk > bestAtk) { bestAtk = U.atk; best = t; }
      } else if (U.atk > exoticAtk) {
        exoticAtk = U.atk; exotic = t;
      }
    }
    return best;
  }

  function aiResearch(civ) {
    if (civ.currentTech) return;
    const av = Civ.availableTechs(civ);
    if (!av.length) return;
    let best = null, bestScore = -1e9;
    for (const t of av) {
      let score = t.era * 8;
      if (t.unlockU) score += 12;
      if (t.unlockB) score += 6;
      if (t.bonus) {
        score += (t.bonus.sci || 0) * 2 + (t.bonus.prod || 0) + (t.bonus.food || 0) + (t.bonus.gold || 0);
      }
      score -= t.cost / 100;
      if (score > bestScore) { bestScore = score; best = t; }
    }
    if (best) civ.currentTech = best.id;
  }

  const BUILDING_PRIORITY = ['library', 'barracks', 'farm', 'market', 'temple', 'university', 'wall', 'hospital', 'factory', 'powerplant', 'monument'];

  function militaryUnitCount(civ) {
    let n = 0;
    for (const u of civ.units) if (Civ.UNIT_TYPES[u.type].atk > 0) n++;
    return n;
  }

  function aiProduction(civ) {
    const cities = civ.cities;
    if (!cities.length) return;
    const settlerQueued = cities.some(c => c.queue === 'unit:settler');
    const atWarNow = atWar(civ);
    const milTarget = 2 + civ.cities.length; // military units wanted while at war

    for (const city of cities) {
      if (city.queue) continue;
      let pick = null;
      if (civ.cities.length < 3 && !settlerQueued) {
        pick = 'unit:settler';
      } else if (atWarNow && militaryUnitCount(civ) < milTarget) {
        pick = 'unit:' + bestUnit(civ);
      } else if (Math.random() < 0.25 && Object.keys(city.buildings).length >= 2) {
        // occasionally pursue a wonder; only UNCLAIMED ones are ever queued
        for (const b of Object.keys(Civ.BUILDINGS)) {
          const B = Civ.BUILDINGS[b];
          if (!B.wonder) continue;
          if (Civ.wonderClaimed(b) || city.buildings[b]) continue;
          if (!Civ.buildingUnlocked(civ, b)) continue;
          pick = 'building:' + b; break;
        }
      }
      if (!pick) {
        for (const b of BUILDING_PRIORITY) {
          if (!city.buildings[b] && Civ.buildingUnlocked(civ, b) && Civ.BUILDINGS[b].cost <= 90) {
            pick = 'building:' + b; break;
          }
        }
        // otherwise the city idles (no endless unit spam)
      }
      city.queue = pick; city.progress = 0;
    }
  }

  function canSettle(u) {
    if (Civ.cityAt(u.x, u.y)) return false;
    if (!Civ.TERRAIN[Civ.tileAt(u.x, u.y).terrain].land) return false;
    for (const c of Civ.state.civs) {
      for (const city of c.cities) {
        const d = Math.max(Math.abs(city.x - u.x), Math.abs(city.y - u.y));
        if (c === u.civ && d < 3) return false;
        if (c !== u.civ && d < 2) return false;
      }
    }
    return true;
  }

  function aiSettle(civ) {
    if (civ.cities.length >= MAX_CITIES) return;
    for (const u of civ.units.slice()) {
      if (u.type !== 'settler' || u.hp <= 0) continue;
      if (canSettle(u)) { Civ.foundCity(u); continue; }
      // walk away from own cities toward open land
      let own = null, od = 1e9;
      for (const c of civ.cities) {
        const d = Math.max(Math.abs(c.x - u.x), Math.abs(c.y - u.y));
        if (d < od) { od = d; own = c; }
      }
      if (!own) continue;
      const set = Civ.reachable(u);
      if (!set.size) continue;
      let best = null, bestD = -1;
      for (const k of set) {
        const [x, y] = k.split(',').map(Number);
        if (!Civ.TERRAIN[Civ.tileAt(x, y).terrain].land) continue;
        if (Civ.cityAt(x, y)) continue;
        const d = Math.max(Math.abs(x - own.x), Math.abs(y - own.y));
        if (d > bestD) { bestD = d; best = { x, y }; }
      }
      if (best) {
        Civ.moveUnit(u, best.x, best.y);
        if (canSettle(u)) Civ.foundCity(u);
      }
    }
  }

  // a unit should only chase targets it can actually reach across the domain:
  //   air  -> anything
  //   naval-> enemy ships and cities (never land units)
  //   land -> enemy land units and cities (never ships)
  function domainCompat(att, target) {
    const A = Civ.UNIT_TYPES[att.type];
    const T = (target && target.type) ? Civ.UNIT_TYPES[target.type] : null;
    if (A.fly) return true;
    if (A.naval) return T ? !!T.naval : true;
    return T ? !T.naval : true;
  }

  function nearestTarget(civ, u, x, y) {
    let best = null, bestD = 1e9;
    for (const other of Civ.state.civs) {
      if (other === civ || !civ.atWar[other.id] || other.eliminated) continue;
      for (const t of other.units) {
        if (!domainCompat(u, t)) continue;    // skip unreachable (wrong domain)
        const d = Math.abs(t.x - x) + Math.abs(t.y - y);
        if (d < bestD) { bestD = d; best = { x: t.x, y: t.y, kind: 'unit', ref: t }; }
      }
      for (const c of other.cities) {
        const d = Math.abs(c.x - x) + Math.abs(c.y - y);
        if (d < bestD) { bestD = d; best = { x: c.x, y: c.y, kind: 'city', ref: c }; }
      }
    }
    return best;
  }

  function stepToward(u, tx, ty) {
    const set = Civ.reachable(u);
    if (!set.size) return;
    let best = null, bestD = Math.abs(u.x - tx) + Math.abs(u.y - ty);
    for (const k of set) {
      const [x, y] = k.split(',').map(Number);
      const d = Math.abs(x - tx) + Math.abs(y - ty);
      if (d < bestD) {
        // don't step onto an enemy unit we can't (we will attack instead anyway)
        bestD = d; best = { x, y };
      }
    }
    if (best) Civ.moveUnit(u, best.x, best.y);
  }

  function aiCombat(civ) {
    for (const u of civ.units.slice()) {
      if (u.hp <= 0) continue;
      if (!Civ.UNIT_TYPES[u.type].atk) continue;
      const target = nearestTarget(civ, u, u.x, u.y);
      if (!target || target.x === undefined) continue;
      const d = Math.abs(target.x - u.x) + Math.abs(target.y - u.y);
      if (d <= 1) {
        const enemy = Civ.enemyOn(u, target.x, target.y);
        if (enemy) Civ.moveUnit(u, target.x, target.y); // attacks
        else if (target.kind === 'city') {
          // city under attack: strike any defender in the city first
          const def = Civ.unitsOn(target.x, target.y).find(v => v.civ !== civ);
          if (def) Civ.doCombat(u, def);
        }
      } else if (d <= 10) {
        stepToward(u, target.x, target.y);
      }
    }
  }

  function aiExplore(civ) {
    for (const u of civ.units.slice()) {
      if (u.hp <= 0) continue;
      if (u.type === 'settler') continue; // settlers are dedicated to expansion
      const set = Civ.reachable(u);
      if (!set.size) continue;
      let best = null, bestScore = -1;
      for (const k of set) {
        const [x, y] = k.split(',').map(Number);
        if (Civ.enemyOn(u, x, y)) continue;
        let score = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (Civ.inB(nx, ny) && !civ.explored[Civ.idx(nx, ny)]) score++;
        }
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
      if (best && bestScore > 0) Civ.moveUnit(u, best.x, best.y);
    }
  }

  function aiDiplomacy(civ) {
    const player = Civ.state.civs[0];
    if (player.eliminated) return;
    if (civ.atWar[player.id]) return;
    if (civ.declaredWar) return;
    const S = Civ.state;
    if (S.turn < 12 || civ.units.length < 6) return;
    let near = false;
    for (const c of player.cities) {
      for (const u of civ.units) {
        if (Math.abs(c.x - u.x) + Math.abs(c.y - u.y) < 14) { near = true; break; }
      }
      if (near) break;
    }
    const gifted = (civ.gifts && civ.gifts[player.id]) || 0;
    const chance = Math.max(0.01, 0.08 - 0.02 * (gifted / 100)); // each 100-gold gift calms the rival
    if (near && Math.random() < chance) {
      civ.declaredWar = true;
      civ.atWar[player.id] = true;
      player.atWar[civ.id] = true;
      Civ.log('WAR! ' + civ.name + ' has declared war on ' + player.name + '!');
    }
  }

  Civ.ai.factor = 1.0; // set by game.js

  Civ.ai = {
    aiTurn(civ) {
      aiResearch(civ);
      aiDiplomacy(civ);
      aiProduction(civ);
      aiSettle(civ);
      if (atWar(civ)) aiCombat(civ);
      else aiExplore(civ);
    }
  };

})(window.Civ);
