/* =====================================================================
 * game.js — core engine: state, turns, cities, units, combat, tech
 * ===================================================================== */
window.Civ = window.Civ || {};
(function (Civ) {

  let uid = 1;
  function nid() { return uid++; }

  /* ------------------------------ setup ----------------------------- */

  function makeCiv(id, name, color, isAI) {
    return {
      id, name, color, isAI,
      techs: {},            // techId -> true
      currentTech: null,    // techId being researched
      sciProgress: 0,
      gold: 0,
      gifts: {},         // civId -> gold received as gifts
      cities: [],
      units: [],
      atWar: {},            // civId -> true
      explored: {},         // tileIndex -> true
      eliminated: false,
      declaredWar: false,   // AI: has it declared war yet
    };
  }

  function addUnit(civ, type, x, y) {
    const T = Civ.UNIT_TYPES[type];
    const u = {
      id: nid(), civ, type, x, y,
      hp: 100, mp: T.mp, moved: false,
    };
    civ.units.push(u);
    return u;
  }

  function addCity(civ, x, y, name) {
    const c = {
      id: nid(), civ, x, y,
      name: name || pickCityName(),
      pop: 1, food: 0, prod: 0,
      progress: 0, queue: null,   // 'unit:settler' | 'building:library'
      buildings: {},
      founded: Civ.state ? Civ.state.turn : 0,
    };
    civ.cities.push(c);
    return c;
  }

  let cityNamePool = [];
  let cityNameCount = 0;
  function pickCityName() {
    if (!cityNamePool.length) cityNamePool = Civ.CITY_NAMES.slice();
    if (cityNamePool.length) {
      const i = (Math.random() * cityNamePool.length) | 0;
      return cityNamePool.splice(i, 1)[0];
    }
    // pool exhausted: keep naming so a long game never fails to name a city
    cityNameCount++;
    const base = Civ.CITY_NAMES[(cityNameCount - 1) % Civ.CITY_NAMES.length];
    return base + '-' + (cityNameCount - 1);
  }

  function explore(cx, cy, r, civ) {
    const S = Civ.state;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= S.W || y >= S.H) continue;
        civ.explored[y * S.W + x] = true;
      }
    }
  }

  Civ.newGame = function (opts) {
    uid = 1; cityNamePool = [];
    opts = opts || {};
    const W = opts.size || 32, H = W;
    const seed = (opts.seed !== undefined ? opts.seed : (Math.random() * 1e9) | 0);
    const gen = Civ.mapgen.generate(W, H, seed);
    const aiCount = Math.max(1, Math.min(6, opts.aiCount || 3));
    const total = aiCount + 1;

    // state must exist before any city/unit is added (explore() uses it)
    Civ.state = {
      W, H, tiles: gen.tiles, seed,
      civs: [], turn: 0, winner: null, log: [],
      selected: null, reachable: null, aiCount,
      wonders: {},   // wonderId -> civId that claimed it (once per playthrough)
    };
    const civs = Civ.state.civs;
    for (let i = 0; i < total; i++) {
      civs.push(makeCiv(i, Civ.CIV_NAMES[i], Civ.CIV_COLORS[i], i !== 0));
    }

    // starting positions: player near center, others around a circle
    const cxs = W / 2, cys = H / 2;
    const occupiedList = [];
    const order = [0];
    for (let i = 1; i < total; i++) order.push(i);
    const spotRadius = Math.min(W, H) / 2 - 3;
    for (const ci of order) {
      let nx, ny;
      if (ci === 0) { nx = cxs; ny = cys; }
      else {
        const a = (ci - 1) / (total - 1) * Math.PI * 2;
        nx = cxs + Math.cos(a) * spotRadius;
        ny = cys + Math.sin(a) * spotRadius;
      }
      const minDist = total > 2 ? 8 : 6;
      let spot = Civ.mapgen.findStartSpot(W, H, gen.tiles, nx, ny, minDist, occupiedList);
      if (!spot) spot = Civ.mapgen.findStartSpot(W, H, gen.tiles, nx, ny, 0, occupiedList);
      if (!spot) { nx = 1 + ((ci * 7) % (W - 2)); ny = 1 + ((ci * 13) % (H - 2)); spot = { x: nx, y: ny }; }
      occupiedList.push(spot);

      const civ = civs[ci];
      addCity(civ, spot.x, spot.y);
      addUnit(civ, 'settler', spot.x, spot.y);
      addUnit(civ, 'warrior', spot.x, spot.y);
      addUnit(civ, 'warrior', spot.x, spot.y);
      explore(spot.x, spot.y, 3, civ);
    }

    const diff = { easy: { f: 0.65, s: 0.4 }, normal: { f: 0.9, s: 0.6 }, hard: { f: 1.15, s: 0.8 } };
    if (Civ.ai) {
      Civ.ai.factor = diff[opts.difficulty] ? diff[opts.difficulty].f : 0.9;
      Civ.ai.sciFactor = diff[opts.difficulty] ? diff[opts.difficulty].s : 0.6;
    }
    Civ.log('A new world awaits. Year 4000 BC.');
    Civ.log('Found cities, research tech, expand your empire!');
    return Civ.state;
  };

  /* ------------------------------ helpers --------------------------- */

  Civ.log = function (msg) {
    const S = Civ.state;
    if (!S) return;
    S.log.push({ turn: S.turn, msg });
    if (S.log.length > 200) S.log.shift();
  };

  Civ.idx = function (x, y) { return y * Civ.state.W + x; };
  Civ.inB = function (x, y) {
    const S = Civ.state;
    return x >= 0 && y >= 0 && x < S.W && y < S.H;
  };
  Civ.tileAt = function (x, y) { return Civ.state.tiles[Civ.idx(x, y)]; };

  Civ.civById = function (id) { return Civ.state.civs[id]; };

  Civ.unitsOn = function (x, y) {
    const S = Civ.state;
    return S.civs.flatMap(c => c.units).filter(u => u.x === x && u.y === y);
  };
  Civ.enemyOn = function (u, x, y) {
    return Civ.unitsOn(x, y).find(v => v.civ !== u.civ);
  };
  Civ.cityAt = function (x, y) {
    const S = Civ.state;
    return S.civs.flatMap(c => c.cities).find(c => c.x === x && c.y === y) || null;
  };
  Civ.unitById = function (id) {
    const S = Civ.state;
    for (const c of S.civs) { const u = c.units.find(v => v.id === id); if (u) return u; }
    return null;
  };
  Civ.cityById = function (id) {
    const S = Civ.state;
    for (const c of S.civs) { const c2 = c.cities.find(v => v.id === id); if (c2) return c2; }
    return null;
  };

  Civ.techKnown = function (civ, id) { return !!civ.techs[id]; };

  Civ.techsNeededFor = function (id) {
    const t = Civ.TECH_BY_ID[id];
    return t.req;
  };

  Civ.availableTechs = function (civ) {
    return Civ.TECHS.filter(t => !civ.techs[t.id] && t.req.every(r => civ.techs[r]));
  };

  Civ.unitUnlocked = function (civ, type) {
    const u = Civ.UNIT_TYPES[type];
    return !u.req || civ.techs[u.req];
  };

  Civ.buildingUnlocked = function (civ, b) {
    const B = Civ.BUILDINGS[b];
    return !B.req || civ.techs[B.req];
  };

  Civ.availableUnits = function (civ) {
    return Object.keys(Civ.UNIT_TYPES).filter(t => Civ.unitUnlocked(civ, t));
  };
  Civ.availableBuildings = function (civ) {
    return Object.keys(Civ.BUILDINGS).filter(b => Civ.buildingUnlocked(civ, b));
  };

  /* ------------------------------- Wonders -------------------------- */
  /* Wonders are unique: the first city to finish one claims it for its
     civilization. The bonus then applies to ALL of that civ's cities (in
     cityYields) and, for the Great Wall, to defenders in doCombat. The
     claim is global per playthrough, stored in state.wonders. */
  Civ.wonderClaimed = function (id) {
    return !!(Civ.state && Civ.state.wonders && Civ.state.wonders[id] !== undefined);
  };
  Civ.wonderOwner = function (id) {
    const cid = Civ.state && Civ.state.wonders && Civ.state.wonders[id];
    return (cid === undefined) ? null : Civ.civById(cid);
  };
  Civ.claimWonder = function (id, civ) {
    if (Civ.state && Civ.state.wonders) Civ.state.wonders[id] = civ.id;
  };
  Civ.civHasWonder = function (civ, id) {
    return !!(Civ.state && Civ.state.wonders && Civ.state.wonders[id] === civ.id);
  };

  Civ.yearLabel = function () {
    const year = -4000 + (Civ.state ? Civ.state.turn : 0);
    return year < 0 ? (-year) + ' BC' : 'AD ' + year;
  };

  /* ------------------------------- yields --------------------------- */

  Civ.foodNeeded = function (pop) { return 20 * pop; };

  Civ.cityYields = function (city) {
    const S = Civ.state, T = Civ.TERRAIN, R = Civ.RESOURCES;
    let f = 1, p = 1, g = 0, sBonus = 0;   // base science = population
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = city.x + dx, y = city.y + dy;
        if (!Civ.inB(x, y)) continue;
        const tile = S.tiles[Civ.idx(x, y)];
        const tt = T[tile.terrain];
        if (tt.land) {
          f += tt.food; p += tt.prod;
          if (tile.resource) {
            const r = R[tile.resource];
            f += r.food || 0; p += r.prod || 0; g += r.gold || 0;
          }
        } else if (tile.resource) {
          const r = R[tile.resource];
          f += r.food || 0;
        }
      }
    }
    for (const b in city.buildings) {
      const B = Civ.BUILDINGS[b];
      f += B.food || 0; p += B.prod || 0; sBonus += B.sci || 0; g += B.gold || 0;
    }
    for (const t in city.civ.techs) {
      const TCH = Civ.TECH_BY_ID[t];
      const b = TCH.bonus;
      if (b) { f += b.food || 0; p += b.prod || 0; sBonus += b.sci || 0; g += b.gold || 0; }
    }
    // Wonder bonuses apply to every city of the civ that claimed them.
    if (Civ.state && Civ.state.wonders) {
      for (const wid in Civ.state.wonders) {
        if (Civ.state.wonders[wid] !== city.civ.id) continue;
        const wb = (Civ.BUILDINGS[wid] && Civ.BUILDINGS[wid].wonderBonus) || {};
        f += wb.food || 0; p += wb.prod || 0; sBonus += wb.sci || 0; g += wb.gold || 0;
      }
    }
    const s = city.pop + Math.min(Civ.SCI_BONUS_CAP || 8, sBonus);
    return { f: Math.max(1, f), p: Math.max(1, p), s: Math.max(1, s), g };
  };

  /* ------------------------------ movement -------------------------- */

  const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];

  /** Movement cost to ENTER a tile for a given unit. Returns Infinity when
      the unit cannot enter the tile at all (domain mismatch / impassable):
        air  : cost 1 everywhere — flies over land, water, even mountains
        naval: water only, cost 1 — cannot enter land
        land : water impassable, mountains impassable; otherwise the terrain
               cost (or 1 on a road), capped by the unit's costCap so that
               e.g. settlers can always cross any land terrain. */
  function moveCost(u, tile) {
    const tt = Civ.TERRAIN[tile.terrain], U = Civ.UNIT_TYPES[u.type];
    if (U.fly) return 1;
    if (U.naval) return tt.land ? Infinity : 1;
    if (!tt.land) return Infinity;          // land unit over water
    if (tt.cost === 0) return Infinity;     // land unit over mountains
    let c = tile.road ? 1 : tt.cost;
    if (U.costCap) c = Math.min(c, U.costCap);
    return c;
  }

  Civ.moveCost = moveCost;   // exposed for unit tests

  /** Dijkstra reachable set within unit.mp.
   *  - Domain rules (air/sea/land) come from moveCost(): water is impassable
   *    to land units, land is impassable to ships, planes fly anywhere.
   *  - Enemy units block pass-through (no pathing around/through them), but
   *    enemy tiles adjacent to the unit are valid ATTACK targets.
   *  - Friendly units are passable: you may stack on and move through them.
   *  - Corner-cutting is blocked only when a corner tile is itself impassable
   *    to this unit (tile-based, not unit-based). */
  Civ.reachable = function (u) {
    const S = Civ.state;
    const U = Civ.UNIT_TYPES[u.type];
    // Passenger aboard a transport: its only destinations are the land
    // tiles adjacent to the carrier (disembark).
    if (u.aboard) {
      const ship = Civ.unitById(u.aboard);
      if (!ship || ship.civ !== u.civ) u.aboard = null;   // carrier lost
      else {
        const set = new Set();
        for (const [dx, dy] of DIRS) {
          const nx = ship.x + dx, ny = ship.y + dy;
          if (!Civ.inB(nx, ny)) continue;
          const tile = S.tiles[Civ.idx(nx, ny)];
          const c = moveCost(u, tile);
          if (c === Infinity || c > u.mp) continue;
          if (Civ.enemyOn(u, nx, ny)) continue;
          set.add(nx + ',' + ny);
        }
        return set;
      }
    }
    const enemyHere = (x, y) => Civ.unitsOn(x, y).some(v => v.civ !== u.civ);
    const impassable = (x, y) => !Civ.inB(x, y) || moveCost(u, S.tiles[Civ.idx(x, y)]) === Infinity;
    const dist = {};
    const start = u.x + ',' + u.y;
    dist[start] = 0;
    const queue = [[0, u.x, u.y]];
    while (queue.length) {
      queue.sort((a, b) => a[0] - b[0]);
      const [d, cx, cy] = queue.shift();
      if (d > dist[cx + ',' + cy]) continue;
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!Civ.inB(nx, ny)) continue;
        if (dx !== 0 && dy !== 0) {
          // no corner-cutting: both orthogonal corners must be enterable by
          // this unit AND free of enemy units (a diagonal that would clip a
          // blocked corner is not allowed). Friendly units do not block the
          // corner — you may stack on and cut past your own units.
          const cornerBlocked = (x, y) => impassable(x, y) || Civ.enemyOn(u, x, y);
          if (cornerBlocked(cx + dx, cy) || cornerBlocked(cx, cy + dy)) continue;
        }
        const cost = moveCost(u, S.tiles[Civ.idx(nx, ny)]);
        if (cost === Infinity) continue;
        const nd = d + cost;
        if (nd > u.mp) continue;
        const k = nx + ',' + ny;
        if (enemyHere(nx, ny)) continue;   // wall for pathing; attack targets added later
        if (dist[k] !== undefined && dist[k] <= nd) continue;
        dist[k] = nd;
        queue.push([nd, nx, ny]);
      }
    }
    const set = new Set();
    for (const k in dist) {
      if (k === start) continue;
      set.add(k);   // friendly-occupied tiles are valid destinations (stacking)
    }
    // attack targets: enemy units on the 8 adjacent tiles (melee reach)
    if (U.atk > 0) {
      for (const [dx, dy] of DIRS) {
        const nx = u.x + dx, ny = u.y + dy;
        if (!Civ.inB(nx, ny)) continue;
        if (Civ.enemyOn(u, nx, ny)) set.add(nx + ',' + ny);
      }
    }
    // Boarding: a land unit standing on the coast may step onto an
    // adjacent water tile that holds a friendly transport ship with a
    // free berth (this moves the unit, not the ship). Only human
    // players — the AI has no cargo doctrine and would strand itself.
    if (!U.naval && !U.fly && !u.aboard && !u.civ.isAI && u.mp >= 1) {
      for (const ship of Civ.boardableShips(u)) set.add(ship.x + ',' + ship.y);
    }
    return set;
  };

  Civ.moveUnit = function (u, tx, ty) {
    const S = Civ.state;
    if (!Civ.inB(tx, ty)) return false;
    const tile = S.tiles[Civ.idx(tx, ty)];
    const UU = Civ.UNIT_TYPES[u.type];
    const enemy = Civ.enemyOn(u, tx, ty);

    // Passenger aboard a ship: cannot fight, disembarks onto land.
    if (u.aboard) {
      if (enemy) { Civ.log('The ' + UU.name + ' cannot fight while aboard the ship.'); return false; }
      const ship = Civ.unitById(u.aboard);
      if (ship && ship.civ === u.civ &&
          Math.max(Math.abs(tx - ship.x), Math.abs(ty - ship.y)) > 1) return false;
      if (moveCost(u, tile) === Infinity) return false;   // must be land
      u.x = tx; u.y = ty; u.aboard = null;
      u.mp = 0; u.moved = true;
      explore(tx, ty, 2, u.civ);
      Civ.log(u.civ.name + ' ' + UU.name + ' disembarks onto the coast.');
      return true;
    }

    if (enemy) {
      if (!UU.atk) return false;
      Civ.doCombat(u, enemy);
      u.mp = 0; u.moved = true;
      return true;
    }
    // Boarding: a land unit stepping onto water with a friendly transport.
    if (!UU.naval && !UU.fly && !Civ.TERRAIN[tile.terrain].land) {
      const ship = Civ.boardableShips(u).find(v => v.x === tx && v.y === ty);
      if (ship) return Civ.board(u, ship);
      return false;
    }
    if (moveCost(u, tile) === Infinity) return false;   // domain mismatch / impassable
    u.x = tx; u.y = ty;
    u.mp = 0; u.moved = true;
    const pax = Civ.passengerOf(u);   // carrier: passenger rides along
    if (pax) { pax.x = u.x; pax.y = u.y; }
    explore(tx, ty, 2, u.civ);
    return true;
  };

  /** Road-building action (Settler or Engineer): lay a road on the tile the
      unit stands on (must be passable land, no existing road). Consumes the
      unit's turn. Roads cut the movement cost of that tile to 1 for land
      units. */
  Civ.buildRoad = function (u) {
    const S = Civ.state;
    if (!Civ.UNIT_TYPES[u.type].canRoad) { Civ.log('Only Settlers and Engineers build roads.'); return false; }
    const tile = S.tiles[Civ.idx(u.x, u.y)];
    const tt = Civ.TERRAIN[tile.terrain];
    if (!tt.land || tt.cost === 0) { Civ.log('Cannot build a road here (need passable land).'); return false; }
    if (tile.road) { Civ.log('There is already a road here.'); return false; }
    tile.road = true;
    u.mp = 0; u.moved = true;
    Civ.log(u.civ.name + ' built a road here. Land movement cost is now 1.');
    return true;
  };

  /* ------------------------------- transport ------------------------
     Ships with transport:true carry ONE land unit. A land unit standing
     on the coast boards from an adjacent water tile (moveUnit/richable),
     the passenger rides with the ship, and disembarks onto adjacent
     land. The passenger cannot attack or found cities while aboard, and
     is lost if the ship is destroyed. Only human players board.       */
  Civ.passengerOf = function (ship) {
    if (!ship || !Civ.UNIT_TYPES[ship.type].transport) return null;
    return ship.civ.units.find(v => v.aboard === ship.id) || null;
  };
  Civ.carrierOf = function (u) { return u.aboard ? Civ.unitById(u.aboard) : null; };
  /** Friendly transport ships with a FREE berth on a water tile adjacent to
      u — the boarding targets offered by reachable(), moveUnit() and the
      "⛴ Board" button in ui.js. Shared so all three stay in sync. */
  Civ.boardableShips = function (u) {
    if (!u || u.aboard) return [];
    const U = Civ.UNIT_TYPES[u.type];
    if (U.naval || U.fly) return [];
    const S = Civ.state;
    const out = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const nx = u.x + dx, ny = u.y + dy;
        if (!Civ.inB(nx, ny)) continue;
        if (Civ.TERRAIN[S.tiles[Civ.idx(nx, ny)].terrain].land) continue;
        if (Civ.enemyOn(u, nx, ny)) continue;
        const ship = Civ.unitsOn(nx, ny).find(v => v.civ === u.civ &&
          Civ.UNIT_TYPES[v.type].transport && !Civ.passengerOf(v));
        if (ship && out.indexOf(ship) === -1) out.push(ship);
      }
    }
    return out;
  };
  Civ.canBoard = function (u, ship) {
    if (!ship || ship.civ !== u.civ) return false;
    const UU = Civ.UNIT_TYPES[u.type], SU = Civ.UNIT_TYPES[ship.type];
    if (!SU.transport || UU.naval || UU.fly || u.aboard) return false;
    if (Civ.passengerOf(ship)) return false;
    return true;
  };
  Civ.board = function (u, ship) {
    if (!Civ.canBoard(u, ship)) return false;
    u.x = ship.x; u.y = ship.y;
    u.aboard = ship.id;
    u.mp = 0; u.moved = true;
    explore(u.x, u.y, 2, u.civ);
    Civ.log(u.civ.name + ' ' + Civ.UNIT_TYPES[u.type].name + ' boards the ' +
      Civ.UNIT_TYPES[ship.type].name + '.');
    return true;
  };
  /** Disembark to the first free adjacent land tile (UI convenience). */
  Civ.disembark = function (u) {
    if (!u.aboard) return false;
    const ship = Civ.carrierOf(u);
    if (!ship) { u.aboard = null; return false; }
    for (const [dx, dy] of DIRS) {
      const nx = ship.x + dx, ny = ship.y + dy;
      if (!Civ.inB(nx, ny)) continue;
      if (moveCost(u, Civ.tileAt(nx, ny)) === Infinity) continue;
      if (Civ.enemyOn(u, nx, ny)) continue;
      return Civ.moveUnit(u, nx, ny);
    }
    Civ.log('No open shore nearby — the ' + Civ.UNIT_TYPES[u.type].name + ' stays aboard.');
    return false;
  };

  /* ------------------------------- combat --------------------------- */

  function declareWar(a, b) {
    if (!a.atWar[b.id]) {
      a.atWar[b.id] = true;
      b.atWar[a.id] = true;
      Civ.log('WAR! ' + a.name + ' and ' + b.name + ' are now at war.');
      if (Civ.sound) Civ.sound.war();
    }
  }

  Civ.makePeace = function (a, b) {
    a.atWar[b.id] = false;
    b.atWar[a.id] = false;
    Civ.log(a.name + ' and ' + b.name + ' have made peace.');
  };

  Civ.doCombat = function (att, def) {
    const U = Civ.UNIT_TYPES[att.type], D = Civ.UNIT_TYPES[def.type];
    if (!U.atk) return;
    declareWar(att.civ, def.civ);

    let defBonus = D.def;
    const city = Civ.cityAt(def.x, def.y);
    const tt = Civ.TERRAIN[Civ.tileAt(def.x, def.y).terrain];
    defBonus += tt.defend || 0;
    if (city) {
      if (city.buildings.wall) defBonus += 5;
      if (city.buildings.barracks) defBonus += 2;
      // Great Wall wonder: +5 defense for the owner's defenders in a city
      if (Civ.civHasWonder(def.civ, 'greatwall')) defBonus += 5;
    }
    const atk = U.atk, defv = defBonus;
    let dmgToDef = Math.round(100 * atk / (atk + defv));
    let dmgToAtt = Math.round(100 * defv / (atk + defv));
    dmgToDef = Math.max(10, Math.min(100, dmgToDef));
    dmgToAtt = Math.max(10, Math.min(100, dmgToAtt));

    def.hp -= dmgToDef;
    att.hp -= dmgToAtt;
    Civ.log(att.civ.name + ' ' + U.name + ' (' + dmgToAtt + '% dmg) attacks ' +
      def.civ.name + ' ' + D.name + ' (' + dmgToDef + '% dmg)');

    if (att.hp <= 0) Civ.killUnit(att);
    if (def.hp <= 0) {
      const pax = Civ.passengerOf(def);
      Civ.killUnit(def);
      if (pax) {
        Civ.killUnit(pax);
        Civ.log(pax.civ.name + ' ' + Civ.UNIT_TYPES[pax.type].name +
          ' was lost with the ' + D.name + '.');
      }
      const city = Civ.cityAt(def.x, def.y);
      if (city && city.civ === def.civ && att.hp > 0) Civ.captureCity(city, att.civ);
    }
  };

  Civ.killUnit = function (u) {
    const civ = u.civ;
    const i = civ.units.indexOf(u);
    if (i !== -1) civ.units.splice(i, 1);
    Civ.maybeEliminate(civ);
  };

  Civ.maybeEliminate = function (civ) {
    if (civ.eliminated) return;
    if (civ.cities.length > 0) return;
    civ.eliminated = true;
    civ.units.slice().forEach(v => {
      const j = civ.units.indexOf(v);
      if (j !== -1) civ.units.splice(j, 1);
    });
    civ.currentTech = null;
    Civ.log('*** ' + civ.name + ' has fallen from the map! ***');
  };

  /** Called when a city changes hands: transfer ownership. */
  Civ.captureCity = function (city, newCiv) {
    const oldCiv = city.civ;
    const i = oldCiv.cities.indexOf(city);
    if (i !== -1) oldCiv.cities.splice(i, 1);
    city.civ = newCiv;
    city.buildings = {};   // conqueror razes it
    city.queue = null; city.progress = 0;
    newCiv.cities.push(city);
    Civ.log(newCiv.name + ' captures ' + city.name + '!');
    explore(city.x, city.y, 3, newCiv);
    Civ.maybeEliminate(oldCiv);
    Civ.checkEnd();
  };

  /* --------------------------- city / production -------------------- */

  Civ.foundCity = function (u) {
    const S = Civ.state;
    const tile = Civ.tileAt(u.x, u.y);
    if (u.aboard) { Civ.log('Disembark first — no founding cities at sea.'); return false; }
    if (!Civ.TERRAIN[tile.terrain].land) { Civ.log('Cannot found a city at sea.'); return false; }
    if (Civ.cityAt(u.x, u.y)) { Civ.log('There is already a city here.'); return false; }
    for (const c of S.civs) {
      for (const city of c.cities) {
        const d = Math.max(Math.abs(city.x - u.x), Math.abs(city.y - u.y));
        if (c === u.civ && d < 3) { Civ.log('Too close to your own city of ' + city.name + '.'); return false; }
        if (c !== u.civ && d < 2) { Civ.log('Too close to the enemy city of ' + city.name + '.'); return false; }
      }
    }
    const city = addCity(u.civ, u.x, u.y);
    Civ.killUnit(u); // settler is consumed (but don't let killUnit trigger capture logic issues)
    explore(u.x, u.y, 3, u.civ);
    Civ.log(u.civ.name + ' founds the city of ' + city.name + '!');
    return true;
  };

  Civ.setQueue = function (city, queueStr) {
    // Switch the queue WITHOUT zeroing progress (refinement #4): shields
    // already invested are ABSOLUTE and carry over to the newly selected
    // item (e.g. a half-finished Settler, 15/30, becomes 15/18 of a
    // Warrior = 83%). If the carried progress already exceeds the new
    // item's cost, the item completes at the end of this turn and the
    // excess shields are discarded (processCiv). Until the turn ends the
    // over-100% value stays usable, so the player may switch again to a
    // pricier item to keep it. Progress is only zeroed on: completion,
    // "Clear queue", or city capture.
    city.queue = queueStr;
  };

  function queueCost(queueStr) {
    if (!queueStr) return 0;
    const [kind, id] = queueStr.split(':');
    if (kind === 'unit') return Civ.UNIT_TYPES[id].cost;
    return Civ.BUILDINGS[id].cost;
  }

  Civ.disbandUnit = function (u) {
    const civ = u.civ;
    const i = civ.units.indexOf(u);
    if (i !== -1) civ.units.splice(i, 1);
    Civ.log(u.civ.name + ' disbanded a ' + Civ.UNIT_TYPES[u.type].name + '.');
  };

  /* ------------------------------ end turn -------------------------- */

  Civ.processCiv = function (civ) {
    const F = (civ.isAI && Civ.ai && Civ.ai.factor) ? Civ.ai.factor : 1;
    const SF = (civ.isAI && Civ.ai && Civ.ai.sciFactor) ? Civ.ai.sciFactor : 1;
    // cities
    for (const city of civ.cities.slice()) {
      const y = Civ.cityYields(city);
      city.food += y.f * F;
      if (city.food >= Civ.foodNeeded(city.pop)) {
        city.food -= Civ.foodNeeded(city.pop);
        city.pop++;
        if (city.pop === 2) Civ.log(city.name + ' grows to 2 citizens.');
      }
      city.prod += y.p;
      if (city.queue) {
        city.progress += y.p;
        const cost = queueCost(city.queue);
        if (city.progress >= cost) {
          city.progress = 0;
          const [kind, id] = city.queue.split(':');
          if (kind === 'unit') {
            // spawn on city tile or first free neighbor
            let sx = city.x, sy = city.y;
            if (Civ.unitsOn(sx, sy).some(v => v.civ === civ)) {
              for (const [dx, dy] of DIRS) {
                if (Civ.inB(city.x + dx, city.y + dy) &&
                    !Civ.unitsOn(city.x + dx, city.y + dy).some(v => v.civ === civ)) {
                  sx = city.x + dx; sy = city.y + dy; break;
                }
              }
            }
            addUnit(civ, id, sx, sy);
            Civ.log(city.name + ' finishes a ' + Civ.UNIT_TYPES[id].name + '.');
          } else {
            const B = Civ.BUILDINGS[id];
            if (B.wonder) {
              if (Civ.wonderClaimed(id)) {
                Civ.log(city.name + ' completed the ' + B.name + ', but another civilization had already claimed it. The effort was wasted.');
              } else {
                Civ.claimWonder(id, civ);
                city.wonder = id;
                Civ.log('*** ' + civ.name + ' completes the ' + B.name + '! ***');
                if (Civ.state && civ === Civ.state.civs[0] && Civ.sound) Civ.sound.tech();
              }
            } else {
              city.buildings[id] = true;
              Civ.log(city.name + ' builds a ' + B.name + '.');
            }
          }
          city.queue = null;
        }
      }
      civ.sciProgress += y.s * SF;
      civ.gold += y.g * F;
    }
    // tech completion
    if (civ.currentTech) {
      const t = Civ.TECH_BY_ID[civ.currentTech];
      while (civ.currentTech && civ.sciProgress >= t.cost) {
        civ.sciProgress -= t.cost;
        civ.techs[t.id] = true;
        Civ.log(civ.name + ' discovers ' + t.name + '!');
        if (Civ.state && civ === Civ.state.civs[0] && Civ.sound) Civ.sound.tech();
        civ.currentTech = null;
        break;
      }
    }
  };

  Civ.endTurn = function () {
    const S = Civ.state;
    if (!S || S.winner) return;

    // 1) yields & production for all civs
    for (const civ of S.civs) if (!civ.eliminated) Civ.processCiv(civ);

    // 2) AI decisions
    for (const civ of S.civs) {
      if (civ.isAI && !civ.eliminated) Civ.ai.aiTurn(civ);
    }

    // 3) cities keep exploring
    for (const civ of S.civs) {
      if (civ.eliminated) continue;
      for (const city of civ.cities) explore(city.x, city.y, 2, civ);
    }

    // 4) heal + reset movement
    for (const civ of S.civs) {
      if (civ.eliminated) continue;
      let healBonus = 0;
      for (const city of civ.cities) {
        if (city.buildings.hospital) healBonus = Math.max(healBonus, 10);
      }
      for (const u of civ.units) {
        u.hp = Math.min(100, u.hp + 10 + healBonus);
        u.mp = Civ.UNIT_TYPES[u.type].mp;
        u.moved = false;
      }
    }

    S.turn++;
    S.selected = null;
    S.reachable = null;
    Civ.checkEnd();
  };

  Civ.checkEnd = function () {
    const S = Civ.state;
    if (!S || S.winner) return;
    const player = S.civs[0];
    const others = S.civs.slice(1);
    if (player.cities.length === 0) {
      S.winner = 'loss';
      Civ.log('*** Roma has fallen. The empire is lost... ***');
      return;
    }
    if (others.every(c => c.cities.length === 0)) {
      S.winner = 'victory';
      Civ.log('*** VICTORY! You rule the known world! ***');
    }
  };

})(window.Civ);
