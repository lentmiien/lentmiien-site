(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LumenwildEngine = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function createApi(content, world, helpers, guardians) {
    const { SECRET_BIOME, BIOMES, MEMORIES, RELICS, TRAILS, ENEMIES, BLESSINGS, UPGRADES, ARTS, GUARDIANS, CHARMS } = content;
    const { clamp, integer, distance, same, plain, hash, random, shuffle, walkable, distances, lineOfSight, generateLegacy, DIRS } = helpers;
    const VERSION = 5, SAVE_KEY = 'lumenwild.garden.v1', MAX_SAVE = 180000;
    const number = (n, min, max, fallback = min) => Number.isFinite(n) ? clamp(n, min, max) : fallback;
    const ids = (list, max) => Array.isArray(list) ? [...new Set(list.filter(n => Number.isInteger(n) && n >= 0 && n < max))] : [];
    const emptyRecord = () => ({ clears: 0, explored: 0, landmark: false });

    function profile(value) {
      const p = plain(value) ? value : {}, legacy = !plain(p.trails);
      const wins = integer(p.wins, 0, 99999);
      return {
        light: integer(p.light, 0, 999999), medalAwards: integer(p.medalAwards, 0, BIOMES.length * 3), wins, runs: integer(p.runs, 0, 99999), best: integer(p.best, 0, 999999), dailyBest: integer(p.dailyBest, 0, 999999),
        upgrades: Object.fromEntries(UPGRADES.map(u => [u.id, integer(p.upgrades?.[u.id], 0, u.costs.length)])),
        memories: ids(p.memories, MEMORIES.length), relics: ids(p.relics, RELICS.length), vaults: ids(p.vaults, BIOMES.length).filter(i => i >= 15),
        trails: Object.fromEntries(TRAILS.map(t => [t.id, legacy && t.id === 'dawn' ? wins : integer(p.trails?.[t.id], 0, 99999)])),
        regions: BIOMES.map((_, i) => ({ clears: legacy && i < 3 ? wins : integer(p.regions?.[i]?.clears, 0, 99999), explored: integer(p.regions?.[i]?.explored, 0, 100), landmark: p.regions?.[i]?.landmark === true })),
        selectedTrail: TRAILS.some(t => t.id === p.selectedTrail) ? p.selectedTrail : legacy && wins ? 'frontier' : 'dawn',
        selectedArt: ARTS.some(a => a.id === p.selectedArt) ? p.selectedArt : 'gust',
        selectedCharm: CHARMS.some(c => c.id === p.selectedCharm) ? p.selectedCharm : 'none',
        guardians: Object.fromEntries(GUARDIANS.map(b => [b.id, integer(p.guardians?.[b.id], 0, b.hidden ? 1 : 3)])),
        guardianAwards: integer(p.guardianAwards, 0, GUARDIANS.filter(b => !b.hidden).length * 3), rescues: integer(p.rescues, 0, 99999),
        mastery: { clears: integer(p.mastery?.clears, 0, 99999), bestTime: number(p.mastery?.bestTime, 0, 999999), bestHits: integer(p.mastery?.bestHits, 0, 999999) },
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
    const regionUnlocked = (p, region) => Number.isInteger(region) && region >= 0 && region < BIOMES.length &&
      TRAILS.some(t => (t.chapter || t.route.length === 3) && t.route.includes(region) && trailUnlocked(p, t.id));
    const guardianMedals = p => GUARDIANS.filter(b => !b.hidden).reduce((sum, b) => sum + p.guardians[b.id], 0);
    function charmUnlocked(p, id) {
      if (id === 'none') return true;
      if (id === 'firefly') return p.rescues >= 3;
      const earned = { bell: p.guardians.bellkeeper, feather: p.guardians.tempest, crown: p.guardians.dawnhart, amber: p.guardians.honeyregent, chime: p.guardians.resonantwarden, twilight: p.guardians.nightgardener, keeper: p.guardians.firstkeeper };
      return Object.hasOwn(earned, id) && earned[id] > 0;
    }
    function artUnlocked(p, id) {
      if (id === 'firstlight') return p.guardians.firstkeeper > 0;
      if (id === 'gust') return true;
      if (id === 'snare') return p.relics.length >= 3;
      if (id === 'lance') return p.regions[5].clears > 0;
      if (id === 'mend') return p.regions[6].clears > 0;
      if (id === 'nova') return p.regions[7].clears > 0 && p.relics.length >= 9;
      if (id === 'stars') return p.trails.horizon > 0 && p.relics.length >= 18;
      if (id === 'tide') return p.guardians.bellkeeper > 0;
      if (id === 'tempest') return p.guardians.tempest > 0;
      if (id === 'dawn') return p.guardians.dawnhart > 0;
      if (id === 'nectar') return p.guardians.honeyregent > 0;
      if (id === 'resonance') return p.guardians.resonantwarden > 0;
      if (id === 'afterglow') return p.guardians.nightgardener > 0;
      return false;
    }
    function collectionProgress(p) {
      const groups = [
        { id: 'memories', name: 'Memories', found: MEMORIES.filter((_, i) => p.memories.includes(i)).length, total: MEMORIES.length },
        { id: 'relics', name: 'Relics', found: RELICS.filter(r => p.relics.includes(r.id)).length, total: RELICS.length },
        { id: 'arts', name: 'Lantern arts', found: ARTS.filter(a => artUnlocked(p, a.id)).length, total: ARTS.length },
        { id: 'charms', name: 'Keepsakes', found: CHARMS.filter(c => c.id !== 'none' && charmUnlocked(p, c.id)).length, total: CHARMS.length - 1 },
      ];
      return { groups, complete: groups.every(g => g.found === g.total) };
    }
    const secretUnlocked = p => collectionProgress(p).complete;

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

    function dailyRoute(seed, generator) {
      if (generator >= 5) return [seed % 8, 8 + (seed >>> 8) % 8, 16 + (seed >>> 16) % 7];
      const size = generator < 3 ? 3 : generator === 3 ? 5 : 7;
      return [seed % size, size + (seed >>> 8) % size, size * 2 + (seed >>> 16) % size];
    }
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
      return world.generate(seed, region, plan, integer(options.tier, 1, 3, 1), helpers, options.generator === 2 ? 2 : options.generator === 3 ? 3 : options.generator === 4 ? 4 : 5);
    }

    function syncDiscoveries(p, game) {
      p.memories = [...new Set([...p.memories, ...game.memories])];
      p.relics = [...new Set([...p.relics, ...game.relics])];
      p.vaults = [...new Set([...p.vaults, ...game.vaults])];
      GUARDIANS.forEach(b => { p.guardians[b.id] = Math.max(p.guardians[b.id], game.guardianWins[b.id]); });
      p.rescues = Math.min(99999, p.rescues + Math.max(0, game.rescues - game.recordedRescues));
      game.recordedRescues = game.rescues;
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
        if (game.trail === 'secret' && game.boss?.state === 'defeated') {
          const first = p.mastery.clears === 0;
          p.mastery.bestTime = first ? game.boss.elapsed : Math.min(p.mastery.bestTime, game.boss.elapsed);
          p.mastery.bestHits = first ? game.boss.hitsTaken : Math.min(p.mastery.bestHits, game.boss.hitsTaken);
          p.mastery.clears = Math.min(99999, p.mastery.clears + 1);
        }
        if (!game.daily && TRAILS.some(t => t.id === game.trail)) {
          p.trails[game.trail] = Math.min(99999, p.trails[game.trail] + 1);
          const next = TRAILS.find(t => t.requires === game.trail && t.chapter) || TRAILS.find(t => t.requires === game.trail);
          if (next && p.trails[next.id] === 0 && p.selectedTrail === game.trail) p.selectedTrail = next.id;
        }
      }
      const earned = Math.max(0, medals(p) - before);
      p.light = Math.min(999999, p.light + earned * 25);
      p.medalAwards = Math.max(before, medals(p));
      game.guardianReward = Math.max(0, guardianMedals(p) - p.guardianAwards) * 40;
      p.light = Math.min(999999, p.light + game.guardianReward); p.guardianAwards = Math.max(p.guardianAwards, guardianMedals(p));
      game.medalReward = earned * 25; game.settled = true;
      return true;
    }
    function createExpedition(p, options) {
      const trail = options.trail || p.selectedTrail;
      const trial = trail === 'trial' && GUARDIANS.find(b => !b.hidden && b.region === options.region);
      if (trail === 'secret') {
        if (options.daily || !secretUnlocked(p)) return null;
        options = { ...options, region: 22, tier: 1, generator: 5 };
      }
      if (!options.daily && (trail === 'secret' ? !secretUnlocked(p) : trail === 'trial' ? !trial || !p.guardians[trial.id] : trail === 'survey' ? !regionUnlocked(p, options.region) : !trailUnlocked(p, trail))) return null;
      const tier = trial ? integer(options.tier, 1, Math.min(3, p.guardians[trial.id] + 1), 1) : !options.daily && options.tier > 1 && p.regions[options.region ?? 0]?.clears > 0 ? integer(options.tier, 1, 3) : 1;
      const charm = charmUnlocked(p, p.selectedCharm) ? p.selectedCharm : 'none';
      const capacity = 3 + p.upgrades.focus + (charm === 'firefly' ? 1 : 0);
      const selected = ARTS.find(a => a.id === p.selectedArt);
      const art = selected && artUnlocked(p, selected.id) && selected.cost <= capacity ? selected.id : 'gust';
      return new Game({ ...options, trail, tier, art, charm, gentle: p.gentle, upgrades: p.upgrades, knownMemories: p.memories, knownRelics: p.relics });
    }

    class Game {
      constructor(options = {}) {
        this.seed = integer(options.seed, 0, 4294967295, 1);
        this.daily = options.daily === true;
        this.gentle = !this.daily && options.trail !== 'secret' && options.gentle === true;
        this.generator = [1, 2, 3, 4].includes(options.generator) ? options.generator : 5;
        this.surveyRegion = !this.daily && options.trail === 'secret' ? 22 : integer(options.region ?? options.surveyRegion, 0, BIOMES.length - 1);
        this.trail = this.daily ? 'daily' : options.trail === 'secret' ? 'secret' : options.trail === 'trial' && BIOMES[this.surveyRegion].guardian ? 'trial' : options.trail === 'survey' ? 'survey' : TRAILS.some(t => t.id === options.trail) ? options.trail : 'dawn';
        this.journey = this.generator === 1 ? [0, 1, 2] : this.daily ? dailyRoute(this.seed, this.generator) : ['survey', 'trial', 'secret'].includes(this.trail) ? [this.surveyRegion] : TRAILS.find(t => t.id === this.trail).route.slice();
        this.plan = discoveryPlan(this.seed, this.journey, this.daily ? [] : ids(options.knownMemories, MEMORIES.length), this.daily ? [] : ids(options.knownRelics, RELICS.length));
        this.tier = this.daily || this.trail === 'secret' ? 1 : integer(options.tier, 1, 3, 1);
        this.art = this.daily ? 'gust' : ARTS.some(a => a.id === options.art) ? options.art : 'gust';
        this.charm = !this.daily && CHARMS.some(c => c.id === options.charm) ? options.charm : 'none';
        this.upgrades = this.daily ? profile().upgrades : profile({ upgrades: options.upgrades }).upgrades;
        this.depth = 0; this.phase = 0; this.turn = 0; this.steps = 0; this.kills = 0; this.light = 0; this.score = 0; this.elapsed = 0;
        this.memories = []; this.relics = []; this.blessings = []; this.vaults = [];
        this.guardianWins = Object.fromEntries(GUARDIANS.map(b => [b.id, 0])); this.rescues = 0; this.recordedRescues = 0;
        this.records = BIOMES.map(emptyRecord);
        this.inventory = { medicine: Math.min(9, 2 + this.upgrades.satchel + (this.gentle ? 2 : 0)), bomb: Math.min(9, 2 + this.upgrades.satchel), thread: 3 };
        this.player = { x: 3, y: 3, facing: 2, hp: this.stats().maxHp };
        this.cooldowns = { attack: 0, dash: 0, shift: 0, guard: 0, art: 0 };
        this.shield = 0; this.guardTime = 0; this.focus = this.stats().maxFocus;
        this.guideTurns = 0; this.status = 'playing'; this.events = []; this.settled = false;
        this.enterGarden();
      }

      get region() { return this.journey[this.depth]; }
      get biome() { return this.trail === 'secret' ? SECRET_BIOME : BIOMES[this.region]; }
      get dashCooldown() { return this.cooldowns.dash; }
      get shiftCooldown() { return this.cooldowns.shift; }
      has(id) { return this.blessings.includes(id) ? 1 : 0; }
      vaultKeys() { return this.map.entities.filter(e => e.type === 'vaultkey' && e.done).length; }
      stats() {
        return {
          maxHp: 7 + this.upgrades.hearth + this.has('vitality') * 2 + (this.gentle ? 3 : 0) + (this.charm === 'crown' ? 2 : 0),
          damage: 1 + this.has('radiance'), reach: 1 + this.has('reach') + (this.charm === 'keeper' && this.boss?.mode === 'recovery' ? 1 : 0), sight: 5 + this.upgrades.lens + this.has('sight') * 2,
          dash: 3 + this.has('drift'), dashWait: (this.has('drift') ? 1.9 : 2.8) * (this.charm === 'feather' ? .75 : 1),
          attackWait: this.has('quick') ? .44 : .55, guardDuration: .65 + this.upgrades.ward * .07,
          maxFocus: 3 + this.upgrades.focus + this.has('focus') * 2 + (this.charm === 'firefly' ? 1 : 0),
        };
      }
      enterGarden() {
        this.map = ['trial', 'secret'].includes(this.trail) ? world.trial(this.region, helpers) : this.generator === 1 ? generateLegacy(this.seed, this.region) : generate(this.seed, this.region, { plan: this.plan[this.depth], tier: this.tier, generator: this.generator });
        this.map.shortcuts ||= []; this.map.vents ||= []; this.map.clearings ||= [];
        if (this.generator === 1) this.map.enemies.forEach(e => Object.assign(e, { hp: ENEMIES[e.kind].hp, windup: 0, windupTotal: 0, moveWait: .4, rest: .5, known: false }));
        this.opened = []; this.seen = new Set(); this.visible = new Set(); this.guideCache = null; this.pathCache = null;
        this.player.x = 3; this.player.y = 3; this.phase = 0; this.seeds = ['trial', 'secret'].includes(this.trail) ? 3 : 0;
        this.carrying = false; this.delivered = false;
        this.boss = this.map.arena ? guardians.create(this.biome.guardian, this.map.arena, this.tier) : null;
        if (this.charm === 'firefly') { this.inventory.thread = Math.min(9, this.inventory.thread + 1); this.focus = Math.min(this.stats().maxFocus, this.focus + 1); }
        if (this.charm === 'crown') { this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 2); this.inventory.bomb = Math.min(9, this.inventory.bomb + 1); }
        if (this.trail === 'secret') this.inventory = { medicine: 2, bomb: 2, thread: 0 };
        Object.keys(this.cooldowns).forEach(key => { this.cooldowns[key] = 0; });
        this.guardTime = 0; this.shield = .8; this.guideTurns = 0;
        this.reveal();
      }
      emit(type, text = '', extra = {}) { if (this.events.length < 100) this.events.push({ type, text, ...extra }); }
      recordSurvey() {
        if (['trial', 'secret'].includes(this.trail)) return;
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
        if (this.boss?.state === 'active') for (let yy = this.map.arena.y - 5; yy <= this.map.arena.y + 5; yy += 1) for (let xx = this.map.arena.x - 5; xx <= this.map.arena.x + 5; xx += 1) {
          this.seen.add(yy * this.map.w + xx); this.visible.add(yy * this.map.w + xx);
        }
      }
      entityAt(x, y) { return this.map.entities.find(e => !e.done && e.x === x && e.y === y); }
      enemyAt(x, y) { return this.boss?.state === 'active' && this.boss.x === x && this.boss.y === y ? this.boss : this.map.enemies.find(e => e.hp > 0 && e.x === x && e.y === y); }
      canStep(x, y) { return walkable(this.map, x, y, this.phase) && (this.boss?.state !== 'active' || guardians.inside(this.map.arena, { x, y })); }
      combatants() { return this.boss?.state === 'active' ? [this.boss] : this.map.enemies; }
      startBoss() { this.events = []; return guardians.start(this); }
      retreatBoss(failed = false) { return guardians.retreat(this, failed); }
      nearby() {
        if (this.boss?.state === 'active') return null;
        return this.map.entities.filter(e => (!e.done || (e.type === 'landmark' && ['ferries', 'spores', 'paper'].includes(this.biome.feature))) && ['portal', 'chest', 'well', 'shrine', 'landmark', 'trader', 'loom', 'guardian', 'vault', 'wishbed'].includes(e.type) && distance(e, this.player) <= 1)
          .sort((a, b) => distance(a, this.player) - distance(b, this.player))[0];
      }
      collect() {
        if (this.carrying && distance(this.player, { x: 3, y: 3 }) <= 1) this.deliverFirefly();
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
        } else if (e.type === 'courier') {
          e.done = true; this.carrying = true; this.guideCache = null;
          this.emit('courier', 'A lost firefly joins your lantern. Bring it to the waygate for a reward.');
        } else if (e.type === 'vaultkey') {
          if (e.phase !== this.phase) { this.emit('hint', `The ${e.phase ? 'moon' : 'sun'} key waits in ${e.phase ? 'Echo' : 'Bloom'}. Fold to collect it.`); return; }
          e.done = true; this.score += 25;
          const vault = this.map.entities.find(item => item.type === 'vault');
          if (vault) this.seen.add(vault.y * this.map.w + vault.x);
          this.emit('vaultKey', `${e.phase ? 'Moon' : 'Sun'} key found · ${this.vaultKeys()} / 2. The vault is marked on your atlas.`, { x: e.x, y: e.y });
        }
      }
      tendWishbed(e) {
        if (e.progress < 0) {
          if (this.light < 4) { this.emit('hint', 'Plant a wishseed for four expedition starlight. It grows while you walk the maze.'); return false; }
          this.light -= 4; e.progress = 0;
          this.emit('planted', 'A wishseed takes root. Walk 24 tiles, then return for a tonic, healing, focus, and five starlight.'); return true;
        }
        if (e.progress < 24) { this.emit('hint', `Your wishbed is growing · ${24 - e.progress} more walking steps. Waiting and attacking do not grow it.`); return false; }
        e.done = true; this.light += 5; this.score += 60;
        this.inventory.medicine = Math.min(9, this.inventory.medicine + 1);
        this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 3); this.focus = this.stats().maxFocus;
        this.emit('harvest', 'Your small kindness blooms · a tonic, three hearts, full focus, and five starlight.', { x: e.x, y: e.y }); return true;
      }
      deliverFirefly() {
        if (!this.carrying || this.delivered) return false;
        this.carrying = false; this.delivered = true; this.rescues += 1; this.light += 12; this.score += 120;
        this.inventory.medicine = Math.min(9, this.inventory.medicine + 1);
        this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 2); this.guideCache = null;
        this.emit('courierHome', 'A firefly finds its way home · +12 starlight, a tonic, and two hearts.'); return true;
      }
      useLoom(e, quiet = false) {
        const links = e.links.filter(i => !this.opened.includes(i));
        if (!quiet && !links.length) { this.emit('hint', 'These shortcuts are already open in both worlds.'); return false; }
        if (!quiet && links.includes(this.player.y * this.map.w + this.player.x)) { this.emit('hint', 'Step off the folded path before turning the loom.'); return false; }
        links.forEach(i => { this.map.tiles[i] = this.map.tiles[i] === 2 ? 3 : 2; this.seen.add(i); });
        if (!quiet) this.map.enemies.forEach(enemy => { enemy.intent = []; enemy.windup = 0; });
        if (!quiet) { e.progress = 1 - e.progress; this.emit('loom', 'The loom turns · nearby Bloom and Echo shortcuts trade places.', { x: e.x, y: e.y }); }
        this.guideCache = null; this.pathCache = null; return true;
      }
      trade(offer) {
        this.events = [];
        const e = this.nearby(), prices = { tonic: 6, supplies: 8, chart: 10 };
        if (this.status !== 'playing' || e?.type !== 'trader' || !Object.hasOwn(prices, offer) || this.light < prices[offer]) return false;
        if (offer === 'tonic' && this.inventory.medicine === 9 && this.player.hp === this.stats().maxHp || offer === 'supplies' && this.inventory.bomb === 9 && this.inventory.thread === 9) return false;
        if (offer === 'tonic') { this.inventory.medicine = Math.min(9, this.inventory.medicine + 2); this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 3); }
        if (offer === 'supplies') { this.inventory.bomb = Math.min(9, this.inventory.bomb + 2); this.inventory.thread = Math.min(9, this.inventory.thread + 1); }
        if (offer === 'chart') {
          this.map.entities.filter(p => ['seed', 'relic', 'landmark', 'guardian', 'courier', 'vaultkey', 'vault', 'wishbed'].includes(p.type)).forEach(p => this.seen.add(p.y * this.map.w + p.x));
          this.guideTurns = 80; this.focus = this.stats().maxFocus;
        }
        this.light -= prices[offer]; e.done = true;
        this.emit('trade', 'A fair exchange. The wayfarer wishes you a bright journey.'); return true;
      }
      openShortcuts(source) {
        const choices = this.map.shortcuts.filter(i => !this.opened.includes(i)).sort((a, b) => distance({ x: a % this.map.w, y: Math.floor(a / this.map.w) }, source) - distance({ x: b % this.map.w, y: Math.floor(b / this.map.w) }, source));
        choices.slice(0, 4).forEach(i => { this.map.tiles[i] = 0; this.opened.push(i); });
        this.guideCache = null; this.pathCache = null;
      }
      useLandmark(e) {
        if (e.done && ['ferries', 'spores', 'paper'].includes(this.biome.feature)) {
          const landings = this.map.entities.filter(p => p.type === 'landmark').sort((a, b) => a.number - b.number);
          const target = landings[e.number % landings.length];
          const landing = [target, ...DIRS.map(([dx, dy]) => ({ x: target.x + dx, y: target.y + dy }))]
            .find(p => walkable(this.map, p.x, p.y, this.phase) && !this.enemyAt(p.x, p.y));
          if (!landing) { this.emit('hint', 'The landing is occupied. Try again when the path is clear.'); return false; }
          this.player.x = landing.x; this.player.y = landing.y; this.shield = .5;
          this.emit('ferry', this.biome.feature === 'paper' ? 'A paper crane unfolds a path to the next island.' : this.biome.feature === 'spores' ? 'The dreaming roots carry you to the next cap.' : 'The ferry carries your lantern across the marsh.'); this.collect(); return true;
        }
        if (e.phase !== this.phase) { this.emit('hint', `${this.biome.landmark} answers in ${e.phase ? 'Echo' : 'Bloom'}.`); return false; }
        const count = this.map.entities.filter(p => p.type === 'landmark' && p.done).length;
        if (['stars', 'auroras', 'resonance', 'orbits', 'heartflowers'].includes(this.biome.feature) && e.number !== count + 1) { this.emit('hint', `Begin with ${this.biome.landmark} ${count + 1}.`); return false; }
        e.done = true; this.light += 4; this.score += 40; this.focus = Math.min(this.stats().maxFocus, this.focus + 1);
        if (['grove', 'gears', 'prisms', 'stars', 'bells', 'vanes', 'sundials', 'looms', 'auroras', 'nectar', 'resonance', 'lanterns', 'orbits', 'lastlight', 'beacons', 'heartflowers'].includes(this.biome.feature)) this.openShortcuts(e);
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
        if (!e) { this.emit('hint', 'Stand beside a discovery to interact. During a guardian encounter, keep your eyes on the warnings.'); return false; }
        if (e.type === 'portal') {
          if (this.carrying) this.deliverFirefly();
          if (this.seeds < 3) { this.emit('hint', `The waygate needs ${3 - this.seeds} more heartseeds.`); return false; }
          if (this.boss && this.boss.state !== 'defeated') { this.emit('hint', 'The heartseeds are ready. Find the guardian’s arena and awaken it before restoring this region.'); return false; }
          this.recordSurvey(); if (!['trial', 'secret'].includes(this.trail)) this.records[this.region].clears = 1;
          this.score += 200 * this.tier + this.records[this.region].explored; this.light += 10 * this.tier;
          this.status = this.depth === this.journey.length - 1 ? 'won' : 'blessing';
          this.emit('restored', this.biome.name); return true;
        }
        if (e.type === 'guardian') {
          if (this.seeds < 3) { this.emit('hint', 'Find three heartseeds before waking the guardian. Restore the landmarks for longer attack warnings.'); return false; }
          this.emit('challenge', '', { guardian: this.boss.id }); return false;
        }
        if (e.type === 'trader') { this.emit('trader'); return false; }
        if (e.type === 'wishbed') return this.tendWishbed(e);
        if (e.type === 'vault') {
          if (this.vaultKeys() < 2) { this.emit('hint', `This vault needs both realm keys · ${this.vaultKeys()} / 2. The sun key lives in Bloom; the moon key lives in Echo.`); return false; }
          e.done = true; this.light += 24; this.score += 200; this.focus = this.stats().maxFocus;
          this.inventory.bomb = Math.min(9, this.inventory.bomb + 2);
          this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 2);
          if (!this.vaults.includes(this.region)) this.vaults.push(this.region);
          this.openShortcuts(e);
          this.emit('vaultOpened', 'Two worlds, one promise · +24 starlight, two seedbombs, two hearts, and full focus.', { x: e.x, y: e.y }); return true;
        }
        if (e.type === 'loom') return this.useLoom(e);
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
        if (enemy === this.boss) { guardians.strike(this, damage); return; }
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
          if (this.charm === 'bell') this.player.hp = Math.min(this.stats().maxHp, this.player.hp + 1);
          this.focus = Math.min(this.stats().maxFocus, this.focus + 1);
          this.emit('parry', 'Perfect reflection · attack blocked, focus restored'); return;
        }
        if (this.shield > 0) return;
        this.player.hp = Math.max(0, this.player.hp - (this.gentle ? 1 : amount));
        if (this.boss?.state === 'active') this.boss.hitsTaken += 1;
        this.shield = .85;
        this.emit('hurt', 'Dodge the warning, guard with G, or interrupt with a lantern art.');
        if (enemy && this.has('thorns')) this.hit(enemy, 2);
        if (this.player.hp === 0) {
          if (this.boss?.state === 'active') { this.retreatBoss(true); return; }
          this.status = 'lost'; this.recordSurvey(); this.emit('lost', 'Your lantern brings you safely home.');
        }
      }
      castArt() {
        const art = ARTS.find(a => a.id === this.art);
        if (this.cooldowns.art > 0 || this.focus < art.cost) { this.emit('hint', `${art.name} needs ${art.cost} focus. Focus returns over time, from freed creatures, and from guarding.`); return false; }
        const p = this.player, [dx, dy] = DIRS[p.facing], fighting = this.boss?.state === 'active';
        const foes = this.combatants().filter(e => e.hp > 0 && lineOfSight(this.map, p, e, this.phase));
        if (this.art === 'mend') {
          p.hp = Math.min(this.stats().maxHp, p.hp + 4); this.shield = Math.max(this.shield, 1.5);
        } else for (const e of foes) {
          if (this.art === 'lance') {
            if ((dx && e.y === p.y && (e.x - p.x) * dx > 0 || dy && e.x === p.x && (e.y - p.y) * dy > 0) && distance(e, p) <= 5) this.hit(e, 5);
          } else if (['stars', 'dawn', 'afterglow', 'firstlight'].includes(this.art) ? this.visible.has(e.y * this.map.w + e.x) : distance(e, p) <= (this.art === 'resonance' ? 5 : ['nova', 'tempest', 'tide', 'nectar'].includes(this.art) ? 4 : 3)) {
            this.hit(e, this.art === 'gust' ? 1 : ['snare', 'nectar'].includes(this.art) ? 2 : this.art === 'tide' ? 3 : this.art === 'dawn' ? 5 : this.art === 'firstlight' ? 6 : 4, this.art === 'snare' ? 3 : ['nectar', 'resonance'].includes(this.art) ? 2 : 1.5);
          }
        }
        if (this.art === 'stars') this.shield = Math.max(this.shield, 1.5);
        if (['tide', 'dawn'].includes(this.art)) p.hp = Math.min(this.stats().maxHp, p.hp + 2);
        if (this.art === 'tide') this.shield = Math.max(this.shield, .65);
        if (this.art === 'tempest') this.cooldowns.dash = 0;
        if (this.art === 'dawn') this.cooldowns.guard = 0;
        if (this.art === 'nectar') { p.hp = Math.min(this.stats().maxHp, p.hp + 1); this.shield = Math.max(this.shield, 1); }
        if (this.art === 'firstlight') { this.cooldowns.shift = 0; this.cooldowns.dash = 0; }
        if (this.art === 'afterglow') { this.cooldowns.shift = 0; this.shield = Math.max(this.shield, 1.2); }
        if (this.has('roots')) p.hp = Math.min(this.stats().maxHp, p.hp + 1);
        this.focus -= art.cost; this.cooldowns.art = 1.5;
        if (fighting && this.boss.state === 'defeated') this.focus = this.stats().maxFocus;
        this.emit('art', art.name); return true;
      }
      act(action, direction) {
        this.events = [];
        if (this.status !== 'playing') return false;
        const p = this.player, stepsBefore = this.steps;
        let acted = false;
        if (action === 'move' && Number.isInteger(direction) && direction >= 0 && direction < 4) {
          p.facing = direction;
          const [dx, dy] = DIRS[direction], x = p.x + dx, y = p.y + dy;
          if (!this.canStep(x, y)) { this.emit('blocked', this.boss?.state === 'active' ? 'The arena holds the encounter. Pause to leave and prepare again.' : this.map.tiles[y * this.map.w + x] >= 2 ? 'A folded path. Q switches Bloom and Echo.' : 'Try another path.'); return false; }
          if (this.enemyAt(x, y)) return this.act('attack');
          p.x = x; p.y = y; this.steps += 1; this.collect(); this.emit('move'); acted = true;
        } else if (action === 'attack') {
          if (this.cooldowns.attack > 0) return false;
          const { reach, damage, attackWait } = this.stats();
          this.combatants().filter(e => e.hp > 0 && Math.max(Math.abs(e.x - p.x), Math.abs(e.y - p.y)) <= reach + (e === this.boss ? 1 : 0) && lineOfSight(this.map, p, e, this.phase)).forEach(e => this.hit(e, damage));
          this.cooldowns.attack = attackWait; this.emit('sweep'); acted = true;
        } else if (action === 'guard') {
          if (this.cooldowns.guard > 0) return false;
          this.guardTime = this.stats().guardDuration; this.cooldowns.guard = this.charm === 'chime' ? 2.56 : 3.2;
          this.emit('guard', 'Mirror guard · catch the attack as its ring closes'); acted = true;
        } else if (action === 'art') acted = this.castArt();
        else if (action === 'shift') {
          if (this.shiftCooldown > 0) { this.emit('hint', `The fold settles in ${this.shiftCooldown.toFixed(1)} seconds.`); return false; }
          if (!walkable(this.map, p.x, p.y, 1 - this.phase)) { this.emit('hint', 'Step off the folded path before shifting.'); return false; }
          this.phase = 1 - this.phase; this.cooldowns.shift = this.charm === 'twilight' ? 3.2 : 4.2;
          this.shield = Math.max(this.shield, this.has('echo') ? 1 : this.charm === 'twilight' ? .7 : .35);
          this.map.enemies.forEach(e => { e.intent = []; e.windup = 0; if (distance(e, p) <= 5) e.stun = Math.max(e.stun, .9); });
          this.collect(); this.emit('shift', `${this.phase ? 'Echo' : 'Bloom'} awakened${this.boss?.state === 'active' ? ' · the guardian’s pattern continues' : ' · nearby creatures are dazed'}`); acted = true;
        } else if (action === 'dash') {
          if (this.dashCooldown > 0) return false;
          const [dx, dy] = DIRS[p.facing];
          for (let i = 0; i < this.stats().dash; i += 1) {
            if (!this.canStep(p.x + dx, p.y + dy) || this.enemyAt(p.x + dx, p.y + dy)) break;
            p.x += dx; p.y += dy; this.steps += 1; this.collect(); acted = true;
          }
          if (!acted) { this.emit('hint', 'Face an open path to dash.'); return false; }
          this.cooldowns.dash = this.stats().dashWait; this.shield = Math.max(this.shield, .3); this.emit('dash');
        } else if (action === 'medicine') {
          if (!this.inventory.medicine || p.hp >= this.stats().maxHp) { this.emit('hint', this.inventory.medicine ? 'Your hearts are already full.' : 'No tonic left. Look for a spring or a cache.'); return false; }
          this.inventory.medicine -= 1; p.hp = Math.min(this.stats().maxHp, p.hp + 5);
          if (this.has('alchemist')) this.focus = this.stats().maxFocus;
          if (this.charm === 'amber') { this.focus = Math.min(this.stats().maxFocus, this.focus + 2); this.shield = Math.max(this.shield, 1); }
          this.shield = Math.max(this.shield, .4); this.emit('heal', 'Moonberry tonic · five hearts restored'); acted = true;
        } else if (action === 'bomb') {
          if (!this.inventory.bomb) { this.emit('hint', 'No seedbombs left. Search a treasure cache.'); return false; }
          this.inventory.bomb -= 1;
          this.combatants().filter(e => e.hp > 0 && distance(e, p) <= 4 && lineOfSight(this.map, p, e, this.phase)).forEach(e => this.hit(e, 4 + this.has('alchemist') * 2, 1.5));
          this.emit('bomb', 'Seedburst!'); acted = true;
        } else if (action === 'thread') {
          if (!this.inventory.thread) { this.emit('hint', 'No threads left. Your atlas remembers every path you have seen.'); return false; }
          this.inventory.thread -= 1; this.guideTurns = this.has('sight') ? 81 : 41;
          this.emit('guide', 'Follow the golden thread. A ring on the trail means shift there.'); acted = true;
        } else if (action === 'interact') acted = this.interact();
        else if (action === 'wait') acted = true;
        else if (action === 'return') { this.recordSurvey(); this.status = 'returned'; this.emit('returned', 'Every discovery comes home with you.'); acted = true; }
        if (!acted) return false;
        if (this.steps > stepsBefore && this.boss?.state !== 'active') for (const bed of this.map.entities.filter(e => e.type === 'wishbed' && !e.done && e.progress >= 0 && e.progress < 24)) {
          bed.progress = Math.min(24, bed.progress + this.steps - stepsBefore);
          if (bed.progress === 24) this.emit('gardenReady', 'Your wishbed has bloomed. Return to the sprout marked on your atlas.');
        }
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
        if (this.boss?.state === 'active') { guardians.update(this, dt); return; }
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
              .filter(cell => walkable(this.map, cell.x, cell.y, this.phase) && (!this.map.arena || !guardians.inside(this.map.arena, cell)) && !same(cell, this.player) && !this.enemyAt(cell.x, cell.y) && field[cell.y * this.map.w + cell.x] >= 0 && field[cell.y * this.map.w + cell.x] < d)
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
        const key = `${this.depth}:${this.turn}:${this.phase}:${this.player.x}:${this.player.y}:${this.seeds}:${this.opened.length}:${this.carrying}:${this.boss?.state}`;
        if (this.guideCache?.key === key) return this.guideCache.route;
        const type = this.carrying ? 'portal' : this.seeds < 3 ? 'seed' : this.boss && this.boss.state !== 'defeated' ? 'guardian' : 'portal';
        const targets = this.map.entities.filter(e => e.type === type && !e.done);
        const route = targets.map(target => this.route(target)).filter(path => path.length).sort((a, b) => a.length - b.length)[0] || [];
        this.guideCache = { key, route }; return route;
      }
      snapshot() {
        return {
          generator: this.generator, seed: this.seed, daily: this.daily, gentle: this.gentle, upgrades: this.upgrades,
          trail: this.trail, surveyRegion: this.surveyRegion, plan: this.plan, tier: this.tier, art: this.art, charm: this.charm, depth: this.depth,
          phase: this.phase, turn: this.turn, steps: this.steps, kills: this.kills, light: this.light, score: this.score, elapsed: this.elapsed,
          memories: this.memories, relics: this.relics, vaults: this.vaults, blessings: this.blessings, records: this.records, inventory: this.inventory, player: this.player,
          cooldowns: this.cooldowns, focus: this.focus, shield: this.shield, guardTime: this.guardTime, guideTurns: this.guideTurns,
          status: this.status, seen: [...this.seen], opened: this.opened,
          boss: this.boss ? { ...this.boss, intent: this.boss.intent.map(p => ({ ...p })), followup: this.boss.followup.map(p => ({ ...p })), queue: this.boss.queue.map(strike => ({ realm: strike.realm, cells: strike.cells.map(p => ({ ...p })) })), kit: this.boss.kit ? { ...this.boss.kit } : null } : null,
          guardianWins: this.guardianWins, rescues: this.rescues, recordedRescues: this.recordedRescues, carrying: this.carrying, delivered: this.delivered,
          entities: this.map.entities.map(e => ({ id: e.id, done: e.done, progress: e.progress || 0 })),
          enemies: this.map.enemies.map(e => ({ id: e.id, x: e.x, y: e.y, hp: e.hp, intent: e.intent, stun: e.stun, awake: e.awake,
            windup: e.windup, windupTotal: e.windupTotal, moveWait: e.moveWait, rest: e.rest, known: e.known })),
          vents: this.map.vents.map(v => ({ timer: v.timer, warning: v.warning })),
        };
      }
      static restore(s) {
        if (!plain(s) || !plain(s.player) || !plain(s.inventory) || !Number.isSafeInteger(s.seed) || s.seed < 0 || s.seed > 4294967295 ||
          !Number.isInteger(s.depth) || s.depth < 0 || s.depth >= BIOMES.length || ![0, 1].includes(s.phase) || !['playing', 'blessing'].includes(s.status) ||
          !Array.isArray(s.blessings) || s.blessings.length !== s.depth || new Set(s.blessings).size !== s.blessings.length || s.blessings.some(id => !BLESSINGS.some(b => b.id === id)) ||
          !Array.isArray(s.entities) || s.entities.length > 100 || !Array.isArray(s.enemies) || s.enemies.length > 16 || !Array.isArray(s.seen) || s.seen.length > 1600) return null;
        const legacy = s.generator === undefined;
        if (!legacy && (![1, 2, 3, 4, 5].includes(s.generator) || !['daily', 'survey', 'trial', 'secret', ...TRAILS.map(t => t.id)].includes(s.trail))) return null;
        if (s.generator < 3 && (['rainbound', 'aurora', 'homecoming', 'trial'].includes(s.trail) || s.surveyRegion > 8)) return null;
        if (s.generator < 4 && (['seasons', 'unwritten', 'tomorrow'].includes(s.trail) || s.surveyRegion > 14)) return null;
        if (s.generator < 5 && (['finale', 'secret'].includes(s.trail) || s.surveyRegion > 20)) return null;
        if (s.trail === 'secret' && (s.generator !== 5 || s.daily !== false || s.gentle !== false || s.tier !== 1 || s.depth !== 0 || s.surveyRegion !== 22)) return null;
        if (s.trail === 'secret') {
          const validKit = kit => plain(kit) && ['medicine', 'bomb'].every(key => Number.isInteger(kit[key]) && kit[key] >= 0 && kit[key] <= 2) && kit.thread === 0;
          if (!validKit(s.inventory) || s.boss?.state === 'active' && !validKit(s.boss.kit)) return null;
        }
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
        if (!Number.isInteger(s.player.hp) || s.player.hp < 1) return null;
        game.player = { x: s.player.x, y: s.player.y, hp: integer(s.player.hp, 1, game.stats().maxHp), facing: integer(s.player.facing, 0, 3, 2) };
        for (const key of ['turn', 'steps', 'kills', 'light', 'score']) game[key] = integer(s[key], 0, 999999);
        game.elapsed = number(s.elapsed, 0, 9999999);
        for (const key of ['medicine', 'bomb', 'thread']) game.inventory[key] = integer(s.inventory[key], 0, 9);
        game.memories = ids(s.memories, MEMORIES.length); game.relics = ids(s.relics, RELICS.length);
        game.vaults = ids(s.vaults, BIOMES.length).filter(i => i >= 15);
        if (s.entities.length !== game.map.entities.length || s.enemies.length !== game.map.enemies.length) return null;
        for (let i = 0; i < game.map.entities.length; i += 1) {
          const e = game.map.entities[i], saved = s.entities[i];
          if (!plain(saved) || saved.id !== e.id || typeof saved.done !== 'boolean') return null;
          if (e.type !== 'portal') e.done = saved.done;
          if (e.type === 'shrine') e.progress = integer(saved.progress, 0, e.done ? 3 : 2);
          if (e.type === 'loom') { e.done = false; e.progress = integer(saved.progress, 0, 1); if (e.progress) game.useLoom(e, true); }
          if (e.type === 'wishbed') {
            if (!Number.isInteger(saved.progress) || saved.progress < -1 || saved.progress > 24 || e.done && saved.progress !== 24) return null;
            e.progress = saved.progress;
          }
        }
        const vault = game.map.entities.find(e => e.type === 'vault');
        if (vault?.done && game.vaultKeys() !== 2) return null;
        if (!walkable(game.map, s.player.x, s.player.y, s.phase)) return null;
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
        game.seeds = ['trial', 'secret'].includes(game.trail) ? 3 : game.map.entities.filter(e => e.type === 'seed' && e.done).length;
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
        if (game.generator >= 3) {
          if (!guardians.restore(game, s.boss, { ...helpers, number })) return null;
          if (s.status === 'blessing' && game.boss && game.boss.state !== 'defeated') return null;
          game.guardianWins = Object.fromEntries(GUARDIANS.map(b => [b.id, integer(s.guardianWins?.[b.id], 0, b.hidden ? 1 : 3)]));
          game.rescues = integer(s.rescues, 0, game.journey.length);
          game.recordedRescues = integer(s.recordedRescues, 0, game.rescues);
          game.carrying = s.carrying === true; game.delivered = s.delivered === true;
          const courier = game.map.entities.find(e => e.type === 'courier');
          if (game.carrying && game.delivered || (game.carrying || game.delivered) && !courier?.done) return null;
        }
        game.seen = new Set(s.seen.filter(i => Number.isInteger(i) && i >= 0 && i < game.map.w * game.map.h));
        game.reveal(); return game;
      }
    }

    function readSave(raw) {
      if (typeof raw !== 'string' || raw.length > MAX_SAVE) return { profile: profile(), game: null, invalid: !!raw };
      try {
        const data = JSON.parse(raw);
        if (!plain(data) || ![1, 2, 3, 4, VERSION].includes(data.version)) return { profile: profile(), game: null, invalid: true };
        const savedProfile = profile(data.profile);
        let game = data.run ? Game.restore(data.run) : null;
        if (game?.trail === 'secret' && !secretUnlocked(savedProfile)) game = null;
        return { profile: savedProfile, game, invalid: !!data.run && !game, migrated: data.version < VERSION };
      } catch { return { profile: profile(), game: null, invalid: true }; }
    }
    function writeSave(p, game) {
      return JSON.stringify({ version: VERSION, profile: profile(p), run: game && ['playing', 'blessing'].includes(game.status) ? game.snapshot() : null });
    }
    return { ...content, ...helpers, VERSION, SAVE_KEY, MAX_SAVE, Game, generate, profile, buyUpgrade, upgradeRequirement, medal, medals, guardianMedals, trailUnlocked, regionUnlocked, artUnlocked, charmUnlocked, collectionProgress, secretUnlocked, createExpedition, bankExpedition, syncDiscoveries, discoveryPlan, readSave, writeSave };
  }
  return { createApi };
}));
