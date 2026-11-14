// particles.js — lightweight particle field: sparks, bursts, rings, floating text
import { CFG } from "./config.js";
import { rand, rgba } from "./util.js";

export class ParticleField {
  constructor(max = CFG.particlesMax) {
    this.parts = [];
    this.rings = [];
    this.texts = [];
    this.max = max;
  }
  get full() { return this.parts.length >= this.max; }

  spawn(p) {
    if (this.full) this.parts.shift();
    p.maxLife = p.life;
    p.age = 0;
    this.parts.push(p);
  }

  burst(x, y, { count = 10, color = "#ffd27a", speed = [60, 220], life = [0.4, 0.9],
             size = [2, 5], grav = 0, drag = 2.2 } = {}) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(speed[0], speed[1]);
      this.spawn({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: rand(life[0], life[1]), size: rand(size[0], size[1]),
        color, grav, drag, spark: Math.random() < 0.5,
      });
    }
  }

  sparkTrail(x, y, angle, color = "#ffd27a", n = 2) {
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: x + rand(-3, 3), y: y + rand(-3, 3),
        vx: -Math.cos(angle) * rand(20, 90), vy: -Math.sin(angle) * rand(20, 90),
        life: rand(0.2, 0.5), size: rand(1.5, 3.2), color, grav: 0, drag: 3, spark: true,
      });
    }
  }

  ring(x, y, { r = 6, color = "#ffd27a", dur = 0.5, width = 3, grow = 60 } = {}) {
    this.rings.push({ x, y, r, color, dur, age: 0, width, grow });
  }

  text(x, y, text, color = "#fff", size = 14) {
    if (this.texts.length > 40) this.texts.shift();
    this.texts.push({ x: x + rand(-6, 6), y, text, color, size, age: 0, life: rand(0.7, 1.0), vy: -42 });
  }

  update(dt) {
    const P = this.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.age += dt;
      if (p.age >= p.maxLife) { P.splice(i, 1); continue; }
      const d = Math.pow(0.5, dt * p.drag);
      p.vx *= d; p.vy *= d;
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    const R = this.rings;
    for (let i = R.length - 1; i >= 0; i--) { const r = R[i]; r.age += dt; if (r.age >= r.dur) R.splice(i, 1); }
    const T = this.texts;
    for (let i = T.length - 1; i >= 0; i--) { const t = T[i]; t.age += dt; t.y += t.vy * dt; t.vy *= Math.pow(0.5, dt * 2); if (t.age >= t.life) T.splice(i, 1); }
  }

  draw(ctx) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.parts) {
      const k = 1 - p.age / p.maxLife;
      const a = k;
      if (p.spark) {
        const s = p.size * (0.6 + k * 0.8);
        ctx.strokeStyle = rgba(p.color, a);
        ctx.lineWidth = Math.max(0.6, s * 0.7);
        ctx.beginPath();
        ctx.moveTo(p.x - p.vx * 0.02, p.y - p.vy * 0.02);
        ctx.lineTo(p.x + p.vx * 0.02, p.y + p.vy * 0.02);
        ctx.stroke();
      } else {
        ctx.fillStyle = rgba(p.color, a * 0.9);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const r of this.rings) {
      const k = r.age / r.dur;
      const rad = r.r + r.grow * k;
      ctx.strokeStyle = rgba(r.color, (1 - k) * 0.7);
      ctx.lineWidth = r.width * (1 - k) + 0.5;
      ctx.beginPath();
      ctx.arc(r.x, r.y, rad, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // damage numbers (normal blend for readability)
    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "700 14px Inter, sans-serif";
    for (const t of this.texts) {
      const k = 1 - t.age / t.life;
      ctx.globalAlpha = Math.min(1, k * 1.4);
      ctx.font = `700 ${Math.round(t.size + (1 - k) * 4)}px Inter, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.5)";
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
