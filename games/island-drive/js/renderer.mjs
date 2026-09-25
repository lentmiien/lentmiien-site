import * as THREE from '../vendor/three.module.min.js';

export class IslandRenderer {
  constructor(canvas, world, terrain) {
    this.world = world;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.65));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xb6d7d8);
    this.scene.fog = new THREE.FogExp2(0xb6d7d8, 0.00068);
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.5, 3600);
    this.scene.add(new THREE.HemisphereLight(0xe7f3e6, 0x69785a, 1.6));
    const sun = new THREE.DirectionalLight(0xffe6b3, 2.0);
    sun.position.set(-400, 700, 250);
    this.scene.add(sun);
    this.materials = new Map();
    this.batches = new Map();
    this.geometries = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cone: new THREE.ConeGeometry(1, 1, 7),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 8),
      rock: new THREE.IcosahedronGeometry(1, 0),
      sphere: new THREE.IcosahedronGeometry(1, 1),
    };
    this.makeTerrain(terrain);
    this.makeWater();
    for (const object of world.obstacles) this.makeObject(object);
    this.flushBatches();
    this.makeClouds();
    this.makeMarkers();
    this.car = null;
    this.wheels = [];
    this.cameraReady = false;
    this.look = new THREE.Vector3();
    this.labels = [];
    this.landmarkLabels();
    this.resize();
  }
  material(color) {
    if (!this.materials.has(color))
      this.materials.set(color, new THREE.MeshLambertMaterial({ color, flatShading: true }));
    return this.materials.get(color);
  }
  add(shape, color, x, y, z, sx, sy, sz, rotation = 0) {
    const key = `${shape}:${color}`;
    if (!this.batches.has(key)) this.batches.set(key, { shape, color, items: [] });
    this.batches.get(key).items.push({ x, y, z, sx, sy, sz, rotation });
  }
  flushBatches() {
    const dummy = new THREE.Object3D();
    for (const { shape, color, items } of this.batches.values()) {
      const mesh = new THREE.InstancedMesh(
        this.geometries[shape],
        this.material(color),
        items.length
      );
      items.forEach((p, i) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.set(p.sx, p.sy, p.sz);
        dummy.rotation.set(0, p.rotation, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
    }
    this.batches.clear();
  }
  makeTerrain(image) {
    const { size, step } = this.world;
    const positions = [],
      uvs = [],
      colors = [],
      indices = [];
    const n = size / step;
    const color = new THREE.Color();
    for (let z = 0; z <= n; z++)
      for (let x = 0; x <= n; x++) {
        const wx = x * step - size / 2,
          wz = z * step - size / 2,
          h = this.world.height(wx, wz);
        positions.push(wx, h, wz);
        uvs.push(x / n, 1 - z / n);
        color.set(h < 5 ? 0xf5d9a4 : h < 10 ? 0xd8c99b : h > 100 ? 0xc7c8ae : 0xffffff);
        colors.push(color.r, color.g, color.b);
      }
    for (let z = 0; z < n; z++)
      for (let x = 0; x < n; x++) {
        const a = z * (n + 1) + x,
          b = a + 1,
          c = a + n + 1,
          d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const texture = new THREE.Texture(image);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    texture.needsUpdate = true;
    this.scene.add(
      new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: texture, vertexColors: true }))
    );
  }
  makeWater() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(16000, 16000),
      new THREE.MeshPhongMaterial({
        color: 0x478a97,
        shininess: 75,
        specular: 0x96c8c1,
        transparent: true,
        opacity: 0.92,
      })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.y = -0.1;
    this.scene.add(water);
    // Coastal foam follows the analytic shoreline, entirely outside the playable road network.
    const points = [];
    for (let i = 0; i <= 240; i++) {
      const a = (i / 240) * Math.PI * 2,
        r = 1060 + 65 * Math.sin(a * 3 + 0.6) + 35 * Math.cos(a * 5);
      points.push(new THREE.Vector3(Math.cos(a) * r, 0.13, (Math.sin(a) * r) / 1.05));
    }
    this.scene.add(
      new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(points),
        new THREE.LineBasicMaterial({ color: 0xd4e2c9, transparent: true, opacity: 0.8 })
      )
    );
  }
  makeObject(o) {
    const { x, y, z } = o;
    if (o.type === 'tree') {
      const s = o.scale;
      this.add('cylinder', 0x766348, x, y + 3 * s, z, 0.65 * s, 6 * s, 0.65 * s);
      if (o.pine) {
        this.add('cone', 0x426f58, x, y + 8 * s, z, 4.1 * s, 12 * s, 4.1 * s);
        this.add('cone', 0x527c5e, x, y + 12 * s, z, 3 * s, 9 * s, 3 * s);
      } else {
        this.add('sphere', 0x6d915e, x, y + 9 * s, z, 4.3 * s, 6 * s, 4.3 * s);
        this.add('sphere', 0x879d62, x, y + 12 * s, z, 3.2 * s, 4 * s, 3.2 * s);
      }
    } else if (o.type === 'rock') {
      const s = Math.min(o.radius, o.scale);
      this.add('rock', 0x96998a, x, y + s * 0.3, z, s, s * 0.85, s, 0.8);
    } else if (o.type === 'lamp') {
      this.add('cylinder', 0x36464a, x, y + 3.5, z, 0.16, 7, 0.16);
      this.add('box', 0x36464a, x, y + 7, z, 1.8, 0.22, 1.2);
      this.add('box', 0xf7df98, x, y + 6.8, z, 1.3, 0.24, 0.8);
    } else if (o.type === 'lighthouse') {
      this.add('cylinder', 0xded9c1, x, y + 14, z, 5.3, 28, 5.3);
      this.add('cylinder', 0xc86b4c, x, y + 18, z, 5.4, 4, 5.4);
      this.add('cylinder', 0x40565b, x, y + 29, z, 7, 1, 7);
      this.add('cylinder', 0x9ababb, x, y + 32, z, 3.8, 5, 3.8);
      this.add('cone', 0xbd674c, x, y + 36, z, 6, 4, 6);
      this.add('cylinder', 0xc0b997, x, y + 0.5, z, 11, 1, 11);
    } else if (o.type === 'tower') {
      for (const dx of [-6, 6])
        for (const dz of [-6, 6]) this.add('box', 0x6c6454, x + dx, y + 13, z + dz, 0.7, 26, 0.7);
      this.add('box', 0xb5ad85, x, y + 24, z, 16, 1, 16);
      this.add('cone', 0x597170, x, y + 30, z, 11, 6, 11, Math.PI / 4);
      this.add('box', 0x8b8270, x, y + 12, z, 1, 24, 1);
    } else {
      const special = o.type !== 'building';
      const w = o.w || (o.type === 'barn' ? 24 : 18),
        d = o.depth || (o.type === 'barn' ? 20 : 16),
        h = o.h || (o.type === 'chapel' ? 15 : 9);
      const palette = [0xddd1ae, 0xc48e70, 0xc9c8ae, 0xd9b58d, 0xa9b9af];
      const wall = o.type === 'barn' ? 0xad604b : palette[o.tone || 0];
      // Foundation embeds into sloping terrain and remains within the same exclusion footprint.
      this.add('box', 0x9a9a87, x, y - 1, z, w + 0.8, 5, d + 0.8);
      this.add('box', wall, x, y + h / 2 + 1, z, w, h, d);
      if (o.roof !== false || special) {
        // Four-sided pyramidal roof, contained by the authored footprint radius.
        const roof = new THREE.ConeGeometry(1, 1, 4); // Unit roof shared for all buildings.
        if (!this.geometries.roof) this.geometries.roof = roof;
        else roof.dispose();
        this.add('roof', 0x976c56, x, y + h + 3, z, w * 0.75, 5, d * 0.75, Math.PI / 4);
      } else this.add('box', 0x667574, x, y + h + 1.4, z, w + 0.8, 0.8, d + 0.8);
      for (let ix = -1; ix <= 1; ix++) {
        for (let floor = 0; floor < Math.max(1, Math.floor(h / 5)); floor++) {
          this.add(
            'box',
            0x51696c,
            x + ix * w * 0.27,
            y + 3 + floor * 4.5,
            z + d / 2 + 0.02,
            2,
            2,
            0.08
          );
          this.add(
            'box',
            0x51696c,
            x + ix * w * 0.27,
            y + 3 + floor * 4.5,
            z - d / 2 - 0.02,
            2,
            2,
            0.08
          );
          for (const side of [-1, 1])
            this.add(
              'box',
              0x51696c,
              x + side * (w / 2 + 0.02),
              y + 3 + floor * 4.5,
              z + ix * d * 0.27,
              0.08,
              2,
              2
            );
        }
      }
      this.add('box', 0x547578, x, y + 2, z + d / 2 + 0.07, 2.1, 4, 0.12);
      if (o.type === 'chapel') {
        this.add('box', 0xcfcdb1, x, y + 18, z - 3, 5, 14, 5);
        this.add('cone', 0x607570, x, y + 27, z - 3, 4.5, 7, 4.5);
      }
      if (o.type === 'cafe') {
        this.add('box', 0xd58b57, x, y + 4.5, z + d / 2 + 1.2, w, 1, 2.4);
      }
    }
  }
  makeClouds() {
    const material = new THREE.MeshLambertMaterial({
      color: 0xf4ecda,
      transparent: true,
      opacity: 0.7,
    });
    for (let i = 0; i < 18; i++) {
      const mesh = new THREE.Mesh(this.geometries.sphere, material);
      mesh.position.set(Math.sin(i * 4.2) * 2400, 400 + (i % 4) * 60, Math.cos(i * 4.2) * 2400);
      mesh.scale.set(160 + (i % 3) * 50, 23, 65);
      this.scene.add(mesh);
    }
  }
  makeMarkers() {
    this.markers = [];
    for (let i = 0; i < 4; i++) {
      const group = new THREE.Group();
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(6, 0.32, 6, 36),
        new THREE.MeshBasicMaterial({ color: 0xffca61 })
      );
      ring.rotation.x = Math.PI / 2;
      group.add(ring);
      const gem = new THREE.Mesh(
        new THREE.OctahedronGeometry(2.3),
        new THREE.MeshLambertMaterial({ color: 0xffc247, emissive: 0x76501c })
      );
      gem.position.y = 10;
      group.add(gem);
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.6, 0.6, 38, 6),
        new THREE.MeshBasicMaterial({
          color: 0xffd27a,
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
        })
      );
      beam.position.y = 20;
      group.add(beam);
      this.scene.add(group);
      this.markers.push({ group, gem });
    }
  }
  landmarkLabels() {
    for (const landmark of this.world.landmarks) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 96;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#20242add';
      ctx.fillRect(0, 0, 512, 96);
      ctx.fillStyle = '#ffe0a0';
      ctx.font = 'bold 32px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(landmark.name, 256, 60);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map, transparent: true, depthTest: true })
      );
      sprite.position.set(landmark.x, this.world.height(landmark.x, landmark.z) + 47, landmark.z);
      sprite.scale.set(46, 8.6, 1);
      this.scene.add(sprite);
      this.labels.push(sprite);
    }
  }
  setCar(spec) {
    if (this.car) {
      this.scene.remove(this.car);
      this.car.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (![...this.materials.values()].includes(o.material)) o.material.dispose();
        }
      });
    }
    const car = new THREE.Group();
    this.car = car;
    this.wheels = [];
    const part = (geometry, color, x, y, z) => {
      const mesh = new THREE.Mesh(geometry, this.material(color));
      mesh.position.set(x, y, z);
      car.add(mesh);
      return mesh;
    };
    const box = (color, x, y, z, w, h, d) => part(new THREE.BoxGeometry(w, h, d), color, x, y, z);
    const length = spec.id === 'tourer' ? 5.0 : 4.6;
    box(0x283a3c, 0, 0.7, 0, 2.1, 0.38, length);
    box(spec.color, 0, 1.12, 0, 2.18, 0.65, length);
    box(spec.color, 0, 1.52, -0.65, 2.08, 0.24, 2.2);
    // Sloped glass cabin: trapezoid in longitudinal section, tapered across the roof.
    const vertices = [
      -1, 1.45, -1.7, 1, 1.45, -1.7, -0.8, 2.12, -1.05, 0.8, 2.12, -1.05, -1, 1.45, 0.9, 1, 1.45,
      0.9, -0.8, 2.12, 0.3, 0.8, 2.12, 0.3,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geo.setIndex([
      0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 4, 2, 4, 6, 2, 1, 3, 5, 5, 3, 7, 2, 6, 3, 3, 6, 7,
    ]);
    geo.computeVertexNormals();
    part(geo, 0x3d6672, 0, 0, 0);
    box(spec.color, 0, 2.15, -0.37, 1.65, 0.12, 1.5);
    box(spec.color, -1, 1.72, -0.45, 0.12, 0.55, 0.14);
    box(spec.color, 1, 1.72, -0.45, 0.12, 0.55, 0.14);
    for (const x of [-1.1, 1.1])
      for (const z of [-1.48, 1.45]) {
        const wheel = new THREE.Group();
        wheel.position.set(x, 0.62, z);
        const tire = new THREE.Mesh(
          new THREE.CylinderGeometry(0.57, 0.57, 0.34, 12),
          this.material(0x202a2d)
        );
        tire.rotation.z = Math.PI / 2;
        wheel.add(tire);
        const rim = new THREE.Mesh(
          new THREE.CylinderGeometry(0.31, 0.31, 0.36, 8),
          this.material(0xc6c8bc)
        );
        rim.rotation.z = Math.PI / 2;
        wheel.add(rim);
        car.add(wheel);
        this.wheels.push({ wheel, tire, rim, front: z > 0 });
      }
    for (const x of [-0.76, 0.76]) {
      box(0xffedbc, x, 1.2, length / 2 + 0.025, 0.5, 0.24, 0.06);
      box(0xda4c3c, x, 1.2, -length / 2 - 0.025, 0.52, 0.19, 0.06);
      box(spec.color, x * 1.55, 1.68, 0.2, 0.26, 0.18, 0.38);
    }
    box(0x263b40, 0, 0.94, length / 2 + 0.04, 0.7, 0.16, 0.07);
    box(0xf2e6ca, 0, 0.89, -length / 2 - 0.04, 0.65, 0.18, 0.08);
    if (spec.id === 'sport') {
      box(0x253d43, 0, 1.68, -2, 2.45, 0.12, 0.42);
      box(0x253d43, -0.75, 1.46, -2, 0.1, 0.4, 0.2);
      box(0x253d43, 0.75, 1.46, -2, 0.1, 0.4, 0.2);
    }
    if (spec.id === 'rover') {
      box(0x586461, -0.67, 2.3, -0.4, 0.09, 0.15, 1.6);
      box(0x586461, 0.67, 2.3, -0.4, 0.09, 0.15, 1.6);
    }
    // Soft local contact shadow; no expensive world shadow-map rendering on mobile.
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const ctx = shadowCanvas.getContext('2d'),
      gradient = ctx.createRadialGradient(32, 32, 5, 32, 32, 32);
    gradient.addColorStop(0, '#111b1c99');
    gradient.addColorStop(1, '#111b1c00');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);
    if (!this.shadowTexture) this.shadowTexture = new THREE.CanvasTexture(shadowCanvas);
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.6, 7),
      new THREE.MeshBasicMaterial({ map: this.shadowTexture, transparent: true, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.12;
    car.add(shadow);
    this.scene.add(car);
    this.cameraReady = false;
  }
  resize() {
    const width = innerWidth,
      height = innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
  render(sim, dt, mode = 'drive', wide = false) {
    const s = sim.state,
      terrain = this.world.height;
    if (this.car) {
      this.car.position.set(s.x, terrain(s.x, s.z) + 0.12, s.z);
      this.car.rotation.set(0, s.heading, 0);
      const forward = new THREE.Vector3(Math.sin(s.heading), 0, Math.cos(s.heading));
      const front = terrain(s.x + forward.x * 2, s.z + forward.z * 2),
        back = terrain(s.x - forward.x * 2, s.z - forward.z * 2);
      const side =
        terrain(s.x + forward.z, s.z - forward.x) - terrain(s.x - forward.z, s.z + forward.x);
      this.car.rotateX(-Math.atan2(front - back, 4));
      this.car.rotateZ(Math.atan2(side, 2));
      for (const w of this.wheels) {
        w.wheel.rotation.y = w.front ? -s.steer * 0.4 : 0;
        w.tire.rotation.x += (s.speed * dt) / 0.57;
        w.rim.rotation.x = w.tire.rotation.x;
      }
    }
    for (const label of this.labels) {
      const distance = Math.hypot(label.position.x - s.x, label.position.z - s.z);
      label.visible = distance < 320;
      label.material.opacity = Math.min(1, Math.max(0, (320 - distance) / 100));
    }
    this.markers.forEach((m, i) => {
      const p = sim.checkpoints[i];
      m.group.position.set(p.x, terrain(p.x, p.z) + 0.7, p.z);
      m.gem.rotation.y = s.elapsed;
      m.gem.position.y = 10 + Math.sin(s.elapsed * 2 + i) * 0.6;
    });
    let target, look;
    if (mode === 'menu') {
      const a = performance.now() * 0.000025;
      target = new THREE.Vector3(-480 + Math.sin(a) * 100, 240, 660 + Math.cos(a) * 80);
      look = new THREE.Vector3(-280, 25, 160);
    } else {
      const distance = wide ? 20 : 12 + Math.min(6, Math.abs(s.speed) * 0.13);
      target = new THREE.Vector3(
        s.x - Math.sin(s.heading) * distance,
        terrain(s.x, s.z) + (wide ? 10 : 6.2),
        s.z - Math.cos(s.heading) * distance
      );
      target.y = Math.max(target.y, terrain(target.x, target.z) + 3.8);
      // Keep the chase camera outside nearby solid footprints.
      for (const o of this.world.obstacles) {
        if (Math.hypot(target.x - o.x, target.z - o.z) < o.radius + 2)
          target.y = Math.max(target.y, o.y + (o.h || 20) + 6);
      }
      look = new THREE.Vector3(
        s.x + Math.sin(s.heading) * 9,
        terrain(s.x, s.z) + 2,
        s.z + Math.cos(s.heading) * 9
      );
    }
    const smoothing = 1 - Math.exp(-Math.min(dt, 0.1) * 5);
    if (!this.cameraReady || this.camera.position.distanceTo(target) > 100) {
      this.camera.position.copy(target);
      this.look.copy(look);
      this.cameraReady = true;
    } else {
      this.camera.position.lerp(target, smoothing);
      this.look.lerp(look, smoothing);
    }
    this.camera.lookAt(this.look);
    this.renderer.render(this.scene, this.camera);
  }
}
