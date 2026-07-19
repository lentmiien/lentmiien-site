(() => {
  'use strict';

  const BRICK_HEIGHT = 1.2;
  const STUD_HEIGHT = 0.18;
  const STUD_RADIUS = 0.29;
  const GAP = 0.055;
  const MAX_TRIANGLES_FOR_WIREFRAME = 12000;
  const MAX_BIN_REFERENCES = 16000000;
  const MAX_INPUT_TRIANGLES = 1200000;
  const MAX_EXACT_TRIANGLES = 600000;
  const MAX_SURFACE_SAMPLES = 18000000;
  const MAX_VOXEL_CELLS = 2000000;

  const PALETTE = [
    [0.92, 0.08, 0.10, 1], [0.08, 0.34, 0.82, 1], [0.98, 0.78, 0.03, 1],
    [0.05, 0.58, 0.28, 1], [1.00, 0.43, 0.05, 1], [0.52, 0.17, 0.68, 1],
    [0.04, 0.66, 0.73, 1], [0.95, 0.95, 0.91, 1], [0.12, 0.14, 0.18, 1],
    [0.94, 0.36, 0.60, 1], [0.52, 0.34, 0.18, 1], [0.54, 0.76, 0.12, 1]
  ];

  const PART_DEFS = Object.freeze([
    { key: '2x6', w: 6, d: 2, defaultSupply: 'few',    defaultMax: null },
    { key: '2x4', w: 4, d: 2, defaultSupply: 'plenty', defaultMax: null },
    { key: '2x3', w: 3, d: 2, defaultSupply: 'normal', defaultMax: null },
    { key: '2x2', w: 2, d: 2, defaultSupply: 'plenty', defaultMax: null },
    { key: '1x6', w: 6, d: 1, defaultSupply: 'few',    defaultMax: null },
    { key: '1x4', w: 4, d: 1, defaultSupply: 'normal', defaultMax: null },
    { key: '1x3', w: 3, d: 1, defaultSupply: 'normal', defaultMax: 4 },
    { key: '1x2', w: 2, d: 1, defaultSupply: 'plenty', defaultMax: null },
    { key: '1x1', w: 1, d: 1, defaultSupply: 'plenty', defaultMax: null }
  ]);
  const PART_DEF_BY_KEY = new Map(PART_DEFS.map(part => [part.key, part]));
  const SUPPLY_BONUS = Object.freeze({ plenty: 55, normal: 0, few: -210, avoid: -700, none: -100000 });
  const INVENTORY_STORAGE_KEY = 'brickify3d.inventory.v2';

  function getLayerPlanRect(grid, brick) {
    return {
      x: grid.nx - brick.x - brick.w,
      y: grid.nz - brick.z - brick.d,
      width: brick.w,
      height: brick.d
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { getLayerPlanRect, MAX_VOXEL_CELLS };
  }
  if (typeof document === 'undefined') return;

  const el = id => document.getElementById(id);
  const fileInput = el('fileInput');
  const dropZone = el('dropZone');
  const fileName = el('fileName');
  const demoBtn = el('demoBtn');
  const clearBtn = el('clearBtn');
  const resolution = el('resolution');
  const resolutionValue = el('resolutionValue');
  const resolutionHint = el('resolutionHint');
  const upAxis = el('upAxis');
  const volumeMode = el('volumeMode');
  const gapSeal = el('gapSeal');
  const flattenBase = el('flattenBase');
  const mainBodyOnly = el('mainBodyOnly');
  const inventoryRows = el('inventoryRows');
  const resetInventoryBtn = el('resetInventoryBtn');
  const supportStrength = el('supportStrength');
  const stagger = el('stagger');
  const showWire = el('showWire');
  const colorMode = el('colorMode');
  const generateBtn = el('generateBtn');
  const progressWrap = el('progressWrap');
  const progressBar = el('progressBar');
  const status = el('status');
  const exportBtn = el('exportBtn');
  const emptyState = el('emptyState');
  const layerSlider = el('layerSlider');
  const prevLayer = el('prevLayer');
  const nextLayer = el('nextLayer');
  const layerReadout = el('layerReadout');
  const resetViewBtn = el('resetViewBtn');
  const planCanvas = el('planCanvas');
  const planEmpty = el('planEmpty');
  const toast = el('toast');

  const appState = {
    source: null,
    sourceName: '',
    sourceFormat: '',
    parsedModel: null,
    modelColorInfo: null,
    normalizedTriangles: null,
    grid: null,
    layers: [],
    allBricks: [],
    inventoryUsage: {},
    inventoryConfig: {},
    repairConfig: null,
    supportMode: 'robust',
    colorMode: 'model',
    validation: null,
    selectedLayer: 0,
    displayMode: 'all',
    busy: false,
    modelRevision: 0
  };
  let linkedModelAbortController = null;

  const fmt = new Intl.NumberFormat();

  function partLabel(key) {
    return key.replace('x', '×');
  }

  function canonicalBrickKey(w, d) {
    return `${Math.min(w, d)}x${Math.max(w, d)}`;
  }

  function inventoryDefaultsObject() {
    const out = {};
    for (const part of PART_DEFS) out[part.key] = { supply: part.defaultSupply, max: part.defaultMax };
    return out;
  }

  function loadSavedInventory() {
    try {
      const raw = localStorage.getItem(INVENTORY_STORAGE_KEY);
      if (!raw) return inventoryDefaultsObject();
      const parsed = JSON.parse(raw);
      return { ...inventoryDefaultsObject(), ...parsed };
    } catch (_) {
      return inventoryDefaultsObject();
    }
  }

  function renderInventoryRows(settings = loadSavedInventory()) {
    inventoryRows.innerHTML = PART_DEFS.map(part => {
      const stored = settings[part.key] || {};
      const supply = ['plenty', 'normal', 'few', 'avoid', 'none'].includes(stored.supply) ? stored.supply : part.defaultSupply;
      const max = stored.max == null || stored.max === '' ? '' : String(Math.max(0, Math.floor(Number(stored.max) || 0)));
      const options = [
        ['plenty', 'Plenty'], ['normal', 'Normal'], ['few', 'Few'], ['avoid', 'Avoid'], ['none', 'None']
      ].map(([value, label]) => `<option value="${value}"${value === supply ? ' selected' : ''}>${label}</option>`).join('');
      return `<div class="inventory-row" data-part="${part.key}">
        <div class="inventory-part">${partLabel(part.key)}</div>
        <select class="inventory-supply" aria-label="Supply level for ${partLabel(part.key)} bricks">${options}</select>
        <input class="inventory-max" type="number" min="0" step="1" inputmode="numeric" value="${max}" placeholder="∞" aria-label="Maximum ${partLabel(part.key)} bricks" />
        <span class="inventory-used" aria-label="Used ${partLabel(part.key)} bricks">0</span>
      </div>`;
    }).join('');
    updateInventoryUsage(appState.inventoryUsage);
  }

  function readInventoryConfig() {
    const config = new Map();
    for (const row of inventoryRows.querySelectorAll('.inventory-row')) {
      const key = row.dataset.part;
      const def = PART_DEF_BY_KEY.get(key);
      const supply = row.querySelector('.inventory-supply').value;
      const rawMax = row.querySelector('.inventory-max').value.trim();
      const max = rawMax === '' ? Infinity : Math.max(0, Math.floor(Number(rawMax) || 0));
      config.set(key, {
        ...def,
        supply,
        max,
        enabled: supply !== 'none' && max > 0,
        preferenceBonus: SUPPLY_BONUS[supply] ?? 0
      });
    }
    return config;
  }

  function inventoryConfigForStorage() {
    const out = {};
    for (const row of inventoryRows.querySelectorAll('.inventory-row')) {
      const rawMax = row.querySelector('.inventory-max').value.trim();
      out[row.dataset.part] = {
        supply: row.querySelector('.inventory-supply').value,
        max: rawMax === '' ? null : Math.max(0, Math.floor(Number(rawMax) || 0))
      };
    }
    return out;
  }

  function saveInventorySettings() {
    try { localStorage.setItem(INVENTORY_STORAGE_KEY, JSON.stringify(inventoryConfigForStorage())); } catch (_) {}
  }

  function updateInventoryUsage(usage = {}) {
    for (const row of inventoryRows.querySelectorAll('.inventory-row')) {
      const key = row.dataset.part;
      const used = usage instanceof Map ? (usage.get(key) || 0) : (usage[key] || 0);
      const rawMax = row.querySelector('.inventory-max').value.trim();
      const max = rawMax === '' ? Infinity : Math.max(0, Math.floor(Number(rawMax) || 0));
      const node = row.querySelector('.inventory-used');
      node.textContent = Number.isFinite(max) ? `${fmt.format(used)}/${fmt.format(max)}` : fmt.format(used);
      node.classList.toggle('over', Number.isFinite(max) && used > max);
    }
  }

  function resetInventoryToDefaults() {
    renderInventoryRows(inventoryDefaultsObject());
    saveInventorySettings();
    if (appState.layers.length) setStatus('Inventory reset. Generate again to apply the new limits.');
  }

  function setStatus(message, type = '') {
    status.textContent = message;
    status.className = `status ${type}`.trim();
  }

  function setProgress(value, message) {
    progressWrap.classList.add('visible');
    progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
    if (message) setStatus(message);
  }

  function hideProgress() {
    progressWrap.classList.remove('visible');
    progressBar.style.width = '0%';
  }

  function cancelLinkedModelLoad() {
    if (!linkedModelAbortController) return;
    linkedModelAbortController.abort();
    linkedModelAbortController = null;
  }

  let toastTimer = 0;
  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function yieldFrame() {
    return new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
  }

  function updateResolutionUI() {
    resolutionValue.textContent = resolution.value;
    resolutionHint.textContent = `${resolution.value} studs`;
  }

  function readRepairConfig() {
    const mode = volumeMode.value;
    return {
      mode,
      sealRadius: mode === 'exact' ? 0 : Math.max(0, Math.min(2, Number(gapSeal.value) || 0)),
      flattenLayers: Math.max(0, Math.min(3, Number(flattenBase.value) || 0)),
      mainBodyOnly: mainBodyOnly.checked
    };
  }

  function updateRepairControls() {
    const exact = volumeMode.value === 'exact';
    gapSeal.disabled = exact;
    gapSeal.title = exact ? 'Exact mode uses scan-line parity and does not apply surface gap sealing.' : '';
  }

  function resetResults() {
    appState.grid = null;
    appState.layers = [];
    appState.allBricks = [];
    appState.inventoryUsage = {};
    appState.inventoryConfig = {};
    appState.repairConfig = null;
    appState.validation = null;
    appState.normalizedTriangles = null;
    appState.selectedLayer = 0;
    exportBtn.disabled = true;
    layerSlider.disabled = true;
    layerSlider.min = '1';
    layerSlider.max = '1';
    layerSlider.value = '1';
    layerReadout.textContent = 'Layer — / —';
    el('statGrid').textContent = '—';
    el('statLayers').textContent = '—';
    el('statVoxels').textContent = '—';
    el('statBricks').textContent = '—';
    el('statSupports').textContent = '—';
    el('statConnected').textContent = '—';
    el('instructionTitle').textContent = 'No sculpture yet';
    el('instructionSummary').textContent = 'Generate a sculpture to inspect one brick layer at a time.';
    el('layerBrickCount').textContent = '—';
    el('layerStudCount').textContent = '—';
    el('layerTypeCount').textContent = '—';
    el('layerSupportCount').textContent = '—';
    el('partsList').innerHTML = '<div class="hint">No parts to show.</div>';
    el('layerNote').textContent = 'Each layer uses standard-height bricks. Start at layer 1 and work upward.';
    updateInventoryUsage({});
    planEmpty.classList.remove('hidden');
    const ctx = planCanvas.getContext('2d');
    ctx.clearRect(0, 0, planCanvas.width, planCanvas.height);
    renderer.setSculpture([], null, null);
    emptyState.classList.remove('hidden');
  }

  function clearSource() {
    cancelLinkedModelLoad();
    appState.modelRevision++;
    appState.source = null;
    appState.sourceName = '';
    appState.sourceFormat = '';
    appState.parsedModel = null;
    appState.modelColorInfo = null;
    fileInput.value = '';
    fileName.textContent = 'No file selected';
    clearBtn.disabled = true;
    generateBtn.disabled = true;
    resetResults();
    setStatus('Choose a model or load the demo.');
  }

  function detectFormat(name) {
    const lower = name.toLowerCase();
    if (lower.endsWith('.obj')) return 'obj';
    if (lower.endsWith('.stl')) return 'stl';
    if (lower.endsWith('.glb')) return 'glb';
    return '';
  }

  async function selectFile(file) {
    const format = detectFormat(file.name);
    if (!format) {
      setStatus('Unsupported file. Choose an .OBJ, .STL, or .GLB model.', 'error');
      return;
    }
    cancelLinkedModelLoad();
    appState.modelRevision++;
    appState.source = file;
    appState.sourceName = file.name;
    appState.sourceFormat = format;
    appState.parsedModel = null;
    appState.modelColorInfo = null;
    fileName.textContent = `${file.name} · ${format.toUpperCase()}`;
    clearBtn.disabled = false;
    generateBtn.disabled = false;
    resetResults();
    setStatus('Model selected. Adjust the resolution, then generate.');
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) selectFile(fileInput.files[0]);
  });

  ['dragenter', 'dragover'].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.add('dragover');
  }));
  ['dragleave', 'drop'].forEach(type => dropZone.addEventListener(type, event => {
    event.preventDefault();
    dropZone.classList.remove('dragover');
  }));
  dropZone.addEventListener('drop', event => {
    const file = event.dataTransfer?.files?.[0];
    if (file) selectFile(file);
  });

  resolution.addEventListener('input', updateResolutionUI);
  volumeMode.addEventListener('change', updateRepairControls);
  updateRepairControls();
  clearBtn.addEventListener('click', clearSource);

  demoBtn.addEventListener('click', () => {
    cancelLinkedModelLoad();
    appState.modelRevision++;
    appState.source = { demo: true };
    appState.sourceName = 'Demo rocket';
    appState.sourceFormat = 'obj';
    appState.parsedModel = { triangles: makeDemoRocket(), colors: null, colorInfo: { source: 'none', label: 'random palette' } };
    appState.modelColorInfo = appState.parsedModel.colorInfo;
    fileInput.value = '';
    fileName.textContent = 'Demo rocket · generated mesh';
    clearBtn.disabled = false;
    generateBtn.disabled = false;
    resetResults();
    setStatus('Demo loaded. Press Generate brick sculpture.');
  });

  showWire.addEventListener('change', () => {
    renderer.showWireframe = showWire.checked;
    renderer.requestRender();
  });

  function parseOBJ(text) {
    const vertices = [];
    const triangles = [];
    const lines = text.split(/\r?\n/);
    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
      const line = lines[lineNo].trim();
      if (!line || line[0] === '#') continue;
      const parts = line.split(/\s+/);
      if (parts[0] === 'v' && parts.length >= 4) {
        const x = Number(parts[1]), y = Number(parts[2]), z = Number(parts[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) vertices.push([x, y, z]);
      } else if (parts[0] === 'f' && parts.length >= 4) {
        const face = [];
        for (let i = 1; i < parts.length; i++) {
          const raw = parts[i].split('/')[0];
          let index = Number.parseInt(raw, 10);
          if (!Number.isFinite(index) || index === 0) continue;
          if (index < 0) index = vertices.length + index;
          else index -= 1;
          if (index >= 0 && index < vertices.length) face.push(index);
        }
        for (let i = 1; i + 1 < face.length; i++) {
          const a = vertices[face[0]], b = vertices[face[i]], c = vertices[face[i + 1]];
          triangles.push(...a, ...b, ...c);
        }
      }
    }
    if (!triangles.length) throw new Error('No usable triangle faces were found in this OBJ file.');
    return new Float32Array(triangles);
  }

  function parseSTL(buffer) {
    if (buffer.byteLength < 15) throw new Error('The STL file is too small to contain a mesh.');
    let binary = false;
    if (buffer.byteLength >= 84) {
      const view = new DataView(buffer);
      const count = view.getUint32(80, true);
      const expected = 84 + count * 50;
      const prefix = new TextDecoder('utf-8', { fatal: false })
        .decode(new Uint8Array(buffer, 0, Math.min(512, buffer.byteLength)))
        .trimStart()
        .toLowerCase();
      const looksAscii = prefix.startsWith('solid') && prefix.includes('facet') && prefix.includes('vertex');
      binary = count > 0 && expected <= buffer.byteLength && (!looksAscii || expected === buffer.byteLength);
    }
    if (binary) return parseBinarySTL(buffer);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    return parseAsciiSTL(text);
  }

  function parseBinarySTL(buffer) {
    const view = new DataView(buffer);
    const count = view.getUint32(80, true);
    const triangles = new Float32Array(count * 9);
    let out = 0;
    let offset = 84;
    for (let i = 0; i < count; i++, offset += 50) {
      if (offset + 50 > buffer.byteLength) break;
      let p = offset + 12;
      for (let v = 0; v < 9; v++, p += 4) triangles[out++] = view.getFloat32(p, true);
    }
    if (!out) throw new Error('No triangles were found in this binary STL file.');
    return out === triangles.length ? triangles : triangles.slice(0, out);
  }

  function parseAsciiSTL(text) {
    const values = [];
    const re = /vertex\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)\s+([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      values.push(Number(match[1]), Number(match[2]), Number(match[3]));
    }
    const usable = Math.floor(values.length / 9) * 9;
    if (!usable) throw new Error('No triangles were found in this ASCII STL file.');
    return new Float32Array(values.slice(0, usable));
  }


  function glbComponentSize(componentType) {
    switch (componentType) {
      case 5120: case 5121: return 1;
      case 5122: case 5123: return 2;
      case 5125: case 5126: return 4;
      default: throw new Error(`Unsupported GLB accessor component type ${componentType}.`);
    }
  }

  function glbTypeComponents(type) {
    return ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 })[type] || 0;
  }

  function glbReadComponent(view, offset, componentType) {
    switch (componentType) {
      case 5120: return view.getInt8(offset);
      case 5121: return view.getUint8(offset);
      case 5122: return view.getInt16(offset, true);
      case 5123: return view.getUint16(offset, true);
      case 5125: return view.getUint32(offset, true);
      case 5126: return view.getFloat32(offset, true);
      default: return 0;
    }
  }

  function glbNormalizeComponent(value, componentType) {
    switch (componentType) {
      case 5120: return Math.max(value / 127, -1);
      case 5121: return value / 255;
      case 5122: return Math.max(value / 32767, -1);
      case 5123: return value / 65535;
      default: return value;
    }
  }

  function decodeDataUri(uri) {
    const comma = uri.indexOf(',');
    if (comma < 0) throw new Error('Malformed data URI in GLB.');
    const meta = uri.slice(5, comma);
    const payload = uri.slice(comma + 1);
    const mime = (meta.split(';')[0] || 'application/octet-stream').trim();
    if (/;base64(?:;|$)/i.test(meta)) {
      const binary = atob(payload.replace(/\s/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { bytes, mime };
    }
    const decoded = decodeURIComponent(payload);
    return { bytes: new TextEncoder().encode(decoded), mime };
  }

  function inferImageMime(bytes, declared = '') {
    if (declared) return declared;
    if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
    return 'application/octet-stream';
  }

  async function decodeImagePixels(bytes, mimeType) {
    const blob = new Blob([bytes], { type: inferImageMime(bytes, mimeType) });
    let source = null;
    let revoke = null;
    try {
      if (typeof createImageBitmap === 'function') {
        source = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
      } else {
        const url = URL.createObjectURL(blob);
        revoke = () => URL.revokeObjectURL(url);
        const image = new Image();
        image.decoding = 'async';
        image.src = url;
        await image.decode();
        source = image;
      }
      const canvas = document.createElement('canvas');
      canvas.width = source.width;
      canvas.height = source.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas image decoding is unavailable.');
      ctx.drawImage(source, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return { width: canvas.width, height: canvas.height, data: pixels };
    } finally {
      if (source && typeof source.close === 'function') source.close();
      if (revoke) revoke();
    }
  }

  function glbIdentityMatrix() {
    return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  }

  function glbMultiplyMatrices(a, b) {
    const out = new Float64Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[r] * b[c * 4] +
          a[4 + r] * b[c * 4 + 1] +
          a[8 + r] * b[c * 4 + 2] +
          a[12 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  function glbNodeMatrix(node) {
    if (Array.isArray(node.matrix) && node.matrix.length === 16) return new Float64Array(node.matrix);
    const t = node.translation || [0, 0, 0];
    const r = node.rotation || [0, 0, 0, 1];
    const s = node.scale || [1, 1, 1];
    const x = r[0], y = r[1], z = r[2], w = r[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    return new Float64Array([
      (1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0,
      (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0,
      (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0,
      t[0], t[1], t[2], 1
    ]);
  }

  function glbTransformPoint(matrix, x, y, z) {
    const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];
    const invW = Math.abs(w) > 1e-12 ? 1 / w : 1;
    return [
      (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) * invW,
      (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) * invW,
      (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) * invW
    ];
  }

  function glbWrapCoordinate(value, mode) {
    if (mode === 33071) return Math.max(0, Math.min(1, value));
    if (mode === 33648) {
      const whole = Math.floor(value);
      const fraction = value - whole;
      return Math.abs(whole) % 2 ? 1 - fraction : fraction;
    }
    return value - Math.floor(value);
  }

  function sampleGlbTexture(texture, u, v) {
    if (!texture?.pixels) return [1, 1, 1, 1];
    const sampler = texture.sampler || {};
    const uu = glbWrapCoordinate(u, sampler.wrapS ?? 10497);
    const vv = glbWrapCoordinate(v, sampler.wrapT ?? 10497);
    const width = texture.pixels.width;
    const height = texture.pixels.height;
    const data = texture.pixels.data;
    const fx = Math.max(0, Math.min(width - 1, uu * Math.max(0, width - 1)));
    const fy = Math.max(0, Math.min(height - 1, vv * Math.max(0, height - 1)));
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    const read = (x, y, channel) => data[(x + y * width) * 4 + channel] / 255;
    const out = [0, 0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const a = read(x0, y0, c) * (1 - tx) + read(x1, y0, c) * tx;
      const b = read(x0, y1, c) * (1 - tx) + read(x1, y1, c) * tx;
      out[c] = a * (1 - ty) + b * ty;
    }
    return out;
  }

  function transformGlbUv(u, v, transform) {
    if (!transform) return [u, v];
    const offset = transform.offset || [0, 0];
    const scale = transform.scale || [1, 1];
    const rotation = transform.rotation || 0;
    const x = u * scale[0], y = v * scale[1];
    const c = Math.cos(rotation), s = Math.sin(rotation);
    return [offset[0] + c * x - s * y, offset[1] + s * x + c * y];
  }

  async function parseGLB(buffer) {
    if (buffer.byteLength < 20) throw new Error('The GLB file is too small.');
    const header = new DataView(buffer);
    if (header.getUint32(0, true) !== 0x46546c67) throw new Error('This file does not have a valid GLB header.');
    const version = header.getUint32(4, true);
    if (version !== 2) throw new Error(`Only GLB / glTF 2.0 is supported (this file is version ${version}).`);
    const declaredLength = header.getUint32(8, true);
    if (declaredLength > buffer.byteLength) throw new Error('The GLB file is truncated.');

    let jsonChunk = null;
    const binaryChunks = [];
    let offset = 12;
    while (offset + 8 <= declaredLength) {
      const length = header.getUint32(offset, true);
      const type = header.getUint32(offset + 4, true);
      const start = offset + 8;
      const end = start + length;
      if (end > declaredLength) throw new Error('A GLB chunk extends beyond the end of the file.');
      if (type === 0x4e4f534a) jsonChunk = new Uint8Array(buffer, start, length);
      if (type === 0x004e4942) binaryChunks.push(new Uint8Array(buffer, start, length));
      offset = end;
    }
    if (!jsonChunk) throw new Error('The GLB file has no JSON scene chunk.');
    let gltf;
    try {
      const jsonText = new TextDecoder('utf-8').decode(jsonChunk).replace(/[\u0000\s]+$/g, '');
      gltf = JSON.parse(jsonText);
    } catch (_) {
      throw new Error('The GLB scene description is not valid JSON.');
    }
    if (gltf.asset?.version && !String(gltf.asset.version).startsWith('2')) throw new Error('Only glTF 2.0 scenes are supported.');

    const required = new Set(gltf.extensionsRequired || []);
    if (required.has('KHR_draco_mesh_compression')) {
      throw new Error('This GLB uses Draco-compressed geometry. Re-export it with geometry compression disabled.');
    }
    if (required.has('EXT_meshopt_compression')) {
      throw new Error('This GLB uses meshopt-compressed geometry. Re-export it without mesh compression.');
    }
    for (const viewDef of gltf.bufferViews || []) {
      if (viewDef.extensions?.EXT_meshopt_compression) throw new Error('This GLB uses meshopt-compressed buffer views, which are not supported in this standalone build.');
    }

    const buffers = [];
    const bufferDefs = gltf.buffers || [];
    for (let i = 0; i < bufferDefs.length; i++) {
      const def = bufferDefs[i];
      let bytes;
      if (def.uri) {
        if (!String(def.uri).startsWith('data:')) throw new Error('This GLB references an external .bin file. Export it with all data embedded.');
        bytes = decodeDataUri(def.uri).bytes;
      } else if (i === 0 && binaryChunks[0]) {
        bytes = binaryChunks[0];
      } else {
        throw new Error(`GLB buffer ${i} is missing from the file.`);
      }
      if (def.byteLength && bytes.byteLength < def.byteLength) throw new Error(`GLB buffer ${i} is truncated.`);
      buffers.push(bytes);
    }
    if (!buffers.length && binaryChunks[0]) buffers.push(binaryChunks[0]);

    const floatAccessorCache = new Map();
    const indexAccessorCache = new Map();
    const readAccessor = (accessorIndex, asIndices = false) => {
      const cache = asIndices ? indexAccessorCache : floatAccessorCache;
      if (cache.has(accessorIndex)) return cache.get(accessorIndex);
      const def = gltf.accessors?.[accessorIndex];
      if (!def) throw new Error(`GLB accessor ${accessorIndex} is missing.`);
      const components = glbTypeComponents(def.type);
      if (!components) throw new Error(`Unsupported GLB accessor type ${def.type}.`);
      if (asIndices && components !== 1) throw new Error('A GLB index accessor must be SCALAR.');
      const count = def.count || 0;
      const out = asIndices ? new Uint32Array(count) : new Float32Array(count * components);
      const componentSize = glbComponentSize(def.componentType);
      const packedStride = componentSize * components;
      if (def.bufferView != null) {
        const viewDef = gltf.bufferViews?.[def.bufferView];
        if (!viewDef) throw new Error(`GLB buffer view ${def.bufferView} is missing.`);
        const bytes = buffers[viewDef.buffer];
        if (!bytes) throw new Error(`GLB buffer ${viewDef.buffer} is missing.`);
        const stride = viewDef.byteStride || packedStride;
        if (stride < packedStride) throw new Error('A GLB accessor has an invalid byte stride.');
        const start = (viewDef.byteOffset || 0) + (def.byteOffset || 0);
        const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < count; i++) {
          const row = start + i * stride;
          if (row + packedStride > bytes.byteLength) throw new Error(`GLB accessor ${accessorIndex} reads beyond its buffer.`);
          for (let c = 0; c < components; c++) {
            let value = glbReadComponent(dataView, row + c * componentSize, def.componentType);
            if (!asIndices && def.normalized) value = glbNormalizeComponent(value, def.componentType);
            out[i * components + c] = value;
          }
        }
      }
      if (def.sparse?.count) {
        const sparse = def.sparse;
        const indexViewDef = gltf.bufferViews?.[sparse.indices.bufferView];
        const valueViewDef = gltf.bufferViews?.[sparse.values.bufferView];
        if (!indexViewDef || !valueViewDef) throw new Error('A sparse GLB accessor references a missing buffer view.');
        const indexBytes = buffers[indexViewDef.buffer];
        const valueBytes = buffers[valueViewDef.buffer];
        const indexView = new DataView(indexBytes.buffer, indexBytes.byteOffset, indexBytes.byteLength);
        const valueView = new DataView(valueBytes.buffer, valueBytes.byteOffset, valueBytes.byteLength);
        const sparseIndexSize = glbComponentSize(sparse.indices.componentType);
        const indexStart = (indexViewDef.byteOffset || 0) + (sparse.indices.byteOffset || 0);
        const valueStart = (valueViewDef.byteOffset || 0) + (sparse.values.byteOffset || 0);
        for (let i = 0; i < sparse.count; i++) {
          const destination = glbReadComponent(indexView, indexStart + i * sparseIndexSize, sparse.indices.componentType);
          if (destination < 0 || destination >= count) continue;
          for (let c = 0; c < components; c++) {
            let value = glbReadComponent(valueView, valueStart + (i * components + c) * componentSize, def.componentType);
            if (!asIndices && def.normalized) value = glbNormalizeComponent(value, def.componentType);
            out[destination * components + c] = value;
          }
        }
      }
      const result = { data: out, count, components };
      cache.set(accessorIndex, result);
      return result;
    };

    const textureDefs = gltf.textures || [];
    const imageDefs = gltf.images || [];
    const sourceForTexture = texture => texture?.extensions?.EXT_texture_webp?.source ?? texture?.source ?? texture?.extensions?.KHR_texture_basisu?.source;
    const neededSources = new Set();
    for (const material of gltf.materials || []) {
      const pbr = material.pbrMetallicRoughness;
      const legacy = material.extensions?.KHR_materials_pbrSpecularGlossiness;
      const info = pbr?.baseColorTexture || legacy?.diffuseTexture;
      if (info?.index != null) {
        const source = sourceForTexture(textureDefs[info.index]);
        if (source != null) neededSources.add(source);
      }
    }

    const decodedImages = new Map();
    const textureWarnings = [];
    await Promise.all([...neededSources].map(async sourceIndex => {
      const image = imageDefs[sourceIndex];
      if (!image) return;
      try {
        let bytes, mime = image.mimeType || '';
        if (image.bufferView != null) {
          const viewDef = gltf.bufferViews?.[image.bufferView];
          if (!viewDef) throw new Error('missing image buffer view');
          const source = buffers[viewDef.buffer];
          const start = viewDef.byteOffset || 0;
          const end = start + viewDef.byteLength;
          bytes = source.slice(start, end);
        } else if (image.uri?.startsWith('data:')) {
          const decoded = decodeDataUri(image.uri);
          bytes = decoded.bytes;
          mime = mime || decoded.mime;
        } else {
          throw new Error('external image URI');
        }
        decodedImages.set(sourceIndex, await decodeImagePixels(bytes, mime));
      } catch (error) {
        textureWarnings.push(`Texture ${sourceIndex + 1} could not be decoded (${error?.message || 'unknown image error'}).`);
      }
    }));

    const resolvedTextures = textureDefs.map(texture => {
      const sourceIndex = sourceForTexture(texture);
      return {
        pixels: sourceIndex == null ? null : decodedImages.get(sourceIndex) || null,
        sampler: gltf.samplers?.[texture?.sampler] || {}
      };
    });

    const positionChunks = [];
    const colorChunks = [];
    const textureUvChunks = [];
    const textureChunkSamplerIds = [];
    const textureSamplers = [];
    const colorSources = new Set();
    let primitiveInstances = 0;
    let skippedPrimitives = 0;

    const processPrimitive = (primitive, worldMatrix) => {
      if (primitive.extensions?.KHR_draco_mesh_compression && primitive.attributes?.POSITION == null) {
        throw new Error('A mesh primitive uses Draco compression without an uncompressed fallback.');
      }
      const mode = primitive.mode ?? 4;
      if (![4, 5, 6].includes(mode)) {
        skippedPrimitives++;
        return;
      }
      const positionAccessorIndex = primitive.attributes?.POSITION;
      if (positionAccessorIndex == null) {
        skippedPrimitives++;
        return;
      }
      const positions = readAccessor(positionAccessorIndex, false);
      if (positions.components < 3 || !positions.count) {
        skippedPrimitives++;
        return;
      }
      const indices = primitive.indices == null ? null : readAccessor(primitive.indices, true);
      const indexCount = indices ? indices.count : positions.count;
      const triangleCapacity = mode === 4 ? Math.floor(indexCount / 3) : Math.max(0, indexCount - 2);
      if (!triangleCapacity) return;

      const materialDef = primitive.material == null ? null : gltf.materials?.[primitive.material] || null;
      const pbr = materialDef?.pbrMetallicRoughness;
      const legacy = materialDef?.extensions?.KHR_materials_pbrSpecularGlossiness;
      const factor = (pbr?.baseColorFactor || legacy?.diffuseFactor || [1, 1, 1, 1]).slice(0, 4);
      while (factor.length < 4) factor.push(1);
      const textureInfo = pbr?.baseColorTexture || legacy?.diffuseTexture || null;
      const uvTransform = textureInfo?.extensions?.KHR_texture_transform || null;
      const texCoordSet = uvTransform?.texCoord ?? textureInfo?.texCoord ?? 0;
      const uvAccessorIndex = primitive.attributes?.[`TEXCOORD_${texCoordSet}`];
      const uvs = uvAccessorIndex == null ? null : readAccessor(uvAccessorIndex, false);
      const texture = textureInfo?.index == null ? null : resolvedTextures[textureInfo.index];
      const vertexColorAccessorIndex = primitive.attributes?.COLOR_0;
      const vertexColors = vertexColorAccessorIndex == null ? null : readAccessor(vertexColorAccessorIndex, false);
      const hasTextureColor = !!(texture?.pixels && uvs && uvs.components >= 2);
      const hasVertexColor = !!(vertexColors && vertexColors.components >= 3);
      const hasMaterialColor = !!materialDef;
      if (hasTextureColor) colorSources.add('texture');
      if (hasVertexColor) colorSources.add('vertex');
      if (hasMaterialColor) colorSources.add('material');
      const hasColor = hasTextureColor || hasVertexColor || hasMaterialColor;
      const expandedPositions = new Float32Array(triangleCapacity * 9);
      // For textured primitives this stores material × vertex color. The texture itself is
      // sampled later at every surface point, rather than only at triangle vertices.
      const expandedColors = new Float32Array(triangleCapacity * 12);
      const expandedUvs = hasTextureColor ? new Float32Array(triangleCapacity * 6) : null;
      const textureSamplerId = hasTextureColor ? textureSamplers.push(texture) - 1 : -1;
      let triangleOut = 0;

      const sourceIndex = logicalIndex => indices ? indices.data[logicalIndex] : logicalIndex;
      const vertexBaseColor = vertexIndex => {
        let r = factor[0], g = factor[1], b = factor[2], a = factor[3];
        if (hasVertexColor && vertexIndex < vertexColors.count) {
          const base = vertexIndex * vertexColors.components;
          r *= vertexColors.data[base];
          g *= vertexColors.data[base + 1];
          b *= vertexColors.data[base + 2];
          if (vertexColors.components > 3) a *= vertexColors.data[base + 3];
        }
        return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b)), Math.max(0, Math.min(1, a))];
      };

      for (let triangle = 0; triangle < triangleCapacity; triangle++) {
        let logical;
        if (mode === 4) logical = [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
        else if (mode === 5) logical = (triangle & 1) ? [triangle + 1, triangle, triangle + 2] : [triangle, triangle + 1, triangle + 2];
        else logical = [0, triangle + 1, triangle + 2];
        const ids = logical.map(sourceIndex);
        if (ids.some(id => id >= positions.count)) continue;
        const pBase = triangleOut * 9;
        const cBase = triangleOut * 12;
        const uvBase = triangleOut * 6;
        for (let corner = 0; corner < 3; corner++) {
          const id = ids[corner];
          const sourceBase = id * positions.components;
          const point = glbTransformPoint(worldMatrix, positions.data[sourceBase], positions.data[sourceBase + 1], positions.data[sourceBase + 2]);
          expandedPositions.set(point, pBase + corner * 3);
          const color = hasColor ? vertexBaseColor(id) : [1, 1, 1, 1];
          expandedColors.set(color, cBase + corner * 4);
          if (expandedUvs && id < uvs.count) {
            const sourceUv = id * uvs.components;
            const transformed = transformGlbUv(uvs.data[sourceUv], uvs.data[sourceUv + 1], uvTransform);
            expandedUvs[uvBase + corner * 2] = transformed[0];
            expandedUvs[uvBase + corner * 2 + 1] = transformed[1];
          }
        }
        triangleOut++;
      }
      if (!triangleOut) return;
      positionChunks.push(triangleOut === triangleCapacity ? expandedPositions : expandedPositions.slice(0, triangleOut * 9));
      colorChunks.push(triangleOut === triangleCapacity ? expandedColors : expandedColors.slice(0, triangleOut * 12));
      textureUvChunks.push(expandedUvs ? (triangleOut === triangleCapacity ? expandedUvs : expandedUvs.slice(0, triangleOut * 6)) : null);
      textureChunkSamplerIds.push(textureSamplerId);
      primitiveInstances++;
    };

    const nodes = gltf.nodes || [];
    const scene = gltf.scenes?.[gltf.scene ?? 0];
    let roots = scene?.nodes?.slice() || [];
    if (!roots.length) {
      const childSet = new Set();
      for (const node of nodes) for (const child of node.children || []) childSet.add(child);
      roots = nodes.map((_, index) => index).filter(index => !childSet.has(index));
    }
    const visit = (nodeIndex, parentMatrix, stack) => {
      if (stack.has(nodeIndex)) throw new Error('The GLB scene graph contains a cycle.');
      const node = nodes[nodeIndex];
      if (!node) return;
      const nextStack = new Set(stack);
      nextStack.add(nodeIndex);
      const world = glbMultiplyMatrices(parentMatrix, glbNodeMatrix(node));
      if (node.mesh != null) {
        const mesh = gltf.meshes?.[node.mesh];
        for (const primitive of mesh?.primitives || []) processPrimitive(primitive, world);
      }
      for (const child of node.children || []) visit(child, world, nextStack);
    };
    const identity = glbIdentityMatrix();
    for (const root of roots) visit(root, identity, new Set());

    if (!positionChunks.length) throw new Error('No uncompressed triangle primitives were found in this GLB file.');
    const positionLength = positionChunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const triangles = new Float32Array(positionLength);
    let positionOffset = 0;
    for (const chunk of positionChunks) { triangles.set(chunk, positionOffset); positionOffset += chunk.length; }
    let colors = null;
    if (colorSources.size) {
      const colorLength = colorChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      colors = new Float32Array(colorLength);
      let colorOffset = 0;
      for (const chunk of colorChunks) { colors.set(chunk, colorOffset); colorOffset += chunk.length; }
    }
    let textureData = null;
    if (colorSources.has('texture')) {
      const triangleCount = triangles.length / 9;
      const triangleUvs = new Float32Array(triangleCount * 6);
      const triangleSamplerIds = new Int32Array(triangleCount);
      triangleSamplerIds.fill(-1);
      let triangleOffset = 0;
      for (let i = 0; i < positionChunks.length; i++) {
        const count = positionChunks[i].length / 9;
        const uvChunk = textureUvChunks[i];
        const samplerId = textureChunkSamplerIds[i];
        if (uvChunk && samplerId >= 0) {
          triangleUvs.set(uvChunk, triangleOffset * 6);
          triangleSamplerIds.fill(samplerId, triangleOffset, triangleOffset + count);
        }
        triangleOffset += count;
      }
      textureData = { triangleUvs, triangleSamplerIds, samplers: textureSamplers };
    }
    const source = colorSources.has('texture') ? 'texture' : colorSources.has('vertex') ? 'vertex' : colorSources.has('material') ? 'material' : 'none';
    const label = source === 'texture' ? 'embedded GLB base-color texture' : source === 'vertex' ? 'GLB vertex colors' : source === 'material' ? 'GLB material colors' : 'random palette';
    return {
      triangles,
      colors,
      textureData,
      colorInfo: {
        source,
        label,
        texturesDecoded: decodedImages.size,
        textureWarnings,
        sampling: source === 'texture' ? 'Per-surface-point UV sampling followed by per-brick footprint averaging' : source === 'none' ? 'Random palette fallback' : 'Per-vertex/material interpolation followed by per-brick footprint averaging',
        primitiveInstances,
        skippedPrimitives,
        triangleCount: triangles.length / 9
      }
    };
  }
  async function loadSourceModel() {
    if (appState.parsedModel) return appState.parsedModel;
    if (!appState.source) throw new Error('Choose a model first.');
    setProgress(3, appState.sourceFormat === 'glb' ? 'Reading GLB scene, materials, and embedded textures…' : 'Reading model…');
    let model;
    if (appState.sourceFormat === 'obj') {
      const text = await appState.source.text();
      model = { triangles: parseOBJ(text), colors: null, colorInfo: { source: 'none', label: 'random palette' } };
    } else if (appState.sourceFormat === 'stl') {
      const buffer = await appState.source.arrayBuffer();
      model = { triangles: parseSTL(buffer), colors: null, colorInfo: { source: 'none', label: 'random palette' } };
    } else {
      const buffer = await appState.source.arrayBuffer();
      model = await parseGLB(buffer);
    }
    appState.parsedModel = model;
    appState.modelColorInfo = model.colorInfo || { source: 'none', label: 'random palette' };
    return model;
  }

  function axisMode() {
    if (upAxis.value === 'y' || upAxis.value === 'z') return upAxis.value;
    return appState.sourceFormat === 'stl' ? 'z' : 'y';
  }

  function orientTriangles(input, mode) {
    if (mode === 'y') return input;
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 3) {
      out[i] = input[i];
      out[i + 1] = input[i + 2];
      out[i + 2] = -input[i + 1];
    }
    return out;
  }

  function orientModel(model, mode) {
    return { ...model, triangles: orientTriangles(model.triangles, mode) };
  }

  function getBounds(triangles) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < triangles.length; i += 3) {
      const x = triangles[i], y = triangles[i + 1], z = triangles[i + 2];
      if (!Number.isFinite(x + y + z)) continue;
      minX = Math.min(minX, x); minY = Math.min(minY, y); minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); maxZ = Math.max(maxZ, z);
    }
    if (!Number.isFinite(minX)) throw new Error('The model does not contain finite vertex coordinates.');
    return { minX, minY, minZ, maxX, maxY, maxZ };
  }

  function normalizeModel(model, targetResolution) {
    const input = model.triangles;
    const bounds = getBounds(input);
    const sx = bounds.maxX - bounds.minX;
    const sy = bounds.maxY - bounds.minY;
    const sz = bounds.maxZ - bounds.minZ;
    const longest = Math.max(sx, sy, sz);
    if (!(longest > 1e-9)) throw new Error('The model has no measurable size.');
    const scale = targetResolution / longest;
    const nx = Math.max(1, Math.ceil(sx * scale));
    const ny = Math.max(1, Math.ceil((sy * scale) / BRICK_HEIGHT));
    const nz = Math.max(1, Math.ceil(sz * scale));
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i += 3) {
      out[i] = (input[i] - bounds.minX) * scale;
      out[i + 1] = ((input[i + 1] - bounds.minY) * scale) / BRICK_HEIGHT;
      out[i + 2] = (input[i + 2] - bounds.minZ) * scale;
    }
    return {
      triangles: out,
      colors: model.colors || null,
      textureData: model.textureData || null,
      colorInfo: model.colorInfo || null,
      nx, ny, nz, scale, originalBounds: bounds
    };
  }

  async function voxelizeMeshExact(normalized, revision) {
    const { triangles, nx, ny, nz } = normalized;
    const triCount = triangles.length / 9;
    const rowCount = ny * nz;
    const bins = Array.from({ length: rowCount }, () => []);
    const validTri = new Uint8Array(triCount);
    let binReferences = 0;

    setProgress(12, `Indexing ${fmt.format(triCount)} triangles…`);
    for (let t = 0; t < triCount; t++) {
      if (revision !== appState.modelRevision) throw new Error('Generation cancelled.');
      const i = t * 9;
      const y0 = triangles[i + 1], z0 = triangles[i + 2];
      const y1 = triangles[i + 4], z1 = triangles[i + 5];
      const y2 = triangles[i + 7], z2 = triangles[i + 8];
      const denom = (y1 - y0) * (z2 - z0) - (z1 - z0) * (y2 - y0);
      if (Math.abs(denom) < 1e-10) continue;
      validTri[t] = 1;
      const minY = Math.min(y0, y1, y2), maxY = Math.max(y0, y1, y2);
      const minZ = Math.min(z0, z1, z2), maxZ = Math.max(z0, z1, z2);
      const ys = Math.max(0, Math.ceil(minY - 0.5 - 1e-7));
      const ye = Math.min(ny - 1, Math.floor(maxY - 0.5 + 1e-7));
      const zs = Math.max(0, Math.ceil(minZ - 0.5 - 1e-7));
      const ze = Math.min(nz - 1, Math.floor(maxZ - 0.5 + 1e-7));
      for (let y = ys; y <= ye; y++) {
        const row = y * nz;
        for (let z = zs; z <= ze; z++) {
          bins[row + z].push(t);
          binReferences++;
        }
      }
      if (binReferences > MAX_BIN_REFERENCES) {
        throw new Error('This mesh is too dense for the selected resolution. Try a lower resolution or simplify the model.');
      }
      if ((t & 2047) === 0) {
        setProgress(12 + 13 * (t / triCount), `Indexing triangles… ${Math.round(100 * t / triCount)}%`);
        await yieldFrame();
      }
    }

    const occupied = new Uint8Array(nx * ny * nz);
    let filled = 0;
    let oddRows = 0;
    setProgress(26, 'Filling model volume…');

    for (let y = 0; y < ny; y++) {
      if (revision !== appState.modelRevision) throw new Error('Generation cancelled.');
      const py = y + 0.5;
      for (let z = 0; z < nz; z++) {
        const pz = z + 0.5;
        const candidates = bins[y * nz + z];
        if (!candidates.length) continue;
        const xs = [];
        for (let c = 0; c < candidates.length; c++) {
          const t = candidates[c];
          if (!validTri[t]) continue;
          const i = t * 9;
          const x0 = triangles[i], y0 = triangles[i + 1], z0 = triangles[i + 2];
          const x1 = triangles[i + 3], y1 = triangles[i + 4], z1 = triangles[i + 5];
          const x2 = triangles[i + 6], y2 = triangles[i + 7], z2 = triangles[i + 8];
          const v0y = y1 - y0, v0z = z1 - z0;
          const v1y = y2 - y0, v1z = z2 - z0;
          const qy = py - y0, qz = pz - z0;
          const denom = v0y * v1z - v0z * v1y;
          if (Math.abs(denom) < 1e-10) continue;
          const b = (qy * v1z - qz * v1y) / denom;
          const c2 = (v0y * qz - v0z * qy) / denom;
          const a = 1 - b - c2;
          const eps = 1e-7;
          if (a >= -eps && b >= -eps && c2 >= -eps) xs.push(a * x0 + b * x1 + c2 * x2);
        }
        if (xs.length < 2) continue;
        xs.sort((a, b) => a - b);
        const unique = [];
        for (let i = 0; i < xs.length; i++) {
          if (!unique.length || Math.abs(xs[i] - unique[unique.length - 1]) > 1e-4) unique.push(xs[i]);
          else unique[unique.length - 1] = (unique[unique.length - 1] + xs[i]) * 0.5;
        }
        if (unique.length & 1) oddRows++;
        for (let p = 0; p + 1 < unique.length; p += 2) {
          const left = Math.min(unique[p], unique[p + 1]);
          const right = Math.max(unique[p], unique[p + 1]);
          const start = Math.max(0, Math.ceil(left - 0.5 + 1e-6));
          const end = Math.min(nx - 1, Math.floor(right - 0.5 - 1e-6));
          for (let x = start; x <= end; x++) {
            const index = x + nx * (z + nz * y);
            if (!occupied[index]) { occupied[index] = 1; filled++; }
          }
        }
      }
      if ((y & 1) === 0) {
        setProgress(26 + 32 * ((y + 1) / ny), `Filling layer ${y + 1} of ${ny}…`);
        await yieldFrame();
      }
    }

    if (!filled) throw new Error('No solid volume was detected. Use a closed/watertight mesh or raise the resolution.');
    const cropped = cropGrid({ occupied, nx, ny, nz, filled }, triangles);
    cropped.oddRows = oddRows;
    return cropped;
  }


  function countOccupiedCells(mask) {
    let count = 0;
    for (let i = 0; i < mask.length; i++) count += mask[i] ? 1 : 0;
    return count;
  }

  function triangleMetrics(triangles, i) {
    const x0 = triangles[i], y0 = triangles[i + 1], z0 = triangles[i + 2];
    const x1 = triangles[i + 3], y1 = triangles[i + 4], z1 = triangles[i + 5];
    const x2 = triangles[i + 6], y2 = triangles[i + 7], z2 = triangles[i + 8];
    const e01x = x1 - x0, e01y = y1 - y0, e01z = z1 - z0;
    const e02x = x2 - x0, e02y = y2 - y0, e02z = z2 - z0;
    const e12x = x2 - x1, e12y = y2 - y1, e12z = z2 - z1;
    const cx = e01y * e02z - e01z * e02y;
    const cy = e01z * e02x - e01x * e02z;
    const cz = e01x * e02y - e01y * e02x;
    const areaSq4 = cx * cx + cy * cy + cz * cz;
    const l01 = e01x * e01x + e01y * e01y + e01z * e01z;
    const l02 = e02x * e02x + e02y * e02y + e02z * e02z;
    const l12 = e12x * e12x + e12y * e12y + e12z * e12z;
    return { areaSq4, maxEdge: Math.sqrt(Math.max(l01, l02, l12)) };
  }

  async function prepareSurfaceSampling(triangles, mode, revision, options = {}) {
    const triCount = triangles.length / 9;
    const subdivisions = new Uint16Array(triCount);
    let spacing = mode === 'generous' ? 0.48 : 0.58;
    let estimatedSamples = 0;
    let degenerateTriangles = 0;
    const progress = options.progress ?? 12;
    const firstLabel = options.firstLabel || 'Analyzing triangle surface…';
    const retryLabel = options.retryLabel || 'Balancing surface sampling density…';

    for (let attempt = 0; attempt < 3; attempt++) {
      estimatedSamples = 0;
      degenerateTriangles = 0;
      setProgress(progress, attempt ? retryLabel : firstLabel);
      for (let t = 0; t < triCount; t++) {
        if (revision !== appState.modelRevision) throw new Error('Generation cancelled.');
        const metrics = triangleMetrics(triangles, t * 9);
        if (metrics.areaSq4 < 1e-16 || !Number.isFinite(metrics.maxEdge)) {
          subdivisions[t] = 0;
          degenerateTriangles++;
          continue;
        }
        const n = Math.max(1, Math.min(255, Math.ceil(metrics.maxEdge / spacing)));
        subdivisions[t] = n;
        estimatedSamples += ((n + 1) * (n + 2)) / 2 + 1;
        if ((t & 32767) === 0) await yieldFrame();
      }
      if (estimatedSamples <= MAX_SURFACE_SAMPLES) break;
      spacing *= Math.max(1.08, Math.sqrt(estimatedSamples / MAX_SURFACE_SAMPLES) * 1.025);
    }
    return { subdivisions, spacing, estimatedSamples, degenerateTriangles };
  }

  async function rasterizeTriangleSurface(normalized, repair, revision, options = {}) {
    const { triangles, colors, textureData, nx, ny, nz } = normalized;
    const triCount = triangles.length / 9;
    const total = nx * ny * nz;
    const surface = new Uint8Array(total);
    const hasVertexOrMaterialColors = !!(colors && colors.length === triCount * 12);
    const hasTextureSamples = !!(textureData?.triangleUvs?.length === triCount * 6 && textureData?.triangleSamplerIds?.length === triCount);
    const captureColors = colorMode.value === 'model' && (hasVertexOrMaterialColors || hasTextureSamples);
    const surfaceColorSums = captureColors ? new Float32Array(total * 3) : null;
    const surfaceColorWeights = captureColors ? new Float32Array(total) : null;
    const progressStart = options.progressStart ?? 16;
    const progressEnd = options.progressEnd ?? 36;
    const sampling = await prepareSurfaceSampling(triangles, repair.mode, revision, {
      progress: options.analysisProgress ?? Math.max(0, progressStart - 4),
      firstLabel: options.analysisLabel || (captureColors ? 'Analyzing geometry and GLB color samples…' : 'Analyzing triangle surface…'),
      retryLabel: 'Balancing surface sampling density…'
    });
    let surfaceVoxels = 0;
    let sampledPoints = 0;
    let coloredSurfaceVoxels = 0;

    const markPoint = (px, py, pz, cr = 0, cg = 0, cb = 0, ca = 0) => {
      if (!Number.isFinite(px + py + pz)) return;
      if (px < -0.75 || py < -0.75 || pz < -0.75 || px > nx + 0.75 || py > ny + 0.75 || pz > nz + 0.75) return;
      const x = Math.max(0, Math.min(nx - 1, Math.floor(px)));
      const y = Math.max(0, Math.min(ny - 1, Math.floor(py)));
      const z = Math.max(0, Math.min(nz - 1, Math.floor(pz)));
      const index = x + nx * (z + nz * y);
      if (!surface[index]) {
        surface[index] = 1;
        surfaceVoxels++;
      }
      if (surfaceColorWeights && ca > 0.01 && Number.isFinite(cr + cg + cb + ca)) {
        const weight = Math.max(0.04, Math.min(1, ca));
        if (surfaceColorWeights[index] === 0) coloredSurfaceVoxels++;
        surfaceColorSums[index * 3] += Math.max(0, Math.min(1, cr)) * weight;
        surfaceColorSums[index * 3 + 1] += Math.max(0, Math.min(1, cg)) * weight;
        surfaceColorSums[index * 3 + 2] += Math.max(0, Math.min(1, cb)) * weight;
        surfaceColorWeights[index] += weight;
      }
    };

    setProgress(progressStart, options.rasterLabel || `Rasterizing ${fmt.format(triCount)} triangles into a repairable shell…`);
    for (let t = 0; t < triCount; t++) {
      if (revision !== appState.modelRevision) throw new Error('Generation cancelled.');
      const n = sampling.subdivisions[t];
      if (!n) continue;
      const i = t * 9;
      const x0 = triangles[i], y0 = triangles[i + 1], z0 = triangles[i + 2];
      const x1 = triangles[i + 3], y1 = triangles[i + 4], z1 = triangles[i + 5];
      const x2 = triangles[i + 6], y2 = triangles[i + 7], z2 = triangles[i + 8];
      const ci = t * 12;
      const uvIndex = t * 6;
      const textureSamplerId = hasTextureSamples ? textureData.triangleSamplerIds[t] : -1;
      const textureSampler = textureSamplerId >= 0 ? textureData.samplers[textureSamplerId] : null;
      const inv = 1 / n;
      for (let a = 0; a <= n; a++) {
        const u = a * inv;
        for (let b = 0; b <= n - a; b++) {
          const v = b * inv;
          const w = 1 - u - v;
          if (captureColors) {
            let cr = hasVertexOrMaterialColors ? w * colors[ci] + u * colors[ci + 4] + v * colors[ci + 8] : 1;
            let cg = hasVertexOrMaterialColors ? w * colors[ci + 1] + u * colors[ci + 5] + v * colors[ci + 9] : 1;
            let cb = hasVertexOrMaterialColors ? w * colors[ci + 2] + u * colors[ci + 6] + v * colors[ci + 10] : 1;
            let ca = hasVertexOrMaterialColors ? w * colors[ci + 3] + u * colors[ci + 7] + v * colors[ci + 11] : 1;
            if (textureSampler) {
              const tu = w * textureData.triangleUvs[uvIndex] + u * textureData.triangleUvs[uvIndex + 2] + v * textureData.triangleUvs[uvIndex + 4];
              const tv = w * textureData.triangleUvs[uvIndex + 1] + u * textureData.triangleUvs[uvIndex + 3] + v * textureData.triangleUvs[uvIndex + 5];
              const texel = sampleGlbTexture(textureSampler, tu, tv);
              cr *= texel[0]; cg *= texel[1]; cb *= texel[2]; ca *= texel[3];
            }
            markPoint(
              w * x0 + u * x1 + v * x2,
              w * y0 + u * y1 + v * y2,
              w * z0 + u * z1 + v * z2,
              cr, cg, cb, ca
            );
          } else {
            markPoint(w * x0 + u * x1 + v * x2, w * y0 + u * y1 + v * y2, w * z0 + u * z1 + v * z2);
          }
          sampledPoints++;
        }
      }
      if (captureColors) {
        let cr = hasVertexOrMaterialColors ? (colors[ci] + colors[ci + 4] + colors[ci + 8]) / 3 : 1;
        let cg = hasVertexOrMaterialColors ? (colors[ci + 1] + colors[ci + 5] + colors[ci + 9]) / 3 : 1;
        let cb = hasVertexOrMaterialColors ? (colors[ci + 2] + colors[ci + 6] + colors[ci + 10]) / 3 : 1;
        let ca = hasVertexOrMaterialColors ? (colors[ci + 3] + colors[ci + 7] + colors[ci + 11]) / 3 : 1;
        if (textureSampler) {
          const tu = (textureData.triangleUvs[uvIndex] + textureData.triangleUvs[uvIndex + 2] + textureData.triangleUvs[uvIndex + 4]) / 3;
          const tv = (textureData.triangleUvs[uvIndex + 1] + textureData.triangleUvs[uvIndex + 3] + textureData.triangleUvs[uvIndex + 5]) / 3;
          const texel = sampleGlbTexture(textureSampler, tu, tv);
          cr *= texel[0]; cg *= texel[1]; cb *= texel[2]; ca *= texel[3];
        }
        markPoint(
          (x0 + x1 + x2) / 3,
          (y0 + y1 + y2) / 3,
          (z0 + z1 + z2) / 3,
          cr, cg, cb, ca
        );
      } else {
        markPoint((x0 + x1 + x2) / 3, (y0 + y1 + y2) / 3, (z0 + z1 + z2) / 3);
      }
      sampledPoints++;
      if ((t & 8191) === 0) {
        setProgress(progressStart + (progressEnd - progressStart) * (t / triCount), `${captureColors ? 'Rasterizing surface and colors' : 'Rasterizing surface'}… ${Math.round(100 * t / triCount)}%`);
        await yieldFrame();
      }
    }
    if (!surfaceVoxels) throw new Error('No usable surface could be voxelized from this mesh.');
    return { surface, surfaceVoxels, sampledPoints, coloredSurfaceVoxels, surfaceColorSums, surfaceColorWeights, ...sampling };
  }

  async function propagateSurfaceColors(occupied, nx, ny, nz, sums, weights, revision, progress = 57) {
    if (!sums || !weights) return null;
    const total = occupied.length;
    const plane = nx * nz;
    const colors = new Float32Array(total * 3);
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0, tail = 0;
    let globalR = 0, globalG = 0, globalB = 0, globalWeight = 0;
    for (let i = 0; i < total; i++) {
      if (!occupied[i] || !(weights[i] > 0)) continue;
      const weight = weights[i];
      const r = sums[i * 3] / weight;
      const g = sums[i * 3 + 1] / weight;
      const b = sums[i * 3 + 2] / weight;
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
      globalR += r * weight; globalG += g * weight; globalB += b * weight; globalWeight += weight;
      visited[i] = 1;
      queue[tail++] = i;
    }
    if (!tail) return null;
    setProgress(progress, `Spreading sampled model colors through ${fmt.format(countOccupiedCells(occupied))} solid studs…`);
    while (head < tail) {
      if (revision !== appState.modelRevision) throw new Error('Generation cancelled.');
      const index = queue[head++];
      const y = Math.floor(index / plane);
      const rem = index - y * plane;
      const z = Math.floor(rem / nx);
      const x = rem - z * nx;
      const copy = next => {
        if (!occupied[next] || visited[next]) return;
        visited[next] = 1;
        colors[next * 3] = colors[index * 3];
        colors[next * 3 + 1] = colors[index * 3 + 1];
        colors[next * 3 + 2] = colors[index * 3 + 2];
        queue[tail++] = next;
      };
      if (x > 0) copy(index - 1);
      if (x + 1 < nx) copy(index + 1);
      if (z > 0) copy(index - nx);
      if (z + 1 < nz) copy(index + nx);
      if (y > 0) copy(index - plane);
      if (y + 1 < ny) copy(index + plane);
      if ((head & 262143) === 0) await yieldFrame();
    }
    const fallback = globalWeight > 0 ? [globalR / globalWeight, globalG / globalWeight, globalB / globalWeight] : [0.72, 0.72, 0.72];
    for (let i = 0; i < total; i++) {
      if (!occupied[i] || visited[i]) continue;
      colors[i * 3] = fallback[0]; colors[i * 3 + 1] = fallback[1]; colors[i * 3 + 2] = fallback[2];
    }
    return colors;
  }

  function dilateMask(mask, nx, ny, nz, radius = 1, diagonal = true) {
    let current = mask.slice();
    const plane = nx * nz;
    for (let pass = 0; pass < radius; pass++) {
      const out = current.slice();
      for (let y = 0; y < ny; y++) {
        for (let z = 0; z < nz; z++) {
          const base = nx * (z + nz * y);
          for (let x = 0; x < nx; x++) {
            const index = base + x;
            if (!current[index]) continue;
            for (let dy = -1; dy <= 1; dy++) {
              const yy = y + dy;
              if (yy < 0 || yy >= ny) continue;
              for (let dz = -1; dz <= 1; dz++) {
                const zz = z + dz;
                if (zz < 0 || zz >= nz) continue;
                for (let dx = -1; dx <= 1; dx++) {
                  if (!dx && !dy && !dz) continue;
                  if (!diagonal && Math.abs(dx) + Math.abs(dy) + Math.abs(dz) !== 1) continue;
                  const xx = x + dx;
                  if (xx < 0 || xx >= nx) continue;
                  out[xx + nx * (zz + nz * yy)] = 1;
                }
              }
            }
          }
        }
      }
      current = out;
    }
    return current;
  }

  function erodeMask(mask, nx, ny, nz, radius = 1, diagonal = true) {
    let current = mask.slice();
    for (let pass = 0; pass < radius; pass++) {
      const out = new Uint8Array(current.length);
      for (let y = 0; y < ny; y++) {
        for (let z = 0; z < nz; z++) {
          const base = nx * (z + nz * y);
          for (let x = 0; x < nx; x++) {
            const index = base + x;
            if (!current[index]) continue;
            let keep = true;
            for (let dy = -1; dy <= 1 && keep; dy++) {
              const yy = y + dy;
              for (let dz = -1; dz <= 1 && keep; dz++) {
                const zz = z + dz;
                for (let dx = -1; dx <= 1; dx++) {
                  if (!dx && !dy && !dz) continue;
                  if (!diagonal && Math.abs(dx) + Math.abs(dy) + Math.abs(dz) !== 1) continue;
                  const xx = x + dx;
                  if (xx < 0 || xx >= nx || yy < 0 || yy >= ny || zz < 0 || zz >= nz || !current[xx + nx * (zz + nz * yy)]) {
                    keep = false;
                    break;
                  }
                }
              }
            }
            if (keep) out[index] = 1;
          }
        }
      }
      current = out;
    }
    return current;
  }

  function additiveCloseMask(mask, nx, ny, nz, diagonal = false) {
    const dilated = dilateMask(mask, nx, ny, nz, 1, diagonal);
    const closed = erodeMask(dilated, nx, ny, nz, 1, diagonal);
    for (let i = 0; i < mask.length; i++) if (mask[i]) closed[i] = 1;
    return closed;
  }

  function addDirectionalSpanVotes(mask, nx, ny, nz, votes) {
    // X direction: one line for each Y/Z pair.
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const base = nx * (z + nz * y);
        let first = -1, last = -1;
        for (let x = 0; x < nx; x++) {
          if (!mask[base + x]) continue;
          if (first < 0) first = x;
          last = x;
        }
        if (first >= 0) for (let x = first; x <= last; x++) votes[base + x]++;
      }
    }

    // Z direction: one line for each Y/X pair.
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        let first = -1, last = -1;
        for (let z = 0; z < nz; z++) {
          const index = x + nx * (z + nz * y);
          if (!mask[index]) continue;
          if (first < 0) first = z;
          last = z;
        }
        if (first >= 0) {
          for (let z = first; z <= last; z++) votes[x + nx * (z + nz * y)]++;
        }
      }
    }

    // Y direction: one line for each X/Z pair.
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        let first = -1, last = -1;
        for (let y = 0; y < ny; y++) {
          const index = x + nx * (z + nz * y);
          if (!mask[index]) continue;
          if (first < 0) first = y;
          last = y;
        }
        if (first >= 0) {
          for (let y = first; y <= last; y++) votes[x + nx * (z + nz * y)]++;
        }
      }
    }
  }

  function floodExterior(mask, nx, ny, nz) {
    const total = mask.length;
    const outside = new Uint8Array(total);
    const queue = new Int32Array(total);
    const plane = nx * nz;
    let head = 0, tail = 0;
    const enqueue = index => {
      if (mask[index] || outside[index]) return;
      outside[index] = 1;
      queue[tail++] = index;
    };

    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        enqueue(nx * (z + nz * y));
        enqueue(nx - 1 + nx * (z + nz * y));
      }
    }
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        enqueue(x + nx * (nz * y));
        enqueue(x + nx * ((nz - 1) + nz * y));
      }
    }
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        enqueue(x + nx * z);
        enqueue(x + nx * (z + nz * (ny - 1)));
      }
    }

    while (head < tail) {
      const index = queue[head++];
      const y = Math.floor(index / plane);
      const rem = index - y * plane;
      const z = Math.floor(rem / nx);
      const x = rem - z * nx;
      if (x > 0) enqueue(index - 1);
      if (x + 1 < nx) enqueue(index + 1);
      if (z > 0) enqueue(index - nx);
      if (z + 1 < nz) enqueue(index + nx);
      if (y > 0) enqueue(index - plane);
      if (y + 1 < ny) enqueue(index + plane);
    }
    return outside;
  }

  function fillSmallSliceHoles(mask, nx, ny, nz, maxArea) {
    if (maxArea <= 0) return 0;
    const plane = nx * nz;
    const visited = new Uint8Array(plane);
    const queue = new Int32Array(plane);
    let filled = 0;
    for (let y = 0; y < ny; y++) {
      visited.fill(0);
      const layerOffset = y * plane;
      for (let seed = 0; seed < plane; seed++) {
        if (visited[seed] || mask[layerOffset + seed]) continue;
        let head = 0, tail = 0;
        let touchesEdge = false;
        visited[seed] = 1;
        queue[tail++] = seed;
        while (head < tail) {
          const pi = queue[head++];
          const z = Math.floor(pi / nx);
          const x = pi - z * nx;
          if (x === 0 || x === nx - 1 || z === 0 || z === nz - 1) touchesEdge = true;
          const tryCell = next => {
            if (visited[next] || mask[layerOffset + next]) return;
            visited[next] = 1;
            queue[tail++] = next;
          };
          if (x > 0) tryCell(pi - 1);
          if (x + 1 < nx) tryCell(pi + 1);
          if (z > 0) tryCell(pi - nx);
          if (z + 1 < nz) tryCell(pi + nx);
        }
        if (!touchesEdge && tail <= maxArea) {
          for (let i = 0; i < tail; i++) {
            mask[layerOffset + queue[i]] = 1;
            filled++;
          }
        }
      }
    }
    return filled;
  }

  function flattenBottomMask(mask, nx, ny, nz, maxTrimLayers) {
    const maxTrim = Math.min(Math.max(0, maxTrimLayers), Math.max(0, ny - 1));
    if (!maxTrim) return 0;
    const plane = nx * nz;
    const counts = new Int32Array(maxTrim + 1);
    let peak = 0;
    for (let y = 0; y <= maxTrim; y++) {
      let count = 0;
      const offset = y * plane;
      for (let i = 0; i < plane; i++) count += mask[offset + i] ? 1 : 0;
      counts[y] = count;
      peak = Math.max(peak, count);
    }
    if (!peak) return 0;
    let best = 0;
    let bestScore = counts[0];
    const trimPenalty = Math.max(1, peak * 0.08);
    const improvement = Math.max(1, peak * 0.035);
    for (let y = 1; y <= maxTrim; y++) {
      const score = counts[y] - y * trimPenalty;
      if (score > bestScore + improvement) {
        best = y;
        bestScore = score;
      }
    }
    if (!best) return 0;
    for (let y = 0; y < best; y++) mask.fill(0, y * plane, (y + 1) * plane);
    return best;
  }


  function addBottomLeveling(mask, nx, ny, nz, maxLayers) {
    const baseLevelMask = new Uint8Array(mask.length);
    const limit = Math.min(Math.max(0, maxLayers), Math.max(0, ny - 1));
    if (!limit) return { baseLevelMask, addedStuds: 0 };
    let addedStuds = 0;
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        let firstY = -1;
        for (let y = 0; y <= limit; y++) {
          if (mask[x + nx * (z + nz * y)]) { firstY = y; break; }
        }
        if (firstY <= 0) continue;
        for (let y = 0; y < firstY; y++) {
          const index = x + nx * (z + nz * y);
          if (!mask[index]) {
            mask[index] = 1;
            baseLevelMask[index] = 1;
            addedStuds++;
          }
        }
      }
    }
    return { baseLevelMask, addedStuds };
  }

  function retainBaseConnectedVoxels(mask, nx, ny, nz, baseLevelMask = null) {
    const total = mask.length;
    const plane = nx * nz;
    let baseY = -1;
    for (let y = 0; y < ny && baseY < 0; y++) {
      const offset = y * plane;
      for (let i = 0; i < plane; i++) {
        if (mask[offset + i]) { baseY = y; break; }
      }
    }
    if (baseY < 0) return { baseY: 0, floatingComponentsSkipped: 0, floatingVoxelsSkipped: 0 };
    const visited = new Uint8Array(total);
    const queue = new Int32Array(total);
    let head = 0, tail = 0;
    const baseOffset = baseY * plane;
    for (let i = 0; i < plane; i++) {
      const index = baseOffset + i;
      if (!mask[index]) continue;
      visited[index] = 1;
      queue[tail++] = index;
    }
    const expand = index => {
      const y = Math.floor(index / plane);
      const rem = index - y * plane;
      const z = Math.floor(rem / nx);
      const x = rem - z * nx;
      const visit = next => {
        if (!mask[next] || visited[next]) return;
        visited[next] = 1;
        queue[tail++] = next;
      };
      if (x > 0) visit(index - 1);
      if (x + 1 < nx) visit(index + 1);
      if (z > 0) visit(index - nx);
      if (z + 1 < nz) visit(index + nx);
      if (y > 0) visit(index - plane);
      if (y + 1 < ny) visit(index + plane);
    };
    while (head < tail) expand(queue[head++]);

    let floatingVoxelsSkipped = 0;
    let floatingComponentsSkipped = 0;
    const componentQueue = new Int32Array(total);
    const marked = visited.slice();
    for (let seed = 0; seed < total; seed++) {
      if (!mask[seed] || marked[seed]) continue;
      floatingComponentsSkipped++;
      let cHead = 0, cTail = 0;
      marked[seed] = 1;
      componentQueue[cTail++] = seed;
      while (cHead < cTail) {
        const index = componentQueue[cHead++];
        const y = Math.floor(index / plane);
        const rem = index - y * plane;
        const z = Math.floor(rem / nx);
        const x = rem - z * nx;
        const visit = next => {
          if (!mask[next] || marked[next]) return;
          marked[next] = 1;
          componentQueue[cTail++] = next;
        };
        if (x > 0) visit(index - 1);
        if (x + 1 < nx) visit(index + 1);
        if (z > 0) visit(index - nx);
        if (z + 1 < nz) visit(index + nx);
        if (y > 0) visit(index - plane);
        if (y + 1 < ny) visit(index + plane);
      }
      for (let i = 0; i < cTail; i++) {
        const index = componentQueue[i];
        mask[index] = 0;
        if (baseLevelMask) baseLevelMask[index] = 0;
        floatingVoxelsSkipped++;
      }
    }
    return { baseY, floatingComponentsSkipped, floatingVoxelsSkipped };
  }

  function countMarkedCells(mask) {
    if (!mask) return 0;
    let count = 0;
    for (let i = 0; i < mask.length; i++) count += mask[i] ? 1 : 0;
    return count;
  }
  function filterVoxelComponents(mask, nx, ny, nz, mainBodyOnly, minimumSpeckSize = 2) {
    const total = mask.length;
    const plane = nx * nz;
    const labels = new Int32Array(total);
    labels.fill(-1);
    const queue = new Int32Array(total);
    const sizes = [];
    let componentCount = 0;

    for (let seed = 0; seed < total; seed++) {
      if (!mask[seed] || labels[seed] >= 0) continue;
      let head = 0, tail = 0;
      labels[seed] = componentCount;
      queue[tail++] = seed;
      while (head < tail) {
        const index = queue[head++];
        const y = Math.floor(index / plane);
        const rem = index - y * plane;
        const z = Math.floor(rem / nx);
        const x = rem - z * nx;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= ny) continue;
          for (let dz = -1; dz <= 1; dz++) {
            const zz = z + dz;
            if (zz < 0 || zz >= nz) continue;
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy && !dz) continue;
              const xx = x + dx;
              if (xx < 0 || xx >= nx) continue;
              const next = xx + nx * (zz + nz * yy);
              if (!mask[next] || labels[next] >= 0) continue;
              labels[next] = componentCount;
              queue[tail++] = next;
            }
          }
        }
      }
      sizes.push(tail);
      componentCount++;
    }

    if (!componentCount) return { componentsFound: 0, componentsKept: 0, removedComponents: 0, removedVoxels: 0, largestComponent: 0 };
    let largestLabel = 0;
    for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[largestLabel]) largestLabel = i;
    let removedVoxels = 0;
    const keptLabels = new Uint8Array(componentCount);
    if (mainBodyOnly) {
      keptLabels[largestLabel] = 1;
    } else {
      for (let i = 0; i < componentCount; i++) if (sizes[i] >= minimumSpeckSize) keptLabels[i] = 1;
      keptLabels[largestLabel] = 1;
    }
    for (let i = 0; i < total; i++) {
      if (!mask[i]) continue;
      if (!keptLabels[labels[i]]) {
        mask[i] = 0;
        removedVoxels++;
      }
    }
    let componentsKept = 0;
    for (const kept of keptLabels) componentsKept += kept ? 1 : 0;
    return {
      componentsFound: componentCount,
      componentsKept,
      removedComponents: componentCount - componentsKept,
      removedVoxels,
      largestComponent: sizes[largestLabel]
    };
  }

  async function voxelizeMeshRobust(normalized, revision, repair) {
    const { nx, ny, nz, triangles } = normalized;
    const total = nx * ny * nz;
    const sampled = await rasterizeTriangleSurface(normalized, repair, revision);
    if (revision !== appState.modelRevision) throw new Error('Generation cancelled.');

    setProgress(38, repair.sealRadius ? `Sealing surface cracks by ${repair.sealRadius} voxel${repair.sealRadius === 1 ? '' : 's'}…` : 'Preparing surface enclosure tests…');
    const barrier = repair.sealRadius
      ? dilateMask(sampled.surface, nx, ny, nz, repair.sealRadius, true)
      : sampled.surface.slice();
    await yieldFrame();

    setProgress(43, 'Detecting the inside from three opposing directions…');
    const votes = new Uint8Array(total);
    addDirectionalSpanVotes(barrier, nx, ny, nz, votes);
    await yieldFrame();

    setProgress(49, 'Flood-filling the exterior around the repaired shell…');
    const outside = floodExterior(barrier, nx, ny, nz);
    const rawVolume = new Uint8Array(total);
    let floodVolumeCells = 0;
    let directionalVolumeCells = 0;
    for (let i = 0; i < total; i++) {
      const floodSolid = !outside[i];
      const directionalSolid = votes[i] >= 2;
      if (floodSolid) floodVolumeCells++;
      if (directionalSolid) directionalVolumeCells++;
      if (floodSolid || directionalSolid) rawVolume[i] = 1;
    }
    await yieldFrame();

    setProgress(53, 'Restoring the surface and smoothing one-voxel defects…');
    const restoreRadius = repair.sealRadius
      ? (repair.mode === 'generous' ? Math.max(0, repair.sealRadius - 1) : repair.sealRadius)
      : 0;
    let solid = restoreRadius ? erodeMask(rawVolume, nx, ny, nz, restoreRadius, true) : rawVolume;
    for (let i = 0; i < total; i++) if (sampled.surface[i]) solid[i] = 1;

    if (repair.mode === 'generous') {
      const nearBody = dilateMask(solid, nx, ny, nz, 1, false);
      for (let i = 0; i < total; i++) if (!solid[i] && nearBody[i] && votes[i] >= 1) solid[i] = 1;
      solid = additiveCloseMask(solid, nx, ny, nz, true);
    } else if (repair.sealRadius > 0) {
      solid = additiveCloseMask(solid, nx, ny, nz, false);
    }

    const sliceHolesFilled = fillSmallSliceHoles(solid, nx, ny, nz, repair.mode === 'generous' ? 24 : 6);
    const baseTrimLayers = flattenBottomMask(solid, nx, ny, nz, repair.flattenLayers);
    const components = filterVoxelComponents(solid, nx, ny, nz, repair.mainBodyOnly, repair.mode === 'generous' ? 3 : 2);
    const leveling = addBottomLeveling(solid, nx, ny, nz, repair.flattenLayers);
    const baseConnectivity = retainBaseConnectedVoxels(solid, nx, ny, nz, leveling.baseLevelMask);
    const baseLevelingStuds = countMarkedCells(leveling.baseLevelMask);
    const filled = countOccupiedCells(solid);
    if (!filled) throw new Error('The repair pass removed every voxel. Turn off “Keep the main connected body” or reduce gap repair settings.');

    let voxelColors = null;
    if (sampled.surfaceColorSums && colorMode.value === 'model') {
      voxelColors = await propagateSurfaceColors(solid, nx, ny, nz, sampled.surfaceColorSums, sampled.surfaceColorWeights, revision, 57);
    }
    const diagnostics = {
      mode: repair.mode,
      sealRadiusVoxels: repair.sealRadius,
      surfaceVoxels: sampled.surfaceVoxels,
      sampledSurfacePoints: sampled.sampledPoints,
      coloredSurfaceVoxels: sampled.coloredSurfaceVoxels || 0,
      surfaceSampleSpacing: Number(sampled.spacing.toFixed(3)),
      degenerateTrianglesIgnored: sampled.degenerateTriangles,
      floodCandidateVoxels: floodVolumeCells,
      directionalCandidateVoxels: directionalVolumeCells,
      sliceHolesFilled,
      baseTrimLayers,
      baseLevelingStuds,
      mainBodyOnly: repair.mainBodyOnly,
      modelColorSource: voxelColors ? normalized.colorInfo?.source || 'model' : 'random',
      ...components,
      ...baseConnectivity,
      finalSolidVoxels: filled,
      finalModelVoxels: filled - baseLevelingStuds
    };
    setProgress(59, `Solid recovered: ${fmt.format(filled - baseLevelingStuds)} model studs${baseLevelingStuds ? ` plus ${fmt.format(baseLevelingStuds)} bottom-leveling studs` : ''}.`);
    return cropGrid({
      occupied: solid,
      baseLevelMask: leveling.baseLevelMask,
      voxelColors,
      nx, ny, nz,
      filled,
      modelFilled: filled - baseLevelingStuds,
      oddRows: 0,
      repair: diagnostics
    }, triangles);
  }

  function postProcessExactGrid(grid, repair) {
    const occupied = grid.occupied.slice();
    const baseTrimLayers = flattenBottomMask(occupied, grid.nx, grid.ny, grid.nz, repair.flattenLayers);
    const components = filterVoxelComponents(occupied, grid.nx, grid.ny, grid.nz, repair.mainBodyOnly, 2);
    const leveling = addBottomLeveling(occupied, grid.nx, grid.ny, grid.nz, repair.flattenLayers);
    const baseConnectivity = retainBaseConnectedVoxels(occupied, grid.nx, grid.ny, grid.nz, leveling.baseLevelMask);
    const baseLevelingStuds = countMarkedCells(leveling.baseLevelMask);
    const filled = countOccupiedCells(occupied);
    if (!filled) throw new Error('No solid volume remained after component cleanup.');
    const diagnostics = {
      mode: 'exact',
      sealRadiusVoxels: 0,
      surfaceVoxels: null,
      sampledSurfacePoints: null,
      coloredSurfaceVoxels: 0,
      surfaceSampleSpacing: null,
      degenerateTrianglesIgnored: null,
      floodCandidateVoxels: null,
      directionalCandidateVoxels: null,
      sliceHolesFilled: 0,
      baseTrimLayers,
      baseLevelingStuds,
      mainBodyOnly: repair.mainBodyOnly,
      modelColorSource: 'random',
      ...components,
      ...baseConnectivity,
      finalSolidVoxels: filled,
      finalModelVoxels: filled - baseLevelingStuds,
      oddScanRows: grid.oddRows || 0
    };
    return cropGrid({
      occupied,
      baseLevelMask: leveling.baseLevelMask,
      nx: grid.nx,
      ny: grid.ny,
      nz: grid.nz,
      filled,
      modelFilled: filled - baseLevelingStuds,
      oddRows: grid.oddRows || 0,
      repair: diagnostics
    }, grid.shiftedTriangles);
  }

  async function voxelizeMesh(normalized, revision, repair) {
    if (repair.mode === 'exact') {
      const exact = await voxelizeMeshExact(normalized, revision);
      const processed = postProcessExactGrid(exact, repair);
      if (normalized.colors && colorMode.value === 'model') {
        const sampled = await rasterizeTriangleSurface({
          triangles: processed.shiftedTriangles,
          colors: normalized.colors,
          textureData: normalized.textureData,
          nx: processed.nx,
          ny: processed.ny,
          nz: processed.nz
        }, { mode: 'robust' }, revision, {
          analysisProgress: 55,
          progressStart: 57,
          progressEnd: 59,
          analysisLabel: 'Analyzing GLB color samples…',
          rasterLabel: 'Sampling model colors onto the exact solid…'
        });
        processed.voxelColors = await propagateSurfaceColors(processed.occupied, processed.nx, processed.ny, processed.nz, sampled.surfaceColorSums, sampled.surfaceColorWeights, revision, 60);
        if (processed.voxelColors) {
          processed.repair.coloredSurfaceVoxels = sampled.coloredSurfaceVoxels || 0;
          processed.repair.modelColorSource = normalized.colorInfo?.source || 'model';
        }
      }
      return processed;
    }
    return voxelizeMeshRobust(normalized, revision, repair);
  }

  function cropGrid(grid, triangles) {
    const { occupied, nx, ny, nz } = grid;
    let minX = nx, minY = ny, minZ = nz, maxX = -1, maxY = -1, maxZ = -1;
    for (let y = 0; y < ny; y++) {
      for (let z = 0; z < nz; z++) {
        const base = nx * (z + nz * y);
        for (let x = 0; x < nx; x++) {
          if (!occupied[base + x]) continue;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
        }
      }
    }
    if (maxX < 0) throw new Error('No occupied voxels remained after mesh repair.');
    const cx = maxX - minX + 1, cy = maxY - minY + 1, cz = maxZ - minZ + 1;
    const out = new Uint8Array(cx * cy * cz);
    const outBaseLevel = grid.baseLevelMask ? new Uint8Array(cx * cy * cz) : null;
    const outColors = grid.voxelColors ? new Float32Array(cx * cy * cz * 3) : null;
    let filled = 0;
    let baseLevelingStuds = 0;
    for (let y = minY; y <= maxY; y++) {
      for (let z = minZ; z <= maxZ; z++) {
        for (let x = minX; x <= maxX; x++) {
          const oldIndex = x + nx * (z + nz * y);
          if (!occupied[oldIndex]) continue;
          const newIndex = (x - minX) + cx * ((z - minZ) + cz * (y - minY));
          out[newIndex] = 1;
          if (outBaseLevel && grid.baseLevelMask[oldIndex]) {
            outBaseLevel[newIndex] = 1;
            baseLevelingStuds++;
          }
          if (outColors) {
            outColors[newIndex * 3] = grid.voxelColors[oldIndex * 3];
            outColors[newIndex * 3 + 1] = grid.voxelColors[oldIndex * 3 + 1];
            outColors[newIndex * 3 + 2] = grid.voxelColors[oldIndex * 3 + 2];
          }
          filled++;
        }
      }
    }
    const shiftedTriangles = new Float32Array(triangles.length);
    for (let i = 0; i < triangles.length; i += 3) {
      shiftedTriangles[i] = triangles[i] - minX;
      shiftedTriangles[i + 1] = triangles[i + 1] - minY;
      shiftedTriangles[i + 2] = triangles[i + 2] - minZ;
    }
    const modelFilled = filled - baseLevelingStuds;
    const repair = grid.repair ? {
      ...grid.repair,
      baseLevelingStuds,
      finalSolidVoxels: filled,
      finalModelVoxels: modelFilled,
      cropOffsetVoxels: { x: minX, y: minY, z: minZ }
    } : null;
    return {
      occupied: out,
      baseLevelMask: outBaseLevel,
      voxelColors: outColors,
      nx: cx, ny: cy, nz: cz,
      filled,
      modelFilled,
      shiftedTriangles,
      oddRows: grid.oddRows || 0,
      repair,
      skippedPackingStuds: grid.skippedPackingStuds || 0,
      skippedFloatingStuds: grid.skippedFloatingStuds || 0,
      skippedFloatingBricks: grid.skippedFloatingBricks || 0
    };
  }

  function hash32(a, b = 0, c = 0, d = 0) {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647 + d * 1274126177) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return (h ^ (h >>> 16)) >>> 0;
  }

  function brickPaletteColor(layer, x, z, w, d) {
    const index = hash32(layer + 17, x + 31, z + 47, w * 11 + d) % PALETTE.length;
    return PALETTE[index].slice();
  }

  function brickPlacementColor(grid, layer, x, z, w, d) {
    if (colorMode.value === 'model' && grid?.voxelColors) {
      const plane = grid.nx * grid.nz;
      const offset = layer * plane;
      let r = 0, g = 0, b = 0, count = 0;
      for (let dz = 0; dz < d; dz++) {
        for (let dx = 0; dx < w; dx++) {
          const index = offset + (x + dx) + grid.nx * (z + dz);
          if (!grid.occupied[index]) continue;
          r += grid.voxelColors[index * 3];
          g += grid.voxelColors[index * 3 + 1];
          b += grid.voxelColors[index * 3 + 2];
          count++;
        }
      }
      if (count) return [Math.max(0, Math.min(1, r / count)), Math.max(0, Math.min(1, g / count)), Math.max(0, Math.min(1, b / count)), 1];
    }
    return brickPaletteColor(layer, x, z, w, d);
  }

  function createUsageMap() {
    return new Map(PART_DEFS.map(part => [part.key, 0]));
  }

  function canConsumePart(inventory, usage, key, count = 1) {
    const part = inventory.get(key);
    if (!part || !part.enabled || count < 0) return false;
    return (usage.get(key) || 0) + count <= part.max;
  }

  function consumePart(inventory, usage, key, count = 1) {
    if (!canConsumePart(inventory, usage, key, count)) {
      const part = inventory.get(key);
      const limit = part && Number.isFinite(part.max) ? ` (maximum ${part.max})` : '';
      throw new Error(`Not enough ${partLabel(key)} bricks${limit}. Raise its maximum or enable another small part.`);
    }
    usage.set(key, (usage.get(key) || 0) + count);
  }

  function requiredSupportStuds(area, mode) {
    if (area <= 1) return 1;
    if (mode === 'one') return 1;
    if (mode === 'strong') return Math.min(area, Math.max(2, Math.ceil(area / 3)));
    return area <= 2 ? 1 : 2;
  }

  function requiredSupportSpan(w, d, mode) {
    const area = w * d;
    const longSide = Math.max(w, d);
    if (area <= 2 || mode === 'one') return 0;
    if (mode === 'strong') return Math.min(longSide - 1, Math.max(1, Math.ceil(longSide * 0.6)));
    return Math.min(longSide - 1, Math.max(1, Math.ceil(longSide / 2)));
  }

  function supportSpan(points, w, d) {
    if (points.length < 2) return 0;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
      minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
    }
    if (w > d) return maxX - minX;
    if (d > w) return maxZ - minZ;
    return Math.max(maxX - minX, maxZ - minZ);
  }

  function candidateTypes(layerIndex, inventory) {
    const types = [];
    for (const def of PART_DEFS) {
      const setting = inventory.get(def.key);
      if (!setting?.enabled) continue;
      types.push({ key: def.key, w: def.w, d: def.d, setting });
      if (def.w !== def.d) types.push({ key: def.key, w: def.d, d: def.w, setting });
    }
    const preferX = (layerIndex & 1) === 0;
    types.sort((p, q) => {
      const preference = q.setting.preferenceBonus - p.setting.preferenceBonus;
      if (preference) return preference;
      const area = q.w * q.d - p.w * p.d;
      if (area) return area;
      const po = preferX ? p.w - p.d : p.d - p.w;
      const qo = preferX ? q.w - q.d : q.d - q.w;
      return qo - po;
    });
    return types;
  }

  function seedOrderForLayer(grid, layerIndex, belowOwner, belowComponentByBrick = null, belowConnectedByBrick = null) {
    const { occupied, nx, nz, ny } = grid;
    const plane = nx * nz;
    const offset = layerIndex * plane;
    const aboveOffset = layerIndex + 1 < ny ? offset + plane : -1;
    const parityOffset = layerIndex & 1;
    const order = [];
    let scan = 0;
    for (let zi = 0; zi < nz; zi++) {
      const z = parityOffset ? nz - 1 - zi : zi;
      for (let xi = 0; xi < nx; xi++) {
        const x = (xi + parityOffset * 2) % nx;
        const pi = x + nx * z;
        if (!occupied[offset + pi]) continue;
        let neighbours = 0;
        if (x > 0 && occupied[offset + pi - 1]) neighbours++;
        if (x + 1 < nx && occupied[offset + pi + 1]) neighbours++;
        if (z > 0 && occupied[offset + pi - nx]) neighbours++;
        if (z + 1 < nz && occupied[offset + pi + nx]) neighbours++;
        const belowId = belowOwner ? belowOwner[pi] : -1;
        const supported = layerIndex === 0 || belowId >= 0;
        const above = aboveOffset >= 0 && !!occupied[aboveOffset + pi];
        let componentSeams = 0;
        let baseBridgeSeams = 0;
        if (supported && belowId >= 0 && belowComponentByBrick) {
          const component = belowComponentByBrick[belowId];
          const connected = !!belowConnectedByBrick?.[belowId];
          const inspect = neighborPi => {
            const neighborId = belowOwner[neighborPi];
            if (neighborId < 0) return;
            const neighborComponent = belowComponentByBrick[neighborId];
            if (neighborComponent === component) return;
            componentSeams++;
            if (connected !== !!belowConnectedByBrick?.[neighborId]) baseBridgeSeams++;
          };
          if (x > 0) inspect(pi - 1);
          if (x + 1 < nx) inspect(pi + 1);
          if (z > 0) inspect(pi - nx);
          if (z + 1 < nz) inspect(pi + nx);
        }
        // Deal with cells that cannot stand on the previous layer before easy, fully-supported cells.
        // Then start at boundaries between provisional brick components so the new layer can bond them.
        const urgency = layerIndex === 0 ? 3 : !supported && !above ? 0 : !supported ? 1 : componentSeams ? 2 : 3;
        order.push({ pi, supported, above, urgency, componentSeams, baseBridgeSeams, neighbours, scan: scan++ });
      }
    }
    order.sort((a, b) => {
      if (a.urgency !== b.urgency) return a.urgency - b.urgency;
      if (a.baseBridgeSeams !== b.baseBridgeSeams) return b.baseBridgeSeams - a.baseBridgeSeams;
      if (a.componentSeams !== b.componentSeams) return b.componentSeams - a.componentSeams;
      if (a.neighbours !== b.neighbours) return a.neighbours - b.neighbours;
      return a.scan - b.scan;
    });
    return order.map(item => item.pi);
  }

  function packSingleLayer(grid, layerIndex, layers, inventory, usage, useStagger, supportMode) {
    const { occupied, nx, nz, ny } = grid;
    const plane = nx * nz;
    const offset = layerIndex * plane;
    const aboveOffset = layerIndex + 1 < ny ? offset + plane : -1;
    const belowLayer = layerIndex > 0 ? layers[layerIndex - 1] : null;
    const belowOwner = belowLayer?.owner || null;
    const owner = new Int32Array(plane);
    owner.fill(-1);
    const bricks = [];
    const types = candidateTypes(layerIndex, inventory);
    const parityOffset = layerIndex & 1;
    let priorConnectivity = null;
    let belowComponentByBrick = null;
    let belowConnectedByBrick = null;
    if (belowLayer?.bricks.length) {
      priorConnectivity = computeVerticalConnectivity(layers, grid);
      belowComponentByBrick = new Int32Array(belowLayer.bricks.length);
      belowConnectedByBrick = new Uint8Array(belowLayer.bricks.length);
      for (let i = 0; i < belowLayer.bricks.length; i++) {
        const global = priorConnectivity.globals[layerIndex - 1][i];
        belowComponentByBrick[i] = priorConnectivity.componentIds[global];
        belowConnectedByBrick[i] = priorConnectivity.connected[global];
      }
    }
    const order = seedOrderForLayer(grid, layerIndex, belowOwner, belowComponentByBrick, belowConnectedByBrick);
    let skippedStuds = 0;

    if (!types.length) throw new Error('No brick types are enabled. Set at least one inventory row to Plenty, Normal, Few, or Avoid.');

    let cursor = 0;
    while (true) {
      while (cursor < order.length && (!occupied[offset + order[cursor]] || owner[order[cursor]] !== -1)) cursor++;
      if (cursor >= order.length) break;
      const seed = order[cursor];
      const sx = seed % nx;
      const sz = Math.floor(seed / nx);
      let best = null;
      let hadGeometricFit = false;
      let hadConnectionFit = false;
      let blockedByPartLimit = false;
      let blockedByConnection = false;

      for (let ti = 0; ti < types.length; ti++) {
        const { key, w, d, setting } = types[ti];
        const minAX = Math.max(0, sx - w + 1);
        const maxAX = Math.min(sx, nx - w);
        const minAZ = Math.max(0, sz - d + 1);
        const maxAZ = Math.min(sz, nz - d);
        for (let az = minAZ; az <= maxAZ; az++) {
          for (let ax = minAX; ax <= maxAX; ax++) {
            let valid = true;
            let bridgedSeams = 0;
            let supportCount = 0;
            let upCount = 0;
            let baseLevelStuds = 0;
            const supportIds = new Set();
            const supportPoints = [];
            for (let dz = 0; dz < d && valid; dz++) {
              for (let dx = 0; dx < w; dx++) {
                const x = ax + dx;
                const z = az + dz;
                const pi = x + nx * z;
                if (!occupied[offset + pi] || owner[pi] !== -1) { valid = false; break; }
                const belowId = belowOwner ? belowOwner[pi] : -1;
                if (belowId >= 0) {
                  supportCount++;
                  supportIds.add(belowId);
                  supportPoints.push({ x, z });
                }
                if (aboveOffset >= 0 && occupied[aboveOffset + pi]) upCount++;
                if (grid.baseLevelMask?.[offset + pi]) baseLevelStuds++;
                if (belowOwner && useStagger) {
                  if (dx + 1 < w) {
                    const right = belowOwner[pi + 1];
                    if (belowId >= 0 && right >= 0 && belowId !== right) bridgedSeams++;
                  }
                  if (dz + 1 < d) {
                    const down = belowOwner[pi + nx];
                    if (belowId >= 0 && down >= 0 && belowId !== down) bridgedSeams++;
                  }
                }
              }
            }
            if (!valid) continue;
            hadGeometricFit = true;

            if (layerIndex > 0 && supportCount === 0 && upCount === 0) {
              blockedByConnection = true;
              continue;
            }
            hadConnectionFit = true;
            if (!canConsumePart(inventory, usage, key, 1)) {
              blockedByPartLimit = true;
              continue;
            }

            let sideContacts = 0;
            const sideIds = new Set();
            const checkSide = pi => {
              const id = owner[pi];
              if (id >= 0) { sideContacts++; sideIds.add(id); }
            };
            for (let dx = 0; dx < w; dx++) {
              if (az > 0) checkSide((ax + dx) + nx * (az - 1));
              if (az + d < nz) checkSide((ax + dx) + nx * (az + d));
            }
            for (let dz = 0; dz < d; dz++) {
              if (ax > 0) checkSide((ax - 1) + nx * (az + dz));
              if (ax + w < nx) checkSide((ax + w) + nx * (az + dz));
            }

            const area = w * d;
            const required = layerIndex === 0 ? 0 : requiredSupportStuds(area, supportMode);
            const requiredSpan = layerIndex === 0 ? 0 : requiredSupportSpan(w, d, supportMode);
            const existingSpan = layerIndex === 0 ? Math.max(w, d) - 1 : supportSpan(supportPoints, w, d);
            let exactAlignment = false;
            if (belowLayer && supportIds.size === 1) {
              const belowBrick = belowLayer.bricks[[...supportIds][0]];
              exactAlignment = !!belowBrick && belowBrick.x === ax && belowBrick.z === az && belowBrick.w === w && belowBrick.d === d;
            }
            const supportComponents = new Set();
            let touchesBaseComponent = false;
            let touchesLooseComponent = false;
            if (priorConnectivity && supportIds.size) {
              for (const belowId of supportIds) {
                const global = priorConnectivity.globals[layerIndex - 1][belowId];
                supportComponents.add(priorConnectivity.componentIds[global]);
                if (priorConnectivity.connected[global]) touchesBaseComponent = true;
                else touchesLooseComponent = true;
              }
            }
            const componentMergeGain = Math.max(0, supportComponents.size - 1);
            const bridgesLooseToBase = touchesBaseComponent && touchesLooseComponent;

            let score = area * 24 + setting.preferenceBonus;
            const preferred = (layerIndex & 1) === 0 ? w >= d : d >= w;
            score += preferred ? 7 : 0;
            score += ((ax + az + parityOffset) & 1) ? 1.8 : 0;
            score += Math.min(8, supportCount) * 12;
            score += Math.min(6, upCount) * 5;
            score += Math.min(6, sideContacts) * 2.5;
            score += Math.min(4, supportIds.size) * 10;
            score += Math.min(4, sideIds.size) * 1.5;
            score += bridgedSeams * 12;
            // The most valuable upper-layer brick is one that crosses a seam between two
            // provisional vertical components. This creates a real stud bond, including
            // from an overhanging component back into the base-connected body.
            score += componentMergeGain * 260;
            if (bridgesLooseToBase) score += 520;
            else if (componentMergeGain) score += 90;
            if (touchesBaseComponent) score += 18;
            if (supportCount > 0 && supportCount < area) score += Math.min(5, area - supportCount) * 3.5;
            if (supportCount >= required && existingSpan >= requiredSpan) score += 24;
            else if (upCount > 0) score += 8;
            if (useStagger && exactAlignment) score -= 62;
            if (useStagger && supportIds.size === 1 && area >= 4) score -= 15;
            if (supportCount === 0) score -= supportMode === 'strong' ? 18 : supportMode === 'robust' ? 10 : 3;
            if (Number.isFinite(setting.max) && setting.max > 0) {
              const remaining = setting.max - (usage.get(key) || 0);
              score -= 24 * (1 - remaining / setting.max);
            }
            score += (hash32(layerIndex, ax, az, ti) % 1000) / 100000;
            if (!best || score > best.score) {
              best = { ax, az, w, d, key, score, required, requiredSpan, supportCount, upCount, sideContacts, baseLevelStuds, componentMergeGain, bridgesLooseToBase };
            }
          }
        }
      }

      if (!best) {
        const where = `layer ${layerIndex + 1} near stud (${sx + 1}, ${sz + 1})`;
        if (blockedByPartLimit || (hadConnectionFit && hadGeometricFit)) {
          throw new Error(`Inventory limits leave no usable brick for ${where}. Raise a maximum or mark another fitting size as available.`);
        }
        if (blockedByConnection && hadGeometricFit) {
          occupied[offset + seed] = 0;
          if (grid.baseLevelMask) grid.baseLevelMask[offset + seed] = 0;
          skippedStuds++;
          grid.skippedPackingStuds = (grid.skippedPackingStuds || 0) + 1;
          cursor++;
          continue;
        }
        throw new Error(`No enabled brick can tile ${where}. Enable 1×1 or another small brick size.`);
      }

      consumePart(inventory, usage, best.key, 1);
      const id = bricks.length;
      const supportIds = new Set();
      const supportPoints = [];
      let actualSupport = layerIndex === 0 ? best.w * best.d : 0;
      let actualUp = 0;
      let baseLevelStuds = 0;
      for (let dz = 0; dz < best.d; dz++) {
        for (let dx = 0; dx < best.w; dx++) {
          const pi = (best.ax + dx) + nx * (best.az + dz);
          owner[pi] = id;
          if (belowOwner && belowOwner[pi] >= 0) {
            actualSupport++;
            supportPoints.push({ x: best.ax + dx, z: best.az + dz });
            supportIds.add(belowOwner[pi]);
          }
          if (aboveOffset >= 0 && occupied[aboveOffset + pi]) actualUp++;
          if (grid.baseLevelMask?.[offset + pi]) baseLevelStuds++;
        }
      }
      const area = best.w * best.d;
      bricks.push({
        id,
        placement: id + 1,
        layer: layerIndex,
        x: best.ax,
        z: best.az,
        w: best.w,
        d: best.d,
        inventoryKey: best.key,
        baseLeveling: baseLevelStuds > 0,
        baseLevelStuds,
        modelStuds: area - baseLevelStuds,
        supportStuds: actualSupport,
        requiredSupportStuds: best.required,
        supportSpan: layerIndex === 0 ? Math.max(best.w, best.d) - 1 : supportSpan(supportPoints, best.w, best.d),
        requiredSupportSpan: best.requiredSpan,
        supportBrickIds: [...supportIds].map(value => value + 1),
        upwardStudsPotential: actualUp,
        provisionalComponentsMerged: best.componentMergeGain || 0,
        provisionalLooseComponentBondedToBase: !!best.bridgesLooseToBase,
        overhangStuds: layerIndex === 0 ? 0 : area - actualSupport,
        color: brickPlacementColor(grid, layerIndex, best.ax, best.az, best.w, best.d)
      });
    }

    return { index: layerIndex, bricks, owner, skippedStuds };
  }

  function rebuildLayerOwner(layer, nx, nz) {
    const owner = new Int32Array(nx * nz);
    owner.fill(-1);
    for (let i = 0; i < layer.bricks.length; i++) {
      const brick = layer.bricks[i];
      brick.id = i;
      brick.placement = i + 1;
      brick.layer = layer.index;
      for (let dz = 0; dz < brick.d; dz++) {
        for (let dx = 0; dx < brick.w; dx++) {
          const pi = (brick.x + dx) + nx * (brick.z + dz);
          if (owner[pi] >= 0) throw new Error(`Internal overlap while rebuilding layer ${layer.index + 1}.`);
          owner[pi] = i;
        }
      }
    }
    layer.owner = owner;
  }

  function recountGridOccupancy(grid) {
    let filled = 0;
    let baseLevelingStuds = 0;
    for (let i = 0; i < grid.occupied.length; i++) {
      if (!grid.occupied[i]) continue;
      filled++;
      if (grid.baseLevelMask?.[i]) baseLevelingStuds++;
    }
    grid.filled = filled;
    grid.modelFilled = filled - baseLevelingStuds;
    if (grid.repair) {
      grid.repair.baseLevelingStuds = baseLevelingStuds;
      grid.repair.finalSolidVoxels = filled;
      grid.repair.finalModelVoxels = grid.modelFilled;
    }
    return { filled, baseLevelingStuds };
  }

  function computeVerticalConnectivity(layers, grid) {
    let total = 0;
    const globals = layers.map(layer => {
      const map = new Int32Array(layer.bricks.length);
      for (let i = 0; i < layer.bricks.length; i++) {
        map[i] = total;
        layer.bricks[i].globalIndex = total++;
      }
      return map;
    });
    const baseRoot = total;
    const parent = new Int32Array(total + 1);
    const rank = new Uint8Array(total + 1);
    for (let i = 0; i <= total; i++) parent[i] = i;
    const find = value => {
      let root = value;
      while (parent[root] !== root) root = parent[root];
      while (parent[value] !== value) {
        const next = parent[value];
        parent[value] = root;
        value = next;
      }
      return root;
    };
    const union = (a, b) => {
      let ra = find(a), rb = find(b);
      if (ra === rb) return;
      if (rank[ra] < rank[rb]) [ra, rb] = [rb, ra];
      parent[rb] = ra;
      if (rank[ra] === rank[rb]) rank[ra]++;
    };
    if (layers[0]) for (let i = 0; i < layers[0].bricks.length; i++) union(globals[0][i], baseRoot);
    const plane = grid.nx * grid.nz;
    for (let y = 1; y < layers.length; y++) {
      const current = layers[y].owner;
      const below = layers[y - 1].owner;
      for (let pi = 0; pi < plane; pi++) {
        const a = current[pi], b = below[pi];
        if (a >= 0 && b >= 0) union(globals[y][a], globals[y - 1][b]);
      }
    }
    const baseComponent = find(baseRoot);
    const connected = new Uint8Array(total);
    const componentIds = new Int32Array(total);
    let connectedCount = 0;
    for (let i = 0; i < total; i++) {
      const component = find(i);
      componentIds[i] = component;
      if (component === baseComponent) {
        connected[i] = 1;
        connectedCount++;
      }
    }
    for (let y = 0; y < layers.length; y++) {
      for (let i = 0; i < layers[y].bricks.length; i++) {
        const global = globals[y][i];
        layers[y].bricks[i].verticalComponent = componentIds[global];
        layers[y].bricks[i].provisionallyConnectedToBase = !!connected[global];
      }
    }
    return { globals, connected, componentIds, baseComponent, connectedCount, total, allConnected: connectedCount === total };
  }

  function pruneDisconnectedBricks(grid, layers) {
    const connectivity = computeVerticalConnectivity(layers, grid);
    if (connectivity.allConnected) return { connectivity, removedBricks: 0, removedStuds: 0, removedModelStuds: 0 };
    const plane = grid.nx * grid.nz;
    let removedBricks = 0;
    let removedStuds = 0;
    let removedModelStuds = 0;
    for (let y = 0; y < layers.length; y++) {
      const kept = [];
      for (const brick of layers[y].bricks) {
        if (connectivity.connected[brick.globalIndex]) {
          kept.push(brick);
          continue;
        }
        removedBricks++;
        for (let dz = 0; dz < brick.d; dz++) {
          for (let dx = 0; dx < brick.w; dx++) {
            const index = y * plane + (brick.x + dx) + grid.nx * (brick.z + dz);
            if (!grid.occupied[index]) continue;
            const baseLevel = !!grid.baseLevelMask?.[index];
            grid.occupied[index] = 0;
            if (grid.baseLevelMask) grid.baseLevelMask[index] = 0;
            removedStuds++;
            if (!baseLevel) removedModelStuds++;
          }
        }
      }
      layers[y].bricks = kept;
      rebuildLayerOwner(layers[y], grid.nx, grid.nz);
    }
    grid.skippedFloatingBricks = (grid.skippedFloatingBricks || 0) + removedBricks;
    grid.skippedFloatingStuds = (grid.skippedFloatingStuds || 0) + removedStuds;
    if (grid.repair) {
      grid.repair.packedFloatingBricksSkipped = grid.skippedFloatingBricks;
      grid.repair.packedFloatingStudsSkipped = grid.skippedFloatingStuds;
    }
    recountGridOccupancy(grid);
    const after = computeVerticalConnectivity(layers, grid);
    return { connectivity: after, removedBricks, removedStuds, removedModelStuds };
  }

  function trimEmptyTopLayers(grid, layers) {
    let last = layers.length - 1;
    while (last > 0 && layers[last].bricks.length === 0) last--;
    const newCount = last + 1;
    if (newCount === layers.length) return 0;
    const removed = layers.length - newCount;
    layers.splice(newCount);
    const plane = grid.nx * grid.nz;
    grid.ny = newCount;
    grid.occupied = grid.occupied.slice(0, plane * newCount);
    if (grid.baseLevelMask) grid.baseLevelMask = grid.baseLevelMask.slice(0, plane * newCount);
    if (grid.voxelColors) grid.voxelColors = grid.voxelColors.slice(0, plane * newCount * 3);
    recountGridOccupancy(grid);
    if (grid.repair) grid.repair.emptyTopLayersRemoved = removed;
    return removed;
  }

  function finalizePackedLayers(grid, layers, inventory, supportMode, connectivity, pruneInfo) {
    const plane = grid.nx * grid.nz;
    const allBricks = [];
    const actualUsage = createUsageMap();
    let baseLevelingBricks = 0;
    let baseLevelingStuds = 0;
    let coveredModelStuds = 0;
    let coveredSolidStuds = 0;
    let disconnectedBricks = 0;
    let lightlyLockedBricks = 0;
    let lockedFromAboveBricks = 0;

    for (let y = 0; y < layers.length; y++) {
      const layer = layers[y];
      let layerStuds = 0;
      let layerModelStuds = 0;
      let layerBaseStuds = 0;
      let layerBaseBricks = 0;
      let layerLockedFromAbove = 0;
      let layerLightLocks = 0;
      for (let i = 0; i < layer.bricks.length; i++) {
        const brick = layer.bricks[i];
        brick.id = i;
        brick.placement = i + 1;
        brick.layer = y;
        brick.inventoryKey = brick.inventoryKey || canonicalBrickKey(brick.w, brick.d);
        actualUsage.set(brick.inventoryKey, (actualUsage.get(brick.inventoryKey) || 0) + 1);
        const area = brick.w * brick.d;
        let modelStuds = 0;
        let baseStuds = 0;
        let belowStuds = y === 0 ? area : 0;
        let aboveStuds = 0;
        const belowIds = new Set();
        const aboveIds = new Set();
        const belowPoints = [];
        const abovePoints = [];
        const sideIds = new Set();
        let sideContactStuds = 0;
        for (let dz = 0; dz < brick.d; dz++) {
          for (let dx = 0; dx < brick.w; dx++) {
            const x = brick.x + dx;
            const z = brick.z + dz;
            const pi = x + grid.nx * z;
            const cellIndex = y * plane + pi;
            if (grid.baseLevelMask?.[cellIndex]) baseStuds++;
            else if (grid.occupied[cellIndex]) modelStuds++;
            if (y > 0) {
              const belowId = layers[y - 1].owner[pi];
              if (belowId >= 0) {
                belowStuds++;
                belowPoints.push({ x, z });
                belowIds.add(belowId);
              }
            }
            if (y + 1 < layers.length) {
              const aboveId = layers[y + 1].owner[pi];
              if (aboveId >= 0) {
                aboveStuds++;
                abovePoints.push({ x, z });
                aboveIds.add(aboveId);
              }
            }
            const checkSide = neighbourPi => {
              const neighbour = layer.owner[neighbourPi];
              if (neighbour >= 0 && neighbour !== i) {
                sideContactStuds++;
                sideIds.add(neighbour);
              }
            };
            if (dx === 0 && x > 0) checkSide(pi - 1);
            if (dx === brick.w - 1 && x + 1 < grid.nx) checkSide(pi + 1);
            if (dz === 0 && z > 0) checkSide(pi - grid.nx);
            if (dz === brick.d - 1 && z + 1 < grid.nz) checkSide(pi + grid.nx);
          }
        }
        const required = y === 0 ? 0 : requiredSupportStuds(area, supportMode);
        const requiredSpan = y === 0 ? 0 : requiredSupportSpan(brick.w, brick.d, supportMode);
        const belowSpan = y === 0 ? Math.max(brick.w, brick.d) - 1 : supportSpan(belowPoints, brick.w, brick.d);
        const aboveSpan = supportSpan(abovePoints, brick.w, brick.d);
        const bestStudLock = Math.max(belowStuds, aboveStuds);
        const bestSpan = belowStuds >= aboveStuds ? belowSpan : aboveSpan;
        const connectedToBase = y === 0 || !!connectivity.connected[brick.globalIndex];
        const meetsPreference = y === 0 || (bestStudLock >= required && bestSpan >= requiredSpan);
        const lockedFromAbove = y > 0 && belowStuds === 0 && aboveStuds > 0;
        brick.modelStuds = modelStuds;
        brick.baseLevelStuds = baseStuds;
        brick.baseLeveling = baseStuds > 0;
        brick.supportStuds = belowStuds;
        brick.lockingStudsAbove = aboveStuds;
        brick.requiredSupportStuds = required;
        brick.supportSpan = belowSpan;
        brick.lockSpanAbove = aboveSpan;
        brick.requiredSupportSpan = requiredSpan;
        brick.supportBrickIds = [...belowIds].map(value => value + 1);
        brick.lockBrickIdsAbove = [...aboveIds].map(value => value + 1);
        brick.sideContactBrickIds = [...sideIds].map(value => value + 1);
        brick.sideContactStuds = sideContactStuds;
        brick.overhangStuds = y === 0 ? 0 : area - belowStuds;
        brick.connectedToBase = connectedToBase;
        brick.meetsSupportRule = meetsPreference;
        brick.lockedFromAbove = lockedFromAbove;
        brick.connectionDirection = y === 0 ? 'baseplate' : belowStuds && aboveStuds ? 'below-and-above' : belowStuds ? 'below' : aboveStuds ? 'above' : 'none';
        if (!connectedToBase) disconnectedBricks++;
        if (!meetsPreference) { lightlyLockedBricks++; layerLightLocks++; }
        if (lockedFromAbove) { lockedFromAboveBricks++; layerLockedFromAbove++; }
        if (brick.baseLeveling) { baseLevelingBricks++; layerBaseBricks++; }
        layerStuds += area;
        layerModelStuds += modelStuds;
        layerBaseStuds += baseStuds;
        coveredSolidStuds += area;
        coveredModelStuds += modelStuds;
        baseLevelingStuds += baseStuds;
        allBricks.push(brick);
      }
      layer.studs = layerStuds;
      layer.modelStuds = layerModelStuds;
      layer.baseLevelStuds = layerBaseStuds;
      layer.baseLevelBricks = layerBaseBricks;
      layer.lockedFromAboveBricks = layerLockedFromAbove;
      layer.lightlyLockedBricks = layerLightLocks;
      layer.connectedBricks = layer.bricks.length - layer.bricks.filter(brick => !brick.connectedToBase).length;
    }

    for (const part of PART_DEFS) {
      const setting = inventory.get(part.key);
      const used = actualUsage.get(part.key) || 0;
      if (setting && used > setting.max) throw new Error(`Internal inventory check failed for ${partLabel(part.key)}: used ${used}, maximum ${setting.max}.`);
    }
    if (coveredSolidStuds !== grid.filled) {
      throw new Error(`Internal coverage check failed: covered ${coveredSolidStuds} of ${grid.filled} retained studs.`);
    }
    if (coveredModelStuds !== grid.modelFilled || baseLevelingStuds !== grid.filled - grid.modelFilled) {
      throw new Error('Internal model/base-level coverage accounting failed.');
    }
    if (disconnectedBricks) throw new Error(`Connectivity validation failed: ${disconnectedBricks} floating bricks remain.`);

    return {
      allBricks,
      usage: actualUsage,
      validation: {
        allConnected: true,
        disconnectedBricks,
        lightlyLockedBricks,
        lockedFromAboveBricks,
        baseLevelingBricks,
        baseLevelingStuds,
        coveredModelStuds,
        coveredSolidStuds,
        skippedFloatingBricks: grid.skippedFloatingBricks || 0,
        skippedFloatingStuds: grid.skippedFloatingStuds || 0,
        skippedUnplaceableStuds: grid.skippedPackingStuds || 0,
        skippedVoxelComponents: grid.repair?.floatingComponentsSkipped || 0,
        skippedVoxelStuds: grid.repair?.floatingVoxelsSkipped || 0,
        removedDisconnectedBricksThisPass: pruneInfo.removedBricks || 0,
        totalBricks: allBricks.length
      }
    };
  }

  async function packBricks(grid, revision, inventory, supportMode) {
    const layers = [];
    const provisionalUsage = createUsageMap();
    grid.skippedPackingStuds = 0;
    grid.skippedFloatingStuds = 0;
    grid.skippedFloatingBricks = 0;
    setProgress(61, 'Arranging inventory-aware layers without internal support columns…');
    for (let y = 0; y < grid.ny; y++) {
      if (revision !== appState.modelRevision) throw new Error('Generation cancelled.');
      const packedLayer = packSingleLayer(grid, y, layers, inventory, provisionalUsage, stagger.checked, supportMode);
      layers.push(packedLayer);
      setProgress(61 + 31 * ((y + 1) / grid.ny), `Planning layer ${y + 1} of ${grid.ny}; overhangs may lock from above…`);
      await yieldFrame();
    }
    recountGridOccupancy(grid);
    if (!grid.filled) throw new Error('No buildable studs remained after unsupported details were skipped.');
    setProgress(94, 'Tracing actual stud overlaps upward and downward…');
    const pruneInfo = pruneDisconnectedBricks(grid, layers);
    trimEmptyTopLayers(grid, layers);
    if (!layers.some(layer => layer.bricks.length)) throw new Error('Every generated brick was floating; try a stronger bottom flattening setting or a fuller mesh repair mode.');
    const connectivity = computeVerticalConnectivity(layers, grid);
    if (!connectivity.allConnected) throw new Error('Some brick components still have no stud-overlap path to the baseplate.');
    if (grid.repair) {
      grid.repair.packingStudsSkipped = grid.skippedPackingStuds || 0;
      grid.repair.packedFloatingBricksSkipped = grid.skippedFloatingBricks || 0;
      grid.repair.packedFloatingStudsSkipped = grid.skippedFloatingStuds || 0;
      grid.repair.finalSolidVoxels = grid.filled;
      grid.repair.finalModelVoxels = grid.modelFilled;
    }
    setProgress(97, 'Checking connectivity, colors, and inventory limits…');
    const finalized = finalizePackedLayers(grid, layers, inventory, supportMode, connectivity, pruneInfo);
    return { layers, ...finalized };
  }

  generateBtn.addEventListener('click', async () => {
    if (appState.busy || !appState.source) return;
    appState.busy = true;
    generateBtn.disabled = true;
    demoBtn.disabled = true;
    clearBtn.disabled = true;
    exportBtn.disabled = true;
    resetResults();
    saveInventorySettings();
    const inventory = readInventoryConfig();
    const repair = readRepairConfig();
    const supportMode = supportStrength.value;
    appState.colorMode = colorMode.value;
    const revision = ++appState.modelRevision;

    try {
      if (![...inventory.values()].some(part => part.enabled)) throw new Error('No brick types are enabled in the inventory.');
      const sourceModel = await loadSourceModel();
      if (revision !== appState.modelRevision) return;
      const raw = sourceModel.triangles;
      const triCount = raw.length / 9;
      if (triCount > MAX_INPUT_TRIANGLES) throw new Error(`This model has more than ${fmt.format(MAX_INPUT_TRIANGLES)} triangles. Simplify it or export a lighter OBJ, STL, or GLB file first.`);
      if (repair.mode === 'exact' && triCount > MAX_EXACT_TRIANGLES) throw new Error(`Exact mode is limited to ${fmt.format(MAX_EXACT_TRIANGLES)} triangles. Use Robust mode for this dense mesh.`);
      setProgress(7, `Parsed ${fmt.format(triCount)} triangles${sourceModel.colorInfo?.source && sourceModel.colorInfo.source !== 'none' ? ' with model colors' : ''}.`);
      await yieldFrame();
      const oriented = orientModel(sourceModel, axisMode());
      const normalized = normalizeModel(oriented, Number(resolution.value));
      const potentialCells = normalized.nx * normalized.ny * normalized.nz;
      if (potentialCells > MAX_VOXEL_CELLS) {
        throw new Error(`The selected resolution creates more than ${fmt.format(MAX_VOXEL_CELLS)} cells. Lower the resolution.`);
      }
      setProgress(10, `Voxel grid ${normalized.nx} × ${normalized.nz} × ${normalized.ny}…`);
      const grid = await voxelizeMesh(normalized, revision, repair);
      const packed = await packBricks(grid, revision, inventory, supportMode);
      if (revision !== appState.modelRevision) return;

      appState.grid = grid;
      appState.layers = packed.layers;
      appState.allBricks = packed.allBricks;
      appState.inventoryUsage = Object.fromEntries(packed.usage);
      appState.inventoryConfig = Object.fromEntries([...inventory].map(([key, value]) => [key, {
        supply: value.supply,
        max: Number.isFinite(value.max) ? value.max : null
      }]));
      appState.repairConfig = { ...repair };
      appState.supportMode = supportMode;
      appState.validation = packed.validation;
      appState.modelColorInfo = sourceModel.colorInfo || { source: 'none', label: 'random palette' };
      appState.normalizedTriangles = grid.shiftedTriangles;
      appState.selectedLayer = 0;
      appState.displayMode = 'all';

      document.querySelectorAll('[data-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === 'all'));
      layerSlider.disabled = false;
      layerSlider.min = '1';
      layerSlider.max = String(appState.layers.length);
      layerSlider.value = '1';
      exportBtn.disabled = false;
      emptyState.classList.add('hidden');
      updateStats();
      updateInventoryUsage(packed.usage);
      updateLayerUI();
      renderer.setSculpture(appState.allBricks, grid, appState.normalizedTriangles);
      renderer.showWireframe = showWire.checked;
      renderer.resetCamera();
      updateVisibleBricks();
      setProgress(100, 'Sculpture complete and connectivity validated.');

      const baseCount = packed.validation.baseLevelingBricks || 0;
      const baseText = baseCount
        ? ` ${fmt.format(baseCount)} bottom-leveling brick${baseCount === 1 ? '' : 's'} fill only the lowest tilted area.`
        : ' No extra bottom-leveling bricks were needed.';
      const repairInfo = grid.repair;
      const skippedBricks = packed.validation.skippedFloatingBricks || 0;
      const skippedPackingStuds = (packed.validation.skippedFloatingStuds || 0) + (packed.validation.skippedUnplaceableStuds || 0);
      const skippedVoxelComponents = packed.validation.skippedVoxelComponents || 0;
      const skippedVoxelStuds = packed.validation.skippedVoxelStuds || 0;
      const skippedItems = [];
      if (skippedVoxelComponents) skippedItems.push(`${fmt.format(skippedVoxelComponents)} detached voxel component${skippedVoxelComponents === 1 ? '' : 's'} (${fmt.format(skippedVoxelStuds)} studs)`);
      if (skippedBricks) skippedItems.push(`${fmt.format(skippedBricks)} disconnected brick candidate${skippedBricks === 1 ? '' : 's'}`);
      if (skippedPackingStuds) skippedItems.push(`${fmt.format(skippedPackingStuds)} unplaceable stud${skippedPackingStuds === 1 ? '' : 's'}`);
      const skippedText = skippedItems.length
        ? ` Skipped rather than scaffolded: ${skippedItems.join('; ')}.`
        : ' No floating details had to be skipped.';
      const colorInfo = appState.modelColorInfo || {};
      const modelColorsActive = appState.colorMode === 'model' && colorInfo.source && colorInfo.source !== 'none';
      const colorText = modelColorsActive
        ? ` Brick colors were averaged from the ${colorInfo.label || 'GLB model colors'}.`
        : ' Brick colors use the random palette.';
      const textureWarningText = colorInfo.textureWarnings?.length
        ? ` ${fmt.format(colorInfo.textureWarnings.length)} embedded texture${colorInfo.textureWarnings.length === 1 ? '' : 's'} could not be decoded; affected material factors were used as a fallback.`
        : '';
      const repairName = repairInfo?.mode === 'generous' ? 'Generous' : 'Robust';
      const repairText = repairInfo?.mode === 'exact'
        ? ' Exact watertight scan-line filling was used.'
        : ` ${repairName} repair recovered ${fmt.format(grid.modelFilled)} model studs${repairInfo?.removedComponents ? ` and removed ${fmt.format(repairInfo.removedComponents)} detached fragment${repairInfo.removedComponents === 1 ? '' : 's'}` : ''}${repairInfo?.baseTrimLayers ? `; the bottom was trimmed by ${repairInfo.baseTrimLayers} layer${repairInfo.baseTrimLayers === 1 ? '' : 's'}` : ''}.`;
      setStatus(`Generated ${fmt.format(appState.allBricks.length)} bricks across ${appState.layers.length} layers.${baseText}${skippedText}${repairText}${colorText}${textureWarningText} Every retained brick has a real stud-overlap path to the baseplate.`, 'success');
      setTimeout(hideProgress, 700);

      if (repairInfo?.mode === 'exact' && grid.oddRows > Math.max(10, grid.ny * grid.nz * 0.04)) {
        showToast('Many exact scan rows were open. Robust mode is better for this mesh.');
      } else if (colorInfo.textureWarnings?.length) {
        showToast('One or more embedded textures could not be decoded; see the exported color diagnostics.');
      } else if (skippedBricks || skippedPackingStuds || skippedVoxelComponents || skippedVoxelStuds) {
        showToast('Floating or unplaceable details were skipped instead of adding internal supports.');
      } else if (repairInfo?.mode === 'robust' && repairInfo.surfaceVoxels && grid.modelFilled / repairInfo.surfaceVoxels < 1.9) {
        showToast('The recovered body is still shell-heavy. Try Generous repair with 2-voxel sealing.');
      } else if (repairInfo?.removedVoxels > Math.max(8, grid.modelFilled * 0.03)) {
        showToast('Detached shell fragments were removed; uncheck “Keep the main connected body” to preserve them.');
      } else if (appState.colorMode === 'model' && (!colorInfo.source || colorInfo.source === 'none')) {
        showToast('This model has no usable embedded colors, so the random palette was used.');
      }
    } catch (error) {
      console.error(error);
      if (String(error?.message || '').includes('cancelled')) return;
      setStatus(error?.message || 'Could not generate the sculpture.', 'error');
      hideProgress();
    } finally {
      appState.busy = false;
      generateBtn.disabled = !appState.source;
      demoBtn.disabled = false;
      clearBtn.disabled = !appState.source;
    }
  });

  function updateStats() {
    const g = appState.grid;
    if (!g) return;
    el('statGrid').textContent = `${g.nx}×${g.nz}`;
    el('statLayers').textContent = fmt.format(g.ny);
    el('statVoxels').textContent = fmt.format(g.modelFilled ?? g.filled);
    el('statBricks').textContent = fmt.format(appState.allBricks.length);
    el('statSupports').textContent = fmt.format(appState.validation?.baseLevelingBricks || 0);
    el('statConnected').textContent = appState.validation?.allConnected ? '100%' : '—';
  }

  function currentLayer() {
    return appState.layers[appState.selectedLayer] || null;
  }

  function canonicalBrickName(brick) {
    return partLabel(canonicalBrickKey(brick.w, brick.d));
  }

  function updateLayerUI() {
    const layer = currentLayer();
    const total = appState.layers.length;
    if (!layer) return;
    layerReadout.textContent = `Layer ${layer.index + 1} / ${total}`;
    el('instructionTitle').textContent = `Layer ${layer.index + 1} of ${total}`;
    const baseBricks = layer.baseLevelBricks || 0;
    const lockedAbove = layer.lockedFromAboveBricks || 0;
    const baseText = baseBricks
      ? ` · ${baseBricks} bottom-leveling brick${baseBricks === 1 ? '' : 's'}`
      : '';
    const aboveText = lockedAbove
      ? ` · ${lockedAbove} lock${lockedAbove === 1 ? 's' : ''} from layer ${Math.min(total, layer.index + 2)}`
      : '';
    const connectionText = layer.index === 0 ? 'baseplate layer' : lockedAbove ? 'some pieces attach with the next layer' : 'all pieces overlap the layer below';
    el('instructionSummary').textContent = `${layer.bricks.length} bricks · ${layer.modelStuds} model studs${baseText}${aboveText} · ${connectionText}`;
    el('layerBrickCount').textContent = fmt.format(layer.bricks.length);
    el('layerStudCount').textContent = fmt.format(layer.studs);
    el('layerSupportCount').textContent = fmt.format(baseBricks);

    const counts = new Map();
    for (const brick of layer.bricks) {
      const key = canonicalBrickName(brick);
      const entry = counts.get(key) || { count: 0, base: 0, above: 0, r: 0, g: 0, b: 0, colorCount: 0 };
      entry.count++;
      if (brick.baseLeveling) entry.base++;
      if (brick.lockedFromAbove) entry.above++;
      if (brick.color) {
        entry.r += brick.color[0] || 0;
        entry.g += brick.color[1] || 0;
        entry.b += brick.color[2] || 0;
        entry.colorCount++;
      }
      counts.set(key, entry);
    }
    el('layerTypeCount').textContent = counts.size;
    const entries = [...counts.entries()].sort((a, b) => {
      const [aw, ad] = a[0].split('×').map(Number);
      const [bw, bd] = b[0].split('×').map(Number);
      return bw * bd - aw * ad || b[0].localeCompare(a[0]);
    });
    el('partsList').innerHTML = entries.map(([name, info], index) => {
      const fallback = PALETTE[(appState.selectedLayer + index * 3) % PALETTE.length];
      const color = info.colorCount ? [info.r / info.colorCount, info.g / info.colorCount, info.b / info.colorCount] : fallback;
      const rgb = `rgb(${Math.round(color[0] * 255)},${Math.round(color[1] * 255)},${Math.round(color[2] * 255)})`;
      const notes = [];
      if (info.base) notes.push(`${info.base} bottom-leveling`);
      if (info.above) notes.push(`${info.above} lock from next layer`);
      const note = notes.length ? `<small>${notes.join(' · ')}</small>` : '';
      return `<div class="part-row"><div class="brick-icon" style="background:${rgb}"></div><div class="part-name">${name} brick${note}</div><div class="part-count">×${info.count}</div></div>`;
    }).join('') || '<div class="hint">This layer is empty.</div>';

    if (layer.index === 0) {
      el('layerNote').textContent = baseBricks
        ? 'Build on a baseplate. Orange dashed outlines mark bricks that exist only to level a tilted bottom; all other bricks belong to the recovered model volume.'
        : 'Build this base layer on a baseplate, following the numbered outlines.';
    } else if (lockedAbove) {
      el('layerNote').textContent = `Cyan dashed outlines mark ${lockedAbove} brick${lockedAbove === 1 ? '' : 's'} with no stud directly below. Attach those pieces to layer ${Math.min(total, layer.index + 2)} as a small subassembly, then lower that subassembly into place. They are retained only when that upper lock has a continuous stud-overlap path to the base.`;
    } else if (layer.lightlyLockedBricks) {
      el('layerNote').textContent = 'All bricks overlap the completed layer below. A few use fewer contact studs than the selected preference, but they remain connected and are reinforced by neighboring layers.';
    } else {
      el('layerNote').textContent = 'Every brick on this layer overlaps the completed layer below. Orientation and joint staggering are shown by the outlined rectangles.';
    }
    drawLayerPlan();
  }

  function setSelectedLayer(index) {
    if (!appState.layers.length) return;
    appState.selectedLayer = Math.max(0, Math.min(appState.layers.length - 1, index));
    layerSlider.value = String(appState.selectedLayer + 1);
    updateLayerUI();
    updateVisibleBricks();
  }

  layerSlider.addEventListener('input', () => setSelectedLayer(Number(layerSlider.value) - 1));
  prevLayer.addEventListener('click', () => setSelectedLayer(appState.selectedLayer - 1));
  nextLayer.addEventListener('click', () => setSelectedLayer(appState.selectedLayer + 1));

  document.querySelectorAll('[data-mode]').forEach(button => {
    button.addEventListener('click', () => {
      appState.displayMode = button.dataset.mode;
      document.querySelectorAll('[data-mode]').forEach(btn => btn.classList.toggle('active', btn === button));
      updateVisibleBricks();
    });
  });

  function updateVisibleBricks() {
    if (!appState.grid) return;
    const layer = appState.selectedLayer;
    let visible = [];
    let ghost = [];
    if (appState.displayMode === 'all') {
      visible = appState.allBricks;
    } else if (appState.displayMode === 'through') {
      visible = appState.allBricks.filter(b => b.layer <= layer);
    } else {
      visible = appState.layers[layer]?.bricks || [];
      ghost = appState.allBricks.filter(b => b.layer < layer);
    }
    renderer.updateInstances(visible, ghost);
  }

  function drawLayerPlan() {
    const layer = currentLayer();
    const grid = appState.grid;
    if (!layer || !grid) return;
    planEmpty.classList.add('hidden');
    const rect = planCanvas.getBoundingClientRect();
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (planCanvas.width !== width || planCanvas.height !== height) {
      planCanvas.width = width;
      planCanvas.height = height;
    }
    const ctx = planCanvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const margin = 18;
    const scale = Math.min((rect.width - margin * 2) / grid.nx, (rect.height - margin * 2) / grid.nz);
    const ox = (rect.width - grid.nx * scale) / 2;
    const oy = (rect.height - grid.nz * scale) / 2;

    const below = appState.layers[layer.index - 1];
    if (below) {
      ctx.fillStyle = 'rgba(132, 145, 174, 0.20)';
      for (const b of below.bricks) {
        const planRect = getLayerPlanRect(grid, b);
        ctx.fillRect(ox + planRect.x * scale, oy + planRect.y * scale, planRect.width * scale, planRect.height * scale);
      }
    }

    for (const brick of layer.bricks) {
      const planRect = getLayerPlanRect(grid, brick);
      const x = ox + planRect.x * scale;
      const y = oy + planRect.y * scale;
      const w = planRect.width * scale;
      const h = planRect.height * scale;
      const c = brick.color;
      ctx.fillStyle = `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
      ctx.fillRect(x + 0.6, y + 0.6, Math.max(0, w - 1.2), Math.max(0, h - 1.2));
      ctx.strokeStyle = 'rgba(4, 7, 15, 0.88)';
      ctx.lineWidth = Math.max(1, Math.min(2.4, scale * 0.08));
      ctx.strokeRect(x + 0.6, y + 0.6, Math.max(0, w - 1.2), Math.max(0, h - 1.2));
      if (brick.baseLeveling) {
        ctx.save();
        ctx.setLineDash([Math.max(2, scale * .22), Math.max(1.5, scale * .14)]);
        ctx.strokeStyle = 'rgba(255, 185, 91, .98)';
        ctx.lineWidth = Math.max(2, Math.min(3.4, scale * .13));
        ctx.strokeRect(x + 2, y + 2, Math.max(0, w - 4), Math.max(0, h - 4));
        ctx.restore();
      }
      if (brick.lockedFromAbove) {
        ctx.save();
        ctx.setLineDash([Math.max(2, scale * .18), Math.max(1.5, scale * .12)]);
        ctx.strokeStyle = 'rgba(72, 215, 255, .98)';
        ctx.lineWidth = Math.max(2, Math.min(3.2, scale * .12));
        ctx.strokeRect(x + 4, y + 4, Math.max(0, w - 8), Math.max(0, h - 8));
        ctx.restore();
      }

      if (scale >= 8) {
        ctx.fillStyle = 'rgba(255,255,255,.26)';
        for (let dz = 0; dz < brick.d; dz++) {
          for (let dx = 0; dx < brick.w; dx++) {
            ctx.beginPath();
            ctx.arc(x + (dx + .5) * scale, y + (dz + .5) * scale, Math.max(1.3, scale * .17), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
      if (w >= 18 && h >= 14) {
        ctx.fillStyle = luminance(c) > 0.48 ? 'rgba(5,8,15,.88)' : 'rgba(255,255,255,.95)';
        ctx.font = `800 ${Math.max(9, Math.min(14, scale * .52))}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(brick.placement), x + w / 2, y + h / 2 + .5);
      }
    }

    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, grid.nx * scale, grid.nz * scale);
  }

  function luminance(c) { return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; }

  window.addEventListener('resize', () => {
    renderer.resize();
    if (appState.grid) drawLayerPlan();
  });

  exportBtn.addEventListener('click', () => {
    if (!appState.grid) return;
    const inventory = PART_DEFS.map(part => ({
      type: partLabel(part.key),
      supply: appState.inventoryConfig[part.key]?.supply || 'normal',
      maximum: appState.inventoryConfig[part.key]?.max ?? null,
      used: appState.inventoryUsage[part.key] || 0
    }));
    const data = {
      generator: 'Brickify 3D v4 GLB connected standalone HTML',
      model: appState.sourceName,
      sourceFormat: appState.sourceFormat,
      resolutionStuds: Number(resolution.value),
      brickHeightToStudRatio: BRICK_HEIGHT,
      colorMode: appState.colorMode,
      modelColorInfo: appState.modelColorInfo,
      meshRepairSettings: appState.repairConfig,
      meshRepairDiagnostics: appState.grid.repair,
      connectionPreference: appState.supportMode,
      connectivityPolicy: 'No internal support columns. Retain only bricks with vertical stud-overlap paths to the baseplate; bottom-leveling volume is allowed only near the lowest layers.',
      grid: { widthStuds: appState.grid.nx, depthStuds: appState.grid.nz, layers: appState.grid.ny },
      inventory,
      validation: appState.validation,
      totals: {
        modelStuds: appState.grid.modelFilled,
        bottomLevelingStuds: appState.validation?.baseLevelingStuds || 0,
        retainedSolidStuds: appState.grid.filled,
        bricks: appState.allBricks.length,
        bottomLevelingBricks: appState.validation?.baseLevelingBricks || 0,
        bricksLockedFromAbove: appState.validation?.lockedFromAboveBricks || 0,
        skippedFloatingBricks: appState.validation?.skippedFloatingBricks || 0,
        skippedFloatingStuds: appState.validation?.skippedFloatingStuds || 0,
        skippedUnplaceableStuds: appState.validation?.skippedUnplaceableStuds || 0,
        skippedDetachedVoxelComponents: appState.validation?.skippedVoxelComponents || 0,
        skippedDetachedVoxelStuds: appState.validation?.skippedVoxelStuds || 0,
        allRetainedBricksConnectedToBase: !!appState.validation?.allConnected
      },
      layers: appState.layers.map(layer => ({
        layer: layer.index + 1,
        brickCount: layer.bricks.length,
        modelStuds: layer.modelStuds,
        bottomLevelingStuds: layer.baseLevelStuds,
        totalStuds: layer.studs,
        bottomLevelingBricks: layer.baseLevelBricks,
        bricksLockedFromAbove: layer.lockedFromAboveBricks,
        bricksBelowPreferredLockStrength: layer.lightlyLockedBricks,
        bricks: layer.bricks.map(b => ({
          id: b.placement,
          x: b.x,
          z: b.z,
          width: b.w,
          depth: b.d,
          type: canonicalBrickName(b),
          modelStudsCovered: b.modelStuds,
          bottomLeveling: !!b.baseLeveling,
          bottomLevelingStuds: b.baseLevelStuds || 0,
          connectionDirection: b.connectionDirection,
          lockedFromAbove: !!b.lockedFromAbove,
          lockingStudsBelow: b.supportStuds,
          lockingStudsAbove: b.lockingStudsAbove,
          preferredMinimumLockStuds: b.requiredSupportStuds,
          lockSpanBelowStuds: b.supportSpan,
          lockSpanAboveStuds: b.lockSpanAbove,
          preferredMinimumLockSpanStuds: b.requiredSupportSpan,
          cantileveredStudsAtThisStep: b.overhangStuds,
          brickIdsInPreviousLayer: b.supportBrickIds,
          brickIdsInNextLayer: b.lockBrickIdsAbove,
          sideAdjacentBrickIdsThisLayer: b.sideContactBrickIds,
          sideAdjacentEdges: b.sideContactStuds,
          meetsSelectedConnectionPreference: !!b.meetsSupportRule,
          connectedToBase: !!b.connectedToBase,
          colorRGB: b.color.slice(0, 3).map(v => Math.round(v * 255))
        }))
      }))
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const base = (appState.sourceName || 'sculpture').replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_');
    a.download = `${base}_brick_instructions.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    showToast('Build instructions exported.');
  });

  function makeDemoRocket() {
    const profile = [
      [0.00, 0.00], [0.00, 0.78], [0.18, 0.92], [0.42, 0.98],
      [1.55, 0.78], [2.05, 0.69], [2.45, 0.52], [2.82, 0.28], [3.12, 0.00]
    ];
    const segments = 32;
    const vertices = [];
    for (let p = 0; p < profile.length - 1; p++) {
      const [y0, r0] = profile[p];
      const [y1, r1] = profile[p + 1];
      for (let s = 0; s < segments; s++) {
        const a0 = s / segments * Math.PI * 2;
        const a1 = (s + 1) / segments * Math.PI * 2;
        const v00 = [Math.cos(a0) * r0, y0, Math.sin(a0) * r0];
        const v01 = [Math.cos(a1) * r0, y0, Math.sin(a1) * r0];
        const v10 = [Math.cos(a0) * r1, y1, Math.sin(a0) * r1];
        const v11 = [Math.cos(a1) * r1, y1, Math.sin(a1) * r1];
        if (r0 === 0) vertices.push(...v00, ...v10, ...v11);
        else if (r1 === 0) vertices.push(...v00, ...v10, ...v01);
        else vertices.push(...v00, ...v10, ...v11, ...v00, ...v11, ...v01);
      }
    }
    return new Float32Array(vertices);
  }

  class BrickRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.gl = canvas.getContext('webgl2', { antialias: true, alpha: false });
      this.available = !!this.gl;
      this.bricks = [];
      this.ghostBricks = [];
      this.grid = null;
      this.meshTriangles = null;
      this.showWireframe = false;
      this.needsRender = true;
      this.dragging = false;
      this.lastX = 0;
      this.lastY = 0;
      this.yaw = -0.72;
      this.pitch = 0.58;
      this.distance = 35;
      this.target = [0, 8, 0];
      if (!this.available) {
        setStatus('WebGL 2 is unavailable in this browser. The converter can still export instructions, but the 3D view cannot render.', 'error');
        return;
      }
      this.initGL();
      this.bindControls();
      this.resize();
      requestAnimationFrame(() => this.frame());
    }

    initGL() {
      const gl = this.gl;
      this.meshProgram = createProgram(gl, `#version 300 es
        precision highp float;
        layout(location=0) in vec3 aPosition;
        layout(location=1) in vec3 aNormal;
        layout(location=2) in vec3 iOffset;
        layout(location=3) in vec3 iScale;
        layout(location=4) in vec4 iColor;
        uniform mat4 uViewProj;
        out vec3 vNormal;
        out vec4 vColor;
        out vec3 vWorld;
        void main() {
          vec3 world = aPosition * iScale + iOffset;
          gl_Position = uViewProj * vec4(world, 1.0);
          vNormal = normalize(aNormal / max(iScale, vec3(0.0001)));
          vColor = iColor;
          vWorld = world;
        }`, `#version 300 es
        precision highp float;
        in vec3 vNormal;
        in vec4 vColor;
        in vec3 vWorld;
        out vec4 outColor;
        void main() {
          vec3 n = normalize(vNormal);
          vec3 lightDir = normalize(vec3(-0.55, 0.92, 0.35));
          float diffuse = max(dot(n, lightDir), 0.0);
          float rim = pow(1.0 - max(dot(n, normalize(vec3(0.15, 0.55, 0.82))), 0.0), 2.0);
          vec3 color = vColor.rgb * (0.35 + diffuse * 0.72) + rim * 0.055;
          float fog = smoothstep(65.0, 145.0, length(vWorld));
          color = mix(color, vec3(0.045, 0.065, 0.12), fog * 0.42);
          outColor = vec4(color, vColor.a);
        }`);
      this.lineProgram = createProgram(gl, `#version 300 es
        precision highp float;
        layout(location=0) in vec3 aPosition;
        uniform mat4 uViewProj;
        void main() { gl_Position = uViewProj * vec4(aPosition, 1.0); }`, `#version 300 es
        precision highp float;
        uniform vec4 uColor;
        out vec4 outColor;
        void main() { outColor = uColor; }`);

      this.cube = createCubeGeometry(gl);
      this.cylinder = createCylinderGeometry(gl, 12);
      this.instanceBuffer = gl.createBuffer();
      this.studInstanceBuffer = gl.createBuffer();
      this.ghostInstanceBuffer = gl.createBuffer();
      this.wireBuffer = gl.createBuffer();
      this.wireCount = 0;
      this.bodyCount = 0;
      this.studCount = 0;
      this.ghostCount = 0;
      this.configureInstanceVAO(this.cube, this.instanceBuffer);
      this.configureInstanceVAO(this.cylinder, this.studInstanceBuffer);
      this.ghostCube = createCubeGeometry(gl);
      this.configureInstanceVAO(this.ghostCube, this.ghostInstanceBuffer);
      gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.CULL_FACE);
      gl.cullFace(gl.BACK);
      gl.clearColor(0.035, 0.052, 0.10, 1);
    }

    configureInstanceVAO(geometry, buffer) {
      const gl = this.gl;
      gl.bindVertexArray(geometry.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const stride = 10 * 4;
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 0);
      gl.vertexAttribDivisor(2, 1);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 3, gl.FLOAT, false, stride, 3 * 4);
      gl.vertexAttribDivisor(3, 1);
      gl.enableVertexAttribArray(4);
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 6 * 4);
      gl.vertexAttribDivisor(4, 1);
      gl.bindVertexArray(null);
    }

    bindControls() {
      this.canvas.addEventListener('pointerdown', event => {
        this.dragging = true;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        this.canvas.setPointerCapture(event.pointerId);
      });
      this.canvas.addEventListener('pointermove', event => {
        if (!this.dragging) return;
        const dx = event.clientX - this.lastX;
        const dy = event.clientY - this.lastY;
        this.lastX = event.clientX;
        this.lastY = event.clientY;
        this.yaw -= dx * 0.007;
        this.pitch = Math.max(-0.1, Math.min(1.42, this.pitch + dy * 0.007));
        this.requestRender();
      });
      const stop = event => {
        this.dragging = false;
        try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) {}
      };
      this.canvas.addEventListener('pointerup', stop);
      this.canvas.addEventListener('pointercancel', stop);
      this.canvas.addEventListener('wheel', event => {
        event.preventDefault();
        this.distance *= Math.exp(event.deltaY * 0.0012);
        this.distance = Math.max(3, Math.min(240, this.distance));
        this.requestRender();
      }, { passive: false });
      this.canvas.addEventListener('dblclick', () => this.resetCamera());
    }

    setSculpture(bricks, grid, meshTriangles) {
      this.bricks = bricks || [];
      this.grid = grid;
      this.meshTriangles = meshTriangles;
      this.buildWireframe();
      this.updateInstances(this.bricks, []);
    }

    updateInstances(bricks, ghostBricks) {
      if (!this.available) return;
      this.bricks = bricks || [];
      this.ghostBricks = ghostBricks || [];
      const grid = this.grid;
      if (!grid) {
        this.uploadInstances(this.instanceBuffer, new Float32Array(), 'bodyCount');
        this.uploadInstances(this.studInstanceBuffer, new Float32Array(), 'studCount');
        this.uploadInstances(this.ghostInstanceBuffer, new Float32Array(), 'ghostCount');
        this.requestRender();
        return;
      }
      const cx = grid.nx / 2;
      const cz = grid.nz / 2;
      const body = new Float32Array(this.bricks.length * 10);
      let bi = 0;
      let studTotal = 0;
      for (const b of this.bricks) studTotal += b.w * b.d;
      const studs = new Float32Array(studTotal * 10);
      let si = 0;
      for (const b of this.bricks) {
        const color = b.color;
        body.set([
          b.x + b.w / 2 - cx, b.layer * BRICK_HEIGHT + BRICK_HEIGHT / 2, b.z + b.d / 2 - cz,
          Math.max(.05, b.w - GAP), BRICK_HEIGHT - GAP, Math.max(.05, b.d - GAP),
          color[0], color[1], color[2], 1
        ], bi); bi += 10;
        for (let dz = 0; dz < b.d; dz++) {
          for (let dx = 0; dx < b.w; dx++) {
            const lift = 1.05;
            studs.set([
              b.x + dx + .5 - cx, b.layer * BRICK_HEIGHT + BRICK_HEIGHT + STUD_HEIGHT / 2 - GAP * .2, b.z + dz + .5 - cz,
              STUD_RADIUS, STUD_HEIGHT, STUD_RADIUS,
              Math.min(1, color[0] * lift), Math.min(1, color[1] * lift), Math.min(1, color[2] * lift), 1
            ], si); si += 10;
          }
        }
      }
      const ghost = new Float32Array(this.ghostBricks.length * 10);
      let gi = 0;
      for (const b of this.ghostBricks) {
        ghost.set([
          b.x + b.w / 2 - cx, b.layer * BRICK_HEIGHT + BRICK_HEIGHT / 2, b.z + b.d / 2 - cz,
          Math.max(.05, b.w - GAP), BRICK_HEIGHT - GAP, Math.max(.05, b.d - GAP),
          .48, .55, .68, .13
        ], gi); gi += 10;
      }
      this.uploadInstances(this.instanceBuffer, body, 'bodyCount');
      this.uploadInstances(this.studInstanceBuffer, studs, 'studCount');
      this.uploadInstances(this.ghostInstanceBuffer, ghost, 'ghostCount');
      this.requestRender();
    }

    uploadInstances(buffer, data, countProperty) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      this[countProperty] = data.length / 10;
    }

    buildWireframe() {
      if (!this.available || !this.grid || !this.meshTriangles) {
        this.wireCount = 0;
        return;
      }
      const triCount = this.meshTriangles.length / 9;
      const step = Math.max(1, Math.ceil(triCount / MAX_TRIANGLES_FOR_WIREFRAME));
      const lines = [];
      const cx = this.grid.nx / 2, cz = this.grid.nz / 2;
      const p = (i) => [this.meshTriangles[i] - cx, this.meshTriangles[i + 1] * BRICK_HEIGHT, this.meshTriangles[i + 2] - cz];
      for (let t = 0; t < triCount; t += step) {
        const i = t * 9;
        const a = p(i), b = p(i + 3), c = p(i + 6);
        lines.push(...a, ...b, ...b, ...c, ...c, ...a);
      }
      const data = new Float32Array(lines);
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.wireBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      this.wireCount = data.length / 3;
    }

    resize() {
      if (!this.available) return;
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2.25, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
      }
      this.requestRender();
    }

    resetCamera() {
      if (this.grid) {
        const height = this.grid.ny * BRICK_HEIGHT;
        const span = Math.max(this.grid.nx, this.grid.nz, height);
        this.target = [0, height * .45, 0];
        this.distance = Math.max(8, span * 2.05);
      } else {
        this.target = [0, 8, 0];
        this.distance = 35;
      }
      this.yaw = -0.72;
      this.pitch = 0.58;
      this.requestRender();
    }

    requestRender() { this.needsRender = true; }

    frame() {
      if (this.needsRender) this.render();
      requestAnimationFrame(() => this.frame());
    }

    render() {
      if (!this.available) return;
      this.needsRender = false;
      this.resizeIfNeeded();
      const gl = this.gl;
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      const aspect = this.canvas.width / Math.max(1, this.canvas.height);
      const projection = mat4Perspective(Math.PI / 4.1, aspect, .1, 500);
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
      const eye = [
        this.target[0] + this.distance * cp * sy,
        this.target[1] + this.distance * sp,
        this.target[2] + this.distance * cp * cy
      ];
      const view = mat4LookAt(eye, this.target, [0, 1, 0]);
      const viewProj = mat4Multiply(projection, view);

      gl.useProgram(this.meshProgram);
      gl.uniformMatrix4fv(gl.getUniformLocation(this.meshProgram, 'uViewProj'), false, viewProj);

      if (this.ghostCount) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.depthMask(false);
        gl.bindVertexArray(this.ghostCube.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, this.ghostCube.count, this.ghostCount);
        gl.depthMask(true);
        gl.disable(gl.BLEND);
      }

      if (this.bodyCount) {
        gl.bindVertexArray(this.cube.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, this.cube.count, this.bodyCount);
      }
      if (this.studCount) {
        gl.bindVertexArray(this.cylinder.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, this.cylinder.count, this.studCount);
      }

      if (this.showWireframe && this.wireCount) {
        gl.useProgram(this.lineProgram);
        gl.uniformMatrix4fv(gl.getUniformLocation(this.lineProgram, 'uViewProj'), false, viewProj);
        gl.uniform4f(gl.getUniformLocation(this.lineProgram, 'uColor'), .38, .90, 1.0, .62);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.disable(gl.CULL_FACE);
        gl.bindVertexArray(null);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.wireBuffer);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, this.wireCount);
        gl.enable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
      }
      gl.bindVertexArray(null);
    }

    resizeIfNeeded() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2.25, window.devicePixelRatio || 1);
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));
      if (width !== this.canvas.width || height !== this.canvas.height) {
        this.canvas.width = width;
        this.canvas.height = height;
        this.gl.viewport(0, 0, width, height);
      }
    }
  }

  function createProgram(gl, vertexSource, fragmentSource) {
    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
      return shader;
    };
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    return program;
  }

  function createCubeGeometry(gl) {
    const vertices = new Float32Array([
      // +X
      .5,-.5,-.5, 1,0,0,  .5,.5,-.5, 1,0,0,  .5,.5,.5, 1,0,0,
      .5,-.5,-.5, 1,0,0,  .5,.5,.5, 1,0,0,  .5,-.5,.5, 1,0,0,
      // -X
      -.5,-.5,.5, -1,0,0,  -.5,.5,.5, -1,0,0,  -.5,.5,-.5, -1,0,0,
      -.5,-.5,.5, -1,0,0,  -.5,.5,-.5, -1,0,0,  -.5,-.5,-.5, -1,0,0,
      // +Y
      -.5,.5,-.5, 0,1,0,  -.5,.5,.5, 0,1,0,  .5,.5,.5, 0,1,0,
      -.5,.5,-.5, 0,1,0,  .5,.5,.5, 0,1,0,  .5,.5,-.5, 0,1,0,
      // -Y
      -.5,-.5,.5, 0,-1,0,  -.5,-.5,-.5, 0,-1,0,  .5,-.5,-.5, 0,-1,0,
      -.5,-.5,.5, 0,-1,0,  .5,-.5,-.5, 0,-1,0,  .5,-.5,.5, 0,-1,0,
      // +Z
      .5,-.5,.5, 0,0,1,  .5,.5,.5, 0,0,1,  -.5,.5,.5, 0,0,1,
      .5,-.5,.5, 0,0,1,  -.5,.5,.5, 0,0,1,  -.5,-.5,.5, 0,0,1,
      // -Z
      -.5,-.5,-.5, 0,0,-1,  -.5,.5,-.5, 0,0,-1,  .5,.5,-.5, 0,0,-1,
      -.5,-.5,-.5, 0,0,-1,  .5,.5,-.5, 0,0,-1,  .5,-.5,-.5, 0,0,-1
    ]);
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 6 * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 6 * 4, 3 * 4);
    gl.bindVertexArray(null);
    return { vao, buffer, count: vertices.length / 6 };
  }

  function createCylinderGeometry(gl, segments) {
    const v = [];
    for (let i = 0; i < segments; i++) {
      const a0 = i / segments * Math.PI * 2;
      const a1 = (i + 1) / segments * Math.PI * 2;
      const x0 = Math.cos(a0), z0 = Math.sin(a0);
      const x1 = Math.cos(a1), z1 = Math.sin(a1);
      // side
      v.push(x0,-.5,z0, x0,0,z0,  x0,.5,z0, x0,0,z0,  x1,.5,z1, x1,0,z1);
      v.push(x0,-.5,z0, x0,0,z0,  x1,.5,z1, x1,0,z1,  x1,-.5,z1, x1,0,z1);
      // top
      v.push(0,.5,0, 0,1,0,  x1,.5,z1, 0,1,0,  x0,.5,z0, 0,1,0);
    }
    const vertices = new Float32Array(v);
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 6 * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 6 * 4, 3 * 4);
    gl.bindVertexArray(null);
    return { vao, buffer, count: vertices.length / 6 };
  }

  function mat4Perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2);
    const nf = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (far + near) * nf, -1,
      0, 0, (2 * far * near) * nf, 0
    ]);
  }

  function mat4LookAt(eye, center, up) {
    let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
    let len = Math.hypot(zx, zy, zz) || 1;
    zx /= len; zy /= len; zz /= len;
    let xx = up[1] * zz - up[2] * zy;
    let xy = up[2] * zx - up[0] * zz;
    let xz = up[0] * zy - up[1] * zx;
    len = Math.hypot(xx, xy, xz) || 1;
    xx /= len; xy /= len; xz /= len;
    const yx = zy * xz - zz * xy;
    const yy = zz * xx - zx * xz;
    const yz = zx * xy - zy * xx;
    return new Float32Array([
      xx, yx, zx, 0,
      xy, yy, zy, 0,
      xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
      -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
      -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
      1
    ]);
  }

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        out[c * 4 + r] =
          a[0 * 4 + r] * b[c * 4 + 0] +
          a[1 * 4 + r] * b[c * 4 + 1] +
          a[2 * 4 + r] * b[c * 4 + 2] +
          a[3 * 4 + r] * b[c * 4 + 3];
      }
    }
    return out;
  }

  const renderer = new BrickRenderer(el('glCanvas'));
  resetViewBtn.addEventListener('click', () => renderer.resetCamera());

  async function loadLinkedModel() {
    const loader = window.Brickify3DModelLoader;
    if (!loader) return;

    let request;
    try {
      request = loader.parseLinkedModel(window.location.search);
    } catch (error) {
      setStatus(error.message || 'The linked model could not be loaded.', 'error');
      return;
    }
    if (!request) return;

    const startingRevision = appState.modelRevision;
    cancelLinkedModelLoad();
    const abortController = new AbortController();
    linkedModelAbortController = abortController;
    setStatus('Loading the ' + request.sourceLabel + ' GLB model...');
    try {
      const file = await loader.fetchLinkedModel(request, { signal: abortController.signal });
      if (appState.modelRevision !== startingRevision) return;
      await selectFile(file);
      setStatus('Model loaded from ' + request.sourceLabel + '. Adjust the resolution, then generate.');
    } catch (error) {
      if (appState.modelRevision !== startingRevision) return;
      setStatus(error.message || 'The linked model could not be loaded.', 'error');
    } finally {
      if (linkedModelAbortController === abortController) linkedModelAbortController = null;
    }
  }

  document.addEventListener('keydown', event => {
    if (!appState.layers.length) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') setSelectedLayer(appState.selectedLayer - 1);
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') setSelectedLayer(appState.selectedLayer + 1);
  });

  renderInventoryRows();
  resetInventoryBtn.addEventListener('click', resetInventoryToDefaults);
  const inventoryChanged = () => {
    saveInventorySettings();
    updateInventoryUsage(appState.inventoryUsage);
    if (appState.layers.length && !appState.busy) setStatus('Inventory changed. Generate again to apply the new preferences and limits.');
  };
  inventoryRows.addEventListener('change', inventoryChanged);
  inventoryRows.addEventListener('input', inventoryChanged);
  supportStrength.addEventListener('change', () => {
    if (appState.layers.length && !appState.busy) setStatus('Connection rule changed. Generate again to rebuild and validate the sculpture.');
  });
  colorMode.addEventListener('change', () => {
    if (appState.layers.length && !appState.busy) setStatus('Color mode changed. Generate again to recolor bricks from the model or random palette.');
  });
  [volumeMode, gapSeal, flattenBase, mainBodyOnly].forEach(control => control.addEventListener('change', () => {
    if (appState.layers.length && !appState.busy) setStatus('Mesh repair settings changed. Generate again to reconstruct the solid volume.');
  }));

  updateResolutionUI();
  resetResults();
  loadLinkedModel();
})();
