(function (root, factory) {
  const api = factory(
    typeof module === 'object' && module.exports ? require('./world.js') : root.IslandWorld
  );
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.IslandSimulation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict';
  const CARS = Object.freeze([
    Object.freeze({
      id: 'rover',
      name: 'Pebble',
      kind: 'Easygoing hatchback',
      top: 22,
      acceleration: 5.8,
      brake: 13,
      grip: 12,
      corner: 12,
      steer: 0.47,
      offroad: 10,
      color: 0xe7b85a,
      wheelbase: 2.7,
    }),
    Object.freeze({
      id: 'tourer',
      name: 'Meridian',
      kind: 'Balanced grand tourer',
      top: 37,
      acceleration: 7.5,
      brake: 15,
      grip: 7,
      corner: 9.5,
      steer: 0.49,
      offroad: 13,
      color: 0x5ca9a0,
      wheelbase: 3.0,
    }),
    Object.freeze({
      id: 'sport',
      name: 'Comet',
      kind: 'Demanding sports coupe',
      top: 57,
      acceleration: 11,
      brake: 19,
      grip: 4.5,
      corner: 8,
      steer: 0.52,
      offroad: 16,
      color: 0xed6c48,
      wheelbase: 2.8,
    }),
  ]);
  const RADIUS = 2.9;
  const FIXED = 1 / 120;
  function sweptCircle(ax, az, bx, bz, cx, cz, r) {
    const dx = bx - ax;
    const dz = bz - az;
    const ox = ax - cx;
    const oz = az - cz;
    const a = dx * dx + dz * dz;
    const c = ox * ox + oz * oz - r * r;
    if (c < 0) return 0;
    if (a < 1e-12) return null;
    const b = 2 * (ox * dx + oz * dz);
    const d = b * b - 4 * a * c;
    if (d < 0) return null;
    const t = (-b - Math.sqrt(d)) / (2 * a);
    return t >= 0 && t <= 1 ? t : null;
  }
  class Simulation {
    constructor(world, seed = 1) {
      this.world = world;
      this.initialSeed = seed;
      this.restart('rover');
    }
    restart(id = this.car.id) {
      this.car = CARS.find((c) => c.id === id) || CARS[0];
      this.state = {
        ...this.world.spawn,
        speed: 0,
        vx: 0,
        vz: 0,
        steer: 0,
        elapsed: 0,
        distance: 0,
        roadDistance: 0,
        collisions: 0,
        collected: 0,
        topSpeed: 0,
        ended: false,
        paused: false,
        onRoad: true,
        skid: 0,
      };
      this.rng = W.random(this.initialSeed);
      this.accumulator = 0;
      this.contactQuiet = 2;
      this.events = [];
      this.checkpoints = [];
      for (let i = 0; i < 4; i++) this.checkpoints.push(this.nextCheckpoint());
    }
    nextCheckpoint(previous) {
      const s = this.state;
      const occupied = this.checkpoints || [];
      const candidates = this.world.sites.filter(
        (p) =>
          p !== previous &&
          Math.hypot(p.x - s.x, p.z - s.z) > 220 &&
          occupied.every((q) => Math.hypot(p.x - q.x, p.z - q.z) > 170)
      );
      // The authored network has enough sites; never turn an empty list into an invalid marker.
      if (!candidates.length) throw new Error('No reachable exploration site');
      return candidates[Math.floor(this.rng() * candidates.length)];
    }
    get quality() {
      const s = this.state;
      return W.clamp(
        (s.distance > 0.1 ? s.roadDistance / s.distance : 1) * 100 - s.collisions * 5,
        0,
        100
      );
    }
    pause(value) {
      this.state.paused = Boolean(value);
      this.accumulator = 0;
    }
    update(dt, input = {}) {
      if (!Number.isFinite(dt) || dt <= 0 || this.state.ended || this.state.paused) return;
      const safe = {
        throttle: W.clamp(Number.isFinite(input.throttle) ? input.throttle : 0, -1, 1),
        steer: W.clamp(Number.isFinite(input.steer) ? input.steer : 0, -1, 1),
        brake: input.brake === true,
      };
      this.accumulator += Math.min(dt, 0.1);
      while (this.accumulator + 1e-10 >= FIXED) {
        this.step(FIXED, safe);
        this.accumulator -= FIXED;
        if (this.state.ended) {
          this.accumulator = 0;
          break;
        }
      }
    }
    step(dt, input) {
      const s = this.state;
      const c = this.car;
      const world = this.world;
      s.elapsed += dt;
      this.contactQuiet += dt;
      s.onRoad = world.roadAt(s.x, s.z).edge <= 0;
      const max = s.onRoad ? c.top : c.offroad;
      const speed = Math.hypot(s.vx, s.vz);
      s.steer += (input.steer - s.steer) * (1 - Math.exp(-dt * 7));
      let drive = input.throttle * c.acceleration;
      const reversing =
        input.throttle !== 0 &&
        Math.sign(input.throttle) !== Math.sign(s.speed) &&
        Math.abs(s.speed) > 0.7;
      if (reversing) drive = input.throttle * c.brake;
      if (input.brake) drive = -Math.sign(s.speed) * c.brake;
      const resistance = 0.55 + (s.onRoad ? 0.012 : 0.09) * s.speed * s.speed;
      if (!input.throttle || Math.abs(s.speed) > max || input.brake)
        drive -= Math.sign(s.speed) * resistance;
      const aheadX = s.x + Math.sin(s.heading) * 2;
      const aheadZ = s.z + Math.cos(s.heading) * 2;
      const slope = (world.height(aheadX, aheadZ) - world.height(s.x, s.z)) / 2;
      if (Math.abs(s.speed) > 0.3 || input.throttle) drive -= slope * 5;
      const oldSpeed = s.speed;
      s.speed = W.clamp(s.speed + drive * dt, -8, max);
      if ((input.brake || !input.throttle) && oldSpeed * s.speed < 0) s.speed = 0;
      if (Math.abs(s.speed) < 0.08 && !input.throttle) s.speed = 0;
      const requested =
        (s.speed / c.wheelbase) * Math.tan((-s.steer * c.steer) / (1 + Math.abs(s.speed) * 0.035));
      const limit = (s.onRoad ? c.corner : c.corner * 0.6) / Math.max(3, Math.abs(s.speed));
      const yaw = W.clamp(requested, -limit, limit);
      s.heading += yaw * dt;
      s.skid = Math.max(0, Math.abs(requested) - limit);
      const grip = (s.onRoad ? c.grip : c.grip * 0.45) / (1 + s.skid * 0.7);
      const blend = 1 - Math.exp(-grip * dt);
      s.vx += (Math.sin(s.heading) * s.speed - s.vx) * blend;
      s.vz += (Math.cos(s.heading) * s.speed - s.vz) * blend;
      const ax = s.x;
      const az = s.z;
      let bx = ax + s.vx * dt;
      let bz = az + s.vz * dt;
      let hit = null;
      let first = 1;
      for (const o of world.obstacles) {
        if (
          Math.abs(o.x - ax) > o.radius + RADIUS + speed * dt + 1 ||
          Math.abs(o.z - az) > o.radius + RADIUS + speed * dt + 1
        )
          continue;
        const t = sweptCircle(ax, az, bx, bz, o.x, o.z, o.radius + RADIUS);
        if (t !== null && t <= first) {
          hit = o;
          first = t;
        }
      }
      if (hit) {
        bx = ax + (bx - ax) * Math.max(0, first - 0.001);
        bz = az + (bz - az) * Math.max(0, first - 0.001);
        let nx = bx - hit.x;
        let nz = bz - hit.z;
        const length = Math.hypot(nx, nz) || 1;
        nx /= length;
        nz /= length;
        bx = hit.x + nx * (hit.radius + RADIUS + 0.025);
        bz = hit.z + nz * (hit.radius + RADIUS + 0.025);
        if (this.contactQuiet > 0.8 && speed > 0.8) {
          s.collisions++;
          this.events.push({ type: 'collision' });
        }
        this.contactQuiet = 0;
        const dot = s.vx * nx + s.vz * nz;
        if (dot < 0) {
          s.vx -= 1.2 * dot * nx;
          s.vz -= 1.2 * dot * nz;
        }
        s.speed *= 0.2;
      }
      s.x = bx;
      s.z = bz;
      const distance = Math.hypot(bx - ax, bz - az);
      s.distance += distance;
      if (world.roadAt((ax + bx) / 2, (az + bz) / 2).edge <= 0) s.roadDistance += distance;
      s.topSpeed = Math.max(s.topSpeed, Math.hypot(s.vx, s.vz));
      // Substeps travel < 0.5 m at maximum speed. Water is the sole terminal condition.
      if (world.height(bx, bz) <= W.WATER) {
        s.ended = true;
        this.events.push({ type: 'water' });
        return;
      }
      for (let i = 0; i < this.checkpoints.length; i++) {
        const p = this.checkpoints[i];
        if (sweptCircle(ax, az, bx, bz, p.x, p.z, 8) !== null) {
          s.collected++;
          this.checkpoints[i] = this.nextCheckpoint(p);
          this.events.push({ type: 'checkpoint', name: p.name });
        }
      }
      // Consumers may ignore notifications without unbounded memory growth.
      if (this.events.length > 12) this.events.splice(0, this.events.length - 12);
    }
    drainEvents() {
      return this.events.splice(0);
    }
  }
  return { CARS, RADIUS, FIXED, sweptCircle, Simulation };
});
