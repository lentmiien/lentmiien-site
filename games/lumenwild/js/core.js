/* Lumenwild's deterministic simulation. Also loaded directly by the Jest tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Lumenwild = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const VERSION = 1;
  const SAVE_KEY = 'lumenwild.garden.v1';
  const MAX_SAVE = 120000;
  const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const BIOMES = [
    { name: 'Verdant Hollows', subtitle: 'Where the lanterns first took root', color: '#61d9a0', w: 29, h: 23, enemies: 6 },
    { name: 'Moonwell Archive', subtitle: 'Even the stones remember the stars', color: '#79dce8', w: 31, h: 25, enemies: 8 },
    { name: 'Glassbloom Conservatory', subtitle: 'A thousand flowers, waiting for dawn', color: '#e7a0d9', w: 33, h: 27, enemies: 10 },
  ];
  const MEMORIES = [
    ['A light left on', 'The first keeper hung a lantern in the woods. Not to keep the dark out, but to give lost things somewhere to come home.'],
    ['The patient gardener', 'Every path was planted by someone who would never walk its full length. The garden remembers that kindness.'],
    ['Two sides of a leaf', 'Bloom is the garden as it lives. Echo is the garden as it dreams. Neither is the wrong side of the world.'],
    ['Moonwater', 'The archive has no ink. Its stories are kept in water, and read by the light of a patient moon.'],
    ['The small brave things', 'Before the keepers, the moths carried the light. Never mistake a small flame for a small courage.'],
    ['A map of returns', 'A good map tells you where to go. A beloved map tells you how to get home.'],
    ['The last glassblower', 'She made flowers that could hold the sunrise. When the sun disappeared, they kept its promise.'],
    ['Sleeping thorns', 'The sentinels are not cruel. They have simply forgotten what they were guarding. Let your lantern remind them.'],
    ['The folded garden', 'The world did not break. It folded itself around one last seed, and waited for someone gentle enough to unfold it.'],
  ];
  const BLESSINGS = [
    { id: 'radiance', name: 'Sunfire lantern', text: 'Your lantern sweep deals +1 damage.', icon: 6 },
    { id: 'reach', name: 'Long summer', text: 'Your sweep reaches one tile farther.', icon: 14 },
    { id: 'vitality', name: 'Wild heart', text: 'Gain two maximum hearts and heal fully.', icon: 1 },
    { id: 'drift', name: 'Mothstep', text: 'Dash one tile farther; recover it sooner.', icon: 15 },
    { id: 'harvest', name: 'Kindred roots', text: 'Defeating a creature restores one heart.', icon: 12 },
    { id: 'echo', name: 'Echo mantle', text: 'Shifting shields you from the next two enemy turns.', icon: 4 },
    { id: 'sight', name: 'Stargazer', text: 'See farther; guiding threads last twice as long.', icon: 8 },
    { id: 'satchel', name: 'Pocket alchemy', text: 'Receive two medicines, seedbombs, and threads.', icon: 3 },
  ];
  const UPGRADES = [
    { id: 'hearth', name: 'Keeper’s hearth', text: '+1 starting heart per level', icon: 10, costs: [18, 34, 52] },
    { id: 'satchel', name: 'Herbalist’s satchel', text: '+1 medicine and seedbomb per level', icon: 2, costs: [15, 30, 45] },
    { id: 'lens', name: 'Firefly observatory', text: '+1 sight radius per level', icon: 14, costs: [20, 36, 54] },
  ];
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
  function generate(seed, depth) {
    const biome = BIOMES[depth];
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

  function profile(value) {
    const p = plain(value) ? value : {};
    return {
      light: integer(p.light, 0, 999999), wins: integer(p.wins, 0, 99999), runs: integer(p.runs, 0, 99999),
      best: integer(p.best, 0, 999999), dailyBest: integer(p.dailyBest, 0, 999999),
      upgrades: Object.fromEntries(UPGRADES.map(u => [u.id, integer(p.upgrades?.[u.id], 0, 3)])),
      memories: Array.isArray(p.memories) ? [...new Set(p.memories.filter(n => Number.isInteger(n) && n >= 0 && n < MEMORIES.length))] : [],
      sound: p.sound === true, gentle: p.gentle === true,
    };
  }

  function buyUpgrade(p, id) {
    const upgrade = UPGRADES.find(u => u.id === id);
    if (!upgrade) return false;
    const level = p.upgrades[id], cost = upgrade.costs[level];
    if (cost === undefined || p.light < cost) return false;
    p.light -= cost;
    p.upgrades[id] += 1;
    return true;
  }

  class Game {
    constructor(options = {}) {
      this.seed = integer(options.seed, 0, 4294967295, 1);
      this.daily = options.daily === true;
      this.gentle = !this.daily && options.gentle === true;
      this.upgrades = this.daily ? profile().upgrades : profile({ upgrades: options.upgrades }).upgrades;
      this.depth = 0;
      this.phase = 0;
      this.turn = 0;
      this.steps = 0;
      this.kills = 0;
      this.light = 0;
      this.score = 0;
      this.memories = [];
      this.blessings = [];
      this.inventory = { medicine: 2 + this.upgrades.satchel + (this.gentle ? 2 : 0), bomb: 2 + this.upgrades.satchel, thread: 3 };
      this.player = { x: 3, y: 3, facing: 2, hp: this.stats().maxHp };
      this.dashCooldown = 0;
      this.shiftCooldown = 0;
      this.shield = 0;
      this.guideTurns = 0;
      this.status = 'playing';
      this.events = [];
      this.enterGarden();
    }

    has(id) { return this.blessings.filter(b => b === id).length; }

    stats() {
      return {
        maxHp: 7 + this.upgrades.hearth + this.has('vitality') * 2 + (this.gentle ? 3 : 0),
        damage: 1 + this.has('radiance'), reach: 1 + this.has('reach'),
        sight: 5 + this.upgrades.lens + this.has('sight') * 2,
        dash: 3 + this.has('drift'), dashWait: Math.max(2, 5 - this.has('drift') * 2),
      };
    }

    enterGarden() {
      this.map = generate(this.seed, this.depth);
      this.guideCache = null;
      this.seen = new Set();
      this.visible = new Set();
      this.player.x = 3; this.player.y = 3;
      this.phase = 0;
      this.seeds = 0;
      this.dashCooldown = 0; this.shiftCooldown = 0; this.guideTurns = 0;
      this.reveal();
    }

    emit(type, text = '', extra = {}) { this.events.push({ type, text, ...extra }); }

    reveal() {
      this.visible.clear();
      const { sight } = this.stats(), { x, y } = this.player;
      for (let yy = Math.max(0, y - sight); yy <= Math.min(this.map.h - 1, y + sight); yy += 1) {
        for (let xx = Math.max(0, x - sight); xx <= Math.min(this.map.w - 1, x + sight); xx += 1) {
          if (Math.hypot(xx - x, yy - y) <= sight + .5 && lineOfSight(this.map, this.player, { x: xx, y: yy }, this.phase)) {
            const index = yy * this.map.w + xx;
            this.seen.add(index); this.visible.add(index);
          }
        }
      }
    }

    entityAt(x, y) { return this.map.entities.find(e => !e.done && e.x === x && e.y === y); }
    enemyAt(x, y) { return this.map.enemies.find(e => e.hp > 0 && e.x === x && e.y === y); }

    collect() {
      const e = this.entityAt(this.player.x, this.player.y);
      if (!e) return;
      if (e.type === 'seed') {
        if (e.phase !== -1 && this.phase !== e.phase) {
          this.emit('hint', `This heartseed lives in ${e.phase ? 'Echo' : 'Bloom'}. Press Q to shift.`);
          return;
        }
        e.done = true; this.seeds += 1; this.score += 100; this.light += 4;
        this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 1);
        this.emit('seed', `Heartseed ${this.seeds} / 3 · one heart restored`, { x: e.x, y: e.y });
      } else if (e.type === 'mote') {
        e.done = true; this.light += 1; this.score += 10;
        this.emit('pickup', '+1 starlight', { x: e.x, y: e.y });
      } else if (['medicine', 'bomb', 'thread'].includes(e.type)) {
        if (this.inventory[e.type] >= 9) return;
        e.done = true; this.inventory[e.type] += 1;
        this.emit('pickup', `${e.type === 'medicine' ? 'Moonberry tonic' : e.type === 'bomb' ? 'Seedbomb' : 'Guiding thread'} found`, { x: e.x, y: e.y });
      } else if (e.type === 'memory') {
        e.done = true; this.score += 35; this.light += 2;
        if (!this.memories.includes(e.memory)) this.memories.push(e.memory);
        this.emit('memory', MEMORIES[e.memory][0], { memory: e.memory });
      }
    }

    nearby() {
      return this.map.entities.filter(e => !e.done && ['portal', 'chest', 'well', 'shrine'].includes(e.type) && distance(e, this.player) <= 1)
        .sort((a, b) => distance(a, this.player) - distance(b, this.player))[0];
    }

    hit(enemy, damage) {
      enemy.hp = Math.max(0, enemy.hp - damage);
      enemy.stun = 2;
      enemy.intent = [];
      this.emit('hit', '', { x: enemy.x, y: enemy.y, damage });
      if (!enemy.hp) {
        this.kills += 1; this.score += 25; this.light += 2;
        this.player.hp = Math.min(this.stats().maxHp, this.player.hp + this.has('harvest'));
        this.emit('defeat', '+2 starlight · creature freed', { x: enemy.x, y: enemy.y, kind: enemy.kind });
      }
    }

    interact() {
      const e = this.nearby();
      if (!e) { this.emit('hint', 'Stand beside a chest, spring, rune shrine, or waygate.'); return false; }
      if (e.type === 'portal') {
        if (this.seeds < 3) { this.emit('hint', `The waygate needs ${3 - this.seeds} more heartseed${this.seeds === 2 ? '' : 's'}.`); return false; }
        this.score += 200 + Math.round(this.seen.size / (this.map.w * this.map.h) * 100);
        this.light += 10;
        this.status = this.depth === 2 ? 'won' : 'blessing';
        this.emit('restored', BIOMES[this.depth].name);
        return true;
      }
      if (e.type === 'shrine') { this.emit('puzzle', '', { id: e.id }); return false; }
      e.done = true;
      if (e.type === 'chest') {
        this.light += 5; this.score += 40;
        const supply = ['medicine', 'bomb', 'thread'][e.prize % 3];
        this.inventory[supply] = Math.min(9, this.inventory[supply] + 1);
        this.emit('chest', `Cache opened · +5 starlight and a ${supply}`, { x: e.x, y: e.y });
      } else {
        this.player.hp = this.stats().maxHp;
        this.emit('heal', 'Moonwell spring · all hearts restored');
      }
      return true;
    }

    solveRune(symbol) {
      this.events = [];
      const shrine = this.nearby();
      if (this.status !== 'playing' || !shrine || shrine.type !== 'shrine' || ![0, 1, 2].includes(symbol)) return false;
      if (shrine.sequence[shrine.progress] !== symbol) {
        shrine.progress = 0;
        this.emit('hint', 'The song fades. Follow the three symbols from left to right.');
        return false;
      }
      shrine.progress += 1;
      if (shrine.progress === 3) {
        shrine.done = true;
        this.light += 8; this.score += 80;
        this.inventory.bomb = Math.min(9, this.inventory.bomb + 1);
        this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 2);
        this.emit('puzzleSolved', 'The garden remembers its song · +8 starlight, a seedbomb, and two hearts');
        this.reveal();
      } else this.emit('rune', `${shrine.progress} / 3 notes awakened`);
      return true;
    }

    choices() {
      const available = BLESSINGS.filter(blessing => !this.blessings.includes(blessing.id));
      return shuffle(available, random(hash(`${this.seed}:blessing:${this.depth}`))).slice(0, 3);
    }

    chooseBlessing(id) {
      if (this.status !== 'blessing' || !this.choices().some(b => b.id === id)) return false;
      this.blessings.push(id);
      if (id === 'satchel') for (const key of Object.keys(this.inventory)) this.inventory[key] = Math.min(9, this.inventory[key] + 2);
      this.player.hp = this.stats().maxHp;
      this.inventory.medicine = Math.min(9, this.inventory.medicine + 1);
      this.inventory.thread = Math.min(9, this.inventory.thread + 1);
      this.depth += 1;
      this.status = 'playing';
      this.enterGarden();
      this.events = [];
      this.emit('garden', BIOMES[this.depth].name);
      return true;
    }

    act(action, direction) {
      this.events = [];
      if (this.status !== 'playing') return false;
      const p = this.player;
      let acted = false;
      if (action === 'move' && Number.isInteger(direction) && direction >= 0 && direction < 4) {
        p.facing = direction;
        const [dx, dy] = DIRS[direction], x = p.x + dx, y = p.y + dy;
        if (!walkable(this.map, x, y, this.phase)) {
          this.emit('blocked', this.map.tiles[y * this.map.w + x] >= 2 ? 'A folded path. Q switches Bloom and Echo.' : 'Roots block the way. Try another path.');
          return false;
        }
        const enemy = this.enemyAt(x, y);
        if (enemy) { this.hit(enemy, this.stats().damage); this.emit('sweep'); }
        else { p.x = x; p.y = y; this.steps += 1; this.collect(); this.emit('move'); }
        acted = true;
      } else if (action === 'attack') {
        const { reach, damage } = this.stats();
        this.map.enemies.filter(e => e.hp > 0 && Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= reach &&
          lineOfSight(this.map, p, e, this.phase)).forEach(e => this.hit(e, damage));
        this.emit('sweep'); acted = true;
      } else if (action === 'shift') {
        if (this.shiftCooldown) { this.emit('hint', `The fold settles in ${this.shiftCooldown} turn${this.shiftCooldown > 1 ? 's' : ''}.`); return false; }
        if (!walkable(this.map, p.x, p.y, 1 - this.phase)) { this.emit('hint', 'Step off the folded path before shifting.'); return false; }
        this.phase = 1 - this.phase;
        this.shiftCooldown = 3;
        this.shield = Math.max(this.shield, this.has('echo') ? 3 : 1);
        this.map.enemies.forEach(e => {
          e.intent = [];
          if (distance(e, p) <= 5) e.stun = 2;
        });
        this.collect();
        this.emit('shift', `${this.phase ? 'Echo' : 'Bloom'} awakened · nearby creatures are dazed`);
        acted = true;
      } else if (action === 'dash') {
        if (this.dashCooldown) { this.emit('hint', `Mothstep returns in ${this.dashCooldown} turns.`); return false; }
        const [dx, dy] = DIRS[p.facing];
        for (let i = 0; i < this.stats().dash; i += 1) {
          if (!walkable(this.map, p.x + dx, p.y + dy, this.phase) || this.enemyAt(p.x + dx, p.y + dy)) break;
          p.x += dx; p.y += dy; this.steps += 1; this.collect(); acted = true;
        }
        if (!acted) { this.emit('hint', 'Face an open path to dash.'); return false; }
        this.dashCooldown = this.stats().dashWait + 1;
        this.shield = Math.max(this.shield, 1);
        this.emit('dash');
      } else if (action === 'medicine') {
        if (!this.inventory.medicine || p.hp >= this.stats().maxHp) {
          this.emit('hint', this.inventory.medicine ? 'Your hearts are already full.' : 'No tonic left. Look for a spring or a chest.'); return false;
        }
        this.inventory.medicine -= 1;
        p.hp = Math.min(this.stats().maxHp, p.hp + 5);
        this.shield = Math.max(this.shield, 1);
        this.emit('heal', 'Moonberry tonic · five hearts restored'); acted = true;
      } else if (action === 'bomb') {
        if (!this.inventory.bomb) { this.emit('hint', 'No seedbombs left. Search a treasure cache.'); return false; }
        this.inventory.bomb -= 1;
        this.map.enemies.filter(e => e.hp > 0 && distance(e, p) <= 4 && lineOfSight(this.map, p, e, this.phase)).forEach(e => this.hit(e, 4));
        this.shield = Math.max(this.shield, 1);
        this.emit('bomb', 'Seedburst!'); acted = true;
      } else if (action === 'thread') {
        if (!this.inventory.thread) { this.emit('hint', 'No threads left. The atlas still remembers every path you have seen.'); return false; }
        this.inventory.thread -= 1;
        this.guideTurns = this.has('sight') ? 81 : 41;
        this.emit('guide', 'Follow the golden thread. A ring on the trail means shift there.'); acted = true;
      } else if (action === 'interact') acted = this.interact();
      else if (action === 'wait') { acted = true; this.emit('wait'); }
      if (!acted) return false;
      this.turn += 1;
      if (this.status === 'playing') this.enemiesTurn();
      this.dashCooldown = Math.max(0, this.dashCooldown - 1);
      this.shiftCooldown = Math.max(0, this.shiftCooldown - 1);
      this.shield = Math.max(0, this.shield - 1);
      this.guideTurns = Math.max(0, this.guideTurns - 1);
      this.reveal();
      if (p.hp <= 0) { this.status = 'lost'; this.emit('lost', 'Your lantern brings you safely home.'); }
      return true;
    }

    enemiesTurn() {
      const { map, player: p } = this;
      const field = distances(map, p, this.phase);
      let hurt = false;
      for (const enemy of map.enemies) {
        if (enemy.hp <= 0) continue;
        if (!walkable(map, enemy.x, enemy.y, this.phase)) { enemy.intent = []; continue; }
        if (enemy.stun > 0) { enemy.stun -= 1; continue; }
        if (enemy.intent.length) {
          if (enemy.intent.some(cell => same(cell, p)) && !this.shield && !hurt) {
            p.hp = Math.max(0, p.hp - (enemy.kind === 2 && !this.gentle ? 2 : 1));
            hurt = true; this.shield = 2;
            this.emit('hurt', 'Move out of the marked tiles, or interrupt with a lantern sweep.');
          }
          this.emit('enemyAttack', '', { x: enemy.x, y: enemy.y });
          enemy.intent = []; enemy.stun = 1;
          continue;
        }
        const d = field[enemy.y * map.w + enemy.x];
        if (d < 0 || d > 7 || !lineOfSight(map, enemy, p, this.phase)) continue;
        enemy.awake = true;
        if (distance(enemy, p) <= (enemy.kind === 1 ? 3 : 1)) {
          if (enemy.kind === 1) {
            // Wisps aim at where you ARE, not where you will move next.
            enemy.intent = [{ x: p.x, y: p.y }];
          } else {
            enemy.intent = DIRS.map(([dx, dy]) => ({ x: enemy.x + dx, y: enemy.y + dy }))
              .filter(cell => walkable(map, cell.x, cell.y, this.phase));
          }
          this.emit('warning', 'A creature is winding up. Leave the marked tiles or strike first.');
        } else if ((this.turn + Number(enemy.id.slice(3))) % (enemy.kind === 2 ? 3 : 2) === 0) {
          const options = DIRS.map(([dx, dy]) => ({ x: enemy.x + dx, y: enemy.y + dy }))
            .filter(cell => walkable(map, cell.x, cell.y, this.phase) && !same(cell, p) && !this.enemyAt(cell.x, cell.y))
            .sort((a, b) => field[a.y * map.w + a.x] - field[b.y * map.w + b.x]);
          const next = options.find(cell => field[cell.y * map.w + cell.x] >= 0 && field[cell.y * map.w + cell.x] < d);
          if (next) { enemy.x = next.x; enemy.y = next.y; }
        }
      }
    }

    // Search position AND realm. A consecutive identical position with a new
    // phase is an explicit instruction to shift, never a route through a wall.
    route(target) {
      const { map } = this, area = map.w * map.h;
      const start = this.phase * area + this.player.y * map.w + this.player.x;
      const queue = [start], previous = new Int32Array(area * 2).fill(-1);
      previous[start] = start;
      let end = -1;
      for (let i = 0; i < queue.length; i += 1) {
        const index = queue[i], phase = Math.floor(index / area), cell = index % area;
        const x = cell % map.w, y = Math.floor(cell / map.w);
        if (x === target.x && y === target.y && (target.phase === undefined || target.phase === -1 || phase === target.phase)) { end = index; break; }
        const nexts = DIRS.map(([dx, dy]) => ({ x: x + dx, y: y + dy, phase }));
        nexts.push({ x, y, phase: 1 - phase });
        for (const next of nexts) {
          if (!walkable(map, next.x, next.y, next.phase)) continue;
          const ni = next.phase * area + next.y * map.w + next.x;
          if (previous[ni] !== -1) continue;
          previous[ni] = index; queue.push(ni);
        }
      }
      if (end === -1) return [];
      const result = [];
      for (let i = end; i !== start; i = previous[i]) result.push({ x: i % area % map.w, y: Math.floor(i % area / map.w), phase: Math.floor(i / area) });
      result.push({ ...this.player, phase: this.phase });
      return result.reverse();
    }

    guide() {
      const key = `${this.depth}:${this.turn}:${this.phase}:${this.player.x}:${this.player.y}:${this.seeds}`;
      if (this.guideCache?.key === key) return this.guideCache.route;
      const targets = this.map.entities.filter(e => e.type === (this.seeds === 3 ? 'portal' : 'seed') && !e.done);
      const route = targets.map(target => this.route(target)).filter(path => path.length).sort((a, b) => a.length - b.length)[0] || [];
      this.guideCache = { key, route };
      return route;
    }

    snapshot() {
      return {
        seed: this.seed, daily: this.daily, gentle: this.gentle, upgrades: this.upgrades, depth: this.depth,
        phase: this.phase, turn: this.turn, steps: this.steps, kills: this.kills, light: this.light, score: this.score,
        memories: this.memories, blessings: this.blessings, inventory: this.inventory, player: this.player,
        dashCooldown: this.dashCooldown, shiftCooldown: this.shiftCooldown, shield: this.shield, guideTurns: this.guideTurns,
        status: this.status, seen: [...this.seen],
        entities: this.map.entities.map(e => ({ id: e.id, done: e.done, progress: e.progress || 0 })),
        enemies: this.map.enemies.map(e => ({ id: e.id, x: e.x, y: e.y, hp: e.hp, intent: e.intent, stun: e.stun, awake: e.awake })),
      };
    }

    static restore(s) {
      if (!plain(s) || !plain(s.player) || !plain(s.inventory) || !Number.isSafeInteger(s.seed) || s.seed < 0 || s.seed > 4294967295 ||
        ![0, 1, 2].includes(s.depth) || ![0, 1].includes(s.phase) || !['playing', 'blessing'].includes(s.status) ||
        !Array.isArray(s.blessings) || s.blessings.length !== s.depth || s.blessings.some(id => !BLESSINGS.some(b => b.id === id)) ||
        !Array.isArray(s.entities) || !Array.isArray(s.enemies) || !Array.isArray(s.seen) || s.seen.length > 1000) return null;
      const game = new Game(s);
      game.depth = s.depth;
      game.blessings = s.blessings.slice();
      game.enterGarden();
      game.phase = s.phase;
      if (!walkable(game.map, s.player.x, s.player.y, s.phase) || !Number.isInteger(s.player.hp) || s.player.hp < 1) return null;
      game.player = { x: s.player.x, y: s.player.y, hp: integer(s.player.hp, 1, game.stats().maxHp), facing: integer(s.player.facing, 0, 3, 2) };
      for (const key of ['turn', 'steps', 'kills', 'light', 'score']) game[key] = integer(s[key], 0, 999999);
      for (const key of ['medicine', 'bomb', 'thread']) game.inventory[key] = integer(s.inventory[key], 0, 9);
      game.memories = profile({ memories: s.memories }).memories;
      if (s.entities.length !== game.map.entities.length || s.enemies.length !== game.map.enemies.length) return null;
      for (let i = 0; i < game.map.entities.length; i += 1) {
        const e = game.map.entities[i], saved = s.entities[i];
        if (!plain(saved) || saved.id !== e.id || typeof saved.done !== 'boolean') return null;
        if (e.type !== 'portal') e.done = saved.done;
        if (e.type === 'shrine') e.progress = integer(saved.progress, 0, e.done ? 3 : 2);
      }
      const occupied = new Set();
      for (let i = 0; i < game.map.enemies.length; i += 1) {
        const e = game.map.enemies[i], saved = s.enemies[i];
        if (!plain(saved) || saved.id !== e.id || ![0, 1].some(phase => walkable(game.map, saved.x, saved.y, phase)) ||
          !Array.isArray(saved.intent) || saved.intent.length > 4 || saved.intent.some(cell => !plain(cell) || !walkable(game.map, cell.x, cell.y, game.phase))) return null;
        const hp = integer(saved.hp, 0, e.hp);
        if (hp > 0) {
          if (occupied.has(`${saved.x},${saved.y}`) || same(saved, game.player)) return null;
          occupied.add(`${saved.x},${saved.y}`);
        }
        Object.assign(e, { x: saved.x, y: saved.y, hp,
          intent: saved.intent.map(cell => ({ x: cell.x, y: cell.y })), stun: integer(saved.stun, 0, 2), awake: saved.awake === true });
      }
      game.seeds = game.map.entities.filter(e => e.type === 'seed' && e.done).length;
      if (s.status === 'blessing' && (game.depth === 2 || game.seeds !== 3)) return null;
      game.status = s.status;
      game.dashCooldown = integer(s.dashCooldown, 0, 5);
      game.shiftCooldown = integer(s.shiftCooldown, 0, 2);
      game.shield = integer(s.shield, 0, 2);
      game.guideTurns = integer(s.guideTurns, 0, 80);
      game.seen = new Set(s.seen.filter(i => Number.isInteger(i) && i >= 0 && i < game.map.w * game.map.h));
      game.reveal();
      return game;
    }
  }

  function readSave(raw) {
    if (typeof raw !== 'string' || raw.length > MAX_SAVE) return { profile: profile(), game: null, invalid: !!raw };
    try {
      const data = JSON.parse(raw);
      if (!plain(data) || data.version !== VERSION) return { profile: profile(), game: null, invalid: true };
      const game = data.run ? Game.restore(data.run) : null;
      return { profile: profile(data.profile), game, invalid: !!data.run && !game };
    } catch { return { profile: profile(), game: null, invalid: true }; }
  }

  function writeSave(p, game) { return JSON.stringify({ version: VERSION, profile: profile(p), run: game?.snapshot() || null }); }

  return { VERSION, SAVE_KEY, MAX_SAVE, DIRS, BIOMES, MEMORIES, BLESSINGS, UPGRADES, Game, hash, random, generate,
    walkable, distances, lineOfSight, profile, buyUpgrade, readSave, writeSave, distance };
}));
