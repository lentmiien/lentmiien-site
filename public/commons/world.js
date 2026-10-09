/* Public geometry and transforms only. Shared by the authoritative simulation and renderer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CommonsWorld = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const CLIENT_REVISION = '1.2.0';
  const WIDTH = 64;
  const HEIGHT = 48;
  const SPAWN = { x: 32, y: 25, facing: 'down', scene: 'village' };
  const diaryEntity = { id: 'diary', name: 'Your private diary', kind: 'diary', panel: 'diary', asset: 'desk',
    x: 9.6, y: 2.7, interaction: { x: 8, y: 5, radius: 2.5 },
    visual: { width: .55, height: .35, anchor: 'center' }, label: 'Your diary' };
  const homes = Array.from({ length: 12 }, (_, plot) => ({
    id: `home-${plot}`, name: `Cottage ${plot + 1}`, kind: 'home', sprite: 1,
    x: 7 + (plot % 6) * 10, y: plot < 6 ? 7 : 41, plot,
  }));
  const locations = [
    { id: 'hall', name: 'Lantern Hall', kind: 'portal', sprite: 0, x: 32, y: 16 },
    { id: 'chat', name: 'The Conversation House', kind: 'portal', sprite: 2, x: 21, y: 18 },
    { id: 'shelter', name: 'The Shelter', kind: 'sealed', sprite: 3, x: 44, y: 18 },
    { id: 'gallery', name: 'Amber Gallery', kind: 'gallery', sprite: 4, x: 21, y: 31 },
    { id: 'workshop', name: 'Willow Workshop', kind: 'craft', sprite: 5, x: 44, y: 31 },
    { id: 'keeper', name: 'Mori · lantern keeper', kind: 'npc', sprite: 7, x: 33, y: 23 },
    ...[0, 1, 2].map(i => ({ id: `garden-${i}`, name: ['Sage bed', 'Marigold bed', 'Moonflower bed'][i], kind: 'garden', x: [27, 29.7, 35][i], y: 35 })),
    ...[0, 1, 2].map(i => ({ id: `stone-${i}`, name: ['The Listening Stone', 'The Rain Stone', 'The Starlight Stone'][i], kind: 'discovery', x: 7 + i * 3, y: 21 + i * 6 })),
    { id: 'quests', name: 'Quest board', kind: 'board', x: 30, y: 22, asset: 'noticeboard',
      ground: { type: 'rect', dx: 0, dy: 0, left: -.9, right: .9, top: -.45, bottom: .1 },
      visual: { width: 2.5, height: 2.7, anchor: 'south' }, panel: 'quests' },
    ...homes,
  ];
  const trees = [];
  for (let i = 0; i < 110; i++) {
    const x = 2 + ((i * 17 + 11) % 60);
    const y = 2 + ((i * 23 + 7) % 44);
    if ((x < 15 || x > 51 || y < 4 || y > 44) && !locations.some(l => Math.hypot(l.x - x, l.y - y) < 4)) trees.push({ x, y });
  }
  trees.push(...[[25, 16], [39, 17], [17, 23], [48, 25], [26, 30], [39, 30], [17, 36], [48, 37], [26, 38], [39, 38], [17, 12], [46, 12]].map(([x, y]) => ({ x, y })));
  // Clear through-roads and the pond rim without removing any trees.
  const treeMoves = { '13,9': [13,6.5], '12,10': [12,12], '54,44': [56,45.5],
    '58,32': [60,32], '6,36': [4.5,34], '57,17': [60,17], '48,25': [49,22],
    '52,30': [50,27.5], '53,29': [54,28.5], '55,31': [55,33], '26,38': [24.5,37.8] };
  trees.forEach(tree => { const move = treeMoves[`${tree.x},${tree.y}`]; if (move) [tree.x, tree.y] = move; });
  const scenery = [
    { sprite: 0, x: 32, y: 27.8, width: 112, ground: { type: 'ellipse', dx: .15, dy: -1.32, rx: 1.55, ry: 1.18 } },
    { sprite: 4, x: 51, y: 33, width: 165, ground: { type: 'ellipse', dx: .35, dy: -2.05, rx: 2.58, ry: 1.70 } },
    ...[[28, 22], [36, 22], [28, 28], [37, 28.5]].map(([x, y]) => ({ sprite: 1, x, y, width: 68, radius: .6 })),
    ...[[26, 23.5], [38, 23.5], [29, 38], [36, 38]].map(([x, y]) => ({ sprite: 2, x, y, width: 65, ground: { type: 'ellipse', dx: .12, dy: -.38, rx: .92, ry: .32 } })),
    ...[[29, 18.8], [38, 18.7], [18, 26.5], [47, 26.5], [28, 34.7], [37, 34.7]].map(([x, y]) => ({ sprite: 3, x, y, width: 74, radius: .3 })),
    ...[[18, 21.6], [24, 21.6], [41, 21.6], [47, 21.6], [18, 34.7], [24, 34.7], [41, 34.7], [47, 34.7]].map(([x, y]) => ({ sprite: 7, x, y, width: 40, radius: .3 })),
  ];
  // Integer source windows retain full silhouettes, including overflow and soft shadows.
  // Destination offsets remain relative to the original 443.5px cell: never stretch a trim.
  const art = {
    cell: 443.5,
    furnishings: {
      noticeboard: { source: [0, 0, 512, 550], width: 2.5 },
      bookshelf: { source: [512, 0, 512, 550], width: 3.4 },
      desk: { source: [1024, 0, 512, 550], width: 3 },
      water: { source: [0, 550, 512, 474], width: 2.8 },
      food: { source: [512, 550, 512, 474], width: 2.8 },
      equipment: { source: [1024, 550, 512, 474], width: 2.8 },
    },
    village: [[8,0,459,443], [480,60,410,383], [896,60,429,385], [1330,60,440,378],
      [8,460,442,405], [454,460,432,403], [888,446,453,423], [1385,490,265,383]],
    scenery: [[16,20,444,424], [465,16,435,423], [924,88,438,349], [1458,4,245,452],
      [8,449,484,417], [494,443,395,429], [912,478,444,370], [1394,459,360,393]],
    avatarContact: { x: 1546, y: 838 },
  };
  // Widths are world units. Through-roads bend around foundations and the fountain;
  // short destination paths still end at doors. Plaza inlays are decoration, not roads.
  const roads = [
    { points: [[7,9],[57,9],[57,36],[60.5,37],[60.5,43],[3.5,43],[3.5,37],[7,36],[7,9]], width: 52 / 32 },
    { points: [[32,9],[36,11],[36,18.5],[32,20],[32,23.5],[34.8,25],[34.8,28],[32,30],[32,43]], width: 66 / 32 },
    { points: [[7,25],[28,25],[30,24],[34,24],[36,25],[57,25]], width: 61 / 32 },
    { points: [[21,20],[21,27],[18,28],[18,32],[21,33],[41,33],[47,33],[47,28],[44,27],[44,20]], width: 48 / 32 },
    { points: [[21,20],[44,20]], width: 46 / 32 },
    { points: [[7,21],[10,27],[13,33],[21,33]], width: 38 / 32 },
    { points: [[32,16.8],[32,20]], width: 40 / 32, approach: true },
    ...homes.map(h => ({ points: [[h.x,h.y + 1],[h.x,h.y < 10 ? 9 : 43]], width: 40 / 32, approach: true })),
  ];
  function groundShape(item) {
    if (item.ground) return { ...item.ground, x: item.x + item.ground.dx, y: item.y + item.ground.dy };
    if (item.sprite < 6 && item.kind) return { type: 'rect', x: item.x, y: item.y,
      left: item.id === 'hall' ? -2.65 : -2.2, right: item.id === 'hall' ? 2.85 : 2.2,
      top: item.id === 'hall' ? -2.8 : -2.4, bottom: item.id === 'hall' ? .1 : .35 };
    return { type: 'ellipse', x: item.x, y: item.y, rx: item.radius || .55, ry: item.radius || .55 };
  }
  function contains(shape, x, y) {
    if (shape.type === 'rect') return x > shape.x + shape.left && x < shape.x + shape.right
      && y > shape.y + shape.top && y < shape.y + shape.bottom;
    return ((x - shape.x) / shape.rx) ** 2 + ((y - shape.y) / shape.ry) ** 2 < 1;
  }
  const obstacles = [...locations.filter(l => l.sprite < 6 || l.kind === 'board'), ...scenery, ...trees].map(groundShape);
  function depth(item) { return item.ground ? item.y + item.ground.dy : item.y; }
  function walkable(x, y, scene = 'village', definition) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (definition?.bounds) {
      const b = definition.bounds;
      return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom
        && !definition.entities.filter(e => e.ground).some(e => contains(groundShape(e), x, y));
    }
    if (scene === 'home') return x >= 1.3 && x <= 10.7 && y >= 3 && y <= 9
      && !(x < 3.2 && y < 6.3) && !(x > 8.5 && y < 4.8);
    if (scene !== 'village' || x < 1 || y < 1 || x > WIDTH - 1 || y > HEIGHT - 1) return false;
    return !obstacles.some(shape => contains(shape, x, y));
  }
  // Nearest clear quarter-unit sample within four units, relative to the saved point.
  // Stable distance/y/x ordering makes repairs deterministic; never touch valid transforms.
  const repairOffsets = [];
  for (let dy = -16; dy <= 16; dy++) for (let dx = -16; dx <= 16; dx++) {
    if (dx * dx + dy * dy <= 256) repairOffsets.push({ dx: dx / 4, dy: dy / 4, distance: dx * dx + dy * dy });
  }
  repairOffsets.sort((a, b) => a.distance - b.distance || a.dy - b.dy || a.dx - b.dx);
  function repairPosition(player, definition) {
    if (walkable(player.x, player.y, player.scene, definition)) return null;
    if (player.scene === 'village') {
      for (const { dx, dy } of repairOffsets) {
        if (walkable(player.x + dx, player.y + dy)) return { x: player.x + dx, y: player.y + dy };
      }
    }
    return { x: SPAWN.x, y: SPAWN.y, scene: SPAWN.scene };
  }
  function move(player, input, dt, now, definition) {
    if (!input || now - input.at > 300) return;
    let { x, y } = input;
    const length = Math.hypot(x, y);
    if (!length) return;
    x /= length; y /= length;
    const step = Math.min(Math.max(dt, 0), 0.1) * 4;
    if (walkable(player.x + x * step, player.y, player.scene, definition)) player.x += x * step;
    if (walkable(player.x, player.y + y * step, player.scene, definition)) player.y += y * step;
    player.facing = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  }
  function nearby(player) {
    if (player.sceneDefinition) return player.sceneDefinition.entities.filter(e => Math.hypot(player.x - e.x, player.y - e.y) <= 2.5);
    if (player.scene === 'home') {
      const { x, y, radius } = diaryEntity.interaction;
      return [{ id: 'exit', name: 'Return to the village', kind: 'exit' },
        { id: 'decorate', name: 'Arrange your lantern', kind: 'decorate' },
        ...(Math.hypot(player.x - x, player.y - y) <= radius ? [diaryEntity] : [])];
    }
    return locations.filter(l => Math.hypot(player.x - l.x, player.y - (l.y + (l.sprite < 6 ? 1.2 : 0))) <= 2.5);
  }
  function clock(now) {
    const local = new Date(now + 9 * 3600000);
    const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
    const daylight = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
    return { hour, darkness: 0.40 * (1 - daylight), phase: hour < 6 || hour >= 19 ? 'Night' : hour < 9 ? 'Morning' : hour < 17 ? 'Daylight' : 'Dusk',
      day: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16), zone: 'Asia/Tokyo' };
  }
  return { VERSION, CLIENT_REVISION, WIDTH, HEIGHT, SPAWN, diaryEntity, homes, locations, trees, scenery, art, roads,
    groundShape, contains, obstacles, depth, repairPosition, walkable, move, nearby, clock };
}));
