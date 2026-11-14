// util.js — math, RNG, formatting helpers (no dependencies)

export const TWO_PI = Math.PI * 2;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (lo, hi) => lo + Math.random() * (hi - lo);
export const randInt = (lo, hi) => Math.floor(lo + Math.random() * (hi - lo + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

export const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
export const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return { x: x / l, y: y / l }; };

export function angleLerp(a, b, t) {
  let d = (b - a) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return a + d * t;
}

// Deterministic RNG (mulberry32) for reproducible-ish rolls & seeding meta
export class RNG {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) { this.s = seed >>> 0; }
  next() {
    this.s |= 0; this.s = (this.s + 0x6D2B79F5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo, hi) { return lo + this.next() * (hi - lo); }
  int(lo, hi) { return Math.floor(lo + this.next() * (hi - lo + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
}

// Compact number formatting: 999 -> 999, 1200 -> 1.2k, 3_400_000 -> 3.4M
export function fmt(n) {
  n = Math.round(n);
  const abs = Math.abs(n);
  if (abs < 1000) return String(n);
  const units = [[1e9, "B"], [1e6, "M"], [1e3, "k"]];
  for (const [v, s] of units) if (abs >= v) {
    let x = n / v;
    return (x >= 100 ? Math.round(x) : Math.round(x * 10) / 10) + s;
  }
  return String(n);
}

export function timeFmt(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function rgba(hex, a = 1) { const { r, g, b } = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
