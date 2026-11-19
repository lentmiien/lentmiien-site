/* Continues the original earned-raft scenario through ordinary movement and actions. */
function visitPoppy(g, D, W, c) {
  const { walk, equip, mine, place, craft, advance } = c;
  const bench = Object.entries(g.state.placed).find(([, id]) => id === D.ids.bench)[0].split(',').map(Number);
  walk(bench[0] + .5, bench[2] + .5, 2.5);
  equip('copperPick'); mine(...bench);
  const boat = g.state.boats[0];
  walk(boat.x, boat.z, 1.5); g.interact();
  if (g.state.player.boat === null) throw Error('Failed to board earned raft');
  for (const [x, z] of [[-280, 110], [-430, 110], [-480, -330], [-1060, -330], [-1094, -210]]) walk(x, z, 1);
  g.interact(); walk(-1122.5, -210.5, 1); advance(.3);
  const i = D.islands.find(island => island.id === 'poppy');
  if (!g.state.discoveries.includes(i.id)) throw Error('Did not reach Poppy Escarpment');
  // Read the surrounding surface to choose a visible quarry face, then approach on foot.
  for (const [key, needed] of [[i.shades[0], 2], [i.shades[1], 2], [i.ore, 1]]) {
    const drop = D.blocks[D.ids[key]].drop || key;
    for (let attempt = 0; (g.state.inventory[drop] || 0) < needed && attempt < 20; attempt++) {
      const p = g.state.player, candidates = [];
      for (let x = Math.floor(p.x) - 22; x <= p.x + 22; x++) for (let z = Math.floor(p.z) - 22; z <= p.z + 22; z++) {
        const y = g.world.top(x, z) - 1;
        if (g.world.get(x, y, z) === D.ids[key]) candidates.push({ x, y, z, distance: Math.hypot(x + .5 - p.x, z + .5 - p.z) });
      }
      candidates.sort((a, b) => a.distance - b.distance);
      const target = candidates[0];
      if (!target) throw Error('No quarry face for ' + key);
      walk(target.x + .5, target.z + .5, .2); advance(.2);
      if (g.world.get(target.x, target.y, target.z) !== D.ids[key]) continue;
      equip('copperPick'); mine(target.x, target.y, target.z);
    }
  }
  place('bench'); craft('poppyBrick'); const voxel = place('poppyBrick');
  if (g.world.get(...voxel) !== D.ids.poppyBrick) throw Error('Missing earned brick');
  return voxel;
}
if (typeof module === 'object') module.exports = { visitPoppy };
