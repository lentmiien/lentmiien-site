/* Shared geometry, metres; +x east, +z south. Original Sky Harbor world. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;else root.SkyWorld = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SIZE = 28000,
    STEP = 200,
    HALF = SIZE / 2,
    DEG = Math.PI / 180;
  const airports = [{
    id: 'haven',
    name: 'Haven Coast',
    code: 'HVC',
    x: -8500,
    z: 4500,
    elevation: 24,
    heading: 90,
    region: 'Tidal coast',
    color: '#79c9c5'
  }, {
    id: 'meadow',
    name: 'Meadow Field',
    code: 'MDF',
    x: -1500,
    z: 4500,
    elevation: 24,
    heading: 90,
    region: 'Patchwork plains',
    color: '#c2d78c'
  }, {
    id: 'pine',
    name: 'Pine Reach',
    code: 'PNR',
    x: 6500,
    z: 0,
    elevation: 180,
    heading: 0,
    region: 'Forested foothills',
    color: '#80bba3'
  }, {
    id: 'mesa',
    name: 'Sunstone Mesa',
    code: 'SSM',
    x: 7500,
    z: -8000,
    elevation: 220,
    heading: 90,
    region: 'Ochre desert',
    color: '#e9b978'
  }, {
    id: 'fjord',
    name: 'Northwater',
    code: 'NWR',
    x: -6500,
    z: -6500,
    elevation: 60,
    heading: 180,
    region: 'Islands & alpine coast',
    color: '#aacbd4'
  }].map(a => ({
    ...a,
    length: 1400,
    width: 64
  }));
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const smooth = x => {
    x = clamp(x, 0, 1);
    return x * x * (3 - 2 * x);
  };
  function local(a, x, z) {
    const h = a.heading * DEG,
      dx = x - a.x,
      dz = z - a.z;
    return {
      along: dx * Math.sin(h) - dz * Math.cos(h),
      cross: dx * Math.cos(h) + dz * Math.sin(h)
    };
  }
  function point(a, along, cross = 0) {
    const h = a.heading * DEG;
    return {
      x: a.x + Math.sin(h) * along + Math.cos(h) * cross,
      z: a.z - Math.cos(h) * along + Math.sin(h) * cross
    };
  }
  function rawHeight(x, z) {
    const shore = -10100 + 500 * Math.sin(z / 1800) + 280 * Math.cos(z / 650);
    let y = 34 + 16 * Math.sin(x / 1700) * Math.cos(z / 1900);
    y += 920 * Math.exp(-((x / 2900) ** 2 + ((z + 6500) / 3300) ** 2));
    y += 250 * Math.exp(-(((x - 6500) / 4000) ** 2 + ((z - 2000) / 4500) ** 2));
    y += 200 * smooth((x - 3000) / 4000) * smooth((-z - 1500) / 4500);
    y += 35 * Math.sin(x / 630) * Math.sin(z / 740) * smooth((3000 - z) / 3000);
    if (x < shore) y = -28 + 70 * Math.max(0, Math.sin(x / 800) * Math.cos(z / 900)) ** 4;
    return y;
  }
  function nodeHeight(x, z) {
    let y = rawHeight(x, z);
    for (const a of airports) {
      const p = local(a, x, z);
      const blend = Math.max(smooth((Math.abs(p.cross) - 420) / 700), smooth((Math.abs(p.along) - 4600) / 900));
      y = y * blend + a.elevation * (1 - blend);
    }
    return y;
  }
  // Exactly the same diagonal and interpolation as the rendered terrain triangles.
  function height(x, z) {
    const gx = Math.floor(x / STEP) * STEP,
      gz = Math.floor(z / STEP) * STEP;
    const u = (x - gx) / STEP,
      v = (z - gz) / STEP;
    const a = nodeHeight(gx, gz),
      b = nodeHeight(gx + STEP, gz),
      c = nodeHeight(gx, gz + STEP),
      d = nodeHeight(gx + STEP, gz + STEP);
    return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  }
  function runwayAt(x, z, margin = 0) {
    return airports.find(a => {
      const p = local(a, x, z);
      return Math.abs(p.along) <= a.length / 2 + margin && Math.abs(p.cross) <= a.width / 2 + margin;
    });
  }
  function clearCorridor(x, z, radius = 0) {
    return airports.some(a => {
      const p = local(a, x, z);
      return Math.abs(p.along) < 4900 + radius && Math.abs(p.cross) < 370 + radius;
    });
  }
  function random(seed) {
    return () => {
      seed = Math.imul(seed, 1664525) + 1013904223 >>> 0;
      return seed / 4294967296;
    };
  }
  const rng = random(72419),
    obstacles = [];
  for (let i = 0; i < 9500; i++) {
    const x = (rng() - .5) * SIZE,
      z = (rng() - .5) * SIZE,
      y = height(x, z);
    if (y < 4 || clearCorridor(x, z, 16)) continue;
    const desert = x > 3200 && z < -2000;
    const type = desert || y > 680 ? 'rock' : i % 13 === 0 ? 'house' : 'tree';
    const radius = type === 'house' ? 15 : type === 'tree' ? 9 : 18;
    obstacles.push({
      x,
      z,
      y,
      radius,
      height: type === 'tree' ? 22 + rng() * 15 : type === 'house' ? 13 : 20 + rng() * 30,
      type
    });
  }
  for (const a of airports) {
    for (let i = 0; i < 5; i++) {
      const p = point(a, (i - 2) * 95, 170);
      obstacles.push({
        ...p,
        y: a.elevation,
        radius: 32,
        height: i === 2 ? 27 : 16,
        type: i === 2 ? 'terminal' : 'hangar'
      });
    }
  }
  for (const a of airports) obstacles.push({
    ...point(a, -260, 244),
    y: a.elevation,
    radius: 10,
    height: 17,
    type: 'windsock'
  });
  // Spatial collision buckets avoid scanning thousands of objects at 120 Hz.
  const buckets = new Map();
  for (const o of obstacles) {
    const key = `${Math.floor(o.x / 250)},${Math.floor(o.z / 250)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(o);
  }
  function nearby(x, z) {
    const result = [],
      bx = Math.floor(x / 250),
      bz = Math.floor(z / 250);
    for (let ix = bx - 1; ix <= bx + 1; ix++) for (let iz = bz - 1; iz <= bz + 1; iz++) result.push(...(buckets.get(`${ix},${iz}`) || []));
    return result;
  }
  function runwayNumber(heading) {
    return String(Math.round((heading || 360) / 10)).padStart(2, '0');
  }
  return {
    SIZE,
    HALF,
    STEP,
    DEG,
    airports,
    obstacles,
    clamp,
    smooth,
    local,
    point,
    height,
    nodeHeight,
    rawHeight,
    runwayAt,
    clearCorridor,
    nearby,
    random,
    runwayNumber
  };
});
