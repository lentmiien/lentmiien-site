const path = require('path');
const express = require('express');
const physics = require('../../games/moon-landing/js/physics');
const terrain = require('../../games/moon-landing/js/terrain');

describe('Moon Landing flight mechanics', () => {
  const flight = physics.buildFlight();

  test('flies the full last kilometre into a soft, fuel-positive landing and permanent rest', () => {
    expect(flight.frames[0].altitude).toBe(1000);
    expect(flight.contactTime).toBeGreaterThan(90);
    expect(flight.contactTime).toBeLessThan(240);
    let previous = flight.frames[0];
    for (const state of flight.frames) {
      expect(state.altitude).toBeGreaterThanOrEqual(0);
      expect(state.altitude).toBeLessThanOrEqual(previous.altitude);
      expect(state.fuel).toBeGreaterThan(0);
      expect(state.fuel).toBeLessThanOrEqual(previous.fuel);
      expect(Math.abs(state.pitch)).toBeLessThan(18 * Math.PI / 180);
      expect(state.throttle).toBeGreaterThanOrEqual(0);
      expect(state.throttle).toBeLessThanOrEqual(.65);
      previous = state;
    }
    const final = flight.frames.at(-1);
    expect(final.touchdownSpeed).toBeGreaterThan(0);
    expect(final.touchdownSpeed).toBeLessThan(2.3);
    expect(Math.hypot(final.x, final.z)).toBeLessThan(1);
    expect(final).toMatchObject({ contact: true, resting: true, engine: false, throttle: 0, altitude: 0, vx: 0, vz: 0, verticalSpeed: 0, compression: 0 });
    expect(final.time - final.contactTime).toBeGreaterThanOrEqual(24);
  });

  test('cuts the engine above the surface, then free-falls under lunar gravity', () => {
    const cutoff = flight.frames.find(state => !state.engine);
    expect(cutoff.altitude).toBeGreaterThan(.9);
    expect(cutoff.altitude).toBeLessThan(1.2);
    expect(cutoff.contact).toBe(false);
    const state = { ...cutoff };
    physics.step(state);
    expect(state.verticalSpeed - cutoff.verticalSpeed).toBeCloseTo(-physics.GRAVITY * physics.STEP, 10);
    expect(state.vx).toBe(cutoff.vx);
    expect(state.vz).toBe(cutoff.vz);
    expect(state.fuel).toBe(cutoff.fuel);
  });

  test('consumes propellant according to thrust and specific impulse', () => {
    const state = physics.createState();
    const before = state.fuel;
    physics.step(state);
    expect(before - state.fuel).toBeCloseTo(state.throttle * physics.MAX_THRUST / (physics.ISP * 9.80665) * physics.STEP, 10);
  });

  test('starts exactly one kilometre above the actual approach terrain', () => {
    const initial = physics.createState();
    const surfaceHeight = terrain.height(initial.x, initial.z);
    const actualFlight = physics.buildFlight(surfaceHeight);
    expect(actualFlight.frames[0].altitude - surfaceHeight).toBeCloseTo(1000, 10);
    expect(actualFlight.frames.at(-1).altitude).toBe(0);
    expect(actualFlight.frames.at(-1).touchdownSpeed).toBeLessThan(2.3);
    expect(() => physics.buildFlight(Infinity)).toThrow(RangeError);
    expect(() => physics.buildFlight(1e9)).toThrow(RangeError);
  });

  test('sampling supports repeatable seeking without altering physics or leaking mutable frames', () => {
    const first = flight.sample(74.389);
    flight.sample(120);
    expect(flight.sample(74.389)).toEqual(first);
    first.altitude = -100;
    expect(flight.sample(74.389).altitude).toBeGreaterThan(0);
    for (const h of [1000, 60, 25, 5, 0]) {
      expect(flight.sample(flight.timeAtAltitude(h)).altitude).toBeLessThanOrEqual(h);
    }
    expect(flight.sample(-100).altitude).toBe(1000);
    expect(flight.sample(1e12).resting).toBe(true);
    expect(flight.sample(flight.contactTime).contact).toBe(true);
    expect(flight.sample(flight.contactTime - physics.STEP).contact).toBe(false);
  });

  test.each([NaN, Infinity, -Infinity, '12', null, {}])('rejects invalid external time %p', value => {
    expect(() => flight.sample(value)).toThrow(RangeError);
    expect(() => flight.timeAtAltitude(value)).toThrow(RangeError);
  });
  test.each([NaN, Infinity, -1, 0, 1, 1000000, '0.01'])('rejects an unbounded physics step %p', value => {
    const state = physics.createState();
    expect(() => physics.step(state, value)).toThrow(RangeError);
    expect(state).toEqual(physics.createState());
  });
});

