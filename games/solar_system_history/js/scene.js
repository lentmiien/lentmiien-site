import * as THREE from '../vendor/three.module.min.js';

const TAU = Math.PI * 2;

const PLANET_SPECS = [
  { id: 'mercury', radius: 0.19, distance: 5.2, speed: 0.13, color: '#8d857a', roughness: 0.96, phase: 0.7, tilt: 0.03 },
  { id: 'venus', radius: 0.34, distance: 7.1, speed: 0.09, color: '#bd7d45', roughness: 0.88, phase: 2.2, tilt: 0.05, glow: '#e7a858' },
  { id: 'earth', radius: 0.37, distance: 9.4, speed: 0.07, color: '#2e70a0', roughness: 0.72, phase: 4.2, tilt: 0.41 },
  { id: 'mars', radius: 0.25, distance: 11.8, speed: 0.056, color: '#93472f', roughness: 0.92, phase: 1.7, tilt: 0.44, glow: '#ca5d37' },
  { id: 'jupiter', radius: 1.04, distance: 17.4, speed: 0.029, color: '#b9875f', roughness: 0.84, phase: 5.1, tilt: 0.05, glow: '#d9b98e' },
  { id: 'saturn', radius: 0.88, distance: 23.2, speed: 0.021, color: '#c4a66d', roughness: 0.88, phase: 3.4, tilt: 0.47, glow: '#e1c78f', rings: true },
  { id: 'uranus', radius: 0.6, distance: 28.8, speed: 0.015, color: '#71aeb6', roughness: 0.74, phase: 0.2, tilt: 1.7, glow: '#8edbe0' },
  { id: 'neptune', radius: 0.57, distance: 34.2, speed: 0.012, color: '#315b9f', roughness: 0.78, phase: 2.8, tilt: 0.49, glow: '#4c80e2' }
];

