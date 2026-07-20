import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const viewport = document.getElementById('modelPreviewViewport');
const canvas = document.getElementById('modelPreviewCanvas');
const loadingOverlay = document.getElementById('modelPreviewLoading');
const loadingStatus = document.getElementById('modelPreviewStatus');
const loadingProgress = document.getElementById('modelPreviewProgress');
const errorOverlay = document.getElementById('modelPreviewError');
const errorMessage = document.getElementById('modelPreviewErrorMessage');
const resetButton = document.getElementById('modelPreviewReset');
const modeStatus = document.getElementById('modelPreviewModeStatus');
const modeButtons = [...document.querySelectorAll('[data-preview-mode]')];

if (viewport && canvas) {
  startPreview();
}

function startPreview() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
  } catch {
    showError('This browser or device could not start WebGL. Try an updated browser or download the GLB instead.');
    return;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, canvas);
  const modelContainer = new THREE.Group();
  const originalMaterials = new Map();
  const modelMeshes = [];
  const clock = new THREE.Clock();
  const defaultDirection = new THREE.Vector3(1.25, 0.72, 1.5).normalize();
  let modelRadius = 1;
  let mixer = null;
  let loadedRoot = null;
  let resizeObserver = null;

  const styles = getComputedStyle(document.documentElement);
  const solidMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(styles.getPropertyValue('--text-secondary').trim()),
    metalness: 0.03,
    roughness: 0.72,
  });
  const wireframeMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(styles.getPropertyValue('--accent').trim()),
    side: THREE.DoubleSide,
    wireframe: true,
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.enablePan = false;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.85;

  scene.add(modelContainer);
  addLighting(scene, renderer, styles);
  resizeRenderer();

  resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(viewport);

  renderer.setAnimationLoop(() => {
    const delta = Math.min(clock.getDelta(), 0.1);
    if (mixer) mixer.update(delta);
    controls.update();
    renderer.render(scene, camera);
  });

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => setPreviewMode(button.dataset.previewMode));
  });
  resetButton?.addEventListener('click', resetCamera);
  canvas.addEventListener('dblclick', resetCamera);
  canvas.addEventListener('keydown', handleCameraKey);
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    renderer.setAnimationLoop(null);
    showError('The 3D graphics context was lost. Reload the page to restart the preview.');
  });
  window.addEventListener('beforeunload', disposePreview, { once: true });

  loadModel();

  function addLighting(targetScene, targetRenderer, themeStyles) {
    const textColor = new THREE.Color(themeStyles.getPropertyValue('--text').trim());
    const backgroundColor = new THREE.Color(themeStyles.getPropertyValue('--bg').trim());
    const accentColor = new THREE.Color(themeStyles.getPropertyValue('--accent').trim());
    const hemisphere = new THREE.HemisphereLight(textColor, backgroundColor, 1.65);
    const key = new THREE.DirectionalLight(textColor, 2.8);
    const rim = new THREE.DirectionalLight(accentColor, 1.15);
    key.position.set(4, 7, 6);
    rim.position.set(-5, 2, -4);
    targetScene.add(hemisphere, key, rim);

    const room = new RoomEnvironment();
    const pmremGenerator = new THREE.PMREMGenerator(targetRenderer);
    targetScene.environment = pmremGenerator.fromScene(room, 0.04).texture;
    pmremGenerator.dispose();
    disposeObjectResources(room);
  }

  function resizeRenderer() {
    const width = Math.max(1, Math.floor(viewport.clientWidth));
    const height = Math.max(1, Math.floor(viewport.clientHeight));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function createLoader() {
    const threeVendorUrl = viewport.dataset.threeVendorUrl;
    if (!threeVendorUrl) {
      throw new Error('The Three.js vendor URL is missing.');
    }
    const manager = new THREE.LoadingManager();
    const loader = new GLTFLoader(manager);
    const dracoLoader = new DRACOLoader(manager);
    const ktx2Loader = new KTX2Loader(manager);
    dracoLoader.setDecoderPath(`${threeVendorUrl}/addons/libs/draco/`);
    ktx2Loader
      .setTranscoderPath(`${threeVendorUrl}/addons/libs/basis/`)
      .detectSupport(renderer);
    loader.setDRACOLoader(dracoLoader);
    loader.setKTX2Loader(ktx2Loader);
    loader.setMeshoptDecoder(MeshoptDecoder);
    return { loader, dracoLoader, ktx2Loader };
  }

  function loadModel() {
    const modelUrl = viewport.dataset.modelUrl;
    if (!modelUrl) {
      showError('No model file was provided for this preview.');
      return;
    }

    let loaderResources;
    try {
      loaderResources = createLoader();
    } catch {
      showError('The 3D viewer could not initialize its model loaders. Refresh the page and try again.');
      return;
    }
    loaderResources.loader.load(
      modelUrl,
      (gltf) => {
        loaderResources.dracoLoader.dispose();
        loaderResources.ktx2Loader.dispose();
        try {
          prepareModel(gltf);
        } catch {
          showError('The GLB loaded, but it does not contain displayable model geometry.');
        }
      },
      updateLoadingProgress,
      () => {
        loaderResources.dracoLoader.dispose();
        loaderResources.ktx2Loader.dispose();
        showError('The model could not be loaded. It may be missing, no longer shared, or use an unsupported GLB feature.');
      },
    );
  }

  function prepareModel(gltf) {
    loadedRoot = gltf.scene || gltf.scenes?.[0];
    if (!loadedRoot) throw new Error('The GLB has no scene.');

    loadedRoot.traverse((object) => {
      if (!object.isMesh) return;
      modelMeshes.push(object);
      originalMaterials.set(object, object.material);
    });
    if (!modelMeshes.length) throw new Error('The GLB has no mesh.');

    modelContainer.add(loadedRoot);
    loadedRoot.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(loadedRoot);
    if (bounds.isEmpty()) throw new Error('The model bounds are empty.');
    const center = bounds.getCenter(new THREE.Vector3());
    modelContainer.position.copy(center).multiplyScalar(-1);
    modelContainer.updateMatrixWorld(true);

    const centeredBounds = new THREE.Box3().setFromObject(modelContainer);
    const sphere = centeredBounds.getBoundingSphere(new THREE.Sphere());
    modelRadius = Number.isFinite(sphere.radius) && sphere.radius > 0 ? sphere.radius : 1;

    if (gltf.animations?.length) {
      mixer = new THREE.AnimationMixer(loadedRoot);
      gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
    }

    resetCamera();
    setPreviewMode('texture');
    modeButtons.forEach((button) => { button.disabled = false; });
    if (resetButton) resetButton.disabled = false;
    canvas.setAttribute('aria-busy', 'false');
    if (loadingOverlay) loadingOverlay.hidden = true;
    canvas.focus({ preventScroll: true });
  }

  function updateLoadingProgress(event) {
    if (!loadingStatus || !loadingProgress) return;
    if (event.total > 0) {
      const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
      loadingStatus.textContent = `Loading model… ${percent}%`;
      loadingProgress.value = percent;
    } else {
      loadingStatus.textContent = 'Loading model…';
      loadingProgress.removeAttribute('value');
    }
  }

  function setPreviewMode(mode) {
    if (!['texture', 'solid', 'wireframe'].includes(mode)) return;
    modelMeshes.forEach((mesh) => {
      const original = originalMaterials.get(mesh);
      if (mode === 'texture') {
        mesh.material = original;
      } else {
        const replacement = mode === 'solid' ? solidMaterial : wireframeMaterial;
        mesh.material = Array.isArray(original) ? original.map(() => replacement) : replacement;
      }
    });
    modeButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.previewMode === mode));
    });
    if (modeStatus) {
      const label = mode === 'wireframe' ? 'Wireframe' : `${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
      modeStatus.textContent = `${label} preview mode selected.`;
    }
  }

  function resetCamera() {
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
    const limitingHalfFov = Math.max(0.08, Math.min(verticalFov, horizontalFov) / 2);
    const distance = (modelRadius / Math.sin(limitingHalfFov)) * 1.15;
    camera.position.copy(defaultDirection).multiplyScalar(distance);
    camera.near = Math.max(modelRadius / 1000, 0.0001);
    camera.far = Math.max(modelRadius * 100, distance * 10);
    camera.updateProjectionMatrix();
    controls.target.set(0, 0, 0);
    controls.minDistance = Math.max(modelRadius * 0.08, 0.0001);
    controls.maxDistance = Math.max(modelRadius * 30, distance * 2);
    controls.update();
    controls.saveState();
  }

  function handleCameraKey(event) {
    const rotationStep = THREE.MathUtils.degToRad(event.shiftKey ? 15 : 6);
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    let handled = true;

    if (event.key === 'ArrowLeft') spherical.theta -= rotationStep;
    else if (event.key === 'ArrowRight') spherical.theta += rotationStep;
    else if (event.key === 'ArrowUp') spherical.phi -= rotationStep;
    else if (event.key === 'ArrowDown') spherical.phi += rotationStep;
    else if (event.key === '+' || event.key === '=') spherical.radius *= 0.86;
    else if (event.key === '-' || event.key === '_') spherical.radius *= 1.16;
    else if (event.key === '0') resetCamera();
    else handled = false;

    if (!handled) return;
    event.preventDefault();
    if (event.key === '0') return;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi, 0.05, Math.PI - 0.05);
    spherical.radius = THREE.MathUtils.clamp(
      spherical.radius,
      controls.minDistance,
      controls.maxDistance,
    );
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
    camera.lookAt(controls.target);
    controls.update();
  }

  function disposePreview() {
    renderer.setAnimationLoop(null);
    resizeObserver?.disconnect();
    controls.dispose();
    if (mixer && loadedRoot) {
      mixer.stopAllAction();
      mixer.uncacheRoot(loadedRoot);
    }
    if (loadedRoot) disposeObjectResources(loadedRoot);
    solidMaterial.dispose();
    wireframeMaterial.dispose();
    scene.environment?.dispose();
    renderer.dispose();
  }
}

function disposeObjectResources(root) {
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    object.geometry?.dispose();
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    objectMaterials.filter(Boolean).forEach((material) => materials.add(material));
  });
  materials.forEach((material) => {
    Object.values(material).forEach((value) => {
      if (value?.isTexture) textures.add(value);
    });
    material.dispose();
  });
  textures.forEach((texture) => texture.dispose());
}

function showError(message) {
  if (loadingOverlay) loadingOverlay.hidden = true;
  if (errorMessage) errorMessage.textContent = message;
  if (errorOverlay) errorOverlay.hidden = false;
  canvas?.setAttribute('aria-busy', 'false');
}
