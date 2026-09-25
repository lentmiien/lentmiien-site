/* TEST ONLY. Reads the same public instruments and guidance as a player.
   Emits digital hold/release commands; never writes simulation state. */
const W = require('../js/world.js');
const F = require('../js/simulation.js');
function pilotInput(sim, W, F) {
  const s = sim.state,
    g = F.guidance(sim);
  const pitch = g.targetPitch,
    throttle = g.targetThrottle;
  const desired = g.final || g.stage === 'lineup' ? (sim.destination.heading + W.clamp(-g.cross * .10, -18, 18) + 360) % 360 : g.bearing;
  const headingError = F.angle(desired - s.heading);
  // Digital bank taps with a deadband, anticipating natural leveling.
  const bankTarget = W.clamp(headingError * 1.5, -28, 28);
  const roll = s.grounded ? 0 : Math.abs(headingError) < .15 && Math.abs(s.bank) < 3 ? 0 : s.bank < bankTarget - 1 ? 1 : s.bank > bankTarget + 1 ? -1 : 0;
  return {
    pitch: s.pitch < pitch - .12 ? 1 : s.pitch > pitch + .12 ? -1 : 0,
    throttle: s.throttle < throttle - .004 ? 1 : s.throttle > throttle + .004 ? -1 : 0,
    roll,
    brake: s.grounded && s.airborne
  };
}
function flyRoute(departure, destination, options = {}) {
  const sim = new F.Simulation(departure, destination),
    stages = new Set(),
    trace = [];
  let lastStage = '';
  for (let frame = 0; frame < (options.maxSeconds || 1000) * 60 && sim.state.status === 'flying'; frame++) {
    const s = sim.state,
      g = F.guidance(sim);
    stages.add(g.stage);
    if (g.stage !== lastStage) {
      trace.push({
        time: +s.elapsed.toFixed(1),
        stage: g.stage,
        x: Math.round(s.x),
        z: Math.round(s.z),
        y: Math.round(s.y),
        speed: +s.speed.toFixed(1),
        pitch: +s.pitch.toFixed(1),
        cross: Math.round(g.cross),
        along: Math.round(g.along)
      });
      lastStage = g.stage;
    }
    const input = pilotInput(sim, W, F);
    sim.update(1 / 60, input);
    options.onFrame?.(sim, input, g);
  }
  return {
    sim,
    stages: [...stages],
    trace
  };
}
if (require.main === module) {
  const result = flyRoute(process.argv[2] || 'haven', process.argv[3] || 'meadow');
  console.log(JSON.stringify({
    state: result.sim.state,
    stages: result.stages,
    trace: result.trace
  }, null, 2));
}
module.exports = {
  flyRoute,
  pilotInput
};
