/* Canvas 2D cubie renderer. Geometry and move axes share the solver's URFDLB frame. */
(function () {
  'use strict';
  const { faces, frames, facelet, parseMove, rotate } = CubeLab;
  // Physical sticker colors, deliberately independent of the interface theme.
  const paint = { U: '#f1f0e8', R: '#ed4b4f', F: '#23b88c', D: '#f5cf46', L: '#ff873e', B: '#4c88ee' };
  const stickers = Array.from({ length: 54 }, (_, index) => ({ index, ...facelet(index) }));
  class CubeRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.context = canvas.getContext('2d');
      if (!this.context) throw new Error('Canvas is unavailable');
      this.state = CubeLab.solved;
      this.highlight = null;
      this.motion = null;
      this.resetView();
      this.resizeObserver = new ResizeObserver(() => this.draw());
      this.resizeObserver.observe(canvas);
      let drag = null;
      canvas.addEventListener('pointerdown', event => {
        if (event.button !== 0) return;
        canvas.focus({ preventScroll: true });
        canvas.setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      });
      canvas.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId) return;
        this.yaw += (event.clientX - drag.x) * 0.009;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (event.clientY - drag.y) * 0.009));
        drag.x = event.clientX;
        drag.y = event.clientY;
        this.draw();
      });
      for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, () => { drag = null; });
      canvas.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        this.yaw += event.key === 'ArrowLeft' ? -0.2 : event.key === 'ArrowRight' ? 0.2 : 0;
        this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + (event.key === 'ArrowUp' ? -0.2 : event.key === 'ArrowDown' ? 0.2 : 0)));
        this.draw();
      });
    }
    resetView() {
      this.yaw = -0.58;
      this.pitch = 0.48;
      if (this.context) this.draw();
    }
    setState(state) { this.state = state; this.draw(); }
    setHighlight(face) { this.highlight = face; this.draw(); }
    animate(move, duration) {
      const spec = parseMove(move);
      return new Promise(resolve => {
        const start = performance.now();
        const frame = now => {
          const progress = Math.min(1, (now - start) / duration);
          this.motion = { ...spec, angle: spec.angle * (progress * progress * (3 - 2 * progress)) };
          this.draw();
          if (progress < 1) requestAnimationFrame(frame);
          else { this.motion = null; resolve(); }
        };
        requestAnimationFrame(frame);
      });
    }
    draw() {
      const canvas = this.canvas, ctx = this.context;
      const bounds = canvas.getBoundingClientRect();
      const width = bounds.width, height = bounds.height;
      if (!width || !height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const theme = getComputedStyle(canvas);
      const bodyColor = theme.getPropertyValue('--bg').trim();
      const edgeColor = theme.getPropertyValue('--border').trim();
      const accent = theme.getPropertyValue('--accent').trim();
      const view = vector => rotate(rotate(vector, 1, this.yaw), 0, this.pitch);
      const scale = Math.min(width / 6.6, height / 5.8);
      const project = vector => [width / 2 + vector[0] * scale, height / 2 - vector[1] * scale - 6];
      const polygons = [];
      for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
        if (!x && !y && !z) continue;
        const position = [x, y, z];
        const moving = this.motion && position[this.motion.axis] === this.motion.layer;
        const transform = vector => view(moving ? rotate(vector, this.motion.axis, this.motion.angle) : vector);
        for (const face of faces) {
          const { normal, right, up } = frames[face];
          const transformedNormal = transform(normal);
          if (transformedNormal[2] <= 0.001) continue;
          const sticker = stickers.find(s => s.face === face && s.position.every((n, i) => n === position[i]));
          const center = position.map((n, i) => n + normal[i] * 0.49);
          const vertices = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) => transform(center.map((n, i) => n + 0.475 * (right[i] * u + up[i] * v))));
          polygons.push({ vertices, center: transform(center), sticker, normal: transformedNormal, face });
        }
      }
      polygons.sort((a, b) => a.center[2] - b.center[2]);
      const path = points => {
        ctx.beginPath();
        points.forEach((point, index) => { const [x, y] = project(point); if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
        ctx.closePath();
      };
      for (const polygon of polygons) {
        path(polygon.vertices);
        ctx.fillStyle = bodyColor;
        ctx.fill();
        ctx.strokeStyle = edgeColor;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (!polygon.sticker) continue;
        const { index } = polygon.sticker;
        const inset = polygon.vertices.map(v => v.map((n, i) => polygon.center[i] + (n - polygon.center[i]) * 0.87));
        path(inset);
        ctx.fillStyle = paint[this.state[index]];
        ctx.fill();
        ctx.fillStyle = `rgba(0, 0, 0, ${0.17 * (1 - polygon.normal[2])})`;
        ctx.fill();
        if (this.highlight === polygon.face) {
          ctx.strokeStyle = accent;
          ctx.lineWidth = 2.5;
          ctx.stroke();
        }
        if (index % 9 === 4) {
          const [x, y] = project(polygon.center);
          ctx.font = `700 ${Math.max(13, scale * 0.28)}px system-ui`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = bodyColor;
          ctx.fillText(polygon.face, x, y);
        }
      }
    }
  }
  window.CubeRenderer = CubeRenderer;
})();
