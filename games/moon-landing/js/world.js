import * as THREE from '../vendor/three.module.min.js';
import { GLTFLoader } from '../vendor/GLTFLoader.js';
import { DRACOLoader } from '../vendor/DRACOLoader.js';
import { toCreasedNormals } from '../vendor/BufferGeometryUtils.js';

const terrain = globalThis.MoonTerrain;
const physics = globalThis.MoonPhysics;
const clamp = THREE.MathUtils.clamp;
const noiseGLSL = `
float moonHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float moonNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(moonHash(i),moonHash(i+vec2(1.,0.)),f.x),mix(moonHash(i+vec2(0.,1.)),moonHash(i+vec2(1.,1.)),f.x),f.y);
}
float moonFbm(vec2 p) { return .53*moonNoise(p)+.27*moonNoise(p*2.07)+.13*moonNoise(p*4.13)+.07*moonNoise(p*8.37); }
float moonPits(vec2 p) {
  vec2 cell=floor(p), delta=fract(p)-.5;
  float radius=.11+.2*moonHash(cell+vec2(1.7));
  return (1.-smoothstep(.0,radius,length(delta)))*step(.78,moonHash(cell));
}
`;

function regolithMaterial() {
  const material = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.19, 0.187, 0.18), roughness: 0.97 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = `varying vec3 vMoonPosition;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvMoonPosition = position;');
    shader.fragmentShader = `varying vec3 vMoonPosition;\n${noiseGLSL}\n${shader.fragmentShader}`;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      float macroShade = moonFbm(vMoonPosition.xz * .036);
      float closeDetail = 1. - smoothstep(70., 380., length(vViewPosition));
      float grit = mix(.5, moonNoise(vMoonPosition.xz * 32.), 1.-smoothstep(.008,.055,length(fwidth(vMoonPosition.xz))));
      float mottling = moonFbm(vMoonPosition.xz * 1.7);
      diffuseColor.rgb *= (.68 + .58 * macroShade) * (1. + closeDetail * ((mottling-.5)*.34 + (grit-.5)*.16 - moonPits(vMoonPosition.xz*3.)*.14));
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      float relief = (moonFbm(vMoonPosition.xz * 4.1) * .014 + moonNoise(vMoonPosition.xz * 19.) * .002 - moonPits(vMoonPosition.xz*3.)*.012) * (1. - smoothstep(20., 85., length(vViewPosition)));
      vec3 surfaceDx = dFdx(-vViewPosition), surfaceDy = dFdy(-vViewPosition);
      vec3 bumpX = cross(surfaceDy, normal), bumpY = cross(normal, surfaceDx);
      float det = dot(surfaceDx, bumpX);
      normal = normalize(abs(det) * normal - sign(det) * (dFdx(relief)*bumpX + dFdy(relief)*bumpY));
    `);
  };
  return material;
}

function terrainPatch(size, segments, hole, material) {
  const positions = [], indices = [];
  for (let z = 0; z <= segments; z += 1) {
    for (let x = 0; x <= segments; x += 1) {
      const px = (x / segments - 0.5) * size;
      const pz = (z / segments - 0.5) * size;
      positions.push(px, terrain.height(px, pz), pz);
    }
  }
  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const px = ((x + .5) / segments - .5) * size;
      const pz = ((z + .5) / segments - .5) * size;
      if (hole && Math.abs(px) < hole && Math.abs(pz) < hole) continue;
      const a = z * (segments + 1) + x, b = a + segments + 1;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

function createRocks(scene, compact) {
  const rng = terrain.random(11409);
  const geometry = new THREE.IcosahedronGeometry(1, 1);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const rough = .8 + terrain.noise(x * 8.1 + y * 4, z * 8.1) * .33;
    positions.setXYZ(i, x * rough, y * rough * .7, z * rough);
  }
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x797770, roughness: .95, flatShading: true });
  const count = compact ? 2600 : 5200;
  const rocks = new THREE.InstancedMesh(geometry, material, count);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  for (let i = 0; i < count; i += 1) {
    const a = rng() * Math.PI * 2;
    const radius = Math.sqrt(rng()) * (i < count * .65 ? 105 : 500);
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    let size = .025 + rng() ** 7 * (radius < 45 ? .42 : .95);
    if (radius < 6) size = Math.min(size, .022);
    dummy.position.set(x, terrain.height(x, z) + size * .2, z);
    dummy.rotation.set(rng() * .6, rng() * 6.28, rng() * .6);
    dummy.scale.set(size * (.8 + rng() * .6), size, size * (.75 + rng() * .55));
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    color.setScalar(.5 + rng() * .38);
    rocks.setColorAt(i, color);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  scene.add(rocks);
}

