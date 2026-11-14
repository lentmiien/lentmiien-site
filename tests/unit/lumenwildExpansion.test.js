const C = require('../../games/lumenwild/js/core');
const { createHash } = require('node:crypto');
const fixture = require('../fixtures/lumenwild/version-one.json');
const { advance, finishExpedition } = require('../helpers/lumenwildPilot');

function activate(game, landmark) {
  game.map.enemies.forEach(e => { e.hp = 0; });
  Object.assign(game.player, { x: landmark.x, y: landmark.y });
  game.phase = landmark.phase;
  return game.act('interact');
}

describe('Lumenwild exploration and long-term progression', () => {
  test('preserves original journal IDs and distributes 54 pages and 27 relics without overlap', () => {
    expect(C.MEMORIES).toHaveLength(54); expect(C.RELICS).toHaveLength(27);
    expect(new Set(C.BIOMES.flatMap(b => b.memories)).size).toBe(54);
    expect(C.MEMORIES[0][0]).toBe('A light left on');
    expect(C.UPGRADES.reduce((sum, u) => sum + u.costs.length, 0)).toBe(27);
    expect(C.ARTS).toHaveLength(6); expect(C.BLESSINGS).toHaveLength(16);
  });

  test('new visits prefer unknown pages and relics, and the chosen discoveries survive a save', () => {
    const knownMemories = [], knownRelics = [];
    for (let visit = 0; visit < 3; visit += 1) {
      const game = new C.Game({ seed: 90 + visit, trail: 'pilgrimage', knownMemories, knownRelics });
      game.plan.forEach(p => {
        if (visit < 2) expect(p.memories.every(id => !knownMemories.includes(id))).toBe(true);
        expect(knownRelics).not.toContain(p.relic);
        knownMemories.push(...p.memories); knownRelics.push(p.relic);
      });
      expect(C.Game.restore(game.snapshot()).plan).toEqual(game.plan);
    }
    expect(new Set(knownMemories).size).toBe(54); expect(new Set(knownRelics).size).toBe(27);
  });

  test('chapters unlock in sequence, with separate regional revisits and optional challenge tiers', () => {
    const p = C.profile();
    expect(C.createExpedition(p, { seed: 3, trail: 'frontier' })).toBeNull();
    expect(C.createExpedition(p, { seed: 3, trail: 'survey', region: 7 })).toBeNull();
    p.trails.dawn = 1;
    expect(C.createExpedition(p, { seed: 3, trail: 'frontier' }).journey).toEqual([3, 4, 5]);
    expect(C.trailUnlocked(p, 'horizon')).toBe(false);
    expect(C.createExpedition(p, { seed: 3, trail: 'survey', region: 3, tier: 3 }).tier).toBe(1);
    p.regions[3].clears = 1;
    expect(C.createExpedition(p, { seed: 3, trail: 'survey', region: 3, tier: 3 }).tier).toBe(3);
    p.trails.frontier = 1; p.trails.horizon = 1;
    expect(C.createExpedition(p, { seed: 3, trail: 'pilgrimage' }).journey).toHaveLength(9);
  });

  test('survey medals require exploration, collections, secrets, and repeated completed visits', () => {
    const p = C.profile(); p.regions[0].clears = 1;
    expect(C.medal(p, 0)).toBe(1);
    p.regions[0].clears = 2; p.regions[0].explored = 65;
    p.memories = C.BIOMES[0].memories.slice(0, 4); p.relics = [0, 1]; expect(C.medal(p, 0)).toBe(2);
    p.regions[0] = { clears: 3, explored: 85, landmark: false }; p.memories = C.BIOMES[0].memories.slice(); p.relics = [0, 1, 2];
    expect(C.medal(p, 0)).toBe(2); p.regions[0].landmark = true; expect(C.medal(p, 0)).toBe(3);
  });

  test('finishing a chapter selects the newly opened chapter at camp', () => {
    const p = C.profile(), game = new C.Game({ seed: 1 });
    game.status = 'won'; C.bankExpedition(p, game);
    expect(p.trails.dawn).toBe(1); expect(p.selectedTrail).toBe('frontier');
    expect(C.createExpedition(p, { seed: 2 }).journey).toEqual([3, 4, 5]);
  });

  test('medal rewards and expedition banking are idempotent even when discoveries sync before return', () => {
    const p = C.profile(), game = new C.Game({ seed: 29 });
    p.regions[0] = { clears: 2, explored: 75, landmark: false };
    p.memories = C.BIOMES[0].memories.slice(0, 3); p.relics = [0, 1]; p.medalAwards = 1;
    game.memories.push(C.BIOMES[0].memories[3]); game.light = 12; game.status = 'returned';
    C.syncDiscoveries(p, game); expect(C.medal(p, 0)).toBe(2);
    expect(C.bankExpedition(p, game)).toBe(true); expect(p.light).toBe(37); expect(game.medalReward).toBe(25);
    const saved = C.writeSave(p, game); expect(C.bankExpedition(p, game)).toBe(false); expect(C.writeSave(p, game)).toBe(saved);
    expect(JSON.parse(saved).run).toBeNull();
  });

  test('higher upgrade levels require medals and stop at their documented caps', () => {
    const p = C.profile({ light: 99999, upgrades: { hearth: 3 } });
    expect(C.buyUpgrade(p, 'hearth')).toBe(false);
    p.regions.forEach(record => { record.clears = 3; record.explored = 100; record.landmark = true; });
    p.memories = C.MEMORIES.map((_, i) => i); p.relics = C.RELICS.map(r => r.id);
    for (const upgrade of C.UPGRADES) {
      while (p.upgrades[upgrade.id] < upgrade.costs.length) expect(C.buyUpgrade(p, upgrade.id)).toBe(true);
      expect(C.buyUpgrade(p, upgrade.id)).toBe(false);
    }
  });

  test('each art has a meaningful persistent discovery milestone', () => {
    const p = C.profile(); expect(C.ARTS.filter(a => C.artUnlocked(p, a.id)).map(a => a.id)).toEqual(['gust']);
    p.relics = Array.from({ length: 18 }, (_, i) => i); p.regions[5].clears = 1; p.regions[6].clears = 1; p.regions[7].clears = 1; p.trails.horizon = 1;
    expect(C.ARTS.every(a => C.artUnlocked(p, a.id))).toBe(true);
    expect(C.artUnlocked(p, '__proto__')).toBe(false);
  });

  test.each([0, 2, 4, 5, 6])('region %s landmarks create permanent shortcuts and restore a secret once', region => {
    const game = new C.Game({ seed: 160, trail: 'survey', region });
    const landmarks = game.map.entities.filter(e => e.type === 'landmark');
    landmarks.forEach(e => expect(activate(game, e)).toBe(true));
    expect(game.opened.length).toBeGreaterThan(0);
    game.opened.forEach(i => { expect(C.walkable(game.map, i % game.map.w, Math.floor(i / game.map.w), 0)).toBe(true); expect(game.map.tiles[i]).toBe(0); });
    expect(game.records[region].landmark).toBe(true);
    const light = game.light; game.act('interact'); expect(game.light).toBe(light);
    const restored = C.Game.restore(game.snapshot());
    expect(restored.opened).toEqual(game.opened); expect(restored.map.tiles).toEqual(game.map.tiles);
  });

  test('memory lenses reveal distant areas, ferries travel safely, and star anchors require order', () => {
    const archive = new C.Game({ seed: 93, trail: 'survey', region: 1 });
    const before = archive.seen.size; activate(archive, archive.map.entities.find(e => e.type === 'landmark')); expect(archive.seen.size).toBeGreaterThan(before);
    const marsh = new C.Game({ seed: 93, trail: 'survey', region: 3 });
    const bells = marsh.map.entities.filter(e => e.type === 'landmark'); activate(marsh, bells[0]); marsh.act('interact');
    expect(marsh.player).toMatchObject({ x: bells[1].x, y: bells[1].y });
    const stars = new C.Game({ seed: 93, trail: 'survey', region: 8 });
    const anchors = stars.map.entities.filter(e => e.type === 'landmark');
    expect(activate(stars, anchors[1])).toBe(false); expect(anchors[1].done).toBe(false);
    anchors.forEach(e => expect(activate(stars, e)).toBe(true)); expect(stars.records[8].landmark).toBe(true);
  });

  test('caldera vents hurt in Bloom, Echo is safe, and restoring cooling hearts silences them', () => {
    const game = new C.Game({ seed: 77, trail: 'survey', region: 7 }); game.map.enemies.forEach(e => { e.hp = 0; });
    const vent = game.map.vents[0]; Object.assign(game.player, { x: vent.x, y: vent.y });
    game.shield = 0; vent.timer = .05; game.update(.1); expect(game.player.hp).toBe(6);
    game.phase = 1; game.shield = 0; vent.timer = .05; game.update(.1); expect(game.player.hp).toBe(6);
    game.map.entities.filter(e => e.type === 'landmark').forEach(e => activate(game, e));
    Object.assign(game.player, { x: vent.x, y: vent.y, hp: 6 }); game.phase = 0; game.shield = 0; vent.timer = .05;
    game.update(.1); expect(game.player.hp).toBe(6);
  });

  test.each(['frontier', 'horizon', 'pilgrimage'])('%s is completable through ordinary timed inputs without permanent upgrades', trail => {
    const game = new C.Game({ seed: 1947, trail });
    expect(finishExpedition(game, C)).toBe('won');
    expect(game.depth).toBe(game.journey.length - 1);
    expect(new Set(game.blessings).size).toBe(game.journey.length - 1);
  });
});

