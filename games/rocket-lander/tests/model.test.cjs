const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Simulation, STEP, C, shape, intersects, grade } = require('../js/simulation.js');
const { stages, box } = require('../js/world.js');
const { Input } = require('../js/input.js');
const records = require('../js/records.js');
const { fly } = require('./fly-stage.cjs');
const fresh = () => new Simulation();
const airborne = (sim = fresh()) => { Object.assign(sim.state, { x: -27, y: 25, grounded: null }); return sim; };
const tick = (sim, n = 1, input = {}) => { for (let i = 0; i < n; i++) sim.step(input); return sim.state; };
function contact(patch = {}, mode = 'standard') {
  const sim = new Simulation('selene', mode);
  Object.assign(sim.state, { x: 27, y: 4.61, vy: -1, grounded: null }, patch);
  if (patch.y === undefined) sim.state.y += 3.005 - Math.min(...shape(sim.state).map(p => p[1]));
  tick(sim, 100);
  return sim;
}
function storage(raw) { return { raw, getItem() { return this.raw; }, setItem(k, v) { this.raw = v; }, removeItem() { this.raw = null; } }; }

test('six named worlds have distinct increasing gravity, generous fuel and valid safe pads', () => {
  assert.equal(stages.length, 6); assert.equal(new Set(stages.map(s => s.gravity)).size, 6);
  for (const stage of stages) {
    assert.ok(stage.gravity < C.thrust); assert.equal(stage.fuel, 160);
    const sim = new Simulation(stage.id); tick(sim, 500);
    assert.equal(sim.state.status, 'flying'); assert.equal(sim.state.grounded, 'start');
    assert.equal(sim.state.fuel, 160);
  }
});
test('gravity changes acceleration and no release hover/steering exists', () => {
  for (const stage of stages) {
    const sim = airborne(new Simulation(stage.id)); sim.state.angle = .2; tick(sim);
    assert.ok(Math.abs(sim.state.vy + stage.gravity * STEP * Math.exp(-C.drag * STEP)) < 1e-12);
    assert.ok(Math.abs(sim.state.angle - .2) < 1e-12); assert.equal(sim.state.vx, 0);
  }
});
test('strict two-dimensional state and main thrust follows tilt', () => {
  const sim = airborne(); sim.state.angle = .4; tick(sim, 1, { main: true, z: 100 });
  assert.ok(sim.state.vx > 0); assert.ok(sim.state.vy > 0); assert.equal(sim.state.z, undefined); assert.equal(sim.state.vz, undefined);
});
test('main engine lifts safely from start in every gravity', () => {
  for (const stage of stages) { const sim = new Simulation(stage.id); tick(sim, 70, { main: true }); assert.ok(sim.state.y > stage.start.y + 2); assert.equal(sim.state.status, 'flying'); assert.equal(sim.state.grounded, null); }
});
test('left command makes negative tilt and right positive with angular inertia', () => {
  for (const [side, sign] of [['left', -1], ['right', 1]]) {
    const sim = airborne(); tick(sim, 20, { [side]: true }); assert.ok(sim.state.angle * sign > 0); assert.ok(sim.state[side]);
    const old = Math.abs(sim.state.omega), angle = sim.state.angle; tick(sim);
    assert.ok(Math.abs(sim.state.omega) < old); assert.ok(Math.abs(sim.state.angle) > Math.abs(angle));
  }
});
test('fuel charges main and each side engine independently and in combination', () => {
  for (const input of [{ main: true }, { left: true }, { right: true }, { main: true, right: true }]) {
    const sim = airborne(); const expected = ((input.main ? C.mainFuel : 0) + (input.left || input.right ? C.sideFuel : 0)) * STEP;
    tick(sim, 1, input); assert.ok(Math.abs(sim.state.fuel - (160 - expected)) < 1e-10);
  }
});
test('contradictory rotation commands cancel force, plumes and rotation spending', () => {
  const sim = airborne(); tick(sim, 120, { left: true, right: true });
  assert.equal(sim.state.fuel, 160); assert.equal(sim.state.omega, 0); assert.equal(sim.state.left, false); assert.equal(sim.state.right, false);
  tick(sim, 1, { left: true, right: true, main: true }); assert.ok(Math.abs(sim.state.fuel - 160 + C.mainFuel * STEP) < 1e-10);
});
test('empty tank has no engine force or exhaust and finite flight fails', () => {
  const sim = airborne(); sim.state.fuel = 0; tick(sim, 1, { main: true, right: true });
  assert.equal(sim.state.status, 'crashed'); assert.equal(sim.state.fuel, 0); assert.equal(sim.state.omega, 0); assert.equal(sim.state.main, false); assert.ok(sim.state.vy < 0);
});
test('partial last burn is prorated and fuel never becomes negative', () => {
  const sim = airborne(); sim.state.fuel = C.mainFuel * STEP / 2; tick(sim, 1, { main: true });
  assert.equal(sim.state.fuel, 0); assert.equal(sim.state.status, 'crashed');
  assert.ok(Math.abs(sim.state.vy - (C.thrust / 2 - sim.stage.gravity) * STEP * Math.exp(-C.drag * STEP)) < 1e-10);
});
test('same-step safe goal contact precedes depletion, then settles for 0.6 seconds', () => {
  const sim = fresh(); Object.assign(sim.state, { x: 27, y: 4.602, vy: -1, fuel: C.mainFuel * STEP, grounded: null });
  tick(sim, 1, { main: true }); assert.equal(sim.state.status, 'settling'); assert.equal(sim.state.fuel, 0); assert.equal(sim.state.touchdown.fraction, 0);
  tick(sim, 71); assert.equal(sim.state.status, 'settling'); tick(sim, 2); assert.equal(sim.state.status, 'landed');
});
test('impact outranks fuel depletion and cannot become success', () => {
  const sim = fresh(); Object.assign(sim.state, { x: 27, y: 4.602, vy: -10, fuel: .001, grounded: null }); tick(sim, 1, { main: true });
  assert.equal(sim.state.status, 'crashed'); assert.match(sim.state.reason, /Hard landing/); assert.equal(sim.state.touchdown, null);
});
test('practice stays powered at zero represented fuel and never depletes', () => {
  const sim = airborne(new Simulation('atlas', 'practice')); sim.state.fuel = 0; tick(sim, 20, { main: true, left: true });
  assert.equal(sim.state.fuel, 0); assert.equal(sim.state.status, 'flying'); assert.ok(sim.state.main); assert.ok(sim.state.vy > 0);
});
test('safe actual goal contact succeeds with a stable, upright settled state', () => {
  const sim = contact({ vx: 1.2, vy: -2, angle: .08, omega: .1 });
  assert.equal(sim.state.status, 'landed'); assert.equal(sim.state.grounded, 'goal');
  assert.equal(sim.state.vx, 0); assert.equal(sim.state.vy, 0); assert.equal(sim.state.angle, 0);
});
test('flying across goal zone above pad is not success', () => {
  const sim = airborne(); Object.assign(sim.state, { x: 26, y: 20, vx: 2 }); tick(sim, 50);
  assert.equal(sim.state.status, 'flying'); assert.equal(sim.state.touchdown, null);
});
test('safe return to start is allowed and never completes goal', () => {
  const sim = contact({ x: -27 }); assert.equal(sim.state.grounded, 'start'); assert.equal(sim.state.status, 'flying');
  tick(sim, 30, { main: true }); assert.equal(sim.state.grounded, null);
});
for (const [label, patch] of [
  ['horizontal speed', { vx: 3 }], ['descent speed', { vy: -4 }], ['tilt', { angle: .3 }], ['spin', { omega: .5 }], ['partial footprint', { x: 33.1 }], ['pad side', { x: 19.9, y: 3, vx: 2 }], ['pad underside/interior', { x: 27, y: 2, vy: 1 }]
]) test(`reject unsafe goal ${label}`, () => { const sim = contact(patch); assert.equal(sim.state.status, 'crashed'); assert.equal(sim.state.touchdown, null); });
test('obstacle and terrain contacts are fatal', () => {
  const sim = airborne(); Object.assign(sim.state, { x: 0, y: 11.6, vy: -2 }); tick(sim, 60); assert.match(sim.state.reason, /Obstacle/);
  const ground = airborne(); Object.assign(ground.state, { x: -15, y: 1.61, vy: -2 }); tick(ground, 10); assert.match(ground.state.reason, /Surface/);
});
test('adaptive spatial collision prevents fast tunneling through rocks and pad sides', () => {
  const sim = airborne(); Object.assign(sim.state, { x: -10, y: 5, vx: 1800 }); tick(sim);
  assert.equal(sim.state.status, 'crashed'); assert.match(sim.state.reason, /Obstacle/); assert.ok(sim.state.x < 0);
  const pad = airborne(); Object.assign(pad.state, { x: 17, y: 2.5, vx: 1800 }); tick(pad); assert.match(pad.state.reason, /Pad side/);
});
test('fast vertical collision cannot tunnel through arrival', () => {
  const sim = airborne(); Object.assign(sim.state, { x: 27, y: 15, vy: -1800 }); tick(sim); assert.equal(sim.state.status, 'crashed'); assert.match(sim.state.reason, /Hard landing/);
});
test('sector boundary and extreme simulation work fail visibly', () => {
  const sim = airborne(); sim.state.x = 39; tick(sim); assert.match(sim.state.reason, /sector/);
  const extreme = airborne(); extreme.state.vx = 1e8; tick(extreme); assert.match(extreme.state.reason, /envelope/);
});
test('SAT detects crossings, containment and separation', () => {
  assert.ok(intersects(box(0, 0, 2, 2), box(1, 1, 2, 2))); assert.ok(!intersects(box(0, 0, 2, 2), box(3, 0, 2, 2)));
  assert.equal(shape(fresh().state).length, 5);
});
test('fixed-step result is identical at 30, 60 and 144 render Hz', () => {
  const states = [30, 60, 144].map(hz => { const sim = fresh(); for (let frame = 0; frame < hz * 3; frame++) sim.advance(1 / hz, { main: true, right: frame >= hz * 2 }); return sim.state; });
  for (const key of ['x', 'y', 'vx', 'vy', 'angle', 'omega', 'fuel', 'elapsed']) { assert.ok(Math.abs(states[0][key] - states[1][key]) < 1e-9, key); assert.ok(Math.abs(states[0][key] - states[2][key]) < 1e-9, key); }
});
test('pause drops catch-up time, clears engines and cannot alter result', () => {
  const sim = airborne(); sim.advance(.1, { main: true }); sim.pause(); const old = { ...sim.state };
  sim.advance(20, { main: true }); tick(sim, 100, { right: true }); assert.deepEqual(sim.state, old);
  sim.pause(false); sim.advance(STEP); assert.ok(Math.abs(sim.state.elapsed - old.elapsed - STEP) < 1e-10);
});
test('invalid dt/input is inert, long frames bounded and stage/mode enums rejected', () => {
  const sim = fresh(); for (const dt of [NaN, Infinity, -1, 0, '1']) sim.advance(dt, { main: true }); assert.equal(sim.state.elapsed, 0);
  sim.advance(999, { main: 1, left: 'true' }); assert.ok(sim.state.elapsed <= .10001); assert.equal(sim.state.fuel, 160);
  assert.throws(() => new Simulation('../secret'), RangeError); assert.throws(() => new Simulation('atlas', 'admin'), RangeError);
});
test('retry and switching stages/modes restore state without old input or timer', () => {
  const sim = airborne(); tick(sim, 10, { main: true }); sim.pause(); sim.reset('atlas', 'practice');
  assert.equal(sim.state.x, -27); assert.equal(sim.state.elapsed, 0); assert.equal(sim.state.paused, false); assert.equal(sim.state.fuel, 160); assert.equal(sim.state.main, false); assert.equal(sim.accumulator, 0); assert.equal(sim.stage.gravity, 9.8);
});
test('input aliases, multiple pointers, cancellation and clear have no stuck keys', () => {
  const i = new Input(); assert.ok(i.key('Space', true)); i.key('KeyW', true); i.key('Space', false); assert.ok(i.values().main);
  i.pointers.set(1, 'right'); i.pointers.set(2, 'main'); i.key('KeyW', false); assert.ok(i.values().main && i.values().right);
  i.pointers.delete(2); assert.ok(!i.values().main); i.clear(); assert.deepEqual(i.values(), { main: false, left: false, right: false }); assert.equal(i.key('KeyZ', true), false);
});
test('grading uses fraction only and exact documented band boundaries', () => {
  for (const [value, rank] of [[1, 'S'], [.7, 'S'], [.6999, 'A'], [.5, 'A'], [.3, 'B'], [.1, 'C'], [.0999, 'D'], [0, 'D'], [NaN, '—']]) assert.equal(grade(value), rank);
});
test('records accept landed standard only, preserve best and separate practice', () => {
  const store = storage(null), sim = contact(); sim.state.touchdown.fraction = .6;
  assert.ok(records.save(store, sim)); assert.equal(records.read(store).selene, .6);
  sim.state.touchdown.fraction = .4; records.save(store, sim); assert.equal(records.read(store).selene, .6);
  sim.mode = 'practice'; sim.state.touchdown.fraction = 1; assert.equal(records.save(store, sim), false); assert.equal(records.read(store).selene, .6);
  sim.mode = 'standard'; sim.state.status = 'crashed'; assert.equal(records.save(store, sim), false);
});
test('malformed, hostile, oversized and unavailable storage fail safely', () => {
  for (const raw of ['{', 'null', '[]', 'x'.repeat(2049), '{"selene":"<script>"}', '{"selene":-1}', '{"atlas":2}']) assert.deepEqual(records.read(storage(raw)), {});
  assert.deepEqual(records.read(storage('{"__proto__":{"polluted":true},"atlas":0.7,"secret":0.4}')), { atlas: .7 });
  const unavailable = { getItem() { throw Error(); }, setItem() { throw Error(); } }; assert.deepEqual(records.read(unavailable), {}); assert.equal(records.save(unavailable, contact()), false);
});
for (const stage of stages) test(`ordinary player-button flight completes ${stage.name} with finite fuel and rock clearance`, () => {
  const result = fly(stage.id); assert.equal(result.status, 'landed', JSON.stringify(result)); assert.ok(result.remaining > 70); assert.ok(result.clearance > 3); assert.ok(result.seconds < 90);
});
test('infinite practice also completes highest-gravity route, without spending', () => {
  const result = fly('atlas', 'practice'); assert.equal(result.status, 'landed'); assert.equal(result.fuel, 160);
});
test('normal engine-only failure can retry and subsequently fly successfully', () => {
  const sim = fresh(); tick(sim, 2000, { main: true }); assert.equal(sim.state.status, 'crashed'); sim.reset(); assert.equal(sim.state.status, 'flying'); assert.equal(sim.state.fuel, 160);
  assert.equal(fly('selene').status, 'landed');
});
test('runtime has no network backend, dynamic HTML insertion or imported test controller', () => {
  const dir = path.join(__dirname, '../js');
  for (const file of fs.readdirSync(dir)) {
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.ok(!/\bfetch\(|XMLHttpRequest|WebSocket|\.innerHTML|\beval\(|tests\/|fly-stage/.test(source), file);
  }
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8'); assert.ok(!/https?:\/\/|on(?:click|load)=/.test(html));
});
