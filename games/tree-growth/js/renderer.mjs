import * as THREE from '../vendor/three.module.js';

const { clamp, smooth, random, branchBirth, branchGrowth, GrowthFraming } = window.TreeGrowth;
const UP = new THREE.Vector3(0, 1, 0);
const BRANCH_COUNT = 180;
const TWIG_COUNT = 12;
const SPRAYS_PER_TWIG = 7;
const LEAF_COUNT = BRANCH_COUNT * TWIG_COUNT * SPRAYS_PER_TWIG * 2;
const WOOD_COUNT = BRANCH_COUNT * (4 + TWIG_COUNT);
const dummy = new THREE.Object3D();
const color = new THREE.Color();
const start = new THREE.Vector3();
const end = new THREE.Vector3();
const delta = new THREE.Vector3();

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function barkTexture() {
  const rng = random(1824);
  return canvasTexture(512, 1024, (ctx, w, h) => {
    const pixels = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const waviness = Math.sin(y * .009 + x * .04) * 3 + Math.sin(y * .033) * 1.2;
        const ridge = Math.abs(Math.sin((x + waviness) * .145)) ** .6;
        const fine = Math.sin(x * 1.2 + Math.sin(y * .03)) * 8;
        const n = rng() * 28;
        const i = (y * w + x) * 4;
        pixels.data[i] = 63 + ridge * 72 + fine + n;
        pixels.data[i + 1] = 35 + ridge * 41 + fine * .6 + n * .65;
        pixels.data[i + 2] = 22 + ridge * 27 + fine * .4 + n * .45;
        pixels.data[i + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    for (let i = 0; i < 180; i++) {
      const x = rng() * w, y = rng() * h;
      ctx.strokeStyle = `rgba(35, 22, 16, ${.15 + rng() * .35})`;
      ctx.lineWidth = .5 + rng() * 2;
      ctx.beginPath(); ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + 3, y + 20, x - 4, y + 60, x + rng() * 5, y + 40 + rng() * 160);
      ctx.stroke();
    }
  });
}

function soilTexture() {
  const rng = random(3472);
  return canvasTexture(512, 512, (ctx, w, h) => {
    const pixels = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const n = rng() * 44;
        const i = (y * w + x) * 4;
        pixels.data[i] = 50 + n;
        pixels.data[i + 1] = 45 + n * .88;
        pixels.data[i + 2] = 35 + n * .75;
        pixels.data[i + 3] = 255;
      }
    }
    ctx.putImageData(pixels, 0, 0);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = i % 3 ? 'rgba(28, 23, 17, .24)' : 'rgba(152, 131, 96, .27)';
      ctx.beginPath(); ctx.ellipse(rng() * w, rng() * h, rng() * 2.5 + .4, rng() * 1.5 + .3, rng() * 6, 0, Math.PI * 2); ctx.fill();
    }
  });
}

// A botanical spray, with many short pointed needles on branching stems.
// Crossed, independently rotated instances give it volume from every angle.
function foliageTexture() {
  const rng = random(9861);
  return canvasTexture(256, 384, (ctx) => {
    function needle(x, y, angle, length, shade) {
      ctx.strokeStyle = `rgb(${82 + shade}, ${112 + shade}, ${58 + shade * .6})`;
      ctx.lineWidth = .9 + rng() * 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(angle) * length, y - Math.cos(angle) * length); ctx.stroke();
    }
    ctx.strokeStyle = '#657044'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(127, 370); ctx.quadraticCurveTo(113, 175, 129, 12); ctx.stroke();
    for (let row = 0; row < 17; row++) {
      const y = 344 - row * 18;
      const length = 12 + Math.sin((row + 2) / 20 * Math.PI) * 89;
      for (const side of [-1, 1]) {
        const tx = 124 + side * length, ty = y - 45 - rng() * 19;
        ctx.strokeStyle = '#65704b'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(123, y); ctx.lineTo(tx, ty); ctx.stroke();
        for (let j = 0; j < 16; j++) {
          const f = j / 16;
          const x = 123 + (tx - 123) * f, yy = y + (ty - y) * f;
          needle(x, yy, side * (.3 + rng() * .5), 10 + rng() * 12, rng() * 55);
          needle(x, yy, side * (1.5 + rng() * .7), 7 + rng() * 13, rng() * 35);
        }
      }
    }
    for (let i = 0; i < 90; i++) needle(125 + rng() * 7, 20 + i * 3.7, (i % 2 ? 1 : -1) * .65, 8 + rng() * 9, rng() * 40);
  });
}

