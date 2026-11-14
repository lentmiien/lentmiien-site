(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LumenwildEngine = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createApi(content, world, helpers) {
    const { BIOMES, MEMORIES, RELICS, TRAILS, ENEMIES, BLESSINGS, UPGRADES, ARTS } = content;
    const { clamp, integer, distance, same, plain, hash, random, shuffle, walkable, distances, lineOfSight, generateLegacy, DIRS } = helpers;
    const VERSION = 2, SAVE_KEY = 'lumenwild.garden.v1', MAX_SAVE = 180000;
    const number = (n, min, max, fallback = min) => Number.isFinite(n) ? clamp(n, min, max) : fallback;
    const ids = (list, max) => Array.isArray(list) ? [...new Set(list.filter(n => Number.isInteger(n) && n >= 0 && n < max))] : [];
    const emptyRecord = () => ({ clears: 0, explored: 0, landmark: false });

    function profile(value) {
      const p = plain(value) ? value : {}, legacy = !plain(p.trails);
      const wins = integer(p.wins, 0, 99999);
      return {
        light: integer(p.light, 0, 999999), medalAwards: integer(p.medalAwards, 0, 27), wins, runs: integer(p.runs, 0, 99999), best: integer(p.best, 0, 999999), dailyBest: integer(p.dailyBest, 0, 999999),
        upgrades: Object.fromEntries(UPGRADES.map(u => [u.id, integer(p.upgrades?.[u.id], 0, u.costs.length)])),
        memories: ids(p.memories, MEMORIES.length), relics: ids(p.relics, RELICS.length),
        trails: Object.fromEntries(TRAILS.map(t => [t.id, legacy && t.id === 'dawn' ? wins : integer(p.trails?.[t.id], 0, 99999)])),
        regions: BIOMES.map((_, i) => ({ clears: legacy && i < 3 ? wins : integer(p.regions?.[i]?.clears, 0, 99999), explored: integer(p.regions?.[i]?.explored, 0, 100), landmark: p.regions?.[i]?.landmark === true })),
        selectedTrail: TRAILS.some(t => t.id === p.selectedTrail) ? p.selectedTrail : legacy && wins ? 'frontier' : 'dawn',
        selectedArt: ARTS.some(a => a.id === p.selectedArt) ? p.selectedArt : 'gust',
        sound: p.sound === true, gentle: p.gentle === true,
      };
    }

    function medal(p, region) {
      const record = p.regions[region], biome = BIOMES[region];
      const pages = biome.memories.filter(id => p.memories.includes(id)).length;
      const relics = p.relics.filter(id => RELICS[id].region === region).length;
      if (record.clears >= 3 && pages === 6 && relics === 3 && record.landmark && record.explored >= 85) return 3;
      if (record.clears >= 2 && pages >= 4 && relics >= 2 && record.explored >= 65) return 2;
      return record.clears > 0 ? 1 : 0;
    }
    const medals = p => BIOMES.reduce((total, _, i) => total + medal(p, i), 0);
    const trailUnlocked = (p, id) => {
      const trail = TRAILS.find(t => t.id === id);
      return !!trail && (!trail.requires || p.trails[trail.requires] > 0);
    };
    const regionUnlocked = (p, region) => Number.isInteger(region) && region >= 0 && region < BIOMES.length && trailUnlocked(p, TRAILS[Math.floor(region / 3)].id);
    function artUnlocked(p, id) {
      if (id === 'gust') return true;
      if (id === 'snare') return p.relics.length >= 3;
      if (id === 'lance') return p.regions[5].clears > 0;
      if (id === 'mend') return p.regions[6].clears > 0;
      if (id === 'nova') return p.regions[7].clears > 0 && p.relics.length >= 9;
      if (id === 'stars') return p.trails.horizon > 0 && p.relics.length >= 18;
      return false;
    }
    function upgradeRequirement(p, id) {
      const level = p.upgrades[id] || 0;
      return level < 3 ? 0 : (level - 2) * 5;
    }
    function buyUpgrade(p, id) {
      const upgrade = UPGRADES.find(u => u.id === id);
      if (!upgrade) return false;
      const cost = upgrade.costs[p.upgrades[id]];
      if (cost === undefined || p.light < cost || medals(p) < upgradeRequirement(p, id)) return false;
      p.light -= cost; p.upgrades[id] += 1; return true;
    }

    function dailyRoute(seed) { return [seed % 3, 3 + (seed >>> 8) % 3, 6 + (seed >>> 16) % 3]; }
    function discoveryPlan(seed, route, knownMemories = [], knownRelics = []) {
      return route.map(region => {
        const rng = random(hash(`${seed}:discoveries:${region}`));
        const preferNew = (all, known) => [...shuffle(all.filter(id => !known.includes(id)), rng), ...shuffle(all.filter(id => known.includes(id)), rng)];
        return { memories: preferNew(BIOMES[region].memories, knownMemories).slice(0, 3), relic: preferNew(RELICS.filter(r => r.region === region).map(r => r.id), knownRelics)[0] };
      });
    }
    function generate(seed, region, options = {}) {
      if (!Number.isInteger(region) || region < 0 || region >= BIOMES.length) throw new RangeError('Unknown garden');
      const plan = options.plan || discoveryPlan(seed, [region])[0];
      return world.generate(seed, region, plan, integer(options.tier, 1, 3, 1), helpers);
    }

    function syncDiscoveries(p, game) {
      p.memories = [...new Set([...p.memories, ...game.memories])];
      p.relics = [...new Set([...p.relics, ...game.relics])];
      game.recordSurvey();
      game.records.forEach((record, i) => {
        p.regions[i].explored = Math.max(p.regions[i].explored, record.explored);
        p.regions[i].landmark ||= record.landmark;
      });
    }
    function bankExpedition(p, game) {
      if (!game || game.settled || !['won', 'lost', 'returned'].includes(game.status)) return false;
      const before = p.medalAwards;
      syncDiscoveries(p, game);
      game.records.forEach((record, i) => { p.regions[i].clears = Math.min(99999, p.regions[i].clears + record.clears); });
      p.light = Math.min(999999, p.light + game.light);
      p.runs = Math.min(99999, p.runs + 1); p.best = Math.max(p.best, game.score);
      if (game.daily) p.dailyBest = Math.max(p.dailyBest, game.score);
      if (game.status === 'won') {
        p.wins = Math.min(99999, p.wins + 1);
        if (!game.daily && TRAILS.some(t => t.id === game.trail)) {
          p.trails[game.trail] = Math.min(99999, p.trails[game.trail] + 1);
          const next = TRAILS.find(t => t.requires === game.trail);
          if (next && p.trails[next.id] === 0 && p.selectedTrail === game.trail) p.selectedTrail = next.id;
        }
      }
      const earned = Math.max(0, medals(p) - before);
      p.light = Math.min(999999, p.light + earned * 25);
      p.medalAwards = Math.max(before, medals(p));
      game.medalReward = earned * 25; game.settled = true;
      return true;
    }
    function createExpedition(p, options) {
      const trail = options.trail || p.selectedTrail;
      if (!options.daily && (trail === 'survey' ? !regionUnlocked(p, options.region) : !trailUnlocked(p, trail))) return null;
      const art = artUnlocked(p, p.selectedArt) ? p.selectedArt : 'gust';
      const tier = !options.daily && options.tier > 1 && p.regions[options.region ?? 0]?.clears > 0 ? integer(options.tier, 1, 3) : 1;
      return new Game({ ...options, trail, tier, art, gentle: p.gentle, upgrades: p.upgrades, knownMemories: p.memories, knownRelics: p.relics });
    }

    class Game {
      constructor(options = {}) {
        this.seed = integer(options.seed, 0, 4294967295, 1);
        this.daily = options.daily === true;
        this.gentle = !this.daily && options.gentle === true;
        this.generator = options.generator === 1 ? 1 : 2;
        this.trail = this.daily ? 'daily' : options.trail === 'survey' ? 'survey' : TRAILS.some(t => t.id === options.trail) ? options.trail : 'dawn';
        this.surveyRegion = integer(options.region ?? options.surveyRegion, 0, 8);
        this.journey = this.generator === 1 ? [0, 1, 2] : this.daily ? dailyRoute(this.seed) : this.trail === 'survey' ? [this.surveyRegion] : TRAILS.find(t => t.id === this.trail).route.slice();
        this.plan = discoveryPlan(this.seed, this.journey, this.daily ? [] : ids(options.knownMemories, 54), this.daily ? [] : ids(options.knownRelics, 27));
        this.tier = this.daily ? 1 : integer(options.tier, 1, 3, 1);
        this.art = this.daily ? 'gust' : ARTS.some(a => a.id === options.art) ? options.art : 'gust';
        this.upgrades = this.daily ? profile().upgrades : profile({ upgrades: options.upgrades }).upgrades;
        this.depth = 0; this.phase = 0; this.turn = 0; this.steps = 0; this.kills = 0; this.light = 0; this.score = 0; this.elapsed = 0;
        this.memories = []; this.relics = []; this.blessings = [];
        this.records = BIOMES.map(emptyRecord);
        this.inventory = { medicine: Math.min(9, 2 + this.upgrades.satchel + (this.gentle ? 2 : 0)), bomb: Math.min(9, 2 + this.upgrades.satchel), thread: 3 };
        this.player = { x: 3, y: 3, facing: 2, hp: this.stats().maxHp };
        this.cooldowns = { attack: 0, dash: 0, shift: 0, guard: 0, art: 0 };
        this.shield = 0; this.guardTime = 0; this.focus = this.stats().maxFocus;
        this.guideTurns = 0; this.status = 'playing'; this.events = []; this.settled = false;
        this.enterGarden();
      }

      get region() { return this.journey[this.depth]; }
      get biome() { return BIOMES[this.region]; }
      get dashCooldown() { return this.cooldowns.dash; }
      get shiftCooldown() { return this.cooldowns.shift; }
      has(id) { return this.blessings.includes(id) ? 1 : 0; }
      stats() {
        return {
          maxHp: 7 + this.upgrades.hearth + this.has('vitality') * 2 + (this.gentle ? 3 : 0),
          damage: 1 + this.has('radiance'), reach: 1 + this.has('reach'), sight: 5 + this.upgrades.lens + this.has('sight') * 2,
          dash: 3 + this.has('drift'), dashWait: this.has('drift') ? 1.9 : 2.8,
          attackWait: this.has('quick') ? .44 : .55, guardDuration: .65 + this.upgrades.ward * .07,
          maxFocus: 3 + this.upgrades.focus + this.has('focus') * 2,
        };
      }
      enterGarden() {
        this.map = this.generator === 1 ? generateLegacy(this.seed, this.region) : generate(this.seed, this.region, { plan: this.plan[this.depth], tier: this.tier });
        this.map.shortcuts ||= []; this.map.vents ||= []; this.map.clearings ||= [];
        if (this.generator === 1) this.map.enemies.forEach(e => Object.assign(e, { hp: ENEMIES[e.kind].hp, windup: 0, windupTotal: 0, moveWait: .4, rest: .5, known: false }));
        this.opened = []; this.seen = new Set(); this.visible = new Set(); this.guideCache = null; this.pathCache = null;
        this.player.x = 3; this.player.y = 3; this.phase = 0; this.seeds = 0;
        Object.keys(this.cooldowns).forEach(key => { this.cooldowns[key] = 0; });
        this.guardTime = 0; this.shield = .8; this.guideTurns = 0;
        this.reveal();
      }
      emit(type, text = '', extra = {}) { if (this.events.length < 100) this.events.push({ type, text, ...extra }); }
      recordSurvey() {
        const floor = this.map.tiles.reduce((sum, tile) => sum + (tile !== 1 ? 1 : 0), 0);
        const seenFloor = [...this.seen].filter(i => this.map.tiles[i] !== 1).length;
        this.records[this.region].explored = Math.max(this.records[this.region].explored, Math.min(100, Math.round(seenFloor / Math.max(1, floor) * 100)));
      }
      reveal() {
        this.visible.clear();
        const { sight } = this.stats(), { x, y } = this.player;
        for (let yy = Math.max(0, y - sight); yy <= Math.min(this.map.h - 1, y + sight); yy += 1) for (let xx = Math.max(0, x - sight); xx <= Math.min(this.map.w - 1, x + sight); xx += 1) {
          if (Math.hypot(xx - x, yy - y) <= sight + .5 && lineOfSight(this.map, this.player, { x: xx, y: yy }, this.phase)) {
            const i = yy * this.map.w + xx; this.seen.add(i); this.visible.add(i);
          }
        }
      }
      entityAt(x, y) { return this.map.entities.find(e => !e.done && e.x === x && e.y === y); }
      enemyAt(x, y) { return this.map.enemies.find(e => e.hp > 0 && e.x === x && e.y === y); }
      nearby() {
        return this.map.entities.filter(e => (!e.done || (e.type === 'landmark' && this.biome.feature === 'ferries')) && ['portal', 'chest', 'well', 'shrine', 'landmark'].includes(e.type) && distance(e, this.player) <= 1)
          .sort((a, b) => distance(a, this.player) - distance(b, this.player))[0];
      }
      collect() {
        const e = this.entityAt(this.player.x, this.player.y);
        if (!e) return;
        if (e.type === 'seed') {
          if (e.phase !== -1 && this.phase !== e.phase) { this.emit('hint', `This heartseed lives in ${e.phase ? 'Echo' : 'Bloom'}. Fold to reach it.`); return; }
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
        } else if (e.type === 'relic') {
          e.done = true; this.light += 8; this.score += 100;
          if (!this.relics.includes(e.relic)) this.relics.push(e.relic);
          this.focus = Math.min(this.stats().maxFocus, this.focus + 2);
          this.emit('relic', RELICS[e.relic].name, { relic: e.relic, x: e.x, y: e.y });
        }
      }
      openShortcuts(source) {
        const choices = this.map.shortcuts.filter(i => !this.opened.includes(i)).sort((a, b) => distance({ x: a % this.map.w, y: Math.floor(a / this.map.w) }, source) - distance({ x: b % this.map.w, y: Math.floor(b / this.map.w) }, source));
        choices.slice(0, 4).forEach(i => { this.map.tiles[i] = 0; this.opened.push(i); });
        this.guideCache = null; this.pathCache = null;
      }
      useLandmark(e) {
        if (e.done && this.biome.feature === 'ferries') {
          const landings = this.map.entities.filter(p => p.type === 'landmark').sort((a, b) => a.number - b.number);
          const target = landings[e.number % landings.length];
          const landing = [target, ...DIRS.map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))]
            .find(p => walkable(this.map, p.x, p.y, this.phase) && !this.enemyAt(p.x, p.y));
          if (!landing) { this.emit('hint', 'The landing is occupied. Try again when the path is clear.'); return false; }
          this.player.x = landing.x; this.player.y = landing.y; this.shield = .5;
          this.emit('ferry', 'The ferry carries your lantern across the marsh.'); return true;
        }
        if (e.phase !== this.phase) { this.emit('hint', `${this.biome.landmark} answers in ${e.phase ? 'Echo' : 'Bloom'}.`); return false; }
        const count = this.map.entities.filter(p => p.type === 'landmark' && p.done).length;
        if (this.biome.feature === 'stars' && e.number !== count + 1) { this.emit('hint', `The constellation begins with anchor ${count + 1}.`); return false; }
        e.done = true; this.light += 4; this.score += 40; this.focus = Math.min(this.stats().maxFocus, this.focus + 1);
        if (['grove', 'gears', 'prisms', 'stars'].includes(this.biome.feature)) this.openShortcuts(e);
        if (this.biome.feature === 'mirrors') {
          const target = this.map.entities.find(p => p.type === 'seed' && !p.done);
          if (target) for (let y = target.y - 2; y <= target.y + 2; y += 1) for (let x = target.x - 2; x <= target.x + 2; x += 1) {
            if (x >= 0 && y >= 0 && x < this.map.w && y < this.map.h) this.seen.add(y * this.map.w + x);
          }
        }
        this.emit('landmark', `${this.biome.landmark} restored · ${count + 1} / 3`, { x: e.x, y: e.y });
        if (count === 2) {
          this.records[this.region].landmark = true; this.light += 12; this.score += 120;
          this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 3);
          this.emit('secret', 'Regional secret restored · +12 starlight and three hearts');
        }
        return true;
      }
      interact() {
        const e = this.nearby();
        if (!e) { this.emit('hint', 'Stand beside a cache, spring, shrine, landmark, or waygate.'); return false; }
        if (e.type === 'portal') {
          if (this.seeds < 3) { this.emit('hint', `The waygate needs ${3 - this.seeds} more heartseeds.`); return false; }
          this.recordSurvey(); this.records[this.region].clears = 1;
          this.score += 200 * this.tier + this.records[this.region].explored; this.light += 10 * this.tier;
          this.status = this.depth === this.journey.length - 1 ? 'won' : 'blessing';
          this.emit('restored', this.biome.name); return true;
        }
        if (e.type === 'shrine') { this.emit('puzzle', '', { id: e.id }); return false; }
        if (e.type === 'landmark') return this.useLandmark(e);
        e.done = true;
        if (e.type === 'chest') {
          this.light += 5; this.score += 40;
          const supply = ['medicine', 'bomb', 'thread'][e.prize % 3];
          this.inventory[supply] = Math.min(9, this.inventory[supply] + 1);
          this.emit('chest', `Cache opened · +5 starlight and a ${supply}`, { x: e.x, y: e.y });
        } else {
          this.player.hp = this.stats().maxHp; this.focus = this.stats().maxFocus;
          this.emit('heal', 'Moonwell spring · hearts and focus restored');
        }
        return true;
      }
      solveRune(symbol) {
        this.events = [];
        const shrine = this.nearby();
        if (this.status !== 'playing' || !shrine || shrine.type !== 'shrine' || ![0, 1, 2].includes(symbol)) return false;
        if (shrine.sequence[shrine.progress] !== symbol) { shrine.progress = 0; this.emit('hint', 'The song fades. Follow the three symbols from left to right.'); return false; }
        shrine.progress += 1;
        if (shrine.progress === 3) {
          shrine.done = true; this.light += 8; this.score += 80;
          this.inventory.bomb = Math.min(9, this.inventory.bomb + 1);
          this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 2);
          this.focus = this.stats().maxFocus;
          this.emit('puzzleSolved', 'The garden remembers its song · +8 starlight, a seedbomb, two hearts, and full focus');
        } else this.emit('rune', `${shrine.progress} / 3 notes awakened`);
        return true;
      }
      choices() { return shuffle(BLESSINGS.filter(b => !this.blessings.includes(b.id)), random(hash(`${this.seed}:blessing:${this.depth}`))).slice(0, 3); }
      chooseBlessing(id) {
        if (this.status !== 'blessing' || !this.choices().some(b => b.id === id)) return false;
        this.blessings.push(id);
        if (id === 'satchel') for (const key of Object.keys(this.inventory)) this.inventory[key] = Math.min(9, this.inventory[key] + 2);
        this.player.hp = this.stats().maxHp; this.focus = this.stats().maxFocus;
        this.inventory.medicine = Math.min(9, this.inventory.medicine + 1); this.inventory.thread = Math.min(9, this.inventory.thread + 1);
        this.depth += 1; this.status = 'playing'; this.enterGarden();
        this.events = []; this.emit('garden', this.biome.name); return true;
      }

      hit(enemy, damage, stun = 0) {
        if (enemy.hp <= 0) return;
        enemy.hp = Math.max(0, enemy.hp - damage);
        // Ordinary sweeps deliberately do NOT cancel a committed attack.
        // Guard, folding, bombs and arts are the player's interruption tools.
        if (stun || !enemy.hp) { enemy.intent = []; enemy.windup = 0; enemy.stun = Math.max(enemy.stun, stun); }
        this.emit('hit', '', { x: enemy.x, y: enemy.y, damage });
        if (!enemy.hp) {
          this.kills += 1; this.light += 2 + this.tier - 1; this.score += 30 * this.tier;
          this.focus = Math.min(this.stats().maxFocus, this.focus + 1);
          if (this.has('harvest')) this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 1);
          this.emit('freed', `${ENEMIES[enemy.kind].name} freed · +2 starlight`, { x: enemy.x, y: enemy.y, kind: enemy.kind });
        }
      }
      hurt(amount, enemy) {
        if (this.guardTime > 0) {
          this.guardTime = 0; this.shield = Math.max(this.shield, .8);
          if (enemy) this.hit(enemy, 1 + this.has('counter') * 2, 1.2);
          this.focus = Math.min(this.stats().maxFocus, this.focus + 1);
          this.emit('parry', 'Perfect reflection · attack blocked, focus restored'); return;
        }
        if (this.shield > 0) return;
        this.player.hp = Math.max(0, this.player.hp - (this.gentle ? 1 : amount));
        this.shield = .85;
        this.emit('hurt', 'Dodge the warning, guard with G, or interrupt with a lantern art.');
        if (enemy && this.has('thorns')) this.hit(enemy, 2);
        if (this.player.hp === 0) { this.status = 'lost'; this.recordSurvey(); this.emit('lost', 'Your lantern brings you safely home.'); }
      }
      castArt() {
        const art = ARTS.find(a => a.id === this.art);
        if (this.cooldowns.art > 0 || this.focus < art.cost) { this.emit('hint', `${art.name} needs ${art.cost} focus. Focus returns over time, from freed creatures, and from guarding.`); return false; }
        const p = this.player, [dx, dy] = DIRS[p.facing];
        const foes = this.map.enemies.filter(e => e.hp > 0 && lineOfSight(this.map, p, e, this.phase));
        if (this.art === 'mend') {
          p.hp = Math.min(this.stats().maxHp, p.hp + 4); this.shield = Math.max(this.shield, 1.5);
        } else for (const e of foes) {
          if (this.art === 'lance') {
            if ((dx && e.y === p.y && (e.x - p.x) * dx > 0 || dy && e.x === p.x && (e.y - p.y) * dy > 0) && distance(e, p) <= 5) this.hit(e, 5);
          } else if (this.art === 'stars' ? this.visible.has(e.y * this.map.w + e.x) : distance(e, p) <= (this.art === 'nova' ? 4 : 3)) {
            this.hit(e, this.art === 'gust' ? 1 : this.art === 'snare' ? 2 : 4, this.art === 'snare' ? 3 : 1.5);
          }
        }
        if (this.art === 'stars') this.shield = Math.max(this.shield, 1.5);
        if (this.has('roots')) p.hp = Math.min(this.stats().maxHp, p.hp + 1);
        this.focus -= art.cost; this.cooldowns.art = 1.5;
        this.emit('art', art.name); return true;
      }
      act(action, direction) {
        this.events = [];
        if (this.status !== 'playing') return false;
        const p = this.player;
        let acted = false;
        if (action === 'move' && Number.isInteger(direction) && direction >= 0 && direction < 4) {
          p.facing = direction;
          const [dx, dy] = DIRS[direction], x = p.x + dx, y = p.y + dy;
          if (!walkable(this.map, x, y, this.phase)) { this.emit('blocked', this.map.tiles[y * this.map.w + x] >= 2 ? 'A folded path. Q switches Bloom and Echo.' : 'Try another path.'); return false; }
          if (this.enemyAt(x, y)) return this.act('attack');
          p.x = x; p.y = y; this.steps += 1; this.collect(); this.emit('move'); acted = true;
        } else if (action === 'attack') {
          if (this.cooldowns.attack > 0) return false;
          const { reach, damage, attackWait } = this.stats();
          this.map.enemies.filter(e => e.hp > 0 && Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= reach && lineOfSight(this.map, p, e, this.phase)).forEach(e => this.hit(e, damage));
          this.cooldowns.attack = attackWait; this.emit('sweep'); acted = true;
        } else if (action === 'guard') {
          if (this.cooldowns.guard > 0) return false;
          this.guardTime = this.stats().guardDuration; this.cooldowns.guard = 3.2;
          this.emit('guard', 'Mirror guard · catch the attack as its ring closes'); acted = true;
        } else if (action === 'art') acted = this.castArt();
        else if (action === 'shift') {
          if (this.shiftCooldown > 0) { this.emit('hint', `The fold settles in ${this.shiftCooldown.toFixed(1)} seconds.`); return false; }
          if (!walkable(this.map, p.x, p.y, 1 - this.phase)) { this.emit('hint', 'Step off the folded path before shifting.'); return false; }
          this.phase = 1 - this.phase; this.cooldowns.shift = 4.2;
          this.shield = Math.max(this.shield, this.has('echo') ? 1 : .35);
          this.map.enemies.forEach(e => { e.intent = []; e.windup = 0; if (distance(e, p) <= 5) e.stun = Math.max(e.stun, .9); });
          this.collect(); this.emit('shift', `${this.phase ? 'Echo' : 'Bloom'} awakened · nearby creatures are dazed`); acted = true;
        } else if (action === 'dash') {
          if (this.dashCooldown > 0) return false;
          const [dx, dy] = DIRS[p.facing];
          for (let i = 0; i < this.stats().dash; i += 1) {
            if (!walkable(this.map, p.x + dx, p.y + dy, this.phase) || this.enemyAt(p.x + dx, p.y + dy)) break;
            p.x += dx; p.y += dy; this.steps += 1; this.collect(); acted = true;
          }
          if (!acted) { this.emit('hint', 'Face an open path to dash.'); return false; }
          this.cooldowns.dash = this.stats().dashWait; this.shield = Math.max(this.shield, .3); this.emit('dash');
        } else if (action === 'medicine') {
          if (!this.inventory.medicine || p.hp >= this.stats().maxHp) { this.emit('hint', this.inventory.medicine ? 'Your hearts are already full.' : 'No tonic left. Look for a spring or a cache.'); return false; }
          this.inventory.medicine -= 1; p.hp = Math.min(this.stats().maxHp, p.hp + 5);
          if (this.has('alchemist')) this.focus = this.stats().maxFocus;
          this.shield = Math.max(this.shield, .4); this.emit('heal', 'Moonberry tonic · five hearts restored'); acted = true;
        } else if (action === 'bomb') {
          if (!this.inventory.bomb) { this.emit('hint', 'No seedbombs left. Search a treasure cache.'); return false; }
          this.inventory.bomb -= 1;
          this.map.enemies.filter(e => e.hp > 0 && distance(e, p) <= 4 && lineOfSight(this.map, p, e, this.phase)).forEach(e => this.hit(e, 4 + this.has('alchemist') * 2, 1.5));
          this.emit('bomb', 'Seedburst!'); acted = true;
        } else if (action === 'thread') {
          if (!this.inventory.thread) { this.emit('hint', 'No threads left. Your atlas remembers every path you have seen.'); return false; }
          this.inventory.thread -= 1; this.guideTurns = this.has('sight') ? 81 : 41;
          this.emit('guide', 'Follow the golden thread. A ring on the trail means shift there.'); acted = true;
        } else if (action === 'interact') acted = this.interact();
        else if (action === 'wait') acted = true;
        else if (action === 'return') { this.recordSurvey(); this.status = 'returned'; this.emit('returned', 'Every discovery comes home with you.'); acted = true; }
        if (!acted) return false;
        this.turn += 1; this.guideTurns = Math.max(0, this.guideTurns - 1); this.reveal(); return true;
      }
      attackPattern(enemy) {
        const species = ENEMIES[enemy.kind], p = this.player, cells = [];
        const add = (x, y) => { if (walkable(this.map, x, y, this.phase) && lineOfSight(this.map, enemy, { x, y }, this.phase)) cells.push({ x, y }); };
        if (species.pattern === 'target' || species.pattern === 'burst') {
          add(p.x, p.y);
          if (species.pattern === 'burst') DIRS.forEach(([dx, dy]) => add(p.x + dx, p.y + dy));
        } else if (species.pattern === 'ring') {
          for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) if (dx || dy) add(enemy.x + dx, enemy.y + dy);
        } else if (species.pattern === 'cross') {
          for (const [dx, dy] of DIRS) for (let i = 1; i <= species.range; i += 1) add(enemy.x + dx * i, enemy.y + dy * i);
        } else {
          const horizontal = Math.abs(p.x - enemy.x) >= Math.abs(p.y - enemy.y);
          const dx = horizontal ? Math.sign(p.x - enemy.x) || 1 : 0, dy = horizontal ? 0 : Math.sign(p.y - enemy.y) || 1;
          for (let i = 1; i <= species.range; i += 1) {
            add(enemy.x + dx * i, enemy.y + dy * i);
            if (species.pattern === 'fan' && i > 1) for (const side of [-1, 1]) add(enemy.x + dx * i + dy * side, enemy.y + dy * i + dx * side);
          }
        }
        return cells;
      }
      update(seconds) {
        if (this.status !== 'playing' || !Number.isFinite(seconds) || seconds <= 0) return;
        // No wall-clock catch-up: background tabs and paused dialogs cannot
        // accumulate attacks. The UI advances this clock only during play.
        const dt = Math.min(.1, seconds);
        this.elapsed += dt;
        for (const key of Object.keys(this.cooldowns)) this.cooldowns[key] = Math.max(0, this.cooldowns[key] - dt);
        this.shield = Math.max(0, this.shield - dt); this.guardTime = Math.max(0, this.guardTime - dt);
        this.focus = Math.min(this.stats().maxFocus, this.focus + dt / (this.has('focus') ? 5 : 8));
        const key = `${this.phase}:${this.player.x}:${this.player.y}:${this.opened.length}`;
        if (this.pathCache?.key !== key) this.pathCache = { key, field: distances(this.map, this.player, this.phase) };
        const field = this.pathCache.field;
        for (const e of this.map.enemies) {
          if (e.hp <= 0 || this.status !== 'playing') continue;
          if (this.visible.has(e.y * this.map.w + e.x)) e.known = true;
          if (!walkable(this.map, e.x, e.y, this.phase)) { e.intent = []; e.windup = 0; continue; }
          if (e.stun > 0) { e.stun = Math.max(0, e.stun - dt); continue; }
          const species = ENEMIES[e.kind];
          if (e.windup > 0) {
            e.windup = Math.max(0, e.windup - dt);
            if (!e.windup) {
              const lands = e.intent.some(cell => same(cell, this.player));
              e.intent = []; e.rest = species.rest; e.moveWait = species.move;
              if (lands) this.hurt(species.damage + (this.tier === 3 ? 1 : 0), e);
              this.emit('enemyAttack', '', { x: e.x, y: e.y });
            }
            continue;
          }
          const d = field[e.y * this.map.w + e.x];
          if (d < 0 || d > 8 || !lineOfSight(this.map, e, this.player, this.phase)) continue;
          if (!e.awake) { e.awake = true; e.rest = 0; }
          e.rest = Math.max(0, e.rest - dt); e.moveWait = Math.max(0, e.moveWait - dt);
          if (e.rest > 0) continue;
          const pattern = this.attackPattern(e);
          if (distance(e, this.player) <= species.range + (species.pattern === 'ring' ? 1 : 0) && pattern.some(cell => same(cell, this.player))) {
            e.intent = pattern; e.windupTotal = species.windup * (this.gentle ? 1.5 : 1) * (this.has('patience') ? 1.2 : 1) / (1 + (this.tier - 1) * .08); e.windup = e.windupTotal;
            this.emit('warning', `${species.name} · move, guard, or use an art`);
          } else if (!e.moveWait) {
            const next = DIRS.map(([dx, dy]) => ({ x: e.x + dx, y: e.y + dy }))
              .filter(cell => walkable(this.map, cell.x, cell.y, this.phase) && !same(cell, this.player) && !this.enemyAt(cell.x, cell.y) && field[cell.y * this.map.w + cell.x] >= 0 && field[cell.y * this.map.w + cell.x] < d)
              .sort((a, b) => field[a.y * this.map.w + a.x] - field[b.y * this.map.w + b.x])[0];
            if (next) { e.x = next.x; e.y = next.y; }
            e.moveWait = species.move;
          }
        }
        if (this.biome.feature === 'vents' && !this.records[this.region].landmark) for (const vent of this.map.vents) {
          vent.timer -= dt; vent.warning = vent.timer <= 1;
          if (vent.timer <= 0) {
            if (!this.phase && same(vent, this.player)) this.hurt(1);
            vent.timer = 4; vent.warning = false;
          }
        }
      }

      // Search position AND realm. A repeated position with a new phase is an
      // explicit instruction to fold, never a route through a closed wall.
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
        result.push({ ...this.player, phase: this.phase }); return result.reverse();
      }
      guide() {
        const key = `${this.depth}:${this.turn}:${this.phase}:${this.player.x}:${this.player.y}:${this.seeds}:${this.opened.length}`;
        if (this.guideCache?.key === key) return this.guideCache.route;
        const targets = this.map.entities.filter(e => e.type === (this.seeds === 3 ? 'portal' : 'seed') && !e.done);
        const route = targets.map(target => this.route(target)).filter(path => path.length).sort((a, b) => a.length - b.length)[0] || [];
        this.guideCache = { key, route }; return route;
      }
      snapshot() {
        return {
          generator: this.generator, seed: this.seed, daily: this.daily, gentle: this.gentle, upgrades: this.upgrades,
          trail: this.trail, surveyRegion: this.surveyRegion, plan: this.plan, tier: this.tier, art: this.art, depth: this.depth,
          phase: this.phase, turn: this.turn, steps: this.steps, kills: this.kills, light: this.light, score: this.score, elapsed: this.elapsed,
          memories: this.memories, relics: this.relics, blessings: this.blessings, records: this.records, inventory: this.inventory, player: this.player,
          cooldowns: this.cooldowns, focus: this.focus, shield: this.shield, guardTime: this.guardTime, guideTurns: this.guideTurns,
          status: this.status, seen: [...this.seen], opened: this.opened,
          entities: this.map.entities.map(e => ({ id: e.id, done: e.done, progress: e.progress || 0 })),
          enemies: this.map.enemies.map(e => ({ id: e.id, x: e.x, y: e.y, hp: e.hp, intent: e.intent, stun: e.stun, awake: e.awake,
            windup: e.windup, windupTotal: e.windupTotal, moveWait: e.moveWait, rest: e.rest, known: e.known })),
          vents: this.map.vents.map(v => ({ timer: v.timer, warning: v.warning })),
        };
      }
      static restore(s) {
        if (!plain(s) || !plain(s.player) || !plain(s.inventory) || !Number.isSafeInteger(s.seed) || s.seed < 0 || s.seed > 4294967295 ||
          !Number.isInteger(s.depth) || s.depth < 0 || s.depth > 8 || ![0, 1].includes(s.phase) || !['playing', 'blessing'].includes(s.status) ||
          !Array.isArray(s.blessings) || s.blessings.length !== s.depth || new Set(s.blessings).size !== s.blessings.length || s.blessings.some(id => !BLESSINGS.some(b => b.id === id)) ||
          !Array.isArray(s.entities) || s.entities.length > 100 || !Array.isArray(s.enemies) || s.enemies.length > 16 || !Array.isArray(s.seen) || s.seen.length > 1600) return null;
        const legacy = s.generator === undefined;
        if (!legacy && (![1, 2].includes(s.generator) || !['daily', 'survey', ...TRAILS.map(t => t.id)].includes(s.trail))) return null;
        const game = new Game({ ...s, generator: legacy ? 1 : s.generator, trail: legacy ? 'dawn' : s.trail });
        if (s.depth >= game.journey.length) return null;
        if (!legacy) {
          if (!Array.isArray(s.plan) || s.plan.length !== game.journey.length) return null;
          for (let i = 0; i < s.plan.length; i += 1) {
            const p = s.plan[i], region = game.journey[i];
            if (!plain(p) || !Array.isArray(p.memories) || p.memories.length !== 3 || new Set(p.memories).size !== 3 || p.memories.some(id => !BIOMES[region].memories.includes(id)) || !RELICS.some(r => r.id === p.relic && r.region === region)) return null;
          }
          game.plan = s.plan.map(p => ({ memories: p.memories.slice(), relic: p.relic }));
        }
        game.depth = s.depth; game.blessings = s.blessings.slice(); game.enterGarden(); game.phase = s.phase;
        if (!legacy) {
          if (!Array.isArray(s.opened) || s.opened.length > 50 || new Set(s.opened).size !== s.opened.length || s.opened.some(i => !game.map.shortcuts.includes(i))) return null;
          game.opened = s.opened.slice(); game.opened.forEach(i => { game.map.tiles[i] = 0; });
        }
        if (!walkable(game.map, s.player.x, s.player.y, s.phase) || !Number.isInteger(s.player.hp) || s.player.hp < 1) return null;
        game.player = { x: s.player.x, y: s.player.y, hp: integer(s.player.hp, 1, game.stats().maxHp), facing: integer(s.player.facing, 0, 3, 2) };
        for (const key of ['turn', 'steps', 'kills', 'light', 'score']) game[key] = integer(s[key], 0, 999999);
        game.elapsed = number(s.elapsed, 0, 9999999);
        for (const key of ['medicine', 'bomb', 'thread']) game.inventory[key] = integer(s.inventory[key], 0, 9);
        game.memories = ids(s.memories, MEMORIES.length); game.relics = ids(s.relics, RELICS.length);
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
            !Array.isArray(saved.intent) || saved.intent.length > 16 || saved.intent.some(cell => !plain(cell) || !walkable(game.map, cell.x, cell.y, game.phase))) return null;
          const hp = integer(saved.hp, 0, e.hp);
          if (hp > 0) {
            if (occupied.has(`${saved.x},${saved.y}`) || same(saved, game.player)) return null;
            occupied.add(`${saved.x},${saved.y}`);
          }
          Object.assign(e, { x: saved.x, y: saved.y, hp, intent: saved.intent.map(cell => ({ x: cell.x, y: cell.y })),
            stun: number(saved.stun, 0, 3), awake: saved.awake === true, known: saved.known === true,
            windup: legacy && saved.intent.length ? 1.2 : number(saved.windup, 0, 3), windupTotal: legacy && saved.intent.length ? 1.2 : number(saved.windupTotal, 0, 3),
            moveWait: number(saved.moveWait, 0, 5), rest: number(saved.rest, 0, 5) });
          if (!e.windup) e.intent = [];
        }
        game.seeds = game.map.entities.filter(e => e.type === 'seed' && e.done).length;
        if (s.status === 'blessing' && (game.depth === game.journey.length - 1 || game.seeds !== 3)) return null;
        game.status = s.status;
        for (const key of Object.keys(game.cooldowns)) game.cooldowns[key] = number(s.cooldowns?.[key], 0, 5);
        if (legacy) { game.cooldowns.dash = number(s.dashCooldown, 0, 3); game.cooldowns.shift = number(s.shiftCooldown, 0, 3); }
        game.shield = number(s.shield, 0, 2); game.guardTime = number(s.guardTime, 0, 1.1);
        game.focus = number(s.focus, 0, game.stats().maxFocus, game.stats().maxFocus);
        game.guideTurns = integer(s.guideTurns, 0, 80);
        game.records = BIOMES.map((_, i) => legacy ? { clears: i < game.depth || i === game.depth && s.status === 'blessing' ? 1 : 0, explored: 0, landmark: false } :
          { clears: integer(s.records?.[i]?.clears, 0, 1), explored: integer(s.records?.[i]?.explored, 0, 100), landmark: s.records?.[i]?.landmark === true });
        if (!legacy) {
          if (!Array.isArray(s.vents) || s.vents.length !== game.map.vents.length) return null;
          game.map.vents.forEach((v, i) => { v.timer = number(s.vents[i]?.timer, 0, 7); v.warning = s.vents[i]?.warning === true; });
        }
        game.seen = new Set(s.seen.filter(i => Number.isInteger(i) && i >= 0 && i < game.map.w * game.map.h));
        game.reveal(); return game;
      }
    }

    function readSave(raw) {
      if (typeof raw !== 'string' || raw.length > MAX_SAVE) return { profile: profile(), game: null, invalid: !!raw };
      try {
        const data = JSON.parse(raw);
        if (!plain(data) || ![1, VERSION].includes(data.version)) return { profile: profile(), game: null, invalid: true };
        const game = data.run ? Game.restore(data.run) : null;
        return { profile: profile(data.profile), game, invalid: !!data.run && !game, migrated: data.version === 1 };
      } catch { return { profile: profile(), game: null, invalid: true }; }
    }
    function writeSave(p, game) {
      return JSON.stringify({ version: VERSION, profile: profile(p), run: game && ['playing', 'blessing'].includes(game.status) ? game.snapshot() : null });
    }
    return { ...content, ...helpers, VERSION, SAVE_KEY, MAX_SAVE, Game, generate, profile, buyUpgrade, upgradeRequirement, medal, medals, trailUnlocked, regionUnlocked, artUnlocked, createExpedition, bankExpedition, syncDiscoveries, discoveryPlan, readSave, writeSave };
  }
  return { createApi };
}));
