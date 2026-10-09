const W = require('../../../public/commons/world');
const fs = require('fs');
const vm = require('vm');
const sharp = require('sharp');

test('v1.1 keeps the persistence contract, content counts and movement model', () => {
  expect(W.VERSION).toBe(1);
  expect(W.locations).toHaveLength(24); expect(W.homes).toHaveLength(12); expect(W.trees).toHaveLength(45);
  expect(W.scenery).toHaveLength(24);
  const cardinal = { ...W.SPAWN }, diagonal = { ...W.SPAWN };
  W.move(cardinal, { x: 1, y: 0, at: 0 }, .1, 0);
  W.move(diagonal, { x: 1, y: -1, at: 0 }, .1, 0);
  expect(Math.hypot(cardinal.x - 32, cardinal.y - 25)).toBeCloseTo(.4);
  expect(Math.hypot(diagonal.x - 32, diagonal.y - 25)).toBeCloseTo(.4);
});

test.each([0, 1])('water feature %i blocks its ground ellipse from cardinal and diagonal approaches', index => {
  const item = W.scenery[index], shape = W.groundShape(item);
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    const at = factor => ({ x: shape.x + Math.cos(angle) * shape.rx * factor, y: shape.y + Math.sin(angle) * shape.ry * factor, scene: 'village' });
    expect(W.walkable(at(.98).x, at(.98).y)).toBe(false);
    expect(W.walkable(at(1.04).x, at(1.04).y)).toBe(true);
    const player = at(1.3), input = { x: -Math.cos(angle), y: -Math.sin(angle), at: 0 };
    for (let i = 0; i < 30; i++) { W.move(player, input, .05, 0); expect(W.walkable(player.x, player.y)).toBe(true); }
    expect(W.contains(shape, player.x, player.y)).toBe(false);
  }
});

test('water no longer admits its north basin or blocks empty southern grass; Hall covers its foundation', () => {
  for (const [x, y] of [[51, 30], [51, 31], [32, 26], [32, 26.6], [29.6, 15], [32, 13.5]]) expect(W.walkable(x, y)).toBe(false);
  for (const [x, y] of [[51, 34], [32, 28.7], [32, 17.2]]) expect(W.walkable(x, y)).toBe(true);
  const hall = W.groundShape(W.locations[0]);
  for (const [x, y] of [[hall.left, hall.top], [hall.right, hall.top], [hall.left, hall.bottom], [hall.right, hall.bottom]]) {
    expect(W.contains(hall, hall.x + x * .99, hall.y + y * .99)).toBe(true);
    expect(W.contains(hall, hall.x + x * 1.01, hall.y + y * 1.01)).toBe(false);
  }
  // Raised roofs/canopies/pillar are not opaque-pixel collision masks.
  expect(W.walkable(32, 12)).toBe(true);
  expect(W.walkable(32, 24.9)).toBe(true);
});

test('every through-road has a clear width and its centerline can actually be walked', () => {
  for (const road of W.roads.filter(r => !r.approach)) {
    for (let i = 1; i < road.points.length; i++) {
      const a = road.points[i - 1], b = road.points[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
      for (const tree of W.trees) {
        const t = Math.max(0, Math.min(1, ((tree.x - a[0]) * dx + (tree.y - a[1]) * dy) / (length * length)));
        expect(Math.hypot(tree.x - a[0] - t * dx, tree.y - a[1] - t * dy)).toBeGreaterThanOrEqual(road.width / 2 + .55);
      }
      const steps = Math.ceil(length * 16);
      for (let n = 0; n <= steps; n++) for (const edge of [-.5, 0, .5]) {
        const x = a[0] + dx * n / steps - dy / length * road.width * edge;
        const y = a[1] + dy * n / steps + dx / length * road.width * edge;
        expect({ x, y, clear: W.walkable(x, y) }).toMatchObject({ clear: true });
      }
      const player = { x: a[0], y: a[1], scene: 'village' };
      for (let n = 0; n < steps; n++) W.move(player, { x: dx, y: dy, at: 0 }, length / steps / 4, 0);
      expect(player.x).toBeCloseTo(b[0]); expect(player.y).toBeCloseTo(b[1]);
    }
  }
});

test('all sampled walkable space, 24 interactions and 12 cottage exits connect to spawn', () => {
  const scale = 4, width = W.WIDTH * scale, height = W.HEIGHT * scale;
  const clear = new Uint8Array(width * height), reached = new Uint8Array(clear.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) clear[y * width + x] = W.walkable(x / scale, y / scale);
  const start = W.SPAWN.y * scale * width + W.SPAWN.x * scale, queue = [start]; reached[start] = 1;
  const interactions = new Set();
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i], x = p % width, y = Math.floor(p / width);
    W.nearby({ x: x / scale, y: y / scale }).forEach(l => interactions.add(l.id));
    for (const next of [p - 1, p + 1, p - width, p + width]) {
      if (next >= 0 && next < clear.length && clear[next] && !reached[next]) { reached[next] = 1; queue.push(next); }
    }
  }
  expect(reached.reduce((a, b) => a + b, 0)).toBe(clear.reduce((a, b) => a + b, 0));
  expect([...interactions].sort()).toEqual(W.locations.map(l => l.id).sort());
  for (const home of W.homes) {
    const exit = { x: home.x, y: home.y + 1.6, scene: 'village' };
    expect(W.walkable(exit.x, exit.y)).toBe(true);
    expect(reached[Math.round(exit.y * scale) * width + exit.x * scale]).toBe(1);
    expect(W.nearby(exit)).toContainEqual(home);
  }
  // These remain traversable interactions, not newly solid objects.
  for (const l of W.locations.filter(l => ['garden', 'discovery'].includes(l.kind))) expect(W.walkable(l.x, l.y)).toBe(true);
});

