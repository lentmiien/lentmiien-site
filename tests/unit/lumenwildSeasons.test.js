const { createHash } = require('node:crypto');
const C = require('../../games/lumenwild/js/core');
const previous = require('../fixtures/lumenwild/version-three.json');
const { advance, finishExpedition } = require('../helpers/lumenwildPilot');

function place(game, cell) { game.player.x = cell.x; game.player.y = cell.y; }
function arena(region = 15, options = {}) {
  const game = new C.Game({ seed: 73619, trail: 'trial', region, ...options });
  place(game, game.map.arena.entry); expect(game.startBoss()).toBe(true); advance(game, 1.5);
  return game;
}

describe('The Unwritten Seasons exploration', () => {
  test('new chapters continue from Aurora, preserve old routes, and unlock their regional surveys', () => {
    const p = C.profile();
    expect(C.createExpedition(p, { trail: 'seasons' })).toBeNull();
    p.trails.aurora = 1;
    expect(C.createExpedition(p, { trail: 'seasons' }).journey).toEqual([15, 16, 17]);
    expect(C.createExpedition(p, { trail: 'homecoming' }).journey).toHaveLength(15);
    expect(C.regionUnlocked(p, 15)).toBe(true); expect(C.regionUnlocked(p, 18)).toBe(false);
    p.trails.seasons = 1;
    expect(C.createExpedition(p, { trail: 'unwritten' }).journey).toEqual([18, 19, 20]);
    p.trails.unwritten = 1;
    expect(C.createExpedition(p, { trail: 'tomorrow' }).journey).toEqual([15, 18, 16, 19, 17, 20]);
    expect(C.regionUnlocked(p, 20)).toBe(true); expect(C.regionUnlocked(p, 21)).toBe(false);
    expect(new Set(C.BIOMES.map(b => b.layout)).size).toBe(21);
    expect(C.GUARDIANS).toHaveLength(6);
  });

  test('180 new mazes keep objectives, optional discoveries, and arenas connected in both realms', () => {
    for (let seed = 0; seed < 30; seed += 1) for (let region = 15; region < 21; region += 1) {
      const map = C.generate(seed, region);
      expect(map.w * map.h).toBeLessThanOrEqual(1505); expect(map.enemies.length).toBeLessThanOrEqual(9);
      expect(new Set(map.entities.map(e => `${e.x},${e.y}`)).size).toBe(map.entities.length);
      expect(map.entities.filter(e => e.type === 'vaultkey').map(e => e.phase)).toEqual([0, 1]);
      for (const type of ['vault', 'wishbed']) expect(map.entities.filter(e => e.type === type)).toHaveLength(1);
      for (const phase of [0, 1]) {
        const field = C.distances(map, { x: 3, y: 3 }, phase);
        map.entities.forEach(e => expect(field[e.y * map.w + e.x]).toBeGreaterThanOrEqual(0));
        if (map.arena) {
          expect(map.enemies.every(e => Math.abs(e.x - map.arena.x) > 5 || Math.abs(e.y - map.arena.y) > 5)).toBe(true);
          for (let y = map.arena.y - 5; y <= map.arena.y + 5; y += 1) for (let x = map.arena.x - 5; x <= map.arena.x + 5; x += 1) expect(field[y * map.w + x]).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  test('the 36 new memories and 18 relics can all be discovered in three visits without rare drops', () => {
    const memories = [], relics = [];
    for (let visit = 0; visit < 3; visit += 1) {
      const game = new C.Game({ seed: visit + 81, trail: 'tomorrow', knownMemories: memories, knownRelics: relics });
      for (const entry of game.plan) {
        expect(entry.memories.every(id => id >= 90 && id < 126)).toBe(true);
        expect(relics).not.toContain(entry.relic); memories.push(...entry.memories); relics.push(entry.relic);
      }
    }
    expect(new Set(memories).size).toBe(36); expect(new Set(relics).size).toBe(18);
  });

  test('realm keys require their own worlds, persist, and open a vault only once', () => {
    const game = new C.Game({ seed: 5, trail: 'survey', region: 19 });
    game.map.enemies.forEach(e => { e.hp = 0; });
    const keys = game.map.entities.filter(e => e.type === 'vaultkey'), vault = game.map.entities.find(e => e.type === 'vault');
    place(game, vault); expect(game.act('interact')).toBe(false);
    place(game, keys[1]); game.collect(); expect(keys[1].done).toBe(false);
    expect(game.act('shift')).toBe(true); expect(keys[1].done).toBe(true); expect(game.vaultKeys()).toBe(1);
    place(game, keys[0]); game.phase = 0; game.collect(); expect(game.vaultKeys()).toBe(2);
    const loaded = C.Game.restore(game.snapshot()); expect(loaded.vaultKeys()).toBe(2);
    place(loaded, vault); const light = loaded.light, bombs = loaded.inventory.bomb;
    expect(loaded.act('interact')).toBe(true); expect(loaded.light).toBe(light + 24); expect(loaded.inventory.bomb).toBe(bombs + 2);
    expect(loaded.vaults).toEqual([19]); expect(loaded.act('interact')).toBe(false);
    const p = C.profile(); C.syncDiscoveries(p, loaded); C.syncDiscoveries(p, loaded); expect(p.vaults).toEqual([19]);
    expect(C.Game.restore(loaded.snapshot()).map.entities.find(e => e.type === 'vault').done).toBe(true);
  });

  test('wishbeds charge once, grow only with walking, survive a save, and yield one harvest', () => {
    const game = new C.Game({ seed: 9, trail: 'survey', region: 18 });
    game.map.enemies.forEach(e => { e.hp = 0; });
    const bed = game.map.entities.find(e => e.type === 'wishbed'); place(game, bed);
    expect(game.act('interact')).toBe(false); game.light = 4;
    expect(game.act('interact')).toBe(true); expect(game.light).toBe(0); expect(bed.progress).toBe(0);
    for (let i = 0; i < 30; i += 1) { game.act('wait'); advance(game, .1); }
    expect(bed.progress).toBe(0);
    const direction = C.DIRS.findIndex(([dx, dy]) => C.walkable(game.map, bed.x + dx, bed.y + dy));
    for (let i = 0; i < 12; i += 1) { expect(game.act('move', direction)).toBe(true); expect(game.act('move', (direction + 2) % 4)).toBe(true); }
    expect(bed.progress).toBe(24); expect(game.events.some(e => e.type === 'gardenReady')).toBe(true);
    const loaded = C.Game.restore(game.snapshot()); expect(loaded).not.toBeNull(); place(loaded, bed);
    loaded.player.hp = 2; loaded.focus = 0; const light = loaded.light;
    expect(loaded.act('interact')).toBe(true); expect(loaded.player.hp).toBe(5); expect(loaded.focus).toBe(loaded.stats().maxFocus);
    expect(loaded.light).toBe(light + 5); expect(loaded.act('interact')).toBe(false);
    expect(C.Game.restore(loaded.snapshot()).map.entities.find(e => e.type === 'wishbed').done).toBe(true);
  });

  test.each(['seasons', 'unwritten', 'tomorrow'])('%s completes with normal timed input and no camp upgrades', trail => {
    for (const seed of [1947, 3261]) {
      const game = new C.Game({ seed, trail }); expect(finishExpedition(game, C)).toBe('won');
      expect(game.depth).toBe(game.journey.length - 1);
      game.journey.filter(r => C.BIOMES[r].guardian).forEach(r => expect(game.guardianWins[C.BIOMES[r].guardian]).toBe(1));
    }
  });
});

describe('Two-strike guardian encounters', () => {
  test.each([15, 17, 20])('guardian %i commits both strikes, damages an idle keeper, then opens its heart', region => {
    const game = arena(region), boss = game.boss;
    expect(boss.beats).toBe(2); expect(boss.followup.length).toBeGreaterThan(0);
    place(game, boss.intent[0]); game.shield = 0;
    const next = boss.followup.map(p => ({ ...p })), hp = game.player.hp;
    game.act('attack'); game.act('bomb'); game.act('art'); game.act('shift');
    expect(boss.followup).toEqual(next); expect(boss.mode).toBe('windup');
    advance(game, boss.timer + .02); expect(game.player.hp).toBe(hp - 2);
    expect(boss.beat).toBe(2); expect(boss.mode).toBe('windup'); expect(boss.intent).toEqual(next);
    place(game, boss.intent[0]); advance(game, boss.timer + .02);
    expect(game.player.hp).toBe(hp - 4); expect(boss.mode).toBe('recovery');
    const before = boss.hp; game.hit(boss, 1); expect(boss.hp).toBe(before - 2);
  });

  test.each([15, 17, 20])('guardian %i leaves safe ground and preserves both strikes through a save', region => {
    const game = arena(region);
    const restored = C.Game.restore(game.snapshot()); expect(restored.snapshot()).toEqual(game.snapshot());
    for (let tick = 0; tick < 400; tick += 1) {
      if (game.boss.state === 'active' && game.boss.mode === 'windup') {
        expect(game.boss.intent.length).toBeLessThan(120); expect(game.boss.followup.length).toBeLessThan(120);
      }
      advance(game, .05); advance(restored, .05);
      if (tick % 12 === 0) { game.act('guard'); restored.act('guard'); }
      expect(restored.snapshot()).toEqual(game.snapshot());
    }
  });

  test('the Warden changes realms between strikes and the preview names the second realm', () => {
    const game = arena(17); game.boss.cycle = 2; game.boss.timer = 0; game.boss.mode = 'rest'; advance(game, .05);
    expect(game.boss.realm).toBe(0); expect(game.boss.followupRealm).toBe(1);
    place(game, game.boss.intent[0]); game.phase = 1; game.shield = 0; const hp = game.player.hp;
    advance(game, game.boss.timer + .02); expect(game.player.hp).toBe(hp); expect(game.boss.realm).toBe(1);
    place(game, game.boss.intent[0]); advance(game, game.boss.timer + .02); expect(game.player.hp).toBe(hp - 2);
  });

  test.each([15, 17, 20])('guardian %i can be defeated at all three tiers through ordinary inputs', region => {
    for (let tier = 1; tier <= 3; tier += 1) {
      const game = new C.Game({ seed: 1947, trail: 'trial', region, tier }); expect(finishExpedition(game, C)).toBe('won');
      expect(game.guardianWins[game.biome.guardian]).toBe(tier); expect(game.records.every(r => !r.clears && !r.explored)).toBe(true);
      const p = C.profile(); C.bankExpedition(p, game);
      const spec = C.GUARDIANS.find(b => b.region === region); expect(C.artUnlocked(p, spec.art)).toBe(true);
      expect(game.guardianReward).toBe(40 * tier);
    }
  });

  test('guardian gifts change the equipped actions and daily journeys still standardize equipment', () => {
    const p = C.profile({ guardians: { honeyregent: 1, resonantwarden: 1, nightgardener: 1 }, upgrades: { focus: 1 } });
    for (const [art, charm] of [['nectar', 'amber'], ['resonance', 'chime'], ['afterglow', 'twilight']]) {
      expect(C.artUnlocked(p, art)).toBe(true); expect(C.charmUnlocked(p, charm)).toBe(true);
      p.selectedArt = art; p.selectedCharm = charm;
      const game = C.createExpedition(p, { seed: 5 }); game.player.hp = 3; game.focus = game.stats().maxFocus;
      expect(game.act('art')).toBe(true);
      if (charm === 'amber') { game.focus = 0; game.act('medicine'); expect(game.focus).toBe(2); expect(game.shield).toBe(1); }
      if (charm === 'chime') { game.act('guard'); expect(game.cooldowns.guard).toBe(2.56); }
      if (charm === 'twilight') { game.act('shift'); expect(game.cooldowns.shift).toBe(3.2); expect(game.shield).toBeGreaterThanOrEqual(.7); }
      const daily = C.createExpedition(p, { seed: 5, daily: true }); expect(daily.art).toBe('gust'); expect(daily.charm).toBe('none');
    }
  });
});

describe('Unwritten Seasons save compatibility and validation', () => {
  test('all fifteen previous maps retain their fingerprints and an active version-three boss resumes', () => {
    previous.digests.forEach((digest, region) => expect(createHash('sha256').update(JSON.stringify(C.generate(73619, region, { generator: 3 }))).digest('hex')).toBe(digest));
    const loaded = C.readSave(JSON.stringify(previous.save));
    expect(loaded.invalid).toBe(false); expect(loaded.migrated).toBe(true); expect(loaded.game.generator).toBe(3);
    expect(loaded.profile.light).toBe(341); expect(loaded.game.boss).toMatchObject(previous.save.run.boss);
    expect(loaded.profile.guardians.honeyregent).toBe(0); expect(loaded.profile.vaults).toEqual([]);
    expect(C.Game.restore(loaded.game.snapshot()).snapshot()).toEqual(loaded.game.snapshot());
    const daily = new C.Game({ seed: 769, daily: true, generator: 3 });
    expect(daily.journey).toEqual([769 % 5, 5 + (769 >>> 8) % 5, 10 + (769 >>> 16) % 5]);
    expect(C.Game.restore(daily.snapshot()).journey).toEqual(daily.journey);
    expect(new C.Game({ seed: 769, daily: true }).journey).toEqual([769 % 7, 7 + (769 >>> 8) % 7, 14 + (769 >>> 16) % 7]);
  });

  test('corrupt follow-up attacks and impossible optional discoveries cannot be restored', () => {
    const game = arena();
    for (const corrupt of [s => { s.boss.followup = Array(122).fill({ x: 8, y: 8 }); }, s => { s.boss.followup[0].x = -1; }, s => { s.boss.followupRealm = 3; }, s => { s.boss.beat = 9; }, s => { s.boss.followup = []; }, s => { s.boss.beats = 500; }]) {
      const saved = JSON.parse(JSON.stringify(game.snapshot())); corrupt(saved); expect(C.Game.restore(saved)).toBeNull();
    }
    const maze = new C.Game({ seed: 4, trail: 'survey', region: 18 });
    for (const corrupt of [s => { s.entities.find(e => e.id === maze.map.entities.find(e => e.type === 'wishbed').id).progress = 999; }, s => { s.entities.find(e => e.id === maze.map.entities.find(e => e.type === 'vault').id).done = true; }, s => { s.generator = 3; }]) {
      const saved = JSON.parse(JSON.stringify(maze.snapshot())); corrupt(saved); expect(C.Game.restore(saved)).toBeNull();
    }
    expect(C.profile({ vaults: [0, 15, 15, 20, 21, '__proto__'] }).vaults).toEqual([15, 20]);
  });
});
