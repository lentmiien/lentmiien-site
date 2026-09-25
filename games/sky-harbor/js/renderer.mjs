import * as THREE from '../vendor/three.module.min.js';
const W = window.SkyWorld;
const rgb = color => new THREE.Color(color);
export class FlightRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor('#bdd6d4');
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#bdd6d4', 6500, 15500);
    this.camera = new THREE.PerspectiveCamera(58, 1, 1, 24000);
    this.scene.add(new THREE.HemisphereLight('#fff1d0', '#526a70', 2.6));
    const sun = new THREE.DirectionalLight('#ffe1ad', 2.4);
    sun.position.set(-6000, 10000, 3000);
    this.scene.add(sun);
    this.materials = new Map();
    this.buildTerrain();
    this.buildScenery();
    this.buildAirports();
    this.batchStatic();
    this.buildPlane();
    this.gates = new THREE.Group();
    this.scene.add(this.gates);
    this.cameraReady = false;
    this.resize();
  }
  mat(color) {
    if (!this.materials.has(color)) this.materials.set(color, new THREE.MeshStandardMaterial({
      color,
      roughness: .93,
      flatShading: true
    }));
    return this.materials.get(color);
  }
  mesh(geometry, color, x, y, z, parent = this.scene) {
    const m = new THREE.Mesh(geometry, this.mat(color));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  }
  box(w, h, d, color, x, y, z, parent) {
    return this.mesh(new THREE.BoxGeometry(w, h, d), color, x, y, z, parent);
  }
  buildTerrain() {
    const positions = [],
      colors = [];
    const c = new THREE.Color();
    for (let z = -W.HALF; z < W.HALF; z += W.STEP) for (let x = -W.HALF; x < W.HALF; x += W.STEP) {
      const v = [[x, W.nodeHeight(x, z), z], [x + W.STEP, W.nodeHeight(x + W.STEP, z), z], [x, W.nodeHeight(x, z + W.STEP), z + W.STEP], [x + W.STEP, W.nodeHeight(x + W.STEP, z + W.STEP), z + W.STEP]];
      for (const tri of [[0, 2, 1], [1, 2, 3]]) {
        const h = tri.reduce((sum, i) => sum + v[i][1], 0) / 3;
        const field = ((Math.floor(x / 600) + 2 * Math.floor(z / 450)) % 5 + 5) % 5;
        let color = h < 7 ? '#d7ca9c' : h > 770 ? '#d6d9ce' : h > 570 ? '#8e9a89' : x > 3100 && z < -2000 ? ['#be9869', '#cfa97a', '#b99367', '#d6b480', '#c1a076'][field] : z > 2300 && x > -9000 && x < 2000 ? ['#9aaf72', '#c4bd80', '#809764', '#b7b983', '#a4b67b'][field] : '#7f9c79';
        c.set(color);
        c.multiplyScalar(1 + .035 * Math.sin(x * .041 + z * .033 + tri[0]));
        for (const i of tri) {
          positions.push(...v[i]);
          colors.push(c.r, c.g, c.b);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    this.scene.add(new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 1
    })));
    const sea = this.mesh(new THREE.PlaneGeometry(90000, 90000), '#4c9da9', 0, -.3, 0);
    sea.rotation.x = -Math.PI / 2;
    // Coastal ribbons are deliberately simple, local geometry, not expensive reflections.
    const r = W.random(832);
    const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({
      color: '#eef0dd'
    }), 160);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 160; i++) {
      dummy.position.set((r() - .5) * 40000, 2200 + r() * 1100, (r() - .5) * 40000);
      dummy.scale.set(180 + r() * 220, 35 + r() * 60, 90 + r() * 130);
      dummy.updateMatrix();
      clouds.setMatrixAt(i, dummy.matrix);
    }
    this.scene.add(clouds);
  }
  buildScenery() {
    const groups = [['tree', new THREE.ConeGeometry(1, 1, 5), '#426f5d'], ['rock', new THREE.IcosahedronGeometry(1, 0), '#a7967c'], ['house', new THREE.BoxGeometry(1, 1, 1), '#dfccac']];
    const dummy = new THREE.Object3D();
    for (const [type, geometry, color] of groups) {
      // Chunking allows normal frustum culling of instanced scenery.
      const chunks = new Map();
      for (const o of W.obstacles.filter(o => o.type === type)) {
        const key = `${Math.floor(o.x / 3000)},${Math.floor(o.z / 3000)}`;
        if (!chunks.has(key)) chunks.set(key, []);
        chunks.get(key).push(o);
      }
      for (const list of chunks.values()) {
        const m = new THREE.InstancedMesh(geometry, this.mat(color), list.length);
        list.forEach((o, i) => {
          dummy.position.set(o.x, o.y + o.height / 2, o.z);
          dummy.scale.set(o.radius, type === 'rock' ? o.height / 2 : o.height, o.radius);
          dummy.rotation.y = o.x * .17;
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
        });
        m.computeBoundingSphere();
        this.scene.add(m);
      }
    }
  }
  batchStatic() {
    this.scene.updateMatrixWorld(true);
    const groups = new Map();
    this.scene.traverse(object => {
      if (!object.isMesh || object.isInstancedMesh || object.geometry.attributes.position.count > 10000) return;
      if (!groups.has(object.material)) groups.set(object.material, []);
      groups.get(object.material).push(object);
    });
    for (const [material, objects] of groups) {
      if (objects.length < 2) continue;
      const positions = [],
        normals = [],
        uvs = [];
      for (const object of objects) {
        const g = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
        g.applyMatrix4(object.matrixWorld);
        positions.push(...g.attributes.position.array);
        normals.push(...g.attributes.normal.array);
        if (g.attributes.uv) uvs.push(...g.attributes.uv.array);
        g.dispose();
        object.parent.remove(object);
        object.geometry.dispose();
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
      if (uvs.length === positions.length / 3 * 2) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
      this.scene.add(new THREE.Mesh(geometry, material));
    }
  }
  paintRunway(a) {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 2048;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#424f50';
    ctx.fillRect(0, 0, 128, 2048);
    ctx.fillStyle = '#e9e5cc';
    ctx.fillRect(4, 12, 2, 2024);
    ctx.fillRect(122, 12, 2, 2024);
    for (let y = 250; y < 1800; y += 95) ctx.fillRect(62, y, 4, 48);
    for (let i = 0; i < 8; i++) {
      ctx.fillRect(10 + i * 14, 38, 9, 94);
      ctx.fillRect(10 + i * 14, 1916, 9, 94);
    }
    ctx.font = 'bold 64px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(W.runwayNumber(a.heading), 64, 1850);
    ctx.save();
    ctx.translate(128, 2048);
    ctx.rotate(Math.PI);
    ctx.fillText(W.runwayNumber((a.heading + 180) % 360), 64, 1850);
    ctx.restore();
    for (const y of [300, 1710]) {
      ctx.fillRect(22, y, 15, 58);
      ctx.fillRect(91, y, 15, 58);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 1
    });
  }
  buildAirports() {
    for (const a of W.airports) {
      const group = new THREE.Group();
      group.position.set(a.x, a.elevation, a.z);
      group.rotation.y = -a.heading * W.DEG;
      this.scene.add(group);
      this.box(280, .12, 650, '#a2aa98', 100, .08, 0, group);
      this.box(26, .15, 1000, '#68756d', 95, .16, 0, group);
      for (const z of [-430, 0, 430]) this.box(110, .17, 25, '#68756d', 48, .18, z, group);
      const runway = new THREE.Mesh(new THREE.PlaneGeometry(a.width, a.length), this.paintRunway(a));
      runway.rotation.x = -Math.PI / 2;
      runway.position.y = .27;
      group.add(runway);
      for (let i = 0; i < 5; i++) {
        const z = -(i - 2) * 95;
        this.box(44, i === 2 ? 22 : 14, 40, i === 2 ? '#e8dabc' : '#bfc8bb', 170, i === 2 ? 11 : 7, z, group);
        this.box(46, 2, 42, '#506d72', 170, i === 2 ? 23 : 15, z, group);
        this.box(1, 9, 32, '#506b70', 147.8, 5, z, group);
        if (i === 2) {
          this.box(14, 4, 16, '#457681', 170, 25, z, group);
        }
      }
      for (let z = -680; z <= 680; z += 80) for (const x of [-34, 34]) this.box(1.4, .7, 2, '#fff3c3', x, .5, z, group);
      for (let z = 760; z < 1250; z += 80) this.box(9, .6, 2, '#f6d19a', 0, .35, z, group);
      // Windsock sits beside the apron, clear of both approach lanes.
      this.mesh(new THREE.CylinderGeometry(.5, .5, 14, 6), '#e6d9b7', 240, 7, 260, group);
      const sock = this.mesh(new THREE.ConeGeometry(2, 9, 7), '#e87d49', 244, 14, 260, group);
      sock.rotation.z = -Math.PI / 2;
    }
  }
  buildPlane() {
    this.plane = new THREE.Group();
    this.scene.add(this.plane);
    const p = this.plane;
    const body = this.mesh(new THREE.SphereGeometry(1, 10, 6), '#f0e2bb', 0, .4, 0, p);
    body.scale.set(.95, .85, 4.2);
    const nose = this.mesh(new THREE.SphereGeometry(1, 8, 5), '#f16b36', 0, .4, -3.1, p);
    nose.scale.set(.94, .78, 1.25);
    const canopy = this.mesh(new THREE.SphereGeometry(1, 8, 5), '#416c79', 0, 1.05, -.45, p);
    canopy.scale.set(.79, .74, 1.4);
    this.box(12.4, .18, 1.65, '#f0e2bb', 0, 1.18, .1, p);
    for (const x of [-5.5, 5.5]) this.box(1.4, .22, 1.7, '#ed713b', x, 1.19, .1, p);
    this.box(4, .14, 1.05, '#f0e2bb', 0, .66, 3.15, p);
    this.box(.16, 1.8, 1.45, '#ed713b', 0, 1.25, 3.2, p);
    for (const x of [-1.5, 1.5]) {
      const strut = this.box(.08, 1.7, .08, '#586b6b', x, .45, .2, p);
      strut.rotation.z = x > 0 ? .7 : -.7;
      this.box(.13, 1.3, .13, '#687777', x * .6, -.7, -.6, p);
      const wheel = this.mesh(new THREE.CylinderGeometry(.38, .38, .22, 10), '#28373c', x * .6, -1.25, -.6, p);
      wheel.rotation.z = Math.PI / 2;
    }
    const tailwheel = this.mesh(new THREE.CylinderGeometry(.22, .22, .18, 8), '#28373c', 0, -.55, 3, p);
    tailwheel.rotation.z = Math.PI / 2;
    this.propeller = this.box(.12, 3.3, .08, '#3b5057', 0, .4, -4.25, p);
    this.shadow = this.mesh(new THREE.CircleGeometry(7, 20), '#435e57', 0, .1, 0);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.material = new THREE.MeshBasicMaterial({
      color: '#233d35',
      transparent: true,
      opacity: .2,
      depthWrite: false
    });
  }
  route(a) {
    for (const c of [...this.gates.children]) {
      c.geometry?.dispose();
      c.material?.dispose();
      this.gates.remove(c);
    }
    for (const d of [3200, 2400, 1600, 800, 200]) {
      const p = W.point(a, -a.length / 2 - d),
        altitude = a.elevation + 2 + (d + 210) * .075;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-65, -15, 0), new THREE.Vector3(-65, 30, 0), new THREE.Vector3(65, 30, 0), new THREE.Vector3(65, -15, 0)]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({
        color: '#ffd36f',
        transparent: true,
        opacity: .85
      }));
      line.position.set(p.x, altitude, p.z);
      line.rotation.y = -a.heading * W.DEG;
      this.gates.add(line);
    }
    this.cameraReady = false;
  }
  resize() {
    const width = innerWidth,
      height = innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  render(s, dt, far = false) {
    this.plane.position.set(s.x, s.y, s.z);
    this.plane.rotation.set(s.pitch * W.DEG, -s.heading * W.DEG, -s.bank * W.DEG, 'YXZ');
    this.propeller.rotation.z += (s.paused ? 0 : s.throttle * 65 + 3) * dt;
    const h = W.height(s.x, s.z);
    this.shadow.position.set(s.x, Math.max(0, h) + .4, s.z);
    this.shadow.visible = s.y - h < 100;
    const heading = s.heading * W.DEG,
      length = far ? 48 : 29;
    const desired = new THREE.Vector3(s.x - Math.sin(heading) * length, s.y + (far ? 13 : 8), s.z + Math.cos(heading) * length);
    if (!this.cameraReady) {
      this.camera.position.copy(desired);
      this.cameraReady = true;
    } else this.camera.position.lerp(desired, 1 - Math.exp(-5 * dt));
    this.camera.position.y = Math.max(this.camera.position.y, W.height(this.camera.position.x, this.camera.position.z) + 4);
    this.camera.lookAt(s.x + Math.sin(heading) * 90, s.y - (this.camera.aspect > 1.8 ? 18 : 12), s.z - Math.cos(heading) * 90);
    this.renderer.render(this.scene, this.camera);
  }
}
