const C = require('../../games/lumenwild/js/core');
const { createHash } = require('node:crypto');
const v2 = require('../fixtures/lumenwild/version-two.json');
const { advance, finishExpedition } = require('../helpers/lumenwildPilot');

function arena(region = 9, options = {}) {
  const game = new C.Game({ seed: 216, trail: 'trial', region, ...options });
  Object.assign(game.player, game.map.arena.entry);
  expect(game.startBoss()).toBe(true);
  return game;
}

function standInWarning(game) {
  const cell = game.boss.intent.find(p => p.x !== game.boss.x || p.y !== game.boss.y);
  Object.assign(game.player, cell); game.shield = 0;
}

describe('The Waking Guardians content and exploration', () => {
  test('all fifteen regions have unique discoveries and three new stages unlock together in each chapter', () => {
    expect(C.BIOMES).toHaveLength(15);
    expect(C.MEMORIES).toHaveLength(90); expect(C.RELICS).toHaveLength(45);
    expect(new Set(C.BIOMES.map(b => b.layout)).size).toBe(15);
    expect(new Set(C.BIOMES.flatMap(b => b.memories)).size).toBe(90);
    const p = C.profile();
    expect(C.createExpedition(p, { trail: 'rainbound' })).toBeNull();
    p.trails.frontier = 1;
    expect(C.createExpedition(p, { trail: 'rainbound' }).journey).toEqual([9, 10, 11]);
    for (const region of [9, 10, 11]) expect(C.regionUnlocked(p, region)).toBe(true);
    for (const region of [12, 13, 14]) expect(C.regionUnlocked(p, region)).toBe(false);
    p.trails.rainbound = 1;
    expect(C.createExpedition(p, { trail: 'aurora' }).journey).toEqual([12, 13, 14]);
    p.trails.aurora = 1;
    expect(C.createExpedition(p, { trail: 'homecoming' }).journey).toHaveLength(15);
    expect(C.regionUnlocked(p, -1)).toBe(false); expect(C.regionUnlocked(p, 15)).toBe(false);
  });

  test('120 new mazes have reachable objectives, separated arenas, and bounded populations in both worlds', () => {
    for (let seed = 0; seed < 20; seed += 1) for (let region = 9; region < 15; region += 1) {
      const map = C.generate(seed, region);
      expect(map.w * map.h).toBeLessThanOrEqual(1505);
      expect(map.enemies.length).toBeLessThanOrEqual(9);
      expect(new Set(map.entities.map(e => `${e.x},${e.y}`)).size).toBe(map.entities.length);
      expect(map.entities.filter(e => e.type === 'seed')).toHaveLength(3);
      for (const type of ['courier', 'trader']) expect(map.entities.filter(e => e.type === type)).toHaveLength(1);
      for (const phase of [0, 1]) {
        const field = C.distances(map, { x: 3, y: 3 }, phase);
        for (const e of map.entities) expect(field[e.y * map.w + e.x]).toBeGreaterThanOrEqual(0);
        if (map.arena) {
          for (let y = map.arena.y - 5; y <= map.arena.y + 5; y += 1) for (let x = map.arena.x - 5; x <= map.arena.x + 5; x += 1) expect(C.walkable(map, x, y, phase)).toBe(true);
          expect(map.enemies.every(e => Math.abs(e.x - map.arena.x) > 5 || Math.abs(e.y - map.arena.y) > 5)).toBe(true);
        }
      }
    }
  });

  test('all 90 memories and 45 relics are reachable through three discovery plans without duplicate grinding', () => {
    const memories = [], relics = [];
    for (let visit = 0; visit < 3; visit += 1) {
      const game = new C.Game({ seed: visit + 900, trail: 'homecoming', knownMemories: memories, knownRelics: relics });
      for (const entry of game.plan) {
        if (visit < 2) expect(entry.memories.every(id => !memories.includes(id))).toBe(true);
        expect(relics).not.toContain(entry.relic);
        memories.push(...entry.memories); relics.push(entry.relic);
      }
    }
    expect(new Set(memories).size).toBe(90); expect(new Set(relics).size).toBe(45);
  });

  test('fold looms swap only shortcuts, preserve connected objectives, and restore a player standing on a changed gate', () => {
    const game = new C.Game({ seed: 907, trail: 'survey', region: 13 });
    game.map.enemies.forEach(e => { e.hp = 0; });
    const loom = game.map.entities.find(e => e.type === 'loom'), before = game.map.tiles.slice();
    Object.assign(game.player, loom); expect(game.act('interact')).toBe(true);
    expect(loom.progress).toBe(1);
    for (const index of loom.links) expect(game.map.tiles[index]).toBe(before[index] === 2 ? 3 : 2);
    for (const phase of [0, 1]) {
      const field = C.distances(game.map, { x: 3, y: 3 }, phase);
      game.map.entities.forEach(e => expect(field[e.y * game.map.w + e.x]).toBeGreaterThanOrEqual(0));
    }
    const index = loom.links[0];
    Object.assign(game.player, { x: index % game.map.w, y: Math.floor(index / game.map.w) });
    game.phase = game.map.tiles[index] - 2;
    const restored = C.Game.restore(game.snapshot());
    expect(restored).not.toBeNull(); expect(restored.map.tiles).toEqual(game.map.tiles); expect(restored.player.x).toBe(game.player.x);
    Object.assign(game.player, loom); game.act('interact'); expect(game.map.tiles).toEqual(before);
  });

  test('the wayfarer spends expedition currency once, preserves camp savings, and rejects unavailable or invalid purchases', () => {
    const game = new C.Game({ seed: 19 }), p = C.profile({ light: 300 });
    const trader = game.map.entities.find(e => e.type === 'trader'); game.map.enemies.forEach(e => { e.hp = 0; });
    expect(game.trade('supplies')).toBe(false);
    Object.assign(game.player, trader);
    expect(game.trade('supplies')).toBe(false); game.light = 10;
    expect(game.trade('__proto__')).toBe(false);
    const bombs = game.inventory.bomb;
    expect(game.trade('supplies')).toBe(true); expect(game.inventory.bomb).toBe(bombs + 2); expect(game.light).toBe(2);
    expect(game.trade('supplies')).toBe(false); expect(p.light).toBe(300);
    expect(C.Game.restore(game.snapshot()).map.entities.find(e => e.id === trader.id).done).toBe(true);
  });

  test('fireflies follow the keeper across saves and award only once at the waygate', () => {
    const game = new C.Game({ seed: 34 }), p = C.profile({ rescues: 2 });
    game.map.enemies.forEach(e => { e.hp = 0; });
    const firefly = game.map.entities.find(e => e.type === 'courier'); Object.assign(game.player, { x: firefly.x, y: firefly.y }); game.collect();
    expect(game.carrying).toBe(true); expect(game.guide().at(-1)).toMatchObject({ x: 3, y: 3 });
    const restored = C.Game.restore(game.snapshot()); expect(restored.carrying).toBe(true);
    Object.assign(restored.player, { x: 3, y: 3 }); restored.collect();
    expect(restored.carrying).toBe(false); expect(restored.rescues).toBe(1); expect(restored.light).toBe(12);
    restored.collect(); expect(restored.light).toBe(12);
    C.syncDiscoveries(p, restored); C.syncDiscoveries(p, restored);
    expect(p.rescues).toBe(3);
    const checkpoint = C.readSave(C.writeSave(p, restored));
    C.syncDiscoveries(checkpoint.profile, checkpoint.game);
    expect(checkpoint.profile.rescues).toBe(3);
    restored.status = 'returned'; C.bankExpedition(p, restored); C.bankExpedition(p, restored);
    expect(p.rescues).toBe(3); expect(C.charmUnlocked(p, 'firefly')).toBe(true);
  });

  test('charm loadouts grant their bonuses without leaving an unaffordable art equipped', () => {
    const p = C.profile({ rescues: 3, guardians: { dawnhart: 1, tempest: 1, bellkeeper: 1 }, selectedCharm: 'firefly', selectedArt: 'dawn' });
    const firefly = C.createExpedition(p, { seed: 5 });
    expect(firefly.art).toBe('dawn'); expect(firefly.stats().maxFocus).toBe(4); expect(firefly.inventory.thread).toBe(4);
    p.selectedCharm = 'crown';
    const crown = C.createExpedition(p, { seed: 5 });
    expect(crown.art).toBe('gust'); expect(crown.stats().maxHp).toBe(9); expect(crown.inventory.bomb).toBe(3);
    expect(firefly.art).toBe('dawn'); expect(firefly.stats().maxFocus).toBe(4);
    p.selectedCharm = 'feather';
    expect(C.createExpedition(p, { seed: 5 }).stats().dashWait).toBeCloseTo(2.1);
    p.selectedCharm = 'bell';
    const bell = C.createExpedition(p, { seed: 5 }); bell.player.hp = 3; bell.act('guard'); bell.hurt(2);
    expect(bell.player.hp).toBe(4);
    const daily = C.createExpedition(p, { seed: 5, daily: true });
    expect(daily.charm).toBe('none'); expect(daily.art).toBe('gust');
  });

  test.each(['rainbound', 'aurora', 'homecoming'])('%s completes with normal timed input, no camp upgrades, and every required guardian', trail => {
    const game = new C.Game({ seed: 1947, trail });
    expect(finishExpedition(game, C)).toBe('won');
    expect(game.depth).toBe(game.journey.length - 1);
    for (const region of game.journey.filter(i => C.BIOMES[i].guardian)) expect(game.guardianWins[C.BIOMES[region].guardian]).toBe(1);
  });
});

