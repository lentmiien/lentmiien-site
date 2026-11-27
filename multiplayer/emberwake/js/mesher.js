(function (root, factory) {
  const api = factory(typeof module === 'object' ? require('./data.js') : root.EWData);
  if (typeof module === 'object') module.exports = api;else root.EWMesh = api;
})(typeof window !== 'undefined' ? window : globalThis, function (D) {
  'use strict';

  // Box silhouettes are merged into chunk geometry, including every furnishing.
  const shapes = {
    pennant: [[.12,0,.2,.25,1,.34],[.22,.57,.24,.87,.92,.31],[.1,0,.12,.39,.12,.43]],
    bamboo: [[.32, 0, .32, .68, 1, .68], [.27, .7, .27, .73, .82, .73]],
    organ: [[0, 0, 0, 1, .2, 1], [.1, .2, .4, .25, .65, .6], [.4, .2, .4, .55, 1, .6], [.7, .2, .4, .85, .8, .6]],
    glass: [[0, 0, .45, .1, 1, .55], [.9, 0, .45, 1, 1, .55], [0, .9, .45, 1, 1, .55], [0, 0, .45, 1, .1, .55], [.45, 0, .47, .55, 1, .53]],
    slab: [[0, 0, 0, 1, .5, 1]],
    stair: [[0, 0, 0, 1, .5, 1], [0, .5, .5, 1, 1, 1]],
    fence: [[.4, 0, .4, .6, 1, .6], [0, .3, .42, 1, .45, .58], [0, .75, .42, 1, .9, .58]],
    bush: [[.12, 0, .12, .88, .7, .88]],
    cactus: [[.25, 0, .25, .75, 1, .75]],
    tablet: [[.1, 0, .3, .9, 1, .7]],
    torch: [[.43, 0, .43, .57, .7, .57], [.35, .65, .35, .65, .95, .65]],
    fire: [[.05, 0, .05, .95, .2, .95], [.25, .2, .25, .75, .55, .75]],
    lantern: [[.22, .15, .22, .78, .75, .78], [.13, .75, .13, .87, .88, .87], [.43, .88, .43, .57, 1, .57]],
    bench: [[0, .6, 0, 1, .85, 1], [.06, 0, .06, .23, .6, .23], [.77, 0, .77, .94, .6, .94], [.77, 0, .06, .94, .6, .23], [.06, 0, .77, .23, .6, .94]],
    table: [[0, .65, 0, 1, .8, 1], [.4, 0, .4, .6, .65, .6]],
    oven: [[0, 0, 0, 1, .8, 1], [.15, .8, .5, .85, 1, .95]],
    bed: [[0, .15, 0, 1, .45, 1], [0, .45, .05, 1, .65, .3]],
    chair: [[.1, .4, .1, .9, .55, .9], [.1, .55, .75, .9, 1, .9], [.1, 0, .1, .25, .4, .9], [.75, 0, .1, .9, .4, .9]],
    sofa: [[0, 0, 0, 1, .4, 1], [0, .4, .75, 1, 1, 1], [0, .4, 0, .17, .7, 1], [.83, .4, 0, 1, .7, 1]],
    canopy: [[0, .1, 0, 1, .4, 1], [0, 0, 0, .12, 1, .12], [.88, 0, .88, 1, 1, 1], [0, .88, 0, 1, 1, 1]],
    coffer: [[.07,.04,.12,.93,.63,.88],[.04,.58,.1,.96,.74,.9],[.4,.36,.07,.59,.66,.15]],
    fanlight: [[0,0,.42,.1,1,.58],[.9,0,.42,1,1,.58],[0,0,.42,1,.12,.58],[0,.88,.42,1,1,.58],[.44,0,.42,.56,.9,.58],[.2,.54,.43,.8,.62,.57]],
    awning: [[0,.74,0,1,.87,.38],[0,.64,.38,1,.78,.7],[0,.53,.7,1,.67,1],[0,0,0,.09,.78,.09],[.91,0,0,1,.78,.09]],
    sailLamp: [[.24,0,.22,.76,.14,.78],[.48,.14,.45,.58,1,.55],[.22,.22,.4,.8,.38,.6],[.3,.38,.4,.74,.58,.6],[.4,.58,.4,.66,.78,.6]],
    strings: [[0,0,.4,.12,1,.6],[.88,0,.4,1,1,.6],[0,.88,.4,1,1,.6],[0,0,.4,1,.12,.6],[.28,.12,.47,.33,.88,.53],[.49,.12,.47,.54,.88,.53],[.7,.12,.47,.75,.88,.53]],
    sunwheel: [[.2,0,.2,.8,.14,.8],[.44,.14,.44,.56,.55,.56],[.08,.55,.19,.92,.65,.81],[.47,.65,.33,.53,.88,.69]],
    carillon: [[.04,0,.36,.15,1,.62],[.85,0,.36,.96,1,.62],[.04,.9,.36,.96,1,.62],[.2,.2,.4,.31,.9,.56],[.36,.31,.4,.47,.9,.56],[.52,.43,.4,.63,.9,.56],[.68,.55,.4,.79,.9,.56]],
    starCage: [[.15,.1,.15,.85,.21,.85],[.15,.78,.15,.85,.88,.85],[.15,.2,.15,.21,.8,.21],[.79,.2,.79,.85,.8,.85],[.32,.37,.32,.68,.65,.68],[.47,.23,.47,.53,.77,.53]],
    portal: [[0, 0, 0, 1, .18, 1]],
    rug: [[0, .015, 0, 1, .06, 1]],
    chest: [[.08, 0, .08, .92, .75, .92], [.05, .75, .05, .95, .88, .95]],
    planter: [[.15, 0, .15, .85, .5, .85], [.28, .5, .28, .72, .95, .72]],
    vase: [[.25, 0, .25, .75, .55, .75], [.35, .55, .35, .65, .85, .65]],
    shelf: [[0, 0, .78, 1, 1, 1], [0, 0, 0, .12, 1, 1], [.88, 0, 0, 1, 1, 1], [0, .42, 0, 1, .52, 1], [0, .88, 0, 1, 1, 1], [.2, .1, .2, .35, .4, .7], [.45, .52, .3, .6, .88, .75]],
    globe: [[.2, 0, .2, .8, .12, .8], [.45, .1, .45, .55, .4, .55], [.2, .4, .2, .8, 1, .8]],
    telescope: [[.43, 0, .43, .57, .75, .57], [.1, .65, .3, .9, .9, .7]],
    fountain: [[0, 0, 0, 1, .3, 1], [.4, .3, .4, .6, 1, .6], [.1, .65, .1, .9, .75, .9]],
    bath: [[0, 0, 0, 1, .2, 1], [0, 0, 0, .13, .65, 1], [.87, 0, 0, 1, .65, 1], [0, 0, 0, 1, .65, .13], [0, 0, .87, 1, .65, 1], [.13, .3, .13, .87, .35, .87]],
    sculpture: [[.1, 0, .1, .9, .2, .9], [.3, .2, .3, .7, .6, .7], [.15, .6, .15, .85, .9, .85], [.4, .9, .4, .6, 1, .6]],
    beacon: [[.2, 0, .2, .8, .25, .8], [.4, .25, .4, .6, .8, .6], [.1, .8, .1, .9, 1, .9]],
    chime: [[.1, .9, .1, .9, 1, .9], [.2, .2, .2, .3, .9, .3], [.5, .4, .5, .6, .9, .6], [.7, .1, .7, .8, .9, .8]],
    music: [[.1, 0, .1, .9, .3, .9], [.4, .3, .4, .6, .7, .6], [.2, .7, .2, .8, 1, .8]],
    farm: [[0, 0, 0, 1, .22, 1]],
    trellis: [[.05, 0, .4, .15, 1, .6], [.85, 0, .4, .95, 1, .6], [.05, .45, .4, .95, .55, .6], [.05, .9, .4, .95, 1, .6]]
  };
  const faces = [{
    n: [1, 0, 0],
    v: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    shade: .82
  }, {
    n: [-1, 0, 0],
    v: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    shade: .68
  }, {
    n: [0, 1, 0],
    v: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
    shade: 1
  }, {
    n: [0, -1, 0],
    v: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
    shade: .5
  }, {
    n: [0, 0, 1],
    v: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    shade: .88
  }, {
    n: [0, 0, -1],
    v: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
    shade: .73
  }];
  function mesh(world, cx, cz, minY = 0) {
    const terrain = typeof module === 'object' ? require('./world.js') : window.EWWorld;
    const biome = [];
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) biome[z * 16 + x] = terrain.column(cx * 16 + x, cz * 16 + z, world.seed).island?.id;
    const positions = [],
      normals = [],
      uvs = [],
      colors = [],
      indices = [];
    const data = world.chunks.get(`${cx},${cz}`) || world.generate(cx, cz);
    // Fixed neighbor arrays avoid millions of string lookups while meshing.
    const left = world.chunks.get(`${cx - 1},${cz}`) || world.generate(cx - 1, cz),
      right = world.chunks.get(`${cx + 1},${cz}`) || world.generate(cx + 1, cz),
      front = world.chunks.get(`${cx},${cz - 1}`) || world.generate(cx, cz - 1),
      back = world.chunks.get(`${cx},${cz + 1}`) || world.generate(cx, cz + 1);
    const at = (x, y, z) => y < 0 ? 1 : y >= D.C.height ? 0 : x < 0 ? left[y * 256 + z * 16 + 15] : x > 15 ? right[y * 256 + z * 16] : z < 0 ? front[y * 256 + 240 + x] : z > 15 ? back[y * 256 + x] : data[y * 256 + z * 16 + x];
    function box(x, y, z, id, shape, full) {
      for (const face of faces) {
        const nb = at(x + face.n[0], y + face.n[1], z + face.n[2]);
        if (full && nb && !shapes[D.blocks[nb].shape]) continue;
        const index = positions.length / 3,
          tx = id % 8,
          ty = Math.floor(id / 8),
          u0 = (tx * 16 + .5) / D.atlas.width,
          u1 = (tx * 16 + 15.5) / D.atlas.width,
          v0 = 1 - (ty * 16 + 15.5) / D.atlas.height,
          v1 = 1 - (ty * 16 + .5) / D.atlas.height;
        const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
        for (let k = 0; k < 4; k++) {
          const v = face.v[k];
          positions.push(cx * 16 + x + shape[0] + v[0] * (shape[3] - shape[0]), y + shape[1] + v[1] * (shape[4] - shape[1]), cz * 16 + z + shape[2] + v[2] * (shape[5] - shape[2]));
          normals.push(...face.n);
          uvs.push(...uv[k]);
          const shade = face.shade,
            tint = [D.ids.grass, D.ids.leaves].includes(id) ? biome[z * 16 + x] === 'forest' ? [.58, .83, .7] : biome[z * 16 + x] === 'tropic' ? [.9, 1, .73] : [.85, .95, 1] : [1, 1, 1];
          colors.push(shade * tint[0], shade * tint[1], shade * tint[2]);
        }
        indices.push(index, index + 1, index + 2, index, index + 2, index + 3);
      }
    }
    for (let y = minY; y < D.C.height; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const id = data[y * 256 + z * 16 + x];
      if (!id) continue;
      const shape = shapes[D.blocks[id].shape];
      if (shape) for (const b of shape) box(x, y, z, id, b, false);else box(x, y, z, id, [0, 0, 0, 1, 1, 1], true);
    }
    return {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      uvs: new Float32Array(uvs),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices)
    };
  }
  return {
    mesh,
    shapes,
    faces
  };
});
