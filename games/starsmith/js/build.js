// build.js — Build: the player's stat block + owned upgrades + forge combos + meta bonuses
import { CFG, UPGRADES, UPGRADE_MAP, COMBOS, META_UPGRADES } from "./config.js";

export class Build {
  constructor(metaLevels = {}) {
    this.owned = {};                 // upgradeId -> stacks
    this.combosForged = new Set();   // combo ids
    this.metaLevels = metaLevels;
    this.rareBonus = 0;
    this.startAbilities = 0;
    this.orbitSeedMult = 1;
    this.base = this._computeBase(metaLevels);
    this.s = {};
    this.recalc();
  }

  _computeBase(ml) {
    const b = { ...CFG.playerBase };
    let hp = 1, dmg = 1, spd = 1, mag = 1, rate = 1;
    let luck = 0, regen = 0, crit = 0, armor = 0, orbitStart = 0, orbitMult = 1, startAbil = 0, rare = 0;
    for (const m of META_UPGRADES) {
      const lvl = ml[m.id] || 0;
      if (!lvl) continue;
      switch (m.id) {
        case "core_vitality": hp += 0.12 * lvl; break;
        case "ember_core": dmg += 0.08 * lvl; break;
        case "quick_hands": spd += 0.04 * lvl; break;
        case "overcharge": rate += 0.05 * lvl; break;
        case "keen_eye": crit += 0.02 * lvl; break;
        case "strong_magnet": mag += 0.15 * lvl; break;
        case "regeneration": regen += 1 * lvl; break;
        case "iron_core": armor += 1 * lvl; break;
        case "lucky_spark": luck += 0.08 * lvl; break;
        case "orbit_seed": orbitStart += lvl; orbitMult += 0.2 * lvl; break;
        case "first_spark": startAbil += lvl; break;
        case "starmind": rare += 0.2 * lvl; break;
      }
    }
    b.maxHp *= hp; b.damage *= dmg; b.moveSpeed *= spd; b.magnet *= mag; b.attackRate *= rate;
    b.luck += luck; b.regen += regen; b.critChance += crit; b.armor += armor;
    b.orbitCount += orbitStart; b.orbitDps *= orbitMult;
    this.rareBonus = rare;
    this.startAbilities = startAbil;
    this.orbitSeedMult = orbitMult;
    return b;
  }

  recalc() {
    const s = { ...this.base };
    // apply owned upgrades in deterministic (catalog) order
    for (const u of UPGRADES) {
      const st = this.owned[u.id];
      if (st) u.apply({ s }, st);
    }
    // apply forged combos
    for (const c of COMBOS) {
      if (this.combosForged.has(c.id)) {
        for (const k in c.bonus) s[k] = (s[k] || 0) + c.bonus[k];
      }
    }
    s.globalSlow = Math.min(0.5, Math.max(0, s.globalSlow));
    s.critChance = Math.min(0.95, Math.max(0, s.critChance));
    s.auraSlow = Math.min(0.6, Math.max(0, s.auraSlow));
    s.maxHp = Math.max(1, s.maxHp);
    this.s = s;
    return s;
  }

  level(id) { return this.owned[id] || 0; }
  has(id) { return (this.owned[id] || 0) > 0; }
  maxed(id) { const u = UPGRADE_MAP[id]; return u ? this.level(id) >= u.maxStacks : true; }

  grantStartingAbilities(rng) {
    if (this.startAbilities <= 0) return [];
    const pool = ["orbit", "beam", "chain", "meteor", "aura"];
    // Fisher-Yates
    for (let i = pool.length - 1; i > 0; i--) { const j = rng.int(0, i); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const count = Math.min(this.startAbilities, pool.length);
    const granted = [];
    for (let i = 0; i < count; i++) { this.owned[pool[i]] = (this.owned[pool[i]] || 0) + 1; granted.push(pool[i]); }
    this.recalc();
    return granted;
  }

  // Return `n` distinct upgrade/combo choices.
  rollChoices(rng, n = 3) {
    const luck = this.s.luck + this.rareBonus;
    const pool = [];
    for (const u of UPGRADES) {
      if (this.maxed(u.id)) continue;
      let w = u.weight;
      if (u.tier === 2) w *= 1.35 + (luck) * 1.5;
      else w *= 1 + luck * 0.6;
      const st = this.level(u.id);
      if (st > 0) w *= 1 / (1 + 0.5 * st); // gentle penalty for high stacks
      pool.push({ choice: u, w });
    }
    // Golden combo candidates
    for (const c of COMBOS) {
      if (this.combosForged.has(c.id)) continue;
      if (!c.requires.every(r => this.has(r))) continue;
      pool.push({ choice: c, w: 70 + luck * 10, golden: true });
    }
    const out = [];
    while (out.length < n && pool.length) {
      let total = 0; for (const p of pool) total += p.w;
      let x = rng.range(0, total), idx = 0;
      for (let i = 0; i < pool.length; i++) { x -= pool[i].w; if (x <= 0) { idx = i; break; } }
      const chosen = pool.splice(idx, 1)[0];
      out.push(chosen.choice);
    }
    return out;
  }

  applyChoice(choice) {
    if (choice.requires) this.combosForged.add(choice.id);
    else this.owned[choice.id] = (this.owned[choice.id] || 0) + 1;
    this.recalc();
    // vitality heal handled by caller via delta; return current maxHp
    return this.s.maxHp;
  }
}