describe('Guardian combat, recovery, and progression', () => {
  test.each([9, 11, 14])('region %i guardian damages an idle keeper without waiting for a move', region => {
    const game = arena(region); advance(game, 1.5); expect(game.boss.mode).toBe('windup');
    standInWarning(game); const hp = game.player.hp, pattern = game.boss.intent.slice();
    game.act('attack'); expect(game.boss.intent).toEqual(pattern);
    advance(game, game.boss.timer + .1); expect(game.player.hp).toBe(hp - 2); expect(game.boss.mode).toBe('recovery');
  });

  test('a timed guard reflects a guardian hit, while bombs, arts and folding cannot erase its pattern', () => {
    const game = arena(); advance(game, 1.5);
    Object.assign(game.player, { x: game.boss.x + 1, y: game.boss.y });
    const pattern = game.boss.intent.slice(); game.act('bomb'); game.act('art'); game.act('shift');
    expect(game.boss.intent).toEqual(pattern); expect(game.boss.mode).toBe('windup');
    standInWarning(game); game.focus = 0; advance(game, game.boss.timer - .2);
    const hp = game.player.hp, bossHp = game.boss.hp; game.act('guard'); advance(game, .3);
    expect(game.player.hp).toBe(hp); expect(game.boss.hp).toBeLessThan(bossHp); expect(game.focus).toBeGreaterThanOrEqual(1);
  });

  test('realm-marked attacks hurt only their named world and always leave a safe ground alternative', () => {
    const game = arena(9, { gentle: true });
    for (let i = 0; i < 500 && game.boss.realm < 0; i += 1) advance(game, .05);
    expect(game.boss.realm).toBeGreaterThanOrEqual(0); expect(game.boss.intent.length).toBeLessThan(120);
    standInWarning(game); game.phase = 1 - game.boss.realm;
    const hp = game.player.hp, saved = game.snapshot(); advance(game, game.boss.timer + .1); expect(game.player.hp).toBe(hp);
    const other = C.Game.restore(saved); other.phase = other.boss.realm; advance(other, other.boss.timer + .1); expect(other.player.hp).toBe(hp - 1);
  });

  test('damage gates preserve all three boss phases even with a powerful loadout', () => {
    const game = arena(); advance(game, 1.5); advance(game, game.boss.timer + .1);
    game.hit(game.boss, 999);
    expect(game.boss.hp).toBe(20); expect(game.boss.mode).toBe('transition');
    game.hit(game.boss, 999); expect(game.boss.hp).toBe(20);
    advance(game, 1.2); expect(game.boss.stage).toBe(2); expect(game.boss.mode).toBe('windup');
    advance(game, game.boss.timer + .1); game.hit(game.boss, 999); expect(game.boss.hp).toBe(10);
    advance(game, 1.2); expect(game.boss.stage).toBe(3);
    advance(game, game.boss.timer + .1); game.hit(game.boss, 999);
    expect(game.boss.state).toBe('defeated'); expect(game.status).toBe('won');
  });

  test('a failed attempt restores its exact entry supplies and allows a retry without losing the expedition', () => {
    const game = arena(), kit = { ...game.inventory }; game.light = 19;
    game.act('bomb'); game.player.hp = 1; advance(game, 1.5); standInWarning(game); advance(game, game.boss.timer + .1);
    expect(game.status).toBe('playing'); expect(game.boss.state).toBe('sleeping'); expect(game.inventory).toEqual(kit);
    expect(game.player.hp).toBe(game.stats().maxHp); expect(game.light).toBe(19);
    expect(game.events.some(e => e.type === 'bossRetry')).toBe(true);
    expect(game.player).toMatchObject(game.map.arena.entry); expect(game.startBoss()).toBe(true);
  });

  test('the active arena cannot be escaped by walking or dashing; voluntary retreat refunds supplies without rewards', () => {
    const game = arena(); Object.assign(game.player, { x: 5, y: 3, facing: 3 });
    expect(C.walkable(game.map, 4, 3)).toBe(true);
    expect(game.act('move', 3)).toBe(false); expect(game.act('dash')).toBe(false);
    const kit = { ...game.inventory }; game.act('bomb'); expect(game.retreatBoss()).toBe(true);
    expect(game.inventory).toEqual(kit); expect(game.guardianWins.bellkeeper).toBe(0); expect(game.light).toBe(0);
    expect(game.canStep(4, 3)).toBe(true);
  });

  test('restoring regional landmarks lengthens warnings and the guardian gates region completion', () => {
    const game = new C.Game({ seed: 45, trail: 'survey', region: 9 });
    game.map.entities.filter(e => e.type === 'seed').forEach(e => { e.done = true; }); game.seeds = 3;
    expect(game.act('interact')).toBe(false); expect(game.records[9].clears).toBe(0);
    Object.assign(game.player, game.map.arena.entry); game.records[9].landmark = true; game.startBoss(); advance(game, 1.5);
    expect(game.boss.total).toBeCloseTo(2.2);
  });

  test.each([9, 11, 14])('guardian %i can be defeated at all three tiers through normal timed actions', region => {
    for (let tier = 1; tier <= 3; tier += 1) {
      const game = new C.Game({ seed: 901, trail: 'trial', region, tier });
      expect(finishExpedition(game, C)).toBe('won');
      expect(game.guardianWins[game.biome.guardian]).toBe(tier);
      expect(game.records.every(r => r.explored === 0 && r.clears === 0)).toBe(true);
    }
  });

  test('guardian ranks unlock arts, charms, and bounded rematches, with one-time seal awards', () => {
    const p = C.profile(); expect(C.createExpedition(p, { trail: 'trial', region: 9 })).toBeNull();
    const game = new C.Game({ seed: 9, trail: 'trial', region: 9 }); finishExpedition(game, C);
    C.syncDiscoveries(p, game); expect(C.artUnlocked(p, 'tide')).toBe(true); expect(C.charmUnlocked(p, 'bell')).toBe(true);
    expect(C.createExpedition(p, { trail: 'trial', region: 9, tier: 3 }).tier).toBe(2);
    C.bankExpedition(p, game); const light = p.light;
    expect(game.guardianReward).toBe(40); expect(C.bankExpedition(p, game)).toBe(false); expect(p.light).toBe(light);
    expect(C.medals(p)).toBe(0); expect(p.regions[9].explored).toBe(0);
    const replay = new C.Game({ seed: 10, trail: 'trial', region: 9 }); finishExpedition(replay, C); C.bankExpedition(p, replay);
    expect(replay.guardianReward).toBe(0);
    expect(C.charmUnlocked(p, '__proto__')).toBe(false);
  });
});

