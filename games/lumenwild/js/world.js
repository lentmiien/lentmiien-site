(function (root, factory) {
  const content = typeof module === 'object' && module.exports ? require('./content') : root.LumenwildContent;
  const api = factory(content);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LumenwildWorld = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (content) {
  'use strict';

  function generate(seed, region, plan, tier, helpers) {
    const { hash, random, shuffle, walkable, distances, distance, DIRS } = helpers;
    const biome = content.BIOMES[region];
    const rng = random(hash(`${seed}:beyond:${region}`));
    const map = { w: biome.w, h: biome.h, tiles: Array(biome.w * biome.h).fill(1), entities: [], enemies: [], shortcuts: [], vents: [], clearings: [] };
    const set = (x, y, value = 0) => {
      if (x > 0 && y > 0 && x < map.w - 1 && y < map.h - 1) map.tiles[y * map.w + x] = value;
    };
    const line = (a, b) => {
      let x = a.x, y = a.y;
      set(x, y);
      while (x !== b.x) { x += Math.sign(b.x - x); set(x, y); }
      while (y !== b.y) { y += Math.sign(b.y - y); set(x, y); }
    };
    const room = (x, y, radius = 1, circle = false) => {
      for (let yy = y - radius; yy <= y + radius; yy += 1) for (let xx = x - radius; xx <= x + radius; xx += 1) {
        if (!circle || Math.hypot(xx - x, yy - y) <= radius + .3) {
          set(xx, yy);
          if (xx > 0 && yy > 0 && xx < map.w - 1 && yy < map.h - 1) map.clearings.push(yy * map.w + xx);
        }
      }
    };

    if (biome.layout === 'clockwork') {
      for (let y = 3; y < map.h - 2; y += 8) for (let x = 3; x < map.w - 2; x += 8) {
        room(x, y, 2);
        if (x > 3) { line({ x: x - 8, y }, { x, y }); line({ x: x - 8, y: y + 2 }, { x, y: y + 2 }); }
        if (y > 3) { line({ x, y: y - 8 }, { x, y }); line({ x: x + 2, y: y - 8 }, { x: x + 2, y }); }
      }
    } else if (biome.layout === 'constellation') {
      const center = { x: Math.floor(map.w / 2), y: Math.floor(map.h / 2) };
      room(center.x, center.y, 3, true);
      line({ x: 3, y: 3 }, center);
      const islands = [];
      const angle = rng() * .35;
      for (let i = 0; i < 8; i += 1) {
        const a = i / 8 * Math.PI * 2 + angle;
        const p = { x: Math.round(center.x + Math.cos(a) * (map.w / 2 - 5)), y: Math.round(center.y + Math.sin(a) * (map.h / 2 - 5)) };
        islands.push(p); room(p.x, p.y, 2, true);
        if (i % 2) line(p, center); else line(center, p);
      }
      for (let i = 1; i < islands.length; i += 2) line(islands[i - 1], islands[i]);
    } else {
      // A growing-tree maze gives the orchard bushier branching, while a
      // depth-first tree gives the old hedges their long winding corridors.
      const stack = [[3, 3]]; set(3, 3);
      while (stack.length) {
        const selected = biome.layout === 'groves' && rng() < .7 ? Math.floor(rng() * stack.length) : stack.length - 1;
        const [x, y] = stack[selected];
        let directions = shuffle(DIRS, rng);
        if (biome.layout === 'canals' && rng() < .75) directions.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]));
        const next = directions.find(([dx, dy]) => {
          const nx = x + dx * 2, ny = y + dy * 2;
          return nx > 0 && ny > 0 && nx < map.w - 1 && ny < map.h - 1 && map.tiles[ny * map.w + nx] === 1;
        });
        if (!next) { stack.splice(selected, 1); continue; }
        set(x + next[0], y + next[1]); set(x + next[0] * 2, y + next[1] * 2);
        stack.push([x + next[0] * 2, y + next[1] * 2]);
      }
      if (biome.layout === 'library') {
        for (let y = 3; y < map.h - 2; y += 6) { line({ x: 2, y }, { x: map.w - 3, y }); room(map.w - 5, y, 1); }
      } else if (biome.layout === 'groves' || biome.layout === 'caverns') {
        for (let i = 0; i < 8; i += 1) room(4 + Math.floor(rng() * (map.w - 8)), 4 + Math.floor(rng() * (map.h - 8)), biome.layout === 'caverns' ? 2 + i % 2 : 2, true);
      } else if (biome.layout === 'courtyards') {
        for (let y = 4; y < map.h - 4; y += 8) for (let x = 4; x < map.w - 4; x += 8) room(x, y, 2);
      } else if (biome.layout === 'caldera') {
        const cx = Math.floor(map.w / 2), cy = Math.floor(map.h / 2);
        for (const radius of [5, 10]) {
          let previous = { x: cx + radius, y: cy };
          for (let i = 1; i <= 48; i += 1) {
            const a = i / 48 * Math.PI * 2, next = { x: cx + Math.round(Math.cos(a) * radius), y: cy + Math.round(Math.sin(a) * radius) };
            line(previous, next); previous = next;
          }
        }
        room(cx, cy, 3, true);
      } else {
        for (const [x, y] of [[3, 3], [map.w - 5, 4], [4, map.h - 5], [map.w - 5, map.h - 5]]) room(x, y, biome.layout === 'canals' ? 2 : 1);
      }
    }
    room(3, 3, 1);
    const walls = [];
    for (let y = 2; y < map.h - 2; y += 1) for (let x = 2; x < map.w - 2; x += 1) {
      if (map.tiles[y * map.w + x] !== 1 || distance({ x, y }, { x: 3, y: 3 }) < 5) continue;
      if ((walkable(map, x - 1, y) && walkable(map, x + 1, y)) || (walkable(map, x, y - 1) && walkable(map, x, y + 1))) walls.push({ x, y });
    }
    const openCount = Math.min(5, Math.max(0, walls.length - 4));
    shuffle(walls, rng).slice(0, 28 + region * 2).forEach((p, i) => {
      set(p.x, p.y, i < openCount ? 0 : 2 + i % 2);
      if (i >= openCount) map.shortcuts.push(p.y * map.w + p.x);
    });

    const reachable = distances(map, { x: 3, y: 3 }, 0);
    const candidates = [];
    for (let y = 1; y < map.h - 1; y += 1) for (let x = 1; x < map.w - 1; x += 1) {
      if (map.tiles[y * map.w + x] === 0 && reachable[y * map.w + x] > 5) candidates.push({ x, y });
    }
    const reserved = new Set(['3,3', '4,3', '2,3', '3,2', '3,4']);
    const cells = shuffle(candidates, rng);
    let serial = 0;
    const add = (type, p, extra = {}) => {
      if (!p) return null;
      reserved.add(`${p.x},${p.y}`);
      const entity = { id: `e${serial++}`, type, ...p, ...extra, done: false };
      map.entities.push(entity); return entity;
    };
    const take = () => cells.find(p => !reserved.has(`${p.x},${p.y}`));
    add('portal', { x: 3, y: 3 });
    const targets = [{ x: map.w - 4, y: 3 }, { x: map.w - 4, y: map.h - 4 }, { x: 3, y: map.h - 4 }];
    targets.forEach((target, i) => {
      const point = candidates.filter(p => !reserved.has(`${p.x},${p.y}`)).sort((a, b) => distance(a, target) - distance(b, target))[0];
      add('seed', point, { phase: i === 2 ? -1 : i, number: i + 1 });
    });
    for (let i = 0; i < 18 + Math.min(region, 6); i += 1) add('mote', take());
    for (let i = 0; i < 4; i += 1) add('chest', take(), { prize: i });
    for (const memory of plan.memories) add('memory', take(), { memory });
    add('relic', take(), { relic: plan.relic });
    for (let i = 0; i < 3; i += 1) add('landmark', take(), { number: i + 1, phase: (i + region) % 2 });
    for (let i = 0; i < 2; i += 1) add('medicine', take());
    add('bomb', take()); add('thread', take()); add('well', take());
    add('shrine', take(), { sequence: shuffle([0, 1, 2], rng), progress: 0 });
    add('mote', { x: 4, y: 3 });
    if (biome.feature === 'vents') {
      for (let i = 0; i < 5; i += 1) {
        const p = take(); reserved.add(`${p.x},${p.y}`);
        map.vents.push({ ...p, timer: 2 + i, warning: false });
      }
    }
    for (let i = 0; i < biome.enemies; i += 1) {
      const p = cells.find(cell => !reserved.has(`${cell.x},${cell.y}`) && distance(cell, { x: 3, y: 3 }) > 10 && map.enemies.every(e => distance(e, cell) > 4));
      if (!p) break;
      reserved.add(`${p.x},${p.y}`);
      const kind = biome.kinds[i % biome.kinds.length], species = content.ENEMIES[kind];
      map.enemies.push({ id: `foe${i}`, ...p, kind, hp: species.hp + tier - 1, intent: [], stun: 0, awake: false, windup: 0, windupTotal: 0, moveWait: .4, rest: .5, known: false });
    }
    map.clearings = [...new Set(map.clearings)];
    return map;
  }
  return { generate };
}));