test('saved outdoor repair is deterministic, local, bounded and preserves valid positions', () => {
  for (const p of [{ x: 51, y: 30 }, { x: 32, y: 26 }, { x: 29.6, y: 15 }]) {
    const player = { ...p, scene: 'village', facing: 'left' }, old = { ...player };
    const repair = W.repairPosition(player);
    expect(repair).toEqual(W.repairPosition(player)); expect(player).toEqual(old);
    expect(W.walkable(repair.x, repair.y)).toBe(true);
    expect(Math.hypot(repair.x - p.x, repair.y - p.y)).toBeLessThanOrEqual(4);
    expect(repair).not.toHaveProperty('facing'); expect(repair).not.toHaveProperty('scene');
    const distance = Math.hypot(repair.x - p.x, repair.y - p.y);
    for (let dx = -16; dx <= 16; dx++) for (let dy = -16; dy <= 16; dy++) {
      if (Math.hypot(dx / 4, dy / 4) < distance - 1e-8) expect(W.walkable(p.x + dx / 4, p.y + dy / 4)).toBe(false);
    }
  }
  expect(W.repairPosition(W.SPAWN)).toBeNull();
  expect(W.repairPosition({ x: 6, y: 7, scene: 'home', facing: 'up' })).toBeNull();
  expect(W.repairPosition({ x: -100, y: -100, scene: 'village' })).toEqual({ x: 32, y: 25, scene: 'village' });
});

// Independent measured full-object extents, not nominal cells. Includes donors' overflow.
const bounds = {
  village: [[17,11,453,425],[494,81,862,424],[907,73,1307,423],[1338,71,1749,418],
    [24,478,434,838],[466,472,879,834],[898,451,1325,848],[1435,515,1630,845]],
  scenery: [[34,39,449,433],[477,46,885,427],[938,111,1349,409],[1479,15,1679,439],
    [29,463,480,849],[501,446,869,858],[924,497,1341,826],[1404,464,1737,840]],
};
test.each(['village', 'scenery'])('%s crops retain all main artwork and exclude neighboring main objects', async kind => {
  const { data, info } = await sharp(`public/commons/${kind}-atlas.v1.webp`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  expect([info.width, info.height]).toEqual([1774, 887]);
  W.art[kind].forEach(([x, y, width, height], i) => {
    const [left, top, right, bottom] = bounds[kind][i];
    expect(x).toBeLessThanOrEqual(left); expect(y).toBeLessThanOrEqual(top);
    expect(x + width).toBeGreaterThan(right); expect(y + height).toBeGreaterThan(bottom);
    // No alpha>=32 pixel of another measured object's extent may enter this crop.
    bounds[kind].forEach(([l, t, r, b], j) => {
      if (j === i) return;
      let pixels = 0;
      for (let sy = Math.max(y, t); sy <= Math.min(y + height - 1, b); sy++) {
        for (let sx = Math.max(x, l); sx <= Math.min(x + width - 1, r); sx++) if (data[(sy * info.width + sx) * 4 + 3] >= 32) pixels++;
      }
      expect(pixels).toBe(0);
    });
  });
});

test('renderer preserves source scale/offsets and anchors avatar soles at the logical point', () => {
  const context = { window: { CommonsWorld: W } };
  vm.runInNewContext(fs.readFileSync('public/commons/renderer.js', 'utf8'), context);
  const renderer = Object.create(context.window.CommonsRenderer.prototype);
  const drawImage = jest.fn(); renderer.ctx = { drawImage }; renderer.atlas = {}; renderer.sceneryAtlas = {};
  for (const kind of ['village', 'scenery']) for (let i = 0; i < 8; i++) {
    renderer.sprite(i, 500, 500, 100, 100, kind === 'village' ? renderer.atlas : renderer.sceneryAtlas);
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = drawImage.mock.calls.at(-1);
    expect(dw / sw).toBeCloseTo(100 / 443.5); expect(dh / sh).toBeCloseTo(100 / 443.5);
    expect(dx - sx * 100 / 443.5).toBeCloseTo(450 - i % 4 * 100);
    expect(dy - sy * 100 / 443.5).toBeCloseTo(400 - Math.floor(i / 4) * 100);
  }
  renderer.ctx = { beginPath() {}, ellipse() {}, fill() {}, stroke() {}, arc() {} };
  renderer.sprite = jest.fn(); renderer.label = jest.fn();
  renderer.person({ x: 20, y: 20, plot: 0, facing: 'down' }, 0, true);
  const [, x, y, width] = renderer.sprite.mock.calls[0];
  expect(x - width / 2 + (W.art.avatarContact.x - 3 * W.art.cell) * width / W.art.cell).toBeCloseTo(640);
  expect(y - width + (W.art.avatarContact.y - W.art.cell) * width / W.art.cell).toBeCloseTo(640);
  renderer.ctx.ellipse = jest.fn(); renderer.drawScale = .5;
  renderer.personLabel({ x: 20, y: 20, plot: 0 }, true);
  expect(renderer.ctx.ellipse).toHaveBeenCalledWith(640, 640, 17, 8, 0, 0, Math.PI * 2);
  expect(renderer.label).toHaveBeenCalledWith('You', 640, 688, true);
});

test('all changed client resources share one cache revision, independent of save schema and immutable art', () => {
  const page = fs.readFileSync('views/commons.pug', 'utf8');
  for (const name of ['world.js', 'renderer.js', 'client.js', 'style.css']) expect(page).toContain(`/commons/${name}?v=${W.CLIENT_REVISION}`);
  expect(fs.readFileSync('public/commons/client.js', 'utf8')).toContain('snapshot.clientRevision !== W.CLIENT_REVISION');
});
