// meta.js — permanent progression + persistence (Star Dust bank, best scores)
import { CFG, META_UPGRADES, META_MAP } from "./config.js";

export class Meta {
  constructor() {
    this.levels = {};          // metaId -> level
    this.stardust = 0;         // bank
    this.best = { score: 0, time: 0 };
    this.runs = 0;
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(CFG.saveKey);
      if (!raw) return;
      const d = JSON.parse(raw);
      this.levels = d.levels || {};
      this.stardust = d.stardust || 0;
      this.best = d.best || { score: 0, time: 0 };
      this.runs = d.runs || 0;
    } catch (e) { /* ignore corrupt save */ }
  }

  save() {
    try {
      localStorage.setItem(CFG.saveKey, JSON.stringify({
        levels: this.levels, stardust: this.stardust, best: this.best, runs: this.runs,
      }));
    } catch (e) { /* storage may be unavailable */ }
  }

  level(id) { return this.levels[id] || 0; }
  maxed(id) { const m = META_MAP[id]; return m ? this.level(id) >= m.maxLevel : true; }

  cost(id) {
    const m = META_MAP[id];
    const lvl = this.level(id);
    return Math.round(m.baseCost * Math.pow(m.growth, lvl));
  }

  canBuy(id) {
    if (this.maxed(id)) return false;
    return this.stardust >= this.cost(id);
  }

  buy(id) {
    if (!this.canBuy(id)) return false;
    this.stardust -= this.cost(id);
    this.levels[id] = this.level(id) + 1;
    this.save();
    return true;
  }

  addDust(n) { this.stardust += Math.max(0, Math.floor(n)); }

  recordRun({ score = 0, time = 0, dust = 0 } = {}) {
    this.runs += 1;
    if (score > this.best.score) this.best.score = score;
    if (time > this.best.time) this.best.time = time;
    this.addDust(dust);
    this.save();
  }

  get levelsObj() { return this.levels; }
  reset() { this.levels = {}; this.stardust = 0; this.save(); }
}