function foilBump() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const rng = terrain.random(1969);
  ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4100; i += 1) {
    const x = rng() * 512, y = rng() * 512, d = 4 + rng() * 28;
    const shade = Math.floor(90 + rng() * 77);
    ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + d, y + rng() * d);
    ctx.lineTo(x + rng() * d, y + d); ctx.closePath(); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

function lunarEnvironment(renderer) {
  // Reflection radiance: black sky above, sunlit regolith below. No blue
  // atmosphere, studio softboxes, or invented fill lights on the foil.
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#030303'; ctx.fillRect(0, 0, 512, 256);
  const ground = ctx.createLinearGradient(0, 128, 0, 256);
  ground.addColorStop(0, '#625e56'); ground.addColorStop(1, '#77736a');
  ctx.fillStyle = ground; ctx.fillRect(0, 128, 512, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  const generator = new THREE.PMREMGenerator(renderer);
  const map = generator.fromEquirectangular(texture).texture;
  generator.dispose(); texture.dispose();
  return map;
}

async function createLander(scene, environment) {
  const decoder = new DRACOLoader();
  decoder.setDecoderPath(new URL('../vendor/draco/', import.meta.url).href);
  decoder.setWorkerLimit(1);
  const loader = new GLTFLoader(); loader.setDRACOLoader(decoder);
  let gltf;
  try { gltf = await loader.loadAsync(new URL('../assets/apollo-lunar-module.glb', import.meta.url).href); }
  finally { decoder.dispose(); }
  const lander = new THREE.Group();
  const model = gltf.scene;
  const scale = 7.04 / (5.1154232 - .102631);
  model.scale.setScalar(scale);
  model.position.y = -.102631 * scale;
  const bump = foilBump();
  const modified = new Set();
  model.traverse(object => {
    if (!object.isMesh) return;
    object.geometry = toCreasedNormals(object.geometry, Math.PI / 6);
    object.castShadow = object.receiveShadow = true;
    const material = object.material;
    if (modified.has(material)) return;
    modified.add(material);
    material.envMap = environment;
    material.envMapIntensity = .9;
    if (['blinn1SG.002', 'blinn9SG.001'].includes(material.name)) {
      material.color.set(material.name === 'blinn1SG.002' ? '#d5a047' : '#b97927');
      material.metalness = .93; material.roughness = .34;
      material.bumpMap = bump; material.bumpScale = .045;
      material.flatShading = false;
      material.onBeforeCompile = shader => {
        shader.vertexShader = `varying vec3 vFoilPosition;\n${shader.vertexShader}`;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoilPosition=position;');
        shader.fragmentShader = `varying vec3 vFoilPosition;\n${noiseGLSL}\n${shader.fragmentShader}`;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
          #include <color_fragment>
          vec2 foilUv = vFoilPosition.xy*vec2(1.,1.3)+vFoilPosition.zy*.79;
          float wrinkles=moonFbm(foilUv*22.);
          diffuseColor.rgb *= .64 + wrinkles*.82;
          // Dark aluminized blanket panels on the upper descent-stage sides.
          float upperBlanket = step(1.88,vFoilPosition.y)*step(vFoilPosition.y,2.44)*step(max(abs(vFoilPosition.x),abs(vFoilPosition.z)),1.55);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(.016,.017,.018), upperBlanket*.96);
        `);
        shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
          #include <normal_fragment_maps>
          vec2 foldUv=vFoilPosition.xy*vec2(1.,1.3)+vFoilPosition.zy*.79;
          float foilHeight = abs(moonNoise(foldUv*13.)-.5)*.030 + moonFbm(foldUv*47.)*.006;
          vec3 sx=dFdx(-vViewPosition), sy=dFdy(-vViewPosition);
          vec3 rx=cross(sy,normal), ry=cross(normal,sx);float determinant=dot(sx,rx);
          normal=normalize(abs(determinant)*normal-sign(determinant)*(dFdx(foilHeight)*rx+dFdy(foilHeight)*ry));
        `);
      };
    } else if (material.name === 'blinn6SG.001') {
      material.color.set('#17191b'); material.metalness = .15; material.roughness = .7;
      material.bumpMap = bump; material.bumpScale = .009;
    } else if (!material.map) {
      material.metalness = .58; material.roughness = .48;
      material.bumpMap = bump; material.bumpScale = .003;
      material.flatShading = false;
    } else {
      material.roughness = .65; material.metalness = .2;
    }
    material.needsUpdate = true;
  });
  lander.add(model);

  // Three contact probes. The ladder-side foot has no probe. Fold them aside
  // as they meet the regolith, rather than allowing rods through the surface.
  const probes = [];
  const probeMaterial = new THREE.MeshStandardMaterial({ color: 0xa69b73, metalness: .65, roughness: .5 });
  for (const [x, z] of [[3.9, 0], [-3.9, 0], [0, -3.9]]) {
    const pivot = new THREE.Group(); pivot.position.set(x, .14, z);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, 1.65, 5), probeMaterial);
    rod.position.y = -.825; rod.castShadow = true; pivot.add(rod);
    pivot.userData.axis = x === 0 ? 'x' : 'z';
    pivot.userData.direction = x < 0 || z < 0 ? -1 : 1;
    probes.push(pivot); lander.add(pivot);
  }
  const plumeMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { burn: { value: 0 }, time: { value: 0 }, floorY: { value: 0 } },
    vertexShader: `varying vec2 plumeUv; varying float plumeHeight; varying vec3 plumeNormal; varying vec3 plumeView;
      void main() { plumeUv=uv; vec4 world=modelMatrix*vec4(position,1.); vec4 mv=viewMatrix*world; plumeView=-mv.xyz; plumeNormal=normalMatrix*normal; plumeHeight=world.y; gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec2 plumeUv; varying float plumeHeight; varying vec3 plumeNormal; varying vec3 plumeView;
      uniform float burn; uniform float time; uniform float floorY;
      void main(){ if(plumeHeight<floorY) discard; float axial=pow(plumeUv.y,3.1); float pulse=.92+.08*sin(plumeUv.y*54.-time*27.);
      float edge=pow(abs(dot(normalize(plumeNormal),normalize(plumeView))),.7); float opacity=axial*edge*burn*.105*pulse;
      gl_FragColor=vec4(mix(vec3(.52,.44,.32),vec3(.56,.57,.64),plumeUv.y),opacity); }`
  });
  const plume = new THREE.Mesh(new THREE.CylinderGeometry(.22, 2.4, 5.6, 36, 12, true), plumeMaterial);
  plume.position.y = .43 - 2.8;
  lander.add(plume);
  const innerMaterial = plumeMaterial.clone();
  innerMaterial.uniforms = plumeMaterial.uniforms;
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(.15, .5, 1.3, 20, 8, true), innerMaterial);
  inner.position.y = .43 - .65; lander.add(inner);
  scene.add(lander);
  return { lander, model, probes, plumeMaterial };
}

