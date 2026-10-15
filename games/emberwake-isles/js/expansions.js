/* Append-only content packs. Never move a released island or reuse a voxel ID. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object') module.exports = api; else root.EWExpansions = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  return [{
    id: 'outer-gardens', firstBlock: 63,
    islands: [
      { id: 'reed', name: 'Reedglass Haven', biome: 'Bamboo & limestone', x: -665, z: -100, rx: 94, rz: 86, rise: 29, color: '#80b7a0', landmark: 'The Sleeping Wind Organ', surface: 'limestone', ore: 'jadeOre', plant: 'bamboo', caveName: 'The Green Resonance', lore: 'Someone taught the wind three notes, then left before hearing the song. Rebuild the organ and give the breeze another chance.' },
      { id: 'amber', name: 'Honeycomb Isle', biome: 'Amber badlands', x: 660, z: 220, rx: 92, rz: 83, rise: 31, color: '#cf9960', landmark: 'The Patient Apiary', surface: 'ochre', ore: 'amberOre', enemies: true, caveName: 'The Fossil Ballroom', lore: 'These tiny pebble mites mistook the empty apiary for a palace. They are terrible guards, but excellent company. A plaque reads: Please knock gently.' }
    ],
    blocks: [
      ['bamboo', 'Bamboo stem', '#9eae59', { hardness: .3, shape: 'bamboo' }],
      ['limestone', 'Pale limestone', '#d7dac0', { tier: 1, hardness: .7 }],
      ['jadeOre', 'Jade seam', '#4eae96', { tier: 2, hardness: 1.1, drop: 'jade' }],
      ['ochre', 'Ochre stone', '#c49763', { tier: 1, hardness: .7 }],
      ['amberOre', 'Amber seam', '#e4a647', { tier: 1, hardness: .9, drop: 'amber' }],
      ['bambooPlank', 'Bamboo boards', '#b7ba7b', {}],
      ['bambooScreen', 'Bamboo screen', '#8eaa72', { shape: 'fence' }],
      ['limestoneBrick', 'Limestone brick', '#dfe0cd', {}],
      ['jadeTile', 'Jade mosaic', '#61b39f', {}],
      ['amberGlass', 'Amber lattice', '#efbe69', { shape: 'glass' }],
      ['ochreBrick', 'Ochre brick', '#b97e54', {}],
      ['bambooStair', 'Bamboo stair', '#c2bc87', { shape: 'stair' }],
      ['jadeSlab', 'Jade stepping slab', '#84c5ac', { shape: 'slab' }],
      ['paperLamp', 'Paper garden lantern', '#eee4ad', { category: 'light', quality: 5, shape: 'lantern' }],
      ['reedChair', 'Woven garden chair', '#a1a56c', { category: 'social', quality: 4, shape: 'chair' }],
      ['teaTable', 'Jade tea table', '#83b8a4', { category: 'social', quality: 6, shape: 'table' }],
      ['jadeBath', 'Jade soaking pool', '#77bba7', { category: 'water', quality: 9, shape: 'bath' }],
      ['amberLamp', 'Fossil lantern', '#eab45c', { category: 'light', quality: 8, shape: 'lantern' }],
      ['reedOrgan', 'Wind reed organ', '#b5b17b', { category: 'music', quality: 9, shape: 'organ' }],
      ['amberCrown', 'Apiary sculpture', '#e5b568', { category: 'art', quality: 10, shape: 'sculpture' }],
      ['bambooPlanter', 'Bamboo nursery', '#91ac68', { category: 'garden', quality: 5, shape: 'planter' }],
      ['fossilDisplay', 'Fossil cabinet', '#b89067', { category: 'knowledge', quality: 8, shape: 'shelf' }]
    ],
    items: [
      ['jade', 'River jade', '#59b99e', {}], ['amber', 'Honey amber', '#e5b052', {}],
      ['fossil', 'Spiral fossil', '#d9ca94', {}], ['paper', 'Bamboo paper', '#e8e6bf', {}],
      ['bambooStaff', 'Bamboo walking staff', '#b9b478', { weapon: 3 }],
      ['copperSabre', 'Copper practice sabre', '#d5a075', { weapon: 4 }],
      ['bambooShoot', 'Tender bamboo shoot', '#b8d68a', { food: 24 }],
      ['shootSoup', 'Garden shoot soup', '#a8c378', { food: 65, buff: 240 }],
      ['honeyTea', 'Amber-isle tea', '#e3c17c', { food: 40, buff: 300 }]
    ],
    recipes: [
      ['bambooPlank', 4, { bamboo: 2 }], ['bambooScreen', 4, { bamboo: 4, rope: 1 }, 'bench'],
      ['limestoneBrick', 4, { limestone: 4 }, 'bench'], ['ochreBrick', 4, { ochre: 4 }, 'bench'],
      ['paper', 3, { bamboo: 3, fiber: 1 }, 'loom'],
      ['jadeTile', 6, { limestone: 4, jade: 1 }, 'artisans', 'reed'],
      ['amberGlass', 4, { glass: 4, amber: 1 }, 'kiln', 'amber'],
      ['bambooStair', 4, { bambooPlank: 3 }, 'bench'], ['jadeSlab', 6, { jadeTile: 3 }, 'bench'],
      ['paperLamp', 2, { paper: 3, bamboo: 2, resin: 1 }, 'bench', 'reed'],
      ['reedChair', 2, { bamboo: 4, rope: 2 }, 'bench'],
      ['teaTable', 1, { bambooPlank: 4, jade: 2 }, 'artisans', 'reed'],
      ['jadeBath', 1, { limestoneBrick: 6, jade: 4, copper: 2 }, 'artisans', 'reed'],
      ['amberLamp', 1, { amber: 3, glass: 2, copper: 1 }, 'artisans', 'amber'],
      ['reedOrgan', 1, { bamboo: 8, paper: 3, jade: 2 }, 'artisans', 'reed'],
      ['amberCrown', 1, { amber: 4, fossil: 2, jade: 1 }, 'artisans', 'amber'],
      ['bambooPlanter', 1, { bamboo: 4, dirt: 2, seed: 1 }, 'bench', 'reed'],
      ['fossilDisplay', 1, { bambooPlank: 4, glass: 2, fossil: 2 }, 'artisans', 'amber'],
      ['bambooStaff', 1, { bamboo: 3, rope: 1 }, null, null, 'Equipment'],
      ['copperSabre', 1, { copper: 3, plank: 1 }, 'bench', null, 'Equipment'],
      ['shootSoup', 1, { bambooShoot: 2, carrot: 1 }, 'galley'],
      ['honeyTea', 1, { berry: 2, bambooShoot: 1 }, 'campfire', 'amber']
    ],
    projects: {
      reed: [
        { name: 'Repair the wind pipes', cost: { bamboo: 8, rope: 2 }, reward: { jade: 2 } },
        { name: 'Tune the jade reeds', cost: { jade: 4, paper: 3 }, reward: { pearl: 3 }, unlock: 'reedOrgan' }
      ],
      amber: [
        { name: 'Study three pebble mites', cost: { ochre: 6 }, defeats: 3, reward: { fossil: 2 } },
        { name: 'Restore the patient apiary', cost: { amber: 6, bambooPlank: 4 }, reward: { pearl: 3 }, unlock: 'amberCrown' }
      ]
    }
  }];
});
