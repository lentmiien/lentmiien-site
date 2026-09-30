/* Original catalog. Shared by browser and model tests; no runtime dependencies. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api;else root.EWData = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const C = {
    chunk: 16,
    height: 80,
    sea: 12,
    extent: 512,
    warning: 405,
    danger: 450,
    border: 490,
    reach: 5.5,
    pack: 1800,
    maxEdits: 45000,
    version: 1
  };
  const items = {},
    blocks = [{
      id: 0,
      key: 'air',
      solid: false
    }],
    recipes = [];
  function item(key, name, color, extra = {}) {
    items[key] = {
      key,
      name,
      color,
      ...extra
    };
  }
  function block(key, name, color, extra = {}) {
    const id = blocks.length;
    blocks.push({
      id,
      key,
      name,
      color,
      solid: true,
      hardness: .45,
      tier: 0,
      ...extra
    });
    item(key, name, color, {
      block: id,
      ...extra
    });
    return id;
  }
  block('bedrock', 'Deep bedrock', '#303747', {
    tier: 99
  });
  block('grass', 'Meadow turf', '#699855', {
    drop: 'dirt'
  });
  block('dirt', 'Earth', '#8c6044');
  block('sand', 'Coral sand', '#e0c68d');
  block('stone', 'Coastal stone', '#90949b', {
    tier: 1,
    hardness: .9
  });
  block('log', 'Driftwood log', '#8b633f', {
    hardness: .7
  });
  block('leaves', 'Island foliage', '#418858', {
    drop: 'fiber',
    shape: 'leaf'
  });
  block('berryBush', 'Sunberry bush', '#75a852', {
    shape: 'bush',
    drop: 'fiber',
    solid: false
  });
  block('clay', 'River clay', '#c58669');
  block('snow', 'Alpine snow', '#d4e6e6', {
    drop: 'dirt'
  });
  block('basalt', 'Basalt', '#55576b', {
    tier: 2
  });
  block('copperOre', 'Copper seam', '#bd9a73', {
    tier: 1,
    drop: 'copperOre',
    hardness: 1.2
  });
  block('ironOre', 'Iron seam', '#a8a6a0', {
    tier: 2,
    hardness: 1.4
  });
  block('coalOre', 'Coal seam', '#69727a', {
    tier: 1,
    drop: 'coal'
  });
  block('crystalOre', 'Prism seam', '#70d5d3', {
    tier: 3,
    drop: 'crystal',
    hardness: 1.7
  });
  block('cactus', 'Candle cactus', '#69945d', {
    drop: 'fiber',
    shape: 'cactus'
  });
  block('relic', 'Tidekeeper tablet', '#dbb568', {
    tier: 99,
    shape: 'tablet'
  });
  block('plank', 'Timber planks', '#bd8b59');
  block('cobble', 'Stone masonry', '#a3a9aa');
  block('sandstone', 'Sandstone ashlar', '#d5b77d');
  block('brick', 'Terracotta brick', '#bd7958');
  block('glass', 'Sea glass window', '#9bd0ca', {
    shape: 'glass'
  });
  block('darkwood', 'Smoked timber', '#66514c');
  block('tile', 'Glazed floor', '#548e9b');
  block('marble', 'Alpine marble', '#e1dada');
  block('copperTile', 'Copper roof', '#c78058');
  block('prismTile', 'Prismatic inlay', '#9ec5cb');
  block('stair', 'Timber steps', '#bc8f60', {
    shape: 'stair'
  });
  block('slab', 'Timber half slab', '#c29568', {
    shape: 'slab'
  });
  block('fence', 'Garden railing', '#b89569', {
    shape: 'fence'
  });
  const furniture = [['bench', 'Workbench', '#b68c5c', 'work', 1, 'bench'], ['kiln', 'Clay kiln', '#b57551', 'work', 2, 'oven'], ['forge', 'Copper forge', '#687c83', 'work', 3, 'oven'], ['loom', 'Weaving loom', '#bfa080', 'work', 2, 'shelf'], ['galley', 'Island galley', '#c89770', 'work', 3, 'bench'], ['artisans', 'Artisan table', '#bbac86', 'work', 4, 'bench'], ['campfire', 'Stone hearth', '#ee994f', 'light', 2, 'fire'], ['torch', 'Resin torch', '#eeb553', 'light', 1, 'torch'], ['lantern', 'Copper lantern', '#e8b764', 'light', 4, 'lantern'], ['prismLamp', 'Prism lantern', '#8ee3df', 'light', 7, 'lantern'], ['bed', 'Woven daybed', '#dcaf7b', 'rest', 3, 'bed'], ['silkBed', 'Canopy daybed', '#ede0b5', 'rest', 7, 'canopy'], ['chair', 'Carved chair', '#bda081', 'social', 2, 'chair'], ['table', 'Dining table', '#ceac7a', 'social', 3, 'table'], ['sofa', 'Coastal sofa', '#649e9f', 'rest', 5, 'sofa'], ['rug', 'Woven rug', '#c07260', 'textile', 3, 'rug'], ['royalRug', 'Sunburst carpet', '#dcad69', 'textile', 6, 'rug'], ['chest', 'Cedar chest', '#a77950', 'storage', 2, 'chest'], ['planter', 'Flower planter', '#bb9c70', 'garden', 3, 'planter'], ['vase', 'Glazed vase', '#6ec0c0', 'art', 3, 'vase'], ['shelf', 'Library shelf', '#9c7b5d', 'knowledge', 4, 'shelf'], ['globe', 'Navigator globe', '#70b8ba', 'knowledge', 6, 'globe'], ['telescope', 'Brass telescope', '#d7b572', 'knowledge', 7, 'telescope'], ['fountain', 'Spring fountain', '#9cc6d0', 'water', 6, 'fountain'], ['bath', 'Mineral soaking bath', '#bec5cc', 'water', 8, 'bath'], ['sculpture', 'Tidekeeper sculpture', '#c6b5e1', 'art', 8, 'sculpture'], ['beacon', 'Harbor beacon', '#f1bf62', 'light', 8, 'beacon'], ['windchime', 'Shell wind chimes', '#e1c998', 'music', 4, 'chime'], ['gramophone', 'Wind-up music box', '#cbb277', 'music', 7, 'music'], ['picnic', 'Picnic spread', '#d2947f', 'social', 5, 'table'], ['farmland', 'Garden bed', '#765e43', 'garden', 1, 'farm'], ['trellis', 'Vine trellis', '#84a16b', 'garden', 4, 'trellis']];
  for (const [key, name, color, category, quality, shape] of furniture) block(key, name, color, {
    category,
    quality,
    shape,
    hardness: .35
  });
  for (const [key, name, color, extra] of [['fiber', 'Plant fiber', '#9dbc71'], ['resin', 'Tree resin', '#deb24f'], ['coal', 'Coal', '#555b66'], ['copper', 'Copper ingot', '#d58c64'], ['iron', 'Iron ingot', '#c0cbd0'], ['crystal', 'Prism crystal', '#99e7e1'], ['cloth', 'Woven cloth', '#e3c99c'], ['rope', 'Braided rope', '#c6b386'], ['shell', 'Pearl shell', '#eccec5'], ['pearl', 'Lustre pearl', '#ece4d5'], ['seed', 'Garden seed', '#bda165'], ['grain', 'Island grain', '#dfc879'], ['berry', 'Sunberry', '#df8587', {
    food: 15
  }], ['fish', 'Silverfin', '#83b7c5', {
    food: 12
  }], ['carrot', 'Golden root', '#efa34a', {
    food: 22
  }], ['grilledFish', 'Cedar grilled fish', '#dba76e', {
    food: 50
  }], ['stew', 'Root & berry stew', '#e9b87c', {
    food: 65
  }], ['bread', 'Hearth bread', '#dcb779', {
    food: 45
  }], ['feast', 'Island feast', '#eebc87', {
    food: 100,
    buff: 300
  }], ['tea', 'Alpine tea', '#9ecdad', {
    food: 20,
    buff: 180
  }], ['jam', 'Sunberry preserve', '#cc777d', {
    food: 45
  }], ['woodPick', 'Driftwood pick', '#c09a6d', {
    tool: 1
  }], ['stonePick', 'Stone pick', '#b2b4ac', {
    tool: 2
  }], ['copperPick', 'Copper pick', '#d69b71', {
    tool: 3
  }], ['ironPick', 'Iron pick', '#d4dde3', {
    tool: 4
  }], ['axe', 'Copper axe', '#c98c6e', {
    axe: true
  }], ['shovel', 'Garden spade', '#a2b3bc', {
    shovel: true
  }], ['rod', 'Fishing rod', '#d0b480', {
    rod: true
  }], ['wateringCan', 'Watering can', '#7aaabb', {
    watering: true
  }], ['coat', 'Alpine cloak', '#c9d9da', {
    coat: true
  }], ['raft', 'Sailing raft', '#d9ba7f', {
    boat: 14
  }], ['cutter', 'Outrigger cutter', '#efe0b1', {
    boat: 22
  }]]) item(key, name, color, extra);
  function recipe(out, count, cost, station = null, discovery = null, category = null) {
    recipes.push({
      id: out,
      out,
      count,
      cost,
      station,
      discovery,
      category: category || (items[out].food ? 'Kitchen' : items[out].tool || ['axe', 'shovel', 'rod', 'wateringCan', 'coat'].includes(out) ? 'Equipment' : items[out].category ? 'Camp' : items[out].block ? 'Building' : 'Materials')
    });
  }
  recipe('plank', 4, {
    log: 1
  });
  recipe('rope', 2, {
    fiber: 4
  });
  recipe('bench', 1, {
    plank: 4
  });
  recipe('woodPick', 1, {
    plank: 3,
    fiber: 2
  });
  recipe('stonePick', 1, {
    stone: 4,
    plank: 2
  }, 'bench');
  recipe('cobble', 4, {
    stone: 4
  });
  recipe('sandstone', 4, {
    sand: 4
  }, 'bench');
  recipe('stair', 4, {
    plank: 3
  }, 'bench');
  recipe('slab', 6, {
    plank: 3
  });
  recipe('fence', 4, {
    plank: 2,
    rope: 1
  }, 'bench');
  recipe('campfire', 1, {
    stone: 4,
    log: 2
  });
  recipe('torch', 4, {
    plank: 1,
    resin: 1
  });
  recipe('kiln', 1, {
    clay: 8,
    stone: 4
  }, 'bench');
  recipe('copper', 2, {
    copperOre: 2,
    coal: 1
  }, 'kiln');
  recipe('brick', 4, {
    clay: 4,
    coal: 1
  }, 'kiln');
  recipe('glass', 4, {
    sand: 4,
    coal: 1
  }, 'kiln');
  recipe('forge', 1, {
    stone: 8,
    copper: 4
  }, 'bench');
  recipe('iron', 2, {
    ironOre: 2,
    coal: 1
  }, 'forge');
  recipe('copperPick', 1, {
    copper: 4,
    plank: 2
  }, 'bench');
  recipe('ironPick', 1, {
    iron: 4,
    plank: 2
  }, 'forge');
  recipe('axe', 1, {
    copper: 3,
    plank: 2
  }, 'bench');
  recipe('shovel', 1, {
    iron: 2,
    plank: 2
  }, 'forge');
  recipe('rod', 1, {
    plank: 3,
    rope: 2
  }, 'bench');
  recipe('raft', 1, {
    log: 8,
    rope: 4
  }, 'bench', null, 'Voyaging');
  recipe('cutter', 1, {
    plank: 24,
    cloth: 8,
    iron: 6
  }, 'artisans', 'frost', 'Voyaging');
  recipe('loom', 1, {
    plank: 6,
    rope: 2
  }, 'bench');
  recipe('cloth', 3, {
    fiber: 6
  }, 'loom');
  recipe('coat', 1, {
    cloth: 5,
    rope: 2
  }, 'loom');
  recipe('wateringCan', 1, {
    copper: 3
  }, 'bench');
  recipe('chest', 1, {
    plank: 6
  }, 'bench');
  recipe('bed', 1, {
    plank: 4,
    cloth: 2
  }, 'bench');
  recipe('chair', 2, {
    plank: 4
  }, 'bench');
  recipe('table', 1, {
    plank: 4,
    copper: 1
  }, 'bench');
  recipe('rug', 1, {
    cloth: 3
  }, 'loom');
  recipe('sofa', 1, {
    plank: 6,
    cloth: 4
  }, 'loom');
  recipe('planter', 1, {
    clay: 3,
    seed: 1
  }, 'bench');
  recipe('farmland', 2, {
    dirt: 2,
    fiber: 2
  });
  recipe('trellis', 1, {
    plank: 4,
    fiber: 4
  }, 'bench');
  recipe('lantern', 2, {
    copper: 2,
    glass: 2,
    resin: 1
  }, 'bench');
  recipe('galley', 1, {
    brick: 6,
    copper: 2
  }, 'bench');
  recipe('grilledFish', 1, {
    fish: 1
  }, 'campfire');
  recipe('stew', 1, {
    carrot: 2,
    berry: 2
  }, 'galley');
  recipe('bread', 2, {
    grain: 3
  }, 'galley');
  recipe('feast', 1, {
    bread: 1,
    grilledFish: 1,
    carrot: 2
  }, 'galley');
  recipe('jam', 1, {
    berry: 4
  }, 'galley');
  recipe('tea', 1, {
    fiber: 2,
    berry: 1
  }, 'campfire', 'frost');
  recipe('darkwood', 4, {
    plank: 4,
    coal: 1
  }, 'kiln');
  recipe('tile', 4, {
    clay: 3,
    copper: 1
  }, 'kiln', 'dunes');
  recipe('marble', 4, {
    stone: 4,
    iron: 1
  }, 'artisans', 'frost');
  recipe('copperTile', 4, {
    copper: 2
  }, 'forge');
  recipe('artisans', 1, {
    plank: 8,
    iron: 4,
    cloth: 2
  }, 'bench');
  recipe('prismTile', 4, {
    stone: 4,
    crystal: 1
  }, 'artisans', 'cinder');
  recipe('prismLamp', 1, {
    glass: 2,
    crystal: 2,
    copper: 1
  }, 'artisans', 'cinder');
  recipe('silkBed', 1, {
    darkwood: 6,
    cloth: 6,
    pearl: 1
  }, 'artisans', 'forest');
  recipe('royalRug', 1, {
    cloth: 5,
    shell: 3
  }, 'loom', 'dunes');
  recipe('vase', 1, {
    clay: 4,
    copper: 1
  }, 'kiln');
  recipe('shelf', 1, {
    plank: 6,
    cloth: 2
  }, 'bench');
  recipe('globe', 1, {
    copper: 3,
    glass: 3
  }, 'artisans', 'forest');
  recipe('telescope', 1, {
    copper: 4,
    glass: 4,
    iron: 2
  }, 'artisans', 'frost');
  recipe('fountain', 1, {
    marble: 6,
    copper: 2
  }, 'artisans', 'frost');
  recipe('bath', 1, {
    marble: 8,
    crystal: 2
  }, 'artisans', 'cinder');
  recipe('sculpture', 1, {
    crystal: 4,
    marble: 4,
    pearl: 1
  }, 'artisans', 'cinder');
  recipe('beacon', 1, {
    copper: 4,
    glass: 4,
    crystal: 2
  }, 'artisans', 'cinder');
  recipe('windchime', 1, {
    shell: 4,
    rope: 1
  }, 'bench');
  recipe('gramophone', 1, {
    copper: 4,
    iron: 2,
    pearl: 1
  }, 'artisans', 'forest');
  recipe('picnic', 1, {
    plank: 4,
    cloth: 2,
    feast: 1
  }, 'galley');
  const islands = [{
    id: 'tropic',
    name: 'Sunwake Cay',
    biome: 'Tropical',
    x: -145,
    z: 65,
    rx: 86,
    rz: 77,
    rise: 21,
    color: '#78aa64',
    landmark: 'The Listening Shell'
  }, {
    id: 'forest',
    name: 'Mossbell Reach',
    biome: 'Forest & meadow',
    x: -165,
    z: -170,
    rx: 88,
    rz: 82,
    rise: 28,
    color: '#508b6c',
    landmark: 'The Unsent Post Office'
  }, {
    id: 'dunes',
    name: 'Saffron Atoll',
    biome: 'Arid mesas',
    x: 115,
    z: -175,
    rx: 89,
    rz: 76,
    rise: 26,
    color: '#d0ab70',
    landmark: 'The Teapot Observatory'
  }, {
    id: 'frost',
    name: 'Cloudrest',
    biome: 'Alpine highlands',
    x: 225,
    z: 65,
    rx: 81,
    rz: 88,
    rise: 42,
    color: '#b1ccd0',
    landmark: 'The Quiet Bell'
  }, {
    id: 'cinder',
    name: 'Prism Crown',
    biome: 'Volcanic crystal',
    x: 15,
    z: 260,
    rx: 82,
    rz: 75,
    rise: 32,
    color: '#9277a6',
    landmark: 'The Moon Moth Archive'
  }];
  const islets = [{
    x: -310,
    z: 5,
    r: 20
  }, {
    x: 35,
    z: -40,
    r: 24
  }, {
    x: 300,
    z: -230,
    r: 19
  }, {
    x: -115,
    z: 280,
    r: 17
  }];
  const lore = ['A shell large enough to hear tomorrow. Inside: the sound of somebody making tea. The first tidekeeper clearly had priorities.', 'A brass mailbox addressed to “Whoever gets here eventually”. The letter reads: A home is an expedition that learned to stay.', 'The astronomer charted every star, then discovered that the instrument was a very expensive teapot. It still points north.', 'This bell rings only for falling snow. Its inscription says: Quiet is a kind of treasure. Your journal preserves its tiny melody.', 'These moths navigate by a moon nobody else can see. A final note: Build something worth coming home to. The archipelago is yours.'];
  const ids = Object.fromEntries(blocks.map(b => [b.key, b.id]));
  return {
    C,
    items,
    blocks,
    recipes,
    islands,
    islets,
    lore,
    ids
  };
});
