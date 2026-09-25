import * as THREE from '../vendor/three.module.min.js';
const W = globalThis.DescentWorld;
const D = globalThis.Descent;
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: .78, flatShading: true, ...extra });
const random = seed => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
export class Renderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.25;
    this.camera = new THREE.OrthographicCamera(-44, 44, 30, -30, .1, 400);
    this.particles = [];
    this.width = 0;
    this.build(W.stages[0]);
  }
  mesh(geometry, material, x = 0, y = 0, z = 0, parent = this.scene) {
    const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); parent.add(m); return m;
  }
  box(w, h, d, material, x, y, z, parent) { return this.mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, parent); }
  poly(points, depth, material, z = -depth) {
    const path = new THREE.Shape(); points.forEach(([x, y], i) => i ? path.lineTo(x, y) : path.moveTo(x, y)); path.closePath();
    return this.mesh(new THREE.ExtrudeGeometry(path, { depth, bevelEnabled: false }), material, 0, 0, z);
  }
  label(text, x, y, size = 2.8, color = '#ffd18c') {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(14,15,19,.9)'; ctx.beginPath(); ctx.roundRect(2, 2, 508, 92, 18); ctx.fill();
    ctx.font = '600 40px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = color; ctx.fillText(text, 256, 63);
    const texture = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
    sprite.position.set(x, y, 4); sprite.scale.set(size * 5.33, size, 1); this.scene.add(sprite); return sprite;
  }
  disposeScene() {
    if (!this.scene) return;
    const geometries = new Set(), materials = new Set(), textures = new Set();
    this.scene.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const m of [].concat(o.material)) { materials.add(m); if (m.map) textures.add(m.map); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
  }
  build(stage) {
    this.disposeScene(); this.stage = stage; this.particles = []; this.scene = new THREE.Scene();
    const [sky, stone, dark, light] = stage.colors, rng = random(791 + stage.index * 913);
    this.scene.background = new THREE.Color(sky);
    this.scene.add(new THREE.HemisphereLight(light, dark, 2.5));
    const sun = new THREE.DirectionalLight(0xffead4, 3.1); sun.position.set(-25, 45, 30); this.scene.add(sun);
    const rim = new THREE.DirectionalLight(light, 2); rim.position.set(35, 20, -15); this.scene.add(rim);
    // Authored skyline silhouettes, triangulated into quiet rear facets. Their
    // muted unlit colors distinguish scenery from the bright solid flight shelf.
    const profiles = {
      lunar: [12, 18, 16, 23, 20, 10, 8, 13, 9, 18, 14, 21, 12],
      desert: [12, 12, 22, 22, 11, 9, 15, 15, 7, 19, 19, 10, 14],
      garden: [11, 17, 19, 16, 13, 9, 11, 13, 10, 16, 18, 15, 10],
      ice: [13, 26, 12, 29, 16, 9, 21, 13, 28, 16, 23, 11, 19],
      volcanic: [10, 13, 20, 25, 19, 16, 15, 19, 24, 16, 10, 15, 12],
      industrial: [9, 15, 15, 10, 10, 19, 19, 12, 12, 22, 22, 10, 9]
    };
    for (let layer = 0; layer < 3; layer++) {
      const positions = [], colors = [];
      const profile = profiles[stage.theme];
      for (let i = 0; i < profile.length - 1; i++) {
        const x = -66 + i * 11 + layer * 3;
        const h1 = profile[i] * (1 - layer * .22), h2 = profile[i + 1] * (1 - layer * .22);
        const triangles = [[[x, 0], [x, h1], [x + 5, h1 * .25]], [[x, h1], [x + 11, h2], [x + 5, h1 * .25]], [[x + 5, h1 * .25], [x + 11, h2], [x + 11, 0]], [[x, 0], [x + 5, h1 * .25], [x + 11, 0]]];
        for (const [j, tri] of triangles.entries()) {
          const color = new THREE.Color(sky).lerp(new THREE.Color(dark), .3 + layer * .16).multiplyScalar(.9 + j * .05);
          for (const [px, py] of tri) { positions.push(px, py, -38 + layer * 10); colors.push(color.r, color.g, color.b); }
        }
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      this.mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    }
    const starPositions = [];
    for (let i = 0; i < 240; i++) starPositions.push((rng() - .5) * 190, 15 + rng() * 70, -65);
    const stars = new THREE.BufferGeometry(); stars.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    this.scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: light, size: .12, transparent: true, opacity: .7 })));
    const planet = this.mesh(new THREE.IcosahedronGeometry(7.5, 2), mat(light, { roughness: 1 }), 23, 38, -48); planet.rotation.z = .3;
    if (['lunar', 'ice', 'industrial'].includes(stage.theme)) {
      const ring = this.mesh(new THREE.RingGeometry(9, 12, 72), new THREE.MeshBasicMaterial({ color: light, side: THREE.DoubleSide, transparent: true, opacity: .24 }), 23, 38, -47);
      ring.scale.y = .23; ring.rotation.z = -.3;
    }
    if (stage.theme === 'ice' || stage.theme === 'garden') {
      for (let i = 0; i < 5; i++) {
        const points = [[-65, 34 + i], [-30, 41 + i * .5], [5, 38 + i], [45, 46 + i], [65, 43 + i], [65, 44 + i], [5, 40 + i], [-30, 42 + i * .5]];
        this.poly(points, .01, new THREE.MeshBasicMaterial({ color: stage.theme === 'ice' ? 0x85e8d0 : 0xaad782, transparent: true, opacity: .045 + i * .012, side: THREE.DoubleSide }), -55);
      }
    }
    // Faceted cross section of the flight shelf, whose top is exactly y=0.
    this.poly([[-42, -9], [42, -9], [42, 0], [-42, 0]], 8, mat(stone), -7);
    const terrainVertices = [], terrainColors = [];
    for (let i = 0; i < 20; i++) {
      const x = -44 + i * 4.5, mid = -2 - rng() * 3;
      const triangles = [[[x, -.4], [x + 4.5, -.4], [x + 2, mid]], [[x, -.4], [x + 2, mid], [x, -9]], [[x + 4.5, -.4], [x + 4.5, -9], [x + 2, mid]], [[x, -9], [x + 2, mid], [x + 4.5, -9]]];
      for (const tri of triangles) {
        const color = new THREE.Color(dark).lerp(new THREE.Color(stone), rng() * .32);
        for (const [px, py] of tri) { terrainVertices.push(px, py, 1.02); terrainColors.push(color.r, color.g, color.b); }
      }
    }
    const terrainGeo = new THREE.BufferGeometry(); terrainGeo.setAttribute('position', new THREE.Float32BufferAttribute(terrainVertices, 3)); terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(terrainColors, 3));
    this.mesh(terrainGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    this.box(84, .13, .2, mat(light, { emissive: light, emissiveIntensity: .1 }), 0, -.15, 1.2);
    const rockMat = mat(stone);
    for (const [index, p] of stage.obstacles.entries()) {
      this.poly(p, 3.5, rockMat, -3.5);
      const outline = new THREE.BufferGeometry().setFromPoints(p.map(([x, y]) => new THREE.Vector3(x, y, .08)));
      this.scene.add(new THREE.LineLoop(outline, new THREE.LineBasicMaterial({ color: light, transparent: true, opacity: .52 })));
      const high = p.reduce((a, b) => a[1] > b[1] ? a : b);
      const left = Math.min(...p.map(v => v[0])), right = Math.max(...p.map(v => v[0]));
      if (stage.theme === 'industrial') {
        this.box(right - left + .02, .4, 3.6, mat(0xd0a96c), (left + right) / 2, high[1] - .3, -1.7);
        for (let y = 2; y < high[1] - 1; y += 3) {
          this.box(right - left - 1, .4, .08, mat(0x263843), (left + right) / 2, y, .06);
          this.box(.4, .15, .1, mat(0xffc247, { emissive: 0xffb133, emissiveIntensity: 1 }), left + 1, y, .12);
        }
      } else {
        // Facet triangles stay within the shared collision outline.
        this.poly([p[0], high, [left + (right - left) * .48, 0]], .03, mat(new THREE.Color(dark).multiplyScalar(1.1)), .02);
        this.poly([[left + (right - left) * .48, 0], high, p[1]], .03, mat(new THREE.Color(stone).multiplyScalar(.87)), .02);
      }
      this.mesh(new THREE.SphereGeometry(.18, 6, 4), mat(0xffad66, { emissive: 0xff602b, emissiveIntensity: 1.5 }), high[0], high[1] + .2, -.5);
    }
    // Small scenery details occupy only the rear shelf. No hidden collision props.
    for (let i = 0; i < 30; i++) {
      const x = -48 + rng() * 96, scale = .5 + rng() * 1.5;
      if (stage.theme === 'garden') {
        this.mesh(new THREE.CylinderGeometry(.09, .16, 2 * scale, 5), mat(0x244740), x, scale, -10);
        this.mesh(new THREE.IcosahedronGeometry(scale, 0), mat(i % 3 ? 0x79b798 : 0xc7d89a), x, 2.6 * scale, -10);
      } else if (stage.theme === 'ice') {
        const m = this.mesh(new THREE.ConeGeometry(.6 * scale, 3 * scale, 5), mat(0x9ab9dc, { metalness: .3 }), x, scale, -9); m.rotation.z = (rng() - .5) * .4;
      } else if (stage.theme === 'volcanic') {
        this.mesh(new THREE.IcosahedronGeometry(scale, 0), mat(0x302737), x, .2, -9);
        this.box(scale * 1.8, .14, 1, mat(0xff783f, { emissive: 0xff471c, emissiveIntensity: 2 }), x, .3, -8);
      } else this.mesh(new THREE.IcosahedronGeometry(scale, 0), mat(dark), x, .3, -10);
    }
    this.pads = [];
    for (const pad of [stage.start, stage.goal]) {
      const goal = pad.id === 'goal', color = goal ? 0xffc247 : 0x9bd5e3;
      this.box(pad.width, pad.y, 4, mat(0x273742, { metalness: .35 }), pad.x, pad.y / 2, -2);
      this.box(pad.width, .16, 4, mat(color, { emissive: color, emissiveIntensity: .3 }), pad.x, pad.y - .08, -1.95);
      for (let i = 0; i < pad.width - 1; i++) {
        const stripe = this.box(.5, .45, .05, mat(i % 2 ? 0x26313b : color), pad.x - pad.width / 2 + .7 + i, pad.y - .65, .07); stripe.rotation.z = -.35;
      }
      for (const dx of [-pad.width / 2 + .3, pad.width / 2 - .3]) {
        // Lights are below pad height, so the foot-containment boundary stays honest.
        this.mesh(new THREE.SphereGeometry(.22, 8, 5), mat(color, { emissive: color, emissiveIntensity: 2 }), pad.x + dx, pad.y - .28, .25);
      }
      this.label(goal ? '02 / ARRIVAL' : '01 / DEPARTURE', pad.x, -3, 1.55, goal ? '#ffd18c' : '#b6e5f1');
    }
    const boundaryPoints = [];
    for (const x of [-39, 39]) for (let y = 0; y < 48; y += 2) boundaryPoints.push(x, y, .5, x, y + .7, .5);
    for (let x = -39; x < 39; x += 2) boundaryPoints.push(x, 48, .5, x + .7, 48, .5);
    const boundary = new THREE.BufferGeometry(); boundary.setAttribute('position', new THREE.Float32BufferAttribute(boundaryPoints, 3));
    this.scene.add(new THREE.LineSegments(boundary, new THREE.LineBasicMaterial({ color: light, transparent: true, opacity: .2 })));
    this.makeRocket();
    this.shadow = this.mesh(new THREE.CircleGeometry(1.8, 24), new THREE.MeshBasicMaterial({ color: 0x071018, opacity: .3, transparent: true, depthWrite: false }), -27, 3.08, .4);
    this.shadow.scale.y = .16;
    const particleGeo = new THREE.IcosahedronGeometry(1, 0);
    this.dust = new THREE.InstancedMesh(particleGeo, new THREE.MeshBasicMaterial({ color: light, transparent: true, opacity: .42, depthWrite: false }), 80);
    this.dust.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.dust.frustumCulled = false; this.scene.add(this.dust);
    this.dummy = new THREE.Object3D(); this.dust.count = 0;
  }
  makeRocket() {
    this.rocket = new THREE.Group(); this.scene.add(this.rocket);
    const ivory = mat(0xe4e5db, { metalness: .24 }), charcoal = mat(0x293640, { metalness: .5 }), ember = mat(0xff753a, { metalness: .2 }), gold = mat(0xe4bb70, { metalness: .65 });
    this.mesh(new THREE.CylinderGeometry(.53, .67, 1.8, 10), ivory, 0, -.1, 0, this.rocket);
    this.mesh(new THREE.ConeGeometry(.53, .85, 10), ivory, 0, 1.22, 0, this.rocket);
    this.mesh(new THREE.CylinderGeometry(.565, .57, .22, 10), ember, 0, .59, 0, this.rocket);
    this.mesh(new THREE.CylinderGeometry(.64, .43, .38, 10), charcoal, 0, -1.14, 0, this.rocket);
    this.mesh(new THREE.CylinderGeometry(.23, .4, .32, 10, 1, true), gold, 0, -1.36, 0, this.rocket);
    this.mesh(new THREE.SphereGeometry(.3, 10, 8), mat(0x264f64, { metalness: .65, roughness: .2, emissive: 0x316880, emissiveIntensity: .4 }), 0, .18, .48, this.rocket).scale.set(1, 1.1, .4);
    this.box(.08, .35, .03, mat(0xdaf6ed), -.08, .25, .61, this.rocket);
    for (const side of [-1, 1]) {
      const leg = this.box(.13, .9, .18, gold, side * .79, -1.06, .05, this.rocket); leg.rotation.z = side * .36;
      this.box(.38, .14, .42, charcoal, side * .86, -1.52, .05, this.rocket);
      const nozzle = this.mesh(new THREE.CylinderGeometry(.13, .2, .25, 8), charcoal, side * .68, .65, .02, this.rocket); nozzle.rotation.z = side * Math.PI / 2;
    }
    const fire = new THREE.MeshBasicMaterial({ color: 0xffa049, transparent: true, opacity: .86, depthWrite: false });
    const core = new THREE.MeshBasicMaterial({ color: 0xfff0bd });
    this.mainFlame = new THREE.Group(); this.mainFlame.position.y = -1.5; this.rocket.add(this.mainFlame);
    this.mesh(new THREE.ConeGeometry(.34, 2.8, 7), fire, 0, -1.4, 0, this.mainFlame).rotation.z = Math.PI;
    this.mesh(new THREE.ConeGeometry(.18, 1.6, 7), core, 0, -.8, .06, this.mainFlame).rotation.z = Math.PI;
    this.sideFlames = [];
    for (const side of [-1, 1]) {
      const flame = this.mesh(new THREE.ConeGeometry(.15, 1.1, 6), fire, side * 1.29, .65, .03, this.rocket); flame.rotation.z = -side * Math.PI / 2; this.sideFlames.push(flame);
    }
    this.engineLight = new THREE.PointLight(0xff8a40, 0, 8); this.engineLight.position.set(0, -2.5, 2); this.rocket.add(this.engineLight);
  }
  resize() {
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h; this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.viewHeight = Math.max(60, 89 / aspect); if (aspect < 1) this.viewHeight = 66;
    this.viewWidth = this.viewHeight * aspect;
    this.camera.left = -this.viewWidth / 2; this.camera.right = this.viewWidth / 2;
    this.camera.top = this.viewHeight / 2; this.camera.bottom = -this.viewHeight / 2; this.camera.updateProjectionMatrix();
  }
  render(s, dt, preview = false) {
    this.resize();
    const x = this.viewWidth < 83 && !preview ? D.clamp(s.x, -42 + this.viewWidth / 2, 42 - this.viewWidth / 2) : 0;
    const cameraY = this.width < this.height && !preview ? D.clamp(s.y, 15, 48) : 23;
    this.camera.position.set(x, cameraY, 110); this.camera.lookAt(x, cameraY, 0);
    this.rocket.scale.setScalar(preview ? 2.7 : 1);
    this.rocket.position.set(s.x, s.y, 0); this.rocket.rotation.z = -s.angle;
    const lit = !s.paused && s.status === 'flying';
    this.mainFlame.visible = lit && s.main;
    this.mainFlame.scale.y = .86 + .14 * Math.sin(s.elapsed * 75);
    // Leftward tilt uses the right nozzle; rightward tilt uses the left nozzle.
    this.sideFlames[0].visible = lit && s.right; this.sideFlames[1].visible = lit && s.left;
    this.engineLight.intensity = this.mainFlame.visible ? 10 : 0;
    this.rocket.visible = s.status !== 'crashed' || Math.sin(s.elapsed * 9) > -.8;
    let floor = 0;
    for (const pad of [this.stage.start, this.stage.goal]) if (Math.abs(s.x - pad.x) < pad.width / 2) floor = pad.y;
    this.shadow.position.set(s.x, floor + .1, .4); this.shadow.material.opacity = Math.max(.06, .28 - (s.y - floor) * .006);
    if (lit && s.main && dt > 0) {
      const n = Math.sin(s.angle), c = Math.cos(s.angle);
      this.particles.push({ x: s.x - n * 2, y: s.y - c * 2, vx: -n * 9 + Math.sin(s.elapsed * 81), vy: -c * 9, age: 0 });
    }
    this.particles = this.particles.filter(p => p.age < .9).slice(-80);
    this.particles.forEach((p, i) => {
      p.age += dt; p.x += p.vx * dt; p.y += p.vy * dt;
      this.dummy.position.set(p.x, p.y, -.1); this.dummy.scale.setScalar(.13 + p.age * .28); this.dummy.rotation.set(p.age, i, p.age * 2); this.dummy.updateMatrix(); this.dust.setMatrixAt(i, this.dummy.matrix);
    });
    this.dust.count = this.particles.length; this.dust.instanceMatrix.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }
  goalVisible() {
    return Math.abs(this.stage.goal.x - this.camera.position.x) < this.viewWidth / 2 - 5 && Math.abs(this.stage.goal.y - this.camera.position.y) < this.viewHeight / 2 - 5;
  }
}
