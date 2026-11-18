const { createHash } = require('node:crypto');
const C = require('../../games/lumenwild/js/core');
const previous = require('../fixtures/lumenwild/version-four.json');
const { advance, finishExpedition } = require('../helpers/lumenwildPilot');

const completeProfile = () => C.profile({
  runs: 1, rescues: 3, memories: C.MEMORIES.map((_, i) => i), relics: C.RELICS.map(r => r.id),
  trails: Object.fromEntries(C.TRAILS.map(t => [t.id, 1])),
  guardians: Object.fromEntries(C.GUARDIANS.filter(b => !b.hidden).map(b => [b.id, 1])),
  regions: C.BIOMES.map(() => ({ clears: 1 })),
  upgrades: Object.fromEntries(C.UPGRADES.map(u => [u.id, u.costs.length])),
  selectedArt: 'firstlight', selectedCharm: 'keeper', gentle: true,
});
function arena(hidden = true, options = {}) {
  const game = hidden ? C.createExpedition(completeProfile(), { trail: 'secret', seed: 1947, ...options }) : new C.Game({ trail: 'trial', region: 22, seed: 1947, ...options });
  Object.assign(game.player, game.map.arena.entry);
  expect(game.startBoss()).toBe(true); advance(game, 1.5); return game;
}
const copy = value => JSON.parse(JSON.stringify(value));

describe('The Returning Light', () => {
  test('the two-region final chapter opens after Unwritten Sky and takes priority over the optional marathon', () => {
    const p = C.profile({ selectedTrail: 'unwritten', trails: { seasons: 1 } });
    expect(C.createExpedition(p, { trail: 'finale' })).toBeNull();
    expect(C.regionUnlocked(p, 21)).toBe(false);
    const game = new C.Game({ trail: 'unwritten', seed: 1947 });
    expect(finishExpedition(game, C)).toBe('won'); C.bankExpedition(p, game);
    expect(p.selectedTrail).toBe('finale');
    expect(C.createExpedition(p, { trail: 'finale' }).journey).toEqual([21, 22]);
    expect([21, 22].every(r => C.regionUnlocked(p, r))).toBe(true);
    expect(C.regionUnlocked(p, 23)).toBe(false);
    expect(C.BIOMES).toHaveLength(23); expect(C.MEMORIES).toHaveLength(138); expect(C.RELICS).toHaveLength(69);
  });

  test('both final layouts keep objectives, optional features and the arena connected across 40 seeds', () => {
    for (let seed = 0; seed < 40; seed += 1) for (const region of [21, 22]) {
      const map = C.generate(seed, region);
      expect(map.w * map.h).toBeLessThanOrEqual(1505); expect(map.enemies.length).toBeLessThanOrEqual(8);
      expect(new Set(map.entities.map(e => `${e.x},${e.y}`)).size).toBe(map.entities.length);
      expect(map.entities.filter(e => e.type === 'vaultkey').map(e => e.phase)).toEqual([0, 1]);
      for (const phase of [0, 1]) {
        const field = C.distances(map, { x: 3, y: 3 }, phase);
        expect(map.entities.every(e => field[e.y * map.w + e.x] >= 0)).toBe(true);
        if (map.arena) {
          for (let y = map.arena.y - 5; y <= map.arena.y + 5; y += 1) for (let x = map.arena.x - 5; x <= map.arena.x + 5; x += 1) expect(field[y * map.w + x]).toBeGreaterThanOrEqual(0);
          expect(map.enemies.every(e => Math.max(Math.abs(e.x - map.arena.x), Math.abs(e.y - map.arena.y)) > 5)).toBe(true);
        }
      }
    }
  });

  test('all twelve new memories and six relics appear in three visits; hidden stage adds no required finds', () => {
    const memories = [], relics = [];
    for (let visit = 0; visit < 3; visit += 1) {
      const game = new C.Game({ seed: visit + 7, trail: 'finale', knownMemories: memories, knownRelics: relics });
      for (const plan of game.plan) {
        expect(relics).not.toContain(plan.relic); memories.push(...plan.memories); relics.push(plan.relic);
      }
    }
    expect(new Set(memories).size).toBe(12); expect(new Set(relics).size).toBe(6);
    const hidden = C.createExpedition(completeProfile(), { trail: 'secret' });
    expect(hidden.map.entities.every(e => !['memory', 'relic', 'seed'].includes(e.type))).toBe(true);
  });

  test('heart blossoms require their order and realm; homeward beacons open permanent shortcuts', () => {
    for (const region of [21, 22]) {
      const game = new C.Game({ trail: 'survey', region, seed: 6 });
      const marks = game.map.entities.filter(e => e.type === 'landmark');
      if (region === 22) { game.phase = marks[1].phase; expect(game.useLandmark(marks[1])).toBe(false); }
      for (const mark of marks) {
        game.phase = 1 - mark.phase; expect(game.useLandmark(mark)).toBe(false);
        game.phase = mark.phase; expect(game.useLandmark(mark)).toBe(true);
      }
      expect(game.records[region].landmark).toBe(true); expect(game.opened.length).toBeGreaterThan(0);
      const restored = C.Game.restore(game.snapshot()); expect(restored.records[region].landmark).toBe(true);
    }
  });

  test.each([1947, 3261])('final chapter and ending record complete with normal inputs and starter equipment, seed %i', seed => {
    const game = new C.Game({ trail: 'finale', seed });
    expect(finishExpedition(game, C)).toBe('won');
    const p = C.profile(); expect(C.bankExpedition(p, game)).toBe(true);
    expect(p.trails.finale).toBe(1); expect(p.guardians.firstkeeper).toBe(1);
    expect(C.artUnlocked(p, 'firstlight')).toBe(true); expect(C.charmUnlocked(p, 'keeper')).toBe(true);
    const saved = C.writeSave(p, game); expect(C.bankExpedition(p, game)).toBe(false); expect(C.writeSave(p, game)).toBe(saved);
  });

  test.each([1, 2, 3])('First Keeper trial tier %i is beatable through ordinary timed inputs', tier => {
    const game = new C.Game({ trail: 'trial', region: 22, tier, seed: 1947 });
    expect(finishExpedition(game, C)).toBe('won'); expect(game.guardianWins.firstkeeper).toBe(tier);
    expect(game.records.every(r => !r.clears && !r.explored)).toBe(true);
  });

  test('First light resets movement abilities and the home lantern extends only open-heart sweeps', () => {
    const game = arena(false, { art: 'firstlight', charm: 'keeper', upgrades: { focus: 5 } });
    expect(game.stats().reach).toBe(1);
    game.boss.mode = 'recovery'; game.boss.timer = 2;
    Object.assign(game.player, { x: game.boss.x, y: game.boss.y + 3 }); game.reveal();
    expect(game.stats().reach).toBe(2); const hp = game.boss.hp;
    game.cooldowns.dash = 2; game.cooldowns.shift = 3;
    expect(game.act('art')).toBe(true); expect(game.boss.hp).toBe(hp - 12);
    expect(game.cooldowns.dash).toBe(0); expect(game.cooldowns.shift).toBe(0);
  });
});

