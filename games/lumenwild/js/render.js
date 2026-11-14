(function () {
  'use strict';
  const C = window.Lumenwild;
  const PROP = { mote: 0, seed: 1, medicine: 2, bomb: 3, thread: 4, chest: 5, portal: 7, shrine: 9, memory: 11, well: 14 };
  const TAU = Math.PI * 2;

  class Renderer {
    constructor(canvas, minimap) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.minimap = minimap;
      this.images = {};
      this.width = 1; this.height = 1; this.tile = 68;
      this.camera = { x: 3, y: 3 };
      this.hero = { x: 3, y: 3 };
      this.actors = new Map();
      this.particles = [];
      this.ghosts = [];
      this.rings = [];
      this.footsteps = [];
      this.walkTime = 0;
      this.shiftFlash = 0;
      this.hurtFlash = 0;
      this.lastMap = null;
      this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.motionQuery.addEventListener('change', event => { this.reduced = event.matches; });
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
      this.resize();
    }

    async load(progress) {
      const names = [
        ...Array.from({ length: 8 }, (_, i) => `fox-${i}`),
        ...Array.from({ length: 12 }, (_, i) => `enemy-${i}`),
        ...Array.from({ length: 16 }, (_, i) => `prop-${i}`),
        ...Array.from({ length: 16 }, (_, i) => `tile-${i}`),
      ];
      let loaded = 0;
      const missing = [];
      await Promise.all(names.map(name => new Promise(resolve => {
        const img = new Image();
        let settled = false;
        const finish = success => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (success) this.images[name] = img; else missing.push(name);
          loaded += 1; progress(loaded, names.length);
          resolve();
        };
        const timer = setTimeout(() => finish(false), 12000);
        img.onload = () => finish(true);
        img.onerror = () => finish(false);
        img.src = `assets/${name}.webp`;
      })));
      return missing;
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      this.width = rect.width; this.height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.round(this.width * dpr);
      this.canvas.height = Math.round(this.height * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.tile = this.width < 700 ? 51 : Math.max(58, Math.min(82, this.height / 8.2));
    }

    reset(game) {
      this.camera = { ...game.player }; this.hero = { ...game.player };
      this.actors.clear(); this.particles = []; this.ghosts = []; this.rings = []; this.footsteps = [];
      this.lastMap = game.map;
    }

    sprite(name, x, y, w, h = w, alpha = 1) {
      const ctx = this.ctx, img = this.images[name];
      ctx.globalAlpha = alpha;
      if (img) ctx.drawImage(img, x - w / 2, y - h / 2, w, h);
      else {
        ctx.fillStyle = name.startsWith('fox') ? '#ffc247' : name.startsWith('enemy') ? '#ff4d4f' : '#87dab1';
        ctx.beginPath(); ctx.arc(x, y, w * .22, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    glow(x, y, radius, color, strength = 1) {
      const ctx = this.ctx;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, color); gradient.addColorStop(1, 'transparent');
      ctx.globalAlpha = strength; ctx.fillStyle = gradient; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2); ctx.globalAlpha = 1;
    }

    burst(x, y, color, count = 18) {
      if (this.reduced) return;
      for (let i = 0; i < count && this.particles.length < 180; i += 1) {
        const angle = Math.random() * TAU, speed = .3 + Math.random() * 1.8;
        this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - .5, life: .5 + Math.random() * .6, max: 1.1, color, size: 1.5 + Math.random() * 2 });
      }
    }

    effects(events, game) {
      for (const event of events) {
        const x = event.x ?? game.player.x, y = event.y ?? game.player.y;
        if (['pickup', 'seed', 'chest', 'defeat', 'puzzleSolved'].includes(event.type)) this.burst(x, y, event.type === 'defeat' ? '#87dab1' : '#ffc247', event.type === 'seed' ? 38 : 18);
        if (event.type === 'hit') this.burst(x, y, '#ffdda0', 13);
        if (event.type === 'defeat' && !this.reduced) this.ghosts.push({ x, y, kind: event.kind, life: .7 });
        if (event.type === 'sweep') this.rings.push({ x, y, age: 0, life: .35, range: game.stats().reach + .5, color: '#ffc247', arc: true });
        if (event.type === 'bomb') {
          this.rings.push({ x, y, age: 0, life: .6, range: 4, color: '#8bdbe6' });
          this.burst(x, y, '#8bdbe6', 45);
        }
        if (event.type === 'heal') this.burst(x, y, '#87dab1', 25);
        if (event.type === 'shift') this.shiftFlash = 1;
        if (event.type === 'hurt') this.hurtFlash = .7;
        if (['move', 'dash'].includes(event.type)) {
          this.walkTime = .24;
          this.footsteps.push({ x: this.hero.x, y: this.hero.y, life: 3 });
          if (this.footsteps.length > 18) this.footsteps.shift();
          if (event.type === 'dash') this.burst(x, y, '#ffc247', 13);
        }
      }
      this.rings = this.rings.slice(-8);
      this.ghosts = this.ghosts.slice(-10);
    }

    draw(game, elapsed, dt) {
      if (!this.ctx || !game) return;
      if (this.lastMap !== game.map) this.reset(game);
      const ctx = this.ctx, { map, player } = game, t = this.tile;
      const smooth = this.reduced ? 1 : 1 - Math.exp(-dt * 16);
      this.hero.x += (player.x - this.hero.x) * smooth;
      this.hero.y += (player.y - this.hero.y) * smooth;
      this.camera.x += (this.hero.x - this.camera.x) * (this.reduced ? 1 : 1 - Math.exp(-dt * 8));
      this.camera.y += (this.hero.y - this.camera.y) * (this.reduced ? 1 : 1 - Math.exp(-dt * 8));
      const offsetX = this.width / 2 - (this.camera.x + .5) * t;
      const offsetY = this.height / 2 - (this.camera.y + .5) * t;
      const point = (x, y) => ({ x: offsetX + (x + .5) * t, y: offsetY + (y + .5) * t });
      ctx.fillStyle = game.phase ? '#09111b' : '#0a1512';
      ctx.fillRect(0, 0, this.width, this.height);
      const minX = Math.max(0, Math.floor(-offsetX / t) - 1), maxX = Math.min(map.w, Math.ceil((this.width - offsetX) / t) + 1);
      const minY = Math.max(0, Math.floor(-offsetY / t) - 1), maxY = Math.min(map.h, Math.ceil((this.height - offsetY) / t) + 1);
      for (let y = minY; y < maxY; y += 1) for (let x = minX; x < maxX; x += 1) {
        const index = y * map.w + x, tile = map.tiles[index], seen = game.seen.has(index), visible = game.visible.has(index);
        const px = offsetX + x * t, py = offsetY + y * t;
        if (!seen) {
          const mist = this.images[`tile-${((game.depth + game.phase) % 3) * 4 + 2}`];
          if (mist) {
            ctx.globalAlpha = .08;
            ctx.drawImage(mist, px, py, t + .5, t + .5);
            ctx.globalAlpha = 1;
          }
          if ((x * 17 + y * 31) % 9 === 0) {
            ctx.fillStyle = game.phase ? '#152331' : '#12271f';
            ctx.beginPath(); ctx.arc(px + t * .4, py + t * .6, 1, 0, TAU); ctx.fill();
          }
          continue;
        }
        const open = C.walkable(map, x, y, game.phase);
        const terrainRow = game.phase ? (game.depth + 1) % 3 : game.depth;
        let frame = terrainRow * 4 + (tile === 1 ? 1 : 0);
        if (tile >= 2) frame = open ? terrainRow * 4 + 3 : tile === 2 ? 12 : 13;
        const image = this.images[`tile-${frame}`];
        ctx.globalAlpha = visible ? 1 : .27;
        if (image) ctx.drawImage(image, px, py, t + .5, t + .5);
        else { ctx.fillStyle = open ? '#253a35' : '#416d51'; ctx.fillRect(px, py, t + .5, t + .5); }
        if (game.phase) { ctx.fillStyle = 'rgba(57,99,150,.12)'; ctx.fillRect(px, py, t + 1, t + 1); }
        if (tile === 1) {
          if (C.walkable(map, x, y + 1, game.phase)) {
            const shade = ctx.createLinearGradient(0, py + t - 8, 0, py + t + 12);
            shade.addColorStop(0, 'rgba(0,0,0,.65)'); shade.addColorStop(1, 'transparent');
            ctx.fillStyle = shade; ctx.fillRect(px, py + t - 8, t + 1, 20);
            ctx.fillStyle = 'rgba(139,219,185,.1)'; ctx.fillRect(px + 2, py + t - 12, t - 4, 1);
          }
          if ((x * 11 + y * 7) % 13 === 0) {
            this.sprite(`prop-${game.depth === 2 ? 14 : game.depth === 1 ? 12 : 13}`, px + t * .5, py + t * .4, t * .72, t * .72, visible ? .9 : .2);
          }
        }
        if (tile >= 2) {
          ctx.globalAlpha = visible ? 1 : .3;
          ctx.strokeStyle = tile === 2 ? '#ffc247' : '#8bdbe6';
          ctx.lineWidth = 1;
          ctx.setLineDash(open ? [3, 6] : []);
          ctx.strokeRect(px + 5, py + 5, t - 10, t - 10);
          ctx.setLineDash([]);
          ctx.fillStyle = tile === 2 ? '#ffc247' : '#8bdbe6';
          ctx.font = '14px Georgia'; ctx.textAlign = 'center'; ctx.fillText(tile === 2 ? '☼' : '☾', px + t / 2, py + t / 2 + 5);
        }
        ctx.globalAlpha = 1;
      }

      for (const foot of this.footsteps) {
        foot.life -= dt;
        const p = point(foot.x, foot.y);
        ctx.globalAlpha = Math.max(0, foot.life / 3 * .17); ctx.fillStyle = '#ffc247';
        ctx.beginPath(); ctx.ellipse(p.x, p.y + t * .3, 5, 2, 0, 0, TAU); ctx.fill();
      }
      this.footsteps = this.footsteps.filter(foot => foot.life > 0);
      ctx.globalAlpha = 1;
      if (game.guideTurns) {
        const route = game.guide();
        ctx.strokeStyle = '#ffc247'; ctx.lineWidth = 2; ctx.globalAlpha = .75;
        ctx.setLineDash([3, 7]); ctx.lineDashOffset = this.reduced ? 0 : -elapsed * 16;
        ctx.beginPath();
        route.forEach((cell, i) => {
          const p = point(cell.x, cell.y);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
        route.forEach((cell, i) => {
          if (i > 0 && cell.phase !== route[i - 1].phase) {
            const p = point(cell.x, cell.y);
            ctx.strokeStyle = '#8bdbe6'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(p.x, p.y, t * .24, 0, TAU); ctx.stroke();
            ctx.font = 'bold 12px sans-serif'; ctx.fillStyle = '#8bdbe6'; ctx.textAlign = 'center'; ctx.fillText('Q', p.x, p.y + 4);
          }
        });
      }

      // Wind-up tiles are visible through effects, and never rely on color alone.
      for (const enemy of map.enemies) if (enemy.hp > 0) for (const cell of enemy.intent) {
        if (!game.visible.has(cell.y * map.w + cell.x)) continue;
        const p = point(cell.x, cell.y);
        ctx.fillStyle = 'rgba(255,77,79,.22)'; ctx.fillRect(p.x - t / 2 + 3, p.y - t / 2 + 3, t - 6, t - 6);
        ctx.strokeStyle = '#ff7e79'; ctx.lineWidth = 2; ctx.setLineDash([5, 3]); ctx.strokeRect(p.x - t / 2 + 4, p.y - t / 2 + 4, t - 8, t - 8); ctx.setLineDash([]);
        ctx.fillStyle = '#ffd7cb'; ctx.font = 'bold 20px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('!', p.x, p.y + 8);
      }

      for (const e of map.entities) {
        if (e.done && !['chest', 'shrine', 'well'].includes(e.type)) continue;
        const index = e.y * map.w + e.x;
        if (!game.seen.has(index)) continue;
        const p = point(e.x, e.y), visible = game.visible.has(index);
        let alpha = visible ? 1 : .3;
        const wrongPhase = e.type === 'seed' && e.phase !== -1 && game.phase !== e.phase;
        if (wrongPhase || e.done) alpha *= .45;
        const float = this.reduced ? 0 : Math.sin(elapsed * 2.5 + e.x) * 3;
        const floating = ['seed', 'mote', 'thread'].includes(e.type);
        if (visible && !e.done && ['seed', 'portal', 'well'].includes(e.type)) this.glow(p.x, p.y, t * .9, e.type === 'portal' ? 'rgba(25,227,227,.22)' : 'rgba(255,194,71,.23)', wrongPhase ? .3 : 1);
        const size = e.type === 'portal' ? 1.55 : e.type === 'seed' ? .74 : ['mote', 'medicine', 'bomb', 'thread'].includes(e.type) ? .6 : 1;
        this.sprite(`prop-${PROP[e.type]}`, p.x, p.y - (e.type === 'portal' ? t * .25 : 0) + (floating ? float : 0), t * size, t * size, alpha);
        if (e.type === 'seed' && visible) {
          ctx.fillStyle = wrongPhase ? '#8bdbe6' : '#ffe2a2'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText(wrongPhase ? `${e.phase ? 'ECHO' : 'BLOOM'} · Q` : 'HEARTSEED', p.x, p.y + t * .52);
        }
        if (e.type === 'portal' && visible) {
          ctx.fillStyle = '#a1e9d3'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('WAYGATE', p.x, p.y + t * .55);
          for (let i = 0; i < 3; i += 1) { ctx.fillStyle = i < game.seeds ? '#ffc247' : '#38564c'; ctx.beginPath(); ctx.arc(p.x + (i - 1) * 12, p.y + t * .72, 3, 0, TAU); ctx.fill(); }
        }
      }

      for (const enemy of map.enemies) {
        if (!enemy.hp || !game.visible.has(enemy.y * map.w + enemy.x)) continue;
        if (!this.actors.has(enemy.id)) this.actors.set(enemy.id, { x: enemy.x, y: enemy.y });
        const actor = this.actors.get(enemy.id);
        const moving = Math.abs(actor.x - enemy.x) + Math.abs(actor.y - enemy.y) > .05;
        actor.x += (enemy.x - actor.x) * smooth; actor.y += (enemy.y - actor.y) * smooth;
        const p = point(actor.x, actor.y), size = enemy.kind === 2 ? 1.28 : 1.05;
        ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.ellipse(p.x, p.y + t * .23, t * .34, t * .12, 0, 0, TAU); ctx.fill();
        const frame = enemy.kind * 4 + (enemy.intent.length ? 2 : moving ? 1 : 0);
        const bob = enemy.kind === 1 && !this.reduced ? Math.sin(elapsed * 3 + enemy.x) * 4 : 0;
        this.sprite(`enemy-${frame}`, p.x, p.y - t * .13 + bob, t * size, t * size, C.walkable(map, enemy.x, enemy.y, game.phase) ? 1 : .35);
        const max = enemy.kind === 2 ? 4 : 2;
        for (let i = 0; i < max; i += 1) {
          ctx.fillStyle = i < enemy.hp ? '#ffb68c' : '#33393b'; ctx.fillRect(p.x + (i - (max - 1) / 2) * 9 - 3, p.y - t * .65, 6, 3);
        }
        if (enemy.stun) { ctx.font = '16px serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffc247'; ctx.fillText('✦', p.x + 20, p.y - t * .4); }
      }

      const hero = point(this.hero.x, this.hero.y);
      for (const ghost of this.ghosts) {
        ghost.life -= dt;
        const p = point(ghost.x, ghost.y - (.7 - ghost.life) * .5);
        this.sprite(`enemy-${ghost.kind * 4 + 3}`, p.x, p.y - t * .13, t * 1.15, t * 1.15, Math.max(0, ghost.life / .7));
      }
      this.ghosts = this.ghosts.filter(ghost => ghost.life > 0);
      this.glow(hero.x, hero.y, t * 2.2, game.phase ? 'rgba(139,219,230,.10)' : 'rgba(255,194,71,.12)');
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.beginPath(); ctx.ellipse(hero.x, hero.y + t * .25, t * .3, t * .12, 0, 0, TAU); ctx.fill();
      this.walkTime = Math.max(0, this.walkTime - dt);
      const facing = [3, 2, 0, 1][player.facing];
      const stride = this.walkTime > .05 ? 4 : 0;
      const hop = !this.reduced && this.walkTime > 0 ? -Math.sin(this.walkTime / .24 * Math.PI) * 4 : 0;
      this.sprite(`fox-${facing + stride}`, hero.x, hero.y - t * .23 + hop, t * 1.02, t * 1.2);
      if (game.shield) {
        ctx.strokeStyle = '#8bdbe6'; ctx.lineWidth = 2; ctx.globalAlpha = .65;
        ctx.beginPath(); ctx.ellipse(hero.x, hero.y, t * .55, t * .65, 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
      }

      for (const ring of this.rings) {
        ring.age += dt;
        const progress = Math.min(1, ring.age / ring.life), p = point(ring.x, ring.y);
        ctx.strokeStyle = ring.color; ctx.lineWidth = (1 - progress) * 8 + 1; ctx.globalAlpha = 1 - progress;
        ctx.beginPath(); ctx.arc(p.x, p.y, t * ring.range * (.2 + progress * .8), ring.arc ? progress * TAU : 0, ring.arc ? progress * TAU + Math.PI * 1.7 : TAU); ctx.stroke();
      }
      this.rings = this.rings.filter(ring => ring.age < ring.life);
      ctx.globalAlpha = 1;
      for (const particle of this.particles) {
        particle.life -= dt; particle.x += particle.vx * dt; particle.y += particle.vy * dt; particle.vy += .6 * dt;
        const p = point(particle.x, particle.y);
        ctx.globalAlpha = Math.max(0, particle.life / particle.max); ctx.fillStyle = particle.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, particle.size, 0, TAU); ctx.fill();
      }
      this.particles = this.particles.filter(p => p.life > 0);
      ctx.globalAlpha = 1;

      if (!this.reduced) for (let i = 0; i < 26; i += 1) {
        const x = ((i * 193 + Math.sin(elapsed * .19 + i) * 60) % this.width + this.width) % this.width;
        const y = ((i * 89 - elapsed * (3 + i % 3)) % this.height + this.height) % this.height;
        ctx.globalAlpha = .12 + (Math.sin(elapsed * .8 + i) + 1) * .16;
        ctx.fillStyle = game.phase ? '#8bdbe6' : '#ffc247'; ctx.beginPath(); ctx.arc(x, y, i % 3 === 0 ? 1.7 : 1, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      const vignette = ctx.createRadialGradient(this.width / 2, this.height / 2, this.height * .25, this.width / 2, this.height / 2, Math.max(this.width, this.height) * .65);
      vignette.addColorStop(0, 'transparent'); vignette.addColorStop(1, 'rgba(3,8,10,.65)');
      ctx.fillStyle = vignette; ctx.fillRect(0, 0, this.width, this.height);
      if (this.shiftFlash > 0 && !this.reduced) {
        ctx.fillStyle = game.phase ? '#8bdbe6' : '#ffc247'; ctx.globalAlpha = this.shiftFlash * .13;
        ctx.fillRect(0, 0, this.width, this.height); ctx.globalAlpha = 1;
      }
      if (this.hurtFlash > 0) {
        ctx.strokeStyle = `rgba(255,77,79,${this.hurtFlash * .7})`; ctx.lineWidth = 12;
        ctx.strokeRect(0, 0, this.width, this.height);
      }
      this.shiftFlash = Math.max(0, this.shiftFlash - dt * 2); this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2);
    }

    drawMap(game, canvas = this.minimap, large = false) {
      const ctx = canvas.getContext('2d'), w = canvas.width, h = canvas.height;
      const { map } = game, scale = Math.min((w - 16) / map.w, (h - 16) / map.h);
      const ox = (w - map.w * scale) / 2, oy = (h - map.h * scale) / 2;
      ctx.fillStyle = '#0e1518'; ctx.fillRect(0, 0, w, h);
      for (const i of game.seen) {
        const x = i % map.w, y = Math.floor(i / map.w), tile = map.tiles[i];
        ctx.fillStyle = tile === 1 ? '#293d39' : tile >= 2 ? (tile === 2 ? '#a67937' : '#3d8e9e') : '#527369';
        if (!game.visible.has(i)) ctx.globalAlpha = .6;
        ctx.fillRect(ox + x * scale, oy + y * scale, Math.ceil(scale), Math.ceil(scale)); ctx.globalAlpha = 1;
      }
      if (game.guideTurns) {
        ctx.strokeStyle = '#ffc247'; ctx.lineWidth = large ? 2 : 1; ctx.setLineDash([3, 3]); ctx.beginPath();
        game.guide().forEach((cell, i) => {
          const x = ox + (cell.x + .5) * scale, y = oy + (cell.y + .5) * scale;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }); ctx.stroke(); ctx.setLineDash([]);
      }
      for (const e of map.entities) {
        if (e.done || !game.seen.has(e.y * map.w + e.x) || e.type === 'mote') continue;
        const x = ox + (e.x + .5) * scale, y = oy + (e.y + .5) * scale;
        if (large && this.images[`prop-${PROP[e.type]}`]) {
          const size = Math.max(18, scale * 1.45); ctx.drawImage(this.images[`prop-${PROP[e.type]}`], x - size / 2, y - size / 2, size, size);
        } else {
          ctx.fillStyle = e.type === 'seed' ? '#ffc247' : e.type === 'portal' ? '#8bdbe6' : '#dad6b1';
          ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      }
      const x = ox + (game.player.x + .5) * scale, y = oy + (game.player.y + .5) * scale;
      ctx.fillStyle = '#ff6a1f'; ctx.strokeStyle = '#fff1ce'; ctx.lineWidth = large ? 2 : 1;
      ctx.beginPath(); ctx.arc(x, y, large ? Math.max(4, scale * .3) : 2.5, 0, TAU); ctx.fill(); ctx.stroke();
    }
  }

  window.LumenwildRenderer = Renderer;
}());
