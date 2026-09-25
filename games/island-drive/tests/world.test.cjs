const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../js/world.js');
const { Simulation, CARS, RADIUS, sweptCircle } = require('../js/simulation.js');
const world = W.createWorld();
const flat = (onRoad = true, obstacles = []) => ({
  ...world,
  obstacles,
  height: () => 20,
  roadAt: () => ({ edge: onRoad ? -8 : 10, name: 'Test road' }),
  spawn: { x: 0, z: 0, heading: 0 },
});
function drive(sim, seconds, input, dt = 1 / 60) {
  for (let i = 0; i < Math.round(seconds / dt); i++) sim.update(dt, input);
}

test('substantial authored world with distinct districts and many town crossroads', () => {
  assert.equal(world.roads.length, 15);
  assert.ok(world.obstacles.filter((o) => o.type === 'building').length >= 60);
  assert.ok(world.obstacles.filter((o) => o.type === 'tree').length > 450);
  assert.equal(world.landmarks.length, 5);
  const length = world.segments.reduce((n, s) => n + Math.hypot(s.b.x - s.a.x, s.b.z - s.a.z), 0);
  assert.ok(length > 10000);
  assert.ok(world.height(340, -290) > 120);
});
test('deterministic world placement and asset reproduction seed', () =>
  assert.deepEqual(W.createWorld().obstacles, world.obstacles));
