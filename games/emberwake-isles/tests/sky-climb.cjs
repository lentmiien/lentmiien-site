/* The fixture starts afloat with building supplies. Every metre from the boat to
   the deck uses the ordinary movement, ray, placement and collision handlers. */
function climbFromSea(g, D, site) {
  const sailedBefore = g.state.stats.sailed, z = site.z + 2;
  let edge = site.x - site.rx;
  while (!g.world.sky.profile(edge, z)) {
    if (++edge > site.x + site.rx) throw Error('Missing west ledge');
  }
  const x = edge - 1, deck = g.world.top(edge, z);
  const p = g.state.player;
  Object.assign(p, { x: x + .5 - 14, y: D.C.sea - .3, z: z + .5, yaw: -Math.PI / 2, pitch: 0, boat: null });
  g.state.inventory = { raft: 1, stone: 100, woodPick: 1 };
  g.state.hotbar[0] = 'stone'; g.state.selected = 0; g.paused = false;
  if (!g.launchBoat('raft')) throw Error(g.message);
  for (let i = 0; i < 60; i++) g.step({ forward: true }, 1 / 60);
  if (!g.interact() || p.boat !== null || Math.floor(p.x) !== x) throw Error('Mooring missed');
  p.yaw = 0; p.pitch = -1.48;
  for (let i = 0; i < 450 && !g.target(); i++) g.step({ down: true }, 1 / 60);
  const start = g.state.stats.placed;
  for (let i = 0; i < 9000 && g.world.top(x, z) < deck; i++) {
    const hit = g.target();
    if (hit && hit.x === x && hit.z === z && hit.prev[1] + 1 <= p.y) g.place();
    g.step({ jump: true }, 1 / 60);
  }
  if (g.world.top(x, z) < deck) throw Error('Tower stopped at ' + g.world.top(x,z) + ' with player at ' + p.y);
  p.yaw = -Math.PI / 2; p.pitch = 0;
  for (let i = 0; i < 36; i++) g.step({ forward: true }, 1 / 60);
  if (!g.state.discoveries.includes(site.id) || g.collides(p.x, p.y, p.z)) throw Error('Did not reach ' + site.name);
  return { site: site.name, blocksPlaced: g.state.stats.placed - start, deck, sailed: Math.round(g.state.stats.sailed - sailedBefore) };
}
if (typeof module === 'object') module.exports = { climbFromSea };
