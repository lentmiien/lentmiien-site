(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./world.js') : root.SkyWorld);
  if (typeof module === 'object') module.exports = api;else root.SkyFlight = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict';

  const {
      clamp,
      DEG
    } = W,
    DT = 1 / 120;
  const angle = a => ((a + 540) % 360 + 360) % 360 - 180;
  const bearing = (a, b) => (Math.atan2(b.x - a.x, a.z - b.z) / DEG + 360) % 360;
  const safe = v => Number.isFinite(v) ? clamp(v, -1, 1) : 0;
  class Simulation {
    constructor(departure = 'haven', destination = 'meadow') {
      this.restart(departure, destination);
    }
    restart(departure = this.departure.id, destination = this.destination.id) {
      this.departure = W.airports.find(a => a.id === departure) || W.airports[0];
      this.destination = W.airports.find(a => a.id === destination && a !== this.departure) || W.airports.find(a => a !== this.departure);
      const p = W.point(this.departure, -this.departure.length / 2 + 55);
      this.state = {
        ...p,
        y: this.departure.elevation + 2,
        heading: this.departure.heading,
        pitch: 0,
        bank: 0,
        speed: 0,
        vs: 0,
        throttle: 0,
        brake: false,
        grounded: true,
        airborne: false,
        status: 'flying',
        paused: false,
        elapsed: 0,
        distance: 0,
        maxAltitude: 0,
        maxSpeed: 0,
        touchdown: null,
        groundRoll: 0,
        stopTime: 0,
        reason: ''
      };
      this.accumulator = 0;
    }
    pause(value = true) {
      this.state.paused = value;
      this.state.brake = false;
      this.accumulator = 0;
    }
    update(seconds, input = {}) {
      if (!Number.isFinite(seconds) || seconds <= 0 || this.state.paused || this.state.status !== 'flying') return;
      this.accumulator += Math.min(seconds, .1);
      while (this.accumulator + 1e-10 >= DT) {
        this.step(input && typeof input === 'object' ? input : {});
        this.accumulator -= DT;
        if (this.state.status !== 'flying') {
          this.accumulator = 0;
          break;
        }
      }
    }
    crash(reason) {
      this.state.status = 'crashed';
      this.state.reason = reason;
    }
    step(input) {
      const s = this.state,
        dt = DT;
      s.throttle = clamp(s.throttle + safe(input.throttle) * .3 * dt, 0, 1);
      s.brake = input.brake === true;
      s.pitch = clamp(s.pitch + safe(input.pitch) * 9 * dt, -14, 18);
      s.bank += (safe(input.roll) * 32 - s.bank) * (1 - Math.exp(-2.8 * dt));
      const oldX = s.x,
        oldZ = s.z;
      // Deliberately forgiving trainer: neutral pitch holds height above 40 m/s.
      const dragTarget = 20 + 55 * s.throttle;
      const acceleration = (dragTarget - s.speed) * .24 - Math.max(0, s.pitch) * .055;
      s.speed = Math.max(0, s.speed + (acceleration - (s.grounded ? 1.1 + (s.brake ? 9 : 0) : 0)) * dt);
      if (s.grounded && s.throttle < .04 && s.speed < 1) s.speed = 0;
      if (s.grounded) {
        s.heading += safe(input.roll) * Math.min(s.speed, 16) * .65 * dt;
        s.bank = 0;
      } else s.heading += 9.81 * Math.tan(s.bank * DEG) / Math.max(s.speed, 24) / DEG * dt;
      s.heading = (s.heading + 360) % 360;
      const targetVS = s.speed * Math.sin(s.pitch * DEG) - Math.max(0, 40 - s.speed) * .35;
      if (s.grounded && s.speed >= 36 && s.pitch >= 3 && targetVS > .8 && !s.brake) {
        s.grounded = false;
        s.airborne = true;
        s.touchdown = null;
        s.groundRoll = 0;
        s.stopTime = 0;
      }
      const horizontal = s.speed * Math.cos(s.pitch * DEG);
      s.x += Math.sin(s.heading * DEG) * horizontal * dt;
      s.z -= Math.cos(s.heading * DEG) * horizontal * dt;
      const ground = W.height(s.x, s.z),
        strip = W.runwayAt(s.x, s.z);
      if (s.grounded) {
        s.y = ground + 2;
        s.vs = 0;
      } else {
        s.vs += (targetVS - s.vs) * (1 - Math.exp(-2.5 * dt));
        s.y += s.vs * dt;
      }
      s.elapsed += dt;
      const distance = Math.hypot(s.x - oldX, s.z - oldZ);
      s.distance += distance;
      s.maxAltitude = Math.max(s.maxAltitude, s.y);
      s.maxSpeed = Math.max(s.maxSpeed, s.speed);
      if (ground <= 0 && s.y <= 2) return this.crash('Water contact — keep the shoreline below you.');
      if (Math.abs(s.x) > W.HALF - 100 || Math.abs(s.z) > W.HALF - 100) return this.crash('Left the mapped region — turn back at the boundary warning.');
      for (const o of W.nearby(s.x, s.z)) {
        if (Math.hypot(s.x - o.x, s.z - o.z) < o.radius + 5 && s.y - 2 < o.y + o.height) return this.crash('Obstacle impact — climb clear of buildings and trees.');
      }
      if (!s.grounded && s.y <= ground + 2) {
        const alignment = strip ? Math.min(Math.abs(angle(s.heading - strip.heading)), Math.abs(angle(s.heading - strip.heading - 180))) : 180;
        const p = strip ? W.local(strip, s.x, s.z) : null;
        s.touchdown = {
          airport: strip?.id || null,
          descent: Math.max(0, -s.vs),
          speed: s.speed,
          alignment,
          cross: p?.cross ?? null,
          along: p?.along ?? null,
          bank: Math.abs(s.bank),
          correctDirection: !!strip && Math.abs(angle(s.heading - strip.heading)) < 15
        };
        if (!strip) return this.crash('Terrain contact outside a runway — use the marked approach.');
        if (s.vs < -4.5 || s.speed > 54 || alignment > 15 || Math.abs(s.bank) > 13 || Math.abs(p.cross) > strip.width / 2 - 5) return this.crash('Hard or misaligned landing — target 38–46 m/s, descent under 4.5 m/s and level wings.');
        s.grounded = true;
        s.y = strip.elevation + 2;
        s.vs = 0;
      }
      if (s.grounded && s.airborne) {
        s.groundRoll += distance;
        if (!strip) return this.crash('Runway excursion — idle throttle and hold Space to brake on the pavement.');
        if (s.speed < .8) s.stopTime += dt;else s.stopTime = 0;
        if (s.stopTime >= 1) {
          if (s.touchdown?.airport === this.destination.id && s.touchdown.correctDirection) {
            s.status = 'complete';
            s.reason = 'Destination reached. Aircraft stopped safely on the runway.';
          } else {
            s.status = 'diverted';
            s.reason = s.touchdown?.airport !== this.destination.id ? 'Safe diversion: you stopped at a different airport.' : 'Safe landing on the reciprocal runway. The selected arrival direction was not flown.';
          }
        }
      } else if (s.grounded && !strip && s.speed > 15) this.crash('Departure runway excursion — keep the aircraft on the centreline.');
    }
  }
  function guidance(sim) {
    const s = sim.state,
      a = sim.destination,
      p = W.local(a, s.x, s.z),
      agl = s.y - Math.max(0, W.height(s.x, s.z)) - 2;
    const fix = W.point(a, -a.length / 2 - 3200),
      distFix = Math.hypot(s.x - fix.x, s.z - fix.z);
    const distance = Math.hypot(s.x - a.x, s.z - a.z),
      headingError = angle(a.heading - s.heading);
    const cruiseAltitude = Math.max(sim.departure.elevation, a.elevation) + (sim.departure.id === 'fjord' || a.id === 'fjord' || sim.departure.id === 'mesa' || a.id === 'mesa' ? 1050 : 300);
    const final = p.along < 450 && p.along > -4900 && Math.abs(p.cross) < 420 && Math.abs(headingError) < 35;
    const glide = a.elevation + 2 + Math.max(3, (-p.along - a.length / 2 + 210) * .075);
    const nav = final ? W.point(a, -a.length / 2 + 210) : fix;
    const common = {
      agl,
      distance,
      distFix,
      cross: p.cross,
      along: p.along,
      bearing: bearing(s, nav),
      headingError,
      targetAltitude: cruiseAltitude,
      targetSpeed: 62,
      targetPitch: 0,
      targetThrottle: .76,
      stage: 'cruise',
      title: 'Follow the gold bearing to the arrival gate',
      cue: 'Trim pitch to 0°. Hold A/D to turn; release to level. Cruise at 55–68 m/s.',
      nav,
      final,
      glide
    };
    if (s.status !== 'flying') return {
      ...common,
      stage: s.status,
      title: s.status === 'complete' ? 'A beautiful arrival' : 'Flight debrief',
      cue: s.reason
    };
    if (s.grounded) return {
      ...common,
      stage: s.airborne ? 'rollout' : s.speed < 40 ? 'takeoff' : 'rotate',
      title: s.airborne ? 'Idle. Brake. Stay on the centreline.' : s.speed < 40 ? 'Hold W to 100% · accelerate to 40 m/s' : 'Rotate: hold ↓ briefly to set +8° pitch',
      cue: s.airborne ? 'Hold S to 0%, then hold Space until stopped. Tap ↑ to return pitch to 0°.' : s.speed < 40 ? 'Release Space. Keep pitch 0° and wings level; wait for 40 m/s before rotation.' : '↓ raises the nose at 9°/second: about 0.9 s to +8°. Release to keep that pitch.',
      targetPitch: s.airborne ? 0 : s.speed < 40 ? 0 : 8,
      targetThrottle: s.airborne ? 0 : 1
    };
    if (s.speed < 33 && !(final && agl < 10)) return {
      ...common,
      stage: 'stall',
      title: 'Low speed · lower the nose and add power',
      cue: 'Hold W to 100%. Tap ↑ toward 0° pitch. Lift fades below 40 m/s; recover above 38.',
      targetPitch: 0,
      targetThrottle: 1
    };
    if (Math.abs(s.x) > 12600 || Math.abs(s.z) > 12600) return {
      ...common,
      stage: 'boundary',
      title: 'Region edge · turn back now',
      cue: 'Hold A or D to make a broad turn toward the map centre. Keep altitude.'
    };
    if (agl < 100 && !final && s.pitch < 3) return {
      ...common,
      stage: 'climb',
      title: 'Terrain nearby · climb clear',
      cue: 'Hold W to 100%; tap ↓ to +8° pitch. Release the pitch key to keep climbing.',
      targetPitch: 8,
      targetThrottle: 1
    };
    if (final && s.airborne && s.distance > 1800) {
      const bad = p.along > -1500 && (Math.abs(p.cross) > 120 || Math.abs(headingError) > 20 || s.y - glide > 100 || s.speed > 55) || p.along > -550 && agl > 45;
      if (bad) return {
        ...common,
        stage: 'go-around',
        title: 'Unstable approach · go around',
        cue: 'Hold W to 100%, tap ↓ to +8°. Climb 300 m above this runway, circle back to the arrival gate. No need to rush.',
        targetPitch: 8,
        targetThrottle: 1
      };
      if (agl < 7 && p.along > -a.length / 2 - 100 && p.along < 400) return {
        ...common,
        stage: 'flare',
        title: 'Flare now · pitch +1°, throttle to idle',
        cue: 'Tap ↓ to +1° (about 0.5 s from −4°). Hold S to 0%. Keep wings level; let speed bleed off. Space after touchdown.',
        targetPitch: 1,
        targetThrottle: 0,
        targetSpeed: 36,
        targetAltitude: a.elevation + 2
      };
      const error = glide - s.y;
      const targetPitch = Math.round(clamp(-4 + error * .055, -8, 2));
      return {
        ...common,
        stage: p.along < -2400 ? 'arrival' : 'final',
        title: 'Manual approach · follow the gold gates',
        cue: `Hold S toward 40% power. Target 40–46 m/s. Trim pitch to ${targetPitch > 0 ? '+' : ''}${targetPitch}°; aim ${Math.round(glide)} m ASL. ${Math.abs(p.cross) > 25 ? p.cross > 0 ? 'Correct left toward centreline.' : 'Correct right toward centreline.' : 'Keep wings level.'} At 7 m AGL, flare.`,
        targetPitch,
        targetThrottle: .4,
        targetSpeed: 43,
        targetAltitude: glide
      };
    }
    if (distFix < 1800 && Math.abs(p.cross) < 1300 && !(Math.abs(headingError) < 20 && Math.abs(p.cross) < 100 && p.along < -4900)) return {
      ...common,
      stage: 'lineup',
      title: `Line up runway ${W.runwayNumber(a.heading)} · ${a.heading || 360}°`,
      cue: `Turn onto ${a.heading || 360}°. Aim for the extended centreline; arrive at ${a.elevation + 250} m ASL with 40% power. If above ${a.elevation + 400} m, circle while descending before joining.`,
      targetAltitude: a.elevation + 250,
      targetThrottle: .4,
      targetSpeed: 43,
      targetPitch: s.y > a.elevation + 260 ? -5 : s.y < a.elevation + 200 ? 3 : 0
    };
    // Look ahead along the player's navigation course; advice only, never moves the aircraft.
    let terrainFloor = 0;
    for (let d = 0; d <= 4000; d += 500) {
      const fraction = Math.min(1, d / Math.max(1, distFix));
      terrainFloor = Math.max(terrainFloor, W.height(s.x + (fix.x - s.x) * fraction, s.z + (fix.z - s.z) * fraction) + 220);
    }
    const plannedAltitude = Math.max(a.elevation + 290, Math.min(cruiseAltitude, a.elevation + 290 + Math.max(0, distFix - 2500) * .07), terrainFloor);
    common.targetAltitude = plannedAltitude;
    if (s.y > plannedAltitude + 30) return {
      ...common,
      stage: 'descent',
      title: `Descend toward ${Math.round(plannedAltitude / 10) * 10} m ASL`,
      cue: 'Keep following the gold bearing. Trim pitch to −4° and power to 65%. Level at the target; prepare 40% power before the arrival gate.',
      targetPitch: -4,
      targetThrottle: .65
    };
    if (s.y < plannedAltitude - 30) return {
      ...common,
      stage: 'climb',
      title: `Climb to ${Math.round(plannedAltitude / 10) * 10} m ASL`,
      cue: 'Hold W to 100%; tap ↓ to +8°. At target altitude tap ↑ back to 0°, then reduce power to 76%.',
      targetPitch: 8,
      targetThrottle: 1
    };
    return common;
  }
  return {
    Simulation,
    guidance,
    angle,
    bearing,
    DT
  };
});
