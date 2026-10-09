/* Renderer-only art. The world module owns geometry; server snapshots own all transforms. */
(function () {
  'use strict';
  const W = window.CommonsWorld;
  const TILE = 32;
  const colors = ['#ffc247', '#83d8be', '#cfa9df', '#ffa37e', '#a5cbea', '#dcd9a0'];
  class CommonsRenderer {
    constructor(canvas, atlas, painting, sceneryAtlas, cottage) {
      this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.atlas = atlas; this.painting = painting;
      this.cottage = cottage; this.sceneryAtlas = sceneryAtlas; this.scale = innerWidth < 700 ? .7 : 1; this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.ground = this.makeGround(); this.state = null; this.camera = null;
      this.resizeObserver = new ResizeObserver(() => this.resize()); this.resizeObserver.observe(canvas);
      this.resize(); this.frame = this.frame.bind(this); requestAnimationFrame(this.frame);
    }
    resize() {
      const bounds = this.canvas.getBoundingClientRect();
      this.width = bounds.width; this.height = bounds.height;
      this.dpr = Math.min(devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.width * this.dpr); this.canvas.height = Math.round(this.height * this.dpr);
    }
    update(state) { this.state = state; this.received = performance.now(); }
    zoom(by) { this.scale = Math.max(0.5, Math.min(1.5, this.scale + by)); }
    makeGround() {
      const canvas = document.createElement('canvas'); canvas.width = W.WIDTH * TILE; canvas.height = W.HEIGHT * TILE;
      const c = canvas.getContext('2d'); c.fillStyle = '#647d53'; c.fillRect(0, 0, canvas.width, canvas.height);
      const random = i => { const n = Math.sin(i * 127.1 + 17.5) * 43758.5453; return n - Math.floor(n); };
      for (let i = 0; i < 11000; i++) {
        const x = random(i * 3) * canvas.width, y = random(i * 3 + 1) * canvas.height;
        c.fillStyle = ['#829365', '#71895a', '#597349', '#91a16c'][i % 4];
        c.fillRect(x, y, 1 + random(i + 4) * 4, 2);
      }
      const path = (points, width) => {
        c.beginPath(); points.forEach(([x, y], i) => i ? c.lineTo(x * TILE, y * TILE) : c.moveTo(x * TILE, y * TILE));
        c.lineWidth = width; c.lineCap = 'round'; c.lineJoin = 'round'; c.strokeStyle = '#9b9676'; c.stroke();
        c.lineWidth = width - 9; c.strokeStyle = '#b6ad8b'; c.stroke();
      };
      W.roads.forEach(road => path(road.points, road.width * TILE));
      c.fillStyle = '#9c9b85'; c.beginPath(); c.ellipse(32 * TILE, 25 * TILE, 165, 125, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = '#c7bea0'; c.lineWidth = 3;
      for (const r of [55, 105, 155]) { c.beginPath(); c.ellipse(32 * TILE, 25 * TILE, r, r * .73, 0, 0, Math.PI * 2); c.stroke(); }
      for (let i = 0; i < 4500; i++) {
        const x = Math.floor(random(i * 7) * (canvas.width - 2)), y = Math.floor(random(i * 7 + 1) * (canvas.height - 2));
        const p = c.getImageData(x, y, 1, 1).data;
        if (p[0] > 140 && p[1] > 135) { c.fillStyle = i % 2 ? '#c5bea080' : '#7f806a50'; c.fillRect(x, y, 3 + i % 5, 2); }
      }
      // Deliberately drawn terrain details complement the generated building atlas.
      for (let i = 0; i < 430; i++) {
        const x = random(i * 9) * canvas.width, y = random(i * 9 + 1) * canvas.height;
        if (Math.abs(x / TILE - 32) < 3 || Math.abs(y / TILE - 25) < 2) continue;
        c.fillStyle = ['#e8cf83', '#cabbc6', '#c4d7a0'][i % 3]; c.fillRect(x, y, 3, 3);
        c.fillStyle = '#3b6048'; c.fillRect(x + 1, y + 3, 1, 4);
      }
      return canvas;
    }
    sprite(index, x, y, width, height = width, atlas = this.atlas) {
      const cell = W.art.cell, [sx, sy, sw, sh] = (atlas === this.sceneryAtlas ? W.art.scenery : W.art.village)[index];
      const ox = (index % 4) * cell, oy = Math.floor(index / 4) * cell;
      this.ctx.drawImage(atlas, sx, sy, sw, sh,
        x - width / 2 + (sx - ox) * width / cell, y - height + (sy - oy) * height / cell,
        sw * width / cell, sh * height / cell);
    }
    label(text, x, y, accent = false) {
      const c = this.ctx;
      c.save(); c.translate(x, y); c.scale(1 / (this.drawScale || 1), 1 / (this.drawScale || 1));
      c.font = '12px system-ui'; c.textAlign = 'center';
      const width = c.measureText(text).width + 18;
      c.fillStyle = '#171a20e8'; c.beginPath(); c.roundRect(-width / 2, -13, width, 23, 7); c.fill();
      c.fillStyle = accent ? '#ffc247' : '#e8ecf2'; c.fillText(text, 0, 3); c.restore();
    }
    glow(x, y, radius, alpha = .4) {
      const c = this.ctx, gradient = c.createRadialGradient(x, y, 1, x, y, radius);
      gradient.addColorStop(0, `rgba(255,194,71,${alpha})`); gradient.addColorStop(1, 'rgba(255,194,71,0)');
      c.fillStyle = gradient; c.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
    person(p, t, own) {
      const c = this.ctx, x = p.x * TILE, y = p.y * TILE;
      // Keep the visible soles on the authoritative point; ambient motion belongs to lights.
      const contact = W.art.avatarContact, cell = W.art.cell;
      const footX = (contact.x - 3.5 * cell) * 67 / cell;
      const footY = (2 * cell - contact.y) * 67 / cell;
      c.fillStyle = '#14241d55'; c.beginPath(); c.ellipse(x, y, 15, 6, 0, 0, Math.PI * 2); c.fill();
      c.strokeStyle = colors[p.plot % colors.length]; c.lineWidth = own ? 2.5 : 1.5;
      if (!own) { c.beginPath(); c.ellipse(x, y, 17, 8, 0, 0, Math.PI * 2); c.stroke(); }
      this.sprite(7, x - footX, y + footY, 67);
      const dirs = { up: [0, -11], down: [0, 11], left: [-22, 0], right: [22, 0] };
      const [dx, dy] = dirs[p.facing] || dirs.down;
      c.fillStyle = colors[p.plot % colors.length]; c.beginPath(); c.arc(x + dx, y + dy, 2.5, 0, Math.PI * 2); c.fill();
      if (p.lantern) this.glow(x - 12, y - 24, 48, .35);
    }
    personLabel(p, own) {
      const c = this.ctx, x = p.x * TILE, y = p.y * TILE;
      if (own) {
        c.strokeStyle = colors[p.plot % colors.length]; c.lineWidth = 2.5;
        c.beginPath(); c.ellipse(x, y, 17, 8, 0, 0, Math.PI * 2); c.stroke();
      }
      if (p.emote) this.label(p.emote, x, y - 83, true);
      else this.label(own ? 'You' : `Villager ${p.plot + 1}`, x, y + 24 / (this.drawScale || 1), own);
    }
    home(t) {
      const c = this.ctx, own = this.state.self;
      c.drawImage(this.cottage, 0, 0, 384, 320);
      if (own.decorated) {
        this.glow(267, 179, 75, .65);
        c.fillStyle = '#77502b'; c.fillRect(260, 173, 14, 3); c.fillRect(261, 199, 12, 3);
        c.fillStyle = '#ffc247'; c.fillRect(262, 176, 10, 23);
        this.label('Your handmade lantern', 268, 164, true);
      }
      this.label('Village', 193, 308, true);
      this.person(own, t, true);
      this.personLabel(own, true);
    }
    frame(t) {
      requestAnimationFrame(this.frame);
      if (!this.state || document.hidden) return;
      if (this.dpr !== Math.min(devicePixelRatio || 1, 2)) this.resize();
      const c = this.ctx, s = this.state, own = s.self;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.fillStyle = '#344a3d'; c.fillRect(0, 0, this.width, this.height);
      const scale = own.scene === 'home' ? Math.min(this.width / 450, this.height / 390, 1.7) : this.scale;
      this.drawScale = scale;
      const target = own.scene === 'home' ? { x: 192, y: 180 } : { x: own.x * TILE, y: own.y * TILE - 50 / scale };
      const clampCamera = (point) => {
        if (own.scene === 'home') return;
        const clamp = (value, size, visible) => visible >= size ? size / 2 : Math.max(visible / 2, Math.min(size - visible / 2, value));
        point.x = clamp(point.x, W.WIDTH * TILE, this.width / scale);
        point.y = clamp(point.y, W.HEIGHT * TILE, this.height / scale);
      };
      clampCamera(target);
      if (!this.camera || this.camera.scene !== own.scene) this.camera = { ...target, scene: own.scene };
      const ease = this.reducedMotion ? 1 : .17;
      this.camera.x += (target.x - this.camera.x) * ease; this.camera.y += (target.y - this.camera.y) * ease;
      clampCamera(this.camera);
      c.translate(this.width / 2, this.height / 2); c.scale(scale, scale); c.translate(-this.camera.x, -this.camera.y);
      if (own.scene === 'home') this.home(t);
      else {
        c.drawImage(this.ground, 0, 0);
        const items = [...W.trees.map(tree => ({ ...tree, tree: true })), ...W.scenery.map(prop => ({ ...prop, scenery: true })), ...W.locations, ...s.players.map(p => ({ ...p, person: true }))].sort((a, b) => W.depth(a) - W.depth(b));
        for (const item of items) {
          const x = item.x * TILE, y = item.y * TILE;
          if (Math.abs(x - this.camera.x) > this.width / scale / 2 + 180 || Math.abs(y - this.camera.y) > this.height / scale / 2 + 200) continue;
          if (item.scenery) { this.sprite(item.sprite, x, y + 6, item.width, item.width, this.sceneryAtlas); continue; }
          if (item.person) { this.person(item, t, item.id === own.id); continue; }
          if (item.tree) { this.sprite(6, x, y + 8, 124); continue; }
          if (item.sprite != null) this.sprite(item.sprite, x, y + 8, item.sprite === 7 ? 73 : item.sprite === 0 ? 188 : 146);
          if (item.kind === 'garden') {
            c.fillStyle = '#72533a'; c.beginPath(); c.roundRect(x - 34, y - 20, 68, 43, 5); c.fill();
            for (let j = 0; j < 9; j++) {
              const fx = x - 24 + j % 3 * 23, fy = y - 12 + Math.floor(j / 3) * 13;
              c.fillStyle = '#719b54'; c.fillRect(fx, fy, 3, 12); c.fillStyle = ['#d7dcac', '#efc661', '#a0b5d2'][Number(item.id.slice(-1))];
              c.beginPath(); c.arc(fx + 1, fy, 4, 0, Math.PI * 2); c.fill();
            }
          }
          if (item.kind === 'discovery') {
            this.sprite(5, x, y + 8, 55, 55, this.sceneryAtlas);
            c.fillStyle = '#f4d77e'; c.font = '22px Georgia'; c.textAlign = 'center'; c.fillText(['I', 'II', 'III'][Number(item.id.slice(-1))], x, y);
          }
        }
        const darkness = W.clock(s.serverTime + Math.min(performance.now() - this.received, 5000)).darkness;
        c.fillStyle = `rgba(14,22,45,${darkness})`; c.fillRect(0, 0, W.WIDTH * TILE, W.HEIGHT * TILE);
        for (const item of W.locations.filter(l => l.sprite < 6)) {
          this.glow(item.x * TILE, item.y * TILE - 30, 66, .16 + darkness * .55);
        }
        for (const lamp of W.scenery.filter(p => p.sprite === 3)) this.glow(lamp.x * TILE, lamp.y * TILE - 53, 65, .3 + darkness * .6);
        for (let i = 0; i < 14; i++) {
          const x = (19 + i * 2) * TILE, y = (24 + Math.sin(i * 4) * 3) * TILE;
          this.glow(x, y + (this.reducedMotion ? 0 : Math.sin(t / 1500 + i) * 6), 10, .3);
        }
        // Labels and interaction affordances remain legible above the night tint.
        for (const item of W.locations.filter(l => l.sprite != null && l.sprite < 6)) {
          const near = Math.hypot(item.x - own.x, item.y - own.y) < 16;
          if (near || item.plot === own.plot) this.label(item.kind === 'home' && item.plot === own.plot ? `Your cottage · ${own.plot + 1}` : item.name, item.x * TILE, item.y * TILE + 29, item.plot === own.plot);
        }
        this.label('Mori · lantern keeper', 33 * TILE, 23 * TILE - 77, true);
        for (const player of s.players) this.personLabel(player, player.id === own.id);
        for (const item of W.nearby(own)) {
          c.strokeStyle = '#ffc247'; c.lineWidth = 2; c.beginPath(); c.ellipse(item.x * TILE, (item.y + (item.sprite < 6 ? 1.2 : 0)) * TILE, 20, 8, 0, 0, Math.PI * 2); c.stroke();
        }
      }
    }
  }
  window.CommonsRenderer = CommonsRenderer;
}());
