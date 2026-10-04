(function exposeTerrain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoonTerrain = api;
}(typeof globalThis === 'object' ? globalThis : this, function createTerrain() {
  'use strict';

  function random(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }
  const smooth = value => value * value * (3 - 2 * value);
  function hash(x, y) {
    let value = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
  }
  function noise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = smooth(x - ix), fz = smooth(z - iz);
    const a = hash(ix, iz) * (1 - fx) + hash(ix + 1, iz) * fx;
    const b = hash(ix, iz + 1) * (1 - fx) + hash(ix + 1, iz + 1) * fx;
    return a * (1 - fz) + b * fz;
  }
  const rng = random(19690720);
  const craters = [
    { x: -31, z: 20, radius: 12, depth: 2.0 },
    { x: 42, z: -37, radius: 18, depth: 3.0 },
    { x: -10, z: -18, radius: 3.5, depth: 0.62 },
    { x: 14, z: 15, radius: 2.8, depth: 0.46 },
    { x: 120, z: 85, radius: 38, depth: 5.8 }
  ];
  for (let i = 0; i < 510; i += 1) {
    const extent = i < 160 ? 380 : 2800;
    const x = (rng() - 0.5) * extent, z = (rng() - 0.5) * extent;
    const radius = i < 160 ? 1.5 + rng() ** 2 * 12 : 9 + rng() ** 2 * 85;
    if (Math.hypot(x, z) < radius * 1.8 + 12) continue;
    if (craters.some(c => Math.hypot(c.x - x, c.z - z) < (c.radius + radius) * 0.8)) continue;
    craters.push({ x, z, radius, depth: radius * (0.12 + rng() * 0.06) });
  }
  for (let i = 0; i < 56; i += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = 2500 + Math.sqrt(rng()) * 26000;
    const radius = 180 + rng() ** 2 * 1500;
    craters.push({ x: Math.cos(angle) * distance, z: Math.sin(angle) * distance, radius, depth: radius * .11 });
  }
  const cells = new Map();
  const distantCells = new Map();
  const empty = [];
  for (const crater of craters) {
    const reach = crater.radius * 1.65;
    const cellSize = crater.radius > 100 ? 1024 : 64;
    const index = crater.radius > 100 ? distantCells : cells;
    for (let x = Math.floor((crater.x - reach) / cellSize); x <= Math.floor((crater.x + reach) / cellSize); x += 1) {
      for (let z = Math.floor((crater.z - reach) / cellSize); z <= Math.floor((crater.z + reach) / cellSize); z += 1) {
        const key = `${x},${z}`;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(crater);
      }
    }
  }
  function height(x, z) {
    const r = Math.hypot(x, z);
    // Lunar curvature, subdued mare relief, metre and centimetre-scale texture.
    // The noise origin is -6.236 m. Subtract that datum before blending the
    // landing patch to zero, so the safe area does not become an artificial hill.
    let y = 6.236 - (x * x + z * z) / (2 * 1737400);
    y += (noise(x * 0.002, z * 0.002) - 0.5) * 11;
    y += (noise(x * 0.018, z * 0.018) - 0.5) * 1.25;
    y += (noise(x * 0.11, z * 0.11) - 0.5) * 0.19;
    y += (noise(x * 0.7, z * 0.7) - 0.5) * 0.032;
    const nearby = cells.get(`${Math.floor(x / 64)},${Math.floor(z / 64)}`) || empty;
    const distant = distantCells.get(`${Math.floor(x / 1024)},${Math.floor(z / 1024)}`) || empty;
    for (let i = 0; i < nearby.length + distant.length; i += 1) {
      const c = i < nearby.length ? nearby[i] : distant[i - nearby.length];
      const distance = Math.hypot(x - c.x, z - c.z) / c.radius;
      if (distance > 1.65) continue;
      const angle = Math.atan2(z - c.z, x - c.x);
      const q = distance * (1 + 0.025 * Math.sin(angle * 7) + 0.015 * Math.cos(angle * 11));
      if (q < 1) y -= c.depth * (1 - q * q) ** 1.7;
      y += c.radius * 0.042 * Math.exp(-(((q - 1.03) / 0.14) ** 2));
      y += c.radius * 0.012 * Math.exp(-(((q - 1.2) / 0.28) ** 2)) * Math.sin(angle * 28 + q * 9);
    }
    // A gently graded, unobstructed touchdown area, never a platform or pad.
    const blend = smooth(Math.max(0, Math.min(1, (r - 6) / 13)));
    return y * blend;
  }
  return { random, noise, height, craters };
}));
