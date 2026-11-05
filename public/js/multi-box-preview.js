const ns = 'http://www.w3.org/2000/svg';
const signs = [[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]];
const faces = [[0,1,2,3],[4,7,6,5],[0,4,5,1],[3,2,6,7],[0,3,7,4],[1,5,6,2]];
const palette = ['--accent', '--success', '--info', '--brand', '--text-secondary'];
export const itemColor = index => `var(${palette[index % palette.length]})`;
export function itemCorners(item) {
  if (item.soft) return [];
  const m = item.orientation?.matrix;
  if (!Array.isArray(m) || m.length !== 9 || !m.every(Number.isFinite)
    || ![item.center, item.dimensions].every(a => Array.isArray(a) && a.length === 3 && a.every(Number.isFinite))) {
    throw new Error('Placement geometry is missing or invalid.');
  }
  return signs.map(sign => {
    const local = sign.map((value, axis) => value * item.dimensions[axis] / 2);
    return item.center.map((value, axis) => value + local.reduce((sum, coordinate, j) => sum + m[axis * 3 + j] * coordinate, 0));
  });
}
// SVG projection avoids a WebGL context per box and supports large multi-box plans.
export function createPreview(box) {
  const wrapper = document.createElement('div');
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 400 300'); svg.classList.add('multi-pack__preview');
  svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', `3D preview of ${box.id}: ${box.type}. Soft items have no position.`);
  let yaw = -.65; let pitch = .45;
  const frame = signs.map(sign => sign.map((s, axis) => (s + 1) * box.dimensions[axis] / 2));
  const items = box.items.map(itemCorners);
  function draw() {
    svg.replaceChildren();
    const scale = 220 / Math.hypot(...box.dimensions);
    const project = point => {
      const [x, y, z] = point.map((value, axis) => value - box.dimensions[axis] / 2);
      const horizontal = Math.cos(yaw) * x + Math.sin(yaw) * z;
      const depth = -Math.sin(yaw) * x + Math.cos(yaw) * z;
      return [200 + horizontal * scale, 150 - (Math.cos(pitch) * y - Math.sin(pitch) * depth) * scale,
        Math.sin(pitch) * y + Math.cos(pitch) * depth];
    };
    const shapes = [];
    items.forEach((corners, index) => {
      if (!corners.length) return;
      const projected = corners.map(project);
      faces.forEach(face => shapes.push({ points: face.map(i => projected[i]), index }));
    });
    shapes.sort((a, b) => b.points.reduce((sum, p) => sum + p[2], 0) - a.points.reduce((sum, p) => sum + p[2], 0));
    shapes.forEach(shape => {
      const polygon = document.createElementNS(ns, 'polygon');
      polygon.setAttribute('points', shape.points.map(p => p.slice(0, 2).join(',')).join(' '));
      polygon.setAttribute('fill', itemColor(shape.index)); polygon.classList.add('multi-pack__shape');
      const title = document.createElementNS(ns, 'title'); title.textContent = box.items[shape.index].id;
      polygon.append(title); svg.append(polygon);
    });
    const projected = frame.map(project);
    [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].forEach(([a,b]) => {
      const line = document.createElementNS(ns, 'line');
      ['x1', 'y1', 'x2', 'y2'].forEach((key, i) => line.setAttribute(key, [...projected[a].slice(0,2), ...projected[b].slice(0,2)][i]));
      line.classList.add('multi-pack__wire'); svg.append(line);
    });
  }
  wrapper.append(svg);
  const controls = document.createElement('div'); controls.className = 'bin-pack__actions';
  [['Rotate left', -.35, 0], ['Rotate right', .35, 0], ['Tilt up', 0, .2], ['Tilt down', 0, -.2]].forEach(([text, y, p]) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'bin-pack__secondary'; button.textContent = text;
    button.addEventListener('click', () => { yaw += y; pitch = Math.max(-1.4, Math.min(1.4, pitch + p)); draw(); });
    controls.append(button);
  });
  wrapper.append(controls); draw(); return wrapper;
}
