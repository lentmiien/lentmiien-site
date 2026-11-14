// config.js — tunables, enemy catalog, upgrade/combo catalog, meta catalog

export const WORLD = { w: 1280, h: 800 };

export const PALETTE = {
  bg: "#07060d",
  player: "#ffd27a",
  playerCore: "#fff2cf",
  bullet: "#ffd27a",
  xp: "#8f7bff",
  ore: "#5ef2d6",
  hp: "#ff6a4a",
};

export const CFG = {
  world: WORLD,
  playerBase: {
    maxHp: 100, regen: 0, lifesteal: 0, armor: 0,
    moveSpeed: 235,
    damage: 9, attackRate: 2.4, range: 215, bulletSpeed: 540, multishot: 1, pierce: 0,
    critChance: 0.06, critMult: 1.8,
    magnet: 74, luck: 0,
    // abilities (0 unless owned)
    orbitCount: 0, orbitDps: 7, orbitRadius: 46,
    beamDps: 0, beamWidth: 12,
    auraDps: 0, auraRadius: 0, auraSlow: 0,
    meteorDps: 0, meteorRate: 0,
    chainDps: 0, chainRange: 0, chainCount: 0,
    globalSlow: 0,
  },
  bulletsMax: 420,
  enemiesMax: 260,
  particlesMax: 900,
  xpToNextLevel: (lvl) => Math.round(14 + lvl * 7 + Math.pow(lvl, 1.35) * 3.4),
  // difficulty / spawn scaling
  spawn: {
    startInterval: 1.15,   // seconds between spawns at t=0
    minInterval: 0.22,
    ramp: 42,             // seconds to reach min interval
    hpScale: (t) => 1 + t / 22 + Math.pow(t / 90, 1.7) * 0.9,
    dmgScale: (t) => 1 + t / 120,
    speedScale: (t) => 1 + Math.min(0.6, t / 160),
    bossEvery: 180,       // seconds
    eliteEvery: 34,       // seconds
  },
  orePerSecond: 0.6,      // passive stardust-ish ore drip (run currency for score)
  dustFromTime: (t) => Math.round(Math.sqrt(t) * 6),
  dustFromScore: (s) => Math.round(Math.sqrt(s) * 0.6),
  saveKey: "starsmith.save.v1",
};

// ---------------- Enemies ----------------
// type: chase | swarm | ranged | splitter | boss
export const ENEMIES = {
  mote:     { id:"mote",     name:"Rust Mote",   hp:3,   speed:74,  radius:10, damage:9,  xp:1,   ore:0.5, color:"#c77b3a", shape:"poly", sides:5,  minWave:0,   weight:100 },
  crawler:  { id:"crawler",  name:"Crawler",     hp:9,   speed:122, radius:12, damage:13, xp:2,   ore:1,   color:"#7fae4a", shape:"poly", sides:6,  minWave:60,  weight:80 },
  wisp:     { id:"wisp",     name:"Void Wisp",   hp:2,   speed:158, radius:9,  damage:7,  xp:1,   ore:0.5, color:"#b98cff", shape:"circle",        minWave:110, weight:90, swarm:true },
  brute:    { id:"brute",    name:"Brute",       hp:70,  speed:46,  radius:23, damage:30, xp:9,   ore:5,   color:"#d65a5a", shape:"poly", sides:7,  minWave:210, weight:40, elite:true },
  splitter: { id:"splitter", name:"Shardling",   hp:16,  speed:96,  radius:14, damage:15, xp:3,   ore:2,   color:"#5ef2d6", shape:"poly", sides:3,  minWave:280, weight:55, splits:2 },
  spitter:  { id:"spitter",  name:"Spitter",     hp:13,  speed:64,  radius:13, damage:11, xp:4,   ore:2,   color:"#ffd27a", shape:"poly", sides:4,  minWave:360, weight:50, ranged:true },
  dread:    { id:"dread",    name:"Dreadforge",  hp:720, speed:42,  radius:48, damage:46, xp:90,  ore:60,  color:"#7b5cff", shape:"poly", sides:8,  minWave:0,   boss:true, elite:true },
};

