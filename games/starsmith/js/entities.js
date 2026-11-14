// entities.js — Player, Enemy, Bullet, Pickup, Meteor
import { rand, rgba } from "./util.js";

export class Player {
  constructor(x, y, build) {
    this.x = x; this.y = y; this.build = build;
    this.hp = build.s.maxHp;
    this.radius = 13;
    this.aim = -Math.PI / 2;
    this.attackCd = 0;
    this.iframes = 0;
    this.hurtFlash = 0;
    this.hasInput = false;
    this.moveDir = -Math.PI / 2;
  }
  update(dt, input, game) {
    let dx = input.dx, dy = input.dy;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const spd = this.build.s.moveSpeed;
    this.x += dx * spd * dt;
    this.y += dy * spd * dt;
    const r = this.radius;
    this.x = Math.max(r, Math.min(game.world.w - r, this.x));
    this.y = Math.max(r, Math.min(game.world.h - r, this.y));
    this.hasInput = len > 0.02;
    if (this.hasInput) this.moveDir = Math.atan2(dy, dx);
    this.iframes = Math.max(0, this.iframes - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.4);
    // regen
    const regen = this.build.s.regen;
    if (regen > 0 && this.hp < this.build.s.maxHp) this.hp = Math.min(this.build.s.maxHp, this.hp + regen * dt);
  }
  heal(n) { this.hp = Math.min(this.build.s.maxHp, this.hp + n); }
  hurt(n, game) {
    if (this.iframes > 0) return false;
    const armor = this.build.s.armor;
    const dealt = Math.max(1, n - armor);
    this.hp -= dealt;
    this.iframes = 0.55;
    this.hurtFlash = 1;
    game.shake = Math.min(22, game.shake + 6 + dealt * 0.12);
    game.particles.burst(this.x, this.y, { count: 12, color: "#ff6a4a", speed: [80, 260], life: [0.3, 0.7], size: [2, 5] });
    game.audio.sfx("hurt");
    return true;
  }
  draw(ctx, t) {
    const b = this.build.s;
    const x = this.x, y = this.y;
    ctx.save();
    // aura field
    if (b.auraRadius > 0) {
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(x, y, 0, x, y, b.auraRadius);
      g.addColorStop(0, "rgba(255,154,60,0.16)");
      g.addColorStop(1, "rgba(255,154,60,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, b.auraRadius, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
    }
    // outer glow
    const gl = ctx.createRadialGradient(x, y, 0, x, y, 28);
    gl.addColorStop(0, "rgba(255,222,150,0.95)");
    gl.addColorStop(0.5, "rgba(255,154,60,0.32)");
    gl.addColorStop(1, "rgba(255,154,60,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(x, y, 28, 0, 6.283); ctx.fill();
    // rotating wings
    const rot = t * 2.4;
    ctx.strokeStyle = "rgba(255,222,150,0.9)";
    ctx.lineWidth = 3; ctx.lineCap = "round";
    for (const off of [0, Math.PI]) {
      ctx.beginPath(); ctx.arc(x, y, 15.5, rot + off - 0.75, rot + off + 0.75); ctx.stroke();
    }
    // orbit ring guide
    if (b.orbitCount > 0) {
      ctx.strokeStyle = "rgba(185,140,255,0.18)";
      ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
      ctx.beginPath(); ctx.arc(x, y, b.orbitRadius, 0, 6.283); ctx.stroke();
      ctx.setLineDash([]);
    }
    // core
    ctx.fillStyle = this.hurtFlash > 0.3 ? "#ffffff" : "#fff2cf";
    ctx.beginPath(); ctx.arc(x, y, 8.5, 0, 6.283); ctx.fill();
    ctx.fillStyle = "rgba(255,154,60,0.95)";
    ctx.beginPath(); ctx.arc(x, y, 4, 0, 6.283); ctx.fill();
    ctx.restore();
  }
}

export class Enemy {
  constructor(def, x, y, { hpScale = 1, dmgScale = 1, speedScale = 1 } = {}) {
    this.def = def; this.x = x; this.y = y;
    this.radius = def.radius;
    this.maxHp = def.hp * hpScale;
    this.hp = this.maxHp;
    this.damage = def.damage * dmgScale;
    this.speed = def.speed * speedScale;
    this.baseSpeed = this.speed;
    this.slow = 1;
    this.t = Math.random() * 6.28;
    this.aim = 0;
    this.hitFlash = 0;
    this.shootCd = def.ranged ? rand(1.2, 2.4) : 0;
    this.boss = !!def.boss;
    this.elite = !!def.elite;
    this.deathT = 0;
    this.dying = false;
  }
  update(dt, game) {
    this.t += dt;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 4);
    const p = game.player;
    const dx = p.x - this.x, dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d, ny = dy / d;
    this.aim = Math.atan2(ny, nx);
    const mv = this.slow;
    const type = this.def.type;
    if (type === "chase" || this.def.boss) {
      this.x += nx * this.speed * mv * dt;
      this.y += ny * this.speed * mv * dt;
    } else if (type === "swarm") {
      const wob = Math.sin(this.t * 5 + this.x * 0.02) * 0.5;
      const a = Math.atan2(ny, nx) + wob;
      this.x += Math.cos(a) * this.speed * mv * dt;
      this.y += Math.sin(a) * this.speed * mv * dt;
    } else if (type === "splitter") {
      this.x += nx * this.speed * mv * dt;
      this.y += ny * this.speed * mv * dt;
    } else if (type === "ranged") {
      const desired = 230;
      const push = d > desired + 30 ? 1 : (d < desired - 30 ? -0.6 : 0);
      this.x += nx * this.speed * mv * push * dt;
      this.y += ny * this.speed * mv * push * dt;
      this.shootCd -= dt * mv;
      if (this.shootCd <= 0) { game.spawnEnemyShot(this); this.shootCd = rand(1.6, 2.6); }
    }
  }
  hit(dmg, { crit = false } = {}) {
    this.hp -= dmg;
    this.hitFlash = 1;
    if (this.hp <= 0 && !this.dying) { this.dying = true; }
    return this.hp <= 0;
  }
  draw(ctx) {
    const c = this.def.color;
    const x = this.x, y = this.y, r = this.radius;
    ctx.save();
    // glow
    ctx.globalCompositeOperation = "lighter";
    const gr = this.boss ? 3.2 : 2.2;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * gr);
    g.addColorStop(0, rgba(c, this.boss ? 0.6 : 0.42));
    g.addColorStop(1, rgba(c, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * gr, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    // body
    const body = this.hitFlash > 0.3 ? "#ffffff" : c;
    ctx.fillStyle = rgba(c, 0.9);
    ctx.strokeStyle = this.hitFlash > 0.3 ? "#ffffff" : "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (this.def.shape === "circle") {
      ctx.arc(x, y, r, 0, 6.283);
    } else {
      const s = this.def.sides || 5;
      for (let i = 0; i < s; i++) {
        const a = this.t * 0.5 + (i / s) * 6.283;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
      }
      ctx.closePath();
    }
    ctx.fill(); ctx.stroke();
    // core eye
    ctx.fillStyle = "rgba(8,6,16,0.82)";
    ctx.beginPath();
    ctx.arc(x + Math.cos(this.aim) * r * 0.3, y + Math.sin(this.aim) * r * 0.3, r * 0.3, 0, 6.283);
    ctx.fill();
    ctx.restore();
    // hp bar for elites/boss
    if ((this.elite || this.boss) && this.hp < this.maxHp) {
      const w = this.boss ? 70 : 26;
      const k = Math.max(0, this.hp / this.maxHp);
      ctx.save();
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(x - w / 2, y - r - 12, w, 4);
      ctx.fillStyle = this.boss ? "#ff5a6a" : "#ffd27a";
      ctx.fillRect(x - w / 2, y - r - 12, w * k, 4);
      ctx.restore();
    }
  }
}

export class Bullet {
  constructor(x, y, vx, vy, damage, pierce, radius = 4, life = 1.4, color = "#ffd27a") {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.damage = damage; this.pierce = pierce; this.radius = radius;
    this.life = life; this.maxLife = life; this.color = color;
    this.hit = new Set();
    this.dead = false;
  }
  update(dt) {
    this.x += this.vx * dt; this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0) this.dead = true;
  }
  draw(ctx) {
    const k = this.life / this.maxLife;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius * 3);
    g.addColorStop(0, rgba(this.color, 0.9 * k));
    g.addColorStop(1, rgba(this.color, 0));
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 3, 0, 6.283); ctx.fill();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#fff2cf";
    ctx.beginPath(); ctx.arc(this.x, this.y, this.radius * 0.7, 0, 6.283); ctx.fill();
    ctx.restore();
  }
}

