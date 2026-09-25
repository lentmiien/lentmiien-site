const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../js/world.js');
const F = require('../js/simulation.js');
const {
  Input
} = require('../js/input.js');
const {
  flyRoute
} = require('./fly-route.cjs');
const step = (sim, seconds, input = {}, hz = 60) => {
  for (let i = 0; i < seconds * hz; i++) sim.update(1 / hz, input);
};
function touchdown(overrides = {}, destination = 'meadow') {
  const sim = new F.Simulation('haven', destination),
    a = W.airports.find(a => a.id === destination);
  Object.assign(sim.state, W.point(a, -400), {
    y: a.elevation + 2.05,
    speed: 42,
    vs: -2,
    pitch: -3,
    throttle: .4,
    heading: a.heading,
    airborne: true,
    grounded: false,
    distance: 7000
  }, overrides);
  sim.update(.1);
  return sim;
}
test('world is 28 km; five 1.4 km runways have reciprocal identifiers and separated centres', () => {
  assert.equal(W.SIZE, 28000);
  assert.equal(W.airports.length, 5);
  for (const a of W.airports) {
    assert.equal(a.length, 1400);
    assert.equal(a.width, 64);
    assert.match(W.runwayNumber(a.heading), /^\d{2}$/);
    for (const b of W.airports) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 6500);
  }
  assert.equal(W.runwayNumber(0), '36');
  assert.equal(W.runwayNumber(90), '09');
  assert.equal(W.runwayNumber(180), '18');
});
test('every runway, taxiway, apron and protected final has exact level collision terrain', () => {
  for (const a of W.airports) for (let along = -4300; along <= 4300; along += 40) for (const cross of [-65, -32, 0, 32, 65, 170, 245]) {
    const p = W.point(a, along, cross);
    assert.ok(Math.abs(W.height(p.x, p.z) - a.elevation) < 1e-8, `${a.id} ${along} ${cross}`);
  }
});
test('all actual obstacle bounds clear runway and arrival corridor; buildings reserve apron', () => {
  for (const o of W.obstacles) for (const a of W.airports) {
    const p = W.local(a, o.x, o.z);
    if (Math.abs(p.along) < 4600) assert.ok(Math.abs(p.cross) - o.radius >= (Math.abs(p.along) < 700 ? 45 : 140), `${a.id} ${o.type}`);
  }
  assert.ok(W.obstacles.length > 4000 && W.obstacles.length < 10000);
});
test('terrain uses exact triangle interpolation rather than a second analytic surface', () => {
  for (let i = 0; i < 100; i++) {
    const x = -12000 + i * 200,
      z = -5000;
    const a = W.nodeHeight(x, z),
      b = W.nodeHeight(x + 200, z),
      c = W.nodeHeight(x, z + 200),
      d = W.nodeHeight(x + 200, z + 200);
    assert.ok(Math.abs(W.height(x + 40, z + 60) - (a + (b - a) * .2 + (c - a) * .3)) < 1e-9);
    assert.ok(Math.abs(W.height(x + 140, z + 160) - (d + (c - d) * .3 + (b - d) * .2)) < 1e-9);
  }
});
test('full power alone never rotates; the published pitch hold produces climb', () => {
  const sim = new F.Simulation();
  step(sim, 8, {
    throttle: 1
  });
  assert.equal(sim.state.grounded, true);
  assert.ok(sim.state.speed > 40);
  assert.equal(sim.state.pitch, 0);
  step(sim, .9, {
    pitch: 1
  });
  step(sim, 8);
  assert.equal(sim.state.grounded, false);
  assert.ok(sim.state.y > 75);
  assert.ok(sim.state.pitch > 8 && sim.state.pitch < 8.2);
});
test('pitch holds on release; bank levels and coordinated turns follow player input', () => {
  const sim = new F.Simulation();
  step(sim, 6, {
    throttle: 1
  });
  step(sim, .9, {
    pitch: 1
  });
  step(sim, 15);
  const pitch = sim.state.pitch;
  step(sim, 5, {
    roll: 1
  });
  assert.ok(sim.state.heading > 100);
  step(sim, 4);
  assert.equal(sim.state.pitch, pitch);
  assert.ok(Math.abs(sim.state.bank) < .01);
});
test('30/60/144 Hz produce identical full power rotation and climb', () => {
  const results = [30, 60, 144].map(hz => {
    const sim = new F.Simulation();
    step(sim, 6, {
      throttle: 1
    }, hz);
    step(sim, 1, {
      pitch: 1
    }, hz);
    step(sim, 15, {}, hz);
    return sim.state;
  });
  for (const s of results.slice(1)) for (const key of ['x', 'z', 'y', 'speed', 'pitch', 'elapsed']) assert.ok(Math.abs(s[key] - results[0][key]) < 1e-7, key);
});
test('pause discards elapsed time, clears brake, and restart clears complete session', () => {
  const sim = new F.Simulation();
  step(sim, 5, {
    throttle: 1
  });
  sim.pause();
  const before = structuredClone(sim.state);
  sim.update(100, {
    throttle: -1,
    pitch: 1
  });
  assert.deepEqual(sim.state, before);
  sim.pause(false);
  sim.restart('pine', 'mesa');
  assert.equal(sim.state.elapsed, 0);
  assert.equal(sim.state.throttle, 0);
  assert.equal(sim.state.heading, 0);
  assert.equal(sim.state.touchdown, null);
});
test('finite bounded timing, inputs and invalid route selection', () => {
  const sim = new F.Simulation('<script>', '__proto__');
  assert.equal(sim.departure.id, 'haven');
  const before = sim.state.elapsed;
  for (const t of [NaN, Infinity, -1, 0]) sim.update(t);
  assert.equal(sim.state.elapsed, before);
  sim.update(10000, {
    pitch: Infinity,
    roll: NaN,
    throttle: 1000000
  });
  assert.ok(sim.state.elapsed <= .101);
  assert.equal(sim.state.pitch, 0);
  assert.ok(sim.state.throttle <= .031);
});
test('safe destination touchdown requires rollout and actual stopped state', () => {
  const sim = touchdown();
  assert.equal(sim.state.grounded, true);
  assert.equal(sim.state.status, 'flying');
  step(sim, 8, {
    throttle: -1,
    brake: true
  });
  assert.equal(sim.state.status, 'complete');
  assert.ok(sim.state.groundRoll > 20);
  assert.ok(sim.state.stopTime >= 1);
});
test('merely overflying a destination never completes it', () => {
  const sim = touchdown({
    y: 350,
    vs: 0,
    pitch: 0
  });
  step(sim, 20);
  assert.equal(sim.state.status, 'flying');
  assert.equal(sim.state.touchdown, null);
});
test('wrong airport and reciprocal landings are explicitly safe diversions', () => {
  const wrong = touchdown({}, 'pine');
  wrong.destination = W.airports[1];
  step(wrong, 8, {
    throttle: -1,
    brake: true
  });
  assert.equal(wrong.state.status, 'diverted');
  assert.match(wrong.state.reason, /different airport/);
  const reciprocal = touchdown({
    heading: 270
  });
  step(reciprocal, 8, {
    throttle: -1,
    brake: true
  });
  assert.equal(reciprocal.state.status, 'diverted');
  assert.match(reciprocal.state.reason, /reciprocal/);
});
for (const [name, overrides] of [['excessive descent', {
  vs: -7,
  pitch: -12
}], ['excessive speed', {
  speed: 65
}], ['sideways', {
  heading: 130
}], ['wingtip', {
  bank: 25
}], ['runway edge', {
  z: 4530
}], ['off runway', {
  z: 4560
}]]) test(`landing rejects ${name}`, () => {
  const sim = touchdown(overrides);
  assert.equal(sim.state.status, 'crashed');
});
test('rolling off pavement is not a successful landing', () => {
  const sim = touchdown();
  sim.state.x = sim.destination.x + 699;
  step(sim, .1);
  assert.equal(sim.state.status, 'crashed');
  assert.match(sim.state.reason, /excursion/);
});
test('stall is recoverable with normal nose-down and full-power inputs', () => {
  const sim = new F.Simulation();
  Object.assign(sim.state, {
    y: 700,
    speed: 24,
    pitch: 12,
    grounded: false,
    airborne: true
  });
  assert.equal(F.guidance(sim).stage, 'stall');
  step(sim, 1.3, {
    throttle: 1,
    pitch: -1
  });
  step(sim, 7, {
    throttle: 1
  });
  assert.ok(sim.state.speed > 55);
  assert.equal(sim.state.status, 'flying');
  assert.ok(sim.state.y > 600);
});
test('water, terrain and bounded obstacle collisions end clearly', () => {
  const water = new F.Simulation();
  Object.assign(water.state, {
    x: -13000,
    z: 12000,
    y: 1,
    speed: 30,
    grounded: false,
    airborne: true
  });
  water.update(.1);
  assert.match(water.state.reason, /Water/);
  const land = new F.Simulation();
  Object.assign(land.state, {
    x: 0,
    z: -6000,
    y: 1,
    speed: 30,
    grounded: false,
    airborne: true
  });
  land.update(.1);
  assert.equal(land.state.status, 'crashed');
  const o = W.obstacles.find(o => o.type === 'terminal'),
    obstacle = new F.Simulation();
  Object.assign(obstacle.state, {
    x: o.x,
    z: o.z,
    y: o.y + 8,
    speed: 10,
    grounded: false,
    airborne: true
  });
  obstacle.update(.1);
  assert.match(obstacle.state.reason, /Obstacle/);
});
test('guidance detects flare without conflicting stall advice and unstable approach recovery', () => {
  const sim = new F.Simulation();
  Object.assign(sim.state, W.point(sim.destination, -450), {
    y: 31,
    speed: 32,
    grounded: false,
    airborne: true,
    distance: 7000
  });
  assert.equal(F.guidance(sim).stage, 'flare');
  sim.state.y = 200;
  sim.state.speed = 42;
  assert.equal(F.guidance(sim).stage, 'go-around');
  sim.state.x = 13000;
  sim.state.speed = 32;
  assert.equal(F.guidance(sim).stage, 'stall');
  sim.state.speed = 60;
  assert.equal(F.guidance(sim).stage, 'boundary');
});
test('input matches instructions; key release, opposing inputs, pointer cancel and clear cannot stick', () => {
  const i = new Input();
  i.key('ArrowDown', true);
  i.key('KeyW', true);
  assert.deepEqual(i.values(), {
    pitch: 1,
    throttle: 1,
    roll: 0,
    brake: false
  });
  i.key('ArrowUp', true);
  assert.equal(i.values().pitch, 0);
  i.key('ArrowDown', false);
  assert.equal(i.values().pitch, -1);
  i.pointers.set(1, 'KeyD');
  i.pointers.set(2, 'Space');
  assert.equal(i.values().brake, true);
  assert.equal(i.values().roll, 1);
  assert.equal(i.key('KeyQ', true), false);
  i.clear();
  assert.deepEqual(i.values(), {
    pitch: 0,
    throttle: 0,
    roll: 0,
    brake: false
  });
});
test('static runtime contains no remote dependencies, HTML injection, telemetry, storage or backend writes', () => {
  for (const name of ['js/boot.js', 'js/world.js', 'js/simulation.js', 'js/input.js', 'js/renderer.mjs', 'index.html']) {
    const source = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
    assert.doesNotMatch(source, /https?:\/\/|fetch\(|XMLHttpRequest|WebSocket|sendBeacon|localStorage|sessionStorage|document\.cookie|innerHTML|eval\(/, name);
  }
});
test('airspeed drag is forgiving and control authority remains at high speed', () => {
  const sim = new F.Simulation();
  Object.assign(sim.state, {
    y: 1800,
    speed: 100,
    pitch: 0,
    throttle: 1,
    grounded: false,
    airborne: true
  });
  step(sim, 15, {
    roll: 1
  });
  assert.ok(sim.state.speed < 77 && sim.state.speed > 70);
  assert.ok(sim.state.heading > 110);
  assert.equal(sim.state.status, 'flying');
});
const reports = [];
for (const a of W.airports) for (const b of W.airports) if (a !== b) test(`control-only flight: ${a.name} → ${b.name}`, () => {
  const {
    sim,
    stages,
    trace
  } = flyRoute(a.id, b.id);
  assert.equal(sim.state.status, 'complete', JSON.stringify(trace.slice(-8)));
  assert.equal(sim.state.touchdown.airport, b.id);
  assert.ok(sim.state.touchdown.descent <= 4.5);
  assert.ok(Math.abs(sim.state.touchdown.cross) < 27);
  for (const stage of ['takeoff', 'rotate', 'climb', 'cruise', 'final', 'flare', 'rollout']) assert.ok(stages.includes(stage), stage);
  reports.push({
    departure: a.id,
    destination: b.id,
    timeSeconds: +sim.state.elapsed.toFixed(2),
    distanceKm: +(sim.state.distance / 1000).toFixed(2),
    touchdown: sim.state.touchdown,
    groundRoll: +sim.state.groundRoll.toFixed(1),
    stages,
    trace
  });
});
test.after(() => {
  fs.writeFileSync(path.join(__dirname, '../docs/validation/flights.json'), JSON.stringify(reports, null, 2) + '\n');
});
