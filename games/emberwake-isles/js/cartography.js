/* Both charts use the same edit-aware elevation sampler. No retained terrain chunks. */
(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./data.js') : root.EWData);
  if (typeof module === 'object') module.exports = api; else root.EWChart = api;
})(typeof window !== 'undefined' ? window : globalThis, function (D) {
  'use strict';
  function color(world, x, z) {
    const col = world.mapColumn(x, z), land = col.h >= D.C.sea;
    const hex = land ? col.color || col.island?.color || '#d0c09a' : col.h > 8 ? '#438b91' : '#203f50';
    const shade = land ? Math.min(1.15, .75 + col.h / 100) : 1;
    return [1, 3, 5].map(i => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * shade)));
  }
  function raster(world, size = 512, span = D.C.extent * 2, centerX = 0, centerZ = 0) {
    const data = new Uint8ClampedArray(size * size * 4), step = span / size;
    const left = Math.floor(centerX - span / 2), top = Math.floor(centerZ - span / 2);
    const draw = (px, pz, rgb) => { const k = (pz * size + px) * 4; data[k] = rgb[0]; data[k + 1] = rgb[1]; data[k + 2] = rgb[2]; data[k + 3] = 255; };
    for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) draw(x, z, color(world, left + x * step, top + z * step));
    // Downsample all columns in edited cells: even an off-grid, one-block ocean build appears.
    if (step > 1) {
      const dirty = new Set();
      for (const k of world.editedColumns) {
        const [x, z] = k.split(',').map(Number), px = Math.floor((x - left) / step), pz = Math.floor((z - top) / step);
        if (px >= 0 && px < size && pz >= 0 && pz < size) dirty.add(pz * size + px);
      }
      for (const index of dirty) {
        const px = index % size, pz = Math.floor(index / size), land = [], sea = [];
        for (let z = Math.ceil(top + pz * step); z < top + (pz + 1) * step; z++) for (let x = Math.ceil(left + px * step); x < left + (px + 1) * step; x++) {
          (world.mapColumn(x, z).h >= D.C.sea ? land : sea).push(color(world, x, z));
        }
        const pixels = land.length ? land : sea;
        if (pixels.length) draw(px, pz, [0, 1, 2].map(c => pixels.reduce((sum, rgb) => sum + rgb[c], 0) / pixels.length));
      }
    }
    return { data, width: size, height: size };
  }
  return { color, raster };
});
