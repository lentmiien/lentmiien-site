// game.js — Game: main loop, spawning, combat, ability systems, rendering
import { CFG, ENEMIES, ENEMIES as _E, UPGRADE_MAP, UPGRADES, COMBOS } from "./config.js";
import { Build } from "./build.js";
import { Audio } from "./audio.js";
import { ParticleField } from "./particles.js";
import { Player, Enemy, Bullet, Pickup, Meteor } from "./entities.js";
import { RNG, rand, randInt, clamp, rgba, fmt, timeFmt, pick } from "./util.js";

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = clamp(t, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.audio = Audio;
    this.world = CFG.world;
    this.particles = new ParticleField();
    this.meta = null;
    this.ui = null;
    this.state = "menu";
    this.keys = {};
    this.input = { dx: 0, dy: 0 };
    this.mouseWorld = { x: this.world.w / 2, y: 0 };
    this.viewScale = 1; this.dpr = 1;
    this.tGlobal = 0;
    this.last = 0;
    this.stars = this._makeStars();
    this.resize();
    this.attachInput();
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  _makeStars() {
    const arr = [];
    for (let i = 0; i < 130; i++) {
      arr.push({ x: rand(0, this.world.w), y: rand(0, this.world.h), r: rand(0.4, 1.8), tw: rand(0, 6.28), sp: rand(0.6, 2.2) });
    }
    return arr;
  }

  resize() {
    const parent = this.canvas.parentElement;
    const cw = parent.clientWidth, ch = parent.clientHeight;
    const scale = Math.min(cw / this.world.w, ch / this.world.h);
    this.canvas.style.width = (this.world.w * scale) + "px";
    this.canvas.style.height = (this.world.h * scale) + "px";
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.world.w * scale * this.dpr);
    this.canvas.height = Math.round(this.world.h * scale * this.dpr);
    this.viewScale = scale * this.dpr;
  }

  attachInput() {
    const kd = (e) => {
      const k = e.key.toLowerCase();
      if (["arrowup","arrowdown","arrowleft","arrowright"," "].includes(k)) e.preventDefault();
      this.keys[k] = true;
      if (k === "p") this.togglePause();
      if (k === "m" && this.ui) this.ui.toggleMute();
      if (k === "escape") { if (this.state === "paused") this.resume(); }
    };
    const ku = (e) => { this.keys[e.key.toLowerCase()] = false; };
    const mm = (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.mouseWorld.x = clamp((e.clientX - r.left) / r.width * this.world.w, 0, this.world.w);
      this.mouseWorld.y = clamp((e.clientY - r.top) / r.height * this.world.h, 0, this.world.h);
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("mousemove", mm);
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("blur", () => { if (this.state === "playing") this.pause(); });
  }

  // ---------------- lifecycle ----------------
  setMeta(m) { this.meta = m; }

  startRun() {
    this.build = new Build(this.meta.levels);
    this.player = new Player(this.world.w / 2, this.world.h / 2, this.build);
    this.enemies = []; this.bullets = []; this.pickups = [];
    this.enemyShots = []; this.meteors = []; this.chainFx = [];
    this.rng = new RNG();
    this.time = 0; this.score = 0; this.kills = 0; this.oreTotal = 0;
    this.spawnAcc = 0; this.eliteTimer = CFG.spawn.eliteEvery; this.bossTimer = CFG.spawn.bossEvery;
    this.meteorAcc = 0; this.chainTimer = 0; this.shake = 0;
    this.level = 1; this.xp = 0; this.xpNext = CFG.xpToNextLevel(1);
    this.pendingLevelUps = 0; this.orbitOrbs = []; this.beamAngle = null;
    const granted = this.build.grantStartingAbilities(this.rng);
    this.state = "playing";
    this.audio.unlock();
    this.audio.sfx("start");
    if (this.ui) this.ui.hud(this);
    if (granted.length && this.ui) this.ui.toast("✨ Spark awakened: " + granted.map(id => UPGRADE_MAP[id].name).join(", "));
  }

  togglePause() {
    if (this.state === "playing") this.pause();
    else if (this.state === "paused") this.resume();
  }
  pause() { if (this.state !== "playing") return; this.state = "paused"; if (this.ui) this.ui.showPause(); }
  resume() { if (this.state !== "paused") return; this.state = "playing"; this.last = performance.now(); if (this.ui) this.ui.hidePause(); }
  toMenu() { this.state = "menu"; if (this.ui) this.ui.showMenu(); }

  bossActive() { return this.enemies.some(e => e.def.boss); }

  choose(choice) {
    const beforeMax = this.build.s.maxHp;
    this.build.applyChoice(choice);
    const afterMax = this.build.s.maxHp;
    if (afterMax > beforeMax) this.player.hp += (afterMax - beforeMax);
    this.player.hp = Math.min(this.player.hp, this.build.s.maxHp);
    this.audio.sfx(choice.requires ? "combo" : "upgrade");
    if (this.ui) this.ui.updateAbilities(this);
    this.pendingLevelUps--;
    if (this.ui) this.ui.hideLevelup();
    if (this.pendingLevelUps > 0) {
      this.state = "levelup";
      if (this.ui) this.ui.levelup(this.build.rollChoices(this.rng, 3));
    } else this.state = "playing";
  }

  endRun(reason) {
    this.state = "gameover";
    const dust = CFG.dustFromTime(this.time) + CFG.dustFromScore(this.score);
    this.lastDust = dust;
    if (this.meta) this.meta.recordRun({ score: this.score, time: this.time, dust });
    this.audio.sfx("over");
    if (this.ui) this.ui.showGameOver({
      reason, time: this.time, level: this.level, kills: this.kills,
      score: this.score, dust, bestScore: this.meta ? this.meta.best.score : 0,
    });
  }

  // ---------------- loop ----------------
  loop(ts) {
    if (!this.last) this.last = ts;
    let dt = (ts - this.last) / 1000; this.last = ts;
    dt = Math.min(0.033, dt);
    this.tGlobal += dt;
    if (this.state === "playing") this.simulate(dt);
    else this.particles.update(dt);
    this.render();
    if (this.ui && (this.state === "playing" || this.state === "levelup" || this.state === "paused")) this.ui.hud(this);
    this._raf = requestAnimationFrame(this.loop.bind(this));
  }

  simulate(dt) {
    this.time += dt;
    this.score += dt * 2; // passive survival score
    this._inputVec();
    this.player.update(dt, this.input, this);
    this._spawn(dt);
    this._slowPass();
    for (const e of this.enemies) e.update(dt, this);
    this._separation();
    this._combat(dt);
    this._updateBullets(dt);
    this._updateEnemyShots(dt);
    this._updatePickups(dt);
    this._updateMeteors(dt);
    this._finalizeKills();
    this.shake = Math.max(0, this.shake - dt * 32);
    this.particles.update(dt);
    this._checkLevelup();
    if (this.player.hp <= 0) this.endRun("Consumed by the void.");
  }

  _inputVec() {
    const k = this.keys;
    let dx = (k["d"] || k["arrowright"] ? 1 : 0) - (k["a"] || k["arrowleft"] ? 1 : 0);
    let dy = (k["s"] || k["arrowdown"] ? 1 : 0) - (k["w"] || k["arrowup"] ? 1 : 0);
    this.input = { dx, dy };
  }

  // ---------------- spawning ----------------
  _edgePos() {
    const W = this.world.w, H = this.world.h, m = 34;
    const side = (Math.random() * 4) | 0;
    if (side === 0) return { x: rand(0, W), y: -m };
    if (side === 1) return { x: W + m, y: rand(0, H) };
    if (side === 2) return { x: rand(0, W), y: H + m };
    return { x: -m, y: rand(0, H) };
  }

  _spawn(dt) {
    const s = CFG.spawn;
    const interval = Math.max(s.minInterval, s.startInterval - (this.time / s.ramp) * (s.startInterval - s.minInterval));
    this.spawnAcc += dt / interval;
    let burst = 1;
    if (this.time > 180) burst = 2;
    if (this.time > 420) burst = 3;
    let guard = 0;
    while (this.spawnAcc >= 1 && this.enemies.length < CFG.enemiesMax && guard < 8) {
      this.spawnAcc -= 1; guard++;
      for (let i = 0; i < burst; i++) this._spawnOne(false);
    }
    // elites
    this.eliteTimer -= dt;
    if (this.eliteTimer <= 0 && !this.bossActive()) { this.eliteTimer = s.eliteEvery; this._spawnOne(true); }
    // boss
    this.bossTimer -= dt;
    if (this.bossTimer <= 0 && !this.bossActive()) { this.bossTimer = s.bossEvery; this._spawnBoss(); }
  }

  _weightedDef() {
    const t = this.time;
    const pool = Object.values(ENEMIES).filter(e => !e.boss && e.minWave <= t);
    const def = pool[(Math.random() * pool.length) | 0];
    return def;
  }

  _spawnOne(elite) {
    const t = this.time; const s = CFG.spawn;
    let def;
    if (elite) {
      const cands = Object.values(ENEMIES).filter(e => e.elite && !e.boss && e.minWave <= t);
      def = (cands.length && Math.random() < 0.7) ? pick(cands) : this._weightedDef();
    } else def = this._weightedDef();
    const pos = this._edgePos();
    const hpScale = s.hpScale(t) * (elite ? 4.5 : 1);
    const dmgScale = s.dmgScale(t) * (elite ? 1.3 : 1);
    const speedScale = s.speedScale(t);
    const e = new Enemy(def, pos.x, pos.y, { hpScale, dmgScale, speedScale });
    if (elite) { e.radius *= 1.5; e.elite = true; }
    this.enemies.push(e);
  }

  _spawnBoss() {
    const t = this.time; const s = CFG.spawn;
    const def = ENEMIES.dread;
    const e = new Enemy(def, this.world.w / 2 + rand(-120, 120), -60, {
      hpScale: s.hpScale(t) * 2.2, dmgScale: s.dmgScale(t), speedScale: s.speedScale(t),
    });
    this.enemies.push(e);
    this.shake = Math.min(26, this.shake + 14);
    this.audio.sfx("boss");
    if (this.ui) this.ui.toast("☠ <span class='g'>Dreadforge</span> descends into the forge!");
    // boss roar: periodic spawns handled in _combat
    this.bossRoar = 4;
  }

  // ---------------- slow / combat ----------------
  _slowPass() {
    const b = this.build.s;
    for (const e of this.enemies) e.slow = 1;
    if (b.globalSlow > 0) for (const e of this.enemies) e.slow *= (1 - b.globalSlow);
    if (b.auraDps > 0) {
      for (const e of this.enemies) {
        if (Math.hypot(e.x - this.player.x, e.y - this.player.y) < b.auraRadius + e.radius) e.slow *= (1 - b.auraSlow);
      }
    }
  }

  deal(e, amount, { crit = false, tick = false, color = "#ffd27a" } = {}) {
    if (e.hp <= 0) return;
    e.hp -= amount;
    e.hitFlash = Math.max(e.hitFlash, tick ? 0.35 : 1);
    if (tick) {
      if (Math.random() < 0.18) this.particles.burst(e.x, e.y, { count: 1, color, speed: [30, 90], life: [0.2, 0.4], size: [1, 2.5] });
    } else {
      this.particles.text(e.x, e.y - e.radius, (crit ? "✦" : "") + Math.round(amount), crit ? "#ffd76a" : "#ffffff", crit ? 18 : 13);
      this.particles.burst(e.x, e.y, { count: 4, color, speed: [50, 150], life: [0.25, 0.5], size: [1.5, 3] });
    }
    if (e.hp <= 0) e.dead = true;
  }

  _combat(dt) {
    const b = this.build.s, p = this.player;
    // player contact
    for (const e of this.enemies) {
      if (Math.hypot(e.x - p.x, e.y - p.y) < e.radius + p.radius) {
        if (p.iframes <= 0) { const d = Math.atan2(e.y - p.y, e.x - p.x); p.hurt(e.damage, this); e.x += Math.cos(d) * 6; e.y += Math.sin(d) * 6; }
      }
    }
    // auto-attack
    p.attackCd -= dt;
    const targets = this.enemies.filter(e => e.hp > 0);
    if (targets.length && p.attackCd <= 0) {
      // nearest target
      let t = targets[0], td = Infinity;
      for (const e of targets) { const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (d < td) { td = d; t = e; } }
      p.attackCd = 1 / b.attackRate;
      const baseA = Math.atan2(t.y - p.y, t.x - p.x);
      const count = b.multishot;
      const spread = 0.14;
      for (let i = 0; i < count; i++) {
        const off = count > 1 ? (i - (count - 1) / 2) * spread : 0;
        const a = baseA + off;
        const crit = Math.random() < b.critChance;
        const dmg = b.damage * (crit ? b.critMult : 1);
        const sp = b.bulletSpeed;
        this.bullets.push(new Bullet(p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14, Math.cos(a) * sp, Math.sin(a) * sp, dmg, b.pierce, crit ? 5 : 4, 1.5, crit ? "#ffd76a" : "#ffd27a"));
      }
      if (this.bullets.length > CFG.bulletsMax) this.bullets.splice(0, this.bullets.length - CFG.bulletsMax);
      this.audio.sfx("shoot");
      this.particles.sparkTrail(p.x, p.y, baseA, "#ffd27a", 2);
    }
    // ability systems
    this._abilities(dt);
    // boss roar spawns
    if (this.bossActive()) {
      this.bossRoar -= dt;
      if (this.bossRoar <= 0) {
        this.bossRoar = 5;
        for (let i = 0; i < 4; i++) { const a = rand(0, 6.283); const bo = this.enemies.find(e => e.def.boss); const pos = { x: bo.x + Math.cos(a) * 60, y: bo.y + Math.sin(a) * 60 }; this._spawnFrom(pos, "mote", 1); }
      }
    }
    // bullets vs enemies
    for (const bl of this.bullets) {
      if (bl.dead) continue;
      let best = null, bd = Infinity;
      for (const e of this.enemies) {
        if (e.hp <= 0 || bl.hit.has(e)) continue;
        const r = e.radius + bl.radius;
        const d2 = (e.x - bl.x) ** 2 + (e.y - bl.y) ** 2;
        if (d2 < r * r && d2 < bd) { bd = d2; best = e; }
      }
      if (best) {
        bl.hit.add(best);
        const crit = bl.color === "#ffd76a";
        this.deal(best, bl.damage, { crit });
        this.audio.sfx("hit");
        if (bl.pierce > 0) bl.pierce--; else bl.dead = true;
      }
    }
  }

  _spawnFrom(pos, id, mult) {
    const def = ENEMIES[id]; const s = CFG.spawn;
    const e = new Enemy(def, pos.x, pos.y, { hpScale: s.hpScale(this.time) * mult, dmgScale: s.dmgScale(this.time), speedScale: s.speedScale(this.time) });
    this.enemies.push(e);
  }

  _abilities(dt) {
    const b = this.build.s, p = this.player;
    // orbiting sparks
    this.orbitOrbs = [];
    if (b.orbitCount > 0) {
      const base = this.tGlobal * 1.9;
      for (let i = 0; i < b.orbitCount; i++) {
        const a = base + i / b.orbitCount * 6.283;
        this.orbitOrbs.push({ x: p.x + Math.cos(a) * b.orbitRadius, y: p.y + Math.sin(a) * b.orbitRadius });
      }
      for (const o of this.orbitOrbs) {
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          if (Math.hypot(e.x - o.x, e.y - o.y) < e.radius + 9) this.deal(e, b.orbitDps * dt, { tick: true, color: "#b98cff" });
        }
      }
    }
    // nova beam
    if (b.beamDps > 0) {
      const aim = Math.atan2(this.mouseWorld.y - p.y, this.mouseWorld.x - p.x);
      this.beamAngle = aim; this.beamLen = 400;
      const bx = p.x + Math.cos(aim) * this.beamLen, by = p.y + Math.sin(aim) * this.beamLen;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (segDist(e.x, e.y, p.x, p.y, bx, by) < b.beamWidth / 2 + e.radius) this.deal(e, b.beamDps * dt, { tick: true, color: "#ffd27a" });
      }
    } else this.beamAngle = null;
    // molten aura
    if (b.auraDps > 0) {
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        if (Math.hypot(e.x - p.x, e.y - p.y) < b.auraRadius + e.radius) this.deal(e, b.auraDps * dt, { tick: true, color: "#ff9a3c" });
      }
    }
    // volt chain (periodic)
    this.chainTimer -= dt;
    if (b.chainDps > 0 && this.chainTimer <= 0) { this.chainTimer = 0.55; this._doChain(); }
  }

  _doChain() {
    const b = this.build.s, p = this.player;
    const list = this.enemies.filter(e => e.hp > 0);
    if (!list.length) return;
    let origin = list[0], od = Infinity;
    for (const e of list) { const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2; if (d < od) { od = d; origin = e; } }
    const path = [origin]; const used = new Set([origin]); let cur = origin;
    const jumps = Math.max(0, b.chainCount - 1);
    for (let s = 0; s < jumps; s++) {
      let best = null, bd = Infinity;
      for (const e of list) { if (used.has(e)) continue; const d = Math.hypot(e.x - cur.x, e.y - cur.y); if (d < b.chainRange && d < bd) { bd = d; best = e; } }
      if (!best) break; used.add(best); path.push(best); cur = best;
    }
    for (let i = 0; i < path.length; i++) this.deal(path[i], b.chainDps * (i === 0 ? 1 : 0.7), { color: "#9a7bff" });
    this.chainFx.push({ pts: path.map(e => ({ x: e.x, y: e.y })), life: 0.2, max: 0.2 });
    this.audio.sfx("hit");
  }

  _updateBullets(dt) {
    for (const bl of this.bullets) { bl.update(dt); if (bl.x < -20 || bl.x > this.world.w + 20 || bl.y < -20 || bl.y > this.world.h + 20) bl.dead = true; }
    this.bullets = this.bullets.filter(b => !b.dead);
  }

  _spawnEnemyShot(e) {
    const p = this.player; const a = Math.atan2(p.y - e.y, p.x - e.x); const sp = 260;
    this.enemyShots.push({ x: e.x, y: e.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 6, damage: e.damage, life: 3 });
  }
  _updateEnemyShots(dt) {
    const p = this.player;
    for (const s of this.enemyShots) {
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) s.dead = true;
      if (s.x < -20 || s.x > this.world.w + 20 || s.y < -20 || s.y > this.world.h + 20) s.dead = true;
      if (!s.dead && Math.hypot(s.x - p.x, s.y - p.y) < s.r + p.radius) { if (p.iframes <= 0) p.hurt(s.damage, this); s.dead = true; }
    }
    this.enemyShots = this.enemyShots.filter(s => !s.dead);
  }

  _updatePickups(dt) {
    for (const pk of this.pickups) pk.update(dt, this);
    this.pickups = this.pickups.filter(pk => !pk.dead);
  }
  _updateMeteors(dt) {
    for (const m of this.meteors) m.update(dt, this);
    this.meteors = this.meteors.filter(m => !m.dead);
    const b = this.build.s;
    if (b.meteorRate > 0) {
      this.meteorAcc += b.meteorRate * dt;
      while (this.meteorAcc >= 1) { this.meteorAcc -= 1; this._spawnMeteor(); }
    }
  }
  _spawnMeteor() {
    const b = this.build.s, p = this.player;
    const near = this.enemies.filter(e => e.hp > 0 && Math.hypot(e.x - p.x, e.y - p.y) < 360);
    let tx, ty;
    if (near.length) { const t = near[(Math.random() * near.length) | 0]; tx = t.x + rand(-24, 24); ty = t.y + rand(-24, 24); }
    else { const a = rand(0, 6.283), r = rand(40, 220); tx = p.x + Math.cos(a) * r; ty = p.y + Math.sin(a) * r; }
    tx = clamp(tx, 30, this.world.w - 30); ty = clamp(ty, 30, this.world.h - 30);
    this.meteors.push(new Meteor(tx, ty, 54, b.meteorDps, 0.85));
  }
  meteorImpact(m) {
    for (const e of this.enemies) {
      if (e.hp <= 0) continue;
      const d = Math.hypot(e.x - m.x, e.y - m.y);
      if (d < m.radius + e.radius) { const fall = 1 - (d / (m.radius + e.radius)) * 0.4; this.deal(e, m.damage * fall, { color: "#ff9a3c" }); }
    }
    this.particles.burst(m.x, m.y, { count: 24, color: "#ff9a3c", speed: [80, 340], life: [0.4, 0.9], size: [2, 6] });
    this.particles.ring(m.x, m.y, { r: 12, color: "#ff9a3c", dur: 0.5, grow: 80 });
    this.shake = Math.min(20, this.shake + 8);
    this.audio.sfx("kill");
  }

  _separation() {
    const E = this.enemies; if (E.length < 2) return;
    const cell = 60; const buckets = new Map();
    for (let i = 0; i < E.length; i++) {
      const e = E[i]; const k = ((e.x / cell) | 0) + ":" + ((e.y / cell) | 0);
      let b = buckets.get(k); if (!b) { b = []; buckets.set(k, b); } b.push(i);
    }
    for (let i = 0; i < E.length; i++) {
      const e = E[i]; const cx = (e.x / cell) | 0, cy = (e.y / cell) | 0;
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const b = buckets.get(gx + ":" + gy); if (!b) continue;
        for (const j of b) {
          if (j <= i) continue; const o = E[j];
          const dx = o.x - e.x, dy = o.y - e.y; const d2 = dx * dx + dy * dy; const min = e.radius + o.radius;
          if (d2 > 0 && d2 < min * min) {
            const d = Math.sqrt(d2); const push = (min - d) * 0.5; const nx = dx / d, ny = dy / d;
            e.x -= nx * push; e.y -= ny * push; o.x += nx * push; o.y += ny * push;
          }
        }
      }
    }
  }

  // ---------------- kills / drops ----------------
  _finalizeKills() {
    const dead = this.enemies.filter(e => e.dead);
    if (dead.length) { for (const e of dead) this._onKill(e); this.enemies = this.enemies.filter(e => !e.dead); }
  }
  _onKill(e) {
    this.kills++;
    this.score += Math.round(e.def.xp * 2) + (e.elite ? 60 : 0) + (e.boss ? 1200 : 0);
    const ls = this.build.s.lifesteal; if (ls > 0) this.player.heal(ls);
    this.pickups.push(new Pickup(e.x, e.y, "xp", e.def.xp));
    const ore = e.def.ore * (1 + this.build.s.luck);
    if (ore > 0) this.pickups.push(new Pickup(e.x + rand(-8, 8), e.y + rand(-8, 8), "ore", ore));
    const col = e.def.color;
    this.particles.burst(e.x, e.y, { count: e.boss ? 44 : e.elite ? 20 : 9, color: col, speed: [60, e.boss ? 420 : 260], life: [0.4, 0.9], size: [2, 6] });
    this.particles.ring(e.x, e.y, { r: 6, color: col, dur: 0.4, grow: e.boss ? 140 : 44 });
    this.audio.sfx("kill");
    if (e.def.splits) {
      const n = e.def.splits; const s = CFG.spawn;
      for (let i = 0; i < n; i++) {
        const c = new Enemy(ENEMIES.mote, e.x + rand(-12, 12), e.y + rand(-12, 12), { hpScale: s.hpScale(this.time) * 0.5, dmgScale: s.dmgScale(this.time), speedScale: 1.2 });
        c.radius = 8; this.enemies.push(c);
      }
    }
    if (e.boss) { this.shake = 26; this.audio.sfx("boss"); this.particles.ring(e.x, e.y, { r: 24, color: "#ff9a3c", dur: 0.9, grow: 260 }); }
  }

  // ---------------- pickups / xp ----------------
  collectPickup(pk) {
    if (pk.type === "ore") {
      this.score += Math.round(pk.value * 14);
      this.oreTotal += pk.value;
      this.audio.sfx("ore");
      this.particles.burst(pk.x, pk.y, { count: 3, color: "#5ef2d6", speed: [40, 120], life: [0.2, 0.4], size: [1, 2.5] });
    } else {
      this.xp += pk.value;
      this.audio.sfx("pickup");
      while (this.xp >= this.xpNext) { this.xp -= this.xpNext; this.level++; this.xpNext = CFG.xpToNextLevel(this.level); this.pendingLevelUps++; }
    }
  }

  _checkLevelup() {
    if (this.pendingLevelUps > 0 && this.state === "playing") {
      this.state = "levelup";
      this.audio.sfx("level");
      if (this.ui) this.ui.levelup(this.build.rollChoices(this.rng, 3));
    }
  }

  // ---------------- rendering ----------------
  render() {
    const ctx = this.ctx;
    const sh = this.shake;
    const sx = (Math.random() * 2 - 1) * sh, sy = (Math.random() * 2 - 1) * sh;
    ctx.setTransform(this.viewScale, 0, 0, this.viewScale, sx * this.viewScale, sy * this.viewScale);
    const W = this.world.w, H = this.world.h;
    ctx.clearRect(-80, -80, W + 160, H + 160);
    this._drawBackground(ctx);
    if (this.state === "menu") { this.particles.draw(ctx); return; }
    // pickups
    for (const pk of this.pickups) pk.draw(ctx);
    // enemies
    for (const e of this.enemies) e.draw(ctx);
    // player
    if (this.player) this.player.draw(ctx, this.tGlobal);
    // orbit orbs
    for (const o of this.orbitOrbs) this._drawOrb(ctx, o.x, o.y);
    // bullets
    for (const b of this.bullets) b.draw(ctx);
    // enemy shots
    for (const s of this.enemyShots) this._drawEnemyShot(ctx, s);
    // beam
    if (this.beamAngle !== null && this.player) this._drawBeam(ctx);
    // chains
    this._drawChains(ctx);
    // meteors
    for (const m of this.meteors) m.draw(ctx);
    // particles
    this.particles.draw(ctx);
    this._drawOverlay(ctx);
  }

  _drawBackground(ctx) {
    const W = this.world.w, H = this.world.h;
    const g = ctx.createRadialGradient(W / 2, H * 0.3, 60, W / 2, H / 2, W * 0.75);
    g.addColorStop(0, "#120e26"); g.addColorStop(0.5, "#0a0818"); g.addColorStop(1, "#07060d");
    ctx.fillStyle = g; ctx.fillRect(-80, -80, W + 160, H + 160);
    // nebula wisps
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const nx = W / 2 + Math.sin(this.tGlobal * 0.1) * 120, ny = H * 0.4;
    let ng = ctx.createRadialGradient(nx, ny, 0, nx, ny, 260);
    ng.addColorStop(0, "rgba(185,140,255,0.06)"); ng.addColorStop(1, "rgba(185,140,255,0)");
    ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(nx, ny, 260, 0, 6.283); ctx.fill();
    const ex = W * 0.7, ey = H * 0.7;
    ng = ctx.createRadialGradient(ex, ey, 0, ex, ey, 220);
    ng.addColorStop(0, "rgba(255,154,60,0.05)"); ng.addColorStop(1, "rgba(255,154,60,0)");
    ctx.fillStyle = ng; ctx.beginPath(); ctx.arc(ex, ey, 220, 0, 6.283); ctx.fill();
    ctx.restore();
    // stars
    for (const s of this.stars) {
      const a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(this.tGlobal * s.sp + s.tw));
      ctx.fillStyle = rgba("#cfd0ff", a);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
    }
  }

  _drawOrb(ctx, x, y) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(x, y, 0, x, y, 18);
    g.addColorStop(0, "rgba(199,182,255,0.95)");
    g.addColorStop(0.5, "rgba(150,110,255,0.5)");
    g.addColorStop(1, "rgba(150,110,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 18, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#efe8ff"; ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  _drawEnemyShot(ctx, s) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 2.4);
    g.addColorStop(0, "rgba(255,210,122,0.9)"); g.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2.4, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff2cf"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.6, 0, 6.283); ctx.fill();
    ctx.restore();
  }

  _drawBeam(ctx) {
    const p = this.player, b = this.build.s;
    const a = this.beamAngle, len = this.beamLen || 400;
    const x2 = p.x + Math.cos(a) * len, y2 = p.y + Math.sin(a) * len;
    const px = -Math.sin(a), py = Math.cos(a); const w = b.beamWidth / 2;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const grd = ctx.createLinearGradient(p.x, p.y, x2, y2);
    grd.addColorStop(0, "rgba(255,222,150,0.85)");
    grd.addColorStop(1, "rgba(255,120,40,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(p.x + px * w * 0.4, p.y + py * w * 0.4);
    ctx.lineTo(x2 + px * w, y2 + py * w);
    ctx.lineTo(x2 - px * w, y2 - py * w);
    ctx.lineTo(p.x - px * w * 0.4, p.y - py * w * 0.4);
    ctx.closePath(); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(255,240,200,0.9)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  _drawChains(ctx) {
    for (const c of this.chainFx) {
      const k = c.life / c.max;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = rgba("#9a7bff", 0.9 * k);
      ctx.lineWidth = 3 * k + 0.5;
      ctx.beginPath();
      c.pts.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
      ctx.stroke();
      ctx.strokeStyle = rgba("#ffffff", 0.8 * k);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      c.life -= 1 / 60;
    }
    this.chainFx = this.chainFx.filter(c => c.life > 0);
  }

  _drawOverlay(ctx) {
    const W = this.world.w, H = this.world.h;
    // vignette
    const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.7);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = v; ctx.fillRect(-80, -80, W + 160, H + 160);
    // hurt flash
    if (this.player && this.player.hurtFlash > 0) {
      ctx.fillStyle = rgba("#ff2a2a", this.player.hurtFlash * 0.28);
      ctx.fillRect(-80, -80, W + 160, H + 160);
    }
    // low-hp pulse
    if (this.player && this.build && this.player.hp / this.build.s.maxHp < 0.3) {
      const pulse = 0.12 + 0.1 * Math.sin(this.tGlobal * 5);
      const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.62);
      g.addColorStop(0, "rgba(255,0,0,0)"); g.addColorStop(1, rgba("#ff2a2a", pulse));
      ctx.fillStyle = g; ctx.fillRect(-80, -80, W + 160, H + 160);
    }
  }
}
