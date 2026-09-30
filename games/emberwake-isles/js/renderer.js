import * as THREE from '../vendor/three.module.min.js';
const D = window.EWData,
  W = window.EWWorld,
  M = window.EWMesh;
export class Renderer {
  constructor(canvas, game) {
    this.game = game;
    this.canvas = canvas;
    this.meshes = new Map();
    this.boats = new Map();
    this.lamps = [];
    this.queue = [];
    this.frames = [];
    this.intervals = [];
    this.lastRender = 0;
    this.lastChunk = '';
    this.cropRevision = '';
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.scene = new THREE.Scene();
    this.far = new THREE.Scene();
    this.far.background = new THREE.Color('#87b8bc');
    this.scene.fog = new THREE.Fog('#87b8bc', 46, 86);
    this.far.fog = new THREE.Fog('#87b8bc', 125, 600);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, .06, 850);
    this.camera.rotation.order = 'YXZ';
    this.ambient = new THREE.HemisphereLight('#fff1cf', '#829da2', 2);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight('#fff0d1', 2);
    this.sun.position.set(-80, 150, 40);
    this.scene.add(this.sun);
    this.headlight = new THREE.PointLight('#ffe4b2', 16, 16, 1.1);
    this.scene.add(this.headlight);
    const water = [];
    for (let z = -800; z < 800; z += 32) for (let x = -800; x < 800; x += 32) {
      const coast = D.islands.some(i => Math.abs(x + 16 - i.x) < i.rx + 28 && Math.abs(z + 16 - i.z) < i.rz + 28)
        || D.islets.some(i => Math.hypot(x + 16 - i.x, z + 16 - i.z) < i.r + 32);
      const step = coast ? 8 : 32;
      for (let zz = z; zz < z + 32; zz += step) for (let xx = x; xx < x + 32; xx += step) {
        if (coast && [[xx, zz], [xx + step, zz], [xx, zz + step], [xx + step, zz + step]].every(([px, pz]) => W.column(px, pz, game.state.seed).h >= D.C.sea)) continue;
        water.push(xx, 0, zz + step, xx + step, 0, zz + step, xx + step, 0, zz, xx, 0, zz + step, xx + step, 0, zz, xx, 0, zz);
      }
    }
    const oceanGeometry = new THREE.BufferGeometry();
    oceanGeometry.setAttribute('position', new THREE.Float32BufferAttribute(water, 3));
    oceanGeometry.computeVertexNormals();
    this.ocean = new THREE.Mesh(oceanGeometry, new THREE.MeshPhongMaterial({
      color: '#338f99',
      transparent: true,
      opacity: .86,
      shininess: 85,
      side: THREE.DoubleSide,
      specular: '#d9efdf'
    }));
    this.ocean.position.y = D.C.sea - .1;
    this.scene.add(this.ocean);
    const horizonGeometry = new THREE.PlaneGeometry(1600, 1600);
    horizonGeometry.rotateX(-Math.PI / 2);
    const farOcean = new THREE.Mesh(horizonGeometry, new THREE.MeshBasicMaterial({
      color: '#559ba5'
    }));
    farOcean.position.y = D.C.sea - .2;
    this.far.add(farOcean);
    this.material = new THREE.MeshLambertMaterial({
      vertexColors: true
    });
    this.ready = new Promise((resolve, reject) => new THREE.TextureLoader().load('assets/atlas.png', texture => {
      texture.magFilter = THREE.NearestFilter;
      texture.minFilter = THREE.NearestFilter;
      texture.colorSpace = THREE.SRGBColorSpace;
      this.material.map = texture;
      this.material.needsUpdate = true;
      resolve();
    }, undefined, reject));
    this.target = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.015, 1.015, 1.015)), new THREE.LineBasicMaterial({
      color: '#ffdc83',
      depthTest: true
    }));
    this.scene.add(this.target);
    this.sunDisc = new THREE.Mesh(new THREE.SphereGeometry(13, 16, 12), new THREE.MeshBasicMaterial({
      color: '#ffedba',
      fog: false
    }));
    this.sunDisc.position.set(-240, 260, -430);
    this.far.add(this.sunDisc);
    this.distant = [];
    this.makeDistant();
    this.makeClouds();
    this.makeBuoys();
    for (let n = 0; n < 6; n++) {
      const lamp = new THREE.PointLight('#ffd293', 8, 10, 1.1);
      this.lamps.push(lamp);
      this.scene.add(lamp);
    }
    this.cropGroup = new THREE.Group();
    this.scene.add(this.cropGroup);
    this.boatGeometries = [];
    this.resize = () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener('resize', this.resize);
  }
  makeDistant() {
    for (const island of D.islands) {
      const positions = [],
        colors = [];
      for (let z = island.z - island.rz - 10; z < island.z + island.rz + 10; z += 8) for (let x = island.x - island.rx - 10; x < island.x + island.rx + 10; x += 8) {
        const pts = [[x, z], [x + 8, z], [x, z + 8], [x + 8, z], [x + 8, z + 8], [x, z + 8]];
        const col = new THREE.Color(island.color).lerp(new THREE.Color('#7dabad'), .55);
        for (const [px, pz] of pts) {
          const h = W.column(px, pz, this.game.state.seed).h;
          positions.push(px, Math.max(11.7, h + .1), pz);
          colors.push(col.r, col.g, col.b);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geo.computeVertexNormals();
      const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
        transparent: true
      });
      const mesh = new THREE.Mesh(geo, mat);
      this.far.add(mesh);
      this.distant.push({
        island,
        mesh
      });
    }
  }
  makeBuoys() {
    // Navigational markers only; no invisible force pushes the player outward.
    for (const [width, height, elevation, color] of [[1.4, .45, 12.1, '#50666d'], [.18, 1.6, 13, '#dfc99d'], [.55, .5, 13.9, '#ffc247']]) {
      const buoys = new THREE.InstancedMesh(new THREE.BoxGeometry(width, height, width), new THREE.MeshBasicMaterial({ color }), 128);
      const matrix = new THREE.Matrix4();
      for (let n = 0; n < 128; n++) {
        const angle = n / 128 * Math.PI * 2;
        matrix.makeTranslation(Math.sin(angle) * D.C.danger, elevation, Math.cos(angle) * D.C.danger);
        buoys.setMatrixAt(n, matrix);
      }
      this.scene.add(buoys);
    }
  }
  makeClouds() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({
      color: '#f5ebd9',
      transparent: true,
      opacity: .6
    });
    for (let j = 0; j < 24; j++) {
      const cloud = new THREE.Mesh(new THREE.BoxGeometry(28 + j % 3 * 13, 3, 12 + j % 4 * 7), mat);
      cloud.position.set((W.rand(j, 4, 8) - .5) * 1200, 105 + j % 5 * 9, (W.rand(j, 8, 12) - .5) * 1200);
      g.add(cloud);
    }
    this.clouds = g;
    this.far.add(g);
  }
  geometry(data) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(data.normals, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(data.uvs, 2));
    g.setAttribute('color', new THREE.BufferAttribute(data.colors, 3));
    g.setIndex(new THREE.BufferAttribute(data.indices, 1));
    g.computeBoundingSphere();
    return g;
  }
  updateChunks() {
    const p = this.game.state.player,
      cx = Math.floor(p.x / 16),
      cz = Math.floor(p.z / 16),
      r = this.game.state.settings.view,
      world = this.game.world;
    const ck = `${cx},${cz},${r}`;
    if (ck !== this.lastChunk) {
      this.lastChunk = ck;
      this.queue = [];
      for (let z = cz - r; z <= cz + r; z++) for (let x = cx - r; x <= cx + r; x++) if (!this.meshes.has(`${x},${z}`)) this.queue.push([x, z]);
      this.queue.sort((a, b) => Math.hypot(a[0] - cx, a[1] - cz) - Math.hypot(b[0] - cx, b[1] - cz));
      for (const [k, mesh] of this.meshes) {
        const [x, z] = k.split(',').map(Number);
        if (Math.abs(x - cx) > r || Math.abs(z - cz) > r) {
          mesh.geometry.dispose();
          this.scene.remove(mesh);
          this.meshes.delete(k);
        }
      }
      world.unload(p.x, p.z, r + 1);
    }
    let builds = 0;
    const started = performance.now();
    for (const k of world.dirty) {
      if (this.meshes.has(k)) {
        const [x, z] = k.split(',').map(Number);
        const mesh = this.meshes.get(k);
        mesh.geometry.dispose();
        mesh.geometry = this.geometry(M.mesh(world, x, z));
        builds++;
      }
      world.dirty.delete(k);
      if (builds >= 2) break;
    }
    while (this.queue.length && builds < 2 && performance.now() - started < 10) {
      const [x, z] = this.queue.shift(),
        k = `${x},${z}`;
      if (!this.meshes.has(k)) {
        const mesh = new THREE.Mesh(this.geometry(M.mesh(world, x, z)), this.material);
        this.meshes.set(k, mesh);
        this.scene.add(mesh);
        builds++;
      }
    }
    // Physics can create chunks outside the renderer. Cull the data cache even while stationary.
    if (this.queue.length === 0) world.unload(p.x, p.z, r + 1);
  }
  makeBoat(type) {
    const g = new THREE.Group(),
      wood = new THREE.MeshLambertMaterial({
        color: '#b7895b'
      }),
      cloth = new THREE.MeshLambertMaterial({
        color: '#f3dfb4',
        side: THREE.DoubleSide
      });
    const add = (w, h, d, x, y, z, mat) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      this.boatGeometries.push(geometry);
      const mesh = new THREE.Mesh(geometry, mat);
      mesh.position.set(x, y, z);
      g.add(mesh);
    };
    add(2.3, .28, 4.6, 0, 0, 0, wood);
    for (let j = -1; j <= 1; j++) add(.38, .32, 4.9, j, .0, 0, wood);
    add(.13, 3.2, .13, -.8, 1.6, .9, wood);
    add(1.8, 2, .055, .05, 2.3, .9, cloth);
    add(2.4, .08, .12, 0, 1.35, .9, wood);
    if (type === 'cutter') {
      add(.4, .4, 4, -1.9, 0, 0, wood);
      add(4, .1, .15, 0, .25, 1, wood);
      add(4, .1, .15, 0, .25, -1, wood);
    }
    return g;
  }
  updateBoats() {
    const t = this.game.state.time;
    for (const boat of this.game.state.boats) {
      let mesh = this.boats.get(boat.id);
      if (!mesh) {
        mesh = this.makeBoat(boat.type);
        this.boats.set(boat.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(boat.x, D.C.sea + .08 + Math.sin(t * 1.8) * .045, boat.z);
      mesh.rotation.set(0, boat.yaw, Math.sin(t * 1.4) * .012);
    }
  }
  updateCrops() {
    const s = this.game.state,
      signature = Object.entries(s.crops).map(([k, c]) => `${k}:${s.time >= c.ready ? 2 : s.time >= c.ready - 55 ? 1 : 0}`).join('|');
    if (signature === this.cropRevision) return;
    this.cropRevision = signature;
    for (const child of [...this.cropGroup.children]) {
      child.geometry.dispose();
      child.material.dispose();
      this.cropGroup.remove(child);
    }
    const groups = [[], []];
    for (const [k, c] of Object.entries(s.crops)) {
      const [x, y, z] = W.decodeKey(k),
        grow = s.time >= c.ready ? 1 : s.time >= c.ready - 55 ? .65 : .3;
      for (let j = 0; j < 4; j++) groups[c.type === 'grain' ? 0 : 1].push([x + .25 + j % 2 * .5, y + .22, z + .25 + Math.floor(j / 2) * .5, grow]);
    }
    for (let j = 0; j < 2; j++) {
      const list = groups[j];
      if (!list.length) continue;
      const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(.15, 1, .15), new THREE.MeshLambertMaterial({
          color: j ? '#92b36a' : '#e4c174'
        }), list.length),
        matrix = new THREE.Matrix4();
      list.forEach(([x, y, z, h], index) => {
        matrix.compose(new THREE.Vector3(x, y + h * .35, z), new THREE.Quaternion(), new THREE.Vector3(1, h * .7, 1));
        mesh.setMatrixAt(index, matrix);
      });
      this.cropGroup.add(mesh);
    }
  }
  render(dt = 0) {
    const started = performance.now();
    if (this.lastRender && dt) {
      this.intervals.push(started - this.lastRender);
      if (this.intervals.length > 180) this.intervals.shift();
    }
    this.lastRender = started;
    const s = this.game.state,
      p = s.player,
      eye = this.game.eye();
    this.updateChunks();
    this.updateBoats();
    this.updateCrops();
    const angle = s.time / 1200 * Math.PI * 2,
      day = .72 + Math.sin(angle) * .28,
      sky = new THREE.Color('#87b8bc').multiplyScalar(day);
    this.far.background.copy(sky);
    this.far.fog.color.copy(sky);
    this.scene.fog.color.copy(sky);
    this.ambient.intensity = 1.25 + day * .75;
    this.sun.intensity = day * 2;
    this.camera.position.set(eye.x, eye.y, eye.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0);
    this.headlight.position.copy(this.camera.position);
    this.headlight.intensity = this.game.world.get(p.x, Math.min(79, p.y + 5), p.z) ? 30 : 8;
    const storm = s.status === 'disaster' || s.status === 'dead';
    if (!storm) {
      this.scene.fog.far = s.settings.view * 16 - 2;
      this.scene.fog.near = this.scene.fog.far * .58;
    }
    if (storm) {
      const amount = Math.min(1, s.disaster / 5);
      this.camera.rotation.z = Math.sin(s.disaster * 1.2) * amount * .18;
      this.far.background.set('#263d4f');
      this.scene.fog.color.set('#263d4f');
      this.scene.fog.near = 8;
      this.scene.fog.far = 75;
      this.ocean.position.y = D.C.sea + amount * 4 + Math.sin(s.disaster) * .4;
    }
    const hit = this.game.target();
    this.target.visible = !!hit && !storm;
    if (hit) this.target.position.set(hit.x + .5, hit.y + .5, hit.z + .5);
    for (const {
      island,
      mesh
    } of this.distant) {
      const d = Math.hypot(p.x - island.x, p.z - island.z);
      mesh.visible = d > 145;
      mesh.material.opacity = Math.min(1, Math.max(0, (d - 145) / 40));
    }
    const lights = [];
    for (const [k, id] of Object.entries(s.placed)) {
      const b = D.blocks[id];
      if (b.category === 'light') {
        const [x, y, z] = W.decodeKey(k),
          dist = Math.hypot(x - p.x, z - p.z);
        if (dist < 20) lights.push({
          x,
          y,
          z,
          dist,
          id
        });
      }
    }
    lights.sort((a, b) => a.dist - b.dist);
    this.lamps.forEach((l, n) => {
      l.visible = !!lights[n];
      if (lights[n]) {
        const a = lights[n];
        l.position.set(a.x + .5, a.y + 1.2, a.z + .5);
        l.color.set(a.id === D.ids.prismLamp ? '#83e8e3' : '#ffd293');
      }
    });
    this.clouds.position.x = Math.sin(s.time / 180) * 12;
    this.renderer.info.reset();
    this.renderer.clear();
    this.renderer.render(this.far, this.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, this.camera);
    this.frames.push(performance.now() - started);
    if (this.frames.length > 180) this.frames.shift();
  }
  stats() {
    return {
      chunks: this.meshes.size,
      cached: this.game.world.chunks.size,
      queued: this.queue.length,
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      medianFrameMs: [...this.intervals].sort((a, b) => a - b)[Math.floor(this.intervals.length * .5)] || 0,
      p95FrameMs: [...this.intervals].sort((a, b) => a - b)[Math.floor(this.intervals.length * .95)] || 0,
      meanRenderMs: this.frames.reduce((a, b) => a + b, 0) / Math.max(1, this.frames.length)
    };
  }
  dispose() {
    removeEventListener('resize', this.resize);
    for (const scene of [this.scene, this.far]) scene.traverse(o => {
      o.geometry?.dispose();
      if (o.material) {
        const materials = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of materials) {
          m.map?.dispose();
          m.dispose();
        }
      }
    });
    this.renderer.dispose();
  }
}
