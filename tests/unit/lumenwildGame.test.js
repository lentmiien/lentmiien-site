const C = require('../../games/lumenwild/js/core');

function positionBeside(game, entity) {
  const cell = C.DIRS.map(([dx, dy]) => ({ x: entity.x + dx, y: entity.y + dy }))
    .find(p => C.walkable(game.map, p.x, p.y, game.phase) && !game.enemyAt(p.x, p.y));
  Object.assign(game.player, cell);
  game.map.enemies.forEach(enemy => { enemy.hp = 0; });
  return cell;
}

const { advance, finishExpedition } = require('../helpers/lumenwildPilot');

describe('Lumenwild garden generation', () => {
  test('reproduces a seed while different seeds vary the maze and rewards', () => {
    expect(C.generate(193, 0)).toEqual(C.generate(193, 0));
    expect(C.generate(193, 0).tiles).not.toEqual(C.generate(194, 0).tiles);
    expect(C.generate(193, 0).entities).not.toEqual(C.generate(194, 0).entities);
  });

  test('40 seeds across all nine biomes have connected objectives in both realms and bounded populations', () => {
    for (let seed = 0; seed < 40; seed += 1) {
      for (let depth = 0; depth < 9; depth += 1) {
        const map = C.generate(seed, depth);
        expect(map.entities.filter(e => e.type === 'seed')).toHaveLength(3);
        expect(map.enemies.length).toBeLessThanOrEqual(10);
        expect(new Set(map.entities.map(e => `${e.x},${e.y}`)).size).toBe(map.entities.length);
        expect(map.tiles).toContain(2); expect(map.tiles).toContain(3);
        for (const phase of [0, 1]) {
          const reachable = C.distances(map, { x: 3, y: 3 }, phase);
          for (const entity of map.entities) expect(reachable[entity.y * map.w + entity.x]).toBeGreaterThanOrEqual(0);
        }
        for (let x = 0; x < map.w; x += 1) {
          expect(C.walkable(map, x, 0)).toBe(false);
          expect(C.walkable(map, x, map.h - 1)).toBe(false);
        }
      }
    }
  });

  test('realm-aware routes contain valid adjacent steps and safe shifts', () => {
    const game = new C.Game({ seed: 724 });
    for (const target of game.map.entities.filter(e => e.type === 'seed')) {
      const route = game.route(target);
      expect(route.length).toBeGreaterThan(1);
      expect(route.at(-1)).toMatchObject({ x: target.x, y: target.y });
      if (target.phase !== -1) expect(route.at(-1).phase).toBe(target.phase);
      for (let i = 1; i < route.length; i += 1) {
        const prev = route[i - 1], next = route[i];
        expect(C.walkable(game.map, next.x, next.y, next.phase)).toBe(true);
        expect(C.distance(prev, next)).toBe(prev.phase === next.phase ? 1 : 0);
      }
    }
  });
});

