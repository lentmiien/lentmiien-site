// Restricted definitions are delivered only after current scene authorization.
const entity = (id, name, x, y, asset, panel) => ({ id, name, x, y, asset, panel, facing: 'down',
  ground: { type: 'rect', dx: 0, dy: 0, left: -1, right: 1, top: -1, bottom: 0 },
  visual: { width: asset === 'bookshelf' ? 3.4 : 2.8, anchor: 'south' } });
const base = { width: 12, height: 10, spawn: { x: 6, y: 7, facing: 'up' },
  bounds: { left: 1.3, right: 10.7, top: 3, bottom: 9 } };
const exit = { id: 'exit', name: 'Return to the village', x: 6, y: 9, kind: 'exit' };
const scenes = {
  hall: { ...base, id: 'hall', name: 'Lantern Hall', publicExit: { scene: 'village', x: 32, y: 17.6, facing: 'down' },
    entities: [entity('commons-books', 'Village chronicle', 3, 4, 'bookshelf', 'diagnostics'),
      entity('site-books', 'Site almanac', 9, 4, 'bookshelf', 'statistics'), exit] },
  shelter: { ...base, id: 'shelter', name: 'The Shelter', publicExit: { scene: 'village', x: 44, y: 19.6, facing: 'down' },
    entities: [entity('water-stock', 'Water reserves', 3, 4, 'water', 'stock'),
      entity('food-stock', 'Food reserves', 9, 4, 'food', 'stock'),
      { ...entity('equipment-stock', 'Equipment & readiness', 3, 7.8, 'equipment', 'stock'), label: 'Equipment' }, exit] },
};
module.exports = { scenes };
