(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./data.js') : root.EWData);
  if (typeof module === 'object') module.exports = api;else root.EWWorld = api;
})(typeof window !== 'undefined' ? window : globalThis, function (D) {
  'use strict';

  const {
    C,
    ids: B,
    islands,
    islets,
    blocks
  } = D;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function hash(x, z, seed = 0) {
    let h = Math.imul(x ^ seed, 374761393) ^ Math.imul(z, 668265263);
    h = Math.imul(h ^ h >>> 13, 1274126177);
    return (h ^ h >>> 16) >>> 0;
  }
  const rand = (x, z, s) => hash(x, z, s) / 4294967295;
  function noise(x, z, s) {
    const ix = Math.floor(x),
      iz = Math.floor(z),
      u = x - ix,
      v = z - iz,
      a = u * u * (3 - 2 * u),
      b = v * v * (3 - 2 * v);
    return (rand(ix, iz, s) * (1 - a) + rand(ix + 1, iz, s) * a) * (1 - b) + (rand(ix, iz + 1, s) * (1 - a) + rand(ix + 1, iz + 1, s) * a) * b;
  }
  const key = (x, y, z) => `${x},${y},${z}`;
  function decodeKey(k) {
    return k.split(',').map(Number);
  }
  function column(x, z, seed) {
    let h = 3 + Math.floor(noise(x / 35, z / 35, seed) * 3),
      island = null;
    for (const i of islands) {
      const dx = (x - i.x) / i.rx,
        dz = (z - i.z) / i.rz,
        r = Math.hypot(dx, dz);
      const edge = 1 - r + (noise(x / 28, z / 28, seed + 17) - .5) * .12;
      if (edge > 0) {
        let ih = 9 + Math.pow(edge, .65) * i.rise + (noise(x / 19, z / 19, seed + 3) - .5) * 5 * clamp(edge * 5, 0, 1);
        if (i.id === 'dunes') ih = Math.floor(ih / 3) * 3;
        if (ih > h) {
          h = Math.floor(ih);
          island = i;
        }
      }
    }
    for (const i of islets) {
      const r = Math.hypot(x - i.x, z - i.z) / i.r;
      if (r < 1) h = Math.max(h, Math.floor(9 + (1 - r) * 10));
    }
    return {
      h,
      island
    };
  }
  function caves(seed) {
    return islands.map(i => {
      const x = i.x - 55,
        z = i.z + 9,
        h = column(x, z, seed).h + 1;
      const main = [0, 12, 28, 44, 65, 73, 81].map((dx, j) => [x + dx, Math.round(h - (h - 5) * Math.min(1, dx / 73)), z + [0, 0, 2, 3, 3, 5, 6][j]]);
      return {
        island: i.id,
        entrance: main[0],
        paths: [main, [main[4], [x + 66, 5, z - 12], [x + 76, 4, z - 25]], [main[3], [x + 43, Math.max(5, main[3][1] - 5), z + 20], [x + 28, Math.max(5, main[3][1] - 9), z + 26]]],
        chamber: [x + 81, 5, z + 6]
      };
    });
  }
  function caveColumn(x, z, networks) {
    let lo = Infinity,
      hi = -Infinity;
    for (const c of networks) {
      if (Math.abs(x - c.entrance[0]) > 90 || Math.abs(z - c.entrance[2]) > 35) continue;
      for (const path of c.paths) for (let j = 1; j < path.length; j++) {
        const a = path[j - 1],
          b = path[j],
          dx = b[0] - a[0],
          dz = b[2] - a[2];
        const t = clamp(((x + .5 - a[0]) * dx + (z + .5 - a[2]) * dz) / (dx * dx + dz * dz), 0, 1);
        if (Math.hypot(x + .5 - a[0] - dx * t, z + .5 - a[2] - dz * t) < 2.3) {
          const floor = Math.floor(a[1] + (b[1] - a[1]) * t);
          lo = Math.min(lo, floor);
          hi = Math.max(hi, floor + 4);
        }
      }
      if (Math.hypot(x + .5 - c.chamber[0], z + .5 - c.chamber[2]) < 5.7) {
        lo = Math.min(lo, 5);
        hi = Math.max(hi, 12);
      }
    }
    return [lo, hi];
  }
  class World {
    constructor(seed = 741092, edits = {}) {
      this.seed = seed;
      this.edits = new Map();
      this.chunks = new Map();
      this.dirty = new Set();
      this.networks = caves(seed);
      this.revision = 0;
      this.editCount = 0;
      for (const [ck, entries] of Object.entries(edits)) {
        const map = new Map(entries);
        this.edits.set(ck, map);
        this.editCount += map.size;
      }
    }
    chunkKey(x, z) {
      return `${Math.floor(x / C.chunk)},${Math.floor(z / C.chunk)}`;
    }
    index(x, y, z) {
      return y * 256 + (z % 16 + 16) % 16 * 16 + (x % 16 + 16) % 16;
    }
    inBounds(x, y, z) {
      return x >= -C.extent && x < C.extent && z >= -C.extent && z < C.extent && y >= 0 && y < C.height;
    }
    get(x, y, z) {
      x = Math.floor(x);
      y = Math.floor(y);
      z = Math.floor(z);
      if (!this.inBounds(x, y, z)) return y < 0 ? B.bedrock : 0;
      const ck = this.chunkKey(x, z);
      const chunk = this.chunks.get(ck) || this.generate(Math.floor(x / 16), Math.floor(z / 16));
      return chunk[this.index(x, y, z)];
    }
    waterAt(x, y, z) {
      return y < C.sea && column(x, z, this.seed).h < C.sea;
    }
    solid(x, y, z) {
      return !!blocks[this.get(x, y, z)].solid;
    }
    generate(cx, cz) {
      const arr = new Uint8Array(256 * C.height),
        ck = `${cx},${cz}`;
      for (let lz = 0; lz < 16; lz++) for (let lx = 0; lx < 16; lx++) {
        const x = cx * 16 + lx,
          z = cz * 16 + lz,
          {
            h,
            island: i
          } = column(x, z, this.seed),
          [lo, hi] = caveColumn(x, z, this.networks);
        const surface = h <= 14 ? B.sand : i?.id === 'dunes' ? B.sandstone : i?.id === 'frost' && h > 24 ? B.snow : i?.id === 'cinder' ? B.basalt : B.grass;
        for (let y = 0; y <= h; y++) {
          let id = y === 0 ? B.bedrock : y === h ? surface : y > h - 3 ? surface === B.sand || surface === B.sandstone ? B.sand : B.dirt : B.stone;
          const n = hash(x + y * 5, z - y * 7, this.seed);
          if (y > 0 && y < h - 3) {
            if (n % 59 < 3) id = B.coalOre;else if (n % 61 < 3) id = B.copperOre;else if (n % 67 < 3 && y < 20) id = B.ironOre;else if (i?.id === 'cinder' && n % 43 < 4 && y < 18) id = B.crystalOre;
          }
          if (y === h && h > 13 && h < 20 && n % 5 === 0) id = B.clay;
          if (y >= lo && y < hi) id = 0;
          arr[y * 256 + lz * 16 + lx] = id;
        }
        if (h <= 14 || !i || lo < h + 6) continue;
        const gx = Math.floor(x / 10),
          gz = Math.floor(z / 10),
          tx = gx * 10 + 4 + hash(gx, gz, this.seed) % 2,
          tz = gz * 10 + 4 + hash(gz, gx, this.seed + 1) % 2;
        const tree = rand(gx, gz, this.seed + 7) > (i.id === 'forest' ? .2 : i.id === 'tropic' ? .5 : .45) && ['tropic', 'forest', 'frost'].includes(i.id);
        if (tree && Math.abs(x - tx) <= 2 && Math.abs(z - tz) <= 2) {
          const th = column(tx, tz, this.seed).h;
          if (th > 15 && Math.abs(th - h) < 4 && caveColumn(tx, tz, this.networks)[0] > th + 8) {
            const crown = i.id === 'frost' ? 8 : i.id === 'forest' ? 7 : 6;
            for (let y = th + 1; y <= th + crown && y < C.height; y++) {
              const spread = Math.abs(x - tx) + Math.abs(z - tz);
              let id = 0;
              if (x === tx && z === tz && y <= th + (i.id === 'tropic' ? 5 : 4)) id = B.log;else if (i.id === 'tropic' && y === th + 6 && (x === tx || z === tz || spread < 3)) id = B.leaves;else if (i.id === 'tropic' && y === th + 5 && spread === 3) id = B.leaves;else if (i.id === 'forest' && y >= th + 4 && spread <= Math.min(4, th + 8 - y + 1)) id = B.leaves;else if (i.id === 'frost' && y >= th + 3 && spread <= th + 8 - y) id = B.leaves;
              if (id && y > h) arr[y * 256 + lz * 16 + lx] = id;
            }
          }
        } else if (hash(x, z, this.seed + 21) % 91 === 0 && surface === B.grass) arr[(h + 1) * 256 + lz * 16 + lx] = B.berryBush;else if (i.id === 'dunes' && hash(x, z, this.seed) % 173 === 0) for (let y = h + 1; y <= h + 3; y++) arr[y * 256 + lz * 16 + lx] = B.cactus;
      }
      // An authored trail cache: generous driftwood, berries and resin-rich shrubs at the starting beach.
      for (const p of this.starterProps()) if (Math.floor(p[0] / 16) === cx && Math.floor(p[2] / 16) === cz) arr[this.index(...p.slice(0, 3))] = p[3];
      for (const p of this.landmarkProps()) if (Math.floor(p[0] / 16) === cx && Math.floor(p[2] / 16) === cz) arr[this.index(...p.slice(0, 3))] = p[3];
      for (const i of islands) {
        const x = i.x + 12,
          z = i.z - 10,
          y = column(x, z, this.seed).h + 1;
        if (Math.floor(x / 16) === cx && Math.floor(z / 16) === cz) arr[this.index(x, y, z)] = B.relic;
      }
      for (const cave of this.networks) {
        const [x, y, z] = cave.chamber;
        if (Math.floor(x / 16) === cx && Math.floor((z + 3) / 16) === cz) arr[this.index(x, y, z + 3)] = B.relic;
      }
      for (const [index, id] of this.edits.get(ck) || []) arr[index] = id;
      this.chunks.set(ck, arr);
      return arr;
    }
    landmarkProps() {
      if (this._landmarks) return this._landmarks;
      const props = [];
      islands.forEach((i, n) => {
        const x = i.x + 12,
          z = i.z - 15,
          y = column(x, z, this.seed).h + 1;
        const add = (dx, dy, dz, id) => props.push([x + dx, y + dy, z + dz, id]);
        if (n === 0) {
          for (let dx = -5; dx <= 5; dx++) for (let dy = 0; dy < 7; dy++) if (Math.abs(Math.hypot(dx, dy) - 5) < .9) add(dx, dy, 0, B.sandstone);
          for (let dx = -4; dx <= 4; dx++) add(dx, 0, 1, B.sandstone);
        }
        if (n === 1) {
          for (let dx = -3; dx <= 3; dx++) for (let dz = -2; dz <= 2; dz++) add(dx, 0, dz, B.cobble);
          for (let dy = 1; dy <= 5; dy++) {
            add(-3, dy, -2, B.log);
            add(3, dy, -2, B.log);
            add(-3, dy, 2, B.log);
            add(3, dy, 2, B.log);
          }
          for (let dx = -4; dx <= 4; dx++) for (let dz = -3; dz <= 3; dz++) add(dx, 6, dz, B.plank);
          for (let dx = -1; dx <= 1; dx++) for (let dy = 1; dy <= 3; dy++) add(dx, dy, 0, B.brick);
          add(0, 4, 0, B.copperOre);
        }
        if (n === 2) {
          for (let dx = -3; dx <= 3; dx++) for (let dy = 0; dy <= 5; dy++) for (let dz = -3; dz <= 3; dz++) if (Math.hypot(dx, (dy - 2) * 1.15, dz) < 3.3) add(dx, dy, dz, B.sandstone);
          for (let j = 0; j < 4; j++) add(3 + j, 2 + Math.floor(j / 2), 0, B.sandstone);
          add(0, 6, 0, B.copperOre);
          for (let j = 0; j < 5; j++) add(-4, 1 + j, 0, B.sandstone);
        }
        if (n === 3) {
          for (let dy = 0; dy < 8; dy++) {
            add(-3, dy, 0, B.stone);
            add(3, dy, 0, B.stone);
          }
          for (let dx = -3; dx <= 3; dx++) add(dx, 8, 0, B.snow);
          for (let dx = -1; dx <= 1; dx++) for (let dy = 4; dy < 7; dy++) add(dx, dy, 0, B.copperOre);
          add(0, 3, 0, B.ironOre);
        }
        if (n === 4) {
          for (let dy = 0; dy < 7; dy++) add(0, dy, 0, B.basalt);
          for (let dx = -5; dx <= 5; dx++) for (let dy = 2; dy < 7; dy++) if (Math.abs(dx) > 1 && Math.abs(dx) + Math.abs(dy - 4) < 6) add(dx, dy, 0, B.crystalOre);
          for (let dz = -4; dz <= 4; dz++) add(0, 0, dz, B.basalt);
        }
      });
      this._landmarks = props;
      return props;
    }
    starterProps() {
      if (this._props) return this._props;
      const props = [];
      for (let j = 0; j < 16; j++) {
        const x = -210 + j % 8 * 2,
          z = 87 + Math.floor(j / 8) * 5,
          y = column(x, z, this.seed).h + 1;
        props.push([x, y, z, B.log]);
      }
      for (let j = 0; j < 5; j++) {
        const x = -205 + j * 3,
          z = 98,
          y = column(x, z, this.seed).h + 1;
        props.push([x, y, z, B.berryBush]);
      }
      this._props = props;
      return props;
    }
    set(x, y, z, id) {
      if (![x, y, z, id].every(Number.isInteger) || !this.inBounds(x, y, z) || y === 0 || !blocks[id]) return false;
      const ck = this.chunkKey(x, z),
        index = this.index(x, y, z),
        map = this.edits.get(ck) || new Map();
      if (!map.has(index) && this.editCount >= C.maxEdits) return false;
      if (!map.has(index)) this.editCount++;
      map.set(index, id);
      this.edits.set(ck, map);
      this.get(x, y, z);
      this.chunks.get(ck)[index] = id;
      this.dirty.add(ck);
      if (x % 16 === 0) this.dirty.add(this.chunkKey(x - 1, z));
      if ((x + 1) % 16 === 0) this.dirty.add(this.chunkKey(x + 1, z));
      if (z % 16 === 0) this.dirty.add(this.chunkKey(x, z - 1));
      if ((z + 1) % 16 === 0) this.dirty.add(this.chunkKey(x, z + 1));
      this.revision++;
      return true;
    }
    unload(px, pz, radius = 6) {
      for (const ck of this.chunks.keys()) {
        const [cx, cz] = ck.split(',').map(Number);
        if (Math.abs(cx - Math.floor(px / 16)) > radius || Math.abs(cz - Math.floor(pz / 16)) > radius) this.chunks.delete(ck);
      }
    }
    serialize() {
      return Object.fromEntries([...this.edits].map(([ck, map]) => [ck, [...map].sort((a, b) => a[0] - b[0])]));
    }
    spawn() {
      const x = -208.5,
        z = 102.5;
      return {
        x,
        y: column(Math.floor(x), Math.floor(z), this.seed).h + 1.01,
        z
      };
    }
    top(x, z) {
      for (let y = C.height - 1; y >= 0; y--) if (this.solid(x, y, z)) return y + 1;
      return C.sea;
    }
    ray(origin, dir, reach = C.reach) {
      let x = Math.floor(origin.x),
        y = Math.floor(origin.y),
        z = Math.floor(origin.z),
        prev = [x, y, z],
        t = 0;
      const ds = [dir.x, dir.y, dir.z],
        os = [origin.x, origin.y, origin.z],
        p = [x, y, z];
      const step = ds.map(v => v > 0 ? 1 : -1),
        delta = ds.map(v => v === 0 ? Infinity : Math.abs(1 / v));
      const max = ds.map((v, j) => v === 0 ? Infinity : (p[j] + (v > 0 ? 1 : 0) - os[j]) / v);
      for (let n = 0; n < 128 && t <= reach; n++) {
        const id = this.get(...p);
        if (id) return {
          x: p[0],
          y: p[1],
          z: p[2],
          id,
          prev,
          distance: t
        };
        prev = p.slice();
        const axis = max[0] < max[1] ? max[0] < max[2] ? 0 : 2 : max[1] < max[2] ? 1 : 2;
        t = max[axis];
        p[axis] += step[axis];
        max[axis] += delta[axis];
      }
      return null;
    }
  }
  return {
    World,
    column,
    caves,
    caveColumn,
    hash,
    rand,
    noise,
    clamp,
    key,
    decodeKey
  };
});
