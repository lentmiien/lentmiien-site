import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;

const PLANET_SPECS = [
  { id: 'mercury', radius: 0.19, distance: 5.2, speed: 0.13, color: '#8d857a', roughness: 0.96, phase: 0.7 },
  { id: 'venus', radius: 0.34, distance: 7.1, speed: 0.09, color: '#bd7d45', roughness: 0.88, phase: 2.2 },
  { id: 'earth', radius: 0.37, distance: 9.4, speed: 0.07, color: '#2e70a0', roughness: 0.72, phase: 4.2 },
  { id: 'mars', radius: 0.25, distance: 11.8, speed: 0.056, color: '#93472f', roughness: 0.92, phase: 1.7 },
  { id: 'jupiter', radius: 1.04, distance: 17.4, speed: 0.029, color: '#b9875f', roughness: 0.84, phase: 5.1 },
  { id: 'saturn', radius: 0.88, distance: 23.2, speed: 0.021, color: '#c4a66d', roughness: 0.88, phase: 3.4, rings: true },
  { id: 'uranus', radius: 0.6, distance: 28.8, speed: 0.015, color: '#71aeb6', roughness: 0.74, phase: 0.2 },
  { id: 'neptune', radius: 0.57, distance: 34.2, speed: 0.012, color: '#315b9f', roughness: 0.78, phase: 2.8 }
];

const SHOTS = {
  nebula: { offset: [0, 4.2, 15.5], target: 'sun', fov: 54 },
  formation: { offset: [0, 10, 28], target: 'sun', fov: 53 },
  impact: { offset: [2.6, 1.45, 4.6], target: 'earth', fov: 43 },
  'earth-young': { offset: [1.8, 0.9, 3.5], target: 'earth', fov: 40 },
  bombardment: { offset: [3.7, 2, 6.3], target: 'earth', fov: 44 },
  'earth-ocean': { offset: [1.6, 0.5, 3.1], target: 'earth', fov: 38 },
  'earth-oxygen': { offset: [-1.8, 0.9, 3.4], target: 'earth', fov: 39 },
  'earth-life': { offset: [2.2, 0.6, 3.5], target: 'earth', fov: 39 },
  asteroid: { offset: [2.4, 0.75, 4.4], target: 'earth', fov: 38 },
  'earth-human': { offset: [-1.55, 0.7, 3.05], target: 'earth', fov: 38 },
  'earth-night': { offset: [1.8, -0.25, 3.15], target: 'earth', fov: 38 },
  orrery: { offset: [0, 13, 27], target: 'sun', fov: 48 },
  moon: { offset: [1.7, 0.75, 3.15], target: 'earth', fov: 36 },
  today: { offset: [-1.25, 0.5, 2.65], target: 'earth', fov: 36 },
  'earth-warm': { offset: [1.45, 0.4, 2.9], target: 'earth', fov: 37 },
  'earth-scorched': { offset: [-1.4, 0.25, 2.7], target: 'earth', fov: 37 },
  'sun-aging': { offset: [0, 2.5, 12.5], target: 'sun', fov: 47 },
  'red-giant': { offset: [0, 5.7, 24], target: 'sun', fov: 57 },
  'final-giant': { offset: [0, 7.5, 30], target: 'sun', fov: 60 },
  'white-dwarf': { offset: [0, 4.5, 17], target: 'sun', fov: 49 }
};

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

