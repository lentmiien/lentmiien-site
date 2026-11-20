/* =====================================================================
 * ui.js — DOM panels, buttons, overlays, selection handling, tooltips
 *
 * Refinement session #1:
 *   - selection priority: topmost friendly unit > city > clear  (stacking)
 *   - "Units here" list to pick a specific unit out of a stack
 *   - build buttons (units + buildings + wonders) with tooltips
 *   - settler "Build Road" action
 *   - comparative rankings (#rankbox)
 *   - terrain hover tooltip (#tooltip)
 *   - bug fixes: new-game overlay (hide winoverlay), city cap from data
 * ===================================================================== */
window.Civ = window.Civ || {};
(function (Civ) {

  const $ = function (id) { return document.getElementById(id); };
  let winnerShown = false;
  // Tech panel display mode (refinement #4):
  //   'hidden'     — only era titles; click one to expand its tech list
  //   'selectable' — current + currently selectable techs only (default)
  //   'all'        — the full tech tree
  let techMode = 'selectable';
  const techErasOpen = new Set();   // era indexes expanded in 'hidden' mode

  function player() { return Civ.state.civs[0]; }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  /* ----------------------------- selection -------------------------- */

  function selectUnit(u) {
    const S = Civ.state;
    S.selected = { kind: 'unit', id: u.id };
    S.reachable = (u.mp > 0 && !u.moved) ? Civ.reachable(u) : new Set();
    Civ.ui.refresh();
  }

  function selectCity(c) {
    const S = Civ.state;
    S.selected = { kind: 'city', id: c.id };
    S.reachable = null;
    Civ.ui.refresh();
  }

  function click(x, y) {
    const S = Civ.state;
    if (!S || S.winner) return;
    const p = player();
    const city = Civ.cityAt(x, y);
    const unitsHere = Civ.unitsOn(x, y);
    const myUnits = unitsHere.filter(u => u.civ === p);

    const sel = S.selected;
    if (sel && sel.kind === 'unit') {
      const u = Civ.unitById(sel.id);
      if (u && u.civ === p && u.mp > 0 && !u.moved && S.reachable && S.reachable.has(x + ',' + y)) {
        const ok = Civ.moveUnit(u, x, y);
        S.selected = { kind: 'unit', id: u.id };
        // keep the reachable set if the move was illegal, so the unit stays
        // usable (e.g. it was over water / a wall) instead of getting stuck.
        S.reachable = ok ? new Set() : S.reachable;
        Civ.ui.refresh();
        return;
      }
    }
    // Selection priority: topmost friendly unit first (stacking), then the
    // city on the tile, then clear. A selected unit on a city tile can be
    // pulled back to the city panel via the "Units here" / "City" buttons.
    if (myUnits.length) {
      // Boat-first (refinement #4): if a friendly unit in this stack is
      // aboard a ship, select the SHIP. The carrier is in the same stack by
      // construction (a passenger always shares its carrier's tile), so the
      // player can sail the boat away without first switching units.
      const carrier = myUnits.find(v => Civ.UNIT_TYPES[v.type].transport && Civ.passengerOf(v));
      selectUnit(carrier || myUnits[myUnits.length - 1]);
      return;
    }
    if (city) { selectCity(city); return; }
    S.selected = null;
    S.reachable = null;
    Civ.ui.refresh();
  }

  /* --------------------------- build tooltips ------------------------ */

  function buildTooltip(kind, id) {
    if (kind === 'unit') {
      const U = Civ.UNIT_TYPES[id];
      const domain = U.fly ? 'Air (flies anywhere)' : (U.naval ? 'Naval (water only)' : 'Land');
      let s = U.name + ' (' + U.cost + ') — Atk ' + U.atk + ' / Def ' + U.def + ' / Move ' + U.mp + ' · ' + domain;
      if (id === 'settler') s += ' · Founds new cities and crosses any land terrain';
      if (U.canRoad) s += ' · Builds Roads (cheaper land movement)';
      s += ' — ' + (U.desc || '');
      return s;
    }
    const B = Civ.BUILDINGS[id];
    const y = [];
    if (B.food) y.push('+' + B.food + ' food');
    if (B.prod) y.push('+' + B.prod + ' shields');
    if (B.sci) y.push('+' + B.sci + ' science');
    if (B.gold) y.push('+' + B.gold + ' gold');
    if (B.def) y.push('+' + B.def + ' defense');
    if (B.heal) y.push('+' + B.heal + ' HP heal/turn');
    let s = B.name + ' (' + B.cost + ') — ' + (y.length ? y.join(', ') : 'no direct yield');
    if (B.wonder) s += ' · UNIQUE WONDER (built once per game — first city to finish claims it, then it boosts ALL your cities)';
    s += ' — ' + (B.desc || '');
    return s;
  }

  /* ------------------------------ panels ----------------------------- */

  function updateTop() {
    const S = Civ.state;
    $('turninfo').textContent = 'Turn ' + (S.turn + 1) + ' — ' + Civ.yearLabel();
    $('btn-endturn').disabled = !!S.winner;
  }

  function updateLeft() {
    const S = Civ.state, box = $('selbox');
    const sel = S.selected;
    if (!sel) {
      box.innerHTML = '<p class="dim">Click one of your units or cities.</p>' +
        '<p class="dim">Blue tiles show where your selected unit can move. Land units cannot enter water, ships cannot enter land, planes fly anywhere.</p>' +
        '<p class="dim">Cross the sea with a transport ship (Ship / Transport Ship / War Galley / Carrack): a land unit on the coast boards a friendly ship on an adjacent water tile, rides across and disembarks on the other shore. With a unit aboard, clicking the stack selects the boat first.</p>' +
        '<p class="dim">Click an enemy unit to attack (this starts a war!). Hover a tile to see what its terrain does.</p>';
      return;
    }
    if (sel.kind === 'unit') {
      const u = Civ.unitById(sel.id);
      if (!u) { box.innerHTML = ''; return; }
      const T = Civ.UNIT_TYPES[u.type];
      let html = '<h4 style="color:' + u.civ.color + '">' + esc(T.name) + '</h4>';
      html += '<table class="kv">';
      html += '<tr><td>HP</td><td>' + u.hp + ' / 100</td></tr>';
      html += '<tr><td>Attack</td><td>' + T.atk + '</td></tr>';
      html += '<tr><td>Defense</td><td>' + T.def + '</td></tr>';
      html += '<tr><td>Movement</td><td>' + (u.mp > 0 && !u.moved ? u.mp : 'moved') + '</td></tr>';
      const domain = T.fly ? 'Air' : (T.naval ? 'Naval (water)' : 'Land');
      html += '<tr><td>Class</td><td>' + domain + '</td></tr>';
      if (T.canRoad) html += '<tr><td>Special</td><td>Builds Roads</td></tr>';
      if (T.transport) html += '<tr><td>Special</td><td>Carries one land unit</td></tr>';
      if (u.aboard) {
        const ship = Civ.carrierOf(u);
        html += '<tr><td>Status</td><td>⛴ Aboard ' + (ship ? esc(Civ.UNIT_TYPES[ship.type].name) : 'a ship') + '</td></tr>';
      } else if (T.transport) {
        const pax = Civ.passengerOf(u);
        html += '<tr><td>Status</td><td>' + (pax ? 'Carrying: ' + esc(Civ.UNIT_TYPES[pax.type].name) : 'Berth free — a land unit on the coast can board') + '</td></tr>';
      }
      html += '</table>';
      if (u.aboard && u.civ === player()) {
        html += '<div class="btnrow"><button data-act="disembark" title="Move to the first free land tile next to the ship.">⚓ Disembark</button></div>' +
          '<p class="dim">Aboard: move onto a highlighted coast tile to step ashore. Passengers cannot fight or found cities, and are lost if the ship sinks.</p>';
      }
      if (!u.aboard && !T.naval && !T.fly && u.civ === player()) {
        const ships = Civ.boardableShips(u);
        if (ships.length) {
          html += '<div class="btnrow">';
          for (const ship of ships) {
            const SN = Civ.UNIT_TYPES[ship.type].name;
            html += '<button data-act="board" data-ship="' + ship.id + '" title="Move onto the ' + esc(SN) + ' to cross the sea.">⛴ Board ' + esc(SN) + '</button>';
          }
          html += '</div>' +
            '<p class="dim">Then sail the ship across, and use ⚓ Disembark on the far shore. Passengers cannot fight or found cities, and are lost if the ship sinks.</p>';
        }
      }

      // "Units here" — pick a specific unit out of a stack; list carrier
      // ships first so the boat can be selected directly (boat-first).
      const carrierRank = (v) => (Civ.UNIT_TYPES[v.type].transport && Civ.passengerOf(v)) ? 0 : 1;
      const stack = Civ.unitsOn(u.x, u.y).filter(v => v.civ === player())
        .sort((a, b) => carrierRank(a) - carrierRank(b));
      if (stack.length > 1) {
        html += '<div class="stacklist"><div class="dim">Units stacked here — click to select:</div>';
        for (const v of stack) {
          const V = Civ.UNIT_TYPES[v.type];
          const pax = Civ.passengerOf(v);
          const note = v.aboard ? ' ⛴aboard' : (pax ? ' · carrying ' + Civ.UNIT_TYPES[pax.type].abbr : '');
          const cls = (v.id === u.id ? 'selected' : '');
          html += '<button data-act="selectunit" data-unit="' + v.id + '" class="' + cls + '">' + esc(V.name) + ' · ' + v.hp + 'hp' + note + '</button>';
        }
        html += '</div>';
      }

      if (u.civ === player()) {
        html += '<div class="btnrow">';
        if (u.type === 'settler') {
          html += '<button data-act="found" title="Found a new city here (consumes the settler).">Found City</button>';
        }
        if (T.canRoad) {
          html += '<button data-act="road" title="Build a Road here (consumes this turn). Roads cut land movement cost to 1.">⛏ Build Road</button>';
        }
        html += '<button data-act="disband" class="danger">Disband</button>';
        html += '</div>';
      }
      const onCity = Civ.cityAt(u.x, u.y);
      if (onCity) {
        html += '<div class="btnrow"><button data-act="selectcity" data-city="' + onCity.id + '" title="Switch selection to this city.">⬇ City: ' + esc(onCity.name) + '</button></div>';
      }
      box.innerHTML = html;
    } else if (sel.kind === 'city') {
      const c = Civ.cityById(sel.id);
      if (!c) { box.innerHTML = ''; return; }
      const y = Civ.cityYields(c);
      let html = '<h4 style="color:' + c.civ.color + '">' + esc(c.name) + '</h4>';
      html += '<table class="kv">';
      html += '<tr><td>Population</td><td>' + c.pop + '</td></tr>';
      html += '<tr><td>Food</td><td>' + Math.floor(c.food) + ' / ' + Civ.foodNeeded(c.pop) + '</td></tr>';
      html += '<tr><td>Shields</td><td>' + y.p + '/t <span class="dim">(now ' + c.prod + ')</span></td></tr>';
      html += '<tr><td>Science</td><td>' + y.s + '/t</td></tr>';
      html += '<tr><td>Gold</td><td>' + y.g + '/t</td></tr>';
      html += '</table>';
      if (c.wonder) html += '<p>★ Wonder: <b>' + esc(Civ.BUILDINGS[c.wonder].name) + '</b></p>';

      if (c.civ === player()) {
        if (c.queue) {
          const [kind, id] = c.queue.split(':');
          const cost = kind === 'unit' ? Civ.UNIT_TYPES[id].cost : Civ.BUILDINGS[id].cost;
          const name = kind === 'unit' ? Civ.UNIT_TYPES[id].name : Civ.BUILDINGS[id].name;
          const pct = Math.min(100, Math.round(100 * c.progress / cost));
          html += '<p>Building: <b>' + esc(name) + '</b></p>';
          html += '<div class="bar"><div style="width:' + pct + '%"></div></div>';
          html += '<p class="dim">' + Math.floor(c.progress) + ' / ' + cost + ' shields' +
            (c.progress >= cost
              ? ' — completes at end of turn (excess shields discarded)'
              : ' — switch queue anytime; invested shields carry over') + '</p>';
        }
        // Build buttons: units, then buildings, then wonders — all with tooltips
        let units = [], buildings = [];
        const maxCities = Civ.MAX_CITIES || 20;
        for (const t of Civ.availableUnits(c.civ)) {
          if (t === 'settler' && c.civ.cities.length >= maxCities) continue;
          units.push(t);
        }
        for (const b of Civ.availableBuildings(c.civ)) {
          if (c.buildings[b]) continue;
          buildings.push(b);
        }
        html += '<div class="buildgrid">';
        for (const t of units) {
          const U = Civ.UNIT_TYPES[t];
          const selq = c.queue === 'unit:' + t;
          html += '<button data-build="unit:' + t + '" class="' + (selq ? 'selected' : '') + '" title="' + esc(buildTooltip('unit', t)) + '">' + esc(U.name) + ' (' + U.cost + ')</button>';
        }
        html += '<div class="buildgrid-sep">buildings &amp; wonders</div>';
        for (const b of buildings) {
          const B = Civ.BUILDINGS[b];
          const claimed = B.wonder && Civ.wonderClaimed(b);
          const selq = c.queue === 'building:' + b;
          html += '<button data-build="building:' + b + '" class="' + (selq ? 'selected' : '') + (B.wonder ? ' wonder' : '') + '" ' +
            (claimed ? 'disabled' : '') + ' title="' + esc(buildTooltip('building', b)) + '">' +
            (claimed ? '✖ ' : (B.wonder ? '★ ' : '')) + esc(B.name) + ' (' + B.cost + ')</button>';
        }
        html += '</div>';
        if (c.queue) html += '<div class="btnrow"><button data-act="clearqueue" class="dim">Clear queue</button></div>';
      }
      // buildings list
      const bnames = Object.keys(c.buildings).map(b => Civ.BUILDINGS[b].name);
      if (bnames.length) html += '<p class="dim">Buildings: ' + esc(bnames.join(', ')) + '</p>';
      box.innerHTML = html;
    }
  }

  /* --------------------------- rankings ------------------------------ */

  function civScore(c) {
    let pop = 0;
    for (const city of c.cities) pop += city.pop;
    const wonders = Object.values(Civ.state.wonders).filter(id => id === c.id).length;
    return c.cities.length * 100 + c.units.length * 5 + Object.keys(c.techs).length * 10 + wonders * 200 + pop * 5;
  }

  function updateRank() {
    const S = Civ.state, p = player();
    const rows = S.civs.map(c => ({ c, score: civScore(c) })).sort((a, b) => b.score - a.score);
    let html = '<table class="rank"><tr class="dim"><th>#</th><th>Civ</th><th>Cit</th><th>Unit</th><th>Tech</th><th>Won</th></tr>';
    rows.forEach((r, i) => {
      const wonders = Object.values(S.wonders).filter(id => id === r.c.id).length;
      const cls = [];
      if (r.c === p) cls.push('me');
      if (i === 0) cls.push('leader');
      html += '<tr class="' + cls.join(' ') + '"><td>' + (i + 1) + '</td>' +
        '<td style="color:' + r.c.color + '">' + esc(r.c.name) + '</td>' +
        '<td>' + r.c.cities.length + '</td><td>' + r.c.units.length + '</td>' +
        '<td>' + Object.keys(r.c.techs).length + '</td><td>' + wonders + '</td></tr>';
    });
    html += '</table>';
    $('rankbox').innerHTML = html;
  }

  function updateRight() {
    const S = Civ.state, p = player();
    const cities = p.cities;
    let gold = p.gold, sci = 0;
    for (const c of cities) sci += Civ.cityYields(c).s;
    let html = '<table class="kv">';
    html += '<tr><td>Gold</td><td>' + Math.floor(gold) + '</td></tr>';
    html += '<tr><td>Science</td><td>' + sci + '/turn</td></tr>';
    html += '<tr><td>Cities</td><td>' + cities.length + ' / ' + (Civ.MAX_CITIES || 20) + '</td></tr>';
    html += '<tr><td>Units</td><td>' + p.units.length + '</td></tr>';
    html += '</table>';
    if (p.currentTech) {
      const t = Civ.TECH_BY_ID[p.currentTech];
      const pct = Math.min(100, Math.round(100 * p.sciProgress / t.cost));
      html += '<p>Researching: <b>' + esc(t.name) + '</b></p>';
      html += '<div class="bar"><div style="width:' + pct + '%"></div></div>';
      html += '<p class="dim">' + Math.floor(p.sciProgress) + ' / ' + t.cost + ' science</p>';
    } else if (Civ.availableTechs(p).length) {
      html += '<p class="dim">Choose next tech below →</p>';
    }
    $('statsbox').innerHTML = html;

    // tech grid (refinement #4): three collapsible display modes
    const avail = Civ.availableTechs(p);
    const techStatus = (t) =>
      p.techs[t.id] ? 'done' :
      p.currentTech === t.id ? 'current' :
      avail.some(a => a.id === t.id) ? 'avail' : 'locked';
    const techBtn = (t) =>
      '<button class="tech ' + techStatus(t) + '" data-tech="' + t.id +
      '" title="' + esc(t.name + ' (' + t.cost + ' science) — ' + t.desc) + '">' +
      esc(t.name) + '</button>';
    const techRowButtons = (era) => {
      let h = '<div class="techrow">';
      for (const t of Civ.TECHS.filter(x => x.era === era)) h += techBtn(t);
      return h + '</div>';
    };
    let thtml =
      '<div class="techmodes">' +
      ['hidden', 'selectable', 'all'].map(m =>
        '<button class="techmode' + (techMode === m ? ' active' : '') +
        '" data-techmode="' + m + '" title="' +
        (m === 'hidden' ? 'Hide the grid — only era titles; click one to expand its tech list' :
         m === 'selectable' ? 'Show only the techs you can research now' :
         'Show the entire tech tree') + '">' + m + '</button>'
      ).join('') + '</div>';
    if (techMode === 'all') {
      Civ.ERAS.forEach((eraName, era) => {
        thtml += '<div class="era-label">' + eraName + '</div>' + techRowButtons(era);
      });
    } else if (techMode === 'selectable') {
      const list = [];
      if (p.currentTech && Civ.TECH_BY_ID[p.currentTech]) list.push(Civ.TECH_BY_ID[p.currentTech]);
      for (const t of avail.slice().sort((a, b) => a.cost - b.cost)) list.push(t);
      if (!list.length) {
        thtml += '<p class="dim">Every technology has been researched!</p>';
      } else {
        thtml += '<div class="techrow">' + list.map(techBtn).join('') + '</div>';
      }
    } else { // 'hidden': clickable era titles that expand their tech list
      Civ.ERAS.forEach((eraName, era) => {
        const count = Civ.TECHS.filter(x => x.era === era).length;
        const open = techErasOpen.has(era);
        thtml += '<button class="era-title' + (open ? ' open' : '') + '" data-era="' + era + '">' +
          (open ? '▾ ' : '▸ ') + eraName + ' (' + count + ')</button>';
        if (open) thtml += techRowButtons(era);
      });
    }
    $('techbox').innerHTML = thtml;

    // diplomacy
    let dhtml = '';
    for (const other of S.civs.slice(1)) {
      if (other.eliminated) {
        dhtml += '<div class="diplo-row"><span class="dim">☠</span> <span class="dim">' + esc(other.name) + ' — eliminated</span></div>';
        continue;
      }
      const war = !!p.atWar[other.id];
      dhtml += '<div class="diplo-row">';
      dhtml += '<span style="color:' + other.color + '">●</span> <b>' + esc(other.name) + '</b> ';
      dhtml += war ? '<span class="war">AT WAR</span>' : '<span class="dim">peace</span> ';
      dhtml += '<span class="dim">(' + other.cities.length + ' cities, ' + other.units.length + ' units)</span><br>';
      dhtml += war
        ? '<button data-diplo="peace" data-civ="' + other.id + '">Make Peace</button>'
        : '<button data-diplo="war" data-civ="' + other.id + '" class="danger">Declare War</button> '
        + (p.gold >= 100 ? '<button data-diplo="gift" data-civ="' + other.id + '" title="A 100-gold gift makes this rival far less likely to attack you">🎁 Gift 100g</button> ' : '');
      dhtml += '</div>';
    }
    if (!S.civs.slice(1).length) dhtml = '<p class="dim">No other civilizations.</p>';
    $('diplobox').innerHTML = dhtml;
  }

  function updateLog() {
    const S = Civ.state;
    const list = S.log.slice(-40).reverse();
    $('loglist').innerHTML = list.map(e =>
      '<div class="logline"><span class="dim">[' + Civ.yearLabel() + ']</span> ' + esc(e.msg) + '</div>'
    ).join('');
  }

  /* --------------------------- terrain tooltip ----------------------- */

  function onTileHover(x, y, mx, my) {
    const el = $('tooltip');
    if (!el) return;
    const S = Civ.state;
    if (!S || x < 0 || y < 0 || x >= S.W || y >= S.H) { el.style.display = 'none'; return; }
    const idx = Civ.idx(x, y);
    const tile = S.tiles[idx];
    const p = player();
    if (!p.explored[idx]) { el.style.display = 'none'; return; }
    const T = Civ.TERRAIN[tile.terrain];
    const R = tile.resource ? Civ.RESOURCES[tile.resource] : null;
    let html = '<b>' + esc(T.name) + '</b>';
    if (tile.road) html += ' <span class="road">· Road</span>';
    html += '<br>' + esc(T.desc);
    if (T.land) {
      html += '<br>Land: cost ' + (tile.road ? '1' : T.cost) + (T.cost === 0 ? ' (impassable — mountains)' : '') + (T.defend ? ' · +' + T.defend + ' defense' : '');
    } else {
      html += '<br>Water: only ships and planes can enter';
    }
    if (R) html += '<br>Resource: <b>' + esc(R.name) + '</b>';
    const city = Civ.cityAt(x, y);
    if (city) html += '<br>City: <b>' + esc(city.name) + '</b> (' + esc(city.civ.name) + ', pop ' + city.pop + ')' + (city.wonder ? ' · ★ wonder' : '');
    const units = Civ.unitsOn(x, y);
    if (units.length) html += '<br>Units: ' + units.map(v => esc(Civ.UNIT_TYPES[v.type].abbr)).join(', ');
    el.innerHTML = html;
    el.style.display = 'block';
    const pad = 16;
    const rect = el.getBoundingClientRect();
    let left = mx + pad, top = my + pad;
    if (left + rect.width > window.innerWidth - 4) left = mx - rect.width - pad;
    if (top + rect.height > window.innerHeight - 4) top = my - rect.height - pad;
    el.style.left = Math.max(4, left) + 'px';
    el.style.top = Math.max(4, top) + 'px';
  }

  function onTileLeave() {
    const el = $('tooltip');
    if (el) el.style.display = 'none';
  }

  /* ------------------------------- ui -------------------------------- */

  Civ.ui = {
    refresh() {
      if (!Civ.state) return;
      updateTop(); updateLeft(); updateRight(); updateRank(); updateLog();
      Civ.render.draw();
      this.checkWinner();
    },

    checkWinner() {
      const S = Civ.state;
      if (S && S.winner && !winnerShown) {
        winnerShown = true;
        const w = $('winoverlay');
        $('wintitle').textContent = S.winner === 'victory' ? '🏆 VICTORY!' : '💀 DEFEAT';
        $('winmsg').textContent = S.winner === 'victory'
          ? 'Your civilization has conquered the known world in ' + Civ.yearLabel() + '.'
          : 'Your civilization has fallen. The tribes scatter to the winds...';
        w.hidden = false;
        if (Civ.sound) (S.winner === 'victory' ? Civ.sound.victory() : Civ.sound.defeat());
      }
    },

    showNewGame() {
      winnerShown = false;
      $('overlay').hidden = false;
      // bug #8: always dismiss the win/lose overlay when starting a new game
      $('winoverlay').hidden = true;
      $('helpoverlay').hidden = true;
      $('seed').value = (Math.random() * 1e9) | 0;
    },

    startGame() {
      const seed = parseInt($('seed').value, 10) || 1;
      const aiCount = parseInt($('aicount').value, 10);
      const size = parseInt($('mapsize').value, 10);
      const difficulty = $('difficulty').value;
      Civ.newGame({ seed, aiCount, size, difficulty });
      $('overlay').hidden = true;
      $('winoverlay').hidden = true;
      winnerShown = false;
      Civ.render.centerOnPlayer();
      Civ.ui.refresh();
    },

    endTurn() {
      if (!Civ.state || Civ.state.winner) return;
      Civ.endTurn();
      if (Civ.sound) Civ.sound.turn();
      Civ.ui.refresh();
    },

    /* ------------------------------ events --------------------------- */

    initEvents() {
      Civ.render.onClick = click;
      Civ.render.onHover = onTileHover;
      Civ.render.onHoverLeave = onTileLeave;

      $('btn-endturn').onclick = () => Civ.ui.endTurn();
      $('btn-newgame').onclick = () => {
        if (!Civ.state || Civ.state.winner || confirm('Abandon this game and start a new one?')) {
          Civ.state = null;
          Civ.ui.showNewGame();
        }
      };
      $('btn-help').onclick = () => { $('helpoverlay').hidden = !$('helpoverlay').hidden; };
      $('help-close').onclick = () => { $('helpoverlay').hidden = true; };
      $('btn-start').onclick = () => Civ.ui.startGame();
      const btnSound = $('btn-sound');
      if (btnSound) {
        const setIcon = () => { btnSound.textContent = (Civ.sound && Civ.sound.isMuted()) ? '🔇' : '🔊'; };
        btnSound.onclick = () => {
          if (!Civ.sound) return;
          Civ.sound.toggleMute();
          setIcon();
          if (!Civ.sound.isMuted()) Civ.sound.turn(); // confirmation blip
        };
        setIcon();
      }
      $('btn-win-newgame').onclick = () => { Civ.state = null; Civ.ui.showNewGame(); };

      // selection box: unit/city actions + build buttons
      $('selbox').addEventListener('click', function (e) {
        const b = e.target.closest('button[data-act]');
        if (b) {
          const S = Civ.state, sel = S.selected, p = player();
          if (b.dataset.act === 'selectcity') {
            const c = Civ.cityById(parseInt(b.dataset.city, 10));
            if (c) selectCity(c);
            return;
          }
          if (b.dataset.act === 'selectunit') {
            const u = Civ.unitById(parseInt(b.dataset.unit, 10));
            if (u) selectUnit(u);
            return;
          }
          if (b.dataset.act === 'clearqueue') {
            if (sel && sel.kind === 'city') {
              const c = Civ.cityById(sel.id);
              if (c) { c.queue = null; c.progress = 0; Civ.ui.refresh(); }
            }
            return;
          }
          if (sel && sel.kind === 'unit') {
            const u = Civ.unitById(sel.id);
            if (u && u.civ === p) {
              if (b.dataset.act === 'disembark') {
                Civ.disembark(u);
                S.selected = (Civ.unitById(u.id)) ? { kind: 'unit', id: u.id } : null;
                S.reachable = new Set();
                Civ.ui.refresh();
                return;
              }
              if (b.dataset.act === 'board') {
                const ship = Civ.unitById(parseInt(b.dataset.ship, 10));
                if (ship && Civ.board(u, ship)) {
                  S.selected = { kind: 'unit', id: u.id };
                  S.reachable = new Set();
                }
                Civ.ui.refresh();
                return;
              }
              if (b.dataset.act === 'found') {
                if (Civ.foundCity(u)) { S.selected = null; S.reachable = null; Civ.ui.refresh(); }
                else Civ.ui.refresh();
              } else if (b.dataset.act === 'road') {
                Civ.buildRoad(u);
                // refreshing recomputes reachable (empty after an action)
                S.selected = (Civ.unitById(u.id)) ? { kind: 'unit', id: u.id } : null;
                S.reachable = new Set();
                Civ.ui.refresh();
              } else if (b.dataset.act === 'disband') {
                if (confirm('Disband this ' + Civ.UNIT_TYPES[u.type].name + '?')) {
                  Civ.disbandUnit(u);
                  S.selected = null; S.reachable = null;
                  Civ.ui.refresh();
                }
              }
            }
          }
          return;
        }
        // build buttons (unit / building / wonder)
        const bd = e.target.closest('button[data-build]');
        if (bd && !bd.disabled && Civ.state) {
          const sel = Civ.state.selected, p = player();
          if (sel && sel.kind === 'city') {
            const c = Civ.cityById(sel.id);
            if (c && c.civ === p) {
              const what = bd.dataset.build;
              const [kind, id] = what.split(':');
              // never queue a wonder that someone already claimed
              const B = (kind === 'building') ? Civ.BUILDINGS[id] : null;
              if (B && B.wonder && Civ.wonderClaimed(id)) { Civ.ui.refresh(); return; }
              Civ.setQueue(c, what);
              Civ.ui.refresh();
            }
          }
          return;
        }
      });

      // tech grid: display modes, era expansion (hidden mode), tech selection
      $('techbox').addEventListener('click', function (e) {
        const b = e.target.closest('button');
        if (!b || !Civ.state) return;
        if (b.dataset.techmode !== undefined) {
          techMode = b.dataset.techmode;
          Civ.ui.refresh();
          return;
        }
        if (b.dataset.era !== undefined) {
          const era = parseInt(b.dataset.era, 10);
          if (techErasOpen.has(era)) techErasOpen.delete(era); else techErasOpen.add(era);
          Civ.ui.refresh();
          return;
        }
        if (b.dataset.tech !== undefined) {
          const p = player();
          const id = b.dataset.tech;
          if (Civ.availableTechs(p).some(t => t.id === id)) {
            p.currentTech = id;
            Civ.log(p.name + ' begins researching ' + Civ.TECH_BY_ID[id].name + '.');
            Civ.ui.refresh();
          }
        }
      });

      // diplomacy
      $('diplobox').addEventListener('click', function (e) {
        const b = e.target.closest('button[data-diplo]');
        if (!b || !Civ.state) return;
        const p = player();
        const other = Civ.civById(parseInt(b.dataset.civ, 10));
        if (!other) return;
        if (b.dataset.diplo === 'war') {
          p.atWar[other.id] = true; other.atWar[p.id] = true;
          Civ.log('WAR! ' + p.name + ' has declared war on ' + other.name + '!');
          if (Civ.sound) Civ.sound.war();
        } else if (b.dataset.diplo === 'gift') {
          const cost = 100;
          if (p.gold >= cost) {
            p.gold -= cost;
            other.gifts = other.gifts || {};
            other.gifts[p.id] = (other.gifts[p.id] || 0) + cost;
            Civ.log(p.name + ' gifts ' + cost + ' gold to ' + other.name + '. The gift is well received...');
          } else {
            Civ.log('You need at least ' + cost + ' gold to make a gift.');
          }
        } else {
          Civ.makePeace(p, other);
        }
        Civ.ui.refresh();
      });

      window.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          const ov = $('overlay'), win = $('winoverlay'), help = $('helpoverlay');
          if (!ov.hidden || !win.hidden || !help.hidden) return;
          Civ.ui.endTurn();
        }
      });
    },
  };

})(window.Civ);
