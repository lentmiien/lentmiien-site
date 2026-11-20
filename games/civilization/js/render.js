/* =====================================================================
 * render.js — canvas renderer + camera (pan / zoom)
 * ===================================================================== */
window.Civ = window.Civ || {};
(function (Civ) {

  const R = {
    canvas: null, ctx: null,
    cam: { x: 0, y: 0, zoom: 1 },
    baseTile: 36,
    terrainAtlas: null, unitAtlas: null,
    onClick: null,   // wired by ui.js: function(x, y)
  };

  function tp() { return R.baseTile * R.cam.zoom; }

  R.screenToTile = function (mx, my) {
    const s = tp();
    return { x: Math.floor((mx + R.cam.x) / s), y: Math.floor((my + R.cam.y) / s) };
  };

  R.centerOn = function (x, y) {
    const s = tp();
    R.cam.x = x * s + s / 2 - R.canvas.width / 2;
    R.cam.y = y * s + s / 2 - R.canvas.height / 2;
  };

  R.centerOnPlayer = function () {
    const S = Civ.state;
    if (!S) return;
    const p = S.civs[0];
    const c = p.cities[0];
    R.centerOn(c ? c.x : S.W / 2, c ? c.y : S.H / 2);
  };

  function tri(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x + w / 2, y);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fill();
  }

  // deterministic per-tile speckle for a retro, non-flat look
  function hash2(x, y) {
    let h = (x * 73856093) ^ (y * 19349663);
    h = (h ^ (h >> 13)) * 1274126177;
    return (h ^ (h >> 16)) >>> 0;
  }

  const TERRAIN_SPRITES = { ocean: 0, grassland: 1, plains: 2, forest: 3, hills: 4, mountains: 5, desert: 6, tundra: 7 };
  const UNIT_SPRITES = {
    settler: 0, engineer: 0,
    warrior: 1, spearman: 1, phalanx: 1, longswordsman: 1, musketeer: 1, rifleman: 1, paladin: 1,
    archer: 2, longbowman: 2,
    chariot: 3, horseman: 3, knight: 3,
    catapult: 4, cannon: 4, missile: 4, rocket: 4,
    ship: 5, transport: 5, war_galley: 5, carrack: 5, steamship: 5, battleship: 5, gunship: 5,
    plane: 6, mech: 7
  };

  function drawAtlasCell(ctx, atlas, index, px, py, s) {
    const cell = atlas.width / 4;
    ctx.drawImage(atlas, (index % 4) * cell, Math.floor(index / 4) * cell,
      cell, atlas.height / 2, px, py, s, s);
  }

  function drawDetails(ctx, terrain, res, px, py, s, tx, ty, textured) {
    const m = s * 0.18;
    if (s > 10) {
      const h = hash2(tx, ty);
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      const d = Math.max(1, Math.round(s * 0.07));
      ctx.fillRect(px + ((h & 7) + 1) * s / 16, py + (((h >> 4) & 7) + 1) * s / 16, d, d);
      ctx.fillRect(px + (((h >> 8) & 7) + 1) * s / 16, py + (((h >> 12) & 7) + 1) * s / 16, d, d);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(px + (((h >> 16) & 7) + 1) * s / 16, py + (((h >> 20) & 7) + 1) * s / 16, d, d);
    }
    if (!textured) switch (terrain) {
      case 'ocean':
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(px + m, py + s * 0.35, s * 0.28, Math.max(1, s * 0.06));
        ctx.fillRect(px + s * 0.55, py + s * 0.62, s * 0.28, Math.max(1, s * 0.06));
        break;
      case 'grassland':
        ctx.fillStyle = 'rgba(0,40,0,0.35)';
        ctx.fillRect(px + m, py + s * 0.3, s * 0.09, s * 0.22);
        ctx.fillRect(px + s * 0.62, py + s * 0.55, s * 0.09, s * 0.22);
        break;
      case 'plains':
        ctx.fillStyle = 'rgba(120,100,20,0.4)';
        ctx.fillRect(px + s * 0.2, py + s * 0.4, s * 0.1, s * 0.16);
        ctx.fillRect(px + s * 0.6, py + s * 0.6, s * 0.1, s * 0.16);
        break;
      case 'forest':
        tri(ctx, px + s * 0.18, py + s * 0.25, s * 0.24, s * 0.35, '#1c4d1c');
        tri(ctx, px + s * 0.55, py + s * 0.45, s * 0.24, s * 0.35, '#256b25');
        break;
      case 'hills':
        ctx.fillStyle = 'rgba(60,45,20,0.55)';
        ctx.beginPath();
        ctx.arc(px + s * 0.4, py + s * 0.62, s * 0.28, Math.PI, 0);
        ctx.fill();
        break;
      case 'mountains':
        tri(ctx, px + s * 0.1, py + s * 0.15, s * 0.55, s * 0.7, '#b8b8c0');
        ctx.fillStyle = '#f0f0f5';
        ctx.beginPath();
        ctx.moveTo(px + s * 0.375, py + s * 0.15);
        ctx.lineTo(px + s * 0.52, py + s * 0.42);
        ctx.lineTo(px + s * 0.23, py + s * 0.42);
        ctx.closePath();
        ctx.fill();
        break;
      case 'desert':
        ctx.fillStyle = 'rgba(160,120,40,0.4)';
        ctx.fillRect(px + s * 0.2, py + s * 0.5, s * 0.14, s * 0.08);
        ctx.fillRect(px + s * 0.6, py + s * 0.35, s * 0.14, s * 0.08);
        break;
      case 'tundra':
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillRect(px + s * 0.2, py + s * 0.4, s * 0.2, s * 0.12);
        ctx.fillRect(px + s * 0.55, py + s * 0.6, s * 0.2, s * 0.12);
        break;
    }
    if (res && s > 14) {
      const labels = { wheat: 'W', horse: 'H', iron: 'F', gold: 'G', sheep: 'S', fish: '~' };
      const colors = { wheat: '#ffd54a', horse: '#d2691e', iron: '#c0c0c8', gold: '#ffd700', sheep: '#f5f5f5', fish: '#bfe6ff' };
      ctx.font = 'bold ' + Math.max(8, s * 0.34) + 'px monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillText(labels[res] || '?', px + s - s * 0.34, py + s * 0.36);
      ctx.fillStyle = colors[res] || '#fff';
      ctx.fillText(labels[res] || '?', px + s - s * 0.36, py + s * 0.34);
    }
  }

  function drawRoad(ctx, px, py, s) {
    // a simple retro road: asphalt band with a dashed centre line, drawn on
    // top of the terrain so land units visibly travel along it
    const band = Math.max(3, Math.round(s * 0.46));
    const cy = py + s / 2;
    ctx.fillStyle = 'rgba(74,66,50,0.92)';
    ctx.fillRect(px, cy - band / 2, s, band);
    ctx.strokeStyle = 'rgba(235,222,150,0.9)';
    ctx.lineWidth = Math.max(1, Math.round(s * 0.05));
    ctx.setLineDash([s * 0.16, s * 0.16]);
    ctx.beginPath();
    ctx.moveTo(px, cy);
    ctx.lineTo(px + s, cy);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawCity(ctx, city, px, py, s, playerCiv) {
    const c = city.civ.color;
    const atWar = !!(playerCiv && playerCiv.atWar[city.civ.id]);
    // stone walls
    ctx.fillStyle = '#8f8676';
    ctx.fillRect(px + s * 0.07, py + s * 0.24, s * 0.86, s * 0.69);
    // crenellations
    ctx.fillStyle = '#a99f8d';
    const bw = (s * 0.86) / 6;
    for (let i = 0; i < 6; i += 2) {
      ctx.fillRect(px + s * 0.07 + i * bw, py + s * 0.17, bw, s * 0.08);
    }
    // roof in civ color
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(px + s * 0.14, py + s * 0.48);
    ctx.lineTo(px + s * 0.5, py + s * 0.12);
    ctx.lineTo(px + s * 0.86, py + s * 0.48);
    ctx.closePath();
    ctx.fill();
    // roof shading
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(px + s * 0.5, py + s * 0.12);
    ctx.lineTo(px + s * 0.86, py + s * 0.48);
    ctx.lineTo(px + s * 0.5, py + s * 0.48);
    ctx.closePath();
    ctx.fill();
    // door
    ctx.fillStyle = '#2c2620';
    ctx.fillRect(px + s * 0.42, py + s * 0.58, s * 0.16, s * 0.35);
    // flag above the wall
    ctx.strokeStyle = '#e8e2d0';
    ctx.lineWidth = Math.max(1, s * 0.035);
    ctx.beginPath();
    ctx.moveTo(px + s * 0.88, py + s * 0.24);
    ctx.lineTo(px + s * 0.88, py - s * 0.12);
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(px + s * 0.88, py - s * 0.12);
    ctx.lineTo(px + s * 1.10, py - s * 0.04);
    ctx.lineTo(px + s * 0.88, py + s * 0.04);
    ctx.closePath();
    ctx.fill();
    // name
    if (s > 16) {
      ctx.font = 'bold ' + Math.max(7, s * 0.3) + 'px monospace';
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(city.name, px + 2, py + s - 2);
    }
    if (city.wonder) {
      ctx.font = 'bold ' + Math.max(9, s * 0.44) + 'px serif';
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.lineWidth = 2;
      ctx.strokeText('★', px + s * 0.02, py + s * 0.16);
      ctx.fillStyle = '#ffd700';
      ctx.fillText('★', px + s * 0.02, py + s * 0.16);
    }
    if (atWar) {
      ctx.strokeStyle = '#ff2222';
      ctx.lineWidth = 2;
      ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
    }
  }

  function drawWorkArea(ctx, px, py, s) {
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px - s + 0.5, py - s + 0.5, s * 3 - 1, s * 3 - 1);
  }

  function drawUnit(ctx, u, px, py, s, selected, small) {
    const U = Civ.UNIT_TYPES[u.type];
    // units standing inside a city render as a small corner marker so the
    // city stays the dominant visual (Civ-1 style)
    if (small) {
      const w = s * 0.36;
      // bottom-left corner keeps the roof + flag clear
      const x = px + s * 0.06, y = py + s * 0.58;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x + 1, y + 1, w, w);
      ctx.fillStyle = u.civ.color;
      ctx.fillRect(x, y, w, w);
      ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0,0,0,0.8)';
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, w - 1);
      if (s > 14) {
        ctx.font = 'bold ' + Math.max(7, s * 0.22) + 'px monospace';
        ctx.fillStyle = '#111';
        const t = U.abbr.slice(0, 3);
        ctx.fillText(t, x + w / 2 - ctx.measureText(t).width / 2, y + w * 0.62);
      }
      return;
    }
    const x = px + s * 0.08, y = py + s * 0.08, w = s * 0.84;
    ctx.fillStyle = u.hp < 100 ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.55)';
    ctx.fillRect(x + 1, y + 1, w, w);
    ctx.fillStyle = u.civ.color;
    ctx.fillRect(x, y, w, w);
    const sprite = UNIT_SPRITES[u.type];
    if (R.unitAtlas && R.unitAtlas.complete && R.unitAtlas.naturalWidth && sprite !== undefined) {
      drawAtlasCell(ctx, R.unitAtlas, sprite, x + w * 0.08, y + w * 0.08, w * 0.84);
    }
    ctx.strokeStyle = selected ? '#ffffff' : 'rgba(0,0,0,0.8)';
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, w - 1);
    if (s > 14 && !(R.unitAtlas && R.unitAtlas.complete && R.unitAtlas.naturalWidth && sprite !== undefined)) {
      ctx.font = 'bold ' + Math.max(7, s * 0.32) + 'px monospace';
      ctx.fillStyle = '#111';
      const t = U.abbr;
      ctx.fillText(t, x + w / 2 - ctx.measureText(t).width / 2, y + w * 0.62);
    }
    if (u.hp < 100) {
      ctx.fillStyle = '#400';
      ctx.fillRect(px + 1, py + s - 3, s - 2, 2);
      ctx.fillStyle = '#e33';
      ctx.fillRect(px + 1, py + s - 3, (s - 2) * u.hp / 100, 2);
    }
  }

  R.draw = function () {
    const S = Civ.state;
    if (!S || !R.ctx) return;
    const ctx = R.ctx, W = R.canvas.width, H = R.canvas.height;
    const s = tp();
    ctx.fillStyle = '#0a1620';
    ctx.fillRect(0, 0, W, H);
    // A faint chart grid gives unexplored space some texture without
    // disclosing the terrain hidden by fog of war.
    ctx.strokeStyle = 'rgba(183, 156, 104, 0.045)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx < W; gx += 48) {
      ctx.beginPath(); ctx.moveTo(gx + 0.5, 0); ctx.lineTo(gx + 0.5, H); ctx.stroke();
    }
    for (let gy = 0; gy < H; gy += 48) {
      ctx.beginPath(); ctx.moveTo(0, gy + 0.5); ctx.lineTo(W, gy + 0.5); ctx.stroke();
    }

    const player = S.civs[0];

    // precompute per-tile maps for this frame
    const cityMap = {}, unitMap = {};
    for (const civ of S.civs) {
      if (civ.eliminated) continue;
      for (const c of civ.cities) cityMap[c.x + ',' + c.y] = c;
      for (const u of civ.units) {
        const k = u.x + ',' + u.y;
        (unitMap[k] = unitMap[k] || []).push(u);
      }
    }

    const x0 = Math.max(0, Math.floor(R.cam.x / s) - 1);
    const y0 = Math.max(0, Math.floor(R.cam.y / s) - 1);
    const x1 = Math.min(S.W - 1, Math.ceil((R.cam.x + W) / s) + 1);
    const y1 = Math.min(S.H - 1, Math.ceil((R.cam.y + H) / s) + 1);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const tile = S.tiles[y * S.W + x];
        const px = Math.round(x * s - R.cam.x), py = Math.round(y * s - R.cam.y);
        if (!player.explored[y * S.W + x]) {
          continue;
        }
        const textured = !!(R.terrainAtlas && R.terrainAtlas.complete && R.terrainAtlas.naturalWidth);
        if (textured) drawAtlasCell(ctx, R.terrainAtlas, TERRAIN_SPRITES[tile.terrain], px, py, s);
        else {
          ctx.fillStyle = Civ.TERRAIN_COLORS[tile.terrain];
          ctx.fillRect(px, py, s, s);
        }
        drawDetails(ctx, tile.terrain, tile.resource, px, py, s, x, y, textured);
        if (tile.road) drawRoad(ctx, px, py, s);
        ctx.strokeStyle = 'rgba(0,0,0,0.09)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);

        const key = x + ',' + y;
        const unit = unitMap[key];
        const city = cityMap[key];
        if (S.reachable && S.reachable.has(key)) {
          ctx.fillStyle = 'rgba(80,150,255,0.35)';
          ctx.fillRect(px, py, s, s);
        }

        const sel = S.selected;
        if (city && city.civ === player) drawWorkArea(ctx, px, py, s);
        if (unit) {
          // stacked units: stagger so each remains visible (topmost = last);
          // on a city tile they become small corner markers
          const n = unit.length;
          const small = !!city;
          const off = !small && n > 1 ? Math.min(9, s * 0.28) : (small ? s * 0.09 : 0);
          for (let i = 0; i < n; i++) {
            const u = unit[i];
            const isSel = sel && sel.kind === 'unit' && sel.id === u.id;
            drawUnit(ctx, u, px - i * off, py - i * off, s, isSel, small);
          }
        }
        // city is drawn last so it always stays visible over stacked units
        if (city) {
          drawCity(ctx, city, px, py, s, player);
          if (sel && sel.kind === 'city' && sel.id === city.id) {
            ctx.strokeStyle = '#ffe14a'; ctx.lineWidth = 2;
            ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
          }
        }
      }
    }
  };

  /* ------------------------------- input ----------------------------- */

  R.init = function (canvas) {
    R.canvas = canvas;
    R.ctx = canvas.getContext('2d');
    R.terrainAtlas = new Image();
    R.terrainAtlas.onload = function () { R.draw(); };
    R.terrainAtlas.src = 'assets/terrain-atlas.webp';
    R.unitAtlas = new Image();
    R.unitAtlas.onload = function () { R.draw(); };
    R.unitAtlas.src = 'assets/unit-atlas.webp';
    let dragging = false, lx = 0, ly = 0, moved = 0;

    // terrain hover tooltip (wired by ui.js -> R.onHover / R.onHoverLeave)
    canvas.addEventListener('mousemove', function (e) {
      if (dragging) return;                 // no tooltip while panning
      if (!R.onHover || !Civ.state) return;
      const r = canvas.getBoundingClientRect();
      const t = R.screenToTile(e.clientX - r.left, e.clientY - r.top);
      R.onHover(t.x, t.y, e.clientX, e.clientY);
    });
    canvas.addEventListener('mouseleave', function () {
      if (R.onHoverLeave) R.onHoverLeave();
    });

    canvas.addEventListener('mousedown', function (e) {
      dragging = true; lx = e.offsetX; ly = e.offsetY; moved = 0;
    });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const dx = mx - lx, dy = my - ly;
      moved += Math.abs(dx) + Math.abs(dy);
      R.cam.x -= dx; R.cam.y -= dy;
      lx = mx; ly = my;
      R.draw();
    });
    window.addEventListener('mouseup', function (e) {
      if (!dragging) return;
      dragging = false;
      if (moved < 6) {
        const r = canvas.getBoundingClientRect();
        const t = R.screenToTile(e.clientX - r.left, e.clientY - r.top);
        if (R.onClick && Civ.state && t.x >= 0 && t.y >= 0 && t.x < Civ.state.W && t.y < Civ.state.H) {
          R.onClick(t.x, t.y);
        }
      }
    });
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const oldZoom = R.cam.zoom;
      const f = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const nz = Math.max(0.4, Math.min(3, oldZoom * f));
      const wx = R.cam.x + mx, wy = R.cam.y + my;
      R.cam.zoom = nz;
      R.cam.x = wx - mx; R.cam.y = wy - my;
      R.draw();
    }, { passive: false });
  };

  Civ.render = R;

})(window.Civ);
