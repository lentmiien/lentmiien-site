(function (root, factory) {
  const SkyTerrain = factory(typeof module === 'object' ? require('./data.js') : root.EWData);
  if (typeof module === 'object') module.exports = SkyTerrain; else root.EWSkyTerrain = SkyTerrain;
})(typeof window !== 'undefined' ? window : globalThis, function (D) {
  'use strict';
  const sky = D.sky, ids = D.ids;
  const chunkKey = (x, z) => Math.floor(x / 16) + ',' + Math.floor(z / 16);
  class SkyTerrain {
    constructor(seed, layout, noise) {
      this.seed = seed;
      this.noise = noise;
      this.sites = sky.sites.map((site, i) => sky.moor(site, layout.berths[i]));
      this.clear = new Map(layout.clear.map(([gx, gz, mask]) => [gx + ',' + gz, mask]));
      this.structures = new Map();
      this.vaults = new Map();
      this.rooms = [];
    }
    maskAt(x, z) {
      return this.clear.size ? this.clear.get(Math.floor(x / 4) + ',' + Math.floor(z / 4)) || 0 : 0;
    }
    sheltered(mask, y) {
      return y >= 24 && (mask & (1 << (Math.floor(y / 4) - 6))) !== 0;
    }
    profile(x, z) {
      for (const site of this.sites) {
        if (Math.abs(x - site.x) > site.rx || Math.abs(z - site.z) > site.rz) continue;
        const span = sky.profile(site, x, z, this.seed, this.noise), mask = this.maskAt(x, z);
        if (span && mask) {
          while (span.top >= span.bottom && this.sheltered(mask, span.top)) span.top--;
          while (span.bottom <= span.top && this.sheltered(mask, span.bottom)) span.bottom++;
          if (span.top < span.bottom) return null;
        }
        return span;
      }
      return null;
    }
    // Landmarks and their passage carvings are indexed once, across chunk boundaries.
    add(x, y, z, block) {
      const key = chunkKey(x, z);
      if (y < 24 || y >= D.C.height || this.sheltered(this.maskAt(x, z), y)) return;
      if (!this.structures.has(key)) this.structures.set(key, []);
      const index = y * 256 + (z & 15) * 16 + (x & 15);
      this.structures.get(key).push([index, block]);
    }
    vaultSite(site, vault) {
      const x = site.x + vault.dx, z = site.z + vault.dz;
      // If a migrated tower occupies a cache site, tuck the cache into nearby intact rock.
      for (let r = 0; r <= site.rx * 2; r += 4) {
        for (let dx = -r; dx <= r; dx += 4) for (let dz = -r; dz <= r; dz += 4) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const px = x + dx, pz = z + dz, span = this.profile(px, pz);
          if (!span || span.top - span.bottom < 8) continue;
          if (this.rooms.some(room => Math.hypot(px - room.x, pz - room.z) < 12)) continue;
          let intact = true;
          for (let a = -3; intact && a <= 3; a++) for (let b = -3; intact && b <= 3; b++) {
            const wall = this.profile(px + a, pz + b), mask = this.maskAt(px + a, pz + b);
            intact = !!wall && wall.bottom <= span.top - 6 && wall.top >= span.top - 3;
            if (mask && intact) for (let h = span.top - 6; h <= wall.top + 1; h++) if (this.sheltered(mask, h)) intact = false;
          }
          if (intact) return { x: px, z: pz, top: span.top };
        }
      }
      return null;
    }
    makeVault(site, vault) {
      const point = this.vaultSite(site, vault);
      if (!point) return;
      this.rooms.push(point);
      const { x, z, top } = point, y = top - 5;
      const [, stone, keel, metal, gem] = site.materials;
      // A little stone-lined room leaves space to stand beside the find.
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
        this.add(x + dx, y - 1, z + dz, ids[stone]);
        for (let h = 0; h < 3; h++) this.add(x + dx, y + h, z + dz, 0);
      }
      if (vault.shaft) {
        // A thin plug under the surface marking can be mined from above.
        for (let dx = 0; dx < 2; dx++) for (let dz = 1; dz <= 2; dz++) {
          const sx = x + dx, sz = z + dz, cap = this.profile(sx, sz).top;
          for (let h = y; h < cap; h++) this.add(sx, h, sz, 0);
          this.add(sx, cap, sz, ids[gem]);
        }
        for (let n = 0; n < 7; n++) {
          const angle = n / 8 * 2 * Math.PI;
          const sx = x + Math.round(5 * Math.cos(angle)), sz = z + Math.round(5 * Math.sin(angle));
          const span = this.profile(sx, sz);
          if (!span) continue;
          const height = site.window ? 2 + n : 2 + Math.abs(n - 3);
          for (let h = 1; h <= height; h++) this.add(sx, span.top + h, sz, ids[h === height ? metal : stone]);
        }
      } else {
        // Cut a horizontal doorway all the way through to the cliff or sky window.
        const [dx, dz] = vault.mouth;
        for (let n = 2; n <= site.rx * 2; n++) {
          const sx = x + n * dx, sz = z + n * dz, span = this.profile(sx, sz);
          if (!span || span.bottom > y + 2 || span.top < y) break;
          for (let w = -1; w <= 1; w++) {
            this.add(sx + w * dz, y - 1, sz + w * dx, ids[keel]);
            for (let h = 0; h < 3; h++) this.add(sx + w * dz, y + h, sz + w * dx, 0);
            this.add(sx + w * dz, y + 3, sz + w * dx, ids[metal]);
          }
        }
      }
      this.add(x, y, z, ids.skyCoffer);
      this.vaults.set([x, y, z].join(','), vault);
    }
    makeSpires(site) {
      const group = site.window ? [[-29,9,8],[30,-13,11],[4,-9,7],[1,35,5]] : [[-30,0,7],[18,-6,10],[43,1,6],[-4,-22,8]];
      for (const [dx, dz, size] of group) {
        const x = site.x + dx, z = site.z + dz;
        if (site.window) {
          // Fan of organ pipes, capped with translucent-looking rose mineral.
          for (let n = -3; n <= 3; n++) {
            const px = x + n * 2, pz = z + Math.abs(n), base = this.profile(px, pz);
            if (!base) continue;
            const height = size - Math.abs(n) * 2 + 3;
            for (let h = 0; h < height; h++) for (let ix = 0; ix < 2; ix++) for (let iz = 0; iz < 2; iz++)
              this.add(px + ix, base.top + h, pz + iz, ids[h >= height - 2 ? 'roseSpar' : 'velvetBasalt']);
          }
        } else {
          // Two swept, ribbed mineral sails meet at the foot and taper to opal tips.
          const base = this.profile(x, z);
          if (!base) continue;
          for (const dir of [-1, 1]) for (let h = 0; h <= size; h++) {
            const reach = Math.floor(h * .62), width = Math.ceil((size - h) / 3);
            for (let w = 0; w <= width; w++) {
              const material = ids[h === size || w === width ? 'windOpal' : 'quillChalk'];
              const bend = Math.floor(h / 4);
              this.add(x + dir * (reach + w), base.top + 1 + h, z + bend, material);
              if (h > 0 && h % 4 === 0) this.add(x + dir * (reach + w), base.top + 1 + h, z + bend - 1, material);
            }
          }
        }
      }
    }
    prepare() {
      if (this.prepared) return;
      for (const site of this.sites) {
        this.makeSpires(site);
        for (const vault of site.vaults) this.makeVault(site, vault);
      }
      this.prepared = true;
    }
    writeChunk(cx, cz, cells) {
      if (!this.sites.some(site => sky.nearChunk(site, cx, cz))) return;
      this.prepare();
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const wx = cx * 16 + x, wz = cz * 16 + z, span = this.profile(wx, wz);
        if (!span) continue;
        const fold = Math.floor(this.noise(wx / 11, wz / 11, this.seed + 14) * 11);
        const mask = this.maskAt(wx, wz);
        for (let y = span.bottom; y <= span.top; y++) {
          if (mask && this.sheltered(mask, y)) continue;
          let block = span.stone;
          if (y === span.top) block = span.surface;
          else if ((y + fold) % 11 === 0) block = span.metal;
          else if (y - span.bottom < 3) block = span.keel;
          else if (y < span.top - 5 && fold >= 7) block = span.gem;
          cells[y * 256 + z * 16 + x] = ids[block];
        }
      }
      for (const [index, id] of this.structures.get(cx + ',' + cz) || []) cells[index] = id;
    }
  }
  return SkyTerrain;
});