const SHOTS = {
  nebula: { offset: [0, 4.4, 15.8], target: 'sun', fov: 53, roll: -0.018, lift: 1.4, sweep: -0.7, drift: 0.16 },
  formation: { offset: [0, 10.5, 27], target: 'sun', fov: 51, roll: 0.014, lift: 2.1, sweep: 1.1, drift: 0.2 },
  impact: { offset: [1.32, 0.56, 2.28], target: 'earth', fov: 38, roll: -0.045, lift: 0.9, sweep: 0.72, drift: 0.075 },
  'earth-young': { offset: [1.16, 0.42, 2.05], target: 'earth', fov: 36, roll: 0.02, lift: 0.7, sweep: -0.48, drift: 0.065 },
  bombardment: { offset: [1.85, 0.88, 3.18], target: 'earth', fov: 40, roll: -0.025, lift: 1.1, sweep: 0.62, drift: 0.1 },
  'earth-ocean': { offset: [1.03, 0.24, 1.88], target: 'earth', fov: 35, roll: 0.018, lift: 0.62, sweep: -0.42, drift: 0.06 },
  'earth-oxygen': { offset: [-1.12, 0.42, 2.02], target: 'earth', fov: 36, roll: -0.018, lift: 0.7, sweep: 0.5, drift: 0.065 },
  'earth-life': { offset: [1.18, 0.3, 2.05], target: 'earth', fov: 35, roll: 0.016, lift: 0.65, sweep: -0.5, drift: 0.06 },
  asteroid: { offset: [1.48, 0.48, 2.58], target: 'earth', fov: 36, roll: -0.035, lift: 0.85, sweep: 0.65, drift: 0.075 },
  'earth-human': { offset: [-1.05, 0.38, 1.92], target: 'earth', fov: 35, roll: -0.014, lift: 0.6, sweep: 0.44, drift: 0.055 },
  'earth-night': { offset: [1.08, -0.1, 1.96], target: 'earth', fov: 35, roll: 0.022, lift: 0.55, sweep: -0.46, drift: 0.055 },
  orrery: { offset: [0, 13.5, 27], target: 'sun', fov: 47, roll: -0.014, lift: 2.2, sweep: 1.3, drift: 0.2 },
  moon: { offset: [1.18, 0.46, 2.05], target: 'earth', fov: 34, roll: 0.018, lift: 0.72, sweep: -0.5, drift: 0.06 },
  today: { offset: [-0.98, 0.3, 1.72], target: 'earth', fov: 34, roll: -0.012, lift: 0.62, sweep: 0.48, drift: 0.05 },
  'earth-warm': { offset: [1.08, 0.28, 1.9], target: 'earth', fov: 35, roll: 0.02, lift: 0.62, sweep: -0.45, drift: 0.06 },
  'earth-scorched': { offset: [-1.03, 0.2, 1.82], target: 'earth', fov: 35, roll: -0.024, lift: 0.64, sweep: 0.46, drift: 0.06 },
  'sun-aging': { offset: [0, 2.6, 11.7], target: 'sun', fov: 45, roll: 0.012, lift: 1.4, sweep: -0.8, drift: 0.13 },
  'red-giant': { offset: [0, 5.4, 22], target: 'sun', fov: 55, roll: -0.02, lift: 2.1, sweep: 1.15, drift: 0.18 },
  'final-giant': { offset: [0, 7.1, 28], target: 'sun', fov: 58, roll: 0.024, lift: 2.6, sweep: -1.25, drift: 0.2 },
  'white-dwarf': { offset: [0, 3.8, 14.5], target: 'sun', fov: 46, roll: -0.015, lift: 1.7, sweep: 0.9, drift: 0.14 }
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
    this.starMaterials = [];
    this.cameraTween = null;
    this.cameraBase = new THREE.Vector3(0, 4, 16);
    this.cameraTarget = new THREE.Vector3();
    this.cameraRoll = 0;
    this.cameraTravelIntensity = 0;
    this.currentShot = SHOTS.nebula;
    this.cameraForward = new THREE.Vector3();
    this.cameraRight = new THREE.Vector3();
    this.cameraUp = new THREE.Vector3();
    this.cameraLiveTarget = new THREE.Vector3();
    this.cameraLiveEnd = new THREE.Vector3();
    this.cameraTravelDirection = new THREE.Vector3();
    this.cameraSweepDirection = new THREE.Vector3();
    this.earthWorldPosition = new THREE.Vector3();
    this.effectOffset = new THREE.Vector3();
    this.asteroidLookTarget = new THREE.Vector3();
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
      this.createNebulaBackdrop();
      this.createStarfield();
      this.createCinematicDust();
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
    this.scene.add(new THREE.HemisphereLight(0x6e83ac, 0x090708, 0.42));
    const rimLight = new THREE.DirectionalLight(0x7f9dff, 0.58);
    rimLight.position.set(-22, 14, -26);
    this.scene.add(rimLight);
    this.sunLight = new THREE.PointLight(0xffd6a0, 58, 95, 1.45);
    this.scene.add(this.sunLight);
  }

  createNebulaBackdrop() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    const random = seededRandom(70419);
    context.fillStyle = '#020309';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'screen';

    const cloudColors = [
      [50, 70, 128],
      [77, 45, 105],
      [28, 92, 112],
      [121, 55, 38],
      [118, 88, 35]
    ];

    for (let index = 0; index < 86; index += 1) {
      const x = random() * canvas.width;
      const band = canvas.height * 0.5 + Math.sin(x / canvas.width * TAU * 1.35) * 62;
      const y = band + (random() - 0.5) * (70 + random() * 210);
      const radius = 55 + random() * 180;
      const [red, green, blue] = cloudColors[Math.floor(random() * cloudColors.length)];
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${red},${green},${blue},${0.045 + random() * 0.075})`);
      gradient.addColorStop(0.38, `rgba(${red},${green},${blue},${0.018 + random() * 0.035})`);
      gradient.addColorStop(1, `rgba(${red},${green},${blue},0)`);
      context.save();
      context.translate(x, y);
      context.scale(1.8 + random() * 2.7, 0.35 + random() * 0.7);
      context.translate(-x, -y);
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      context.restore();
    }

    const milkyWay = context.createLinearGradient(0, 110, 0, 405);
    milkyWay.addColorStop(0, 'rgba(96,118,168,0)');
    milkyWay.addColorStop(0.48, 'rgba(142,157,190,0.045)');
    milkyWay.addColorStop(0.52, 'rgba(255,210,151,0.055)');
    milkyWay.addColorStop(1, 'rgba(80,100,154,0)');
    context.fillStyle = milkyWay;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.globalCompositeOperation = 'source-over';

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    this.nebulaBackdrop = new THREE.Mesh(
      new THREE.SphereGeometry(430, 48, 28),
      new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.BackSide,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
        fog: false
      })
    );
    this.nebulaBackdrop.rotation.set(0.08, -0.7, -0.12);
    this.nebulaBackdrop.renderOrder = -100;
    this.scene.add(this.nebulaBackdrop);
  }

  createStarfield() {
    const random = seededRandom(43109);
    const count = this.reduceMotion ? 2100 : 4300;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const twinkle = new Float32Array(count);
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
      sizes[index] = 1.2 + Math.pow(random(), 4) * 5.2;
      twinkle[index] = random() * TAU;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('twinkle', new THREE.BufferAttribute(twinkle, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.7) }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      fog: false,
      vertexShader: `
        uniform float time;
        uniform float pixelRatio;
        attribute float size;
        attribute float twinkle;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vPulse;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          float pulse = 0.78 + sin(time * (0.7 + fract(twinkle) * 1.3) + twinkle) * 0.22;
          float perspective = clamp(250.0 / max(1.0, -viewPosition.z), 0.42, 2.4);
          gl_PointSize = max(1.0, size * pixelRatio * perspective * pulse);
          gl_Position = projectionMatrix * viewPosition;
          vColor = color;
          vPulse = pulse;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        varying float vPulse;
        void main() {
          vec2 point = gl_PointCoord - vec2(0.5);
          float distanceToCenter = length(point);
          float disc = 1.0 - smoothstep(0.08, 0.5, distanceToCenter);
          float core = 1.0 - smoothstep(0.0, 0.2, distanceToCenter);
          float rayX = (1.0 - smoothstep(0.0, 0.055, abs(point.x))) * (1.0 - smoothstep(0.08, 0.48, abs(point.y)));
          float rayY = (1.0 - smoothstep(0.0, 0.055, abs(point.y))) * (1.0 - smoothstep(0.08, 0.48, abs(point.x)));
          float alpha = disc * 0.72 + core * 0.45 + (rayX + rayY) * 0.16;
          if (alpha < 0.01) discard;
          gl_FragColor = vec4(vColor * (0.84 + core * 0.5), alpha * vPulse);
        }
      `
    });
    this.starMaterials.push(material);
    this.starfield = new THREE.Points(geometry, material);
    this.starfield.renderOrder = -90;
    this.scene.add(this.starfield);
  }

  createCinematicDust() {
    const random = seededRandom(12803);
    const count = this.reduceMotion ? 260 : 720;
    const positions = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      const radius = 9 + Math.pow(random(), 0.62) * 72;
      const theta = random() * TAU;
      const phi = Math.acos(2 * random() - 1);
      const offset = index * 3;
      positions[offset] = radius * Math.sin(phi) * Math.cos(theta);
      positions[offset + 1] = radius * Math.cos(phi) * 0.55;
      positions[offset + 2] = radius * Math.sin(phi) * Math.sin(theta);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.cinematicDust = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xffd4a1,
      size: 0.038,
      transparent: true,
      opacity: 0.11,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    }));
    this.cinematicDust.renderOrder = -80;
    this.scene.add(this.cinematicDust);
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
        varying vec3 vViewDirection;
        void main() {
          vPosition = position;
          vNormalView = normalize(normalMatrix * normal);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vViewDirection = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 colorA;
        uniform vec3 colorB;
        uniform vec3 colorHot;
        varying vec3 vPosition;
        varying vec3 vNormalView;
        varying vec3 vViewDirection;
        void main() {
          float flowA = sin(vPosition.y * 8.0 + sin(vPosition.x * 3.4 + time * 0.35) + time * 0.62);
          float flowB = sin(vPosition.x * 14.0 - time * 0.86) * sin(vPosition.z * 12.0 + time * 0.48);
          float granules = sin((vPosition.x + vPosition.y) * 24.0 + time) * sin((vPosition.z - vPosition.y) * 21.0 - time * 0.72);
          float turbulence = clamp(0.56 + flowA * 0.2 + flowB * 0.15 + granules * 0.09, 0.0, 1.0);
          float rim = pow(1.0 - max(0.0, dot(vNormalView, vViewDirection)), 2.4);
          vec3 color = mix(colorA, colorB, turbulence);
          color = mix(color, colorHot, rim * 0.42 + max(flowB, 0.0) * 0.1 + max(granules, 0.0) * 0.06);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    });

    this.sun = new THREE.Mesh(
      new THREE.SphereGeometry(2.05, 64, 48),
      this.sunMaterial
    );
    this.scene.add(this.sun);

    this.sunCoronaMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        color: { value: new THREE.Color(0xffa247) },
        strength: { value: 0.72 }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      vertexShader: `
        varying vec3 vNormalView;
        varying vec3 vViewDirection;
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          vNormalView = normalize(normalMatrix * normal);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vViewDirection = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform float strength;
        uniform vec3 color;
        varying vec3 vNormalView;
        varying vec3 vViewDirection;
        varying vec3 vPosition;
        void main() {
          float fresnel = pow(1.0 - abs(dot(vNormalView, vViewDirection)), 2.2);
          float ripple = 0.78 + sin(vPosition.y * 17.0 + vPosition.x * 8.0 + time * 1.2) * 0.16;
          float alpha = fresnel * ripple * strength;
          gl_FragColor = vec4(color, alpha);
        }
      `
    });
    this.sunCorona = new THREE.Mesh(
      new THREE.SphereGeometry(2.28, 56, 40),
      this.sunCoronaMaterial
    );
    this.sun.add(this.sunCorona);

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

    this.sunRays = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.makeCoronaTexture(),
      color: 0xffb35b,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }));
    this.sunRays.scale.setScalar(10.8);
    this.sunRaysBaseOpacity = 0.3;
    this.scene.add(this.sunRays);
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

  makeCoronaTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    const random = seededRandom(39017);
    const center = canvas.width / 2;
    context.translate(center, center);
    context.globalCompositeOperation = 'lighter';

    for (let index = 0; index < 190; index += 1) {
      const angle = index / 190 * TAU + (random() - 0.5) * 0.025;
      const start = 60 + random() * 34;
      const length = 72 + Math.pow(random(), 1.7) * 145;
      const gradient = context.createLinearGradient(
        Math.cos(angle) * start,
        Math.sin(angle) * start,
        Math.cos(angle) * (start + length),
        Math.sin(angle) * (start + length)
      );
      gradient.addColorStop(0, `rgba(255,226,170,${0.08 + random() * 0.12})`);
      gradient.addColorStop(0.45, `rgba(255,151,57,${0.025 + random() * 0.05})`);
      gradient.addColorStop(1, 'rgba(255,102,25,0)');
      context.strokeStyle = gradient;
      context.lineWidth = 0.45 + random() * 1.5;
      context.beginPath();
      context.moveTo(Math.cos(angle) * start, Math.sin(angle) * start);
      context.lineTo(Math.cos(angle) * (start + length), Math.sin(angle) * (start + length));
      context.stroke();
    }

    const core = context.createRadialGradient(0, 0, 48, 0, 0, 178);
    core.addColorStop(0, 'rgba(255,255,255,0.22)');
    core.addColorStop(0.26, 'rgba(255,190,94,0.12)');
    core.addColorStop(1, 'rgba(255,100,20,0)');
    context.fillStyle = core;
    context.fillRect(-center, -center, canvas.width, canvas.height);

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
      const material = new THREE.MeshPhysicalMaterial({
        color: spec.color,
        map: this.makePlanetTexture(spec),
        roughness: spec.roughness,
        metalness: 0.01,
        clearcoat: ['earth', 'venus', 'jupiter', 'saturn'].includes(spec.id) ? 0.12 : 0.02,
        clearcoatRoughness: 0.8
      });
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(spec.radius, 56, 36),
        material
      );
      mesh.position.x = spec.distance;
      mesh.rotation.z = spec.tilt;
      pivot.rotation.y = spec.phase;
      pivot.add(mesh);
      this.planetsRoot.add(pivot);

      const planet = { ...spec, mesh, pivot, material };
      this.planets.set(spec.id, planet);

      if (spec.id === 'earth') this.decorateEarth(planet);
      if (spec.glow) this.decoratePlanetGlow(planet, spec.glow);
      if (spec.rings) this.decorateSaturn(planet);
    });
  }

  decoratePlanetGlow(planet, color) {
    const material = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(color) },
        opacity: { value: planet.id === 'mars' ? 0.22 : 0.32 }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vNormalView;
        varying vec3 vViewDirection;
        void main() {
          vNormalView = normalize(normalMatrix * normal);
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          vViewDirection = normalize(-viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform vec3 color;
        uniform float opacity;
        varying vec3 vNormalView;
        varying vec3 vViewDirection;
        void main() {
          float rim = pow(1.0 - abs(dot(vNormalView, vViewDirection)), 2.7);
          gl_FragColor = vec4(color, rim * opacity);
        }
      `
    });
    planet.glow = new THREE.Mesh(
      new THREE.SphereGeometry(planet.radius * 1.075, 44, 30),
      material
    );
    planet.mesh.add(planet.glow);
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
      ocean.addColorStop(0, '#0b284c');
      ocean.addColorStop(0.48, '#2875a5');
      ocean.addColorStop(1, '#0b2447');
      context.fillStyle = ocean;
      context.fillRect(0, 0, canvas.width, canvas.height);

      for (let index = 0; index < 110; index += 1) {
        context.fillStyle = `rgba(130,203,232,${0.018 + random() * 0.025})`;
        context.fillRect(0, random() * canvas.height, canvas.width, 1 + random() * 2);
      }

      const landColors = ['#456d45', '#658554', '#887b4f', '#3d6847'];
      for (let continent = 0; continent < 18; continent += 1) {
        const x = random() * canvas.width;
        const y = 30 + random() * (canvas.height - 60);
        const width = 20 + random() * 62;
        const height = 11 + random() * 33;
        const points = 8 + Math.floor(random() * 5);
        context.fillStyle = landColors[Math.floor(random() * landColors.length)];
        context.beginPath();
        for (let point = 0; point <= points; point += 1) {
          const angle = point / points * TAU;
          const wobble = 0.68 + random() * 0.5;
          const pointX = x + Math.cos(angle) * width * wobble;
          const pointY = y + Math.sin(angle) * height * wobble;
          if (point === 0) context.moveTo(pointX, pointY);
          else context.lineTo(pointX, pointY);
        }
        context.closePath();
        context.fill();
      }

      context.globalAlpha = 0.38;
      context.fillStyle = '#d1b87d';
      for (let index = 0; index < 38; index += 1) {
        context.beginPath();
        context.ellipse(random() * canvas.width, 30 + random() * 196, 3 + random() * 18, 1 + random() * 5, random(), 0, TAU);
        context.fill();
      }
      context.globalAlpha = 1;

      const northIce = context.createLinearGradient(0, 0, 0, 42);
      northIce.addColorStop(0, 'rgba(235,246,249,0.92)');
      northIce.addColorStop(1, 'rgba(220,240,244,0)');
      context.fillStyle = northIce;
      context.fillRect(0, 0, canvas.width, 42);
      const southIce = context.createLinearGradient(0, canvas.height - 38, 0, canvas.height);
      southIce.addColorStop(0, 'rgba(220,240,244,0)');
      southIce.addColorStop(1, 'rgba(235,246,249,0.9)');
      context.fillStyle = southIce;
      context.fillRect(0, canvas.height - 38, canvas.width, 38);
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
    } else if (spec.id === 'venus') {
      const haze = context.createLinearGradient(0, 0, 0, canvas.height);
      haze.addColorStop(0, '#8f552d');
      haze.addColorStop(0.5, '#d29a58');
      haze.addColorStop(1, '#704326');
      context.fillStyle = haze;
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (let band = 0; band < 42; band += 1) {
        const y = band / 42 * canvas.height;
        context.strokeStyle = `rgba(255,224,153,${0.025 + random() * 0.08})`;
        context.lineWidth = 2 + random() * 7;
        context.beginPath();
        for (let x = 0; x <= canvas.width; x += 16) {
          const waveY = y + Math.sin(x * 0.025 + band) * (2 + random() * 3);
          if (x === 0) context.moveTo(x, waveY);
          else context.lineTo(x, waveY);
        }
        context.stroke();
      }
    } else if (spec.id === 'mars' || spec.id === 'mercury') {
      const isMars = spec.id === 'mars';
      const ground = context.createLinearGradient(0, 0, 0, canvas.height);
      ground.addColorStop(0, isMars ? '#6f3528' : '#77736d');
      ground.addColorStop(0.5, isMars ? '#a34f34' : '#9b948b');
      ground.addColorStop(1, isMars ? '#552b25' : '#68645f');
      context.fillStyle = ground;
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (let crater = 0; crater < 95; crater += 1) {
        const x = random() * canvas.width;
        const y = random() * canvas.height;
        const radius = 1.5 + Math.pow(random(), 2) * 18;
        const craterGradient = context.createRadialGradient(x - radius * 0.25, y - radius * 0.25, 0, x, y, radius);
        craterGradient.addColorStop(0, isMars ? 'rgba(226,125,76,0.25)' : 'rgba(230,225,214,0.2)');
        craterGradient.addColorStop(0.55, 'rgba(20,12,10,0.08)');
        craterGradient.addColorStop(1, 'rgba(10,7,7,0.28)');
        context.fillStyle = craterGradient;
        context.beginPath();
        context.arc(x, y, radius, 0, TAU);
        context.fill();
      }
      if (isMars) {
        context.fillStyle = 'rgba(240,225,205,0.72)';
        context.fillRect(0, 0, canvas.width, 9);
        context.fillRect(0, canvas.height - 7, canvas.width, 7);
      }
    } else if (spec.id === 'uranus' || spec.id === 'neptune') {
      const isNeptune = spec.id === 'neptune';
      const atmosphere = context.createLinearGradient(0, 0, 0, canvas.height);
      atmosphere.addColorStop(0, isNeptune ? '#173e87' : '#5d9ca7');
      atmosphere.addColorStop(0.5, isNeptune ? '#356ec2' : '#8cc8cc');
      atmosphere.addColorStop(1, isNeptune ? '#102e6f' : '#4d8c9a');
      context.fillStyle = atmosphere;
      context.fillRect(0, 0, canvas.width, canvas.height);
      for (let band = 0; band < 28; band += 1) {
        context.fillStyle = `rgba(220,244,255,${0.012 + random() * 0.038})`;
        context.fillRect(0, random() * canvas.height, canvas.width, 1 + random() * 5);
      }
      if (isNeptune) {
        context.fillStyle = 'rgba(22,32,91,0.7)';
        context.beginPath();
        context.ellipse(354, 148, 31, 12, -0.05, 0, TAU);
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
      new THREE.MeshStandardMaterial({
        color: 0xaaa69e,
        map: this.makeMoonTexture(),
        roughness: 1
      })
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

  makeMoonTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 384;
    canvas.height = 192;
    const context = canvas.getContext('2d');
    const random = seededRandom(19690720);
    const base = context.createLinearGradient(0, 0, 0, canvas.height);
    base.addColorStop(0, '#8f8d88');
    base.addColorStop(0.5, '#b3b0aa');
    base.addColorStop(1, '#777570');
    context.fillStyle = base;
    context.fillRect(0, 0, canvas.width, canvas.height);
    for (let index = 0; index < 90; index += 1) {
      const x = random() * canvas.width;
      const y = random() * canvas.height;
      const radius = 1 + Math.pow(random(), 2) * 13;
      const gradient = context.createRadialGradient(x - radius * 0.28, y - radius * 0.28, 0, x, y, radius);
      gradient.addColorStop(0, 'rgba(235,232,224,0.35)');
      gradient.addColorStop(0.58, 'rgba(65,63,60,0.16)');
      gradient.addColorStop(1, 'rgba(35,34,33,0.4)');
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(x, y, radius, 0, TAU);
      context.fill();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    return texture;
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
    const ringCanvas = document.createElement('canvas');
    ringCanvas.width = 512;
    ringCanvas.height = 16;
    const ringContext = ringCanvas.getContext('2d');
    const ringGradient = ringContext.createLinearGradient(0, 0, ringCanvas.width, 0);
    ringGradient.addColorStop(0, 'rgba(104,86,63,0.05)');
    ringGradient.addColorStop(0.08, 'rgba(219,199,156,0.72)');
    ringGradient.addColorStop(0.18, 'rgba(115,96,69,0.35)');
    ringGradient.addColorStop(0.36, 'rgba(235,218,178,0.88)');
    ringGradient.addColorStop(0.53, 'rgba(80,66,50,0.18)');
    ringGradient.addColorStop(0.68, 'rgba(212,190,144,0.74)');
    ringGradient.addColorStop(0.86, 'rgba(132,110,80,0.42)');
    ringGradient.addColorStop(1, 'rgba(222,201,160,0.04)');
    ringContext.fillStyle = ringGradient;
    ringContext.fillRect(0, 0, ringCanvas.width, ringCanvas.height);
    const ringTexture = new THREE.CanvasTexture(ringCanvas);
    ringTexture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshBasicMaterial({
      map: ringTexture,
      color: 0xf0d9aa,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      alphaTest: 0.025
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
      sizes[index] = 0.8 + Math.pow(random(), 2.2) * 3.8;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.formationDiskMaterial = new THREE.ShaderMaterial({
      uniforms: {
        pixelRatio: { value: Math.min(window.devicePixelRatio || 1, 1.7) }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        uniform float pixelRatio;
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        void main() {
          vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
          float perspective = clamp(190.0 / max(1.0, -viewPosition.z), 0.38, 3.0);
          gl_PointSize = max(1.0, size * pixelRatio * perspective);
          gl_Position = projectionMatrix * viewPosition;
          vColor = color;
        }
      `,
      fragmentShader: `
        varying vec3 vColor;
        void main() {
          float distanceToCenter = length(gl_PointCoord - vec2(0.5));
          float alpha = 1.0 - smoothstep(0.08, 0.5, distanceToCenter);
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(vColor, alpha * 0.88);
        }
      `
    });
    this.formationDisk = new THREE.Points(geometry, this.formationDiskMaterial);
    this.scene.add(this.formationDisk);

    this.formationHazeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        innerColor: { value: new THREE.Color(0xff9c3d) },
        outerColor: { value: new THREE.Color(0x745365) }
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vPosition;
        void main() {
          vPosition = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 innerColor;
        uniform vec3 outerColor;
        varying vec3 vPosition;
        void main() {
          float radius = length(vPosition.xy);
          float normalizedRadius = clamp((radius - 2.3) / 37.0, 0.0, 1.0);
          float angle = atan(vPosition.y, vPosition.x);
          float lanes = sin(radius * 3.1 + angle * 7.0 - time * 0.22) * 0.5 + 0.5;
          float spiral = sin(radius * 0.85 - angle * 3.0 + time * 0.12) * 0.5 + 0.5;
          float edge = smoothstep(0.0, 0.08, normalizedRadius) * (1.0 - smoothstep(0.76, 1.0, normalizedRadius));
          float alpha = edge * (0.018 + lanes * 0.03 + spiral * 0.018) * (1.0 - normalizedRadius * 0.5);
          vec3 color = mix(innerColor, outerColor, normalizedRadius);
          gl_FragColor = vec4(color, alpha);
        }
      `
    });
    this.formationHaze = new THREE.Mesh(
      new THREE.RingGeometry(2.3, 39.3, 192, 8),
      this.formationHazeMaterial
    );
    this.formationHaze.rotation.x = Math.PI / 2;
    this.scene.add(this.formationHaze);
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
      new THREE.IcosahedronGeometry(0.19, 2),
      new THREE.MeshStandardMaterial({ color: 0x4b3830, roughness: 0.95, emissive: 0x6d1f0c, emissiveIntensity: 0.24 })
    );
    this.impactor.scale.set(1.08, 0.78, 0.92);
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
    this.scene.add(this.asteroidTrail);

    this.impactFlash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.makeGlowTexture(),
      color: 0xff6f24,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }));
    this.impactFlash.scale.setScalar(2.25);
    this.scene.add(this.impactFlash);

    this.asteroidGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.makeGlowTexture(),
      color: 0xff7c2c,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false
    }));
    this.asteroidGlow.scale.setScalar(0.72);
    this.chicxulubAsteroid.add(this.asteroidGlow);
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

    const nebulaTexture = this.makePlanetaryNebulaTexture();
    this.planetaryNebula = new THREE.Group();
    const nebulaColors = [0x73d8e3, 0x5b78d9, 0xff9e55];
    const scales = [[72, 45, 1], [57, 63, 1], [44, 31, 1]];
    for (let index = 0; index < 3; index += 1) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: nebulaTexture,
        color: nebulaColors[index],
        transparent: true,
        opacity: 0.22 - index * 0.035,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        rotation: index * 1.03
      }));
      sprite.scale.set(...scales[index]);
      this.planetaryNebula.add(sprite);
    }
    this.scene.add(this.planetaryNebula);
  }

  makePlanetaryNebulaTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    const random = seededRandom(77131);
    const center = canvas.width / 2;
    context.translate(center, center);
    context.globalCompositeOperation = 'lighter';

    for (let layer = 0; layer < 72; layer += 1) {
      const angle = random() * TAU;
      const distance = 38 + random() * 140;
      const x = Math.cos(angle) * distance;
      const y = Math.sin(angle) * distance * (0.56 + random() * 0.34);
      const radius = 28 + random() * 76;
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(180,235,255,${0.03 + random() * 0.055})`);
      gradient.addColorStop(0.48, `rgba(79,134,214,${0.012 + random() * 0.03})`);
      gradient.addColorStop(1, 'rgba(27,50,120,0)');
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    const hollowCore = context.createRadialGradient(0, 0, 18, 0, 0, 218);
    hollowCore.addColorStop(0, 'rgba(255,255,255,0.16)');
    hollowCore.addColorStop(0.14, 'rgba(150,226,255,0.07)');
    hollowCore.addColorStop(0.32, 'rgba(80,155,219,0.02)');
    hollowCore.addColorStop(0.72, 'rgba(48,88,168,0.07)');
    hollowCore.addColorStop(1, 'rgba(30,45,100,0)');
    context.fillStyle = hollowCore;
    context.fillRect(-center, -center, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  applyEra(era) {
    if (!this.scene) return;
    this.era = era;
    const earth = this.planets.get('earth');
    const mercury = this.planets.get('mercury');
    const venus = this.planets.get('venus');

    this.planetsRoot.visible = true;
    this.formationDisk.visible = false;
    this.formationHaze.visible = false;
    this.impactDebris.visible = false;
    this.impactor.visible = false;
    this.impactFlash.visible = false;
    this.chicxulubAsteroid.visible = false;
    this.asteroidTrail.visible = false;
    this.futureShells.visible = false;
    this.planetaryNebula.visible = false;
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
    this.sunRays.scale.setScalar(10.8);
    this.sunRays.material.color.set(0xffb35b);
    this.sunRays.material.opacity = 0.3;
    this.sunRaysBaseOpacity = 0.3;
    this.sunMaterial.uniforms.colorA.value.set(0xff7b22);
    this.sunMaterial.uniforms.colorB.value.set(0xffd77a);
    this.sunMaterial.uniforms.colorHot.value.set(0xfff5d6);
    this.sunLight.color.set(0xffd6a0);
    this.sunLight.intensity = 58;
    this.sunCoronaMaterial.uniforms.color.value.set(0xffa247);
    this.sunCoronaMaterial.uniforms.strength.value = 0.72;
    this.nebulaBackdrop.material.opacity = 0.92;

    this.orbits.forEach((orbit) => {
      orbit.material.opacity = 0.13;
    });

    if (era === 'nebula') {
      this.planetsRoot.visible = false;
      this.formationDisk.visible = true;
      this.formationHaze.visible = true;
      this.sun.scale.setScalar(0.64);
      this.sunGlowInner.scale.setScalar(6.8);
      this.sunGlowOuter.scale.setScalar(18);
      this.sunRays.scale.setScalar(12.8);
      this.nebulaBackdrop.material.opacity = 1;
    } else if (era === 'formation') {
      this.formationDisk.visible = true;
      this.formationHaze.visible = true;
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
      this.impactFlash.visible = true;
    } else if (era === 'earth-young') {
      earth.mesh.material = earth.youngMaterial;
      earth.atmosphere.material.opacity = 0.11;
      earth.clouds.visible = false;
    } else if (era === 'bombardment') {
      earth.mesh.material = earth.youngMaterial;
      this.impactDebris.visible = true;
      this.impactor.visible = true;
      this.impactFlash.visible = true;
    } else if (era === 'earth-ocean') {
      earth.atmosphere.material.opacity = 0.14;
      earth.clouds.material.opacity = 0.24;
    } else if (era === 'earth-oxygen') {
      earth.atmosphere.material.opacity = 0.28;
      earth.clouds.material.opacity = 0.31;
    } else if (era === 'asteroid') {
      this.chicxulubAsteroid.visible = true;
      this.asteroidTrail.visible = true;
      this.impactFlash.visible = true;
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
      this.sunRays.scale.setScalar(15.5);
      this.sunCoronaMaterial.uniforms.strength.value = 0.82;
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
      this.sunRays.scale.setScalar(scale * 8.6);
      this.sunMaterial.uniforms.colorA.value.set(0xb51f0d);
      this.sunMaterial.uniforms.colorB.value.set(0xff5a13);
      this.sunMaterial.uniforms.colorHot.value.set(0xffc061);
      this.sunLight.color.set(0xff6a2f);
      this.sunLight.intensity = 82;
      this.sunCoronaMaterial.uniforms.color.value.set(0xff5f25);
      this.sunCoronaMaterial.uniforms.strength.value = 0.92;
      this.sunRays.material.color.set(0xff632b);
      this.sunRays.material.opacity = 0.38;
      this.sunRaysBaseOpacity = 0.38;
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
      this.sunRays.scale.setScalar(5.4);
      this.sunRays.material.color.set(0xbce8ff);
      this.sunRays.material.opacity = 0.34;
      this.sunRaysBaseOpacity = 0.34;
      this.sunMaterial.uniforms.colorA.value.set(0xa7d8ff);
      this.sunMaterial.uniforms.colorB.value.set(0xffffff);
      this.sunMaterial.uniforms.colorHot.value.set(0xffffff);
      this.sunLight.color.set(0xc7e6ff);
      this.sunLight.intensity = 45;
      this.sunCoronaMaterial.uniforms.color.value.set(0xbfe7ff);
      this.sunCoronaMaterial.uniforms.strength.value = 0.9;
      this.futureShells.visible = true;
      this.planetaryNebula.visible = true;
      this.nebulaBackdrop.material.opacity = 0.7;
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
    this.currentShot = shot;
    const startPosition = this.camera.position.clone();
    const startTarget = this.cameraTarget.clone();
    const targetId = shot.target || 'sun';
    const effectiveDuration = this.reduceMotion ? Math.min(duration, 520) : duration;

    return new Promise((resolve) => {
      this.cameraTween = {
        elapsed: 0,
        duration: Math.max(1, effectiveDuration / 1000),
        startPosition,
        startTarget,
        endOffset: new THREE.Vector3(...shot.offset),
        targetId,
        lift: this.reduceMotion ? 0 : (shot.lift || 0),
        sweep: this.reduceMotion ? 0 : (shot.sweep || 0),
        endFov: shot.fov,
        startFov: this.camera.fov,
        endRoll: this.reduceMotion ? 0 : (shot.roll || 0),
        startRoll: this.cameraRoll,
        onProgress,
        resolve
      };
      this.activeTargetId = targetId;
    });
  }

  resolveBodyPosition(id, target = new THREE.Vector3()) {
    if (id === 'sun' || !this.planets.has(id)) return target.set(0, 0, 0);
    const planet = this.planets.get(id);
    return planet.mesh.getWorldPosition(target);
  }

  updateCameraTween(delta) {
    if (!this.cameraTween || this.paused) return;
    const tween = this.cameraTween;
    tween.elapsed += delta;
    const rawProgress = Math.min(1, tween.elapsed / tween.duration);
    const progress = easeInOutCubic(rawProgress);
    const liveTarget = this.resolveBodyPosition(tween.targetId, this.cameraLiveTarget);
    const liveEnd = this.cameraLiveEnd.copy(liveTarget).add(tween.endOffset);

    this.cameraBase.lerpVectors(tween.startPosition, liveEnd, progress);
    const arc = Math.sin(progress * Math.PI);
    const travelDirection = this.cameraTravelDirection.subVectors(liveEnd, tween.startPosition);
    const sweepDirection = this.cameraSweepDirection.crossVectors(travelDirection, this.camera.up).normalize();
    if (sweepDirection.lengthSq() > 0) {
      this.cameraBase.addScaledVector(sweepDirection, tween.sweep * arc);
    }
    this.cameraBase.y += tween.lift * arc;
    this.cameraTarget.lerpVectors(tween.startTarget, liveTarget, progress);
    this.cameraRoll = THREE.MathUtils.lerp(tween.startRoll, tween.endRoll, progress);
    this.cameraTravelIntensity = Math.sin(rawProgress * Math.PI);
    this.camera.fov = THREE.MathUtils.lerp(tween.startFov, tween.endFov, progress);
    this.camera.updateProjectionMatrix();
    tween.onProgress(rawProgress);

    if (rawProgress >= 1) {
      this.cameraTween = null;
      this.cameraTravelIntensity = 0;
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
    this.sunCoronaMaterial.uniforms.time.value = this.visualTime;
    this.sunGlowInner.material.rotation = this.visualTime * 0.018;
    this.sunGlowOuter.material.rotation = -this.visualTime * 0.009;
    this.sunRays.material.rotation = this.visualTime * 0.006;
    this.sunRays.material.opacity = this.sunRaysBaseOpacity * (0.94 + Math.sin(this.visualTime * 0.7) * 0.06);
    this.starMaterials.forEach((material) => {
      material.uniforms.time.value = this.visualTime;
    });
    this.starfield.rotation.y += ambientDelta * 0.00055;
    this.nebulaBackdrop.rotation.y += ambientDelta * 0.00007;
    this.cinematicDust.rotation.y -= ambientDelta * 0.0015;
    this.cinematicDust.rotation.x = Math.sin(this.visualTime * 0.025) * 0.025;
    this.cinematicDust.material.opacity = 0.1 + this.cameraTravelIntensity * 0.26;
    this.formationDisk.rotation.y += ambientDelta * 0.012;
    this.formationHaze.rotation.z -= ambientDelta * 0.0035;
    this.formationHazeMaterial.uniforms.time.value = this.visualTime;
    this.asteroidBelt.rotation.y += ambientDelta * 0.005;
    this.futureShells.rotation.y += ambientDelta * 0.008;
    this.futureShells.rotation.z = Math.sin(this.visualTime * 0.05) * 0.05;
    this.planetaryNebula.children.forEach((sprite, index) => {
      sprite.material.rotation += ambientDelta * (index % 2 === 0 ? 0.0022 : -0.0016);
    });

    this.planets.forEach((planet) => {
      const speedScale = this.reduceMotion ? 0.22 : 1;
      planet.pivot.rotation.y += ambientDelta * planet.speed * speedScale;
      planet.mesh.rotation.y += ambientDelta * (0.09 + planet.speed) * speedScale;
    });

    const earth = this.planets.get('earth');
    earth.clouds.rotation.y += ambientDelta * 0.018;
    earth.moonPivot.rotation.y += ambientDelta * 0.1;
    earth.cityLights.rotation.y += ambientDelta * 0.004;

    const earthPosition = earth.mesh.getWorldPosition(this.earthWorldPosition);
    this.impactDebris.position.copy(earthPosition);
    this.impactDebris.rotation.y += ambientDelta * 0.19;
    this.impactDebris.rotation.z = 0.26;
    this.effectOffset.set(
      0.58 + Math.sin(this.visualTime * 0.18) * 0.1,
      0.08,
      0.34
    );
    this.impactor.position.copy(earthPosition).add(this.effectOffset);
    const flashPulse = 1.75 + Math.sin(this.visualTime * 2.4) * 0.25;
    this.effectOffset.set(0.2, 0.1, 0.16);
    this.impactFlash.position.copy(earthPosition).add(this.effectOffset);
    this.impactFlash.scale.setScalar(flashPulse);
    this.impactFlash.material.opacity = 0.62 + Math.sin(this.visualTime * 3.1) * 0.16;

    this.effectOffset.set(
      0.36 + Math.sin(this.visualTime * 0.8) * 0.06,
      0.28,
      0.42 + Math.cos(this.visualTime * 0.6) * 0.08
    );
    this.chicxulubAsteroid.position.copy(earthPosition).add(this.effectOffset);
    this.asteroidTrail.position.copy(this.chicxulubAsteroid.position);
    this.asteroidLookTarget.copy(this.chicxulubAsteroid.position).add(this.effectOffset.set(0.9, 0.62, 1.15));
    this.asteroidTrail.lookAt(this.asteroidLookTarget);
    this.chicxulubAsteroid.rotation.x += ambientDelta * 0.38;
    this.chicxulubAsteroid.rotation.y += ambientDelta * 0.52;
    this.asteroidGlow.scale.setScalar(0.66 + Math.sin(this.visualTime * 4.2) * 0.08);

    if (!this.cameraTween) {
      const liveTarget = this.resolveBodyPosition(this.activeTargetId, this.cameraLiveTarget);
      this.cameraTarget.lerp(liveTarget, Math.min(1, delta * 2.2));
    }

    const driftScale = this.reduceMotion ? 0.012 : (this.currentShot.drift || 0.08);
    this.camera.position.copy(this.cameraBase);
    this.cameraForward.subVectors(this.cameraTarget, this.cameraBase).normalize();
    this.cameraRight.crossVectors(this.cameraForward, this.camera.up).normalize();
    this.cameraUp.crossVectors(this.cameraRight, this.cameraForward).normalize();
    this.camera.position.addScaledVector(
      this.cameraRight,
      Math.cos(this.visualTime * 0.11) * driftScale * 0.62
    );
    this.camera.position.addScaledVector(
      this.cameraUp,
      Math.sin(this.visualTime * 0.17) * driftScale
    );
    this.camera.lookAt(this.cameraTarget);
    this.camera.rotateZ(this.cameraRoll + Math.sin(this.visualTime * 0.09) * driftScale * 0.016);
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
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.7);
    this.starMaterials.forEach((material) => {
      material.uniforms.pixelRatio.value = pixelRatio;
    });
    if (this.formationDiskMaterial) this.formationDiskMaterial.uniforms.pixelRatio.value = pixelRatio;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  destroy() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.renderer?.dispose();
  }
}