export class SolarScene {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.onFallback = options.onFallback || (() => {});
    this.reduceMotion = options.reduceMotion || false;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.clock = new THREE.Clock();
    this.available = false;
    this.paused = true;
    this.visualTime = 0;
    this.era = 'nebula';
    this.planets = new Map();
    this.orbits = [];
    this.cameraTween = null;
    this.cameraBase = new THREE.Vector3(0, 4, 16);
    this.cameraTarget = new THREE.Vector3();
    this.activeTargetId = 'sun';
    this.frame = null;
    this.resizeObserver = null;
    this.boundAnimate = this.animate.bind(this);
  }

  init() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance'
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.08;

      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x050609);
      this.scene.fog = new THREE.FogExp2(0x050609, 0.0065);

      this.camera = new THREE.PerspectiveCamera(52, 1, 0.08, 500);
      this.camera.position.copy(this.cameraBase);

      this.createLights();
      this.createStarfield();
      this.createSun();
      this.createPlanets();
      this.createFormationDisk();
      this.createAsteroidFields();
      this.createImpactActors();
      this.createFutureShells();

      this.applyEra('nebula');
      this.resize();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
      window.addEventListener('resize', () => this.resize(), { passive: true });

      this.available = true;
      this.frame = requestAnimationFrame(this.boundAnimate);
      return true;
    } catch (error) {
      this.available = false;
      this.canvas.hidden = true;
      this.onFallback(error);
      return false;
    }
  }

  createLights() {
    this.scene.add(new THREE.HemisphereLight(0x627396, 0x0b0908, 0.36));
    this.sunLight = new THREE.PointLight(0xffd6a0, 58, 95, 1.45);
    this.scene.add(this.sunLight);
  }

  createStarfield() {
    const random = seededRandom(43109);
    const count = this.reduceMotion ? 1800 : 3500;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const palette = [
      new THREE.Color(0xffffff),
      new THREE.Color(0xffddb5),
      new THREE.Color(0xaec8ff),
      new THREE.Color(0xffc247)
    ];

    for (let index = 0; index < count; index += 1) {
      const radius = 85 + random() * 260;
      const theta = random() * TAU;
      const phi = Math.acos(2 * random() - 1);
      const offset = index * 3;
      positions[offset] = radius * Math.sin(phi) * Math.cos(theta);
      positions[offset + 1] = radius * Math.cos(phi);
      positions[offset + 2] = radius * Math.sin(phi) * Math.sin(theta);

      const color = palette[Math.floor(random() * palette.length)];
      const brightness = 0.42 + random() * 0.58;
      colors[offset] = color.r * brightness;
      colors[offset + 1] = color.g * brightness;
      colors[offset + 2] = color.b * brightness;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.28,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.82,
      vertexColors: true,
      depthWrite: false
    });
    this.starfield = new THREE.Points(geometry, material);
    this.scene.add(this.starfield);
  }

  createSun() {
    this.sunMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        colorA: { value: new THREE.Color(0xff7b22) },
        colorB: { value: new THREE.Color(0xffd77a) },
        colorHot: { value: new THREE.Color(0xfff5d6) }
      },
      vertexShader: `
        varying vec3 vPosition;
        varying vec3 vNormalView;
        void main() {
          vPosition = position;
          vNormalView = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 colorA;
        uniform vec3 colorB;
        uniform vec3 colorHot;
        varying vec3 vPosition;
        varying vec3 vNormalView;
        void main() {
          float bands = sin(vPosition.y * 8.0 + time * 0.8) * 0.5 + 0.5;
          float cells = sin(vPosition.x * 13.0 - time) * sin(vPosition.z * 11.0 + time * 0.6);
          float turbulence = clamp(bands * 0.42 + cells * 0.18 + 0.48, 0.0, 1.0);
          float rim = pow(1.0 - abs(vNormalView.z), 2.0);
          vec3 color = mix(colorA, colorB, turbulence);
          color = mix(color, colorHot, rim * 0.34 + max(cells, 0.0) * 0.13);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    });

    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(2.05, 64, 48),
      this.sunMaterial
    );
    this.scene.add(this.sun);

    const glowTexture = this.makeGlowTexture();
    this.sunGlowInner = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xffa13b,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    this.sunGlowInner.scale.setScalar(8.6);
    this.scene.add(this.sunGlowInner);

    this.sunGlowOuter = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xff6a1f,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    this.sunGlowOuter.scale.setScalar(14.5);
    this.scene.add(this.sunGlowOuter);
  }

  makeGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const gradient = context.createRadialGradient(128, 128, 2, 128, 128, 126);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.15, 'rgba(255,222,155,0.85)');
    gradient.addColorStop(0.42, 'rgba(255,106,31,0.25)');
    gradient.addColorStop(1, 'rgba(255,106,31,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  createPlanets() {
    this.planetsRoot = new THREE.Group();
    this.scene.add(this.planetsRoot);

    PLANET_SPECS.forEach((spec, index) => {
      const orbit = this.createOrbit(spec.distance, index < 4 ? 0.23 : 0.14);
      this.planetsRoot.add(orbit);
      this.orbits.push(orbit);

      const pivot = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({
        color: spec.color,
        map: this.makePlanetTexture(spec),
        roughness: spec.roughness,
        metalness: 0.02
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(spec.radius, 40, 28),
        material
      );
      mesh.position.x = spec.distance;
      pivot.rotation.y = spec.phase;
      pivot.add(mesh);
      this.planetsRoot.add(pivot);

      const planet = { ...spec, mesh, pivot, material };
      this.planets.set(spec.id, planet);

      if (spec.id === 'earth') this.decorateEarth(planet);
      if (spec.rings) this.decorateSaturn(planet);
    });
  }

  makePlanetTexture(spec) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const random = seededRandom(spec.id.length * 9187);
    context.fillStyle = spec.color;
    context.fillRect(0, 0, canvas.width, canvas.height);

    if (spec.id === 'earth') {
      const ocean = context.createLinearGradient(0, 0, 0, canvas.height);
      ocean.addColorStop(0, '#17395d');
      ocean.addColorStop(0.5, '#2c6f98');
      ocean.addColorStop(1, '#122d52');
      context.fillStyle = ocean;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = '#607f4a';
      for (let index = 0; index < 34; index += 1) {
        const x = random() * canvas.width;
        const y = 24 + random() * (canvas.height - 48);
        const width = 18 + random() * 78;
        const height = 8 + random() * 34;
        context.beginPath();
        context.ellipse(x, y, width, height, random() * 1.5, 0, TAU);
        context.fill();
      }
      context.globalAlpha = 0.45;
      context.fillStyle = '#c4b984';
      for (let index = 0; index < 18; index += 1) {
        context.fillRect(random() * canvas.width, random() * canvas.height, 4 + random() * 30, 2 + random() * 8);
      }
      context.globalAlpha = 1;
    } else if (spec.id === 'jupiter' || spec.id === 'saturn') {
      const colors = spec.id === 'jupiter'
        ? ['#a9653e', '#d5b083', '#7d4e3a', '#e0c39d', '#b57c58']
        : ['#9f8259', '#d8bd83', '#baa06e', '#e4d09c'];
      for (let y = 0; y < canvas.height; y += 8) {
        context.fillStyle = colors[Math.floor(random() * colors.length)];
        context.globalAlpha = 0.5 + random() * 0.38;
        context.fillRect(0, y, canvas.width, 6 + random() * 8);
      }
      context.globalAlpha = 1;
      if (spec.id === 'jupiter') {
        context.fillStyle = 'rgba(126,51,34,0.9)';
        context.beginPath();
        context.ellipse(360, 155, 42, 15, -0.08, 0, TAU);
        context.fill();
      }
    } else {
      for (let index = 0; index < 70; index += 1) {
        const shade = random() > 0.5 ? 255 : 0;
        context.fillStyle = `rgba(${shade},${shade},${shade},${0.025 + random() * 0.06})`;
        context.beginPath();
        context.arc(random() * canvas.width, random() * canvas.height, 2 + random() * 16, 0, TAU);
        context.fill();
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }

  decorateEarth(earth) {
    earth.normalMaterial = earth.material;
    earth.youngMaterial = new THREE.MeshStandardMaterial({ color: 0x604338, roughness: 0.9, emissive: 0x2c1008, emissiveIntensity: 0.45 });
    earth.hotMaterial = new THREE.MeshStandardMaterial({ color: 0x382522, roughness: 0.9, emissive: 0xff4b13, emissiveIntensity: 0.88 });
    earth.warmMaterial = new THREE.MeshStandardMaterial({ color: 0x897054, roughness: 0.94, emissive: 0x3a1608, emissiveIntensity: 0.17 });
    earth.scorchedMaterial = new THREE.MeshStandardMaterial({ color: 0x33241e, roughness: 0.98, emissive: 0x8d210e, emissiveIntensity: 0.43 });

    const atmosphereMaterial = new THREE.MeshBasicMaterial({
      color: 0x5dc8ff,
      transparent: true,
      opacity: 0.2,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    earth.atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(earth.radius * 1.08, 36, 24),
      atmosphereMaterial
    );
    earth.mesh.add(earth.atmosphere);

    const cloudTexture = this.makeCloudTexture();
    earth.clouds = new THREE.Mesh(
      new THREE.SphereGeometry(earth.radius * 1.016, 36, 24),
      new THREE.MeshBasicMaterial({
        map: cloudTexture,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    earth.mesh.add(earth.clouds);

    earth.moonPivot = new THREE.Group();
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 28, 18),
      new THREE.MeshStandardMaterial({ color: 0xaaa69e, roughness: 1 })
    );
    moon.position.x = 0.72;
    earth.moonPivot.add(moon);
    earth.mesh.add(earth.moonPivot);
    earth.moon = moon;

    const cityTexture = this.makeCityLightTexture();
    earth.cityLights = new THREE.Mesh(
      new THREE.SphereGeometry(earth.radius * 1.008, 36, 24),
      new THREE.MeshBasicMaterial({
        map: cityTexture,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      })
    );
    earth.mesh.add(earth.cityLights);
  }

  makeCloudTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const random = seededRandom(8291);
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 170; index += 1) {
      const alpha = 0.05 + random() * 0.16;
      context.fillStyle = `rgba(255,255,255,${alpha})`;
      context.beginPath();
      context.ellipse(
        random() * canvas.width,
        18 + random() * 220,
        5 + random() * 34,
        1 + random() * 7,
        random() * 0.6 - 0.3,
        0,
        TAU
      );
      context.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  }

  makeCityLightTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const random = seededRandom(1948);
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 260; index += 1) {
      const x = random() * canvas.width;
      const y = 34 + random() * 190;
      const glow = context.createRadialGradient(x, y, 0, x, y, 3 + random() * 5);
      glow.addColorStop(0, 'rgba(255,220,130,0.95)');
      glow.addColorStop(1, 'rgba(255,106,31,0)');
      context.fillStyle = glow;
      context.fillRect(x - 8, y - 8, 16, 16);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
  }

  decorateSaturn(saturn) {
    const geometry = new THREE.RingGeometry(1.18, 1.82, 96);
    const positions = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const y = positions.getY(index);
      const radius = Math.sqrt(x * x + y * y);
      uv.setXY(index, (radius - 1.18) / 0.64, 0.5);
    }
    const material = new THREE.MeshBasicMaterial({
      color: 0xd9c49b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.68,
      depthWrite: false
    });
    const rings = new THREE.Mesh(geometry, material);
    rings.rotation.x = Math.PI / 2.15;
    rings.rotation.z = 0.12;
    saturn.mesh.add(rings);
  }

  createOrbit(radius, opacity) {
    const points = [];
    for (let index = 0; index < 160; index += 1) {
      const angle = index / 160 * TAU;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({
      color: 0x6f685c,
      transparent: true,
      opacity,
      depthWrite: false
    }));
  }

  createFormationDisk() {
    const random = seededRandom(99021);
    const count = this.reduceMotion ? 2400 : 6200;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const amber = new THREE.Color(0xffa13d);
    const stone = new THREE.Color(0x635044);

    for (let index = 0; index < count; index += 1) {
      const distance = 2.7 + Math.pow(random(), 0.62) * 37;
      const angle = random() * TAU;
      const offset = index * 3;
      positions[offset] = Math.cos(angle) * distance;
      positions[offset + 1] = (random() - 0.5) * (0.15 + distance * 0.055);
      positions[offset + 2] = Math.sin(angle) * distance;
      const color = random() > 0.42 ? amber : stone;
      const brightness = 0.45 + random() * 0.55;
      colors[offset] = color.r * brightness;
      colors[offset + 1] = color.g * brightness;
      colors[offset + 2] = color.b * brightness;
      sizes[index] = 0.04 + random() * 0.18;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.formationDisk = new THREE.Points(geometry, new THREE.PointsMaterial({
      size: 0.12,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    this.scene.add(this.formationDisk);
  }

  createAsteroidFields() {
    const random = seededRandom(27811);
    const count = this.reduceMotion ? 500 : 1400;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = 13.3 + random() * 2.6;
      const angle = random() * TAU;
      const offset = index * 3;
      positions[offset] = Math.cos(angle) * radius;
      positions[offset + 1] = (random() - 0.5) * 0.58;
      positions[offset + 2] = Math.sin(angle) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.asteroidBelt = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0x8b7565,
      size: 0.085,
      transparent: true,
      opacity: 0.62,
      depthWrite: false
    }));
    this.scene.add(this.asteroidBelt);
  }

  createImpactActors() {
    const random = seededRandom(61491);
    const debrisCount = this.reduceMotion ? 320 : 900;
    const positions = new Float32Array(debrisCount * 3);
    for (let index = 0; index < debrisCount; index += 1) {
      const angle = random() * TAU;
      const radius = 0.46 + random() * 1.18;
      const offset = index * 3;
      positions[offset] = Math.cos(angle) * radius;
      positions[offset + 1] = (random() - 0.5) * 0.18;
      positions[offset + 2] = Math.sin(angle) * radius;
    }
    const debrisGeometry = new THREE.BufferGeometry();
    debrisGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.impactDebris = new THREE.Points(debrisGeometry, new THREE.PointsMaterial({
      color: 0xff8a34,
      size: 0.075,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    this.scene.add(this.impactDebris);

    this.impactor = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 24, 18),
      new THREE.MeshStandardMaterial({ color: 0x4b3830, roughness: 0.95, emissive: 0x6d1f0c, emissiveIntensity: 0.24 })
    );
    this.scene.add(this.impactor);

    this.chicxulubAsteroid = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.11, 2),
      new THREE.MeshStandardMaterial({ color: 0x574a42, roughness: 1, emissive: 0xff5417, emissiveIntensity: 0.42 })
    );
    this.scene.add(this.chicxulubAsteroid);

    const trailGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, 2.3)
    ]);
    this.asteroidTrail = new THREE.Line(trailGeometry, new THREE.LineBasicMaterial({
      color: 0xff8a3d,
      transparent: true,
      opacity: 0.72,
      blending: THREE.AdditiveBlending
    }));
    this.chicxulubAsteroid.add(this.asteroidTrail);
  }

  createFutureShells() {
    this.futureShells = new THREE.Group();
    const colors = [0xff6a1f, 0xffc247, 0x7fc4d2, 0x69789a];
    for (let index = 0; index < 7; index += 1) {
      const material = new THREE.MeshBasicMaterial({
        color: colors[index % colors.length],
        transparent: true,
        opacity: 0.055 + index * 0.006,
        wireframe: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(4.8 + index * 1.1, 32, 20),
        material
      );
      shell.scale.set(1.4, 0.68 + index * 0.035, 1);
      shell.rotation.set(index * 0.21, index * 0.37, index * 0.13);
      this.futureShells.add(shell);
    }
    this.scene.add(this.futureShells);
  }

  applyEra(era) {
    if (!this.scene) return;
    this.era = era;
    const earth = this.planets.get('earth');
    const mercury = this.planets.get('mercury');
    const venus = this.planets.get('venus');

    this.planetsRoot.visible = true;
    this.formationDisk.visible = false;
    this.impactDebris.visible = false;
    this.impactor.visible = false;
    this.chicxulubAsteroid.visible = false;
    this.futureShells.visible = false;
    this.asteroidBelt.visible = true;
    mercury.mesh.visible = true;
    venus.mesh.visible = true;

    earth.mesh.visible = true;
    earth.mesh.material = earth.normalMaterial;
    earth.atmosphere.visible = true;
    earth.atmosphere.material.color.set(0x5dc8ff);
    earth.atmosphere.material.opacity = 0.2;
    earth.clouds.visible = true;
    earth.clouds.material.opacity = 0.38;
    earth.moonPivot.visible = true;
    earth.cityLights.material.opacity = 0;

    this.sun.scale.setScalar(1);
    this.sunGlowInner.scale.setScalar(8.6);
    this.sunGlowOuter.scale.setScalar(14.5);
    this.sunGlowInner.material.color.set(0xffa13b);
    this.sunGlowOuter.material.color.set(0xff6a1f);
    this.sunGlowInner.material.opacity = 0.72;
    this.sunGlowOuter.material.opacity = 0.22;
    this.sunMaterial.uniforms.colorA.value.set(0xff7b22);
    this.sunMaterial.uniforms.colorB.value.set(0xffd77a);
    this.sunMaterial.uniforms.colorHot.value.set(0xfff5d6);
    this.sunLight.color.set(0xffd6a0);
    this.sunLight.intensity = 58;

    this.orbits.forEach((orbit) => {
      orbit.material.opacity = 0.13;
    });

    if (era === 'nebula') {
      this.planetsRoot.visible = false;
      this.formationDisk.visible = true;
      this.sun.scale.setScalar(0.64);
      this.sunGlowInner.scale.setScalar(6.8);
      this.sunGlowOuter.scale.setScalar(18);
    } else if (era === 'formation') {
      this.formationDisk.visible = true;
      this.sun.scale.setScalar(0.82);
      this.orbits.forEach((orbit) => {
        orbit.material.opacity = 0.06;
      });
    } else if (era === 'impact') {
      earth.mesh.material = earth.hotMaterial;
      earth.atmosphere.visible = false;
      earth.clouds.visible = false;
      earth.moonPivot.visible = false;
      this.impactDebris.visible = true;
      this.impactor.visible = true;
    } else if (era === 'earth-young') {
      earth.mesh.material = earth.youngMaterial;
      earth.atmosphere.material.opacity = 0.11;
      earth.clouds.visible = false;
    } else if (era === 'bombardment') {
      earth.mesh.material = earth.youngMaterial;
      this.impactDebris.visible = true;
      this.impactor.visible = true;
    } else if (era === 'earth-ocean') {
      earth.atmosphere.material.opacity = 0.14;
      earth.clouds.material.opacity = 0.24;
    } else if (era === 'earth-oxygen') {
      earth.atmosphere.material.opacity = 0.28;
      earth.clouds.material.opacity = 0.31;
    } else if (era === 'asteroid') {
      this.chicxulubAsteroid.visible = true;
    } else if (era === 'earth-human' || era === 'earth-night' || era === 'today') {
      earth.cityLights.material.opacity = era === 'earth-human' ? 0.11 : 0.48;
      if (era === 'today') earth.cityLights.material.opacity = 0.58;
    } else if (era === 'moon') {
      earth.cityLights.material.opacity = 0.34;
      earth.moonPivot.visible = true;
    } else if (era === 'earth-warm') {
      earth.mesh.material = earth.warmMaterial;
      earth.atmosphere.material.color.set(0xffb36a);
      earth.atmosphere.material.opacity = 0.18;
      earth.clouds.material.opacity = 0.2;
    } else if (era === 'earth-scorched') {
      earth.mesh.material = earth.scorchedMaterial;
      earth.atmosphere.material.color.set(0xff6a1f);
      earth.atmosphere.material.opacity = 0.08;
      earth.clouds.visible = false;
    } else if (era === 'sun-aging') {
      earth.mesh.material = earth.scorchedMaterial;
      earth.clouds.visible = false;
      this.sun.scale.setScalar(1.5);
      this.sunGlowInner.scale.setScalar(11);
      this.sunGlowOuter.scale.setScalar(19);
    } else if (era === 'red-giant' || era === 'final-giant') {
      earth.mesh.material = earth.scorchedMaterial;
      earth.atmosphere.visible = false;
      earth.clouds.visible = false;
      mercury.mesh.visible = false;
      venus.mesh.visible = false;
      const scale = era === 'final-giant' ? 5.8 : 4.7;
      this.sun.scale.setScalar(scale);
      this.sunGlowInner.scale.setScalar(scale * 7.3);
      this.sunGlowOuter.scale.setScalar(scale * 11);
      this.sunMaterial.uniforms.colorA.value.set(0xb51f0d);
      this.sunMaterial.uniforms.colorB.value.set(0xff5a13);
      this.sunMaterial.uniforms.colorHot.value.set(0xffc061);
      this.sunLight.color.set(0xff6a2f);
      this.sunLight.intensity = 82;
      this.futureShells.visible = era === 'final-giant';
    } else if (era === 'white-dwarf') {
      earth.mesh.visible = true;
      earth.mesh.material = earth.scorchedMaterial;
      earth.atmosphere.visible = false;
      earth.clouds.visible = false;
      mercury.mesh.visible = false;
      venus.mesh.visible = false;
      this.sun.scale.setScalar(0.14);
      this.sunGlowInner.scale.setScalar(2.8);
      this.sunGlowOuter.scale.setScalar(8.5);
      this.sunGlowInner.material.color.set(0xbfe8ff);
      this.sunGlowOuter.material.color.set(0x5f8eff);
      this.sunGlowInner.material.opacity = 0.88;
      this.sunGlowOuter.material.opacity = 0.26;
      this.sunMaterial.uniforms.colorA.value.set(0xa7d8ff);
      this.sunMaterial.uniforms.colorB.value.set(0xffffff);
      this.sunMaterial.uniforms.colorHot.value.set(0xffffff);
      this.sunLight.color.set(0xc7e6ff);
      this.sunLight.intensity = 45;
      this.futureShells.visible = true;
    }
  }

  transitionTo(event, duration = 3200, onProgress = () => {}) {
    if (!this.available) return Promise.resolve();
    if (this.cameraTween) {
      const interruptedTween = this.cameraTween;
      this.cameraTween = null;
      interruptedTween.resolve();
    }
    this.applyEra(event.scene);
    const shot = SHOTS[event.scene] || SHOTS.orrery;
    const startPosition = this.camera.position.clone();
    const startTarget = this.cameraTarget.clone();
    const targetId = shot.target || 'sun';
    const targetPosition = this.resolveBodyPosition(targetId);
    const endPosition = targetPosition.clone().add(new THREE.Vector3(...shot.offset));
    const effectiveDuration = this.reduceMotion ? Math.min(duration, 520) : duration;

    return new Promise((resolve) => {
      this.cameraTween = {
        elapsed: 0,
        duration: Math.max(1, effectiveDuration / 1000),
        startPosition,
        startTarget,
        endOffset: new THREE.Vector3(...shot.offset),
        targetId,
        endFov: shot.fov,
        startFov: this.camera.fov,
        onProgress,
        resolve
      };
      this.activeTargetId = targetId;
    });
  }

  resolveBodyPosition(id) {
    if (id === 'sun' || !this.planets.has(id)) return new THREE.Vector3();
    const planet = this.planets.get(id);
    return planet.mesh.getWorldPosition(new THREE.Vector3());
  }

  updateCameraTween(delta) {
    if (!this.cameraTween || this.paused) return;
    const tween = this.cameraTween;
    tween.elapsed += delta;
    const rawProgress = Math.min(1, tween.elapsed / tween.duration);
    const progress = easeInOutCubic(rawProgress);
    const liveTarget = this.resolveBodyPosition(tween.targetId);
    const liveEnd = liveTarget.clone().add(tween.endOffset);

    this.cameraBase.lerpVectors(tween.startPosition, liveEnd, progress);
    this.cameraTarget.lerpVectors(tween.startTarget, liveTarget, progress);
    this.camera.fov = THREE.MathUtils.lerp(tween.startFov, tween.endFov, progress);
    this.camera.updateProjectionMatrix();
    tween.onProgress(rawProgress);

    if (rawProgress >= 1) {
      this.cameraTween = null;
      tween.resolve();
    }
  }

  animate() {
    if (!this.renderer || !this.scene) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    const ambientDelta = this.paused ? delta * 0.08 : delta;
    this.visualTime += ambientDelta;
    this.updateCameraTween(delta);

    this.sun.rotation.y += ambientDelta * 0.055;
    this.sunMaterial.uniforms.time.value = this.visualTime;
    this.sunGlowInner.material.rotation = this.visualTime * 0.018;
    this.sunGlowOuter.material.rotation = -this.visualTime * 0.009;
    this.starfield.rotation.y += ambientDelta * 0.00055;
    this.formationDisk.rotation.y += ambientDelta * 0.012;
    this.asteroidBelt.rotation.y += ambientDelta * 0.005;
    this.futureShells.rotation.y += ambientDelta * 0.008;
    this.futureShells.rotation.z = Math.sin(this.visualTime * 0.05) * 0.05;

    this.planets.forEach((planet) => {
      const speedScale = this.reduceMotion ? 0.22 : 1;
      planet.pivot.rotation.y += ambientDelta * planet.speed * speedScale;
      planet.mesh.rotation.y += ambientDelta * (0.09 + planet.speed) * speedScale;
    });

    const earth = this.planets.get('earth');
    earth.clouds.rotation.y += ambientDelta * 0.018;
    earth.moonPivot.rotation.y += ambientDelta * 0.1;
    earth.cityLights.rotation.y += ambientDelta * 0.004;

    const earthPosition = earth.mesh.getWorldPosition(new THREE.Vector3());
    this.impactDebris.position.copy(earthPosition);
    this.impactDebris.rotation.y += ambientDelta * 0.19;
    this.impactDebris.rotation.z = 0.26;
    this.impactor.position.copy(earthPosition).add(new THREE.Vector3(
      0.58 + Math.sin(this.visualTime * 0.18) * 0.1,
      0.08,
      0.34
    ));

    this.chicxulubAsteroid.position.copy(earthPosition).add(new THREE.Vector3(
      0.36 + Math.sin(this.visualTime * 0.8) * 0.06,
      0.28,
      0.42 + Math.cos(this.visualTime * 0.6) * 0.08
    ));
    this.chicxulubAsteroid.rotation.x += ambientDelta * 0.38;
    this.chicxulubAsteroid.rotation.y += ambientDelta * 0.52;

    if (!this.cameraTween) {
      const liveTarget = this.resolveBodyPosition(this.activeTargetId);
      this.cameraTarget.lerp(liveTarget, Math.min(1, delta * 2.2));
    }

    const driftScale = this.reduceMotion ? 0.015 : 0.095;
    this.camera.position.copy(this.cameraBase);
    this.camera.position.y += Math.sin(this.visualTime * 0.17) * driftScale;
    this.camera.position.x += Math.cos(this.visualTime * 0.11) * driftScale * 0.55;
    this.camera.lookAt(this.cameraTarget);
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.boundAnimate);
  }

  setPaused(paused) {
    this.paused = paused;
  }

  setReducedMotion(reduceMotion) {
    this.reduceMotion = reduceMotion;
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const height = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
  }
}
