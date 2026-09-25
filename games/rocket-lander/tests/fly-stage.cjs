/* Test-only feedback pilot. Only returns the three ordinary held buttons.
   No state rewrites, teleport, special thrust or gameplay imports. */
const { Simulation, STEP, C, clamp } = require('../js/simulation.js');
const { stages } = require('../js/world.js');
function makePilot() { return { phase: 'rise', pulse: 0 }; }
function pilotInput(sim, pilot) {
  const s = sim.state, stage = sim.stage;
  if (pilot.phase === 'rise' && s.y > stage.cruise - 1 && Math.abs(s.vy) < 1.8) pilot.phase = 'cross';
  if (pilot.phase === 'cross' && Math.abs(s.x - stage.goal.x) < .55 && Math.abs(s.vx) < .5) pilot.phase = 'descend';
  const tx = pilot.phase === 'rise' ? stage.start.x : stage.goal.x;
  const ty = pilot.phase === 'descend' ? stage.goal.y + 1.35 : stage.cruise;
  const vx = clamp((tx - s.x) * .7, -5, 5);
  const vy = clamp((ty - s.y) * .75, pilot.phase === 'descend' ? -2.2 : -3, 4);
  const ax = clamp((vx - s.vx) * 1.6, -5, 5);
  const ay = Math.max(.8, (vy - s.vy) * 2.5 + stage.gravity + C.drag * s.vy);
  const angle = clamp(Math.atan2(ax, ay), -.5, .5);
  const error = angle - s.angle;
  const demand = 16 * error - 5 * s.omega;
  pilot.pulse += clamp(Math.hypot(ax, ay) / C.thrust, 0, 1);
  const main = pilot.pulse >= 1;
  if (main) pilot.pulse -= 1;
  return { main, right: demand > .12, left: demand < -.12 };
}
function fly(id, mode = 'standard', capture = false, cadenceFrames = 12) {
  const sim = new Simulation(id, mode), pilot = makePilot(), trace = [];
  let minClearance = Infinity, input = {};
  for (let frame = 0; frame < 120 * 180 && !['landed', 'crashed'].includes(sim.state.status); frame++) {
    if (frame % cadenceFrames === 0) input = pilotInput(sim, pilot);
    sim.step(input);
    const s = sim.state;
    // Exact vertical separation over obstacles, with conservative full hull radius.
    for (const poly of sim.stage.obstacles) {
      if (s.x + 1.94 > Math.min(...poly.map(p => p[0])) && s.x - 1.94 < Math.max(...poly.map(p => p[0]))) {
        minClearance = Math.min(minClearance, s.y - 1.94 - Math.max(...poly.map(p => p[1])));
      }
    }
    if (capture && frame % 12 === 0) trace.push({ t: +s.elapsed.toFixed(2), x: +s.x.toFixed(2), y: +s.y.toFixed(2), fuel: +s.fuel.toFixed(2), phase: pilot.phase });
  }
  return { id, mode, controlHz: 120 / cadenceFrames, status: sim.state.status, reason: sim.state.reason, seconds: +sim.state.elapsed.toFixed(2), fuel: +sim.state.fuel.toFixed(2), remaining: +(100 * sim.state.fuel / sim.stage.fuel).toFixed(2), clearance: +minClearance.toFixed(2), touchdown: sim.state.touchdown, trace };
}
if (require.main === module) {
  const results = stages.map(s => fly(s.id, 'standard', true));
  results.push(fly('atlas', 'practice', true));
  const fs = require('node:fs');
  fs.writeFileSync(require('node:path').join(__dirname, '../docs/validation/flights.json'), JSON.stringify(results, null, 2) + '\n');
  console.table(results.map(({ trace, touchdown, ...r }) => r));
  if (results.some(r => r.status !== 'landed')) process.exitCode = 1;
}
module.exports = { fly, pilotInput, makePilot };