test('every solid visual footprint clears every road and intersection by at least four metres', () => {
  for (const o of world.obstacles)
    for (const s of world.segments)
      assert.ok(
        W.project(o.x, o.z, s.a, s.b).distance - s.width / 2 >= o.radius + 4 - 1e-8,
        `${o.type} at ${o.x},${o.z}`
      );
});
test('solid decorations never intersect each other', () => {
  for (let i = 0; i < world.obstacles.length; i++)
    for (let j = i + 1; j < world.obstacles.length; j++) {
      const a = world.obstacles[i],
        b = world.obstacles[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= a.radius + b.radius + 2 - 1e-8);
    }
});
test('spatial road lookup agrees with exhaustive geometry near all drivable surfaces', () => {
  for (const s of world.segments)
    for (const offset of [-12, 0, 12]) {
      const x = (s.a.x + s.b.x) / 2 + offset,
        z = (s.a.z + s.b.z) / 2;
      assert.ok(Math.abs(world.roadAt(x, z).edge - world.roadAt(x, z, true).edge) < 1e-8);
    }
});
test('all roads connect, have no unconnected dead ends, and cross at matching terrain heights', () => {
  const adjacent = world.roads.map(() => new Set());
  for (let i = 0; i < world.roads.length; i++)
    for (let j = i + 1; j < world.roads.length; j++) {
      const b = world.segments.filter((s) => s.roadId === j),
        a = world.segments.filter((s) => s.roadId === i);
      if (
        a.some((s) =>
          b.some(
            (t) =>
              [s.a, s.b].some((p) => W.project(p.x, p.z, t.a, t.b).distance < 0.1) ||
              [t.a, t.b].some((p) => W.project(p.x, p.z, s.a, s.b).distance < 0.1)
          )
        )
      ) {
        adjacent[i].add(j);
        adjacent[j].add(i);
      }
    }
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length)
    for (const n of adjacent[queue.shift()])
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
  assert.equal(seen.size, world.roads.length);
  world.roads.forEach((r, i) => {
    for (const p of [r.points[0], r.points.at(-1)]) {
      if (Math.hypot(r.points[0].x - r.points.at(-1).x, r.points[0].z - r.points.at(-1).z) < 0.1)
        continue;
      assert.ok(
        world.segments.some((s) => s.roadId !== i && W.project(p.x, p.z, s.a, s.b).distance < 0.1),
        r.name
      );
    }
  });
});
test('road widths remain dry and grades are passable across dense samples', () => {
  let maxGrade = 0,
    maxCross = 0;
  for (const s of world.segments) {
    const dx = s.b.x - s.a.x,
      dz = s.b.z - s.a.z,
      len = Math.hypot(dx, dz);
    for (let d = 0; d < len; d += 2) {
      const x = s.a.x + (dx * d) / len,
        z = s.a.z + (dz * d) / len;
      const y = world.height(x, z);
      assert.ok(y > 10);
      maxGrade = Math.max(maxGrade, Math.abs(world.height(x + dx / len, z + dz / len) - y));
      const nx = ((-dz / len) * s.width) / 2,
        nz = ((dx / len) * s.width) / 2;
      for (const sign of [-1, 1]) assert.ok(world.height(x + nx * sign, z + nz * sign) > 8);
      maxCross = Math.max(
        maxCross,
        Math.abs(world.height(x + nx, z + nz) - world.height(x - nx, z - nz)) / s.width
      );
    }
  }
  assert.ok(maxGrade < 0.22, `grade ${maxGrade}`);
  assert.ok(maxCross < 0.25, `cross slope ${maxCross}`);
});
test('road texture shares exact terrain triangles: no independent elevated road mesh', () => {
  const rng = W.random(8);
  for (let i = 0; i < 1000; i++) {
    const gx = Math.floor((rng() * 2000 - 1000) / W.STEP) * W.STEP,
      gz = Math.floor((rng() * 2000 - 1000) / W.STEP) * W.STEP,
      u = rng(),
      v = rng();
    const a = W.rawHeight(gx, gz),
      b = W.rawHeight(gx + 10, gz),
      c = W.rawHeight(gx, gz + 10),
      d = W.rawHeight(gx + 10, gz + 10);
    const expected =
      u + v <= 1 ? a * (1 - u - v) + b * u + c * v : d * (u + v - 1) + c * (1 - u) + b * (1 - v);
    assert.ok(Math.abs(world.height(gx + u * 10, gz + v * 10) - expected) < 1e-9);
  }
  const svg = fs.readFileSync(path.join(__dirname, '../assets/images/terrain.svg'), 'utf8');
  for (const r of world.roads)
    assert.ok(svg.includes(`M${r.points.map((p) => `${p.x},${p.z}`).join(' L')}`));
});
test('checkpoint candidates are reachable clear road centres on dry terrain', () => {
  assert.ok(world.sites.length > 50);
  for (const p of world.sites) {
    assert.ok(world.roadAt(p.x, p.z).edge <= -6.9);
    assert.ok(world.height(p.x, p.z) > 8);
    assert.ok(
      world.obstacles.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > o.radius + RADIUS + 3)
    );
  }
});
test('random checkpoints relocate to distant distinct reachable sites', () => {
  const a = new Simulation(world, 7),
    b = new Simulation(world, 99);
  assert.notDeepEqual(a.checkpoints, b.checkpoints);
  for (let j = 0; j < 100; j++) {
    const old = a.checkpoints[0];
    a.state.x = old.x;
    a.state.z = old.z;
    a.update(1 / 60, {});
    assert.notEqual(a.checkpoints[0], old);
    assert.ok(Math.hypot(a.checkpoints[0].x - old.x, a.checkpoints[0].z - old.z) > 220);
    for (let i = 0; i < 4; i++)
      for (let k = i + 1; k < 4; k++)
        assert.ok(
          Math.hypot(
            a.checkpoints[i].x - a.checkpoints[k].x,
            a.checkpoints[i].z - a.checkpoints[k].z
          ) > 170
        );
  }
  assert.equal(a.state.collected, 100);
});
test('checkpoint collection gives no score, acceleration, grip, resource or speed benefit', () => {
  const a = new Simulation(flat(), 3),
    b = new Simulation(flat(), 3);
  a.checkpoints[0] = { x: 0, z: 0 };
  b.checkpoints = b.checkpoints.map((p) => ({ ...p, x: 10000, z: 10000 }));
  drive(a, 1, { throttle: 1 });
  drive(b, 1, { throttle: 1 });
  assert.equal(a.state.collected, 1);
  assert.equal(b.state.collected, 0);
  assert.equal(a.quality, b.quality);
  assert.equal(a.state.speed, b.state.speed);
  assert.equal(a.state.distance, b.state.distance);
  assert.deepEqual(a.car, b.car);
});
test('quality is understandable, distance-based, bounded and unaffected by idling', () => {
  const s = new Simulation(flat());
  s.state.distance = 100;
  s.state.roadDistance = 80;
  s.state.collisions = 2;
  assert.equal(s.quality, 70);
  drive(s, 20, {});
  assert.equal(s.quality, 70);
  s.state.collisions = 200;
  assert.equal(s.quality, 0);
});
test('road distance rewards accurate driving while off-road travel reduces the percentage', () => {
  const s = new Simulation(flat());
  drive(s, 3, { throttle: 1 });
  assert.equal(s.quality, 100);
  s.world = flat(false);
  drive(s, 3, { throttle: 1 });
  assert.ok(s.quality < 65);
  assert.ok(s.state.speed <= s.car.offroad);
});
test('three cars have clearly different acceleration, speed and cornering limits', () => {
  const sims = CARS.map((c) => {
    const s = new Simulation(flat());
    s.restart(c.id);
    drive(s, 12, { throttle: 1 });
    return s;
  });
  assert.ok(sims[2].state.speed > sims[1].state.speed + 15);
  assert.ok(sims[1].state.speed > sims[0].state.speed + 14);
  for (const s of sims) drive(s, 1, { throttle: 1, steer: 1 });
  assert.ok(Math.abs(sims[0].state.heading) > Math.abs(sims[1].state.heading));
  assert.ok(Math.abs(sims[1].state.heading) > Math.abs(sims[2].state.heading));
  assert.ok(sims[2].state.skid > 0);
});
test('fixed steps produce equivalent handling at 30, 60 and 144 frames per second', () => {
  const states = [30, 60, 144].map((fps) => {
    const s = new Simulation(flat());
    drive(s, 4, { throttle: 1, steer: 0.3 }, 1 / fps);
    return s.state;
  });
  for (const key of ['x', 'z', 'heading', 'speed', 'distance', 'elapsed'])
    assert.ok(Math.abs(states[0][key] - states[2][key]) < 1e-8, key);
});
test('brake stops before reverse, reverse backs out, and handbrake does not reverse', () => {
  const s = new Simulation(flat());
  drive(s, 3, { throttle: 1 });
  drive(s, 2, { brake: true });
  assert.ok(Math.abs(s.state.speed) < 0.1);
  drive(s, 2, { throttle: -1 });
  assert.ok(s.state.speed < 0);
  assert.equal(s.state.ended, false);
});
test('continuous swept collision detects thin obstacles even across a long high-speed segment', () => {
  assert.ok(sweptCircle(0, 0, 100, 0, 50, 0, 1) < 0.5);
  assert.equal(sweptCircle(0, 0, 100, 0, 50, 5, 1), null);
  const s = new Simulation(flat(true, [{ x: 0, z: 25, radius: 1, type: 'lamp' }]));
  s.restart('sport');
  s.state.speed = 57;
  s.state.vz = 57;
  drive(s, 1, { throttle: 1 });
  assert.ok(s.state.z < 25 - 1 - RADIUS);
  assert.equal(s.state.collisions, 1);
  assert.equal(s.state.ended, false);
});
test('sustained collision does not create per-frame penalty explosions', () => {
  const s = new Simulation(flat(true, [{ x: 0, z: 10, radius: 1, type: 'lamp' }]));
  drive(s, 15, { throttle: 1 });
  assert.equal(s.state.collisions, 1);
  assert.equal(s.quality, 95);
  assert.equal(s.state.ended, false);
});
test('recovering then hitting again counts a separate collision', () => {
  const s = new Simulation(flat(true, [{ x: 0, z: 10, radius: 1, type: 'lamp' }]));
  drive(s, 5, { throttle: 1 });
  drive(s, 2, { throttle: -1 });
  drive(s, 5, { throttle: 1 });
  assert.equal(s.state.collisions, 2);
});
test('only entering water ends play; poor score, collisions and elapsed time do not', () => {
  const s = new Simulation(flat(false));
  s.state.collisions = 10000;
  s.state.elapsed = 100000;
  drive(s, 10, { throttle: 1 });
  assert.equal(s.state.ended, false);
  assert.equal(s.quality, 0);
  s.world = { ...s.world, height: () => -0.2 };
  s.update(1 / 60, {});
  assert.equal(s.state.ended, true);
  const time = s.state.elapsed;
  drive(s, 2, { throttle: 1 });
  assert.equal(s.state.elapsed, time);
  assert.equal(s.drainEvents().filter((e) => e.type === 'water').length, 1);
});
test('pause freezes all session state and drops pending simulation time', () => {
  const s = new Simulation(flat());
  drive(s, 1, { throttle: 1 });
  s.pause(true);
  const before = { ...s.state };
  drive(s, 20, { throttle: 1 });
  assert.deepEqual(s.state, before);
  s.pause(false);
  s.update(1 / 60, {});
  assert.ok(s.state.elapsed < before.elapsed + 0.02);
});
test('restart resets every session metric, input-derived motion and event state', () => {
  const s = new Simulation(flat());
  s.restart('sport');
  drive(s, 2, { throttle: 1, steer: 1 });
  Object.assign(s.state, { collisions: 5, collected: 8, ended: true, paused: true });
  s.events.push({ type: 'water' });
  s.restart();
  assert.equal(s.car.id, 'sport');
  for (const key of [
    'speed',
    'vx',
    'vz',
    'steer',
    'elapsed',
    'distance',
    'roadDistance',
    'collisions',
    'collected',
    'topSpeed',
    'skid',
  ])
    assert.equal(s.state[key], 0, key);
  assert.equal(s.state.ended, false);
  assert.equal(s.state.paused, false);
  assert.equal(s.checkpoints.length, 4);
  assert.equal(s.events.length, 0);
  assert.equal(s.quality, 100);
  assert.equal(s.state.x, s.world.spawn.x);
});
test('invalid car and non-finite or excessive timing/control input are bounded', () => {
  const s = new Simulation(flat());
  s.restart('<script>');
  assert.equal(s.car.id, 'rover');
  for (const n of [NaN, Infinity, -1, 0]) s.update(n, { throttle: Infinity, steer: NaN });
  assert.equal(s.state.elapsed, 0);
  s.update(9999, { throttle: 1e10, steer: -1e10 });
  assert.ok(s.state.elapsed <= 0.101);
  assert.ok(Number.isFinite(s.state.x));
  assert.ok(Math.abs(s.state.steer) <= 1);
});
test('runtime is local-only, has no account/storage access or unsafe content insertion', () => {
  const files = ['boot.js', 'world.js', 'simulation.js', 'renderer.mjs'];
  const code = files
    .map((f) => fs.readFileSync(path.join(__dirname, '../js', f), 'utf8'))
    .join('\n');
  assert.doesNotMatch(
    code,
    /https?:\/\/|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|document\.cookie|innerHTML|eval\s*\(/
  );
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  assert.doesNotMatch(html, /on(?:click|load|error)=|<script[^>]*>[^<\s]/);
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g))
    assert.ok(!match[1].startsWith('/') && !match[1].includes('://'));
});
test('local art, speech, theme and licensed dependency are present', () => {
  for (const f of [
    'terrain.png',
    'island-map.svg',
    'coast-poster.svg',
    'rover.svg',
    'tourer.svg',
    'sport.svg',
  ])
    assert.ok(fs.statSync(path.join(__dirname, '../assets/images', f)).size > 100);
  const wav = fs.readFileSync(path.join(__dirname, '../assets/audio/welcome.wav'));
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.ok(wav.length > 500000);
  assert.match(
    fs.readFileSync(path.join(__dirname, '../vendor/THREE-LICENSE.txt'), 'utf8'),
    /MIT License/
  );
});
