(function exposePhysics(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MoonPhysics = api;
}(typeof globalThis === 'object' ? globalThis : this, function createPhysics() {
  'use strict';

  const GRAVITY = 1.625;
  const STEP = 1 / 60;
  const DRY_MASS = 7200;
  const MAX_THRUST = 45040;
  const ISP = 311;
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

  function createState(groundAtStart = 0) {
    if (!Number.isFinite(groundAtStart) || Math.abs(groundAtStart) > 100) {
      throw new RangeError('Initial surface height outside the landing site.');
    }
    return {
      time: 0, altitude: 1000 + groundAtStart, x: -480, z: -65,
      verticalSpeed: -21, vx: 14, vz: 1.8,
      fuel: 1900, throttle: 0.34, pitch: 0, roll: 0,
      engine: true, contact: false, resting: false,
      cutoffTime: -1, contactTime: -1, touchdownSpeed: 0,
      compression: 0, acceleration: 0, phase: 'Braking approach'
    };
  }

  // SI units, fixed-step point-mass translation and a rate-limited attitude
  // controller. Guidance is illustrative; it does not replay Apollo telemetry.
  function step(state, dt = STEP) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > STEP + 1e-9) {
      throw new RangeError('Physics step must be finite and within 1/60 second.');
    }
    state.time += dt;
    if (state.contact) {
      const age = state.time - state.contactTime;
      state.compression = age >= 2 ? 0 : 0.10 * Math.exp(-age * 2.4) * Math.sin(Math.min(age * 5, Math.PI));
      state.resting = age >= 2;
      state.phase = state.resting ? 'Tranquility Base' : 'Landing gear settling';
      state.acceleration = 0;
      return state;
    }

    const h = state.altitude;
    if (h <= 1.15 && state.engine) {
      state.engine = false;
      state.cutoffTime = state.time;
      state.throttle = 0;
      state.phase = 'Contact light · engine stop';
    }
    let ax = 0;
    let az = 0;
    let ay = -GRAVITY;
    if (state.engine && state.fuel > 0) {
      const fastDescent = Math.min(21, Math.sqrt(0.52 * h));
      const slowDescent = Math.max(0.48, Math.min(3, h * 0.06));
      const blend = clamp((h - 45) / 65, 0, 1);
      const wantedVy = -(slowDescent * (1 - blend) + fastDescent * blend);
      const wantedAy = clamp((wantedVy - state.verticalSpeed) * 0.65, -0.6, 1.3);
      const wantedAx = clamp((clamp(-state.x * 0.065, -14, 14) - state.vx) * 0.32, -0.45, 0.45);
      const wantedAz = clamp((clamp(-state.z * 0.065, -2, 2) - state.vz) * 0.32, -0.25, 0.25);
      const wantedPitch = Math.atan2(wantedAx, GRAVITY + wantedAy);
      const wantedRoll = -Math.atan2(wantedAz, GRAVITY + wantedAy);
      state.pitch += clamp(wantedPitch - state.pitch, -dt * 0.045, dt * 0.045);
      state.roll += clamp(wantedRoll - state.roll, -dt * 0.045, dt * 0.045);
      const mass = DRY_MASS + state.fuel;
      const wantedThrottle = clamp(mass * Math.hypot(wantedAx, wantedAz, GRAVITY + wantedAy) / MAX_THRUST, 0.10, 0.65);
      state.throttle += (wantedThrottle - state.throttle) * (1 - Math.exp(-dt / 0.28));
      const thrust = state.throttle * MAX_THRUST;
      state.fuel = Math.max(0, state.fuel - thrust / (ISP * 9.80665) * dt);
      ax = Math.sin(state.pitch) * thrust / mass;
      az = -Math.sin(state.roll) * Math.cos(state.pitch) * thrust / mass;
      ay += Math.cos(state.pitch) * Math.cos(state.roll) * thrust / mass;
      state.phase = h > 110 ? 'Braking approach' : h > 25 ? 'Terminal descent' : 'Final approach';
    } else {
      state.throttle = 0;
    }
    state.vx += ax * dt;
    state.vz += az * dt;
    state.verticalSpeed += ay * dt;
    state.x += state.vx * dt;
    state.z += state.vz * dt;
    state.altitude += state.verticalSpeed * dt;
    state.acceleration = ay;
    if (state.altitude <= 0) {
      state.touchdownSpeed = -state.verticalSpeed;
      state.altitude = 0;
      state.verticalSpeed = 0;
      state.vx = 0;
      state.vz = 0;
      state.throttle = 0;
      state.engine = false;
      state.contact = true;
      state.contactTime = state.time;
      state.pitch = 0;
      state.roll = 0;
      state.phase = 'Landing gear settling';
    }
    return state;
  }

  function buildFlight(groundAtStart = 0) {
    const state = createState(groundAtStart);
    const frames = [{ ...state }];
    // Hard work limit, including the post-cutoff dust sequence.
    for (let i = 0; i < 60 * 360; i += 1) {
      step(state);
      frames.push({ ...state });
      if (state.contact && state.time - state.contactTime >= 24) break;
    }
    if (!state.contact) throw new Error('Landing guidance did not converge.');
    const duration = state.time;
    const contactTime = state.contactTime;
    function sample(time) {
      if (!Number.isFinite(time)) throw new RangeError('Flight time must be finite.');
      const cursor = clamp(time, 0, duration) / STEP;
      const index = Math.floor(cursor + 1e-7);
      const a = frames[Math.min(index, frames.length - 1)];
      const b = frames[Math.min(index + 1, frames.length - 1)];
      const fraction = clamp(cursor - index, 0, 1);
      const result = { ...a };
      // Contact and engine cutoff are discrete events, never interpolated.
      if (a.contact === b.contact && a.engine === b.engine) {
        for (const key of ['time', 'altitude', 'x', 'z', 'verticalSpeed', 'vx', 'vz', 'fuel', 'throttle', 'pitch', 'roll', 'compression', 'acceleration']) {
          result[key] = a[key] + (b[key] - a[key]) * fraction;
        }
      }
      return result;
    }
    return { frames, duration, contactTime, sample,
      timeAtAltitude: altitude => {
        if (!Number.isFinite(altitude) || altitude < 0 || altitude > 1000) throw new RangeError('Altitude outside flight.');
        return frames.find(frame => frame.altitude <= altitude).time;
      }
    };
  }

  function dustStrength(altitude, throttle) {
    if (!Number.isFinite(altitude) || !Number.isFinite(throttle)) return 0;
    return clamp((48 - Math.max(0, altitude)) / 48, 0, 1) ** 2 * clamp(throttle / 0.31, 0, 1.5);
  }

  // Vacuum ballistic trajectory: no wind, drag, buoyancy, or exponential
  // deceleration. Settling is collision with terrain, not an atmospheric fade.
  function ballisticParticle(origin, velocity, age) {
    if (!Number.isFinite(age) || age < 0 || age > 30) throw new RangeError('Particle age outside budget.');
    return {
      x: origin.x + velocity.x * age,
      y: origin.y + velocity.y * age - 0.5 * GRAVITY * age * age,
      z: origin.z + velocity.z * age
    };
  }

  return { GRAVITY, STEP, DRY_MASS, MAX_THRUST, ISP, createState, step, buildFlight, dustStrength, ballisticParticle };
}));
