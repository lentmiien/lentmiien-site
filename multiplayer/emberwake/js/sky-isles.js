/* The airborne stratum is independent of the original seafloor generator. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api; else root.EWSky = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const sites = [
    {
      id: 'kestrel', name: 'Kestrel Wing', biome: 'Mica downland', x: 852, z: -804,
      rx: 72, rz: 48, color: '#cbd889', base: 48,
      outline: [[-68,21],[-52,-6],[-26,-19],[-9,-24],[4,-42],[13,-25],[31,-19],[65,5],[57,6],[67,20],[40,10],[51,26],[20,13],[12,17],[5,36],[-4,29],[-14,38],[-12,13],[-35,22],[-28,10],[-54,25],[-47,12]],
      materials: ['sunflaxSod', 'quillChalk', 'pinionSlate', 'honeyMica', 'windOpal'],
      vaults: [
        { id: 'aviator', dx: -22, dz: -8, shaft: true, reward: 'sailMantle', clue: 'Look for a broken ring of white quills. The pale opal at its centre sounds hollow.', story: 'A pilot folded this silk mantle into the keel of her first airship. Hold Space while falling to open its sail.' },
        { id: 'navigator', dx: 7, dz: 17, mouth: [1, 0], reward: 'sunwheel', clue: 'Along the tail, one seam of blue slate runs straight into the cliff.', story: 'A brass instrument saved from the mail fleet. Set it down and press E to take a bearing home.' }
      ]
    },
    {
      id: 'vesper', name: 'Vesper Lyre', biome: 'Resonant crags', x: -488, z: 504,
      rx: 68, rz: 53, color: '#d38bb5', base: 53,
      outline: [[-61,-31],[-43,-41],[-35,-24],[-18,-12],[-12,-47],[-1,-36],[-4,-14],[10,-7],[30,-22],[43,-45],[56,-39],[48,-9],[58,8],[42,22],[25,25],[8,42],[-8,48],[-14,32],[-43,21],[-56,2],[-40,-6]],
      window: [[-29,-3],[-14,0],[3,6],[28,-3],[35,2],[24,13],[2,23],[-17,16],[-31,7]],
      materials: ['duskLichen', 'chordStone', 'velvetBasalt', 'bellMetal', 'roseSpar'],
      vaults: [
        { id: 'musician', dx: 1, dz: 30, mouth: [0, -1], reward: 'nightjarChimes', clue: 'Look up through the lyre’s open window. The bronze lintel marks the old instrument room.', story: 'A nightjar once nested in these silver pipes. Place the carillon and press E to hear its five evening notes.' },
        { id: 'lamplighter', dx: -41, dz: -22, shaft: true, reward: 'vesperStar', clue: 'At the western tine, count the organ pipes down to the shortest. Dig through the rose stone at its foot.', story: 'The lamplighter left a star burning in a glass cage. It casts violet light wherever you hang it.' }
      ]
    }
  ];
  const pack = {
    id: 'sky-isles', firstBlock: 127, islands: [],
    blocks: [
      ['sunflaxSod', 'Sunflax sod', '#bccb78', { grain: 'sod' }],
      ['quillChalk', 'Quill chalk', '#f4e9c8', { grain: 'bedded' }],
      ['pinionSlate', 'Pinion slate', '#427484', { grain: 'bedded' }],
      ['honeyMica', 'Honey mica', '#dfac48', { grain: 'mica', tier: 1 }],
      ['windOpal', 'Wind opal', '#9debe4', { grain: 'spar', tier: 1 }],
      ['duskLichen', 'Dusk lichen', '#bb8caf', { grain: 'sod' }],
      ['chordStone', 'Chordstone', '#77759e', { grain: 'bedded' }],
      ['velvetBasalt', 'Velvet basalt', '#494266', { grain: 'pipes' }],
      ['bellMetal', 'Bellmetal vein', '#bd8466', { grain: 'mica', tier: 1 }],
      ['roseSpar', 'Rose spar', '#f5a9bb', { grain: 'spar', tier: 1 }],
      ['skyCoffer', 'Cloud courier’s coffer', '#d5a84e', { shape: 'coffer', grain: 'coffer', tier: 99 }],
      ['quillPaver', 'Quill herringbone', '#dacfb2', { grain: 'weave' }],
      ['pinionSteps', 'Pinion stair', '#577f92', { shape: 'stair', grain: 'bedded' }],
      ['opalScreen', 'Opal fanlight', '#9debe4', { shape: 'fanlight', grain: 'spar' }],
      ['sunflaxAwning', 'Striped sail awning', '#e4c683', { shape: 'awning', grain: 'sail' }],
      ['micaSconce', 'Mica sail lamp', '#f6c975', { shape: 'sailLamp', category: 'light', lightColor: '#ffd98a', quality: 6 }],
      ['lyreTile', 'Lyre parquet', '#ae89a7', { grain: 'weave' }],
      ['basaltSlab', 'Velvet basalt slab', '#514b70', { shape: 'slab', grain: 'pipes' }],
      ['roseScreen', 'Rose string screen', '#d69ab4', { shape: 'strings', grain: 'spar' }],
      ['bellSeat', 'Bellfounder’s settee', '#c69394', { shape: 'sofa', category: 'social', quality: 6 }],
      ['roseBrazier', 'Roselight brazier', '#f2a1ad', { shape: 'fire', category: 'light', lightColor: '#f899bb', quality: 6 }],
      ['skyMarquetry', 'Dawn and dusk marquetry', '#d3bf98', { grain: 'inlay' }],
      ['sunwheel', 'Pilot’s sunwheel', '#e6c77b', { shape: 'sunwheel', category: 'knowledge', quality: 9, grain: 'mica' }],
      ['nightjarChimes', 'Nightjar carillon', '#b397ce', { shape: 'carillon', category: 'music', quality: 9, grain: 'pipes' }],
      ['vesperStar', 'Caged vesper star', '#d8aeff', { shape: 'starCage', category: 'light', lightColor: '#c18dff', quality: 9, grain: 'spar' }]
    ],
    items: [['sailMantle', 'Aviator’s sail mantle', '#e7c480', {}]],
    recipes: [
      ['quillPaver', 6, { quillChalk: 3, honeyMica: 1 }, 'bench', 'kestrel'],
      ['pinionSteps', 6, { pinionSlate: 4 }, 'bench', 'kestrel'],
      ['opalScreen', 4, { windOpal: 2, glass: 2 }, 'bench', 'kestrel'],
      ['sunflaxAwning', 4, { sunflaxSod: 3, cloth: 1, plank: 1 }, 'loom', 'kestrel'],
      ['micaSconce', 2, { honeyMica: 2, windOpal: 1, torch: 1 }, 'bench', 'kestrel'],
      ['lyreTile', 6, { chordStone: 2, duskLichen: 2 }, 'bench', 'vesper'],
      ['basaltSlab', 6, { velvetBasalt: 3 }, 'bench', 'vesper'],
      ['roseScreen', 4, { roseSpar: 2, bellMetal: 1 }, 'bench', 'vesper'],
      ['bellSeat', 1, { bellMetal: 2, duskLichen: 3, cloth: 1 }, 'bench', 'vesper'],
      ['roseBrazier', 2, { velvetBasalt: 2, roseSpar: 2, torch: 1 }, 'bench', 'vesper'],
      ['skyMarquetry', 8, { quillChalk: 2, honeyMica: 1, velvetBasalt: 2, roseSpar: 1 }, 'artisans']
    ]
  };

  // Alternative moorings stay in the same requested sea sector. The upgrade
  // prefers open sky over changing the view or headroom of a pre-existing build.
  const moorings = [[0, 0], [-144, 0], [0, 100], [0, -100], [144, 0], [-144, 100], [-144, -100], [112, 80], [96, -80]];
  function moor(site, index) {
    const [dx, dz] = moorings[index];
    return { ...site, x: site.x + dx, z: site.z + dz };
  }
  function nearChunk(site, cx, cz) {
    return Math.abs(cx * 16 + 8 - site.x) <= site.rx + 8 && Math.abs(cz * 16 + 8 - site.z) <= site.rz + 8;
  }
  function nearCell(site, gx, gz) {
    return Math.abs(gx * 4 + 2 - site.x) <= site.rx + 2 && Math.abs(gz * 4 + 2 - site.z) <= site.rz + 2;
  }
  function layoutFor(state) {
    const occupied = new Set();
    function reserve(cx, cz) {
      for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) occupied.add(x + ',' + z);
    }
    if (state) {
      for (const [key, edits] of Object.entries(state.edits)) {
        if (edits.some(([index]) => index >= 24 * 256)) reserve(...key.split(',').map(Number));
      }
      for (const p of [state.player, state.camp]) if (p.y >= 22) reserve(Math.floor(p.x / 16), Math.floor(p.z / 16));
    }
    const berths = [], crowded = [];
    for (const site of sites) {
      let best = null;
      for (let n = 0; n < moorings.length; n++) {
        const candidate = moor(site, n), overlaps = [];
        for (let x = Math.floor((candidate.x - site.rx) / 16); x <= Math.floor((candidate.x + site.rx) / 16); x++) {
          for (let z = Math.floor((candidate.z - site.rz) / 16); z <= Math.floor((candidate.z + site.rz) / 16); z++) {
            const key = x + ',' + z;
            if (occupied.has(key)) overlaps.push(key);
          }
        }
        if (!best || overlaps.length < best.overlaps.length) best = { n, overlaps };
        if (!overlaps.length) break;
      }
      berths.push(best.n);
      if (best.overlaps.length) crowded.push(moor(site, best.n));
    }
    // In a heavily built sector every berth may be occupied. Keep clearance
    // around the actual old structures, including headroom, at 4 m resolution.
    // An isolated old pole must not punch a chunk-sized hole through the island.
    const masks = new Map();
    function shelter(x, y, z) {
      if (y < 20 || !crowded.some(site => Math.abs(site.x - x) <= site.rx + 5 && Math.abs(site.z - z) <= site.rz + 5)) return;
      let mask = 0;
      for (let h = Math.max(24, y - 2); h <= Math.min(79, y + 4); h++) mask |= 1 << (Math.floor(h / 4) - 6);
      if (!mask) return;
      for (let gx = Math.floor((x - 2) / 4); gx <= Math.floor((x + 2) / 4); gx++) {
        for (let gz = Math.floor((z - 2) / 4); gz <= Math.floor((z + 2) / 4); gz++) {
          if (!crowded.some(site => nearCell(site, gx, gz))) continue;
          const key = gx + ',' + gz;
          masks.set(key, (masks.get(key) || 0) | mask);
        }
      }
    }
    if (crowded.length) {
      for (const [key, edits] of Object.entries(state.edits)) {
        const [cx, cz] = key.split(',').map(Number);
        for (const [index] of edits) shelter(cx * 16 + index % 16, Math.floor(index / 256), cz * 16 + (index >> 4 & 15));
      }
      for (const p of [state.player, state.camp]) shelter(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    }
    const clear = [...masks].map(([key, mask]) => [...key.split(',').map(Number), mask]);
    return { berths, clear, finds: [] };
  }

  // Signed distance to an authored polygon gives the overhang thickness as
  // well as the shoreline. The lyre has a second contour cut right through it.
  function rim(loop, x, z) {
    let inside = false, nearest = Infinity;
    for (let n = 0, j = loop.length - 1; n < loop.length; j = n++) {
      const [ax, az] = loop[j], [bx, bz] = loop[n], dx = bx - ax, dz = bz - az;
      if ((az > z) !== (bz > z) && x < ax + (z - az) * dx / dz) inside = !inside;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
      nearest = Math.min(nearest, (x - ax - t * dx) ** 2 + (z - az - t * dz) ** 2);
    }
    return (inside ? 1 : -1) * Math.sqrt(nearest);
  }
  function profile(site, x, z, seed, noise) {
    const dx = x - site.x, dz = z - site.z;
    if (Math.abs(dx) > site.rx || Math.abs(dz) > site.rz) return null;
    const ripple = noise(x / 11, z / 11, seed + 79);
    const px = dx + (ripple - .5) * 2.8, pz = dz + (noise(x / 13, z / 13, seed + 34) - .5) * 3;
    let edge = rim(site.outline, px, pz);
    if (edge <= 0) return null;
    if (site.window) edge = Math.min(edge, -rim(site.window, px, pz));
    if (edge <= 0) return null;
    const spine = Math.min(1, edge / 13), fold = noise(x / 22, z / 22, seed + 11);
    const top = site.base + Math.floor(3 * spine + 4 * fold + (site.window ? -dz * .065 : -dx * .045));
    const bottom = top - 3 - Math.floor(spine * (8 + 11 * ripple));
    const [sod, stone, keel, metal, gem] = site.materials;
    const surface = edge < 2 ? stone : fold > .65 ? metal : ripple < .24 ? gem : sod;
    return { top, bottom, surface, stone, keel, metal, gem, site };
  }
  return { sites, pack, moorings, moor, nearChunk, nearCell, layoutFor, profile };
});