function createDust(scene, flight, compact) {
  const rng = terrain.random(1202);
  const origins = [], velocities = [], births = [], lifetimes = [], sizes = [], densities = [];
  const interval = compact ? .0026 : .0013;
  const start = flight.timeAtAltitude(48);
  const particleLimit = compact ? 12000 : 24000;
  for (let born = start; born <= flight.contactTime + 8 && births.length < particleLimit; born += interval) {
    const s = flight.sample(born);
    const outgas = !s.engine;
    const strength = outgas ? .6 * Math.exp(-(born - s.cutoffTime) / 2.6) : physics.dustStrength(s.altitude, s.throttle);
    if (rng() > strength) continue;
    const angle = rng() * Math.PI * 2;
    const radius = .65 + rng() * (outgas ? 4.5 : Math.min(9, 1.2 + s.altitude * .13));
    const x = s.x + Math.cos(angle) * radius, z = s.z + Math.sin(angle) * radius;
    const y = terrain.height(x, z) + .035;
    const fine = rng() < .83;
    const speed = outgas ? .8 + rng() * 4 : (fine ? 14 + rng() * 55 : 3 + rng() * 8) * (.6 + strength * .4);
    const vy = outgas ? .4 + rng() * 3.0 : (fine ? .2 + rng() * 1.15 : .3 + rng() * 1.8);
    const vx = Math.cos(angle) * speed, vz = Math.sin(angle) * speed;
    // Evaluate the actual height field to stop grains at their first surface
    // intersection; a hard eight-second life also bounds the GPU workload.
    let lifetime = 8;
    for (let t = .05; t < 8; t += .05) {
      const p = physics.ballisticParticle({ x, y, z }, { x: vx, y: vy, z: vz }, t);
      if (p.y <= terrain.height(p.x, p.z)) { lifetime = t; break; }
    }
    origins.push(x, y, z); velocities.push(vx, vy, vz);
    births.push(born); lifetimes.push(lifetime);
    // Each soft streak represents many unresolved grains. Its optical weight
    // is amplified so a bounded particle budget still reads as an ejecta sheet.
    sizes.push(fine ? 2.0 + rng() * (outgas ? 2.5 : 5.5) : .06 + rng() * .18);
    densities.push(fine ? .08 + rng() * .065 : .18 + rng() * .17);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(origins, 3));
  geometry.setAttribute('velocity', new THREE.Float32BufferAttribute(velocities, 3));
  geometry.setAttribute('birth', new THREE.Float32BufferAttribute(births, 1));
  geometry.setAttribute('lifetime', new THREE.Float32BufferAttribute(lifetimes, 1));
  geometry.setAttribute('grainSize', new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute('density', new THREE.Float32BufferAttribute(densities, 1));
  const material = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { time: { value: 0 }, resolution: { value: 800 } },
    vertexShader: `attribute vec3 velocity; attribute float birth; attribute float lifetime; attribute float grainSize; attribute float density;
      uniform float time; uniform float resolution; varying float alpha; varying float angle;
      void main(){ float age=time-birth; bool alive=age>=0.&&age<lifetime; vec3 p=position+velocity*age-vec3(0.,.8125*age*age,0.);
      vec4 mv=viewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
      vec4 next=projectionMatrix*viewMatrix*vec4(p+velocity*.05,1.); vec2 direction=next.xy/next.w-gl_Position.xy/gl_Position.w;
      angle=atan(direction.y,direction.x); gl_PointSize=alive?clamp(grainSize*resolution/max(1.,-mv.z),1.,160.):0.;
      alpha=alive?density*min(1.,age*14.)*min(1.,(lifetime-age)*12.):0.; if(!alive) gl_Position=vec4(2.,2.,2.,1.); }`,
    fragmentShader: `varying float alpha; varying float angle; void main(){ vec2 q=gl_PointCoord-vec2(.5); float c=cos(angle),s=sin(angle);q=mat2(c,-s,s,c)*q;
      float shape=exp(-q.x*q.x*12.-q.y*q.y*75.)*(1.-smoothstep(.3,.5,length(q)));
      if(shape*alpha<.002) discard; gl_FragColor=vec4(.63,.60,.54,shape*alpha); }`
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 2;
  scene.add(points);
  return { material, count: births.length };
}

export async function createWorld(canvas, flight) {
  const compact = window.innerWidth < 760;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.35 : 1.6));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.02;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000);
  const environment = lunarEnvironment(renderer);
  const camera = new THREE.PerspectiveCamera(43, window.innerWidth / window.innerHeight, .08, 230000);
  const sunDirection = new THREE.Vector3(-.65, .265, .71).normalize();
  const sun = new THREE.DirectionalLight(0xfffcf5, 3.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(compact ? 1536 : 2048, compact ? 1536 : 2048);
  sun.shadow.bias = -.000035;
  sun.shadow.normalBias = .018;
  sun.shadow.camera.near = .5; sun.shadow.camera.far = 1800;
  scene.add(sun, sun.target);
  // Small regolith bounce, as seen on the shadowed side in surface photographs.
  scene.add(new THREE.HemisphereLight(0x080809, 0x84827c, .19));
  const groundMaterial = regolithMaterial();
  for (const [size, segments, hole] of [[400, compact ? 192 : 256, 0], [3200, 192, 200], [25600, 256, 1600], [204800, 256, 12800]]) {
    scene.add(terrainPatch(size, segments, hole, groundMaterial));
  }
  createRocks(scene, compact);
  const craft = await createLander(scene, environment);
  const dust = createDust(scene, flight, compact);
  const target = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const right = new THREE.Vector3();
  let view = 'tracking';
  let azimuth = .69, elevation = .25, zoom = 1;
  let dragging = false, lastPointer = null, pinchDistance = 0;
  let dirty = true;
  let lastShadowTime = -1;
  const pointers = new Map();

  function setView(name) {
    if (!['tracking', 'wide', 'surface', 'onboard'].includes(name)) return;
    view = name;
    dirty = true;
    azimuth = .69; elevation = .25; zoom = 1;
    canvas.style.cursor = name === 'tracking' || name === 'wide' ? 'grab' : 'default';
  }
  canvas.addEventListener('pointerdown', event => {
    if (view !== 'tracking' && view !== 'wide') return;
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragging = true; lastPointer = { x: event.clientX, y: event.clientY }; canvas.style.cursor = 'grabbing';
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchDistance = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  canvas.addEventListener('pointermove', event => {
    if (!dragging || !pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()]; const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance > 0 && pinchDistance > 0) zoom = clamp(zoom * pinchDistance / distance, .5, 4);
      pinchDistance = distance;
    } else if (lastPointer) {
      azimuth -= (event.clientX - lastPointer.x) * .006;
      elevation = clamp(elevation + (event.clientY - lastPointer.y) * .004, -.12, 1.35);
    }
    lastPointer = { x: event.clientX, y: event.clientY };
    dirty = true;
  });
  function release(event) {
    pointers.delete(event.pointerId); dragging = pointers.size > 0; lastPointer = null;
    canvas.style.cursor = view === 'tracking' || view === 'wide' ? 'grab' : 'default';
  }
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  window.addEventListener('blur', () => { pointers.clear(); dragging = false; lastPointer = null; });
  canvas.addEventListener('wheel', event => {
    if (view !== 'tracking' && view !== 'wide') return;
    event.preventDefault(); zoom = clamp(zoom * Math.exp(clamp(event.deltaY, -200, 200) * .001), .5, 4);
    dirty = true;
  }, { passive: false });
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    dirty = true;
  }
  window.addEventListener('resize', resize);
  function render(state, preview = false) {
    dirty = false;
    renderer.shadowMap.needsUpdate = state.time !== lastShadowTime;
    lastShadowTime = state.time;
    craft.lander.position.set(state.x, state.altitude - state.compression, state.z);
    // XYZ Euler order maps local +Y to the same thrust vector as physics.js.
    craft.lander.rotation.set(-state.roll, 0, -state.pitch);
    for (const probe of craft.probes) {
      probe.rotation[probe.userData.axis] = Math.acos(clamp((state.altitude + .11) / 1.65, 0, 1)) * probe.userData.direction;
    }
    craft.plumeMaterial.uniforms.burn.value = state.engine ? state.throttle / .32 : 0;
    craft.plumeMaterial.uniforms.time.value = state.time;
    craft.plumeMaterial.uniforms.floorY.value = terrain.height(state.x, state.z);
    craft.model.visible = view !== 'onboard';
    dust.material.uniforms.time.value = state.time;
    dust.material.uniforms.resolution.value = renderer.domElement.height * .8;

    target.set(state.x, state.altitude + 3.2, state.z);
    const portrait = camera.aspect < .85;
    camera.fov = view === 'onboard' ? 64 : portrait ? 54 : 43;
    if (view === 'surface') {
      desiredPosition.set(12, terrain.height(12, 18) + 1.7, 18);
      target.y = state.altitude + 2.6;
      camera.fov = portrait ? 52 : 39;
    } else if (view === 'onboard') {
      desiredPosition.set(.65, 5.25, 2.3).applyQuaternion(craft.lander.quaternion).add(craft.lander.position);
      target.set(1, -12, 15).applyQuaternion(craft.lander.quaternion).add(craft.lander.position);
    } else {
      const distance = (view === 'wide' ? 65 + state.altitude * .042 : portrait ? 29 : 26) * zoom;
      const pitch = view === 'wide' ? Math.max(elevation, .40) : elevation;
      desiredPosition.set(target.x + Math.sin(azimuth) * distance * Math.cos(pitch), target.y + Math.sin(pitch) * distance, target.z + Math.cos(azimuth) * distance * Math.cos(pitch));
      desiredPosition.y = Math.max(desiredPosition.y, terrain.height(desiredPosition.x, desiredPosition.z) + .65);
      right.set(Math.cos(azimuth), 0, -Math.sin(azimuth));
      // Compose the ship between the introductory text and instruments.
      if (preview) { target.addScaledVector(right, portrait ? -1.6 : -3.6); if (portrait) target.y += .1; }
    }
    camera.position.copy(desiredPosition); camera.lookAt(target); camera.updateProjectionMatrix();
    const extent = Math.max(24, state.altitude * 1.9);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -extent;
    sun.shadow.camera.right = sun.shadow.camera.top = extent;
    sun.shadow.camera.far = Math.max(1800, state.altitude * 8 + 600);
    sun.shadow.camera.updateProjectionMatrix();
    sun.target.position.set(state.x, state.altitude * .35, state.z);
    sun.position.copy(sun.target.position).addScaledVector(sunDirection, Math.max(700, state.altitude * 5));
    renderer.render(scene, camera);
  }
  return { render, setView, renderer, isDirty: () => dirty, dustCount: dust.count };
}