function placeSegment(mesh, index, a, b, radius) {
  delta.subVectors(b, a);
  dummy.position.copy(a).addScaledVector(delta, .5);
  dummy.quaternion.setFromUnitVectors(UP, delta.clone().normalize());
  dummy.scale.set(radius, Math.max(delta.length(), 1e-8), radius);
  dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
}

export class TreeView {
  constructor(canvas, reducedMotion, onCameraChange) {
    this.canvas = canvas;
    this.reducedMotion = reducedMotion;
    this.onCameraChange = onCameraChange;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Wind only bends needle tips. Reuse shadows between actual growth updates.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#89958c');
    this.scene.fog = new THREE.FogExp2('#939b8d', .0006);
    this.scene.fog.color.setRGB(.53, .57, .51);
    this.camera = new THREE.PerspectiveCamera(38, 1, .00001, 10000);
    this.camera.position.set(.02, .013, .025);
    this.framing = new GrowthFraming();
    this.cameraHeight = .018;
    this.focusHeight = .002;
    this.theta = .55;
    this.phi = 1.37;
    this.elevation = .45;
    this.zoom = 1;
    this.autoOrbit = false;
    this.lastAge = -1;
    this.pointers = new Map();
    this.wind = { value: 0 };
    this.target = new THREE.Vector3();
    this.scene.add(new THREE.HemisphereLight('#e4ede1', '#75644e', 2.5));
    this.sun = new THREE.DirectionalLight('#ffe0a1', 3.6);
    this.sun.castShadow = true;
    const shadowSize = window.matchMedia('(max-width: 900px)').matches ? 1024 : 1536;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    this.sun.shadow.bias = -.00025;
    this.sun.shadow.normalBias = .015;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight('#b3ced1', .7);
    fill.position.set(-4, 3, -2); this.scene.add(fill);
    this.makeSky();
    this.makeTree();
    this.makeGround();
    this.makeScaleFigure();
    this.bindCamera();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  makeSky() {
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 direction; void main() { direction = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `varying vec3 direction;
        void main() {
          vec3 d = normalize(direction);
          vec3 horizon = vec3(.53, .57, .51);
          vec3 zenith = vec3(.12, .22, .25);
          vec3 c = mix(horizon, zenith, pow(max(d.y, 0.0), .48));
          float sun = pow(max(dot(d, normalize(vec3(-.6, .65, -.4))), 0.0), 12.0);
          c += vec3(.32, .22, .09) * sun * smoothstep(0.0, .3, d.y);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    }));
    this.scene.add(this.sky);
  }

  makeTree() {
    const rng = random(1476);
    this.bark = barkTexture();
    this.bark.wrapS = this.bark.wrapT = THREE.RepeatWrapping;
    this.bark.repeat.set(3, 2);
    this.bark.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    this.woodMaterial = new THREE.MeshStandardMaterial({ map: this.bark, bumpMap: this.bark, bumpScale: .07, roughness: .96, vertexColors: true });
    const radial = 80, rings = 64;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array((radial + 1) * (rings + 1) * 3);
    const colors = new Float32Array(positions.length);
    const uvs = new Float32Array((radial + 1) * (rings + 1) * 2);
    const indices = [];
    for (let row = 0; row <= rings; row++) {
      for (let col = 0; col <= radial; col++) {
        const i = row * (radial + 1) + col;
        uvs[i * 2] = col / radial; uvs[i * 2 + 1] = row / rings;
        const shade = .76 + .24 * smooth(0, .16, row / rings);
        colors.set([shade, shade, shade], i * 3);
        if (row < rings && col < radial) {
          const next = i + radial + 1;
          indices.push(i, next, i + 1, i + 1, next, next + 1);
        }
      }
    }
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    this.trunk = new THREE.Mesh(geometry, this.woodMaterial);
    this.trunk.castShadow = this.trunk.receiveShadow = true;
    this.trunk.frustumCulled = false;
    this.scene.add(this.trunk);
    this.wood = new THREE.InstancedMesh(new THREE.CylinderGeometry(.5, 1, 1, 6, 1, true), new THREE.MeshStandardMaterial({ map: this.bark, roughness: 1 }), WOOD_COUNT);
    this.wood.castShadow = this.wood.receiveShadow = true;
    this.wood.frustumCulled = false;
    this.wood.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.wood);
    const leafMap = foliageTexture();
    leafMap.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const leafMaterial = new THREE.MeshStandardMaterial({ map: leafMap, alphaTest: .38, side: THREE.DoubleSide, roughness: .95, metalness: 0 });
    const windShader = shader => {
      shader.uniforms.uTime = this.wind;
      shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += sin(uTime * 1.3 + instanceMatrix[3].y * 2.1 + instanceMatrix[3].x) * .035 * (uv.y + .1);
        transformed.z += cos(uTime * .9 + instanceMatrix[3].z * 1.7) * .023 * uv.y;`);
    };
    if (!this.reducedMotion) leafMaterial.onBeforeCompile = windShader;
    this.leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), leafMaterial, LEAF_COUNT);
    this.leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.leaves.castShadow = true;
    this.leaves.receiveShadow = true;
    this.leaves.frustumCulled = false;
    this.leaves.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafMap, alphaTest: .38, side: THREE.DoubleSide });
    if (!this.reducedMotion) this.leaves.customDepthMaterial.onBeforeCompile = windShader;
    this.scene.add(this.leaves);
    this.branches = Array.from({ length: BRANCH_COUNT }, (_, index) => ({
      birth: branchBirth(index, BRANCH_COUNT),
      angle: index * 2.399963 + rng() * .7,
      size: .7 + rng() * .3,
      lift: .5 + rng() * .7,
      sprays: Array.from({ length: TWIG_COUNT * SPRAYS_PER_TWIG }, () => ({ x: rng() - .5, y: rng() - .5, z: rng() - .5, size: .7 + rng() * .6, rotation: rng() * Math.PI * 2, shade: rng() })),
    }));
    for (let i = 0; i < LEAF_COUNT; i++) {
      color.setHSL(.23 + rng() * .035, .15 + rng() * .16, .75 + rng() * .18);
      this.leaves.setColorAt(i, color);
    }
    this.seed = new THREE.Group();
    const seedMaterial = new THREE.MeshStandardMaterial({ color: '#967147', bumpMap: this.bark, bumpScale: .000018, roughness: .91 });
    for (const side of [-1, 1]) {
      const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), seedMaterial);
      shell.scale.set(.00095, .0004, .0026);
      shell.position.set(side * .0004, .00045, 0);
      shell.rotation.y = side * .13;
      shell.castShadow = shell.receiveShadow = true;
      this.seed.add(shell);
    }
    const wing = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshStandardMaterial({ color: '#a78b5c', roughness: 1, transparent: true, opacity: .8 }));
    wing.scale.set(.0018, .00008, .0032);
    wing.position.y = .00015; this.seed.add(wing);
    this.scene.add(this.seed);
    this.cotyledons = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial({ color: '#718a38', roughness: .8 }), 6);
    this.cotyledons.castShadow = true; this.cotyledons.frustumCulled = false;
    this.scene.add(this.cotyledons);
  }

  makeGround() {
    this.soil = soilTexture(); this.soil.wrapS = this.soil.wrapT = THREE.RepeatWrapping;
    this.soil.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    // Small central faces keep millimetre-scale texture coordinates precise;
    // wider concentric faces extend the same, stationary soil to the horizon.
    const groundPositions = [], groundUvs = [], groundIndices = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    let inner = 0;
    for (const outer of [.025, .25, 2.5, 25, 250, 10000]) {
      for (let side = 0; side < 4; side++) {
        const a = corners[side], b = corners[(side + 1) % 4], offset = groundPositions.length / 3;
        for (const [corner, radius] of [[a, inner], [a, outer], [b, outer], [b, inner]]) {
          const x = corner[0] * radius, z = corner[1] * radius;
          groundPositions.push(x, 0, z); groundUvs.push(x * 40, z * 40);
        }
        groundIndices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2);
      }
      inner = outer;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(groundPositions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(groundUvs, 2));
    geometry.setIndex(groundIndices); geometry.computeVertexNormals();
    this.ground = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ map: this.soil, bumpMap: this.soil, bumpScale: .0002, roughness: 1 }));
    this.ground.material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vGroundPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvGroundPosition = (modelMatrix * vec4(position, 1.0)).xyz;');
      shader.fragmentShader = `varying vec3 vGroundPosition;
        float soilHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float soilNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(soilHash(i), soilHash(i+vec2(1,0)),f.x),mix(soilHash(i+vec2(0,1)),soilHash(i+vec2(1,1)),f.x),f.y); }
        ` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
        vec2 p = vGroundPosition.xz;
        float soil = soilNoise(p*.7)*.45 + soilNoise(p*5.0)*.3 + soilNoise(p*90.0)*.25;
        diffuseColor.rgb *= mix(vec3(.55,.57,.48), vec3(1.2,1.1,.91), soil);
      `);
    };
    this.ground.receiveShadow = true; this.scene.add(this.ground);
    const contactMap = canvasTexture(128, 128, (ctx) => {
      const gradient = ctx.createRadialGradient(64, 64, 5, 64, 64, 62);
      gradient.addColorStop(0, 'rgba(16, 12, 7, .65)'); gradient.addColorStop(.4, 'rgba(16, 12, 7, .24)'); gradient.addColorStop(1, 'rgba(16, 12, 7, 0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 128, 128);
    });
    this.contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: contactMap, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
    this.contact.rotation.x = -Math.PI / 2; this.scene.add(this.contact);
    this.pebbles = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ roughness: 1 }), 360);
    this.pebbles.receiveShadow = true; this.pebbles.castShadow = true; this.pebbles.frustumCulled = false;
    this.scene.add(this.pebbles);
    // All landmarks are in metres and stay put for the entire lifetime.
    const rng = random(78912);
    for (let i = 0; i < 360; i++) {
      const range = i < 120 ? .04 : i < 240 ? 1.6 : 40;
      const a = rng() * Math.PI * 2, distance = (Math.sqrt(rng()) + .05) * range;
      const size = range * .004 * (.3 + rng());
      dummy.position.set(Math.cos(a) * distance, size * .16, Math.sin(a) * distance);
      dummy.rotation.set(rng() * 5, rng() * 6, rng() * 5);
      dummy.scale.set(size, size * .45, size * .8); dummy.updateMatrix(); this.pebbles.setMatrixAt(i, dummy.matrix);
      color.setHSL(.1, .12 + rng() * .18, .15 + rng() * .13); this.pebbles.setColorAt(i, color);
    }
    const ringMaterial = new THREE.MeshBasicMaterial({ color: '#d2bb81', transparent: true, opacity: .12, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    for (const radius of [.01, .05, .2, 1, 2, 5, 10, 20]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(radius, radius * 1.0035, 128), ringMaterial);
      ring.rotation.x = -Math.PI / 2; this.scene.add(ring);
    }
  }

  makeScaleFigure() {
    // A quiet, life-size reference. It never follows or scales with the tree.
    const parts = [
      { position: [0, 1.67, 0], scale: [.105, .13, .10], color: '#b8a08a' },
      { position: [0, 1.31, 0], scale: [.22, .28, .13], color: '#b59b63' },
      { position: [0, 1.03, 0], scale: [.17, .13, .12], color: '#464a43' },
      { position: [-.11, .56, 0], scale: [.075, .45, .08], color: '#464a43', lean: -.035 },
      { position: [.11, .56, 0], scale: [.075, .45, .08], color: '#464a43', lean: .035 },
      { position: [-.13, .055, .045], scale: [.09, .055, .15], color: '#363932' },
      { position: [.13, .055, .045], scale: [.09, .055, .15], color: '#363932' },
      { position: [-.26, 1.16, 0], scale: [.065, .30, .065], color: '#b59b63', lean: -.14 },
      { position: [.26, 1.16, 0], scale: [.065, .30, .065], color: '#b59b63', lean: .14 },
      { position: [-.30, .84, 0], scale: [.05, .07, .045], color: '#b8a08a' },
      { position: [.30, .84, 0], scale: [.05, .07, .045], color: '#b8a08a' },
    ];
    this.scaleFigure = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshStandardMaterial({ roughness: .95 }), parts.length);
    parts.forEach((part, i) => {
      dummy.position.fromArray(part.position);
      dummy.rotation.set(0, 0, part.lean || 0);
      dummy.scale.fromArray(part.scale); dummy.updateMatrix();
      this.scaleFigure.setMatrixAt(i, dummy.matrix);
      this.scaleFigure.setColorAt(i, color.set(part.color));
    });
    this.scaleFigure.position.set(-7, 0, 4);
    this.scaleFigure.castShadow = this.scaleFigure.receiveShadow = true;
    this.scene.add(this.scaleFigure);
  }

  updateTree(tree) {
    if (tree.age === this.lastAge) return;
    this.lastAge = tree.age;
    const h = Math.max(tree.height, .00001), r = tree.diameter / 2;
    this.framing.update(tree.height);
    this.trunk.visible = tree.age > .04;
    this.wood.visible = this.leaves.visible = tree.age > .18;
    this.seed.visible = tree.age < .8;
    this.seed.children[0].position.x = -.0004 - smooth(.02, .18, tree.age) * .001;
    this.seed.children[1].position.x = .0004 + smooth(.02, .18, tree.age) * .001;
    const positions = this.trunk.geometry.attributes.position;
    for (let row = 0; row <= 64; row++) {
      const t = row / 64;
      const taper = Math.pow(1 - t, .85) * .91 + .008;
      for (let col = 0; col <= 80; col++) {
        const angle = col / 80 * Math.PI * 2;
        const ridge = 1 + Math.sin(angle * 11 + t * 3) * .045 + Math.sin(angle * 23 + t * 7) * .022;
        const flare = Math.exp(-t * 22) * (.08 + .28 * Math.pow(Math.sin(angle * 7) * .5 + .5, 3));
        const radius = r * (taper + flare) * ridge;
        const bendX = h * .006 * (Math.sin(t * 5) - t * Math.sin(5));
        const bendZ = h * .004 * Math.sin(t * 7);
        positions.setXYZ(row * 81 + col, Math.cos(angle) * radius + bendX, t * h, Math.sin(angle) * radius + bendZ);
      }
    }
    positions.needsUpdate = true; this.trunk.geometry.computeVertexNormals();
    this.woodMaterial.bumpScale = Math.max(.00003, r * .045);
    this.woodMaterial.color.set(tree.age < 1 ? '#9fa978' : '#ffffff');
    this.bark.repeat.set(3, 1 + tree.maturity * 2);
    let woodIndex = 0, leafIndex = 0;
    for (const branch of this.branches) {
      const { angle, birth } = branch;
      const t = clamp(birth.height / h, 0, 1);
      const growth = branchGrowth(birth, tree.age);
      const retention = smooth(tree.crownBase - .035, tree.crownBase + .055, t);
      const q = clamp((t - tree.crownBase) / (1 - tree.crownBase), 0, 1);
      const conical = Math.pow(Math.max(0, (1 - t) / (1 - tree.crownBase)), .82);
      const rounded = Math.pow(Math.sin(q * Math.PI), .64) * .91 + .07 * (1 - q);
      const profile = THREE.MathUtils.lerp(conical, rounded, tree.maturity * .9);
      const length = tree.crownRadius * profile * branch.size * growth * retention;
      if (length < h * .0001) continue;
      const ax = Math.cos(angle), az = Math.sin(angle);
      const rootRadius = r * Math.pow(1 - t, .85) * .85;
      const baseX = h * .006 * (Math.sin(t * 5) - t * Math.sin(5));
      const baseZ = h * .004 * Math.sin(t * 7);
      const point = u => ({
        x: baseX + ax * (rootRadius + length * u),
        y: birth.height + length * (-.13 * Math.sin(u * Math.PI) + u * u * (.2 + t * .27)) * branch.lift,
        z: baseZ + az * (rootRadius + length * u),
      });
      for (let part = 0; part < 4; part++) {
        start.copy(point(part / 4)); end.copy(point((part + 1) / 4));
        placeSegment(this.wood, woodIndex++, start, end, Math.max(1e-9, r * .15 * (1 - t) * (1 - part / 5) * growth * retention));
      }
      for (let twig = 0; twig < TWIG_COUNT; twig++) {
        const u = .2 + twig / TWIG_COUNT * .78;
        const twigGrowth = smooth(.01 + u * .12, .13 + u * .5, growth);
        if (twigGrowth < .001) continue;
        const p = point(u);
        const sign = twig % 2 ? 1 : -1;
        const twigAngle = angle + sign * (.65 + (1 - u) * .55);
        const twigLength = length * (.36 - u * .18) * twigGrowth;
        const dx = Math.cos(twigAngle), dz = Math.sin(twigAngle);
        start.set(p.x, p.y, p.z);
        end.set(p.x + dx * twigLength, p.y + twigLength * .38, p.z + dz * twigLength);
        placeSegment(this.wood, woodIndex++, start, end, Math.max(1e-9, r * .033 * (1 - t) * growth * retention * twigGrowth));
        for (let spray = 0; spray < SPRAYS_PER_TWIG; spray++) {
          const a = branch.sprays[twig * SPRAYS_PER_TWIG + spray];
          const s = .18 + spray / SPRAYS_PER_TWIG * .9;
          const unfolding = smooth(s * .35, .42 + s * .5, twigGrowth);
          if (unfolding < .001) continue;
          const size = Math.max(1e-9, length * .20 * a.size * (1 - u * .26) * unfolding);
          color.setHSL(.23 + a.shade * .035, .22 + (1 - unfolding) * .25, .75 + a.shade * .15 + (1 - unfolding) * .08);
          dummy.position.set(p.x + dx * twigLength * s + a.x * size * .6, p.y + twigLength * .38 * s + a.y * size * .7, p.z + dz * twigLength * s + a.z * size * .6);
          for (let cross = 0; cross < 2; cross++) {
            dummy.rotation.set(.35 + a.x * .9 + cross * 1.5, -twigAngle + a.rotation, sign * .45 + a.z);
            dummy.scale.set(size * .83, size * 1.15, size);
            dummy.updateMatrix(); this.leaves.setMatrixAt(leafIndex, dummy.matrix);
            this.leaves.setColorAt(leafIndex++, color);
          }
        }
      }
    }
    this.wood.instanceMatrix.needsUpdate = true;
    this.leaves.instanceMatrix.needsUpdate = true;
    this.leaves.instanceColor.needsUpdate = true;
    this.wood.count = woodIndex;
    this.leaves.count = leafIndex;
    this.cotyledons.visible = tree.age > .04 && tree.age < 1.2;
    const cotyledonScale = h * .24 * (1 - smooth(.45, 1.2, tree.age));
    for (let i = 0; i < 6; i++) {
      const angle = i / 6 * Math.PI * 2;
      dummy.position.set(Math.cos(angle) * cotyledonScale * .55, h * .75, Math.sin(angle) * cotyledonScale * .55);
      dummy.rotation.set(0, -angle, Math.PI / 2 - .25);
      dummy.scale.set(cotyledonScale * .09, cotyledonScale, cotyledonScale * .045);
      dummy.updateMatrix(); this.cotyledons.setMatrixAt(i, dummy.matrix);
    }
    this.cotyledons.instanceMatrix.needsUpdate = true;
    const frame = Math.max(.018, h);
    const contactSize = Math.max(.01, r * 6, tree.crownRadius * .65);
    this.contact.scale.setScalar(contactSize);
    this.sun.position.set(-frame * 2, frame * 3.4, frame * 1.5);
    this.sun.target.position.set(0, frame * .3, 0);
    const shadow = this.sun.shadow.camera;
    shadow.left = shadow.bottom = -frame * 1.3; shadow.right = shadow.top = frame * 1.3;
    shadow.near = frame * .01; shadow.far = frame * 8;
    shadow.updateProjectionMatrix();
    this.sun.shadow.normalBias = frame * .0007;
    this.renderer.shadowMap.needsUpdate = true;
  }

  resize() {
    const { width, height } = this.canvas.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  moveElevation(amount) {
    this.elevation = clamp(this.elevation + amount, 0, 1);
    this.onCameraChange(this.elevation);
  }

  setElevation(value) {
    if (!Number.isFinite(value)) return;
    this.elevation = clamp(value, 0, 1);
  }

  changeZoom(factor) {
    if (!Number.isFinite(factor)) return;
    this.zoom = clamp(this.zoom * factor, .18, 3.3);
  }

  setFramingLocked(locked) {
    this.framing.locked = Boolean(locked);
    if (locked) {
      this.framing.span = this.cameraHeight;
      this.framing.focus = this.focusHeight;
    } else this.framing.update(this.framing.height);
    this.onCameraChange(this.elevation, this.framing.locked);
  }

  resetCamera(height = this.framing.height) {
    this.theta = .55; this.phi = 1.37; this.elevation = .45; this.zoom = 1;
    this.framing.fit(height);
    this.onCameraChange(this.elevation, false);
  }

  bindCamera() {
    const canvas = this.canvas;
    const release = event => { this.pointers.delete(event.pointerId); };
    canvas.addEventListener('contextmenu', event => event.preventDefault());
    canvas.addEventListener('pointerdown', event => {
      if (this.pointers.size >= 2) return;
      canvas.focus({ preventScroll: true });
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', event => {
      const old = this.pointers.get(event.pointerId);
      if (!old) return;
      const dx = event.clientX - old.x, dy = event.clientY - old.y;
      if (this.pointers.size === 2) {
        const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)[1];
        const before = Math.hypot(old.x - other.x, old.y - other.y);
        const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (before > 5 && after > 5) this.changeZoom(before / after);
        this.moveElevation(dy / canvas.clientHeight * 1.2);
      } else if (event.shiftKey || event.buttons === 2) {
        this.moveElevation(dy / canvas.clientHeight * 1.5);
      } else {
        this.theta -= dx * .007;
        this.phi = clamp(this.phi - dy * .006, .3, 1.52);
      }
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, release);
    window.addEventListener('blur', () => this.pointers.clear());
    canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1);
      this.changeZoom(Math.exp(clamp(delta, -300, 300) * .0015));
    }, { passive: false });
    canvas.addEventListener('keydown', event => {
      const key = event.key.toLowerCase();
      if (!['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 's', '+', '=', '-', '_', 'f'].includes(key)) return;
      event.preventDefault();
      if (key === 'arrowleft') this.theta -= .12;
      if (key === 'arrowright') this.theta += .12;
      if (key === 'arrowup') this.phi = clamp(this.phi - .08, .3, 1.52);
      if (key === 'arrowdown') this.phi = clamp(this.phi + .08, .3, 1.52);
      if (key === 'w') this.moveElevation(.06);
      if (key === 's') this.moveElevation(-.06);
      if (['+', '='].includes(key)) this.changeZoom(.88);
      if (['-', '_'].includes(key)) this.changeZoom(1.14);
      if (key === 'f') this.resetCamera();
    });
  }

  render(seconds, elapsed, snap = false) {
    const lerp = snap || this.reducedMotion ? 1 : 1 - Math.exp(-seconds * 4);
    this.cameraHeight = THREE.MathUtils.lerp(this.cameraHeight, this.framing.span, lerp);
    this.focusHeight = THREE.MathUtils.lerp(this.focusHeight, this.framing.focus, lerp);
    if (Math.abs(this.cameraHeight - this.framing.span) < this.framing.span * .0001) this.cameraHeight = this.framing.span;
    if (Math.abs(this.focusHeight - this.framing.focus) < this.framing.span * .0001) this.focusHeight = this.framing.focus;
    if (this.autoOrbit && !this.reducedMotion && this.pointers.size === 0) this.theta += seconds * .1;
    this.wind.value = this.reducedMotion ? 0 : elapsed;
    const h = this.cameraHeight;
    // Add extra portrait room so the crown never hides behind camera buttons.
    const portrait = this.camera.aspect < 1;
    const distance = h * (portrait ? 2.15 : 1.7) * this.zoom;
    this.target.set(0, Math.min(h, this.focusHeight) * this.elevation + (portrait ? h * .2 : 0), 0);
    this.camera.position.set(Math.sin(this.theta) * Math.sin(this.phi) * distance, Math.max(h * .025, this.target.y + Math.cos(this.phi) * distance), Math.cos(this.theta) * Math.sin(this.phi) * distance);
    this.camera.lookAt(this.target);
    this.camera.near = Math.max(.000001, h * .0001);
    this.camera.far = 4000;
    this.camera.updateProjectionMatrix();
    this.sky.position.copy(this.camera.position); this.sky.scale.setScalar(2000);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.resizeObserver.disconnect();
    const geometries = new Set(), materials = new Set(), textures = new Set();
    this.scene.traverse(object => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
      if (object.customDepthMaterial) materials.add(object.customDepthMaterial);
    });
    materials.forEach(material => { for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); material.dispose(); });
    geometries.forEach(geometry => geometry.dispose());
    textures.forEach(texture => texture.dispose());
    this.renderer.dispose();
  }
}
