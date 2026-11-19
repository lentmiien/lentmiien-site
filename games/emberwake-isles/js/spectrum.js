/* Released catalog entries are positional. Append new packs after this one. */
(function (root, factory) {
  const pack = factory();
  if (typeof module === 'object') module.exports = pack; else root.EWSpectrum = pack;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const pack = { id: 'spectrum', firstBlock: 85, islands: [], blocks: [], items: [], recipes: [] };
  const regions = [
    {
      id: 'poppy', name: 'Poppy Escarpment', x: -1200, z: -210, rise: 32,
      strata: 'ribbons', biome: 'Crimson ribbons', landmark: 'The Vermilion Gate', caveName: 'Rouge Gallery',
      lore: 'Five red chalk marks count the sunsets a mason spent carving this arch. The sixth is a tiny drawing of her lunch.',
      colors: [['Claret','#962246'],['Scarlet','#ef374b'],['Tangerine','#ff782c'],['Coral','#ff8972'],['Blush','#ffd0c6']],
      mineral: 'Madder', creature: 'Rouge crab', form: 'claws', speed: 1.05
    },
    {
      id: 'sundial', name: 'Sundial Mesa', x: -260, z: -1190, rise: 28,
      strata: 'terraces', biome: 'Golden terraces', landmark: 'The Noon Dial', caveName: 'Hall of Saffron',
      lore: 'The dial has a mark for every hour except lunch, which its maker considered too precious to measure.',
      colors: [['Ochre gold','#c78922'],['Sunflower','#ffda30'],['Apricot','#ffae4b'],['Lemon','#fff175'],['Buttercream','#fff1bd']],
      mineral: 'Orpiment glass', creature: 'Marigold hopper', form: 'ears', speed: 1.55
    },
    {
      id: 'fern', name: 'Fernwheel Key', x: 1175, z: 320, rise: 25,
      strata: 'rings', biome: 'Jade rings', landmark: 'The Leaf Eye', caveName: 'Malachite Hollow',
      lore: 'The stone leaves curl toward the sea. On still mornings, even the shy little beetles line up to watch.',
      colors: [['Pine','#196445'],['Emerald','#19b560'],['Lime','#9bda4c'],['Lagoon','#1ab5ac'],['Mint','#a7efb6']],
      mineral: 'Verdite', creature: 'Leaf beetle', form: 'leaf', speed: .95
    },
    {
      id: 'iris', name: 'Iris Sound', x: 240, z: 1190, rise: 35,
      strata: 'folds', biome: 'Blue and violet folds', landmark: 'The Evening Window', caveName: 'Ultramarine Vault',
      lore: 'Look through the window at dusk. Its sculptor left just enough sky for the final stripe.',
      colors: [['Cobalt','#2868e0'],['Indigo','#5142b0'],['Violet','#9b49d7'],['Sky','#61bded'],['Lilac','#d8a4ed']],
      mineral: 'Iolite', creature: 'Iris moth', form: 'wings', speed: 1.25
    }
  ];
  for (const r of regions) {
    const shades = r.colors.map((_, n) => r.id + 'Stone' + n);
    const [dark, bright, warm] = shades;
    const dye = r.id + 'Pigment', seam = r.id + 'Seam';
    pack.islands.push({ ...r, rx: 98, rz: 83, color: r.colors[1][1], shades, ore: seam, surface: bright, enemies: true,
      species: { name: r.creature, form: r.form, speed: r.speed, colors: [r.colors[0][1], r.colors[2][1]], loot: { [dye]: 2 } } });
    r.colors.forEach(([name, hex], n) => pack.blocks.push([shades[n], name + ' stone', hex, { hardness: .36 }]));
    pack.items.push([dye, r.mineral + ' pigment', r.colors[1][1], {}]);
    pack.blocks.push([seam, r.mineral + ' seam', r.colors[0][1], { tier: 1, hardness: .8, drop: dye }]);
    for (const [suffix, title, shape, cost, count] of [
      ['Brick', 'inlaid brick', null, { [dark]: 2, [bright]: 2, [dye]: 1 }, 6],
      ['Slab', 'studio slab', 'slab', { [bright]: 3, [dye]: 1 }, 6],
      ['Stair', 'gallery steps', 'stair', { [warm]: 3, [dye]: 1 }, 4],
      ['Lamp', 'gallery lantern', 'lantern', { glass: 2, [dye]: 2, torch: 1 }, 2]
    ]) {
      const key = r.id + suffix;
      pack.blocks.push([key, r.colors[1][0] + ' ' + title, r.colors[1][1], suffix === 'Lamp' ? { shape, category: 'light', lightColor: r.colors[2][1], quality: 5 } : { shape }]);
      pack.recipes.push([key, count, cost, 'bench', r.id]);
    }
  }
  pack.blocks.push(['spectrumTile', 'Seven-stripe mosaic', '#ffbf58', {}]);
  pack.recipes.push(['spectrumTile', 8, { poppyPigment: 1, sundialPigment: 1, fernPigment: 1, irisPigment: 1, clay: 4 }, 'kiln']);
  return pack;
});
