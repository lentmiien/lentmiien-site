(function (root, factory) {
  const content = typeof module === 'object' && module.exports ? require('./content') : root.LumenwildContent;
  const api = factory(content);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LumenwildGuardians = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (content) {
  'use strict';

  const definition = id => content.GUARDIANS.find(b => b.id === id);
  const inside = (arena, p) => Math.abs(p.x - arena.x) <= arena.radius && Math.abs(p.y - arena.y) <= arena.radius;

  function create(id, arena, tier) {
    const spec = definition(id), maxHp = spec.hp + (tier - 1) * 10;
    return { id, ...arena.home, hp: maxHp, maxHp, state: 'sleeping', mode: 'rest', stage: 1, cycle: 0,
      timer: 0, total: 0, elapsed: 0, intent: [], realm: -1, attack: '', landing: null, kit: null, hitsTaken: 0,
      followup: [], followupRealm: -1, beat: 1, beats: spec.beats || (spec.sequence ? 2 : 1), queue: [] };
  }

  function sequence(game) {
    const b = game.boss, a = game.map.arena, p = game.player, index = b.cycle % 3, round = Math.floor(b.cycle / 3);
    const cells = []; b.followup = []; b.realm = -1; b.followupRealm = -1; b.landing = null; b.beat = 1;
    b.attack = definition(b.id).attacks[index];
    const mark = (list, x, y) => { if (x !== b.x || y !== b.y) list.push({ x, y }); };
    for (let y = a.y - a.radius; y <= a.y + a.radius; y += 1) for (let x = a.x - a.radius; x <= a.x + a.radius; x += 1) {
      const dx = x - a.x, dy = y - a.y, ring = Math.max(Math.abs(dx), Math.abs(dy));
      let first = false, second = false;
      if (b.id === 'honeyregent') {
        const comb = ((dx + dy * 2 + round) % 3 + 3) % 3;
        if (index === 0) { first = comb === 0 || b.stage === 3 && comb === 2; second = comb === 1 || b.stage === 3 && comb === 2; }
        if (index === 1) { first = Math.abs(x - p.x) <= 1; second = Math.abs(y - p.y) <= 1; }
        if (index === 2) { const radius = Math.abs(x - p.x) + Math.abs(y - p.y); first = radius <= 1; second = radius >= 2 && radius <= (b.stage === 3 ? 4 : 3); }
      } else if (b.id === 'resonantwarden') {
        if (index === 0) { first = ring <= 2; second = ring >= 3; }
        if (index === 1) { first = (x + round) % 4 < 2; second = (y + round) % 4 < 2; }
        if (index === 2) { first = Math.abs(dx) > 1; second = Math.abs(dy) > 1; }
      } else if (b.id === 'nightgardener') {
        if (index === 0) { first = Math.abs(dx - dy) <= (b.stage === 3 ? 1 : 0); second = Math.abs(dx + dy) <= (b.stage === 3 ? 1 : 0); }
        if (index === 1) {
          const side = round % 2 ? 3 : -3;
          first = Math.abs(dx - side) + Math.abs(dy) > 2; second = Math.abs(dx + side) + Math.abs(dy) > 2;
        }
        if (index === 2) { first = Math.abs(dx + 2) > 0; second = Math.abs(dx - 2) > 0; }
      }
      if (first) mark(cells, x, y); if (second) mark(b.followup, x, y);
    }
    if (index === 2 && b.id !== 'honeyregent') { b.realm = round % 2; b.followupRealm = 1 - b.realm; }
    if (index === 1 && b.id === 'honeyregent') b.landing = { x: Math.max(a.x - 3, Math.min(a.x + 3, p.x)), y: Math.max(a.y - 3, Math.min(a.y + 3, p.y)) };
    return cells;
  }

  function finalePattern(game) {
    const b = game.boss, a = game.map.arena, spec = definition(b.id);
    const index = b.cycle % 3, round = Math.floor(b.cycle / 3), strikes = [];
    b.beat = 1; b.landing = null; b.attack = spec.attacks[index];
    for (let beat = 0; beat < b.beats; beat += 1) {
      const cells = [], realm = index === 2 && beat < 2 ? (beat + round) % 2 : -1;
      for (let y = a.y - 5; y <= a.y + 5; y += 1) for (let x = a.x - 5; x <= a.x + 5; x += 1) {
        if (x === b.x && y === b.y) continue;
        const dx = x - a.x, dy = y - a.y, ring = Math.max(Math.abs(dx), Math.abs(dy));
        let safe;
        if (spec.hidden) {
          if (index === 0) {
            const lane = [-3, -3, 3, 3][(beat + round) % 4];
            safe = Math.abs((beat % 2 ? dy : dx) - lane) <= (b.stage < 3 ? 1 : 0);
          } else if (index === 1) {
            const corner = [[-2, -2], [2, -2], [2, 2], [-2, 2]][(beat + round) % 4];
            safe = Math.abs(dx - corner[0]) + Math.abs(dy - corner[1]) <= (b.stage < 3 ? 2 : 1);
          } else safe = beat === 0 ? Math.abs(dx - dy) <= 1 : beat === 1 ? Math.abs(dx + dy) <= 1 : beat === 2 ? ring === 2 : ring <= 1;
        } else {
          if (index === 0) safe = beat === 0 ? (x + round) % 4 < 2 : beat === 1 ? (y + round) % 4 < 2 : ring <= 2;
          else if (index === 1) {
            const pocket = [[-2, 0], [0, -2], [2, 0]][beat];
            safe = Math.abs(dx - pocket[0]) + Math.abs(dy - pocket[1]) <= 2;
          } else safe = beat === 0 ? Math.abs(dx + 2) <= 1 : beat === 1 ? Math.abs(dx - 2) <= 1 : ring <= 2;
        }
        if (!safe) cells.push({ x, y });
      }
      strikes.push({ cells, realm });
    }
    b.realm = strikes[0].realm; b.followup = strikes[1].cells; b.followupRealm = strikes[1].realm;
    b.queue = strikes.slice(2);
    return strikes[0].cells;
  }

  function pattern(game) {
    if (definition(game.boss.id).beats) return finalePattern(game);
    if (definition(game.boss.id).sequence) return sequence(game);
    const b = game.boss, arena = game.map.arena, p = game.player, index = b.cycle % 3;
    const cells = [], phase = b.stage, round = Math.floor(b.cycle / 3);
    const add = (x, y) => { if (inside(arena, { x, y }) && !(x === b.x && y === b.y)) cells.push({ x, y }); };
    b.realm = -1; b.landing = null; b.attack = definition(b.id).attacks[index];
    const target = { x: p.x, y: p.y };
    for (let y = arena.y - 5; y <= arena.y + 5; y += 1) for (let x = arena.x - 5; x <= arena.x + 5; x += 1) {
      const dx = x - b.x, dy = y - b.y, ring = Math.max(Math.abs(x - arena.x), Math.abs(y - arena.y));
      if (b.id === 'bellkeeper') {
        if (index === 0 && ((round % 2 ? y : x) + b.cycle) % 3 !== 0) add(x, y);
        if (index === 1 && (round % 2 ? ring <= 2 : ring >= 3)) add(x, y);
        if (index === 2 && ring >= 2) add(x, y);
      } else if (b.id === 'tempest') {
        if (index === 0 && (round % 2 ? Math.abs(y - target.y) : Math.abs(x - target.x)) <= 1) add(x, y);
        if (index === 1 && [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: -3, y: 0 }, { x: 0, y: 3 }, { x: 0, y: -3 }]
          .some(offset => Math.abs(x - target.x - offset.x) + Math.abs(y - target.y - offset.y) <= (phase > 1 ? 1 : 0))) add(x, y);
        if (index === 2 && (x === target.x || y === target.y || phase === 3 && Math.abs(x - target.x) === Math.abs(y - target.y))) add(x, y);
      } else {
        if (index === 0 && (dx === 0 || dy === 0 || phase > 1 && Math.abs(dx) === Math.abs(dy))) add(x, y);
        if (index === 1 && (round % 2 ? ring <= 2 : ring >= 3)) add(x, y);
        if (index === 2 && Math.abs(x - arena.x - (round % 2 ? 2 : -2)) > 0) add(x, y);
      }
    }
    if (index === 2 && b.id !== 'tempest') b.realm = round % 2;
    if (index === 0 && b.id === 'tempest') {
      b.landing = { x: Math.max(arena.x - 3, Math.min(arena.x + 3, target.x)), y: Math.max(arena.y - 3, Math.min(arena.y + 3, target.y)) };
    }
    return cells;
  }

  function start(game) {
    const b = game.boss;
    if (!b || b.state !== 'sleeping' || game.status !== 'playing' || game.seeds !== 3) return false;
    const altar = game.nearby();
    if (altar?.type !== 'guardian') return false;
    b.state = 'active'; b.mode = 'rest'; b.timer = 1.4;
    b.kit = { ...game.inventory }; b.elapsed = 0; b.hitsTaken = 0;
    game.player.x = game.map.arena.entry.x; game.player.y = game.map.arena.entry.y - 1;
    game.player.facing = 0;
    game.player.hp = game.stats().maxHp; game.focus = game.stats().maxFocus;
    game.shield = .8; game.guardTime = 0;
    Object.keys(game.cooldowns).forEach(key => { game.cooldowns[key] = 0; });
    game.map.enemies.forEach(enemy => { enemy.intent = []; enemy.windup = 0; enemy.rest = Math.max(enemy.rest, 1); });
    game.emit('bossStart', `${definition(b.id).name} · watch the ground, then strike the open heart.`);
    game.guideCache = null; game.reveal(); return true;
  }

  function retreat(game, failed = false) {
    if (game.boss?.state !== 'active') return false;
    const previous = game.boss;
    game.inventory = { ...previous.kit };
    game.boss = create(previous.id, game.map.arena, game.tier);
    game.player.x = game.map.arena.entry.x; game.player.y = game.map.arena.entry.y;
    game.player.hp = game.stats().maxHp; game.focus = game.stats().maxFocus;
    game.shield = 1; game.guardTime = 0;
    Object.keys(game.cooldowns).forEach(key => { game.cooldowns[key] = 0; });
    game.guideCache = null; game.pathCache = null; game.reveal();
    game.emit(failed ? 'bossRetry' : 'bossRetreat', failed ? 'Your lantern catches you. Hearts and the supplies you entered with are restored.' : 'A moment to prepare. Your arena supplies are restored.');
    return true;
  }

  function strike(game, damage) {
    const b = game.boss;
    if (!b || b.state !== 'active' || b.mode === 'transition' || damage <= 0) return;
    // Guardians cannot be stun-locked. Reading their committed pattern creates
    // a generous double-damage opening after every attack.
    const spec = definition(b.id), phases = spec.phases || 3;
    if (spec.hidden && b.mode !== 'recovery') { game.emit('bossArmored', 'The star’s heart is closed. Wait for all four strikes.'); return; }
    const dealt = b.mode === 'recovery' ? damage * 2 : Math.min(1, damage);
    const threshold = b.stage < phases ? Math.floor(b.maxHp * (phases - b.stage) / phases) : 0;
    b.hp = Math.max(threshold, b.hp - dealt);
    game.emit('hit', '', { x: b.x, y: b.y, damage: dealt });
    if (b.hp) {
      if (b.hp === threshold) {
        b.mode = 'transition'; b.intent = []; b.followup = []; b.queue = []; b.landing = null; b.timer = 1.1; b.total = 1.1;
        game.emit('bossPhase', 'A layer of old magic falls away. The guardian gathers itself for a new pattern.');
      }
      return;
    }
    b.state = 'defeated'; b.mode = 'rest'; b.intent = []; b.followup = []; b.queue = []; b.timer = 0; b.realm = -1; b.kit = null;
    game.guardianWins[b.id] = Math.max(game.guardianWins[b.id] || 0, game.tier);
    const altar = game.map.entities.find(e => e.type === 'guardian'); if (altar) altar.done = true;
    game.light += spec.hidden ? 120 : 30 * game.tier; game.score += spec.hidden ? 2400 : 500 * game.tier;
    game.player.hp = game.stats().maxHp; game.focus = game.stats().maxFocus;
    game.inventory.medicine = Math.min(9, game.inventory.medicine + 1);
    game.shield = Math.max(game.shield, 1.5);
    game.guideCache = null;
    game.emit('bossDefeated', spec.hidden ? 'The Hollow Star is alight · the Unfading Keeper title is yours.' : `${spec.name} awakened · a new lantern art and charm await at camp.`, { guardian: b.id, x: b.x, y: b.y });
    if (['trial', 'secret'].includes(game.trail)) game.status = 'won';
  }

  function update(game, dt) {
    const b = game.boss;
    if (!b || b.state !== 'active') return;
    const spec = definition(b.id);
    b.elapsed += dt; b.timer = Math.max(0, b.timer - dt);
    if (b.timer > 0) return;
    if (b.mode === 'windup') {
      const lands = b.intent.some(p => p.x === game.player.x && p.y === game.player.y) && (b.realm === -1 || b.realm === game.phase);
      const impact = b.intent.slice(), impactRealm = b.realm, follows = b.followup.length > 0;
      if (follows) {
        b.intent = b.followup; b.realm = b.followupRealm; b.beat += 1;
        const next = b.queue.shift(); b.followup = next ? next.cells : []; b.followupRealm = next ? next.realm : -1;
        b.timer = spec.hidden ? 1.15 - (b.stage - 1) * .06 : (1.55 - (b.stage - 1) * .08 - (game.tier - 1) * .05 + (game.records[game.region].landmark ? .25 : 0)) * (game.gentle ? 1.5 : 1) * (game.has('patience') ? 1.2 : 1);
      } else { b.intent = []; b.mode = 'recovery'; b.timer = spec.hidden ? 2.1 - (b.stage - 1) * .1 : 3.4 - (b.stage - 1) * .25 + (b.beats > 1 ? .5 : 0); }
      b.total = b.timer;
      if (b.landing && !follows) {
        const candidates = [b.landing, { x: b.landing.x + 1, y: b.landing.y }, { x: b.landing.x - 1, y: b.landing.y }];
        const landing = candidates.find(p => inside(game.map.arena, p) && !(p.x === game.player.x && p.y === game.player.y));
        if (landing) { b.x = landing.x; b.y = landing.y; }
        b.landing = null;
      }
      game.emit('bossImpact', '', { cells: impact, realm: impactRealm, x: b.x, y: b.y });
      if (lands) game.hurt(spec.hidden ? b.stage === 4 ? 4 : 3 : 2 + (game.tier === 3 ? 1 : 0), b);
      if (b.state === 'active' && b.mode === 'recovery' && game.boss === b) game.emit('bossOpening', 'The heart is open · your attacks deal double damage!');
      if (b.state === 'active' && b.mode === 'windup' && game.boss === b) game.emit('bossWarning', `${b.attack} · strike ${b.beat}/${b.beats}${b.realm === -1 ? '' : ` · ${b.realm ? 'Echo' : 'Bloom'} only`}`);
      return;
    }
    const phases = spec.phases || 3;
    const stage = phases === 3 ? b.hp > b.maxHp * 2 / 3 ? 1 : b.hp > b.maxHp / 3 ? 2 : 3 : Math.min(phases, 1 + Math.floor((b.maxHp - b.hp) / (b.maxHp / phases)));
    if (stage > b.stage) { b.stage = stage; game.emit('bossPhase', `${definition(b.id).name} · phase ${stage}. Keep watching the warning shapes.`); }
    b.intent = pattern(game); b.mode = 'windup';
    const preparation = game.records[game.region].landmark ? .3 : 0;
    b.total = spec.hidden ? 1.65 - (b.stage - 1) * .08 : (1.9 + (b.beats > 1 ? .35 : 0) + (spec.finale ? .15 : 0) - (b.stage - 1) * .12 - (game.tier - 1) * .07 + preparation) * (game.gentle ? 1.5 : 1) * (game.has('patience') ? 1.2 : 1);
    b.timer = b.total; b.cycle += 1;
    game.emit('bossWarning', `${b.attack}${b.realm === -1 ? '' : ` · ${b.realm ? 'Echo' : 'Bloom'} only`}`);
  }

  function restore(game, saved, helpers) {
    const { plain, integer, number, walkable } = helpers;
    if (!game.boss) return saved === null || saved === undefined;
    if (!plain(saved) || saved.id !== game.boss.id || !['sleeping', 'active', 'defeated'].includes(saved.state) || !['rest', 'windup', 'recovery', 'transition'].includes(saved.mode) ||
      !inside(game.map.arena, saved) || !walkable(game.map, saved.x, saved.y, 0) || ![0, 1, -1].includes(saved.realm) ||
      !Array.isArray(saved.intent) || saved.intent.length > 121 || saved.intent.some(p => !plain(p) || !Number.isInteger(p.x) || !Number.isInteger(p.y) || !inside(game.map.arena, p))) return false;
    const active = saved.state === 'active';
    if (active && (!plain(saved.kit) || !inside(game.map.arena, game.player) || saved.x === game.player.x && saved.y === game.player.y)) return false;
    if (saved.state === 'defeated' && saved.hp !== 0 || saved.state !== 'defeated' && (!Number.isInteger(saved.hp) || saved.hp < 1)) return false;
    if (saved.landing !== null && (!plain(saved.landing) || !Number.isInteger(saved.landing.x) || !Number.isInteger(saved.landing.y) || !inside(game.map.arena, saved.landing))) return false;
    const spec = definition(saved.id), stage = integer(saved.stage, 1, definition(saved.id).phases || 3, 1), cycle = integer(saved.cycle, 0, 999999);
    const followup = saved.followup === undefined ? [] : saved.followup, followupRealm = saved.followupRealm === undefined ? -1 : saved.followupRealm;
    if (!Array.isArray(followup) || followup.length > 121 || followup.some(p => !plain(p) || !Number.isInteger(p.x) || !Number.isInteger(p.y) || !inside(game.map.arena, p)) || ![-1, 0, 1].includes(followupRealm)) return false;
    const beats = spec.beats || (spec.sequence ? 2 : 1), queue = saved.queue === undefined ? [] : saved.queue;
    if (!Array.isArray(queue) || queue.length > Math.max(0, beats - 2) || queue.some(strike => !plain(strike) || ![-1, 0, 1].includes(strike.realm) || !Array.isArray(strike.cells) || !strike.cells.length || strike.cells.length > 121 || strike.cells.some(p => !plain(p) || !Number.isInteger(p.x) || !Number.isInteger(p.y) || !inside(game.map.arena, p)))) return false;
    if (spec.sequence && (!Number.isInteger(saved.beat) || saved.beat < 1 || saved.beat > beats || saved.beats !== beats) || !spec.sequence && followup.length) return false;
    if (active && saved.mode === 'windup' && spec.sequence && ((saved.beat < beats ? followup.length === 0 : followup.length > 0) || queue.length !== Math.max(0, beats - saved.beat - 1))) return false;
    if (spec.beats && (!Number.isInteger(saved.stage) || saved.stage < 1 || saved.stage > (spec.phases || 3))) return false;
    Object.assign(game.boss, { x: saved.x, y: saved.y, hp: integer(saved.hp, 0, game.boss.maxHp), state: saved.state,
      mode: active ? saved.mode : 'rest', stage, cycle, timer: number(saved.timer, 0, 5), total: number(saved.total, 0, 5),
      elapsed: number(saved.elapsed, 0, 999999), intent: active && saved.mode === 'windup' ? saved.intent.map(p => ({ x: p.x, y: p.y })) : [],
      realm: saved.realm, attack: cycle ? spec.attacks[(cycle - 1) % 3] : '',
      landing: saved.landing ? { x: saved.landing.x, y: saved.landing.y } : null,
      kit: active ? Object.fromEntries(['medicine', 'bomb', 'thread'].map(key => [key, integer(saved.kit[key], 0, 9)])) : null,
      hitsTaken: integer(saved.hitsTaken, 0, 999999),
      followup: active && saved.mode === 'windup' ? followup.map(p => ({ x: p.x, y: p.y })) : [],
      followupRealm, beat: spec.sequence ? saved.beat : 1, beats,
      queue: active && saved.mode === 'windup' ? queue.map(strike => ({ realm: strike.realm, cells: strike.cells.map(p => ({ x: p.x, y: p.y })) })) : [],
    });
    const altar = game.map.entities.find(e => e.type === 'guardian');
    if (altar) altar.done = saved.state === 'defeated';
    return true;
  }
  return { definition, inside, create, start, retreat, strike, update, restore };
}));
