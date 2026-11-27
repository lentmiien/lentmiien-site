'use strict';
const D = require('../../multiplayer/emberwake/js/data');
const W = require('../../multiplayer/emberwake/js/world');
const G = require('../../multiplayer/emberwake/js/game');
const { Encounters } = require('../../multiplayer/emberwake/js/actors');
const { baseRadius } = require('../../multiplayer/emberwake/js/soundings');
const { Voyager } = require('./voyager');
const State = require('./state');
const { problem } = require('./repository');
const { controls } = require('./protocol');

const colors = ['#ed9d62', '#69c9b5', '#afa1e5', '#dfbd57', '#69b6d9', '#e298b2', '#a1c581', '#cf9476'];
const names = ['Kingfisher', 'Tern', 'Petrel', 'Heron', 'Puffin', 'Osprey', 'Ibis', 'Gannet'];
function flag(number) {
  const n = number - 1;
  return {
    number,
    name: n < 8 ? names[n] : names[n % 8] + ' ' + (1 + Math.floor(n / 8)),
    color: colors[n % 8]
  };
}
class Simulation {
  constructor(data) {
    this.seed = data.seed;
    this.time = data.time;
    this.shared = State.fields(data, State.SHARED);
    this.world = new W.World(data.seed, data.edits);
    this.world.sky.prepare();
    this.world.onEdit = (x, y, z, id) => {
      const k = W.key(x, y, z);
      this.changes.set(k, [x, y, z, id]);
      for (const g of this.online.values()) if (g.mineKey === k) g.mineProgress = 0;
    };
    this.treasures = [
      ...this.world.soundings.map(s => s.chest),
      ...[...this.world.sky.vaults.keys()].map(W.decodeKey),
      ...this.world.networks.map(c => [c.chamber[0], c.chamber[1], c.chamber[2] + 3]),
      ...D.islands.map(i => [i.x + 12, 0, i.z - 10])
    ].map(([x, , z]) => ({ x: x + 0.5, z: z + 0.5 }));
    // A process may stop after a periodic checkpoint with sailors still aboard.
    // All persisted vessels are moored until a live character boards them again.
    this.crew = new Map(
      data.crew.map(r => [r.user, { ...r, data: { ...r.data, player: { ...r.data.player, boat: null } } }])
    );
    this.online = new Map();
    this.changes = new Map();
    this.habitats = new Map();
    this.cropChanges = new Set();
    this.order = 0;
  }
  bases() {
    const bases = [];
    for (const r of this.crew.values()) {
      const base = (this.online.get(r.user)?.state || r.data).base;
      if (base) {
        const [x, y, z] = W.decodeKey(base);
        bases.push({ ...flag(r.number), x: x + 0.5, y, z: z + 0.5 });
      }
    }
    return bases;
  }
  canBuild(number, x, z) {
    return !this.bases().some(
      b =>
        b.number !== number && Math.hypot(Math.floor(x) + 0.5 - b.x, Math.floor(z) + 0.5 - b.z) <= baseRadius
    );
  }
  connect(user) {
    if (this.online.has(user)) return this.online.get(user);
    if (this.online.size >= State.MAX_ONLINE) throw problem('ROOM_FULL');
    let crew = this.crew.get(user);
    const state = G.fresh(this.seed);
    if (!crew) {
      if (this.crew.size >= State.MAX_CREW) throw problem('CREW_FULL');
      // Leave room for a new arrival to see the other sailors on the beach.
      if (this.online.size) {
        const p = state.player;
        for (const [dx, dz] of [
          [2, -3],
          [-2, -3],
          [4, -1],
          [-4, -1],
          [3, 2],
          [-3, 2],
          [0, 4],
          [0, -5]
        ]) {
          const x = p.x + dx,
            z = p.z + dz;
          if (
            [...this.online.values()].every(g => Math.hypot(g.state.player.x - x, g.state.player.z - z) > 1)
          ) {
            Object.assign(p, { x, z, y: this.world.top(x, z) + 0.01 });
            break;
          }
        }
      }
      crew = { user, number: this.crew.size + 1, data: State.personal(state) };
      this.crew.set(user, crew);
    }
    Object.assign(state, State.fields(crew.data, State.PERSONAL), this.shared, { time: this.time });
    state.sky.finds = crew.data.skyFinds;
    const g = new Voyager(state, this, crew);
    this.online.set(user, g);
    if (state.status !== 'alive' || state.player.health <= 0) g.respawn();
    this.resetControls(g);
    return g;
  }
  resetControls(g) {
    g.inputMask = 0;
    g.inputAt = 0;
    g.inputSeq = 0;
    g.mineProgress = 0;
    g.openChest = null;
    g.messageSent = -1;
    g.privateSent = '';
    g.jumpOnce = false;
  }
  disconnect(user) {
    const g = this.online.get(user);
    if (!g) return;
    g.state.player.boat = null;
    g.crew.data = State.personal(g.state);
    this.online.delete(user);
  }
  input(g, p, now) {
    if (p.seq <= g.inputSeq) return;
    if (p.keys & 128 && !(g.inputMask & 128)) g.mineOrder = ++this.order;
    if (p.keys & 16 && !(g.inputMask & 16)) g.jumpOnce = true;
    if (!(p.keys & 128)) g.mineProgress = 0;
    g.inputSeq = p.seq;
    g.inputAt = now;
    g.inputMask = p.keys;
    g.state.player.yaw = p.yaw;
    g.state.player.pitch = p.pitch;
  }
  action(g, a) {
    if (g.state.status !== 'alive') return { ok: false, message: 'Wait until you are back on shore.' };
    const s = g.state;
    let ok = true;
    switch (a.op) {
      case 'use': {
        const hit = g.target();
        ok = g.interact();
        if (hit?.id === D.ids.farmland) this.cropChanges.add(W.key(hit.x, hit.y, hit.z));
        break;
      }
      case 'place':
        ok = g.place();
        break;
      case 'eat':
        ok = g.eat(D.items[g.selected()]?.food ? g.selected() : 'berry');
        break;
      case 'home':
        ok = g.returnCamp();
        break;
      case 'craft':
        ok = g.craft(a.item, a.count);
        break;
      case 'travel':
        ok = g.travelPortal(a.exit);
        break;
      case 'transfer':
        ok = g.transfer(g.openChest, a.item, a.count, a.deposit);
        break;
      case 'closeChest':
        g.openChest = null;
        break;
      case 'select':
        s.selected = a.slot;
        break;
      case 'assign':
        if (s.inventory[a.item]) s.hotbar[a.slot] = a.item;
        else ok = g.notify('Gather this item before equipping it.');
        break;
      case 'settings':
        s.settings = { sound: a.sound, view: a.view, sensitivity: a.sensitivity };
        break;
      default:
        throw problem('INVALID_INPUT');
    }
    return { ok, message: g.message, chest: a.op === 'use' ? g.accessibleChest() : null };
  }
  // One set of animals per inhabited island. Whichever visitor is nearest the
  // habitat guides its movement. Every visitor sees and hits the same animals.
  wildlife(dt) {
    const groups = new Map();
    for (const g of this.online.values()) {
      g.encounters.actors = [];
      if (g.state.status !== 'alive') continue;
      const p = g.state.player,
        island = D.islands.find(i => i.enemies && Math.hypot(p.x - i.x, p.z - i.z) <= 120);
      if (island) {
        if (!groups.has(island)) groups.set(island, []);
        groups.get(island).push(g);
      }
    }
    for (const [island, visitors] of groups) {
      const dist = g => Math.hypot(g.state.player.x - island.x, g.state.player.z - island.z);
      visitors.sort((a, b) => dist(a) - dist(b));
      const actors = this.habitats.get(island.id) || new Encounters(visitors[0]);
      actors.game = visitors[0];
      actors.step(dt);
      this.habitats.set(island.id, actors);
      for (const g of visitors) g.encounters.actors = actors.actors;
    }
    for (const id of this.habitats.keys())
      if (!groups.has(D.islands.find(i => i.id === id))) this.habitats.delete(id);
  }
  tick(dt, now) {
    if (!this.online.size) return;
    this.time += dt;
    this.wildlife(dt);
    const miners = [];
    for (const g of this.online.values()) {
      const input = controls(now - g.inputAt < 500 ? g.inputMask : 0);
      input.jump ||= g.jumpOnce;
      g.jumpOnce = false;
      const mining = input.mine;
      input.mine = false;
      // Mining has its own ordered phase after all movement for this tick.
      const progress = g.mineProgress;
      g.state.time = this.time - dt;
      if (g.state.player.health <= 0) g.state.status = 'dead';
      g.step(input, dt);
      g.state.time = this.time;
      if (g.state.status === 'dead' || g.state.player.health <= 0) {
        g.respawn();
        this.resetControls(g);
      } else if (mining && g.state.status === 'alive') {
        const hit = g.target(),
          block = D.blocks[hit?.id],
          held = g.state.inventory[g.selected()] ? D.items[g.selected()] : null;
        const remaining = block
          ? (block.hardness - (g.mineKey === W.key(hit.x, hit.y, hit.z) ? progress : 0)) /
            g.miningSpeed(block, held)
          : Infinity;
        g.mineProgress = progress;
        miners.push({ g, remaining });
      }
    }
    miners.sort((a, b) => a.remaining - b.remaining || a.g.mineOrder - b.g.mineOrder);
    for (const { g } of miners) g.mine(dt);
    this.world.dirty.clear();
    if (this.world.chunks.size > this.online.size * 25 + 16) {
      const centers = [...this.online.values()].map(g => [
        Math.floor(g.state.player.x / 16),
        Math.floor(g.state.player.z / 16)
      ]);
      for (const key of this.world.chunks.keys()) {
        const [x, z] = key.split(',').map(Number);
        if (!centers.some(([cx, cz]) => Math.abs(cx - x) <= 2 && Math.abs(cz - z) <= 2))
          this.world.chunks.delete(key);
      }
    }
  }
  checkpoint() {
    return State.encode({
      version: 1,
      seed: this.seed,
      time: this.time,
      edits: this.world.serialize(),
      ...this.shared,
      crew: [...this.crew.values()].map(r => ({
        user: r.user,
        number: r.number,
        data: this.online.has(r.user) ? State.personal(this.online.get(r.user).state) : r.data
      }))
    });
  }
  joined(g) {
    return {
      ...flag(g.crew.number),
      bases: this.bases(),
      state: { ...g.state, edits: this.world.serialize(), harvests: {} }
    };
  }
  takeDelta() {
    const blocks = [...this.changes.values()].map(c => [
      ...c,
      this.shared.placed[W.key(...c.slice(0, 3))] || 0
    ]);
    for (const c of blocks) this.cropChanges.add(W.key(...c.slice(0, 3)));
    const crops = [...this.cropChanges].map(k => [k, this.shared.crops[k] || null]);
    this.changes.clear();
    this.cropChanges.clear();
    return { blocks, crops };
  }
  frame(g, delta, savedAt) {
    const s = g.state,
      chest = g.accessibleChest();
    g.openChest = chest;
    const self = {
      ...State.fields(s, [
        'inventory',
        'hotbar',
        'selected',
        'discoveries',
        'secrets',
        'caveFinds',
        'salvaged',
        'crafted',
        'stats',
        'camp',
        'base',
        'settings'
      ]),
      skyFinds: s.sky.finds,
      chest,
      stock: chest ? s.harvests['chest:' + chest] || {} : {},
      expedition: s.expedition
    };
    const signature = JSON.stringify(self);
    const peers = [...this.online.values()]
      .filter(o => o !== g)
      .map(o => ({
        ...flag(o.crew.number),
        ...State.fields(o.state.player, ['x', 'y', 'z', 'yaw', 'pitch', 'boat'])
      }));
    const frame = {
      time: this.time,
      player: s.player,
      status: s.status,
      disaster: s.disaster,
      buff: s.buff,
      mining: g.mineProgress,
      fishing: g.fishing,
      peers,
      bases: this.bases(),
      boats: s.boats,
      actors: g.encounters.actors.filter(a => a.alive).map(a => [a.id, a.island, a.x, a.y, a.z]),
      delta,
      savedAt
    };
    if (signature !== g.privateSent) {
      g.privateSent = signature;
      frame.self = self;
    }
    if (g.messageSent !== g.messageSerial) {
      g.messageSent = g.messageSerial;
      frame.notice = g.message;
    }
    return frame;
  }
}
module.exports = { Simulation, flag };
