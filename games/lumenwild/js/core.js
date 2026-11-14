(function (root, factory) {
  const common = typeof module === 'object' && module.exports;
  const api = factory(common ? require('./content') : root.LumenwildContent, common ? require('./world') : root.LumenwildWorld, common ? require('./engine') : root.LumenwildEngine);
  if (common) module.exports = api;
  else root.Lumenwild = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (content, world, engine) {
  'use strict';
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  // Keep the v1 generator stable so unfinished expeditions retain their exact
  // map and entity IDs after upgrading. New expeditions use world.js.
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const integer = (n, min, max, fallback = min) => Number.isSafeInteger(n) ? clamp(n, min, max) : fallback;
  const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const same = (a, b) => a.x === b.x && a.y === b.y;
  const plain = value => value && typeof value === 'object' && !Array.isArray(value);

  function hash(text) {
    let h = 2166136261;
    for (const char of String(text).slice(0, 100)) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
    return h >>> 0;
  }

  function random(seed) {
    let state = seed >>> 0;
    return function () {
      state = (state + 0x6D2B79F5) >>> 0;
      let t = Math.imul(state ^ state >>> 15, 1 | state);
      t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function shuffle(array, rng) {
    const result = array.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function walkable(map, x, y, phase = 0) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= map.w || y >= map.h) return false;
    const tile = map.tiles[y * map.w + x];
    return tile === 0 || tile === phase + 2;
  }

  function distances(map, start, phase) {
    const values = new Int16Array(map.w * map.h).fill(-1);
    const queue = [start.y * map.w + start.x];
    values[queue[0]] = 0;
    for (let i = 0; i < queue.length; i += 1) {
      const index = queue[i], x = index % map.w, y = Math.floor(index / map.w);
      for (const [dx, dy] of DIRS) {
        const next = (y + dy) * map.w + x + dx;
        if (walkable(map, x + dx, y + dy, phase) && values[next] === -1) {
          values[next] = values[index] + 1;
          queue.push(next);
        }
      }
    }
    return values;
  }

  // The ordinary paths stay connected in both realms. Phase gates add shortcuts
  // and optional pockets; they never remove the only route to a required item.
  function generateLegacy(seed, depth) {
    const biome = { ...content.BIOMES[depth], enemies: [6, 8, 10][depth] };
    const rng = random(hash(`${seed}:garden:${depth}`));
    const map = { w: biome.w, h: biome.h, tiles: Array(biome.w * biome.h).fill(1), entities: [], enemies: [] };
    const set = (x, y, value = 0) => { map.tiles[y * map.w + x] = value; };
    const stack = [[3, 3]];
    set(3, 3);
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const next = shuffle(DIRS, rng).find(([dx, dy]) => {
        const nx = x + dx * 2, ny = y + dy * 2;
        return nx > 0 && ny > 0 && nx < map.w - 1 && ny < map.h - 1 && map.tiles[ny * map.w + nx] === 1;
      });
      if (!next) { stack.pop(); continue; }
      set(x + next[0], y + next[1]);
      set(x + next[0] * 2, y + next[1] * 2);
      stack.push([x + next[0] * 2, y + next[1] * 2]);
    }
    const rooms = [[3, 3], [map.w - 6, 3], [3, map.h - 6], [map.w - 6, map.h - 6], [Math.floor(map.w / 2), Math.floor(map.h / 2)]];
    for (const [cx, cy] of rooms) {
      for (let y = cy - 1; y <= cy + 1; y += 1) for (let x = cx - 1; x <= cx + 1; x += 1) set(x, y);
    }
    const walls = [];
    for (let y = 2; y < map.h - 2; y += 1) {
      for (let x = 2; x < map.w - 2; x += 1) {
        if (map.tiles[y * map.w + x] !== 1 || distance({ x, y }, { x: 3, y: 3 }) < 5) continue;
        const horizontal = walkable(map, x - 1, y) && walkable(map, x + 1, y);
        const vertical = walkable(map, x, y - 1) && walkable(map, x, y + 1);
        if (horizontal || vertical) walls.push({ x, y });
      }
    }
    shuffle(walls, rng).slice(0, 28 + depth * 5).forEach((point, i) => set(point.x, point.y, i < 9 ? 0 : 2 + i % 2));
    const start = { x: 3, y: 3 };
    const baseDistances = distances(map, start, 0);
    const reserved = new Set(['3,3', '4,3', '2,3', '3,2', '3,4']);
    const candidates = [];
    for (let y = 1; y < map.h - 1; y += 1) for (let x = 1; x < map.w - 1; x += 1) {
      if (map.tiles[y * map.w + x] === 0 && baseDistances[y * map.w + x] > 5) candidates.push({ x, y });
    }
    const cells = shuffle(candidates, rng);
    let serial = 0;
    const add = (type, point, extra = {}) => {
      reserved.add(`${point.x},${point.y}`);
      const entity = { id: `e${serial++}`, type, ...point, ...extra, done: false };
      map.entities.push(entity);
      return entity;
    };
    add('portal', start);
    // Spread the seeds across the garden, rather than merely picking distant
    // cells that could all land in the same corridor.
    const targets = [{ x: map.w - 4, y: 3 }, { x: map.w - 4, y: map.h - 4 }, { x: 3, y: map.h - 4 }];
    targets.forEach((target, i) => {
      const point = candidates.filter(p => !reserved.has(`${p.x},${p.y}`))
        .sort((a, b) => distance(a, target) - distance(b, target))[0];
      add('seed', point, { phase: i === 2 ? -1 : i, number: i + 1 });
    });
    const take = () => cells.find(p => !reserved.has(`${p.x},${p.y}`));
    for (let i = 0; i < 15 + depth * 3; i += 1) add('mote', take());
    for (let i = 0; i < 4; i += 1) add('chest', take(), { prize: i });
    for (let i = 0; i < 3; i += 1) add('memory', take(), { memory: depth * 3 + i });
    for (let i = 0; i < 2; i += 1) add('medicine', take());
    add('bomb', take());
    add('thread', take());
    add('well', take());
    add('shrine', take(), { sequence: shuffle([0, 1, 2], rng), progress: 0 });
    // One clearly visible practice pickup introduces automatic collection.
    add('mote', { x: 4, y: 3 });
    for (let i = 0; i < biome.enemies; i += 1) {
      const point = cells.find(p => !reserved.has(`${p.x},${p.y}`) && distance(p, start) > 9 &&
        map.enemies.every(enemy => distance(p, enemy) > 4));
      if (!point) break;
      reserved.add(`${point.x},${point.y}`);
      const kind = depth === 0 ? (i % 4 === 3 ? 1 : 0) : (i + depth) % 3;
      map.enemies.push({ id: `foe${i}`, ...point, kind, hp: kind === 2 ? 4 : 2, intent: [], stun: 0, awake: false });
    }
    return map;
  }

  function lineOfSight(map, a, b, phase) {
    let x = a.x, y = a.y;
    const dx = Math.abs(b.x - x), dy = Math.abs(b.y - y), sx = x < b.x ? 1 : -1, sy = y < b.y ? 1 : -1;
    let error = dx - dy;
    for (let i = 0; i < map.w + map.h; i += 1) {
      if (x === b.x && y === b.y) return true;
      if (!(x === a.x && y === a.y) && !walkable(map, x, y, phase)) return false;
      const twice = 2 * error;
      if (twice > -dy) { error -= dy; x += sx; }
      if (twice < dx) { error += dx; y += sy; }
    }
    return false;
  }

  return engine.createApi(content, world, { clamp, integer, distance, same, plain, hash, random, shuffle, walkable, distances, lineOfSight, generateLegacy, DIRS });
}));
