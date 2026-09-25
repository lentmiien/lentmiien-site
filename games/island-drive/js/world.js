/* Shared, deterministic world geometry. CommonJS for tests; browser global for the static game. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IslandWorld = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SIZE = 2600;
  const STEP = 10;
  const WATER = 0;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  function random(seed) {
    return () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function baseHeight(x, z) {
    const angle = Math.atan2(z, x);
    const radius = 1060 + 65 * Math.sin(angle * 3 + 0.6) + 35 * Math.cos(angle * 5);
    const shore = radius - Math.hypot(x, z * 1.05);
    const base = clamp(shore * 0.21, -25, 18);
    const hill = 105 * Math.exp(-((x - 340) ** 2 / 270000 + (z + 290) ** 2 / 210000));
    const ridge = 45 * Math.exp(-((x + 300) ** 2 / 160000 + (z + 510) ** 2 / 115000));
    const fade = clamp(shore / 170, 0, 1);
    const town = 1 - 0.85 * Math.exp(-((x + 420) ** 2 + (z - 300) ** 2) / 100000);
    return base + (hill + ridge) * fade * town;
  }
  let terrainBins;
  const vertexCache = new Map();
  function rawHeight(x, z) {
    const key = `${x},${z}`;
    if (vertexCache.has(key)) return vertexCache.get(key);
    if (!terrainBins) {
      terrainBins = new Map();
      for (const [roadId, road] of buildRoads().entries())
        for (let i = 1; i < road.points.length; i++) {
          const a = road.points[i - 1],
            b = road.points[i];
          for (
            let bx = Math.floor((Math.min(a.x, b.x) - 45) / 80);
            bx <= Math.floor((Math.max(a.x, b.x) + 45) / 80);
            bx++
          ) {
            for (
              let bz = Math.floor((Math.min(a.z, b.z) - 45) / 80);
              bz <= Math.floor((Math.max(a.z, b.z) + 45) / 80);
              bz++
            ) {
              const bin = `${bx},${bz}`;
              if (!terrainBins.has(bin)) terrainBins.set(bin, []);
              terrainBins.get(bin).push({ a, b, width: road.width, roadId });
            }
          }
        }
    }
    const natural = baseHeight(x, z);
    let nearest = null,
      distance = Infinity;
    const perRoad = new Map();
    for (const segment of terrainBins.get(`${Math.floor(x / 80)},${Math.floor(z / 80)}`) || []) {
      const point = project(x, z, segment.a, segment.b);
      if (!perRoad.has(segment.roadId) || point.distance < perRoad.get(segment.roadId).distance)
        perRoad.set(segment.roadId, point);
      if (point.distance < distance) {
        distance = point.distance;
        nearest = { ...point, width: segment.width };
      }
    }
    let result = natural;
    if (nearest) {
      // Cut/fill a level cross-section through each road. A generous plateau covers
      // the terrain grid's interpolation footprint; smooth shoulders meet natural land.
      const t = clamp((distance - nearest.width / 2 - 10) / 24, 0, 1);
      const blend = t * t * (3 - 2 * t);
      let sum = 0,
        weights = 0;
      for (const point of perRoad.values()) {
        const weight = Math.exp(-(point.distance * point.distance - distance * distance) / 288);
        sum += baseHeight(point.x, point.z) * weight;
        weights += weight;
      }
      result = (sum / weights) * (1 - blend) + natural * blend;
    }
    // Cache only the finite authored mesh domain; arbitrary driving positions cannot grow it.
    if (
      Number.isInteger(x / STEP) &&
      Number.isInteger(z / STEP) &&
      Math.abs(x) <= SIZE / 2 &&
      Math.abs(z) <= SIZE / 2
    )
      vertexCache.set(key, result);
    return result;
  }
  // Exactly the same triangle split and heights as the rendered mesh.
  function height(x, z) {
    const gx = Math.floor(x / STEP) * STEP;
    const gz = Math.floor(z / STEP) * STEP;
    const u = (x - gx) / STEP;
    const v = (z - gz) / STEP;
    const a = rawHeight(gx, gz);
    const b = rawHeight(gx + STEP, gz);
    const c = rawHeight(gx, gz + STEP);
    const d = rawHeight(gx + STEP, gz + STEP);
    return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
  }
  function project(x, z, a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    return { x: px, z: pz, t, distance: Math.hypot(x - px, z - pz) };
  }
  function curve(points, closed = false) {
    const result = [];
    const p = points.map(([x, z]) => ({ x, z }));
    const count = closed ? p.length : p.length - 1;
    for (let i = 0; i < count; i++) {
      const a = p[(i - 1 + p.length) % p.length];
      const b = p[i];
      const c = p[(i + 1) % p.length];
      const d = p[(i + 2) % p.length];
      const p0 = !closed && i === 0 ? b : a;
      const p3 = !closed && i === count - 1 ? c : d;
      const steps = Math.ceil(Math.hypot(c.x - b.x, c.z - b.z) / 9);
      for (let j = 0; j < steps; j++) {
        const t = j / steps;
        const axis = (key) =>
          0.5 *
          (2 * b[key] +
            (-p0[key] + c[key]) * t +
            (2 * p0[key] - 5 * b[key] + 4 * c[key] - p3[key]) * t * t +
            (-p0[key] + 3 * b[key] - 3 * c[key] + p3[key]) * t * t * t);
        result.push({ x: axis('x'), z: axis('z') });
      }
    }
    result.push(closed ? { ...p[0] } : { ...p[p.length - 1] });
    return result;
  }
  function buildRoads() {
    const roads = [];
    function road(name, points, width = 14, smooth = false, closed = false) {
      roads.push({
        name,
        width,
        points: smooth ? curve(points, closed) : points.map(([x, z]) => ({ x, z })),
      });
    }
    road(
      'Coast Road',
      [
        [-660, 400],
        [-780, 100],
        [-720, -340],
        [-440, -650],
        [0, -740],
        [440, -650],
        [720, -340],
        [810, 80],
        [660, 430],
        [250, 650],
        [-220, 640],
        [-580, 540],
      ],
      15,
      true,
      true
    );
    for (const x of [-580, -460, -340, -220])
      road(
        'Harbour streets',
        [
          [x, 160],
          [x, 400],
        ],
        14
      );
    for (const z of [160, 280, 400])
      road(
        'Harbour streets',
        [
          [-580, z],
          [-220, z],
        ],
        14
      );
    road(
      'West approach',
      [
        [-660, 400],
        [-580, 400],
      ],
      14
    );
    road(
      'South approach',
      [
        [-580, 540],
        [-580, 400],
      ],
      14
    );
    road(
      'Bay Avenue',
      [
        [-220, 400],
        [-80, 460],
        [80, 560],
        [250, 650],
      ],
      14,
      true
    );
    road(
      'Pine Valley',
      [
        [-580, 160],
        [-600, -40],
        [-630, -190],
        [-720, -340],
      ],
      14,
      true
    );
    road(
      'Summit Road',
      [
        [-220, 160],
        [-70, 110],
        [80, -20],
        [240, -140],
        [430, -230],
        [520, -390],
        [440, -650],
      ],
      14,
      true
    );
    road(
      'North ridge',
      [
        [-440, -650],
        [-260, -490],
        [-80, -410],
        [100, -390],
        [280, -310],
        [430, -230],
      ],
      14,
      true
    );
    road(
      'East descent',
      [
        [430, -230],
        [590, -90],
        [700, 10],
        [810, 80],
      ],
      14,
      true
    );
    return roads;
  }
  function createWorld() {
    const rng = random(28101987);
    const roads = buildRoads();
    const segments = [];
    roads.forEach((r, roadId) => {
      for (let i = 1; i < r.points.length; i++)
        segments.push({ a: r.points[i - 1], b: r.points[i], width: r.width, roadId });
    });
    // Spatial bins keep simulation and exclusion checks independent of total road count.
    const bins = new Map();
    for (const s of segments) {
      for (
        let x = Math.floor((Math.min(s.a.x, s.b.x) - 55) / 80);
        x <= Math.floor((Math.max(s.a.x, s.b.x) + 55) / 80);
        x++
      ) {
        for (
          let z = Math.floor((Math.min(s.a.z, s.b.z) - 55) / 80);
          z <= Math.floor((Math.max(s.a.z, s.b.z) + 55) / 80);
          z++
        ) {
          const key = `${x},${z}`;
          if (!bins.has(key)) bins.set(key, []);
          bins.get(key).push(s);
        }
      }
    }
    function roadAt(x, z, full = false) {
      const nearby = full
        ? segments
        : bins.get(`${Math.floor(x / 80)},${Math.floor(z / 80)}`) || [];
      let nearest = { distance: Infinity, edge: Infinity, name: 'Open country' };
      for (const s of nearby) {
        const p = project(x, z, s.a, s.b);
        if (p.distance - s.width / 2 < nearest.edge)
          nearest = {
            ...p,
            edge: p.distance - s.width / 2,
            name: roads[s.roadId].name,
            segment: s,
          };
      }
      return nearest;
    }
    const obstacles = [];
    function place(type, x, z, radius, extra = {}) {
      // Bounding circles include the entire visible object (roof/canopy/lamp arm).
      if (roadAt(x, z, true).edge < radius + 4 || height(x, z) < 3) return false;
      if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.radius + radius + 2)) return false;
      const samples = [
        [radius, 0],
        [-radius, 0],
        [0, radius],
        [0, -radius],
      ].map(([dx, dz]) => height(x + dx, z + dz));
      if (Math.max(...samples) - Math.min(...samples) > (type === 'building' ? 5 : 20))
        return false;
      obstacles.push({ type, x, z, y: height(x, z), radius, ...extra });
      return true;
    }
    for (let x = -625; x <= -170; x += 30) {
      for (let z = 115; z <= 445; z += 30) {
        const w = 12 + rng() * 8;
        const depth = 11 + rng() * 6;
        place('building', x, z, Math.hypot(w / 2 + 1, depth / 2 + 1), {
          w,
          depth,
          h: 8 + rng() * 13,
          tone: Math.floor(rng() * 5),
          roof: rng() > 0.25,
        });
      }
    }
    const landmarks = [
      {
        type: 'lighthouse',
        x: 855,
        z: 330,
        radius: 14,
        name: 'Eastlight',
        label: 'Eastlight · sea cliffs',
      },
      {
        type: 'tower',
        x: 350,
        z: -225,
        radius: 13,
        name: 'Skywatch',
        label: 'Skywatch · high country',
      },
      {
        type: 'barn',
        x: -350,
        z: -310,
        radius: 20,
        name: 'Old farm',
        label: 'Old farm · upland meadows',
      },
      {
        type: 'cafe',
        x: 305,
        z: 700,
        radius: 16,
        name: 'Salt & Pine',
        label: 'Salt & Pine · south beach',
      },
      {
        type: 'chapel',
        x: -620,
        z: -430,
        radius: 14,
        name: 'St. Anne’s',
        label: 'St. Anne’s · pine forest',
      },
    ];
    for (const l of landmarks) {
      if (!place(l.type, l.x, l.z, l.radius, l))
        throw new Error(`Landmark exclusion failed: ${l.name}`);
    }
    for (let i = 0; i < 1900; i++) {
      const x = (rng() - 0.5) * 2000;
      const z = (rng() - 0.5) * 1900;
      if (x > -665 && x < -130 && z > 80 && z < 470) continue;
      const forest = x < -420 && z < 65 && z > -600;
      if (!forest && rng() > 0.34) continue;
      const scale = 0.8 + rng() * 1.1;
      place('tree', x, z, 4.3 * scale, { scale, pine: forest || rng() > 0.5 });
    }
    for (let i = 0; i < 180; i++) {
      const x = (rng() - 0.5) * 2100;
      const z = (rng() - 0.5) * 2050;
      if (height(x, z) > 30 || height(x, z) < 12)
        place('rock', x, z, 3 + rng() * 5, { scale: 2 + rng() * 4 });
    }
    for (const r of roads.filter((r) => r.name === 'Harbour streets')) {
      for (let i = 0; i < 6; i++) {
        const a = r.points[0];
        const b = r.points[1];
        const t = (i + 0.4) / 6;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const length = Math.hypot(dx, dz);
        place('lamp', a.x + dx * t + (dz / length) * 13, a.z + dz * t - (dx / length) * 13, 1.8);
      }
    }
    const sites = [];
    roads.forEach((r, roadId) => {
      let distance = 0;
      for (let i = 1; i < r.points.length; i++) {
        const a = r.points[i - 1];
        const b = r.points[i];
        const length = Math.hypot(b.x - a.x, b.z - a.z);
        const count = Math.max(1, Math.ceil(length / 30));
        for (let j = 0; j < count; j++) {
          distance += length / count;
          if (distance < 140) continue;
          distance = 0;
          const x = a.x + ((b.x - a.x) * j) / count;
          const z = a.z + ((b.z - a.z) * j) / count;
          if (height(x, z) > 3) sites.push({ x, z, roadId, name: r.name });
        }
      }
    });
    return {
      size: SIZE,
      step: STEP,
      roads,
      segments,
      obstacles,
      landmarks,
      sites,
      roadAt,
      height,
      spawn: { x: -460, z: 325, heading: Math.PI },
    };
  }
  return { SIZE, STEP, WATER, clamp, random, height, rawHeight, project, createWorld };
});