describe('Lunar surface and vacuum dust', () => {
  test('dust accelerates downward without wind or horizontal drag', () => {
    const origin = { x: 0, y: .1, z: 0 };
    const velocity = { x: 35, y: 1.625, z: -10 };
    const halfway = physics.ballisticParticle(origin, velocity, 1);
    expect(halfway).toMatchObject({ x: 35, z: -10 });
    expect(halfway.y).toBeCloseTo(.9125, 10);
    const after = physics.ballisticParticle(origin, velocity, 2);
    expect(after.x).toBe(70);
    expect(after.z).toBe(-20);
    expect(after.y).toBeCloseTo(.1);
    expect(() => physics.ballisticParticle(origin, velocity, Infinity)).toThrow(RangeError);
    expect(() => physics.ballisticParticle(origin, velocity, -1)).toThrow(RangeError);
  });
  test('surface erosion requires both low altitude and active thrust', () => {
    expect(physics.dustStrength(1000, .4)).toBe(0);
    expect(physics.dustStrength(0, 0)).toBe(0);
    expect(physics.dustStrength(2, .3)).toBeGreaterThan(physics.dustStrength(24, .3));
    expect(physics.dustStrength(-1000, 100000)).toBeLessThanOrEqual(1.5);
    expect(physics.dustStrength(NaN, .3)).toBe(0);
  });
  test('all feet rest on one graded patch, with crater relief outside it', () => {
    for (const [x, z] of [[0, 0], [4.3, 0], [-4.3, 0], [0, 4.3], [0, -4.3]]) expect(terrain.height(x, z)).toBeCloseTo(0, 10);
    const crater = terrain.craters[0];
    expect(terrain.height(crater.x, crater.z)).toBeLessThan(terrain.height(crater.x + crater.radius, crater.z) - 1);
    // The touchdown patch must join the mare, not stand on a fabricated mound.
    expect(Math.abs(terrain.height(12, 18) - terrain.height(0, 0))).toBeLessThan(1);
    expect(Math.abs(terrain.height(20, 0) - terrain.height(0, 0))).toBeLessThan(1);
    for (const x of [-128, -64, 0, 64, 128]) {
      expect(Math.abs(terrain.height(x - 1e-5, 30) - terrain.height(x + 1e-5, 30))).toBeLessThan(.001);
    }
  });
  test('terrain generation is seeded and its work is bounded', () => {
    const a = terrain.random(1969), b = terrain.random(1969);
    for (let i = 0; i < 20; i += 1) expect(a()).toBe(b());
    expect(terrain.craters.length).toBeLessThanOrEqual(571);
    expect(terrain.height(100000, 0)).toBeLessThan(-2800);
  });
});

describe('Moon Landing fully public static boundary', () => {
  let server, origin;
  beforeAll(async () => {
    const app = express();
    app.use('/moon-landing', express.static(path.join(__dirname, '../../games/moon-landing')));
    await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
    origin = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  test('anonymous users can load the page, model and decoder without an account', async () => {
    for (const asset of ['index.html', 'assets/apollo-lunar-module.glb', 'vendor/draco/draco_decoder.wasm']) {
      const response = await fetch(`${origin}/moon-landing/${asset}`, { method: 'HEAD' });
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
  });
  test('does not accept public writes or traverse outside the game directory', async () => {
    const mutation = await fetch(`${origin}/moon-landing/index.html`, { method: 'POST', body: 'untrusted' });
    expect(mutation.status).toBe(404);
    for (const escape of ['%2e%2e%2f%2e%2e%2fpackage.json', '.env', '%2e%2e%2fapp.js']) {
      const response = await fetch(`${origin}/moon-landing/${escape}`);
      expect(response.status).toBe(404);
    }
  });
  test('request-supplied markup does not become page content', async () => {
    const response = await fetch(`${origin}/moon-landing/?name=${encodeURIComponent('<script>alert(1)</script>')}`);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain('<script>alert(1)</script>');
  });
});