describe('The hidden collection gate', () => {
  test('requires every permanent collectible, but no medals, upgrade levels, vaults or hidden reward', () => {
    const p = completeProfile(); p.upgrades = C.profile().upgrades; p.vaults = [];
    expect(p.guardians.hollowstar).toBe(0); expect(C.secretUnlocked(p)).toBe(true);
    expect(C.collectionProgress(p).groups.map(g => [g.found, g.total])).toEqual([[138, 138], [69, 69], [13, 13], [8, 8]]);
    expect(C.createExpedition(p, { trail: 'secret' }).boss.id).toBe('hollowstar');
  });

  test.each(['memory', 'relic', 'art', 'charm'])('one missing %s closes launch and saved-run entry, even with duplicate IDs', missing => {
    const p = completeProfile(), run = C.createExpedition(p, { trail: 'secret' });
    if (missing === 'memory') { p.memories.pop(); p.memories.push(0); }
    if (missing === 'relic') { p.relics.pop(); p.relics.push(0); }
    if (missing === 'art') p.trails.horizon = 0;
    if (missing === 'charm') p.rescues = 2;
    expect(C.secretUnlocked(p)).toBe(false); expect(C.createExpedition(p, { trail: 'secret' })).toBeNull();
    const load = C.readSave(C.writeSave(p, run)); expect(load.invalid).toBe(true); expect(load.game).toBeNull();
    expect(load.profile.runs).toBe(1);
  });

  test('cannot enter through an ordinary survey, trial, daily route or an unknown region', () => {
    const p = completeProfile();
    for (const options of [{ trail: 'survey', region: 23 }, { trail: 'trial', region: null }, { trail: 'trial', region: 23 }, { trail: 'secret', daily: true }]) expect(C.createExpedition(p, options)).toBeNull();
    for (let seed = 0; seed < 100; seed += 1) {
      const game = C.createExpedition(p, { daily: true, seed: seed * 100003 });
      expect(game.journey.every(r => r >= 0 && r < 23)).toBe(true); expect(game.boss?.id).not.toBe('hollowstar');
    }
  });

  test('keeps the selected equipment and camp upgrades, fixes difficulty and limits supplies including on retry', () => {
    const p = completeProfile(), game = C.createExpedition(p, { trail: 'secret', tier: 3, generator: 4 });
    expect(game.gentle).toBe(false); expect(game.tier).toBe(1); expect(game.generator).toBe(5);
    expect(game.upgrades).toEqual(p.upgrades); expect(game.art).toBe('firstlight'); expect(game.charm).toBe('keeper');
    expect(game.inventory).toEqual({ medicine: 2, bomb: 2, thread: 0 });
    Object.assign(game.player, game.map.arena.entry); game.startBoss();
    game.act('bomb'); game.player.hp = 1; game.shield = 0; game.hurt(4, game.boss);
    expect(game.boss.state).toBe('sleeping'); expect(game.player.hp).toBe(game.stats().maxHp);
    expect(game.inventory).toEqual({ medicine: 2, bomb: 2, thread: 0 });
  });
});

