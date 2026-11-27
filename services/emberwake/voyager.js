'use strict';
const D = require('../../multiplayer/emberwake/js/data');
const { Game } = require('../../multiplayer/emberwake/js/game');
const { baseRadius, treasureBuffer } = require('../../multiplayer/emberwake/js/soundings');
const { key, decodeKey } = require('../../multiplayer/emberwake/js/world');

class Voyager extends Game {
  constructor(state, sea, crew) {
    super(state, sea.world);
    this.sea = sea;
    this.crew = crew;
    this.paused = false;
    this.sharedEncounters = true;
    this.canBuild = (x, z) => sea.canBuild(crew.number, x, z);
    this.boatOccupied = id =>
      [...sea.online.values()].some(other => other !== this && other.state.player.boat === id);
  }
  denied() {
    return this.notify('A crew base protects this spot. Visitors can explore and take portals.');
  }
  mine(dt) {
    const hit = this.target(),
      actor = this.encounters.target();
    if ((actor && !this.canBuild(actor.x, actor.z)) || (hit && !this.canBuild(hit.x, hit.z))) {
      this.mineProgress = 0;
      if (this.message !== 'Protected base · viewing only.') this.notify('Protected base · viewing only.');
      return false;
    }
    const marker = hit && key(hit.x, hit.y, hit.z);
    const ok = super.mine(dt);
    if (ok && marker === this.state.base && !this.world.get(hit.x, hit.y, hit.z)) {
      this.state.base = null;
      this.state.camp = this.world.spawn();
      this.notify('Pennant recovered. The land is shared again.');
    }
    return ok;
  }
  place() {
    const item = this.selected();
    if (!D.items[item]?.block) return super.place();
    const hit = this.target();
    if (!hit) return super.place();
    const [x, y, z] = hit.prev;
    if (!this.canBuild(hit.x, hit.z) || !this.canBuild(x, z)) return this.denied();
    for (const other of this.sea.online.values()) {
      const p = other.state.player;
      if (
        other !== this &&
        x < p.x + 0.3 &&
        x + 1 > p.x - 0.3 &&
        z < p.z + 0.3 &&
        z + 1 > p.z - 0.3 &&
        y < p.y + 1.8 &&
        y + 1 > p.y
      )
        return this.notify('Another voyager is standing there.');
    }
    if (item === 'baseMarker') {
      if (this.state.base) return this.notify('Recover your current pennant first.');
      if (
        y < D.C.sea ||
        y > D.C.height - 4 ||
        !this.world.solid(x, y - 1, z) ||
        this.world.get(x, y + 1, z) ||
        this.world.get(x, y + 2, z)
      )
        return this.notify('Set the pennant on a dry solid floor with clear headroom.');
      const near = (p, r) => Math.hypot(x + 0.5 - p.x, z + 0.5 - p.z) <= r;
      if (near(this.world.spawn(), baseRadius + 20))
        return this.notify('Leave the landing beach open. Move farther from the shared arrival point.');
      if (this.sea.treasures.some(p => near(p, baseRadius + treasureBuffer)))
        return this.notify('A treasure reserve is nearby. Choose a spot farther away.');
      if (this.sea.bases().some(p => near(p, 2 * baseRadius)))
        return this.notify('Base territories must have 128 metres between their pennants.');
    }
    if (!super.place()) return false;
    if (item === 'baseMarker') {
      this.state.base = key(x, y, z);
      this.state.camp = { x: x + 0.5, y: y + 1, z: z + 0.5 };
      this.notify('Base founded. Your pennant protects a 64 m radius at every elevation.');
    }
    return true;
  }
  interact() {
    this.openChest = null;
    const p = this.state.player,
      hit = this.target();
    if (p.boat === null && !this.canBuild(hit?.x ?? p.x, hit?.z ?? p.z)) return this.denied();
    if (hit?.id === D.ids.baseMarker) return this.notify('Your base pennant · mine it to move your claim.');
    return super.interact();
  }
  accessibleChest() {
    if (!this.openChest || this.state.status !== 'alive') return null;
    const hit = this.target();
    return hit?.id === D.ids.chest &&
      key(hit.x, hit.y, hit.z) === this.openChest &&
      this.canBuild(hit.x, hit.z)
      ? this.openChest
      : null;
  }
  transfer(k, id, n, deposit) {
    if (!k || this.accessibleChest() !== k || id === 'baseMarker')
      return this.notify('Use an accessible storage chest. Your pennant stays with you.');
    return super.transfer(k, id, n, deposit);
  }
  arriveHome() {
    const p = this.state.player,
      origin = this.state.base ? decodeKey(this.state.base) : null;
    const home = origin ? { x: origin[0] + 0.5, y: origin[1] + 1, z: origin[2] + 0.5 } : this.world.spawn();
    // A roof or new stairs can change a berth. Prefer a clear solid landing by the flag.
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [2, 0],
      [-2, 0],
      [0, 2],
      [0, -2]
    ]) {
      const x = home.x + dx,
        z = home.z + dz;
      for (const y of [home.y, home.y - 1, home.y + 1, home.y + 2, this.world.top(x, z)]) {
        if (this.world.solid(x, y - 0.06, z) && !this.collides(x, y + 0.01, z)) {
          Object.assign(p, { x, y: y + 0.01, z, boat: null });
          this.resetMotion();
          return;
        }
      }
    }
    Object.assign(p, { x: home.x, y: this.world.top(home.x, home.z) + 0.02, z: home.z, boat: null });
    this.resetMotion();
  }
  resetMotion() {
    this.velocity = 0;
    this.mineProgress = 0;
    this.fishing = 0;
    this.openChest = null;
    this.lastPortal = this.standingPortal();
  }
  returnCamp() {
    if (this.state.status !== 'alive' || Math.hypot(this.state.player.x, this.state.player.z) >= D.C.warning)
      return this.notify('Sail back inside sheltered waters first.');
    this.arriveHome();
    this.notify(this.state.base ? 'Returned to your harbor pennant.' : 'Returned to the landing beach.');
    return true;
  }
  respawn() {
    Object.assign(this.state, { status: 'alive', disaster: 0, buff: 0 });
    Object.assign(this.state.player, { health: 100, food: 100, warmth: 100, boat: null });
    this.arriveHome();
    this.notify(
      this.state.base
        ? 'You woke at your base with your pack.'
        : 'You woke at the landing beach with your pack.'
    );
  }
}
module.exports = { Voyager };