describe('Lumenwild versioned saves', () => {
  test('a real v1-format checkpoint retains its exact map, findings, inventory, and old camp', () => {
    const result = C.readSave(JSON.stringify(fixture.save)), old = fixture.save.run;
    expect(result.invalid).toBe(false); expect(result.migrated).toBe(true);
    expect(result.profile).toMatchObject({ light: 161, memories: [0, 1, 2, 3, 4, 5, 6, 7, 8], upgrades: { hearth: 3, satchel: 3, lens: 3 }, trails: { dawn: 2 } });
    expect(C.trailUnlocked(result.profile, 'frontier')).toBe(true);
    const game = result.game;
    expect(game.generator).toBe(1); expect(game.journey).toEqual([0, 1, 2]); expect(game.player).toEqual(old.player);
    expect(game.map.tiles).toEqual(C.generateLegacy(old.seed, old.depth).tiles);
    expect(game.map.entities.map(e => ({ id: e.id, done: e.done, progress: e.progress || 0 }))).toEqual(old.entities);
    expect(game.map.enemies.map(e => ({ x: e.x, y: e.y, hp: e.hp }))).toEqual(old.enemies.map(e => ({ x: e.x, y: e.y, hp: e.hp })));
    const originalMap = C.generateLegacy(old.seed, old.depth);
    originalMap.entities.forEach((e, i) => { e.done = old.entities[i].done; if (e.type === 'shrine') e.progress = old.entities[i].progress; });
    originalMap.enemies.forEach((e, i) => Object.assign(e, old.enemies[i]));
    expect(createHash('sha256').update(JSON.stringify(originalMap)).digest('hex')).toBe(fixture.mapDigest);
    expect(game.inventory).toEqual(old.inventory);
    const v2 = C.readSave(C.writeSave(result.profile, game)); expect(v2.invalid).toBe(false); expect(v2.game.snapshot()).toEqual(game.snapshot());
    expect(C.createExpedition(result.profile, { seed: 91, trail: 'frontier' }).generator).toBe(2);
  });

  test('nine-region progress, chosen discoveries, art, timers, and future combat restore deterministically', () => {
    const original = new C.Game({ seed: 913, trail: 'pilgrimage', art: 'snare', upgrades: { focus: 2 } });
    for (let i = 0; i < 6; i += 1) {
      original.map.entities.filter(e => e.type === 'seed').forEach(e => { e.done = true; }); original.seeds = 3;
      original.act('interact'); original.chooseBlessing(original.choices()[0].id);
    }
    original.act('move', 1); original.act('guard'); advance(original, .2);
    const restored = C.Game.restore(original.snapshot()); expect(restored.snapshot()).toEqual(original.snapshot());
    for (const action of ['attack', 'shift', 'art', 'dash', 'thread']) {
      advance(original, .21); advance(restored, .21); original.act(action); restored.act(action);
      expect(restored.snapshot()).toEqual(original.snapshot());
    }
  });

  test('save validation rejects corrupt plans, routes, shortcuts and oversized attack footprints', () => {
    const game = new C.Game({ seed: 44 });
    for (const change of [
      s => { s.plan[0].memories = [0, 0, 0]; }, s => { s.plan[0].relic = 26; }, s => { s.plan = Array(100).fill({}); },
      s => { s.trail = '__proto__'; }, s => { s.generator = 99; }, s => { s.opened = [0]; },
      s => { s.enemies[0].intent = Array(17).fill({ x: 3, y: 3 }); }, s => { s.depth = 8; },
    ]) { const s = JSON.parse(JSON.stringify(game.snapshot())); change(s); expect(C.Game.restore(s)).toBeNull(); }
    const bounded = game.snapshot(); bounded.focus = 1e20; bounded.cooldowns.art = -999; bounded.elapsed = Infinity;
    const restored = C.Game.restore(bounded); expect(restored.focus).toBe(restored.stats().maxFocus); expect(restored.cooldowns.art).toBe(0); expect(restored.elapsed).toBe(0);
  });

  test('daily routes and hidden finds are independent of a player’s collection and equipped art', () => {
    const seed = C.hash('lumenwild:2026-11-14');
    const a = new C.Game({ seed, daily: true, knownMemories: [0, 1, 2], knownRelics: [0], art: 'stars', tier: 3 });
    const b = new C.Game({ seed, daily: true }); expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.journey).toHaveLength(3); expect(a.journey[1]).toBeGreaterThanOrEqual(3); expect(a.journey[2]).toBeGreaterThanOrEqual(6);
  });
});
