/* Test-only action controller. Never imported by the shipped game.
   Starts from fresh state; all movement, gathering, crafts and construction use game APIs.
   Aiming reads world coordinates; it does not inject resources, edits, positions or unlocks. */
function runProgression(g, D, W, options = {}) {
  const log = [],
    p = g.state.player;
  g.paused = false;
  const note = text => {
    log.push(text);
    options.note?.(text);
  };
  function aim(x, y, z) {
    const e = g.eye(),
      dx = x - e.x,
      dy = y - e.y,
      dz = z - e.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
  }
  function advance(seconds, input = {}) {
    for (let n = 0; n < Math.ceil(seconds * 60); n++) g.step(input, 1 / 60);
  }
  function equip(id) {
    const n = g.state.hotbar.indexOf(id);
    if (n >= 0) g.state.selected = n;else {
      g.state.hotbar[g.state.selected] = id;
    }
    if (!g.state.inventory[id] && !['log', 'plank'].includes(id)) throw new Error('Cannot equip ' + id);
  }
  function walk(x, z, stop = 1.1, max = 10000) {
    let stuck = 0,
      last = Infinity;
    for (let n = 0; n < max; n++) {
      const dist = Math.hypot(p.x - x, p.z - z);
      if (dist < stop) return;
      aim(x, p.y + 1.6, z);
      if (stuck > 60 && p.boat === null) {
        const tool = ['ironPick', 'copperPick', 'stonePick', 'woodPick'].find(id => g.state.inventory[id]);
        if (tool) equip(tool);
        aim(p.x + (x - p.x) / dist, p.y + .6, p.z + (z - p.z) / dist);
      }
      g.step({
        forward: true,
        jump: stuck > 30 && stuck < 60,
        mine: stuck > 60 && p.boat === null
      }, 1 / 60);
      if (n % 30 === 0) {
        if (dist > last - .05) stuck += 30;else stuck = 0;
        last = dist;
      }
      if (stuck > 500) throw new Error(`Walk stuck toward ${x},${z}: at ${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)} target ${JSON.stringify(g.target())}, message ${g.message}, selected ${g.selected()}, grounded ${g.grounded}`);
    }
    throw new Error('Walk timed out');
  }
  function hit(x, y, z) {
    aim(x + .5, y + .5, z + .5);
    const t = g.target();
    return t && t.x === x && t.y === y && t.z === z;
  }
  function mine(x, y, z) {
    if (!hit(x, y, z)) {
      walk(x + .5, z + .5, 1.45);
      if (!hit(x, y, z)) throw new Error(`Occluded mining ${x},${y},${z} by ${JSON.stringify(g.target())}`);
    }
    const old = g.world.get(x, y, z);
    for (let n = 0; n < 350 && g.world.get(x, y, z) === old; n++) g.step({
      mine: true
    }, 1 / 60);
    if (g.world.get(x, y, z) !== 0) throw new Error(`Mining failed ${D.blocks[old].key}: ${g.message}`);
  }
  function natural(id, count, radius = 9) {
    const block = D.ids[id];
    let guard = 0;
    while ((g.state.inventory[D.blocks[block].drop || id] || 0) < count) {
      let found = null,
        best = Infinity;
      for (let x = Math.floor(p.x) - radius; x <= p.x + radius; x++) for (let z = Math.floor(p.z) - radius; z <= p.z + radius; z++) for (let y = Math.max(1, Math.ceil(p.y)); y <= Math.min(75, p.y + 4); y++) {
        if (g.world.get(x, y, z) !== block) continue;
        const d = Math.hypot(x + .5 - p.x, y + .5 - p.y, z + .5 - p.z);
        if (Math.hypot(x + .5 - p.x, z + .5 - p.z) > 1.5 && d < best && d < 5.3 && hit(x, y, z)) {
          best = d;
          found = [x, y, z];
        }
      }
      if (!found) throw new Error(`No exposed ${id} near ${p.x.toFixed(1)},${p.y.toFixed(1)},${p.z.toFixed(1)}`);
      mine(...found);
      if (++guard > 100) throw new Error('Resource guard');
    }
  }
  function craft(id, n = 1) {
    const recipe = D.recipes.find(r => r.id === id);
    if (recipe.station && !g.stations().has(recipe.station)) {
      const station = Object.entries(g.state.placed).find(([, id]) => id === D.ids[recipe.station]);
      if (station) {
        const [x,, z] = station[0].split(',').map(Number);
        walk(x + .5, z + .5, 2.5);
      } else if (g.state.inventory[recipe.station]) place(recipe.station);
    }
    if (!g.craft(id, n)) throw new Error(`Craft ${id}: ${g.message}`);
    note(`craft ${id} ×${n}`);
  }
  function place(id) {
    equip(id);
    for (let radius = 2; radius < 5; radius++) for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
      const x = Math.floor(p.x) + dx,
        z = Math.floor(p.z) + dz,
        y = g.world.top(x, z) - 1;
      if (y < D.C.sea - 1 || y > p.y + .3 || g.state.placed[W.key(x, y, z)]) continue;
      aim(x + .5, y + .85, z + .5);
      const t = g.target();
      if (!t || t.x !== x || t.y !== y || t.z !== z || t.prev[1] !== y + 1) continue;
      if (g.place()) {
        note(`place ${id} at ${t.prev}`);
        return t.prev;
      }
    }
    throw new Error('Cannot place ' + id);
  }
  advance(.2);
  note('fresh empty pack on Sunwake Cay');
  const logs = g.world.starterProps().filter(q => q[3] === D.ids.log).sort((a, b) => Math.hypot(a[0] - p.x, a[2] - p.z) - Math.hypot(b[0] - p.x, b[2] - p.z));
  for (const q of logs) {
    walk(q[0] + .5, q[2] + .5, 3);
    mine(...q.slice(0, 3));
  }
  note(`gathered ${g.state.inventory.log} beach logs with empty hands`);
  const bushes = g.world.starterProps().filter(q => q[3] === D.ids.berryBush);
  for (const q of bushes) {
    walk(q[0] + .5, q[2] + .5, 2.8);
    if (!hit(...q.slice(0, 3))) throw new Error('Bush obscured');
    g.interact();
  }
  note('picked renewable berries, fiber and seeds');
  craft('plank', 3);
  craft('bench');
  craft('woodPick');
  place('bench');
  equip('woodPick');
  // Walk the authored cave entrance ramp and stop at exposed mineral walls.
  const net = g.world.networks[0],
    path = net.paths[0];
  walk(path[0][0], path[0][2], .65);
  for (let j = 1; j < path.length; j++) {
    const a = path[j - 1],
      b = path[j];
    for (let t = .08; t <= 1.01; t += .08) {
      walk(a[0] + (b[0] - a[0]) * Math.min(1, t), a[2] + (b[2] - a[2]) * Math.min(1, t), .5);
      if ((g.state.inventory.stone || 0) < 20) try {
        natural('stone', 20, 5);
      } catch {}
      if ((g.state.inventory.copperOre || 0) < 12) try {
        natural('copperOre', 12, 5);
      } catch {}
      if ((g.state.inventory.coal || 0) < 8) try {
        natural('coalOre', 8, 5);
      } catch {}
    }
  }
  note(`walked mineable cave to chamber: stone ${g.state.inventory.stone || 0}, copper ${g.state.inventory.copperOre || 0}, coal ${g.state.inventory.coal || 0}`);
  if ((g.state.inventory.copperOre || 0) < 4 || !g.state.inventory.coal) throw new Error('Cave did not yield basic smelting resources');
  // Return along the same real ramps, then use the game's explicit camp return.
  for (const node of [...path].reverse()) walk(node[0], node[2], .8);
  if (!g.returnCamp()) throw new Error(g.message);
  advance(.2);
  note('returned to camp by the disclosed camp-return action');
  const bench = Object.entries(g.state.placed).find(([, id]) => id === D.ids.bench)[0].split(',').map(Number);
  walk(bench[0] + .5, bench[2] + .5, 3);
  craft('stonePick');
  equip('stonePick');
  // Shore clay is exposed; gather along the initial shore without injecting inventory.
  const claySites = [];
  for (let x = -216; x < -188; x++) for (let z = 85; z < 108; z++) {
    const h = W.column(x, z, g.state.seed).h;
    if (g.world.get(x, h, z) === D.ids.clay) claySites.push([x, h, z]);
  }
  for (const q of claySites.sort((a, b) => Math.hypot(a[0] - p.x, a[2] - p.z) - Math.hypot(b[0] - p.x, b[2] - p.z))) {
    if ((g.state.inventory.clay || 0) >= 8) break;
    try {
      walk(q[0] + .5, q[2] + .5, 3);
      mine(...q);
    } catch {}
  }
  walk(bench[0] + .5, bench[2] + .5, 3);
  craft('kiln');
  const kiln = place('kiln');
  walk(kiln[0] + .5, kiln[2] + .5, 2.5);
  craft('copper', 2);
  craft('copperPick');
  note('upgraded to copper tools using mined ore');
  craft('plank', 2);
  craft('torch');
  place('torch');
  if ((g.state.inventory.dirt || 0) < 2) {
    equip('copperPick');
    natural('grass', 2, 5);
  }
  craft('farmland');
  const farm = place('farmland');
  aim(farm[0] + .5, farm[1] + .15, farm[2] + .5);
  g.interact();
  if (!g.state.crops[W.key(...farm)]) throw new Error('Could not plant garden');
  note('planted a working garden bed');
  advance(101);
  for (const q of bushes) {
    walk(q[0] + .5, q[2] + .5, 1.45);
    if (hit(...q.slice(0, 3))) g.interact();
  }
  walk(bench[0] + .5, bench[2] + .5, 3);
  craft('rope', 3);
  craft('raft');
  craft('rod');
  walk(-229, 106, 1);
  equip('raft');
  if (!g.place()) throw new Error('Launch failed ' + g.message);
  note('launched a crafted raft from the actual coast');
  walk(-285, 106, 1);
  walk(-285, -170, 1);
  walk(-252, -170, 2);
  g.interact();
  walk(-247, -170, 1.2);
  advance(.5);
  if (!g.state.discoveries.includes('forest')) throw new Error('Forest not discovered');
  note(`sailed ${Math.round(g.state.stats.sailed)} metres to Mossbell Reach, moored and walked ashore`);
  // Return on the moored vessel to keep the voyage, rather than teleporting it.
  walk(g.state.boats[0].x, g.state.boats[0].z, 1.5);
  g.interact();
  if (p.boat === null) throw new Error('Could not reboard');
  walk(-285, -170, 1);
  walk(-285, 106, 1);
  walk(-229, 106, 1);
  g.interact();
  equip('rod');
  aim(-245, p.y, -106 + 212);
  g.interact();
  advance(6.2);
  if (!g.state.inventory.fish) throw new Error('Fishing did not catch');
  note('caught a silverfin using the six-second fishing activity');
  if (!g.returnCamp()) throw new Error(g.message);
  walk(farm[0] + .5, farm[2] + .5, 2.7);
  aim(farm[0] + .5, farm[1] + .15, farm[2] + .5);
  g.interact();
  if (!g.state.stats.harvest) throw new Error('Garden was not ready after the voyage');
  note('harvested a matured garden after the voyage');
  walk(bench[0] + .5, bench[2] + .5, 3);
  craft('campfire');
  const fire = place('campfire');
  walk(fire[0] + .5, fire[2] + .5, 2);
  craft('grilledFish');
  if (!g.eat('grilledFish')) throw new Error('Could not eat cooked food');
  note('cooked and ate the caught fish');
  return {
    log,
    state: g.snapshot()
  };
}
if (typeof module === 'object') module.exports = {
  runProgression
};