describe('Lumenwild play and combat', () => {
  test('invalid actions and wall bumps cannot advance time, consume supplies, or escape the map', () => {
    const game = new C.Game({ seed: 9 });
    game.player.x = 1; game.player.y = 1;
    const inventory = { ...game.inventory };
    for (const direction of [-1, 4, Infinity, '0', null]) expect(game.act('move', direction)).toBe(false);
    expect(game.act('move', 0)).toBe(false);
    expect(game.act('__proto__')).toBe(false);
    expect(game.act('medicine')).toBe(false);
    expect(game.act('interact')).toBe(false);
    expect(game.turn).toBe(0); expect(game.inventory).toEqual(inventory);
    expect(C.walkable(game.map, -1, 1)).toBe(false);
    expect(C.walkable(game.map, 1.5, 1)).toBe(false);
  });

  test('phase shift opens the other gates but cannot close a tile under the player', () => {
    const game = new C.Game({ seed: 17 });
    const gate = game.map.tiles.indexOf(2);
    const x = gate % game.map.w, y = Math.floor(gate / game.map.w);
    expect(C.walkable(game.map, x, y, 0)).toBe(true);
    expect(C.walkable(game.map, x, y, 1)).toBe(false);
    Object.assign(game.player, { x, y });
    expect(game.act('shift')).toBe(false);
    expect(game.phase).toBe(0); expect(game.turn).toBe(0);
    Object.assign(game.player, { x: 3, y: 3 });
    expect(game.act('shift')).toBe(true); expect(game.phase).toBe(1);
    expect(game.act('shift')).toBe(false);
    advance(game, 4.3); expect(game.act('shift')).toBe(true);
  });

  test('heartseeds require their realm, heal, and cannot be collected twice', () => {
    const game = new C.Game({ seed: 1 });
    const seed = game.map.entities.find(e => e.type === 'seed' && e.phase === 1);
    Object.assign(game.player, { x: seed.x, y: seed.y, hp: 4 });
    game.map.enemies = [];
    game.collect(); expect(game.seeds).toBe(0);
    game.act('shift'); expect(game.seeds).toBe(1); expect(game.player.hp).toBe(5);
    game.collect(); expect(game.seeds).toBe(1); expect(game.light).toBe(4);
    expect(game.nearby()?.type).not.toBe('portal');
  });

  test('one enemy can damage an idle player without any player action', () => {
    const game = new C.Game({ seed: 2 });
    const enemy = { ...game.map.enemies[0], x: 4, y: 3, kind: 0, hp: 3, rest: 0, moveWait: 0 };
    game.map.enemies = [enemy]; game.shield = 0;
    const initial = game.player.hp;
    advance(game, .1);
    expect(enemy.intent).toContainEqual({ x: 3, y: 3 });
    expect(game.player.hp).toBe(initial);
    advance(game, .9);
    expect(game.player.hp).toBe(initial - 1); expect(game.turn).toBe(0);
  });

  test('sweep spam cannot interrupt a committed one-on-one attack; kills award once', () => {
    const game = new C.Game({ seed: 2 });
    const enemy = { ...game.map.enemies[0], x: 4, y: 3, kind: 0, hp: 3, rest: 0 };
    game.map.enemies = [enemy]; game.shield = 0;
    advance(game, .05); const marked = enemy.intent.slice();
    expect(game.act('attack')).toBe(true); expect(enemy.hp).toBe(2); expect(enemy.intent).toEqual(marked);
    expect(game.act('attack')).toBe(false); expect(enemy.hp).toBe(2);
    advance(game, .56); game.act('attack'); expect(enemy.hp).toBe(1);
    advance(game, .35); expect(game.player.hp).toBe(6);
    advance(game, .25); game.act('attack'); expect(game.kills).toBe(1); expect(game.light).toBe(2);
    advance(game, .6); game.act('attack'); expect(game.kills).toBe(1); expect(game.light).toBe(2);
  });

  test('stepping out dodges a locked attack and damage grace prevents simultaneous hits', () => {
    const game = new C.Game({ seed: 2 }); game.shield = 0;
    game.map.enemies = [{ ...game.map.enemies[0], x: 4, y: 3, kind: 0, hp: 3, rest: 0 }];
    advance(game, .1); game.act('move', 3); advance(game, .9);
    expect(game.player.hp).toBe(7);
    game.map.enemies = [0, 1, 2].map(i => ({ ...game.map.enemies[0], id: `foe${i}`, x: 4 + i, kind: 2, hp: 6, intent: [{ x: game.player.x, y: 3 }], windup: .05, stun: 0 }));
    game.map.enemies.forEach(e => { game.map.tiles[e.y * game.map.w + e.x] = 0; });
    advance(game, .1); expect(game.player.hp).toBe(5);
  });

  test('a timed guard reflects an attack and arts deliberately cancel wind-ups', () => {
    const game = new C.Game({ seed: 2 }); game.shield = 0;
    const enemy = { ...game.map.enemies[0], x: 4, y: 3, kind: 2, hp: 6, rest: 0 };
    game.map.enemies = [enemy];
    advance(game, .9); expect(game.act('guard')).toBe(true);
    advance(game, .5); expect(game.player.hp).toBe(7); expect(enemy.hp).toBe(5); expect(enemy.stun).toBeGreaterThan(0);
    expect(game.act('guard')).toBe(false);
    enemy.stun = 0; enemy.windup = 1; enemy.intent = [{ x: 3, y: 3 }];
    expect(game.act('art')).toBe(true); expect(enemy.intent).toEqual([]); expect(enemy.stun).toBe(1.5);
    expect(game.focus).toBeLessThan(2); expect(game.act('art')).toBe(false);
  });

  test('simulation is bounded, never catches up offline, and stops outside play', () => {
    const game = new C.Game({ seed: 2 });
    game.update(Infinity); game.update(-1); expect(game.elapsed).toBe(0);
    game.update(9999); expect(game.elapsed).toBe(.1);
    game.status = 'blessing'; advance(game, 3); expect(game.elapsed).toBe(.1);
  });

  test('walls block lantern damage and seedbombs', () => {
    const game = new C.Game({ seed: 2 });
    game.map.tiles[3 * game.map.w + 4] = 1;
    game.map.enemies = [{ id: 'foe0', kind: 0, x: 5, y: 3, hp: 2, intent: [], stun: 0 }];
    game.blessings.push('reach');
    game.act('attack'); expect(game.map.enemies[0].hp).toBe(2);
    game.act('bomb'); expect(game.map.enemies[0].hp).toBe(2);
  });

  test('supplies and dash are bounded, healing cannot waste a full-health tonic', () => {
    const game = new C.Game({ seed: 77 });
    game.map.enemies = [];
    const count = game.inventory.medicine;
    expect(game.act('medicine')).toBe(false); expect(game.inventory.medicine).toBe(count);
    game.player.hp = 2; game.act('medicine'); expect(game.player.hp).toBe(7);
    game.inventory.bomb = 0; expect(game.act('bomb')).toBe(false); expect(game.inventory.bomb).toBe(0);
    game.act('thread'); expect(game.guideTurns).toBe(40);
    game.player.facing = 1; expect(game.act('dash')).toBe(true);
    expect(game.player.x).toBeGreaterThan(3); expect(game.act('dash')).toBe(false);
    expect(C.walkable(game.map, game.player.x, game.player.y, game.phase)).toBe(true);
  });

  test('rune shrines reset on wrong notes, reward once, and require proximity', () => {
    const game = new C.Game({ seed: 33 });
    const shrine = game.map.entities.find(e => e.type === 'shrine');
    expect(game.solveRune(shrine.sequence[0])).toBe(false);
    positionBeside(game, shrine);
    game.solveRune((shrine.sequence[0] + 1) % 3); expect(shrine.progress).toBe(0);
    const light = game.light;
    shrine.sequence.forEach(symbol => expect(game.solveRune(symbol)).toBe(true));
    expect(shrine.done).toBe(true); expect(game.light).toBe(light + 8);
    shrine.sequence.forEach(symbol => game.solveRune(symbol));
    expect(game.light).toBe(light + 8);
  });

  test('closed waygates reject early exit and invalid blessing choices', () => {
    const game = new C.Game({ seed: 2 });
    expect(game.act('interact')).toBe(false); expect(game.status).toBe('playing');
    expect(game.chooseBlessing('radiance')).toBe(false);
    game.map.entities.filter(e => e.type === 'seed').forEach(e => { e.done = true; }); game.seeds = 3;
    expect(game.act('interact')).toBe(true); expect(game.status).toBe('blessing');
    expect(game.act('move', 1)).toBe(false); expect(game.chooseBlessing('not-a-blessing')).toBe(false);
    const first = game.choices()[0].id;
    expect(game.chooseBlessing(first)).toBe(true); expect(game.depth).toBe(1); expect(game.seeds).toBe(0);
    expect(game.player.hp).toBe(game.stats().maxHp);
    expect(game.choices()).toHaveLength(3);
    expect(game.choices().some(choice => choice.id === first)).toBe(false);
  });

  test.each([1, 2, 17, 42, 77, 120, 451, 1984, 2026, 56991])('ordinary inputs can complete all three gardens for seed %s', seed => {
    const game = new C.Game({ seed });
    expect(finishExpedition(game, C)).toBe('won');
    expect(game.depth).toBe(2); expect(game.seeds).toBe(3); expect(game.blessings).toHaveLength(2);
    expect(game.kills).toBeGreaterThan(0); expect(game.score).toBeGreaterThan(1500);
  });
});

