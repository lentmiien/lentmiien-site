(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./world.js') : root.DescentWorld);
  if (typeof module === 'object') module.exports = api; else root.Descent = api;
})(globalThis, function (World) {
  const STEP = 1 / 120;
  const C = Object.freeze({ thrust: 18, torque: 2.6, angularDamping: 3.2, drag: .045, mainFuel: 1.6, sideFuel: .28, maxVX: 2.5, maxVY: 3.4, maxTilt: 12 * Math.PI / 180, maxSpin: 20 * Math.PI / 180, feet: 1.6 });
  const hull = [[-1.05, -1.6], [1.05, -1.6], [.82, .85], [0, 1.65], [-.82, .85]];
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  function shape(s) {
    const c = Math.cos(s.angle), n = Math.sin(s.angle);
    return hull.map(([x, y]) => [s.x + x * c + y * n, s.y - x * n + y * c]);
  }
  // Convex SAT: the exact same polygon vertices are extruded by the renderer.
  function intersects(a, b) {
    for (const p of [a, b]) for (let i = 0; i < p.length; i++) {
      const q = p[(i + 1) % p.length], v = p[i];
      const nx = -(q[1] - v[1]), ny = q[0] - v[0];
      const aa = a.map(t => t[0] * nx + t[1] * ny), bb = b.map(t => t[0] * nx + t[1] * ny);
      if (Math.max(...aa) < Math.min(...bb) - 1e-8 || Math.max(...bb) < Math.min(...aa) - 1e-8) return false;
    }
    return true;
  }
  function grade(fraction) {
    if (!Number.isFinite(fraction)) return '—';
    return fraction >= .7 ? 'S' : fraction >= .5 ? 'A' : fraction >= .3 ? 'B' : fraction >= .1 ? 'C' : 'D';
  }
  function safety(s) {
    return { horizontal: Math.abs(s.vx) <= C.maxVX, vertical: s.vy >= -C.maxVY && s.vy <= .2, tilt: Math.abs(wrap(s.angle)) <= C.maxTilt, spin: Math.abs(s.omega) <= C.maxSpin };
  }
  class Simulation {
    constructor(id = 'selene', mode = 'standard') { this.reset(id, mode); }
    reset(id = this.stage.id, mode = this.mode) {
      this.stage = World.getStage(id);
      if (!['standard', 'practice'].includes(mode)) throw new RangeError('Unknown mode');
      this.mode = mode;
      this.accumulator = 0;
      this.state = { x: this.stage.start.x, y: this.stage.start.y + C.feet, vx: 0, vy: 0, angle: 0, omega: 0, fuel: this.stage.fuel, elapsed: 0, status: 'flying', paused: false, grounded: 'start', main: false, left: false, right: false, reason: '', settle: 0, touchdown: null };
    }
    pause(value = true) { this.state.paused = value; this.accumulator = 0; this.state.main = this.state.left = this.state.right = false; }
    advance(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0 || this.state.paused) return;
      this.accumulator += Math.min(dt, .1);
      while (this.accumulator + 1e-10 >= STEP) { this.step(input); this.accumulator -= STEP; }
    }
    fail(reason) { this.state.status = 'crashed'; this.state.reason = reason; this.state.main = this.state.left = this.state.right = false; }
    step(input = {}) {
      const s = this.state;
      if (s.paused || !['flying', 'settling'].includes(s.status)) return;
      if (s.status === 'settling') {
        s.settle += STEP;
        if (s.settle >= .6) s.status = 'landed';
        return;
      }
      const powered = this.mode === 'practice' || s.fuel > 0;
      s.main = powered && input.main === true;
      s.left = powered && input.left === true && input.right !== true;
      s.right = powered && input.right === true && input.left !== true;
      const rate = (s.main ? C.mainFuel : 0) + (s.left || s.right ? C.sideFuel : 0);
      const fraction = this.mode === 'standard' && rate ? Math.min(1, s.fuel / (rate * STEP)) : 1;
      s.elapsed += STEP;
      // Spatial substeps bound hull motion to < 0.08m (including rotation).
      const count = Math.ceil((Math.hypot(s.vx, s.vy) * STEP + Math.abs(s.omega) * 1.94 * STEP + C.thrust * STEP * STEP) / .08);
      if (count > 256) { this.fail('Flight envelope exceeded'); return; }
      const dt = STEP / Math.max(1, count);
      for (let i = 0; i < Math.max(1, count); i++) {
        const previous = shape(s);
        s.omega = (s.omega + ((s.right ? 1 : 0) - (s.left ? 1 : 0)) * C.torque * fraction * dt) * Math.exp(-C.angularDamping * dt);
        s.angle = wrap(s.angle + s.omega * dt);
        const thrust = s.main ? C.thrust * fraction : 0;
        if (s.grounded && thrust <= this.stage.gravity && !s.left && !s.right) {
          s.main = thrust > 0;
        } else {
          s.grounded = null;
          s.vx = (s.vx + Math.sin(s.angle) * thrust * dt) * Math.exp(-C.drag * dt);
          s.vy = (s.vy + (Math.cos(s.angle) * thrust - this.stage.gravity) * dt) * Math.exp(-C.drag * dt);
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          this.contacts(previous);
        }
        if (s.status !== 'flying') break;
      }
      if (this.mode === 'standard') s.fuel = Math.max(0, s.fuel - rate * STEP);
      if (s.touchdown && s.status === 'settling') s.touchdown.fraction = s.fuel / this.stage.fuel;
      if (s.status === 'flying' && this.mode === 'standard' && s.fuel <= 0) this.fail('Fuel depleted — land before the tank runs dry');
    }
    contacts(previous) {
      const s = this.state, p = shape(s);
      const minY = Math.min(...p.map(v => v[1])), minX = Math.min(...p.map(v => v[0])), maxX = Math.max(...p.map(v => v[0]));
      if (minY < 0) { this.fail('Surface impact — aim for a landing pad'); return; }
      if (minX < this.stage.bounds.left || maxX > this.stage.bounds.right || Math.max(...p.map(v => v[1])) > this.stage.bounds.top) { this.fail('Left the flight sector — stay inside the marked boundary'); return; }
      for (const obstacle of this.stage.obstacles) if (intersects(p, obstacle)) { this.fail('Obstacle impact — climb clear before crossing'); return; }
      for (const pad of [this.stage.start, this.stage.goal]) {
        const l = pad.x - pad.width / 2, r = pad.x + pad.width / 2;
        if (!intersects(p, World.box(l, 0, pad.width, pad.y))) continue;
        const top = Math.min(...previous.map(v => v[1])) >= pad.y - .015 && s.vy <= 0;
        if (!top) { this.fail('Pad side impact — approach from above'); return; }
        if (minX < l + .25 || maxX > r - .25) { this.fail('Pad edge impact — place both feet inside the lights'); return; }
        if (!Object.values(safety(s)).every(Boolean)) { this.fail('Hard landing — slow down and bring the rocket upright'); return; }
        const touchdown = { vx: s.vx, vy: s.vy, tilt: s.angle, spin: s.omega, x: s.x, fraction: s.fuel / this.stage.fuel };
        s.y = pad.y + C.feet; s.vx = s.vy = s.angle = s.omega = 0; s.grounded = pad.id;
        if (pad.id === 'goal') {
          s.status = 'settling'; s.touchdown = touchdown;
          s.main = s.left = s.right = false;
        }
      }
    }
  }
  return { Simulation, STEP, C, shape, hull, intersects, grade, safety, clamp };
});
