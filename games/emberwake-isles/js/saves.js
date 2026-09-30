(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./data.js') : root.EWData);
  if (typeof module === 'object') module.exports = api;else root.EWSaves = api;
})(typeof window !== 'undefined' ? window : globalThis, function (D) {
  'use strict';

  const {
      C,
      items,
      blocks,
      islands,
      recipes
    } = D,
    MAX = 2 * 1024 * 1024,
    PREFIX = 'emberwake.v1.';
  function fail(message = 'Invalid save data') {
    throw new Error(message);
  }
  const object = v => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
  function keys(v, allowed) {
    if (!object(v) || Object.keys(v).some(k => !allowed.includes(k))) fail();
  }
  function number(v, min, max, integer = false) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || integer && !Number.isInteger(v)) fail();
  }
  function list(v, max, test) {
    if (!Array.isArray(v) || v.length > max) fail();
    v.forEach(test);
  }
  function inventory(v, limit = 1800) {
    if (!object(v) || Object.keys(v).length > Object.keys(items).length) fail();
    let sum = 0;
    for (const [id, n] of Object.entries(v)) {
      if (!Object.hasOwn(items, id)) fail();
      number(n, 1, 999, true);
      sum += n;
    }
    if (sum > limit) fail();
  }
  function coordKey(k) {
    if (typeof k !== 'string' || !/^(-?\d+),(\d+),(-?\d+)$/.test(k) || k.length > 18) fail();
    const [x, y, z] = k.split(',').map(Number);
    number(x, -512, 511, true);
    number(y, 1, 79, true);
    number(z, -512, 511, true);
    if (`${x},${y},${z}` !== k) fail();
    return [x, y, z];
  }
  function point(v, allowed = ['x', 'y', 'z']) {
    keys(v, allowed);
    number(v.x, -511, 511);
    number(v.y, 1, C.height + 4);
    number(v.z, -511, 511);
  }
  function validate(s) {
    keys(s, ['version', 'seed', 'time', 'player', 'inventory', 'hotbar', 'selected', 'edits', 'placed', 'crops', 'harvests', 'boats', 'discoveries', 'secrets', 'caveFinds', 'crafted', 'stats', 'camp', 'status', 'disaster', 'buff', 'settings', 'name']);
    if (s.version !== 1) fail('Unsupported save version. Keep the original export.');
    number(s.seed, 0, 2147483647, true);
    number(s.time, 0, 1e9);
    number(s.buff, 0, 300);
    number(s.disaster, 0, 7);
    if (!['alive', 'disaster', 'dead'].includes(s.status)) fail();
    if (typeof s.name !== 'string' || s.name.length < 1 || s.name.length > 48 || /[\u0000-\u001f]/.test(s.name)) fail();
    const p = s.player;
    point(p, ['x', 'y', 'z', 'yaw', 'pitch', 'health', 'food', 'warmth', 'boat']);
    number(p.yaw, -Math.PI * 2, Math.PI * 2);
    number(p.pitch, -1.5, 1.5);
    for (const k of ['health', 'food', 'warmth']) number(p[k], 0, 100);
    if (s.status === 'alive' && Math.hypot(p.x, p.z) >= C.border) fail('A living voyage cannot start beyond the storm boundary.');
    point(s.camp);
    if (Math.hypot(s.camp.x, s.camp.z) > C.warning) fail();
    inventory(s.inventory);
    list(s.hotbar, 8, id => {
      if (!Object.hasOwn(items, id)) fail();
    });
    if (s.hotbar.length !== 8) fail();
    number(s.selected, 0, 7, true);
    keys(s.settings, ['sound', 'sensitivity', 'view']);
    if (typeof s.settings.sound !== 'boolean') fail();
    number(s.settings.sensitivity, .25, 3);
    number(s.settings.view, 3, 5, true);
    for (const k of ['discoveries', 'secrets', 'caveFinds']) {
      list(s[k], 5, id => {
        if (!islands.some(i => i.id === id)) fail();
      });
      if (new Set(s[k]).size !== s[k].length) fail();
    }
    list(s.crafted, recipes.length, id => {
      if (!recipes.some(r => r.id === id)) fail();
    });
    if (new Set(s.crafted).size !== s.crafted.length) fail();
    keys(s.stats, ['mined', 'placed', 'fish', 'harvest', 'sailed']);
    for (const k of ['mined', 'placed', 'fish', 'harvest']) number(s.stats[k], 0, 1e9, true);
    number(s.stats.sailed, 0, 1e9);
    list(s.boats, 8, b => {
      keys(b, ['id', 'type', 'x', 'z', 'yaw']);
      number(b.id, 1, 1e6, true);
      if (!['raft', 'cutter'].includes(b.type)) fail();
      number(b.x, -511, 511);
      number(b.z, -511, 511);
      number(b.yaw, -Math.PI * 2, Math.PI * 2);
    });
    if (new Set(s.boats.map(b => b.id)).size !== s.boats.length) fail();
    if (p.boat !== null) {
      number(p.boat, 1, 1e6, true);
      const boat = s.boats.find(b => b.id === p.boat);
      if (!boat || Math.hypot(boat.x - p.x, boat.z - p.z) > .1) fail();
    }
    if (!object(s.edits) || Object.keys(s.edits).length > 4096) fail();
    let count = 0;
    for (const [ck, entries] of Object.entries(s.edits)) {
      if (!/^-?\d+,-?\d+$/.test(ck)) fail();
      const [x, z] = ck.split(',').map(Number);
      number(x, -32, 31, true);
      number(z, -32, 31, true);
      if (`${x},${z}` !== ck) fail();
      const seen = new Set();
      list(entries, 20480, e => {
        if (!Array.isArray(e) || e.length !== 2) fail();
        number(e[0], 256, 20479, true);
        number(e[1], 0, blocks.length - 1, true);
        if ([D.ids.bedrock, D.ids.relic].includes(e[1]) || seen.has(e[0])) fail();
        seen.add(e[0]);
      });
      count += entries.length;
      if (count > C.maxEdits) fail();
    }
    function edited(k, id) {
      const [x, y, z] = coordKey(k),
        ck = `${Math.floor(x / 16)},${Math.floor(z / 16)}`,
        index = y * 256 + (z % 16 + 16) % 16 * 16 + (x % 16 + 16) % 16;
      if (!s.edits[ck]?.some(e => e[0] === index && e[1] === id)) fail('Object and terrain data disagree.');
    }
    if (!object(s.placed) || Object.keys(s.placed).length > 12000) fail();
    let chests = 0;
    for (const [k, id] of Object.entries(s.placed)) {
      coordKey(k);
      number(id, 1, blocks.length - 1, true);
      if ([D.ids.bedrock, D.ids.relic].includes(id)) fail();
      edited(k, id);
      if (id === D.ids.chest) chests++;
    }
    if (chests > 16) fail();
    if (!object(s.crops) || Object.keys(s.crops).length > 512) fail();
    for (const [k, c] of Object.entries(s.crops)) {
      coordKey(k);
      if (s.placed[k] !== D.ids.farmland) fail();
      keys(c, ['type', 'ready', 'watered']);
      if (!['carrot', 'grain'].includes(c.type) || typeof c.watered !== 'boolean') fail();
      number(c.ready, 0, s.time + 120);
    }
    if (!object(s.harvests) || Object.keys(s.harvests).length > 4096) fail();
    for (const [k, v] of Object.entries(s.harvests)) {
      if (k.startsWith('chest:')) {
        coordKey(k.slice(6));
        if (s.placed[k.slice(6)] !== D.ids.chest) fail();
        inventory(v, 4000);
      } else {
        if (!/^-?\d+,\d+,-?\d+$/.test(k) || k.length > 18) fail();
        const [x, y, z] = k.split(',').map(Number);
        number(x, -512, 511, true);
        number(y, 0, 79, true);
        number(z, -512, 511, true);
        number(v, 0, s.time + 180);
      }
    }
    return s;
  }
  function decode(raw) {
    if (typeof raw !== 'string' || raw.length > MAX) fail('Save exceeds the 2 MB import limit.');
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      fail('This is not valid save JSON. Your existing slots are unchanged.');
    }
    return validate(value);
  }
  class Saves {
    constructor(storage) {
      this.storage = storage;
    }
    key(slot, suffix = 'save') {
      if (![1, 2, 3].includes(slot)) fail('Choose slot 1, 2 or 3.');
      return `${PREFIX}${slot}.${suffix}`;
    }
    raw(slot, suffix = 'save') {
      return this.storage.getItem(this.key(slot, suffix));
    }
    inspect(slot) {
      try {
        const raw = this.raw(slot);
        if (!raw) return {
          empty: true
        };
        const s = decode(raw);
        return {
          name: s.name,
          time: s.time,
          seed: s.seed,
          terminal: !!this.raw(slot, 'terminal')
        };
      } catch (e) {
        return {
          error: e.message
        };
      }
    }
    save(slot, state) {
      try {
        if (state.status !== 'alive' || Math.hypot(state.player.x, state.player.z) >= C.warning) return {
          ok: false,
          error: 'Checkpoint kept: save only while alive inside sheltered waters (radius 405).'
        };
        if (this.raw(slot, 'terminal')) return {
          ok: false,
          error: 'This voyage ended. Explicitly restore a checkpoint before saving.'
        };
        const raw = JSON.stringify(validate(state));
        if (raw.length > MAX) fail('Save is too large. Export and simplify your world.');
        const old = this.raw(slot);
        if (old) {
          let valid = false;
          try {
            decode(old);
            valid = true;
          } catch {}
          if (valid) this.storage.setItem(this.key(slot, 'backup'), old);
        }
        this.storage.setItem(this.key(slot), raw);
        return {
          ok: true
        };
      } catch (e) {
        return {
          ok: false,
          error: `Save failed: ${e.message}. Previous checkpoint retained; export a JSON backup.`
        };
      }
    }
    load(slot, backup = false, restore = false) {
      try {
        const raw = this.raw(slot, backup ? 'backup' : 'save');
        if (!raw) return {
          ok: false,
          error: 'This slot has no such checkpoint.'
        };
        const state = decode(raw);
        const terminal = this.raw(slot, 'terminal');
        if (restore) {
          this.storage.removeItem(this.key(slot, 'terminal'));
          state.status = 'alive';
          state.disaster = 0;
        } else if (terminal) {
          state.status = 'dead';
          state.disaster = 6;
        }
        return {
          ok: true,
          state,
          terminal: !!terminal && !restore
        };
      } catch (e) {
        return {
          ok: false,
          error: `Load failed: ${e.message}. Try the previous backup or import an export.`
        };
      }
    }
    terminal(slot) {
      try {
        this.storage.setItem(this.key(slot, 'terminal'), 'storm-crossed-v1');
        return true;
      } catch {
        return false;
      }
    }
    create(slot, state) {
      try {
        validate(state);
        const old = this.raw(slot);
        if (old) {
          try {
            decode(old);
            this.storage.setItem(this.key(slot, 'backup'), old);
          } catch (e) {
            if (e.name === 'QuotaExceededError') throw e;
          }
        }
        this.storage.setItem(this.key(slot), JSON.stringify(state));
        this.storage.removeItem(this.key(slot, 'terminal'));
        return {
          ok: true
        };
      } catch (e) {
        return {
          ok: false,
          error: `Cannot create slot: ${e.message}. Existing backup kept.`
        };
      }
    }
    import(slot, raw) {
      try {
        const s = decode(raw);
        if (s.status !== 'alive' || Math.hypot(s.player.x, s.player.z) >= C.warning) fail('Only safe living checkpoints can be imported.');
        return this.create(slot, s);
      } catch (e) {
        return {
          ok: false,
          error: `Import rejected: ${e.message}`
        };
      }
    }
  }
  return {
    Saves,
    validate,
    decode,
    MAX,
    PREFIX
  };
});
