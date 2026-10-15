/* Continues the empty-pack scenario using its earned equipment. No state grants or teleporting. */
function runExpansion(g, D, W, c) {
  const { walk, aim, equip, mine, natural, craft, place, advance, note } = c;
  const p = g.state.player;
  for (let round = 0; round < 2; round++) {
  advance(101);
  for (const q of g.world.starterProps().filter(q => q[3] === D.ids.berryBush)) {
    walk(q[0] + .5, q[2] + .5, 2.8); aim(q[0] + .5, q[1] + .5, q[2] + .5); g.interact();
  }
  }
  craft('rope', 3);
  const bench = Object.entries(g.state.placed).find(([, id]) => id === D.ids.bench)[0].split(',').map(Number);
  walk(bench[0] + .5, bench[2] + .5, 2.5); equip('copperPick'); mine(...bench);
  walk(g.state.boats[0].x, g.state.boats[0].z, 1.5); g.interact();
  if (p.boat === null) throw new Error('Could not reboard earned raft');
  walk(-285, 106, 1); walk(-545, 106, 1); walk(-560, -100.5, 1); walk(-577, -100.5, 2); g.interact();
  walk(-590, -100.5, 1); advance(.2);
  if (!g.state.discoveries.includes('reed')) throw new Error('Reedglass not discovered');
  note('sailed beyond the old boundary and walked onto Reedglass Haven');
  function bamboo(count) {
    for (let tries = 0; (g.state.inventory.bamboo || 0) < count && tries < 80; tries++) {
      let target, best = Infinity;
      for (let x = Math.floor(p.x) - 18; x <= p.x + 18; x++) for (let z = Math.floor(p.z) - 18; z <= p.z + 18; z++) {
        const h = W.column(x, z, g.state.seed).h;
        for (let y = h + 1; y <= h + 4; y++) if (g.world.get(x, y, z) === D.ids.bamboo) {
          const dist = Math.hypot(x + .5 - p.x, y - p.y, z + .5 - p.z);
          if (dist < best) { best = dist; target = [x, y, z]; }
        }
      }
      if (!target) { walk(p.x - 8, p.z, 1); continue; }
      walk(target[0] + .5, target[2] + .5, 2); mine(...target);
    }
    if ((g.state.inventory.bamboo || 0) < count) throw new Error('Bamboo collection failed');
  }
  bamboo(24); craft('bambooStaff'); craft('bambooPlank', 2); place('bench');
  craft('bambooScreen');
  while ((g.state.inventory.dirt || 0) < 2) {
    const x = Math.floor(p.x) + 2, z = Math.floor(p.z), y = W.column(x, z, g.state.seed).h;
    equip('copperPick'); mine(x, y, z);
    if (g.world.get(x, y - 1, z) === D.ids.dirt) mine(x, y - 1, z);
  }
  craft('bambooPlanter'); const nursery = place('bambooPlanter');
  advance(91);
  aim(nursery[0] + .5, nursery[1] + .5, nursery[2] + .5); g.interact();
  if (!g.state.inventory.bambooShoot) throw new Error('Nursery harvest failed');
  place('bambooScreen');
  note('gathered natural bamboo; crafted a staff, boards, screen and working nursery; harvested shoots');
  const cave = g.world.networks.find(cave => cave.island === 'reed');
  equip('copperPick'); walk(cave.entrance[0], cave.entrance[2], .65);
  for (const node of cave.paths[0]) {
    walk(node[0], node[2], .65);
    try { natural('jadeOre', 4, 5); } catch {}
    try { natural('limestone', 6, 5); } catch {}
  }
  for (const node of [...cave.paths[0]].reverse()) walk(node[0], node[2], .65);
  if (!g.state.inventory.jade) throw new Error('No jade mined along cave path');
  note('walked Reedglass cave to its deep chamber and back, mining jade');
  const i = D.islands.find(i => i.id === 'reed'), x = i.x + 12, z = i.z - 10, y = W.column(x, z, g.state.seed).h + 1;
  walk(cave.entrance[0] - 8.5, cave.entrance[2] - 2.5, 1);
  walk(cave.entrance[0] - 8.5, z - 35.5, 1);
  walk(x + .5, z - 35.5, 1);
  walk(x + .5, z + 2.5, 1); aim(x + .5, y + .5, z + .5); g.interact();
  if (g.state.expedition.projects.reed !== 1) throw new Error('Wind organ first stage failed: ' + g.message);
  note('restored the first wind-organ stage with gathered bamboo and crafted rope');
  if (!g.returnCamp()) throw new Error(g.message);
  return { state: g.snapshot(), time: g.state.time, stats: g.state.stats };
}
if (typeof module === 'object') module.exports = { runExpansion };