// ---------------- Upgrades (stat + ability) ----------------
// apply(build, stacks) runs on a freshly-reset base in deterministic order.
export const UPGRADES = [
  // ---- stats ----
  { id:"ember_edge", name:"Ember Edge", icon:"🔥", tier:1, kind:"stat", maxStacks:10, weight:12,
    desc:"+20% attack damage.",
    apply:(b,st)=>{ b.s.damage *= 1 + 0.20*st; } },
  { id:"rapid_forge", name:"Rapid Forge", icon:"⚡", tier:1, kind:"stat", maxStacks:8, weight:11,
    desc:"+12% attack speed.",
    apply:(b,st)=>{ b.s.attackRate *= 1 + 0.12*st; } },
  { id:"long_hammer", name:"Long Hammer", icon:"🔨", tier:1, kind:"stat", maxStacks:6, weight:10,
    desc:"+15% range and +10% projectile speed.",
    apply:(b,st)=>{ b.s.range *= 1 + 0.15*st; b.s.bulletSpeed *= 1 + 0.10*st; } },
  { id:"split_sparks", name:"Split Sparks", icon:"✳", tier:2, kind:"stat", maxStacks:4, weight:8,
    desc:"+1 projectile per volley.",
    apply:(b,st)=>{ b.s.multishot += st; } },
  { id:"pierce", name:"Piercing Steel", icon:"➶", tier:2, kind:"stat", maxStacks:4, weight:8,
    desc:"+1 pierce — bolts keep going.",
    apply:(b,st)=>{ b.s.pierce += st; } },
  { id:"crit_strike", name:"Crit Strike", icon:"💥", tier:1, kind:"stat", maxStacks:8, weight:11,
    desc:"+6% crit chance, +5% crit multiplier.",
    apply:(b,st)=>{ b.s.critChance += 0.06*st; b.s.critMult += 0.05*st; } },
  { id:"momentum", name:"Momentum", icon:"🌀", tier:1, kind:"stat", maxStacks:5, weight:10,
    desc:"+8% movement speed.",
    apply:(b,st)=>{ b.s.moveSpeed *= 1 + 0.08*st; } },
  { id:"vitality", name:"Vitality", icon:"❤", tier:1, kind:"stat", maxStacks:8, weight:12,
    desc:"+25 max HP and heal 25 HP.",
    apply:(b,st)=>{ b.s.maxHp += 25*st; } },
  { id:"magnet", name:"Magnet Core", icon:"🧲", tier:1, kind:"stat", maxStacks:6, weight:10,
    desc:"+18% pickup attraction.",
    apply:(b,st)=>{ b.s.magnet *= 1 + 0.18*st; } },
  { id:"leech", name:"Leech", icon:"🩸", tier:2, kind:"stat", maxStacks:5, weight:8,
    desc:"+0.6 HP per kill (lifesteal).",
    apply:(b,st)=>{ b.s.lifesteal += 0.6*st; } },
  { id:"regen", name:"Regeneration", icon:"♻", tier:1, kind:"stat", maxStacks:6, weight:10,
    desc:"+1 HP/s regeneration.",
    apply:(b,st)=>{ b.s.regen += 1*st; } },
  { id:"slow_field", name:"Slow Field", icon:"❄", tier:2, kind:"stat", maxStacks:4, weight:7,
    desc:"+8% enemy slow aura (global).",
    apply:(b,st)=>{ b.s.globalSlow += 0.08*st; } },
  { id:"fortune", name:"Fortune", icon:"🍀", tier:1, kind:"stat", maxStacks:5, weight:9,
    desc:"+10% luck — more ore & rarer forges.",
    apply:(b,st)=>{ b.s.luck += 0.10*st; } },
  { id:"armor", name:"Iron Shell", icon:"🛡", tier:1, kind:"stat", maxStacks:6, weight:9,
    desc:"+0.8 flat damage reduction.",
    apply:(b,st)=>{ b.s.armor += 0.8*st; } },

  // ---- abilities ----
  { id:"orbit", name:"Orbiting Sparks", icon:"🪐", tier:2, kind:"ability", ability:true, maxStacks:5, weight:9,
    desc:"Summon molten orbs that orbit and scorch whatever they touch.",
    apply:(b,st)=>{ b.s.orbitCount += st; } },
  { id:"beam", name:"Nova Beam", icon:"📡", tier:2, kind:"ability", ability:true, maxStacks:4, weight:9,
    desc:"A continuous lance of fire along your aim.",
    apply:(b,st)=>{ b.s.beamDps += 26*st; b.s.beamWidth += 6*st; } },
  { id:"aura", name:"Molten Aura", icon:"☀", tier:2, kind:"ability", ability:true, maxStacks:5, weight:9,
    desc:"A searing field around you that melts and slows foes.",
    apply:(b,st)=>{ b.s.auraDps += 11*st; b.s.auraRadius += 12*st; b.s.auraSlow += 0.06*st; } },
  { id:"meteor", name:"Meteor Rain", icon:"☄", tier:2, kind:"ability", ability:true, maxStacks:4, weight:8,
    desc:"The sky itself rains burning rock on the swarm.",
    apply:(b,st)=>{ b.s.meteorDps += 18*st; b.s.meteorRate += 0.55*st; } },
  { id:"chain", name:"Volt Chain", icon:"⚡", tier:2, kind:"ability", ability:true, maxStacks:4, weight:8,
    desc:"Lightning leaps from foe to foe in a chain.",
    apply:(b,st)=>{ b.s.chainDps += 11*st; b.s.chainRange += 22*st; b.s.chainCount += st; } },
];
export const UPGRADE_MAP = Object.fromEntries(UPGRADES.map(u => [u.id, u]));

