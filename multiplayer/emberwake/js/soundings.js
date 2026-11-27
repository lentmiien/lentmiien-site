/* New geography for the cooperative chart. Both the browser and server generate it. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;
  else root.EWSoundings = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const reefs = [
    {
      id: 'oyster',
      name: 'Oyster Stair',
      x: -580,
      z: 305,
      accent: 'quillChalk',
      fins: [
        [-14, 6, 13],
        [-13, 6, 15],
        [-12, 6, 14],
        [-11, 6, 13]
      ],
      hint: 'West of Sunwake, dive beneath the striped stone fin. Follow the pearl-colored floor.',
      loot: { pearl: 6, jade: 4, cloth: 2 }
    },
    {
      id: 'bluebell',
      name: 'Bluebell Bellows',
      x: 610,
      z: -545,
      accent: 'irisStone2',
      fins: [
        [-12, 7, 12],
        [-11, 7, 14],
        [-10, 8, 15],
        [-9, 9, 13]
      ],
      hint: 'Northeast of Saffron, a blue seam bends inside a drowned ridge.',
      loot: { crystal: 5, copper: 4, glass: 6 }
    },
    {
      id: 'choir',
      name: 'The Drowned Choir',
      x: -225,
      z: 890,
      accent: 'chordStone',
      fins: [
        [-15, 8, 14],
        [-12, 8, 16],
        [-9, 8, 13]
      ],
      hint: 'South of Prism Crown, listen for the hollow beneath three stone pipes.',
      loot: { roseSpar: 6, pearl: 3, iron: 3 }
    }
  ];
  const burrows = [
    {
      id: 'post',
      name: 'Postmaster’s Hollow',
      x: -310,
      z: -397,
      hint: 'On the eastern shoulder of Mossbell Reach, three pale stones surround a clay seal.',
      loot: { cloth: 4, iron: 3, resin: 5 }
    },
    {
      id: 'kiln',
      name: 'The Amber Flue',
      x: 846,
      z: 338,
      hint: 'On Honeycomb’s eastern rise, dig beneath the ochre cap between three lantern stones.',
      loot: { amber: 6, copper: 3, honeyMica: 4 }
    }
  ];
  const baseRadius = 64,
    treasureBuffer = 12;
  function reefColumn(x, z) {
    for (const reef of reefs) {
      const dx = x - reef.x,
        dz = z - reef.z;
      if (Math.abs(dx) > 20 || Math.abs(dz) > 13) continue;
      const r = (dx / 20) ** 2 + (dz / 13) ** 2;
      if (r > 1) continue;
      const top = Math.floor(7 + (1 - r) * 3);
      // West-facing passage turns north into a vaulted pocket behind the ridge.
      const tunnel = (dx <= 2 && Math.abs(dz - 3) <= 2) || (Math.abs(dx) <= 2 && dz >= -4 && dz <= 4);
      const room = ((dx - 1) / 5) ** 2 + ((dz + 4) / 4) ** 2 < 1;
      const fin = reef.fins.find(([x, z]) => x === dx && z === dz);
      return { top, hollow: tunnel || room, reef, fin };
    }
    return null;
  }
  function sites(seed, column) {
    return [
      ...reefs.map(r => ({ ...r, chest: [r.x + 2, 4, r.z - 5], flooded: true })),
      ...burrows.map(r => ({ ...r, chest: [r.x, column(r.x, r.z, seed).h - 5, r.z], flooded: false }))
    ];
  }
  function writeChunk(cx, cz, cells, world, ids) {
    const put = (x, y, z, id) => {
      if (Math.floor(x / 16) === cx && Math.floor(z / 16) === cz && y > 0 && y < 80)
        cells[y * 256 + (z & 15) * 16 + (x & 15)] = id;
    };
    for (const site of world.soundings) {
      if (Math.abs(cx * 16 + 8 - site.x) > 30 || Math.abs(cz * 16 + 8 - site.z) > 23) continue;
      const [x, y, z] = site.chest;
      if (site.flooded) {
        for (let j = 0; j < 16; j++)
          for (let i = 0; i < 16; i++) {
            const wx = cx * 16 + i,
              wz = cz * 16 + j,
              p = reefColumn(wx, wz);
            if (!p) continue;
            for (let h = 1; h <= p.top; h++)
              put(
                wx,
                h,
                wz,
                p.hollow && h >= 4 && h <= 7
                  ? 0
                  : p.hollow && h === 3
                    ? ids.quillChalk
                    : h === p.top
                      ? ids.pinionSlate
                      : h === 8
                        ? ids[site.accent]
                        : ids.basalt
              );
            if (p.fin) for (let h = p.top + 1; h <= p.fin[2]; h++) put(wx, h, wz, ids[site.accent]);
          }
      } else {
        for (let dx = -2; dx <= 2; dx++)
          for (let dz = -2; dz <= 2; dz++) {
            put(x + dx, y - 1, z + dz, ids.quillChalk);
            for (let h = 0; h < 3; h++) put(x + dx, y + h, z + dz, 0);
          }
        for (let h = y; h <= y + 4; h++) put(x, h, z + 1, 0);
        put(x, y + 5, z + 1, ids.clay);
        for (const [dx, dz] of [
          [-3, 0],
          [2, -2],
          [1, 3]
        ])
          put(x + dx, world.surfaceHeight(x + dx, z + dz) + 1, z + dz, ids.quillChalk);
      }
      put(x, y, z, ids.tideCoffer);
    }
  }
  return { baseRadius, treasureBuffer, sites, reefColumn, writeChunk };
});