describe('Lumenwild saves and progression boundaries', () => {
  test('autosave restores discoveries, enemies, supplies, phases, and future outcomes', () => {
    const original = new C.Game({ seed: 82, gentle: true, upgrades: { hearth: 2, satchel: 1, lens: 1 } });
    original.act('move', 1); original.act('shift'); original.act('thread');
    const saved = C.readSave(C.writeSave(C.profile(), original));
    expect(saved.invalid).toBe(false); expect(saved.game.snapshot()).toEqual(original.snapshot());
    for (const action of ['wait', 'shift', 'attack', 'dash', 'bomb']) {
      original.act(action); saved.game.act(action);
      expect(saved.game.snapshot()).toEqual(original.snapshot());
    }
  });

  test('midway blessing selection can resume, without granting a second restoration reward', () => {
    const game = new C.Game({ seed: 9 });
    game.seeds = 3; game.map.entities.filter(e => e.type === 'seed').forEach(e => { e.done = true; });
    game.act('interact'); const restored = C.Game.restore(game.snapshot());
    expect(restored.status).toBe('blessing'); expect(restored.light).toBe(game.light);
    expect(restored.act('interact')).toBe(false); expect(restored.light).toBe(game.light);
  });

  test('a living creature can cross a defeated creature’s old position and still resume safely', () => {
    const game = new C.Game({ seed: 9 });
    const [defeated, living] = game.map.enemies;
    defeated.hp = 0;
    living.x = defeated.x; living.y = defeated.y;
    const restored = C.Game.restore(game.snapshot());
    expect(restored).not.toBeNull();
    expect(restored.snapshot()).toEqual(game.snapshot());
    game.map.enemies[2].x = living.x;
    game.map.enemies[2].y = living.y;
    expect(C.Game.restore(game.snapshot())).toBeNull();
  });

  test('malformed, oversized, incompatible and poisoned data cannot be used as a run', () => {
    for (const raw of ['{', 'null', '[]', 'x'.repeat(C.MAX_SAVE + 1), '{"version":123}', '{"version":1,"run":{"player":{"x":"<script>"}}}']) {
      const saved = C.readSave(raw); expect(saved.game).toBeNull(); expect(saved.invalid).toBe(true);
    }
    const game = new C.Game({ seed: 89 });
    for (const mutate of [
      s => { s.player.x = -2; }, s => { s.player.x = Infinity; }, s => { s.player.y = 1.5; },
      s => { s.depth = 700; }, s => { s.blessings = ['radiance']; }, s => { s.seen = Array(1601).fill(1); },
      s => { s.enemies[0].intent = [{ x: -99, y: 1 }]; }, s => { s.entities[0].id = '__proto__'; },
      s => { s.status = 'blessing'; }, s => { s.enemies[0].x = s.player.x; s.enemies[0].y = s.player.y; },
    ]) {
      const snapshot = JSON.parse(JSON.stringify(game.snapshot())); mutate(snapshot);
      expect(C.Game.restore(snapshot)).toBeNull();
    }
    const p = C.profile(JSON.parse('{"light":1e99,"wins":-3,"upgrades":{"hearth":999,"__proto__":{"polluted":true}},"memories":[0,999,"<script>",0],"sound":"true"}'));
    expect(p.light).toBe(0); expect(p.wins).toBe(0); expect(p.upgrades.hearth).toBe(6); expect(p.memories).toEqual([0]); expect(p.sound).toBe(false);
    expect({}.polluted).toBeUndefined();
  });

  test('camp purchases reject unknown upgrades, insufficient funds, and levels beyond the cap', () => {
    const p = C.profile();
    expect(C.buyUpgrade(p, 'hearth')).toBe(false); expect(C.buyUpgrade(p, '__proto__')).toBe(false);
    p.light = 200;
    for (let i = 0; i < 3; i += 1) expect(C.buyUpgrade(p, 'hearth')).toBe(true);
    expect(p.light).toBe(96); expect(p.upgrades.hearth).toBe(3); expect(C.buyUpgrade(p, 'hearth')).toBe(false);
  });

  test('daily expeditions ignore camp and gentle advantages', () => {
    const date = '2026-11-14';
    const upgraded = new C.Game({ seed: C.hash(`lumenwild:${date}`), daily: true, gentle: true, upgrades: { hearth: 3, satchel: 3, lens: 3 } });
    const standard = new C.Game({ seed: C.hash(`lumenwild:${date}`), daily: true });
    expect(upgraded.snapshot()).toEqual(standard.snapshot()); expect(upgraded.gentle).toBe(false);
  });
});
