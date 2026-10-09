const World = require('../../public/commons/world');
// Fail closed on incompatible/corrupt saves instead of silently dropping a resident or reward.
function validState(state) {
  if (!state || state.version !== World.VERSION || !Number.isSafeInteger(state.revision) || state.revision < 0
    || !Number.isInteger(state.blooms) || state.blooms < 0 || state.blooms > 9999
    || !Array.isArray(state.players) || state.players.length > World.homes.length) return false;
  const users = new Set(), plots = new Set();
  for (const p of state.players) {
    if (!/^[a-f0-9]{24}$/i.test(p.userId) || users.has(p.userId) || plots.has(p.plot)
      || !Number.isInteger(p.plot) || p.plot < 0 || p.plot >= World.homes.length
      || !Number.isFinite(p.x) || !Number.isFinite(p.y)
      || !['up', 'down', 'left', 'right'].includes(p.facing) || !['village', 'home', 'hall', 'shelter'].includes(p.scene)
      || !Number.isInteger(p.petals) || p.petals < 0 || p.petals > 12
      || typeof p.lantern !== 'boolean' || typeof p.decorated !== 'boolean'
      || !Array.isArray(p.discoveries) || p.discoveries.length > 3 || new Set(p.discoveries).size !== p.discoveries.length
      || p.discoveries.some(d => !['stone-0', 'stone-1', 'stone-2'].includes(d))
      || !Array.isArray(p.watered) || p.watered.length > 3 || p.watered.some(d => typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}:garden-[0-2]$/.test(d))
      || !Array.isArray(p.receipts) || p.receipts.length > 64
      || p.receipts.some(r => typeof r.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(r.id) || typeof r.message !== 'string' || r.message.length > 300)) return false;
    users.add(p.userId); plots.add(p.plot);
  }
  return true;
}
module.exports = { validState };