describe('Final guardian patterns and mastery', () => {
  test.each([false, true])('commits all strikes without cancellation, deals real idle damage and then opens (hidden %s)', hidden => {
    const game = arena(hidden), boss = game.boss, beats = hidden ? 4 : 3;
    const planned = [boss.intent, boss.followup, ...boss.queue.map(s => s.cells)].map(copy);
    expect(boss.beats).toBe(beats); expect(boss.queue).toHaveLength(beats - 2);
    for (let beat = 1; beat <= beats; beat += 1) {
      expect(boss.mode).toBe('windup'); expect(boss.beat).toBe(beat); expect(boss.intent).toEqual(planned[beat - 1]);
      Object.assign(game.player, boss.intent[0]); game.shield = 0;
      if (!hidden) game.player.hp = game.stats().maxHp;
      const hp = game.player.hp; game.act('attack'); game.act('art');
      expect(boss.intent).toEqual(planned[beat - 1]); advance(game, boss.timer + .01);
      expect(game.player.hp).toBe(hp - (hidden ? 3 : 2));
    }
    expect(boss.mode).toBe('recovery'); expect(boss.queue).toEqual([]);
    const hp = boss.hp; game.hit(boss, 1); expect(boss.hp).toBe(hp - 2);
  });

  test('every phase and pattern leaves safe terrain and realm previews stay independent', () => {
    for (const hidden of [false, true]) for (let stage = 1; stage <= (hidden ? 4 : 3); stage += 1) for (let pattern = 0; pattern < 3; pattern += 1) {
      const game = arena(hidden), boss = game.boss;
      boss.hp = Math.ceil(boss.maxHp * (1 - (stage - 1) / (hidden ? 4 : 3)));
      boss.stage = stage; boss.cycle = pattern; boss.mode = 'rest'; boss.timer = 0;
      advance(game, .05);
      for (const cells of [boss.intent, boss.followup, ...boss.queue.map(s => s.cells)]) {
        expect(cells.length).toBeGreaterThan(0); expect(cells.length).toBeLessThan(120);
        expect(cells.every(p => Math.max(Math.abs(p.x - game.map.arena.x), Math.abs(p.y - game.map.arena.y)) <= 5)).toBe(true);
      }
      if (pattern === 2) { expect(boss.realm).toBe(0); expect(boss.followupRealm).toBe(1); expect(boss.queue.every(s => s.realm === -1)).toBe(true); }
    }
  });

  test('the hidden heart rejects every damage source before the opening and its final phase hits for four', () => {
    const game = arena(), boss = game.boss;
    Object.assign(game.player, { x: boss.x, y: boss.y + 1 }); game.reveal();
    const hp = boss.hp, pattern = copy(boss.intent);
    game.act('attack'); game.act('bomb'); game.act('art'); game.hit(boss, 999);
    expect(boss.hp).toBe(hp); expect(boss.intent).toEqual(pattern);
    boss.stage = 4; boss.hp = 38;
    Object.assign(game.player, boss.intent[0]); game.shield = 0; const playerHp = game.player.hp;
    advance(game, boss.timer + .01); expect(game.player.hp).toBe(playerHp - 4);
  });

  test('hidden warnings and openings are shorter than the toughest ordinary guardian', () => {
    const hidden = arena(), normal = arena(false, { tier: 3 });
    expect(hidden.boss.maxHp).toBeGreaterThan(normal.boss.maxHp * 1.7);
    expect(hidden.boss.total).toBeLessThan(normal.boss.total);
    for (const game of [hidden, normal]) {
      // Safely observe one full sequence without changing timers or footprints.
      while (game.boss.mode === 'windup') {
        const a = game.map.arena;
        const safe = Array.from({ length: 121 }, (_, i) => ({ x: a.x - 5 + i % 11, y: a.y - 5 + Math.floor(i / 11) })).find(p => !(p.x === game.boss.x && p.y === game.boss.y) && !game.boss.intent.some(c => c.x === p.x && c.y === p.y));
        Object.assign(game.player, safe); advance(game, game.boss.timer + .001);
      }
    }
    expect(hidden.boss.total).toBeLessThan(normal.boss.total * .6);
  });

  test('standing and attacking cannot win the secret, but an equipped keeper can beat all four phases with ordinary inputs', () => {
    const idle = arena(); Object.assign(idle.player, { x: idle.boss.x, y: idle.boss.y + 1 });
    for (let i = 0; i < 500 && idle.boss.state === 'active'; i += 1) { advance(idle, .16); idle.act('attack'); }
    expect(idle.boss.state).toBe('sleeping'); expect(idle.guardianWins.hollowstar).toBe(0);
    const p = completeProfile(), game = C.createExpedition(p, { trail: 'secret', seed: 1947 });
    expect(finishExpedition(game, C)).toBe('won'); expect(game.boss.stage).toBe(4);
    expect(game.boss.elapsed).toBeGreaterThan(80); expect(game.records.every(r => !r.clears && !r.explored)).toBe(true);
    const before = C.guardianMedals(p), light = p.light;
    expect(C.bankExpedition(p, game)).toBe(true); expect(p.guardians.hollowstar).toBe(1);
    expect(p.mastery).toEqual({ clears: 1, bestTime: game.boss.elapsed, bestHits: game.boss.hitsTaken });
    expect(C.guardianMedals(p)).toBe(before); expect(p.light).toBeGreaterThanOrEqual(light + 120);
    const first = C.writeSave(p, null); expect(C.bankExpedition(p, game)).toBe(false); expect(C.writeSave(p, null)).toBe(first);
    expect(C.readSave(first).profile.mastery).toEqual(p.mastery);
  });
});

