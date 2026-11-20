/* =====================================================================
 * mapgen.js — procedural world map (seeded, deterministic)
 * ===================================================================== */
window.Civ = window.Civ || {};
(function (Civ) {

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Bilinear value-noise field in [0,1]
  function field(W, H, seed, cells) {
    const rnd = mulberry32(seed);
    const cw = Math.ceil(W / cells) + 2, ch = Math.ceil(H / cells) + 2;
    const g = [];
    for (let j = 0; j < ch; j++) { g.push([]); for (let i = 0; i < cw; i++) g[j].push(rnd()); }
    const out = [];
    for (let y = 0; y < H; y++) {
      const fy = y / cells, j0 = Math.floor(fy), ty = fy - j0;
      const row = [];
      for (let x = 0; x < W; x++) {
        const fx = x / cells, i0 = Math.floor(fx), tx = fx - i0;
        const a = g[j0][i0], b = g[j0][i0 + 1], c = g[j0 + 1][i0], d = g[j0 + 1][i0 + 1];
        row.push((a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty);
      }
      out.push(row);
    }
    return out;
  }

  // Two-octave blend for smoother continents
  function elevation(W, H, seed) {
    const f1 = field(W, H, seed, 6);
    const f2 = field(W, H, seed + 7777, 14);
    const out = [];
    for (let y = 0; y < H; y++) {
      const row = [];
      for (let x = 0; x < W; x++) row.push(0.62 * f1[y][x] + 0.38 * f2[y][x]);
      out.push(row);
    }
    return out;
  }

  function terrainFor(elev, moist) {
    if (elev < 0.42) return 'ocean';
    if (elev > 0.78) return 'mountains';
    if (elev > 0.68) return 'hills';
    if (moist < 0.32) return 'desert';
    if (moist < 0.52) return 'plains';
    if (moist < 0.72) return 'grassland';
    return 'forest';
  }

  Civ.mapgen = {

    /**
     * Generate a world. Returns { W, H, tiles } where tiles is a flat array
     * of length W*H of { x, y, terrain, resource }.
     */
    generate(W, H, seed) {
      seed = (seed >>> 0) || 12345;
      const elev = elevation(W, H, seed);
      const moist = field(W, H, seed + 99991, 9);
      const rnd = mulberry32(seed + 555);

      const tiles = new Array(W * H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          tiles[y * W + x] = { x, y, terrain: terrainFor(elev[y][x], moist[y][x]), resource: null };
        }
      }

      // --- resources ---
      function place(resId, count) {
        const r = Civ.RESOURCES[resId];
        let placed = 0, guard = 0;
        while (placed < count && guard++ < 5000) {
          const i = (rnd() * W * H) | 0;
          const t = tiles[i];
          if (t.resource === null && r.on.indexOf(t.terrain) !== -1) {
            t.resource = resId; placed++;
          }
        }
      }
      const scale = Math.max(0.5, (W * H) / (32 * 32));
      place('wheat', Math.round(10 * scale));
      place('horse', Math.round(6 * scale));
      place('iron',  Math.round(6 * scale));
      place('gold',  Math.round(6 * scale));
      place('sheep', Math.round(6 * scale));
      place('fish',  Math.round(10 * scale));

      return { W, H, tiles, seed };
    },

    /** Find a good starting spot (grassland/plains, away from mountains). */
    findStartSpot(W, H, tiles, nearX, nearY, minDist, occupiedList) {
      const idx = (x, y) => y * W + x;
      let best = null, bestScore = -1e9;
      for (let y = 1; y < H - 1; y++) {
        for (let x = 1; x < W - 1; x++) {
          const t = tiles[idx(x, y)];
          if (t.terrain !== 'grassland' && t.terrain !== 'plains') continue;
          const dNear = Math.abs(x - nearX) + Math.abs(y - nearY);
          let ok = true;
          if (minDist) {
            for (const o of occupiedList) {
              if (Math.abs(o.x - x) + Math.abs(o.y - y) < minDist) { ok = false; break; }
            }
            if (!ok) continue;
          }
          let score = -dNear;
          if (t.resource === 'wheat') score += 4;
          if (t.resource === 'horse') score += 3;
          if (t.resource === 'sheep') score += 3;
          if (t.resource === 'gold') score += 2;
          if (score > bestScore) { bestScore = score; best = { x, y }; }
        }
      }
      return best;
    }
  };

})(window.Civ);
