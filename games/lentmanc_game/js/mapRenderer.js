'use strict';

(function exposeMapRenderer(root) {
  const BAKE_SIZE = 88;
  const MASK_SCALE = 18;
  const TAU = Math.PI * 2;

  function canvas(width, height) {
    const surface = document.createElement('canvas');
    surface.width = width;
    surface.height = height;
    return surface;
  }

  function noise(x, y, seed = 0) {
    let n = Math.imul(x + seed * 37, 374761393) + Math.imul(y + seed * 13, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }

  function glow(ctx, x, y, radius, color) {
    const light = ctx.createRadialGradient(x, y, 0, x, y, radius);
    light.addColorStop(0, color);
    light.addColorStop(1, 'transparent');
    ctx.fillStyle = light;
    ctx.fillRect(x - radius, y - radius, 2 * radius, 2 * radius);
  }

  function sprite(ctx, image, frame, x, feet, width, height, flip = false) {
    if (!image || !frame) return;
    ctx.save();
    ctx.translate(x, feet);
    if (flip) ctx.scale(-1, 1);
    ctx.drawImage(image, ...frame, -width / 2, -height, width, height);
    ctx.restore();
  }

  function textureBrush(ctx, art, terrain, name) {
    const [index, span, fallback] = art.materials[name];
    if (!terrain) return fallback;
    const size = art.swatchSize;
    const columns = terrain.naturalWidth / size;
    const swatch = canvas(size, size);
    const sourceX = (index % columns) * size;
    const sourceY = Math.floor(index / columns) * size;
    swatch.getContext('2d').drawImage(terrain, sourceX, sourceY, size, size, 0, 0, size, size);
    const pattern = ctx.createPattern(swatch, 'repeat');
    pattern.setTransform(new DOMMatrix().scale(span / size));
    return pattern;
  }

  // Interpolate membership at tile centers, then roughen the contour at a much
  // lower resolution than the artwork. Adjacent cells share a continuous surface.
  function terrainPainter(ctx, map, brush) {
    const cols = map.tiles[0].length;
    const rows = map.tiles.length;
    const grid = canvas(cols, rows).getContext('2d');
    const mask = canvas(cols * MASK_SCALE, rows * MASK_SCALE).getContext('2d', { willReadFrequently: true });
    const layer = canvas(ctx.canvas.width, ctx.canvas.height).getContext('2d');
    layer.scale(BAKE_SIZE, BAKE_SIZE);
    const jitter = new Int8Array(mask.canvas.width * mask.canvas.height);
    for (let i = 0; i < jitter.length; i += 1) {
      const x = i % mask.canvas.width;
      const y = Math.floor(i / mask.canvas.width);
      jitter[i] = 11 * Math.sin(x * 0.31 + Math.sin(y * 0.28)) + 9 * Math.sin(y * 0.56 + x * 0.21) + noise(x, y) * 10 - 5;
    }

    function paint(symbols, material, { edge = 127, softness = 5 } = {}) {
      grid.clearRect(0, 0, cols, rows);
      let present = false;
      map.tiles.forEach((row, y) => {
        for (let x = 0; x < cols; x += 1) {
          if (symbols.includes(row[x])) {
            grid.fillRect(x, y, 1, 1);
            present = true;
          }
        }
      });
      if (!present) return;
      mask.clearRect(0, 0, mask.canvas.width, mask.canvas.height);
      mask.drawImage(grid.canvas, 0, 0, mask.canvas.width, mask.canvas.height);
      composite(material, edge, softness);
    }

    function paintTrails(trails, material) {
      mask.clearRect(0, 0, mask.canvas.width, mask.canvas.height);
      mask.save();
      mask.scale(MASK_SCALE, MASK_SCALE);
      mask.lineJoin = 'round';
      mask.lineCap = 'round';
      for (const [width, points] of trails) {
        mask.beginPath();
        mask.moveTo(...points[0]);
        for (let i = 1; i < points.length - 1; i += 1) {
          const [x, y] = points[i];
          const [nx, ny] = points[i + 1];
          mask.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
        }
        mask.lineTo(...points[points.length - 1]);
        // A worn center gives way to grass over an irregular shoulder.
        for (const [shoulder, opacity] of [[0.44, 0.18], [0.25, 0.3], [0.08, 0.53], [-0.12, 1]]) {
          mask.globalAlpha = opacity;
          mask.lineWidth = width + shoulder;
          mask.stroke();
        }
      }
      mask.restore();
      composite(material, 108, 1.35);
    }

    function composite(material, edge, softness) {
      const pixels = mask.getImageData(0, 0, mask.canvas.width, mask.canvas.height);
      for (let i = 0; i < jitter.length; i += 1) {
        const alpha = i * 4 + 3;
        const value = pixels.data[alpha];
        if (value > 0 && value < 255) pixels.data[alpha] = 128 + (value - edge + jitter[i]) * softness;
      }
      mask.putImageData(pixels, 0, 0);
      layer.globalCompositeOperation = 'source-over';
      layer.fillStyle = material.startsWith('#') ? material : brush(material);
      layer.fillRect(0, 0, cols, rows);
      layer.globalCompositeOperation = 'destination-in';
      layer.drawImage(mask.canvas, 0, 0, cols, rows);
      ctx.drawImage(layer.canvas, 0, 0, cols, rows);
    }
    return { paint, paintTrails };
  }

  function streetWall(ctx, map, brush, x, y, symbol) {
    const at = (cx, cy) => map.tiles[cy]?.[cx];
    ctx.fillStyle = brush('masonry');
    ctx.fillRect(x, y, 1, 1);
    if (at(x, y - 1) !== symbol) {
      ctx.fillStyle = '#a39b83';
      ctx.fillRect(x, y, 1, 0.055);
    }
    if (at(x - 1, y) !== symbol) {
      ctx.fillStyle = '#898878';
      ctx.fillRect(x, y, 0.05, 1);
    }
    if (at(x + 1, y) !== symbol) {
      ctx.fillStyle = 'rgba(15,20,29,0.65)';
      ctx.fillRect(x + 0.92, y, 0.08, 1);
    }
    if (at(x, y + 1) === symbol) return;
    ctx.fillStyle = 'rgba(15,18,27,0.64)';
    ctx.fillRect(x, y + 0.65, 1, 0.35);
    ctx.fillStyle = '#959080';
    ctx.fillRect(x, y + 0.65, 1, 0.055);
    ctx.fillStyle = 'rgba(14,17,22,0.18)';
    ctx.fillRect(x + 0.04, y + 1, 1, 0.1);
  }

  function bridge(ctx, map, brush, x, y) {
    const causeway = map.id === 'cinder_thumb';
    ctx.fillStyle = brush(causeway ? 'inlay' : 'planks');
    ctx.fillRect(x, y, 1, 1);
    if (causeway) {
      if (map.tiles[y + 1]?.[x] !== '=') {
        ctx.fillStyle = '#332e32';
        ctx.fillRect(x, y + 0.83, 1, 0.17);
        ctx.fillStyle = '#b58d62';
        ctx.fillRect(x, y + 0.81, 1, 0.045);
      }
      return;
    }
    for (const sign of [-1, 1]) {
      if (map.tiles[y][x + sign] !== '~') continue;
      const side = x + (sign === -1 ? 0.07 : 0.93);
      ctx.fillStyle = '#3b3028';
      ctx.fillRect(side - 0.045, y, 0.09, 1);
      ctx.fillStyle = '#b09a6b';
      ctx.fillRect(side - 0.022, y, 0.034, 1);
      for (const offset of [0.1, 0.88]) {
        ctx.fillStyle = '#503c29';
        ctx.fillRect(side - 0.068, y + offset - 0.09, 0.136, 0.16);
        ctx.fillStyle = '#d1b77c';
        ctx.fillRect(side - 0.056, y + offset - 0.09, 0.11, 0.053);
      }
    }
  }

  function paintGround(map, art, terrain, sprites) {
    const region = art.regions[map.id];
    const cols = map.tiles[0].length;
    const rows = map.tiles.length;
    const ground = canvas(cols * BAKE_SIZE, rows * BAKE_SIZE);
    const ctx = ground.getContext('2d', { alpha: false });
    ctx.scale(BAKE_SIZE, BAKE_SIZE);
    const brushes = new Map();
    const brush = (name) => {
      if (!brushes.has(name)) brushes.set(name, textureBrush(ctx, art, terrain, name));
      return brushes.get(name);
    };
    ctx.fillStyle = brush(region.ground);
    ctx.fillRect(0, 0, cols, rows);
    if (region.ground === 'meadow' || region.ground === 'marsh') {
      // Break up the repeat with broad islands of cooler growth in the clearings.
      const patches = canvas(cols * 24, rows * 24).getContext('2d');
      patches.scale(24, 24);
      for (let i = 0; i < 36; i += 1) {
        glow(patches, noise(i, 2) * cols, noise(i, 3) * rows, 1.4 + noise(i, 9) * 2, 'rgba(255,255,255,0.68)');
      }
      patches.globalCompositeOperation = 'source-in';
      patches.fillStyle = brush(region.ground === 'meadow' ? 'marsh' : 'meadow');
      patches.fillRect(0, 0, cols, rows);
      ctx.drawImage(patches.canvas, 0, 0, cols, rows);
    }
    const { paint, paintTrails } = terrainPainter(ctx, map, brush);
    paint('#I', region.edge, { edge: 94, softness: 2.8 });
    ctx.globalAlpha = 0.32;
    paint('T', region.edge, { edge: 82, softness: 2 });
    ctx.globalAlpha = 1;
    paint('s', 'snow', { edge: 90, softness: 2.6 });
    if (region.trails) paintTrails(region.trails, region.path);
    else paint(':', region.path, { edge: 105, softness: 2.8 });
    ctx.globalAlpha = 0.53;
    paint('r', 'rubble', { edge: 118, softness: 2.1 });
    ctx.globalAlpha = 1;
    if (region.houses) {
      ctx.globalAlpha = 0.48;
      paint('H', 'rubble', { edge: 113 });
      ctx.globalAlpha = 1;
    }
    if (region.water) {
      paint('~=', region.bank, { edge: 92 });
      paint('~=', region.water, { edge: 111 });
    }
    if (map.id === 'cinder_thumb') {
      paint('L=', '#b66531', { edge: 84 });
      paint('L=', 'lava', { edge: 107 });
    }

    map.tiles.forEach((row, y) => {
      for (let x = 0; x < cols; x += 1) {
        const symbol = row[x];
        if (symbol === '=') bridge(ctx, map, brush, x, y);
        if (map.id === 'crown_city') {
          if (symbol === '#' || symbol === 'H') streetWall(ctx, map, brush, x, y, symbol);
          if (symbol === 'f' || symbol === '*') {
            ctx.fillStyle = brush('planks');
            ctx.fillRect(x, y, 1, 1);
          }
        }
        const seed = noise(x, y, 1);
        if (symbol === '.' && seed < 0.27 && (map.id === 'birchwood' || map.id === 'greenwake')) {
          const height = 0.13 + seed * 0.86;
          sprite(ctx, sprites, art.frames.ferns, x + 0.18 + noise(x, y, 2) * 0.65, y + 0.75, height * 1.3, height, seed < 0.13);
        }
        if (symbol === 'r' && seed < 0.72) {
          sprite(ctx, sprites, art.frames.ledge, x + 0.23 + seed * 0.8, y + 0.38 + seed * 0.62, 0.31 + seed * 0.43, 0.14 + seed * 0.23, seed < 0.4);
        }
        if (symbol === '~' && map.tiles[y - 1]?.[x] === '.' && map.id !== 'frostcrown' && seed < 0.64) {
          sprite(ctx, sprites, art.frames.rushes, x + 0.4, y + 0.13, 0.44, 0.55 + seed * 0.23, seed < 0.3);
        }
        if (symbol === 'C' || symbol === 'V' || symbol === 'L') {
          glow(ctx, x + 0.5, y + 0.54, symbol === 'C' ? 1.9 : 0.92,
            symbol === 'C' ? 'rgba(120,222,228,0.38)' : 'rgba(255,120,30,0.27)');
        }
      }
    });
    for (const [frame, x, y] of region.details) {
      if (frame === 'lantern' || frame === 'emberLamp') glow(ctx, x, y - 0.1, 1.4, 'rgba(255,198,102,0.31)');
    }
    if (map.id === 'frostcrown') {
      const cx = 10.58;
      const cy = 6.98;
      for (const radius of [1.43, 1.55]) {
        ctx.beginPath();
        ctx.ellipse(cx, cy, radius, radius * 0.72, 0, 0, TAU);
        ctx.strokeStyle = 'rgba(193,233,230,0.76)';
        ctx.lineWidth = 0.03;
        ctx.stroke();
      }
      for (let i = 0; i < 7; i += 1) {
        const angle = i / 7 * TAU;
        glow(ctx, cx + Math.cos(angle) * 1.5, cy + Math.sin(angle) * 1.08, 0.19, '#b6ffff');
      }
    }
    if (map.id === 'birchwood') {
      glow(ctx, 6, 5, 6.5, 'rgba(252,222,131,0.20)');
      glow(ctx, 15, 9.3, 5, 'rgba(255,226,156,0.16)');
    }
    return ground;
  }

  function paintCastShadows(map, ground, objects, art, image) {
    if (!image) return;
    const scale = 28;
    const shade = canvas(map.tiles[0].length * scale, map.tiles.length * scale).getContext('2d');
    shade.scale(scale, scale);
    for (const node of objects) {
      shade.save();
      shade.translate(node.x, node.feet);
      shade.transform(1, 0, -0.46, -0.33, 0, 0);
      sprite(shade, image, art.frames[node.frame], 0, 0, node.width, node.height, node.flip);
      shade.restore();
    }
    shade.globalCompositeOperation = 'source-in';
    shade.fillStyle = 'rgba(23,34,39,0.34)';
    shade.fillRect(0, 0, map.tiles[0].length, map.tiles.length);
    const ctx = ground.getContext('2d');
    ctx.drawImage(shade.canvas, 0, 0, map.tiles[0].length, map.tiles.length);
  }

  // A roof spans the connected footprint of one house. The capital instead
  // uses cutaway walls so its archive rooms and doorways stay visible.
  function houseBounds(map, x, y, visited) {
    const pending = [[x, y]];
    let left = x;
    let right = x;
    let bottom = y;
    while (pending.length) {
      const [cx, cy] = pending.pop();
      const key = cy * map.tiles[0].length + cx;
      if (map.tiles[cy]?.[cx] !== 'H' || visited.has(key)) continue;
      visited.add(key);
      left = Math.min(left, cx);
      right = Math.max(right, cx);
      bottom = Math.max(bottom, cy);
      pending.push([cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]);
    }
    return { left, right, top: y, bottom };
  }

  function prop(art, frame, x, feet, height, width, flip = false) {
    const rect = art.frames[frame];
    return { frame, x, feet, height, width: width ?? height * rect[2] / rect[3], flip };
  }

  function scenery(map, art) {
    const region = art.regions[map.id];
    const objects = region.details.map(([frame, x, feet, height]) => prop(art, frame, x, feet, height));
    const visited = new Set();
    map.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        const ch = row[x];
        const seed = noise(x, y, 3);
        const mid = x + 0.5 + (seed - 0.5) * 0.24;
        const feet = y + 0.92 - noise(x, y, 4) * 0.15;
        if (ch === 'H' && region.houses && !visited.has(y * row.length + x)) {
          const bounds = houseBounds(map, x, y, visited);
          const width = bounds.right - bounds.left + 1;
          const height = bounds.bottom - bounds.top + 1;
          const frame = region.houses[`${x},${y}`] || 'cottage';
          objects.push(prop(art, frame, bounds.left + width / 2,
            bounds.bottom + 0.99, height + 0.28, width + 0.12));
        } else if (ch === 'T') {
          const frame = map.id === 'greenwake' ? 'willow' : ['birch', 'grove', 'twins'][Math.floor(seed * 3)];
          objects.push(prop(art, frame, mid, feet, 1.67 + noise(x, y, 2) * 1.04, undefined, seed < 0.5));
        } else if ((ch === '#' || ch === 'I') && region.border) {
          const trailEnd = map.id === 'birchwood' && y === map.tiles.length - 1 && x >= 10 && x <= 13;
          const frame = trailEnd ? 'ferns' : region.border[Math.floor(seed * region.border.length)];
          const tree = ['birch', 'twins', 'grove', 'willow'].includes(frame);
          const height = trailEnd ? 0.36 : tree ? 1.8 + seed * 0.94 : 0.68 + noise(x, y, 7) * 0.78;
          const wide = frame === 'lowWall' || frame === 'drift' || frame === 'ledge';
          const width = tree || trailEnd || wide ? undefined : 1.38 + seed * 0.65;
          objects.push(prop(art, frame, mid, feet + 0.08, height, width, seed < 0.48));
        } else if (ch === 'C') {
          objects.push(prop(art, 'crystal', x + 0.5, y + 0.92, 1.4));
        } else if (ch === 'O') {
          const frame = { birchwood: 'limestone', greenwake: 'well', ashfinger: 'well', crown_city: 'gear' }[map.id];
          objects.push(prop(art, frame, mid, feet, 0.94));
        } else if (ch === 'V') {
          objects.push(prop(art, 'vent', mid, feet, 0.63 + seed * 0.17));
        }
      }
    });
    return objects;
  }

  function shadow(ctx, x, y, width, height) {
    ctx.fillStyle = 'rgba(17,21,25,0.24)';
    ctx.beginPath();
    ctx.ellipse(x + width * 0.045, y - 0.047, width * 0.38, Math.min(0.17, height * 0.085), -0.08, 0, TAU);
    ctx.fill();
  }

  function drawObject(ctx, image, art, node, player) {
    const { x, feet, height, width, character } = node;
    ctx.save();
    // Let the traveler remain visible when the crown of a foreground tree overlaps them.
    if (!node.actor && feet > player.y + 0.33 && feet - height < player.y &&
        Math.abs(x - player.x) < width * 0.46 && height > 1.1) ctx.globalAlpha = 0.57;
    if (node.actor || node.interactive) shadow(ctx, x, feet, width, height);
    if (node.player) {
      ctx.strokeStyle = '#ffe3a0';
      ctx.lineWidth = 0.025;
      ctx.beginPath();
      ctx.ellipse(x, feet - 0.044, 0.287, 0.10, 0, 0, TAU);
      ctx.stroke();
    }
    if (image) {
      sprite(ctx, image, art.frames[node.frame], x, feet + (node.bob || 0), width, height, node.flip);
    } else {
      ctx.fillStyle = character?.sprite.body || '#535851';
      ctx.beginPath();
      ctx.ellipse(x, feet - height * 0.42, width * 0.43, height * 0.42, 0, 0, TAU);
      ctx.fill();
      if (character) {
        ctx.fillStyle = character.sprite.skin;
        ctx.beginPath();
        ctx.arc(x, feet - height * 0.79, height * 0.16, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawMarker(ctx, item, node, near, complete, time) {
    const x = item.x + 0.5;
    const y = node.feet - node.height - 0.17 + Math.sin(time * 3.1) * 0.025;
    const r = near ? 0.126 : 0.103;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#292724';
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.strokeStyle = complete ? '#b6a88c' : '#ffdf95';
    ctx.lineWidth = 0.024;
    ctx.strokeRect(-r, -r, r * 2, r * 2);
    ctx.fillStyle = near ? '#fff0bd' : '#ffc247';
    if (!complete) ctx.fillRect(-r * 0.47, -r * 0.47, r * 0.94, r * 0.94);
    ctx.restore();
  }

  function actor(art, character, x, y, facing = 'down') {
    const isPlayer = character.id === 'aren';
    let frame = character.id;
    if (isPlayer) {
      frame = 'arenDown';
      if (facing === 'up') frame = 'arenUp';
      if (facing === 'left' || facing === 'right') frame = 'arenSide';
    }
    const height = isPlayer ? 1.14 : 1.12;
    return { ...prop(art, frame, x, y + 0.33, height, undefined, facing === 'right'), actor: true, player: isPlayer, character };
  }

  function ambientPoints(map) {
    const points = [];
    map.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) {
        const symbol = row[x];
        const seed = noise(x, y, 12);
        if ((symbol === '~' && seed < 0.34) || symbol === 'L' || (symbol === 'T' && seed < 0.45)) {
          points.push({ x: x + 0.35 + seed * 0.28, y: y + 0.53, symbol, phase: seed * 6.8 });
        }
      }
    });
    return points;
  }

  function drawAmbient(ctx, points, time) {
    ctx.save();
    for (const { x, y, symbol, phase } of points) {
      const t = (time * 0.31 + phase) % 1;
      ctx.globalAlpha = Math.sin(t * Math.PI) * 0.6;
      ctx.beginPath();
      if (symbol === '~') {
        ctx.strokeStyle = '#bed9d6';
        ctx.lineWidth = 0.016;
        ctx.ellipse(x, y, 0.07 + t * 0.25, 0.024 + t * 0.055, -0.06, 0.15, 2.75);
        ctx.stroke();
      } else {
        const ember = symbol === 'L';
        const px = x + Math.sin(t * 4 + phase) * 0.19;
        const py = y + (ember ? -1 : 1) * t * 0.65;
        ctx.fillStyle = ember ? '#ffc679' : '#f4d881';
        ctx.ellipse(px, py, ember ? 0.022 : 0.038, 0.015, t * 3.5, 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function createRenderer(art, characters, images) {
    let currentMap;
    let ground;
    let objects;
    let ambient;
    return function draw(ctx, map, view, { player, items, completed, nearest, time, walking }) {
      if (map !== currentMap) {
        ground = paintGround(map, art, images.get(art.terrain), images.get(art.sprites));
        objects = scenery(map, art);
        ambient = ambientPoints(map);
        paintCastShadows(map, ground, objects, art, images.get(art.sprites));
        currentMap = map;
      }
      const image = images.get(art.sprites);
      const hero = actor(art, characters.aren, player.x, player.y, player.facing);
      hero.bob = walking ? -Math.abs(Math.sin(time * 11)) * 0.035 : 0;
      const entities = items.map(item => {
        const x = item.x + 0.5;
        if (item.characterId) return actor(art, characters[item.characterId], x, item.y + 0.5);
        if (item.art) return { ...prop(art, item.art, x, item.y + 0.82, item.artHeight), interactive: true };
        return { x, feet: item.y + 0.22, height: 0 };
      });
      ctx.save();
      ctx.translate(-view.x, -view.y);
      ctx.scale(view.size, view.size);
      ctx.drawImage(ground, 0, 0, map.tiles[0].length, map.tiles.length);
      if (time) drawAmbient(ctx, ambient, time);
      const left = view.x / view.size;
      const top = view.y / view.size;
      const right = left + view.width / view.size;
      const bottom = top + view.height / view.size;
      const visible = objects.filter(node =>
        node.x + node.width / 2 > left && node.x - node.width / 2 < right
        && node.feet >= top && node.feet - node.height < bottom);
      visible.push(...entities.filter(node => node.height), hero);
      visible.sort((a, b) => a.feet - b.feet);
      visible.forEach(node => drawObject(ctx, image, art, node, player));

      const tint = art.regions[map.id].tint;
      if (tint) {
        ctx.fillStyle = tint;
        ctx.fillRect(left, top, right - left, bottom - top);
      }
      items.forEach((item, index) => {
        const complete = completed.includes(item.id);
        if (!complete || item.repeatSceneId) drawMarker(ctx, item, entities[index], item.id === nearest?.id, complete, time);
      });
      ctx.restore();
    };
  }

  root.createMapRenderer = createRenderer;
}(typeof window !== 'undefined' ? window : globalThis));