describe('Version five checkpoints', () => {
  test('all 21 previous generator-four maps and daily routes stay unchanged; an active Night Gardener resumes', () => {
    previous.digests.forEach((digest, region) => expect(createHash('sha256').update(JSON.stringify(C.generate(56192, region, { generator: 4 }))).digest('hex')).toBe(digest));
    const result = C.readSave(JSON.stringify(previous.save));
    expect(result.invalid).toBe(false); expect(result.migrated).toBe(true); expect(result.game.boss).toMatchObject(previous.save.run.boss);
    expect(result.profile.light).toBe(528); expect(result.profile.vaults).toEqual([15, 19]);
    expect(C.Game.restore(result.game.snapshot()).snapshot()).toEqual(result.game.snapshot());
    const daily = new C.Game({ seed: 769, daily: true, generator: 4 });
    expect(daily.journey).toEqual([769 % 7, 7 + (769 >>> 8) % 7, 14 + (769 >>> 16) % 7]);
    expect(C.Game.restore(daily.snapshot()).journey).toEqual(daily.journey);
    expect(new C.Game({ seed: 769, daily: true }).journey).toEqual([769 % 8, 8 + (769 >>> 8) % 8, 16 + (769 >>> 16) % 7]);
  });

  test.each([false, true])('queued strikes resume identically on each beat (hidden %s)', hidden => {
    const game = arena(hidden), p = completeProfile();
    for (let beat = 1; beat <= game.boss.beats; beat += 1) {
      const saved = C.writeSave(p, game); expect(saved.length).toBeLessThan(C.MAX_SAVE);
      const loaded = C.readSave(saved); expect(loaded.invalid).toBe(false); expect(loaded.game.snapshot()).toEqual(game.snapshot());
      const restored = loaded.game;
      expect(game.boss.beat).toBe(beat);
      while (game.boss.mode === 'windup' && game.boss.beat === beat) { advance(game, .05); advance(restored, .05); expect(restored.snapshot()).toEqual(game.snapshot()); }
    }
  });

  test('rejects oversized or missing strike queues, invalid phases, hidden difficulty changes and overfilled supplies', () => {
    const game = arena();
    for (const corrupt of [
      s => { s.boss.queue.push(s.boss.queue[0]); }, s => { s.boss.queue = []; }, s => { s.boss.queue[0].cells.push(...Array(122).fill({ x: 1, y: 1 })); },
      s => { s.boss.queue[0].cells[0].x = -1; }, s => { s.boss.queue[0].realm = 2; }, s => { s.boss.stage = 5; }, s => { s.boss.beat = 0; },
      s => { s.generator = 4; }, s => { s.gentle = true; }, s => { s.tier = 2; }, s => { s.daily = true; }, s => { s.surveyRegion = 20; },
      s => { s.inventory.bomb = 3; }, s => { s.boss.kit.medicine = 9; },
    ]) { const saved = copy(game.snapshot()); corrupt(saved); expect(C.Game.restore(saved)).toBeNull(); }
  });
});
