// Headless smoke test: stub browser globals, then exercise real game logic.
const noop = () => {};
const grad = { addColorStop: noop };
const ctx = new Proxy({}, {
  get: (t, p) => {
    if (p === "createLinearGradient" || p === "createRadialGradient" || p === "createPattern") return () => grad;
    if (p === "measureText") return () => ({ width: 10 });
    if (p === "canvas") return {};
    return noop;
  },
  set: () => true,
});
const canvas = {
  getContext: () => ctx,
  parentElement: { clientWidth: 1280, clientHeight: 800 },
  style: {}, width: 1280, height: 800,
  addEventListener: noop, removeEventListener: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
};
const store = {};
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => delete store[k] };
globalThis.window = {
  devicePixelRatio: 1,
  addEventListener: noop, removeEventListener: noop,
  AudioContext: undefined, webkitAudioContext: undefined,
};
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;

const assert = (cond, msg) => { if (!cond) { console.error("ASSERT FAIL:", msg); process.exit(1); } };
const log = (...a) => console.log("  •", ...a);

const { Game } = await import("./js/game.js");
const { Meta } = await import("./js/meta.js");
const { Build } = await import("./js/build.js");
const { UPGRADES, UPGRADE_MAP, COMBOS, ENEMIES } = await import("./js/config.js");

log("modules imported OK");

// --- Build / upgrade logic ---
let b = new Build({});
assert(b.s.maxHp > 0, "base maxHp");
b.owned.ember_edge = 5; b.recalc();
const dmg = b.s.damage; b.recalc();
assert(b.s.damage === dmg, "recalc deterministic");
const base = new Build({}).s.damage;
assert(b.s.damage > base, "damage upgrade increases damage");
b.owned.orbit = 3; b.owned.beam = 2; b.recalc();
assert(b.s.orbitCount >= 3, "orbit count applied");
assert(b.s.beamDps > 0, "beam dps applied");
let choices = b.rollChoices({ int: (a,c)=>a, range:(a,c)=>a }, 3);
// use a proper rng
const { RNG } = await import("./js/util.js");
const rng = new RNG(1234);
choices = b.rollChoices(rng, 3);
assert(choices.length === 3, "roll 3 choices");
assert(choices.every(c => c && c.id), "choices are defs");
assert(!b.combosForged.has("starforge_ring"), "combo not yet forged");
choices = b.rollChoices(rng, 5);
const combo = choices.find(c => c.requires);
assert(!!combo, "combo offered when orbit+beam owned");
b.combosForged.add(combo.id); b.recalc();
assert(b.s.orbitDps > 7, "combo boosted orbitDps");
log("build/upgrade/combo logic OK");

// --- Start a run and simulate ---
const meta = new Meta();
meta.stardust = 500; meta.levels = { core_vitality: 2, first_spark: 1, orbit_seed: 1 };
const game = new Game(canvas);
game.setMeta(meta);
let levelups = 0, gameover = false;
game.ui = {
  hud: noop, toast: noop, updateAbilities: noop,
  levelup: () => { levelups++; }, hideLevelup: noop,
  showPause: noop, hidePause: noop, showMenu: noop,
  showGameOver: () => { gameover = true; },
  openShop: noop, closeShop: noop, toggleMute: noop, lastOver: null,
};
game.startRun();
assert(game.state === "playing", "state playing after start");
assert(game.player.build.s.maxHp > 100, "meta core_vitality boosted maxHp");
assert(game.build.owned.orbit >= 1 || game.build.owned.beam >= 1 || game.build.owned.chain >= 1 || game.build.owned.meteor >= 1 || game.build.owned.aura >= 1, "first_spark granted an ability");

// simulate ~15 seconds
for (let i = 0; i < 900; i++) {
  game.input = { dx: Math.sin(i / 40) * 0.6, dy: Math.cos(i / 55) * 0.6 };
  game.mouseWorld = { x: 640 + Math.cos(i / 30) * 200, y: 400 + Math.sin(i / 30) * 150 };
  game.simulate(1 / 60);
  if (game.state === "levelup") { const c = game.build.rollChoices(game.rng, 3)[0]; game.choose(c); }
  if (game.state === "gameover") break;
}
log("simulated 15s — enemies:", game.enemies.length, "bullets:", game.bullets.length, "pickups:", game.pickups.length, "score:", Math.round(game.score), "level:", game.level, "kills:", game.kills, "gameover:", gameover);
assert(game.score > 0, "score accrued");
assert(game.player.hp <= game.build.s.maxHp, "hp bounded");

// --- Force heavy combat: swarm the player ---
game.player.x = 640; game.player.y = 400;
for (let i = 0; i < 60; i++) {
  const a = (i / 60) * 6.283;
  game.enemies.push(Object.assign(new (await import("./js/entities.js")).Enemy(ENEMIES.mote, 640 + Math.cos(a) * 60, 400 + Math.sin(a) * 60, { hpScale: 1, dmgScale: 1, speedScale: 1 }), {}));
}
// grant a full kit to exercise all systems
game.build.owned = { ember_edge: 4, rapid_forge: 3, split_sparks: 2, pierce: 1, crit_strike: 3,
  orbit: 3, beam: 2, aura: 2, meteor: 2, chain: 2, slow_field: 2, armor: 2, leech: 2, regen: 2 };
game.build.recalc();
for (let i = 0; i < 600; i++) {
  game.input = { dx: Math.sin(i / 20), dy: Math.cos(i / 20) };
  game.mouseWorld = { x: 640 + Math.cos(i / 8) * 240, y: 400 + Math.sin(i / 8) * 200 };
  game.simulate(1 / 60);
  if (game.state === "levelup") { const c = game.build.rollChoices(game.rng, 3)[0]; game.choose(c); }
  if (game.state === "gameover") break;
}
log("heavy combat — kills:", game.kills, "met", game.meteors.length, "chains", game.chainFx.length, "orbs", game.orbitOrbs.length, "state:", game.state);

// --- render pass (stub ctx) to catch draw errors ---
game.state = "playing";
game.render();
log("render() ran without throwing");

// --- meta persistence round-trip ---
meta.buy("ember_core");
assert(meta.level("ember_core") >= 1, "bought ember_core");
const meta2 = new Meta();
assert(meta2.level("ember_core") === meta.level("ember_core"), "meta persisted to storage");
log("meta persistence OK");

console.log("\n✅ ALL SMOKE TESTS PASSED");
