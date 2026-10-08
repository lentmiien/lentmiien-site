/* Public geometry and transforms only. Shared by the authoritative simulation and renderer. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CommonsWorld = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const WIDTH = 64;
  const HEIGHT = 48;
  const SPAWN = { x: 32, y: 25, facing: 'down', scene: 'village' };
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
    ...[0, 1, 2].map(i => ({ id: `garden-${i}`, name: ['Sage bed', 'Marigold bed', 'Moonflower bed'][i], kind: 'garden', x: 29 + i * 3, y: 33 })),
    ...[0, 1, 2].map(i => ({ id: `stone-${i}`, name: ['The Listening Stone', 'The Rain Stone', 'The Starlight Stone'][i], kind: 'discovery', x: 7 + i * 3, y: 21 + i * 6 })),
    ...homes,
  ];
  const trees = [];
  for (let i = 0; i < 110; i++) {
    const x = 2 + ((i * 17 + 11) % 60);
    const y = 2 + ((i * 23 + 7) % 44);
    if ((x < 15 || x > 51 || y < 4 || y > 44) && !locations.some(l => Math.hypot(l.x - x, l.y - y) < 4)) trees.push({ x, y });
  }
  trees.push(...[[25, 16], [39, 17], [17, 23], [48, 25], [26, 30], [39, 30], [17, 36], [48, 37], [26, 38], [39, 38], [17, 12], [46, 12]].map(([x, y]) => ({ x, y })));
  const scenery = [
    { sprite: 0, x: 32, y: 27.8, width: 112, radius: 1.1 },
    { sprite: 4, x: 51, y: 33, width: 165, radius: 1.6 },
    ...[[28, 22], [36, 22], [28, 28], [36, 28]].map(([x, y]) => ({ sprite: 1, x, y, width: 68, radius: .6 })),
    ...[[27, 25], [37, 25], [30, 36], [36, 36]].map(([x, y]) => ({ sprite: 2, x, y, width: 65, radius: .6 })),
    ...[[29, 20], [35, 20], [19, 26], [46, 26], [28, 34.7], [37, 34.7]].map(([x, y]) => ({ sprite: 3, x, y, width: 74, radius: .3 })),
    ...[[18, 20], [24, 20], [41, 20], [47, 20], [18, 33], [24, 33], [41, 33], [47, 33]].map(([x, y]) => ({ sprite: 7, x, y, width: 40, radius: .3 })),
  ];
  function walkable(x, y, scene = 'village') {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (scene === 'home') return x >= 1.3 && x <= 10.7 && y >= 3 && y <= 9
      && !(x < 3.2 && y < 6.3) && !(x > 8.5 && y < 4.8);
    if (scene !== 'village' || x < 1 || y < 1 || x > WIDTH - 1 || y > HEIGHT - 1) return false;
    if (locations.some(l => l.sprite < 6 && Math.abs(x - l.x) < 2.2 && y > l.y - 2.4 && y < l.y + 0.35)) return false;
    if (scenery.some(s => Math.hypot(x - s.x, y - s.y) < s.radius)) return false;
    return !trees.some(t => Math.hypot(x - t.x, y - t.y) < 0.55);
  }
  function move(player, input, dt, now) {
    if (!input || now - input.at > 300) return;
    let { x, y } = input;
    const length = Math.hypot(x, y);
    if (!length) return;
    x /= length; y /= length;
    const step = Math.min(Math.max(dt, 0), 0.1) * 4;
    if (walkable(player.x + x * step, player.y, player.scene)) player.x += x * step;
    if (walkable(player.x, player.y + y * step, player.scene)) player.y += y * step;
    player.facing = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : (y > 0 ? 'down' : 'up');
  }
  function nearby(player) {
    if (player.scene === 'home') return [{ id: 'exit', name: 'Return to the village', kind: 'exit' }, { id: 'decorate', name: 'Arrange your lantern', kind: 'decorate' }];
    return locations.filter(l => Math.hypot(player.x - l.x, player.y - (l.y + (l.sprite < 6 ? 1.2 : 0))) <= 2.5);
  }
  function clock(now) {
    const local = new Date(now + 9 * 3600000);
    const hour = local.getUTCHours() + local.getUTCMinutes() / 60;
    const daylight = Math.max(0, Math.sin((hour - 6) / 12 * Math.PI));
    return { hour, darkness: 0.40 * (1 - daylight), phase: hour < 6 || hour >= 19 ? 'Night' : hour < 9 ? 'Morning' : hour < 17 ? 'Daylight' : 'Dusk',
      day: local.toISOString().slice(0, 10), time: local.toISOString().slice(11, 16), zone: 'Asia/Tokyo' };
  }
  return { VERSION, WIDTH, HEIGHT, SPAWN, homes, locations, trees, scenery, walkable, move, nearby, clock };
}));
