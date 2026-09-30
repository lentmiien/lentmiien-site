(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./data.js') : root.EWData, typeof module === 'object' ? require('./world.js') : root.EWWorld);
  if (typeof module === 'object') module.exports = api;else root.EWGame = api;
})(typeof window !== 'undefined' ? window : globalThis, function (D, W) {
  'use strict';

  const shapes = (typeof module === 'object' ? require('./mesher.js') : window.EWMesh).shapes;
  const {
      C,
      items,
      blocks,
      recipes,
      islands,
      ids: B
    } = D,
    {
      World,
      column,
      clamp,
      key,
      decodeKey
    } = W;
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  function total(inv) {
    return Object.values(inv).reduce((a, b) => a + b, 0);
  }
  function change(inv, delta, limit = C.pack) {
    const next = {
      ...inv
    };
    for (const [id, n] of Object.entries(delta)) {
      if (!items[id] || !Number.isInteger(n)) return null;
      next[id] = (next[id] || 0) + n;
      if (next[id] < 0 || next[id] > 999) return null;
      if (!next[id]) delete next[id];
    }
    return total(next) <= limit ? next : null;
  }
  function fresh(seed = 741092) {
    const w = new World(seed),
      p = w.spawn();
    return {
      version: 1,
      seed,
      time: 0,
      player: {
        ...p,
        yaw: -.5,
        pitch: -.12,
        health: 100,
        food: 100,
        warmth: 100,
        boat: null
      },
      inventory: {},
      hotbar: ['log', 'plank', 'woodPick', 'torch', 'berry', 'raft', 'stone', 'bench'],
      selected: 0,
      edits: {},
      placed: {},
      crops: {},
      harvests: {},
      boats: [],
      discoveries: [],
      secrets: [],
      caveFinds: [],
      crafted: [],
      stats: {
        mined: 0,
        placed: 0,
        fish: 0,
        harvest: 0,
        sailed: 0
      },
      camp: {
        ...p
      },
      status: 'alive',
      disaster: 0,
      buff: 0,
      settings: {
        sound: false,
        sensitivity: 1,
        view: 4
      },
      name: 'My island retreat'
    };
  }
  class Game {
    constructor(state = fresh(), journal = () => true) {
      this.state = state;
      this.world = new World(state.seed, state.edits);
      this.journal = journal;
      this.velocity = 0;
      this.grounded = false;
      this.paused = true;
      this.mineProgress = 0;
      this.mineKey = '';
      this.message = 'Welcome ashore. Gather the driftwood near the beach.';
      this.messageSerial = 0;
      this.fishing = 0;
      this.fishAt = null;
      this.saveBlocked = false;
      this.boundaryChecked = false;
      this.validatePosition();
    }
    notify(text) {
      this.message = text;
      this.messageSerial++;
      return false;
    }
    snapshot() {
      return {
        ...this.state,
        edits: this.world.serialize()
      };
    }
    validatePosition() {
      const p = this.state.player;
      if (this.collides(p.x, p.y, p.z)) {
        const y = this.world.top(p.x, p.z);
        p.y = y + .02;
        this.notify('Your arrival was moved above a changed block.');
      }
    }
    eye() {
      const p = this.state.player;
      return {
        x: p.x,
        y: p.y + (p.boat !== null ? 1.45 : 1.62),
        z: p.z
      };
    }
    direction() {
      const p = this.state.player;
      return {
        x: -Math.sin(p.yaw) * Math.cos(p.pitch),
        y: Math.sin(p.pitch),
        z: -Math.cos(p.yaw) * Math.cos(p.pitch)
      };
    }
    target() {
      return this.world.ray(this.eye(), this.direction());
    }
    selected() {
      return this.state.hotbar[this.state.selected];
    }
    collides(x, y, z) {
      for (let xx = Math.floor(x - .29); xx <= Math.floor(x + .29); xx++) for (let zz = Math.floor(z - .29); zz <= Math.floor(z + .29); zz++) for (let yy = Math.floor(y + .001); yy <= Math.floor(y + 1.74); yy++) {
        const block = blocks[this.world.get(xx, yy, zz)];
        if (!block.solid) continue;
        for (const b of shapes[block.shape] || [[0, 0, 0, 1, 1, 1]]) if (x + .29 > xx + b[0] && x - .29 < xx + b[3] && y + 1.74 > yy + b[1] && y + .001 < yy + b[4] && z + .29 > zz + b[2] && z - .29 < zz + b[5]) return true;
      }
      return false;
    }
    stations() {
      const p = this.state.player,
        set = new Set();
      for (const [k, v] of Object.entries(this.state.placed)) {
        const [x, y, z] = decodeKey(k);
        if (Math.hypot(x + .5 - p.x, y - p.y, z + .5 - p.z) < 7) set.add(blocks[v].key);
      }
      if (set.has('galley')) set.add('campfire');
      return set;
    }
    recipeStatus(recipe, count = 1) {
      if (!recipe) return {
        ok: false,
        reason: 'Unknown recipe'
      };
      if (this.state.status !== 'alive') return {
        ok: false,
        reason: 'This voyage has ended'
      };
      if (!Number.isInteger(count) || count < 1 || count > 20) return {
        ok: false,
        reason: 'Choose 1–20 batches'
      };
      if (recipe.station && !this.stations().has(recipe.station)) return {
        ok: false,
        reason: `Place ${items[recipe.station].name} within 7 blocks`
      };
      if (recipe.discovery && !this.state.discoveries.includes(recipe.discovery)) return {
        ok: false,
        reason: `Visit ${islands.find(i => i.id === recipe.discovery).name}`
      };
      const delta = {};
      for (const [id, n] of Object.entries(recipe.cost)) delta[id] = -n * count;
      delta[recipe.out] = (delta[recipe.out] || 0) + recipe.count * count;
      const next = change(this.state.inventory, delta);
      return {
        ok: !!next,
        reason: next ? 'Ready to craft' : 'Missing ingredients or pack is full',
        next
      };
    }
    craft(id, count = 1) {
      const r = recipes.find(r => r.id === id),
        result = this.recipeStatus(r, count);
      if (!result.ok) return this.notify(result.reason);
      this.state.inventory = result.next;
      if (!this.state.crafted.includes(id)) this.state.crafted.push(id);
      if (!this.state.hotbar.includes(id) && !this.state.hotbar.some(k => this.state.inventory[k])) this.state.hotbar[this.state.selected] = id;
      this.notify(`Crafted ${r.count * count} × ${items[id].name}`);
      return true;
    }
    give(delta) {
      const inv = change(this.state.inventory, delta);
      if (!inv) return this.notify('Pack full: use a chest, build, or eat to make room.');
      this.state.inventory = inv;
      return true;
    }
    mine(dt) {
      if (this.state.status !== 'alive') return false;
      const hit = this.target();
      if (!hit) {
        this.mineProgress = 0;
        return false;
      }
      const b = blocks[hit.id],
        held = items[this.selected()],
        tool = this.state.inventory[this.selected()] ? held : null;
      if (b.tier > (tool?.tool || 0)) {
        this.mineProgress = 0;
        return this.notify(b.tier === 99 ? 'This landmark cannot be mined. Press E to read it.' : `Needs ${b.tier === 1 ? 'a driftwood' : b.tier === 2 ? 'a stone' : 'a copper'} pick or better.`);
      }
      const k = key(hit.x, hit.y, hit.z);
      if (this.mineKey !== k) {
        this.mineProgress = 0;
        this.mineKey = k;
      }
      this.mineProgress += dt * (1 + (tool?.tool || 0) * .4 + (tool?.axe && b.key === 'log' ? 3 : 0) + (tool?.shovel && ['dirt', 'sand', 'clay', 'grass'].includes(b.key) ? 4 : 0));
      if (this.mineProgress < b.hardness) return false;
      const store = this.state.harvests['chest:' + k];
      if (store && total(store) > 0) return this.notify('Empty this chest before moving it.');
      const drop = b.drop || b.key,
        delta = {
          [drop]: 1
        };
      if (b.key === 'log') delta.resin = 1;
      if (b.key === 'leaves' || b.key === 'berryBush') {
        delta.fiber = 2;
        delta.seed = 1;
      }
      const inv = change(this.state.inventory, delta);
      if (!inv) return this.notify('Your pack is full.');
      if (!this.world.set(hit.x, hit.y, hit.z, 0)) return this.notify('Building limit reached. Export a backup before starting another world.');
      this.state.inventory = inv;
      delete this.state.placed[k];
      delete this.state.crops[k];
      delete this.state.harvests['chest:' + k];
      this.state.stats.mined++;
      this.mineProgress = 0;
      this.notify(`Gathered ${items[drop].name}`);
      return true;
    }
    place() {
      if (this.state.status !== 'alive') return false;
      const id = this.selected(),
        item = items[id];
      if (!this.state.inventory[id]) return this.notify('Select an item you own in your pack.');
      if (item?.food) return this.eat(id);
      if (item?.boat) return this.launchBoat(id);
      if (!item?.block) return this.notify('This item is used through crafting or E interactions.');
      const hit = this.target();
      if (!hit) return this.notify('Aim at a nearby surface (within 5½ blocks).');
      const [x, y, z] = hit.prev,
        p = this.state.player;
      if (this.world.get(x, y, z) || y < 1 || y >= C.height - 1) return this.notify('That space is occupied or outside building height.');
      if (x < p.x + .3 && x + 1 > p.x - .3 && z < p.z + .3 && z + 1 > p.z - .3 && y < p.y + 1.8 && y + 1 > p.y) return this.notify('Step back before placing a block here.');
      if (Math.hypot(x, z) > C.warning) return this.notify('Build inside the sheltered archipelago.');
      if (Object.keys(this.state.placed).length >= 12000) return this.notify('Camp block limit reached (12,000).');
      if (item.category === 'storage' && Object.values(this.state.placed).filter(v => v === B.chest).length >= 16) return this.notify('A world supports 16 storage chests.');
      if (!this.world.set(x, y, z, item.block)) return this.notify('World edit limit reached.');
      this.give({
        [id]: -1
      });
      this.state.placed[key(x, y, z)] = item.block;
      this.state.stats.placed++;
      this.notify(`Placed ${item.name}`);
      return true;
    }
    eat(id) {
      if (this.state.status !== 'alive' || !items[id]?.food || !this.state.inventory[id]) return false;
      this.give({
        [id]: -1
      });
      this.state.player.food = clamp(this.state.player.food + items[id].food, 0, 100);
      this.state.player.health = clamp(this.state.player.health + 15, 0, 100);
      this.state.buff = Math.max(this.state.buff, items[id].buff || 0);
      this.notify(`Enjoyed ${items[id].name}`);
      return true;
    }
    launchBoat(id) {
      const p = this.state.player;
      if (p.boat !== null) return this.notify('Moor your current vessel first (E).');
      if (this.state.boats.length >= 8) return this.notify('Mooring limit: eight vessels.');
      if (p.y > C.sea + .7 || !this.world.waterAt(p.x, C.sea - .5, p.z) || this.world.solid(p.x, C.sea - 1, p.z)) return this.notify('Wade into water, then use the selected raft or cutter.');
      const boat = {
        id: this.state.boats.reduce((m, b) => Math.max(m, b.id), 0) + 1,
        type: id,
        x: p.x,
        z: p.z,
        yaw: p.yaw
      };
      this.state.boats.push(boat);
      p.boat = boat.id;
      p.y = C.sea + .25;
      this.velocity = 0;
      this.give({
        [id]: -1
      });
      this.notify('Under sail · W/S ahead/astern · A/D strafe · mouse steers · E moors');
      return true;
    }
    interact() {
      if (this.state.status !== 'alive') return false;
      const p = this.state.player;
      if (p.boat !== null) {
        p.boat = null;
        this.notify('Raft moored. E nearby boards again.');
        return true;
      }
      const hit = this.target(),
        id = hit ? blocks[hit.id].key : null,
        k = hit ? key(hit.x, hit.y, hit.z) : null;
      if (id === 'relic') {
        const cave = this.world.networks.find(c => Math.hypot(c.chamber[0] - hit.x, c.chamber[1] - hit.y, c.chamber[2] + 3 - hit.z) < 1);
        if (cave) {
          const names = ['Singing Rain Chamber', 'Root Library', 'Amber Reservoir', 'Blue Echo Vault', 'Prism Nursery'];
          if (!this.state.caveFinds.includes(cave.island)) {
            if (!this.give(cave.island === 'cinder' ? {
              crystal: 2,
              pearl: 1
            } : {
              coal: 4,
              shell: 3,
              pearl: 1
            })) return false;
            this.state.caveFinds.push(cave.island);
          }
          this.notify(`${names[islands.findIndex(i => i.id === cave.island)]} · A sealed tidekeeper cache waits among mineral echoes. Its chart is now recorded in your collection.`);
          return true;
        }
        const i = islands.find(i => Math.hypot(i.x + 12 - hit.x, i.z - 10 - hit.z) < 2);
        if (i && !this.state.secrets.includes(i.id)) {
          if (!this.give({ pearl: 2, shell: 4 })) return false;
          this.state.secrets.push(i.id);
        }
        this.notify(i ? D.lore[islands.indexOf(i)] : 'A tidekeeper passed this way.');
        return true;
      }
      if (id === 'berryBush') {
        if ((this.state.harvests[k] || 0) > this.state.time) return this.notify('Berries are regrowing. Return in a minute or two.');
        if (this.give({
          berry: 4,
          fiber: 2,
          seed: 1
        })) {
          this.state.harvests[k] = this.state.time + 100;
          this.notify('Picked sunberries. The bush will regrow.');
        }
        return true;
      }
      if (id === 'farmland') {
        const crop = this.state.crops[k];
        if (crop && this.state.time >= crop.ready) {
          if (this.give({
            [crop.type]: 3,
            seed: 2
          })) {
            delete this.state.crops[k];
            this.state.stats.harvest++;
            this.notify('Harvest gathered. E plants the next crop.');
          }
          return true;
        }
        if (crop) {
          if (this.selected() === 'wateringCan' && this.state.inventory.wateringCan && !crop.watered) {
            crop.ready = Math.max(this.state.time + 5, crop.ready - 40);
            crop.watered = true;
            return this.notify('Watered: growth accelerated by 40 seconds.');
          }
          return this.notify(`${items[crop.type].name}: ready in ${Math.ceil(crop.ready - this.state.time)} seconds. Select watering can to tend.`);
        }
        if (!this.state.inventory.seed) return this.notify('Find seeds in bushes or leaves.');
        if (Object.keys(this.state.crops).length >= 512) return this.notify('Garden limit reached.');
        this.give({
          seed: -1
        });
        this.state.crops[k] = {
          type: (hit.x + hit.z) % 2 === 0 ? 'carrot' : 'grain',
          ready: this.state.time + 110,
          watered: false
        };
        this.notify('Garden planted. Roots and grain alternate by bed position.');
        return true;
      }
      if (id === 'bed' || id === 'silkBed') {
        this.state.camp = {
          x: hit.prev[0] + .5,
          y: hit.prev[1],
          z: hit.prev[2] + .5
        };
        p.food = Math.max(60, p.food);
        p.health = 100;
        p.warmth = 100;
        this.state.time += 120;
        this.notify('Rested for two minutes. Camp return point set beside the bed.');
        return true;
      }
      if (id === 'chest') {
        this.openChest = k;
        this.notify('Chest opened. Move items between pack and chest.');
        return true;
      }
      if (id && items[id].category) {
        if (['bath', 'fountain'].includes(id)) {
          p.health = 100;
          p.warmth = 100;
        }
        if (['picnic', 'galley'].includes(id)) p.food = Math.max(70, p.food);
        this.notify(`${items[id].name} · ${items[id].category} · quality ${items[id].quality}. ${id === 'telescope' ? 'Survey distant islands on the chart.' : id === 'gramophone' ? 'A music-box melody drifts over your camp.' : 'Contributes to a varied, thoughtfully arranged camp.'}`);
        return true;
      }
      if (this.selected() === 'rod' && this.state.inventory.rod) {
        const d = this.direction(),
          x = p.x + d.x * 4,
          z = p.z + d.z * 4;
        if (this.world.top(x, z) >= C.sea || p.y > C.sea + 5) return this.notify('Cast from a low shore toward open water.');
        if (!this.fishing) {
          this.fishing = 6;
          this.fishAt = {
            x: p.x,
            y: p.y,
            z: p.z
          };
          this.notify('Line cast. Stay close for six seconds…');
        }
        return true;
      }
      const boat = this.state.boats.find(b => Math.hypot(b.x - p.x, b.z - p.z) < 3.5);
      if (boat) {
        p.boat = boat.id;
        p.x = boat.x;
        p.z = boat.z;
        p.y = C.sea + .25;
        this.notify('Boarded vessel. Mouse steers; E moors.');
        return true;
      }
      if (p.y < C.sea + .6 && !this.world.solid(p.x, C.sea - 1, p.z) && this.state.inventory[this.selected()] && items[this.selected()]?.boat) return this.launchBoat(this.selected());
      if (p.y < C.sea + 1.5 && p.y > C.sea - 2) {
        const beach = key(Math.floor(p.x / 6), 0, Math.floor(p.z / 6));
        if ((this.state.harvests[beach] || 0) <= this.state.time) {
          if (this.give({
            shell: 1
          })) {
            this.state.harvests[beach] = this.state.time + 180;
            this.notify('Found a tide-washed shell. Try fishing for pearls.');
          }
          return true;
        }
      }
      return this.notify('E: pick berries, garden, fish, read landmarks, use furniture or board a nearby vessel.');
    }
    transfer(k, id, amount, toChest) {
      if (this.state.status !== 'alive' || !items[id] || !Number.isInteger(amount) || amount < 1 || amount > 999 || this.state.placed[k] !== B.chest) return false;
      const [x, y, z] = decodeKey(k);
      if (distance(this.state.player, {
        x,
        y,
        z
      }) > 7) return false;
      const ck = 'chest:' + k,
        store = this.state.harvests[ck] || {},
        a = change(this.state.inventory, {
          [id]: toChest ? -amount : amount
        }),
        b = change(store, {
          [id]: toChest ? amount : -amount
        }, 4000);
      if (!a || !b) return this.notify('Not enough items or destination is full.');
      this.state.inventory = a;
      this.state.harvests[ck] = b;
      return true;
    }
    returnCamp() {
      if (this.state.status !== 'alive' || Math.hypot(this.state.player.x, this.state.player.z) > C.warning) return this.notify('Camp return is unavailable in warning waters. Turn back now.');
      Object.assign(this.state.player, this.state.camp, {
        boat: null
      });
      this.velocity = 0;
      this.validatePosition();
      this.notify('Returned to camp with your belongings.');
      return true;
    }
    luxury() {
      const c = this.state.camp,
        seen = new Set(),
        categories = new Set(),
        zones = new Set();
      let points = 0,
        builds = 0,
        roof = 0;
      for (const [k, id] of Object.entries(this.state.placed)) {
        const [x, y, z] = decodeKey(k);
        if (Math.hypot(x - c.x, z - c.z) > 24 || Math.abs(y - c.y) > 14) continue;
        const b = blocks[id];
        if (b.category && !seen.has(id)) {
          points += b.quality;
          seen.add(id);
          categories.add(b.category);
          zones.add(`${Math.floor((x - c.x) / 5)},${Math.floor((z - c.z) / 5)}`);
        } else if (!b.category) {
          builds++;
          if (y > c.y + 2) roof++;
        }
      }
      points += Math.min(12, Math.floor(builds / 8)) + Math.min(6, Math.floor(roof / 4)) + Math.min(12, Math.max(0, categories.size - 2) * 2) + Math.min(8, zones.size * 2);
      return {
        points,
        varieties: seen.size,
        categories: categories.size,
        architecture: Math.min(18, Math.floor(builds / 8) + Math.min(6, Math.floor(roof / 4))),
        rank: points >= 135 ? 'Tidekeeper sanctuary' : points >= 95 ? 'Island estate' : points >= 60 ? 'Coastal retreat' : points >= 30 ? 'Welcoming homestead' : 'Beach camp'
      };
    }
    crossBoundary(nx, nz) {
      if (Math.hypot(nx, nz) < C.border) return true;
      if (this.state.status !== 'alive') return false;
      // Persist terminal intent BEFORE accepting a position across the ultimate boundary.
      if (!this.journal()) {
        this.saveBlocked = true;
        this.notify('Storm crossing blocked: browser storage cannot record the terminal voyage. Export your camp; turn back.');
        return false;
      }
      this.state.status = 'disaster';
      this.state.disaster = 0;
      this.paused = false;
      this.fishing = 0;
      this.notify('THE OUTER SEA HAS CLAIMED THIS VOYAGE. Your last safe checkpoint is preserved.');
      return true;
    }
    step(input = {}, dt = 1 / 60) {
      dt = clamp(dt, 0, .05);
      const s = this.state,
        p = s.player;
      if (s.status === 'disaster') {
        s.disaster += dt;
        if (s.disaster >= 6) s.status = 'dead';
        return;
      }
      if (s.status === 'dead' || this.paused) return;
      s.time += dt;
      if (s.time >= (this.nextMaintenance || 0)) {
        this.nextMaintenance = s.time + 30;
        for (const [k, value] of Object.entries(s.harvests)) {
          if (typeof value === 'number' && value <= s.time) delete s.harvests[k];
        }
      }
      s.buff = Math.max(0, s.buff - dt);
      const swimming = this.world.waterAt(p.x, p.y, p.z),
        boat = s.boats.find(b => b.id === p.boat),
        baseSpeed = boat ? items[boat.type].boat : swimming ? 4.2 : input.sprint ? 7 : 4.7,
        radius = Math.hypot(p.x, p.z),
        speed = Math.min(baseSpeed, boat && radius > C.danger ? 6 : boat && radius > C.warning ? 8 : baseSpeed);
      let f = (input.forward ? 1 : 0) - (input.back ? 1 : 0),
        r = (input.right ? 1 : 0) - (input.left ? 1 : 0),
        len = Math.hypot(f, r);
      if (len > 0) {
        f /= len;
        r /= len;
      }
      const dx = (-Math.sin(p.yaw) * f + Math.cos(p.yaw) * r) * speed * dt,
        dz = (-Math.cos(p.yaw) * f - Math.sin(p.yaw) * r) * speed * dt;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .16));
      for (let n = 0; n < steps; n++) {
        let nx = p.x + dx / steps,
          nz = p.z + dz / steps;
        if (!this.crossBoundary(nx, nz)) break;
        if (boat) {
          if (!this.world.solid(nx, C.sea, nz) && !this.world.solid(nx, C.sea + 1, nz)) {
            s.stats.sailed += Math.hypot(nx - p.x, nz - p.z);
            p.x = nx;
            p.z = nz;
          }
        } else {
          for (const [axis, v] of [['x', dx / steps], ['z', dz / steps]]) {
            const dest = {
              x: p.x,
              y: p.y,
              z: p.z
            };
            dest[axis] += v;
            if (!this.collides(dest.x, dest.y, dest.z)) p[axis] += v;else if ((this.grounded || swimming) && !this.collides(dest.x, p.y + 1.01, dest.z) && !this.collides(p.x, p.y + 1.01, p.z)) {
              p[axis] += v;
              p.y += 1.01;
            }
          }
        }
      }
      if (boat) {
        p.y = C.sea + .25;
        boat.x = p.x;
        boat.z = p.z;
        boat.yaw = p.yaw;
        this.velocity = 0;
      } else {
        if (input.jump && (this.grounded || swimming)) {
          this.velocity = swimming ? 4 : 7.5;
          this.grounded = false;
        }
        if (swimming) {
          this.velocity += ((C.sea - .5 - p.y) * 9 - this.velocity * 4) * dt;
          if (input.down) this.velocity = -3;
        } else this.velocity -= 20 * dt;
        this.velocity = clamp(this.velocity, -30, 10);
        let dy = this.velocity * dt,
          vs = Math.max(1, Math.ceil(Math.abs(dy) / .15));
        this.grounded = false;
        for (let n = 0; n < vs; n++) {
          if (!this.collides(p.x, p.y + dy / vs, p.z)) p.y += dy / vs;else {
            if (this.velocity < 0) {
              this.grounded = true;
              if (this.velocity < -13) p.health = Math.max(25, p.health - Math.abs(this.velocity) * .6);
            }
            this.velocity = 0;
            break;
          }
        }
      }
      const bi = column(p.x, p.z, s.seed).island;
      if (bi && p.y > C.sea - 2 && !s.discoveries.includes(bi.id)) {
        s.discoveries.push(bi.id);
        this.notify(`Discovered ${bi.name} · new recipes recorded`);
      }
      p.food = Math.max(0, p.food - dt * .013);
      const cold = bi?.id === 'frost' && !s.inventory.coat && s.buff === 0;
      p.warmth = clamp(p.warmth + dt * (cold ? -.5 : .9), 0, 100);
      if (p.food < 10 || p.warmth < 10) p.health = Math.max(25, p.health - dt * .1);else p.health = Math.min(100, p.health + dt * .2);
      if (input.mine) this.mine(dt);else this.mineProgress = 0;
      if (this.fishing) {
        if (distance(p, this.fishAt) > 2) {
          this.fishing = 0;
          this.notify('Line reeled in: stay still to catch a fish.');
        } else {
          this.fishing -= dt;
          if (this.fishing <= 0) {
            this.fishing = 0;
            const n = s.stats.fish;
            if (!this.give(n % 4 === 3 ? {
              fish: 1,
              pearl: 1
            } : {
              fish: 1
            })) return;
            s.stats.fish++;
            this.notify(n % 4 === 3 ? 'A silverfin and a lustre pearl!' : 'Caught a silverfin. Every fourth catch brings a pearl.');
          }
        }
      }
    }
  }
  return {
    Game,
    fresh,
    change,
    total,
    distance
  };
});