export class Pickup {
  constructor(x, y, type, value) {
    this.x = x; this.y = y; this.type = type; this.value = value;
    this.vx = rand(-40, 40); this.vy = rand(-40, 40);
    this.r = type === "ore" ? 5 : 4;
    this.life = 60;
    this.pulse = Math.random() * 6.28;
    this.dead = false;
  }
  update(dt, game) {
    this.pulse += dt * 4;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    // friction
    this.vx *= Math.pow(0.5, dt * 3); this.vy *= Math.pow(0.5, dt * 3);
    this.x += this.vx * dt; this.y += this.vy * dt;
    const p = game.player;
    const dx = p.x - this.x, dy = p.y - this.y;
    const d = Math.hypot(dx, dy) || 1;
    const magnet = game.player.build.s.magnet;
    if (d < magnet) {
      const pull = (1 - d / magnet) * 1400;
      this.vx += (dx / d) * pull * dt;
      this.vy += (dy / d) * pull * dt;
    }
    if (d < p.radius + this.r + 4) {
      game.collectPickup(this);
      this.dead = true;
    }
  }
  draw(ctx) {
    const x = this.x, y = this.y;
    const pl = 0.7 + Math.sin(this.pulse) * 0.3;
    if (this.type === "ore") {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
      g.addColorStop(0, rgba("#5ef2d6", 0.6 * pl));
      g.addColorStop(1, rgba("#5ef2d6", 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 14, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#d7fff4";
      ctx.translate(x, y); ctx.rotate(this.pulse * 0.5);
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();
    } else {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(x, y, 0, x, y, 12);
      g.addColorStop(0, rgba("#8f7bff", 0.7 * pl));
      g.addColorStop(1, rgba("#8f7bff", 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 12, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#e6e0ff";
      ctx.beginPath(); ctx.arc(x, y, this.r * 0.8, 0, 6.283); ctx.fill();
      ctx.restore();
    }
  }
}

export class Meteor {
  constructor(x, y, radius, damage, fallTime) {
    this.x = x; this.y = y; this.radius = radius; this.damage = damage;
    this.state = "warn"; this.t = 0; this.warn = 0.5; this.fallTime = fallTime;
    this.dead = false;
  }
  update(dt, game) {
    this.t += dt;
    if (this.state === "warn") { if (this.t >= this.warn) { this.state = "fall"; this.t = 0; } }
    else if (this.state === "fall") {
      if (this.t >= this.fallTime) {
        game.meteorImpact(this);
        this.dead = true;
      }
    }
  }
  draw(ctx) {
    const x = this.x, y = this.y;
    if (this.state === "warn") {
      const k = this.t / this.warn;
      ctx.save();
      ctx.strokeStyle = rgba("#ff9a3c", 0.3 + 0.4 * k);
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 5]);
      ctx.beginPath(); ctx.arc(x, y, this.radius * (1 - 0.3 * k), 0, 6.283); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = rgba("#ff9a3c", 0.08);
      ctx.beginPath(); ctx.arc(x, y, this.radius, 0, 6.283); ctx.fill();
      ctx.restore();
    } else {
      const k = Math.min(1, this.t / this.fallTime);
      const sx = x + (1 - k) * 120, sy = y - (1 - k) * 260;
      const r = 10 + k * 12;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 2.4);
      g.addColorStop(0, "rgba(255,210,122,0.95)");
      g.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sx, sy, r * 2.4, 0, 6.283); ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#3a2a20";
      ctx.beginPath(); ctx.arc(sx, sy, r, 0, 6.283); ctx.fill();
      ctx.fillStyle = "rgba(255,180,80,0.8)";
      ctx.beginPath(); ctx.arc(sx - r * 0.2, sy - r * 0.2, r * 0.5, 0, 6.283); ctx.fill();
      ctx.restore();
    }
  }
}
