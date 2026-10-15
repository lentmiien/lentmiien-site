/* Small bounded encounter system. Runtime positions reset home on load; health and respawn timers persist. */
(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./data.js') : root.EWData);
  if (typeof module === 'object') module.exports = api; else root.EWActors = api;
})(typeof window !== 'undefined' ? window : globalThis, function (D) {
  'use strict';
  class Encounters {
    constructor(game) { this.game = game; this.actors = []; this.nextSwing = 0; }
    homeGround(x, z, island, home) {
      if (Math.hypot((x - island.x) / island.rx, (z - island.z) / island.rz) > .72 || Math.hypot(x - home.x, z - home.z) > 13) return null;
      const world = this.game.world, y = world.top(x, z);
      if (y <= D.C.sea + 1 || y > D.C.height - 2 || !world.solid(x, y - .1, z) || world.solid(x, y + .5, z)) return null;
      return y;
    }
    step(dt) {
      const g = this.game, s = g.state, p = s.player;
      const island = D.islands.find(i => i.enemies);
      if (Math.hypot(p.x - island.x, p.z - island.z) > 120) { this.actors = []; return; }
      if (!this.actors.length) {
        for (let n = 0; n < 6; n++) {
          const home = { x: island.x + (n % 3 - 1) * 13 + .5, z: island.z - 10 + Math.floor(n / 3) * 20 + .5 };
          this.actors.push({ id: `amber:${n}`, home, x: home.x, z: home.z, y: 0, alive: false, nextBump: 0 });
        }
      }
      for (const a of this.actors) {
        const record = s.expedition.creatures[a.id] ||= { health: 3, respawn: 0 };
        if (!record.health && s.time >= record.respawn) { record.health = 3; record.respawn = 0; a.x = a.home.x; a.z = a.home.z; }
        const floor = this.homeGround(a.x, a.z, island, a.home);
        a.alive = record.health > 0 && floor !== null;
        if (!a.alive) continue;
        a.y = floor;
        const distance = Math.hypot(a.x - p.x, a.z - p.z);
        const chase = distance < 9 && Math.abs(p.y - a.y) < 2 && p.boat === null;
        const dest = chase ? p : a.home;
        const len = Math.hypot(dest.x - a.x, dest.z - a.z);
        if (len > (chase ? 1.15 : .2)) {
          const nx = a.x + (dest.x - a.x) / len * dt * 1.3, nz = a.z + (dest.z - a.z) / len * dt * 1.3;
          const ny = this.homeGround(nx, nz, island, a.home);
          if (ny !== null && Math.abs(ny - a.y) <= 1.05) { a.x = nx; a.z = nz; a.y = ny; }
        }
        if (chase && distance < 1.3 && s.time >= a.nextBump) {
          // Walls and floors stop contact as well as weapon rays. Never lethal.
          const eye = g.eye(), target = { x: a.x, y: a.y + .5, z: a.z };
          const d = Math.hypot(target.x - eye.x, target.y - eye.y, target.z - eye.z);
          const wall = g.world.ray(eye, { x: (target.x - eye.x) / d, y: (target.y - eye.y) / d, z: (target.z - eye.z) / d }, d);
          if (!wall) { p.health = Math.max(25, p.health - 2); g.notify('A pebble mite nudged you (−2). Hold left click to shoo it; three barehanded hits.'); }
          a.nextBump = s.time + 2;
        }
      }
    }
    target() {
      const g = this.game, o = g.eye(), d = g.direction();
      let best = null, distance = Math.min(3.2, g.target()?.distance ?? 3.2);
      for (const a of this.actors) {
        if (!a.alive) continue;
        let near = 0, far = distance;
        for (const [axis, lo, hi] of [['x', a.x - .55, a.x + .55], ['y', a.y, a.y + 1], ['z', a.z - .55, a.z + .55]]) {
          if (Math.abs(d[axis]) < 1e-8) { if (o[axis] < lo || o[axis] > hi) far = -1; }
          else { const t1 = (lo - o[axis]) / d[axis], t2 = (hi - o[axis]) / d[axis]; near = Math.max(near, Math.min(t1, t2)); far = Math.min(far, Math.max(t1, t2)); }
        }
        if (near <= far && near < distance) { best = a; distance = near; }
      }
      return best;
    }
    hit() {
      const g = this.game, s = g.state, a = this.target();
      if (!a || s.status !== 'alive' || g.paused) return false;
      if (s.time < this.nextSwing) return true;
      this.nextSwing = s.time + .55;
      const record = s.expedition.creatures[a.id], held = g.selected();
      const damage = s.inventory[held] ? D.items[held].weapon || 1 : 1;
      if (record.health <= damage) {
        if (!g.give({ fossil: 1, amber: 1 })) return true;
        record.health = 0; record.respawn = s.time + 300; a.alive = false;
        s.expedition.defeated++;
        g.notify('Pebble mite shooed! Found a spiral fossil and amber. It rests for five minutes.');
      } else { record.health -= damage; g.notify(`Gentle bonk · pebble mite ${record.health}/3 · a bamboo staff needs only one hit.`); }
      return true;
    }
  }
  return { Encounters };
});
