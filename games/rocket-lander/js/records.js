(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./world.js') : root.DescentWorld);
  if (typeof module === 'object') module.exports = api; else root.DescentRecords = api;
})(globalThis, function (World) {
  const KEY = 'ember-descent.records.v1';
  function read(storage) {
    try {
      const raw = storage.getItem(KEY);
      if (!raw) return {};
      if (raw.length > 2048) return {};
      const data = JSON.parse(raw), clean = {};
      if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
      for (const { id } of World.stages) if (Number.isFinite(data[id]) && data[id] >= 0 && data[id] <= 1) clean[id] = data[id];
      return clean;
    } catch { return {}; }
  }
  function save(storage, sim) {
    if (sim.mode !== 'standard' || sim.state.status !== 'landed' || !sim.state.touchdown) return false;
    try {
      const data = read(storage), value = sim.state.touchdown.fraction;
      if (!Number.isFinite(value) || value < 0 || value > 1) return false;
      data[sim.stage.id] = Math.max(data[sim.stage.id] || 0, value);
      storage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch { return false; }
  }
  return { KEY, read, save };
});
