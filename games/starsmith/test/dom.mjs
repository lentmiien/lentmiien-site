// DOM-integration smoke test: drive the real main.js wiring + UI controller headlessly.
const noop = () => {};
const grad = { addColorStop: noop };
const ctx = new Proxy({}, {
  get(t, p) {
    if (p === "createLinearGradient" || p === "createRadialGradient" || p === "createPattern") return () => grad;
    if (p === "measureText") return () => ({ width: 10 });
    return noop;
  },
  set() { return true; },
});
const cache = {};
function makeEl(tag) {
  const listeners = Object.create(null);
  return {
    tagName: (tag || "div").toUpperCase(), style: {}, title: "",
    classList: { _s: new Set(), add(...c){c.forEach(x=>this._s.add(x));}, remove(...c){c.forEach(x=>this._s.delete(x));}, toggle(c,f){f?this._s.add(c):this._s.delete(c);}, contains(c){return this._s.has(c);} },
    addEventListener(type, fn){ (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: noop,
    dispatch(type, evt){ (listeners[type] || []).forEach(fn => fn(evt || { preventDefault: noop, key: "" })); },
    appendChild: c => c, removeChild: noop, querySelector: () => makeEl(),
    textContent: "", innerHTML: "", value: "",
    offsetWidth: 100, offsetHeight: 100,
    parentElement: { clientWidth: 1280, clientHeight: 800 },
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    width: 1280, height: 800,
  };
}
globalThis.document = {
  querySelector: s => cache[s] || (cache[s] = makeEl("div")),
  createElement: t => makeEl(t),
  addEventListener: noop, removeEventListener: noop,
  body: makeEl("body"), head: makeEl("head"),
};
const store = {};
globalThis.localStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => delete store[k] };
globalThis.window = { addEventListener: noop, removeEventListener: noop, devicePixelRatio: 1, AudioContext: undefined, webkitAudioContext: undefined, __starsmithDebug: null };
globalThis.performance = { now: () => Date.now() };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = noop;

const ok = (c, m) => { if (!c) { console.error("FAIL:", m); process.exit(1); } };
const step = (name) => console.log("  •", name);

step("importing main.js (boot runs)");
await import("../js/main.js");
const d = globalThis.window.__starsmithDebug;
ok(d && d.game && d.ui && d.meta, "debug handle + game/ui/meta exist");

step("menu is shown at boot");
ok(!cache["#menu"].classList.contains("hidden"), "menu visible");
ok(cache["#hud"].classList.contains("hidden"), "hud hidden at menu");

step("clicking FORGE starts a run");
cache["#btn-start"].dispatch("click");
ok(d.game.state === "playing", "state is playing after start");
ok(!cache["#hud"].classList.contains("hidden"), "hud visible in run");
ok(d.game.player && d.game.player.hp > 0, "player alive");

step("HUD updates without throwing");
d.ui.hud(d.game);

step("level-up card building + choose");
const choices = d.game.build.rollChoices(d.game.rng, 3);
ok(choices.length === 3, "3 choices");
d.ui.levelup(choices);
ok(!cache["#levelup"].classList.contains("hidden"), "level-up overlay shown");
// give a full kit to exercise combo path, then choose a combo if available
d.game.build.owned.orbit = 2; d.game.build.owned.beam = 2; d.game.build.recalc();
d.game.pendingLevelUps = 1;
let combo = d.game.build.rollChoices(d.game.rng, 5).find(c => c.requires);
if (combo) d.game.choose(combo); else d.game.choose(d.game.build.rollChoices(d.game.rng, 1)[0]);
ok(d.game.state === "playing", "back to playing after choosing");

step("abilities HUD updates");
d.ui.updateAbilities(d.game);

step("pause / resume");
cache["#btn-pause"].dispatch("click");
ok(d.game.state === "paused", "paused");
cache["#btn-resume"].dispatch("click");
ok(d.game.state === "playing", "resumed");

step("game over + shop round-trip");
d.game.endRun("test death");
ok(d.game.state === "gameover", "gameover");
ok(!cache["#gameover"].classList.contains("hidden"), "game-over shown");
cache["#btn-shop-from-over"].dispatch("click");
ok(!cache["#shop"].classList.contains("hidden"), "shop shown");
d.meta.stardust = 1000; d.ui.renderShop();
d.meta.buy("ember_core");
ok(d.meta.level("ember_core") >= 1, "bought meta upgrade");
cache["#btn-shop-close"].dispatch("click");
ok(!cache["#gameover"].classList.contains("hidden"), "back to game-over after closing shop");

step("mute toggle");
d.ui.toggleMute();
d.ui.toggleMute();

step("restart from game over");
cache["#btn-restart"].dispatch("click");
ok(d.game.state === "playing", "restarted into a new run");

console.log("\n✅ DOM/MAIN INTEGRATION TEST PASSED");