// ---------------- Combos (golden forges) ----------------
export const COMBOS = [
  { id:"starforge_ring", name:"Starforge Ring", icon:"🎯", requires:["orbit","beam"],
    desc:"Orbiting sparks ignite into searing beams.",
    bonus:{ orbitDps:45, beamWidth:10 } },
  { id:"storm_tempest", name:"Storm Tempest", icon:"🌩", requires:["chain","meteor"],
    desc:"Charged meteors detonate in cascading lightning.",
    bonus:{ chainDps:55, meteorRate:1.2 } },
  { id:"molten_prison", name:"Molten Prison", icon:"🔥", requires:["aura","slow_field"],
    desc:"A radiant cage that slows and melts all within reach.",
    bonus:{ auraDps:55, auraSlow:0.28, auraRadius:42 } },
  { id:"void_furnace", name:"Void Furnace", icon:"🌋", requires:["beam","meteor"],
    desc:"A blinding lance beneath a falling sky of fire.",
    bonus:{ beamDps:75, meteorDps:65 } },
  { id:"celestial_guard", name:"Celestial Guard", icon:"🛡", requires:["orbit","aura"],
    desc:"A shield of molten light — radiant, warm, and unyielding.",
    bonus:{ orbitDps:35, auraDps:42, armor:3 } },
];
export const COMBO_MAP = Object.fromEntries(COMBOS.map(c => [c.id, c]));

// ---------------- Meta upgrades (permanent, cost Star Dust) ----------------
export const META_UPGRADES = [
  { id:"core_vitality", name:"Core Vitality", icon:"❤", maxLevel:8, baseCost:20, growth:1.55,
    desc:"+12% maximum HP per level." },
  { id:"ember_core", name:"Ember Core", icon:"🔥", maxLevel:8, baseCost:20, growth:1.55,
    desc:"+8% base attack damage per level." },
  { id:"quick_hands", name:"Quick Hands", icon:"🌀", maxLevel:6, baseCost:18, growth:1.5,
    desc:"+4% movement speed per level." },
  { id:"overcharge", name:"Overcharge", icon:"⚡", maxLevel:6, baseCost:18, growth:1.5,
    desc:"+5% attack speed per level." },
  { id:"keen_eye", name:"Keen Eye", icon:"💥", maxLevel:6, baseCost:16, growth:1.5,
    desc:"+2% base crit chance per level." },
  { id:"strong_magnet", name:"Strong Magnet", icon:"🧲", maxLevel:6, baseCost:16, growth:1.5,
    desc:"+15% pickup attraction per level." },
  { id:"regeneration", name:"Regeneration", icon:"♻", maxLevel:5, baseCost:18, growth:1.55,
    desc:"+1 HP/s base regeneration per level." },
  { id:"iron_core", name:"Iron Core", icon:"🛡", maxLevel:6, baseCost:16, growth:1.5,
    desc:"+1 armor per level." },
  { id:"lucky_spark", name:"Lucky Spark", icon:"🍀", maxLevel:8, baseCost:18, growth:1.55,
    desc:"+8% luck per level — more ore & rarer forges." },
  { id:"orbit_seed", name:"Orbit Seed", icon:"🪐", maxLevel:3, baseCost:60, growth:2.1,
    desc:"Start each run with 1 extra orbiting spark and +20% orb damage." },
  { id:"first_spark", name:"First Spark", icon:"✨", maxLevel:3, baseCost:80, growth:2.2,
    desc:"Begin each run with a free ability (one per level)." },
  { id:"starmind", name:"Starmind", icon:"🧠", maxLevel:4, baseCost:70, growth:2.0,
    desc:"Sharpened intuition — rarer forges appear more often." },
];
export const META_MAP = Object.fromEntries(META_UPGRADES.map(m => [m.id, m]));