describe('Guardian expansion save compatibility', () => {
  test('a real version-two checkpoint regenerates its exact previous map and keeps its profile', () => {
    const loaded = C.readSave(JSON.stringify(v2.save));
    expect(loaded.invalid).toBe(false); expect(loaded.migrated).toBe(true); expect(loaded.game.generator).toBe(2);
    expect(createHash('sha256').update(JSON.stringify(loaded.game.map)).digest('hex')).toBe(v2.mapDigest);
    expect(loaded.game.player).toEqual(v2.save.run.player); expect(loaded.profile.light).toBe(267);
    expect(loaded.profile.guardians).toEqual({ bellkeeper: 0, tempest: 0, dawnhart: 0 });
    expect(C.Game.restore(loaded.game.snapshot()).snapshot()).toEqual(loaded.game.snapshot());
  });

  test.each([9, 11, 14])('an active guardian %i retains its pattern, supplies, and deterministic future across a save', region => {
    const game = arena(region); advance(game, 1.5); game.act('bomb');
    const restored = C.Game.restore(game.snapshot()); expect(restored.snapshot()).toEqual(game.snapshot());
    for (let i = 0; i < 200; i += 1) {
      advance(game, .05); advance(restored, .05);
      if (i % 9 === 0) { game.act('guard'); restored.act('guard'); }
      expect(restored.snapshot()).toEqual(game.snapshot());
    }
  });

  test('untrusted guardian, courier, and trial fields are bounded or rejected', () => {
    const game = arena(); advance(game, 1.5);
    for (const corrupt of [
      s => { s.boss.id = '__proto__'; }, s => { s.boss.state = 'admin'; }, s => { s.boss.x = 0; },
      s => { s.boss.intent = Array(122).fill({ x: 10, y: 8 }); }, s => { s.boss.intent[0] = { x: 0, y: 0 }; },
      s => { s.boss.kit = null; }, s => { s.boss.landing = { x: 4.5, y: 8 }; }, s => { s.carrying = true; },
    ]) {
      const saved = JSON.parse(JSON.stringify(game.snapshot())); corrupt(saved); expect(C.Game.restore(saved)).toBeNull();
    }
    const saved = game.snapshot(); saved.boss.timer = 1e30; saved.guardianWins.bellkeeper = 1e30;
    const loaded = C.Game.restore(saved); expect(loaded.boss.timer).toBe(5); expect(loaded.guardianWins.bellkeeper).toBe(0);
  });
});
