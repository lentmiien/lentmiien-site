(function () {
  'use strict';

  var ready = function (fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  };

  var SAMPLE_CSV = [
    'id,w,d,h,weight,qty',
    'widget-a,400,300,250,5.5,3',
    'widget-b,250,200,150,3.1,2',
    'widget-c,180,160,140,2.6,1'
  ].join('\n');

  var HEADER_ALIASES = {
    id: ['id', 'itemid', 'sku', 'name'],
    w: ['w', 'width', 'x', 'dimx'],
    d: ['d', 'depth', 'y', 'dimy', 'length'],
    h: ['h', 'height', 'z', 'dimz'],
    weight: ['weight', 'mass', 'kg'],
    qty: ['qty', 'quantity', 'count', 'q'],
  };

  var REQUIRED_KEYS = ['id', 'w', 'd', 'h', 'weight', 'qty'];

  var EPSILON = 0.001;
  var COLOR_DEFAULT = 0x2b3642;
  var COLOR_HIGHLIGHT = 0xFFC247;
  var EDGE_DEFAULT = 0x93a0b5;
  var EDGE_HIGHLIGHT = 0xFFC247;
  var SCENE_TARGET_SIZE = 8;

  var computeLayers = function (placements) {
    if (!Array.isArray(placements) || placements.length === 0) {
      return [];
    }

    var items = placements.map(function (placement, index) {
      var bottom = Number(placement && placement.z);
      if (!Number.isFinite(bottom)) {
        bottom = 0;
      }
      var height = Number(placement && placement.h);
      if (!Number.isFinite(height)) {
        height = 0;
      }
      var top = bottom + height;
      return {
        index: index,
        bottom: bottom,
        top: top,
      };
    });

    var total = items.length;
    var assigned = new Set();
    var internalLayers = [];

    var baseIndices = [];
    items.forEach(function (item) {
      if (item.bottom <= EPSILON) {
        baseIndices.push(item.index);
      }
    });

    if (baseIndices.length) {
      var baseEnd = Infinity;
      baseIndices.forEach(function (idx) {
        var top = items[idx].top;
        if (top < baseEnd) {
          baseEnd = top;
        }
      });
      if (!Number.isFinite(baseEnd)) {
        baseEnd = 0;
      }
      internalLayers.push({
        start: 0,
        end: baseEnd,
        indices: baseIndices.slice(),
      });
      baseIndices.forEach(function (idx) {
        assigned.add(idx);
      });
    }

    while (assigned.size < total) {
      var startItem = null;
      items.forEach(function (item) {
        if (assigned.has(item.index)) {
          return;
        }
        if (!startItem || item.bottom < startItem.bottom - EPSILON) {
          startItem = item;
        }
      });

      if (!startItem) {
        break;
      }

      var layerStart = startItem.bottom;
      var plane = layerStart;
      var active = new Set();
      var layerIndices = new Set();
      var layerEnd = layerStart;

      while (true) {
        items.forEach(function (item) {
          if (assigned.has(item.index) || active.has(item.index)) {
            return;
          }
          if (item.bottom <= plane + EPSILON) {
            active.add(item.index);
          }
        });

        if (!active.has(startItem.index)) {
          active.add(startItem.index);
        }

        if (active.size === 0) {
          break;
        }

        var nextTop = Infinity;
        active.forEach(function (idx) {
          var top = items[idx].top;
          if (top < nextTop) {
            nextTop = top;
          }
        });

        var nextBottom = Infinity;
        items.forEach(function (item) {
          if (assigned.has(item.index) || active.has(item.index)) {
            return;
          }
          if (item.bottom > plane + EPSILON && item.bottom < nextBottom) {
            nextBottom = item.bottom;
          }
        });

        if (nextTop <= nextBottom + EPSILON) {
          active.forEach(function (idx) {
            layerIndices.add(idx);
            assigned.add(idx);
          });
          layerEnd = nextTop;
          break;
        }

        if (Number.isFinite(nextBottom)) {
          plane = nextBottom;
        } else {
          active.forEach(function (idx) {
            layerIndices.add(idx);
            assigned.add(idx);
          });
          layerEnd = nextTop;
          break;
        }
      }

      if (layerIndices.size > 0) {
        internalLayers.push({
          start: layerStart,
          end: layerEnd,
          indices: Array.from(layerIndices),
        });
      } else {
        assigned.add(startItem.index);
      }
    }

    return internalLayers.map(function (layer, position) {
      return {
        index: position + 1,
        start: layer.start,
        end: layer.end,
        placements: layer.indices.map(function (idx) {
          return placements[idx];
        }),
      };
    });
  };

  var formatNumber = function (value, digits) {
    if (!Number.isFinite(value)) {
      return '0';
    }
    return Number(value).toLocaleString('en-US', {
      maximumFractionDigits: typeof digits === 'number' ? digits : 2,
    });
  };

  var normalizeKey = function (key) {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
  };

  var splitCsvLine = function (line) {
    var result = [];
    var current = '';
    var inQuotes = false;

    for (var i = 0; i < line.length; i += 1) {
      var char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    result.push(current.trim());
    return result;
  };

  var mapHeaders = function (headerRow) {
    var mapping = {};
    headerRow.forEach(function (rawValue, index) {
      var normalized = normalizeKey(rawValue);
      Object.keys(HEADER_ALIASES).forEach(function (key) {
        if (mapping[key] !== undefined) {
          return;
        }
        if (HEADER_ALIASES[key].indexOf(normalized) >= 0) {
          mapping[key] = index;
        }
      });
    });
    return mapping;
  };

  var parseItems = function (text) {
    var rows = text.split(/\r?\n/).filter(function (line) {
      return line.trim().length > 0;
    });

    if (!rows.length) {
      return { items: [], errors: [], totalWeight: 0 };
    }

    var headerCells = splitCsvLine(rows[0]);
    var mapping = mapHeaders(headerCells);
    var missing = REQUIRED_KEYS.filter(function (key) {
      return mapping[key] === undefined;
    });

    if (missing.length) {
      return {
        items: [],
        errors: ['Missing required column(s): ' + missing.join(', ') + '.'],
        totalWeight: 0,
      };
    }

    var items = [];
    var errors = [];
    var totalWeight = 0;

    rows.slice(1).forEach(function (row, rowIndex) {
      if (row.trim().length === 0) {
        return;
      }

      var cells = splitCsvLine(row);
      var lineNumber = rowIndex + 2;

      var rawId = cells[mapping.id] || '';
      var id = rawId.trim();
      if (!id) {
        errors.push('Row ' + lineNumber + ': Item ID is required.');
        return;
      }

      var width = Number(cells[mapping.w]);
      var depth = Number(cells[mapping.d]);
      var height = Number(cells[mapping.h]);
      var weight = Number(cells[mapping.weight]);
      var qty = Number(cells[mapping.qty] || 1);

      if (!Number.isFinite(width) || width <= 0) {
        errors.push('Row ' + lineNumber + ': Width must be a positive number.');
        return;
      }
      if (!Number.isFinite(depth) || depth <= 0) {
        errors.push('Row ' + lineNumber + ': Depth must be a positive number.');
        return;
      }
      if (!Number.isFinite(height) || height <= 0) {
        errors.push('Row ' + lineNumber + ': Height must be a positive number.');
        return;
      }
      if (!Number.isFinite(weight) || weight < 0) {
        errors.push('Row ' + lineNumber + ': Weight must be zero or more.');
        return;
      }
      if (!Number.isFinite(qty) || qty <= 0) {
        errors.push('Row ' + lineNumber + ': Quantity must be at least 1.');
        return;
      }

      var normalizedQty = Math.round(qty);
      if (normalizedQty !== qty) {
        errors.push('Row ' + lineNumber + ': Quantity rounded to nearest whole number.');
      }

      items.push({
        id: id,
        w: width,
        d: depth,
        h: height,
        weight: weight,
        qty: normalizedQty,
      });
      totalWeight += weight * normalizedQty;
    });

    return { items: items, errors: errors, totalWeight: totalWeight };
  };

  ready(function () {
    var form = document.getElementById('binPackForm');
    if (!form) {
      return;
    }

    var fileInput = document.getElementById('itemsFile');
    var textarea = document.getElementById('itemsTextarea');
    var parseErrorsEl = document.querySelector('[data-parse-errors]');
    var tableBody = document.querySelector('[data-item-table]');
    var uniqueCountEl = document.querySelector('[data-unique-count]');
    var totalCountEl = document.querySelector('[data-total-count]');
    var totalWeightEl = document.querySelector('[data-total-weight]');
    var algorithmSelect = document.getElementById('algorithm');
    var bruteNoteEl = document.querySelector('[data-bruteforce-note]');
    var submitBtn = document.getElementById('binPackSubmit');
    var statusEl = document.querySelector('[data-request-status]');
    var outputEl = document.getElementById('binPackOutput');
    var metaSummaryEl = document.querySelector('[data-meta-summary]');
    var metaAlgorithmEl = document.querySelector('[data-meta-algorithm]');
    var metaContainerEl = document.querySelector('[data-meta-container]');
    var metaItemsEl = document.querySelector('[data-meta-items]');
    var sampleBtn = document.querySelector('[data-fill-sample]');
    var clearBtn = document.querySelector('[data-clear-items]');
    var viewerModal = document.querySelector('[data-viewer-modal]');
    var viewerCanvas = document.querySelector('[data-viewer-canvas]');
    var viewerCloseBtn = document.querySelector('[data-viewer-close]');
    var layerUpBtn = document.querySelector('[data-layer-up]');
    var layerDownBtn = document.querySelector('[data-layer-down]');
    var layerLabel = document.querySelector('[data-layer-label]');

    var viewerState = {
      modal: viewerModal,
      canvas: viewerCanvas,
      closeBtn: viewerCloseBtn,
      upBtn: layerUpBtn,
      downBtn: layerDownBtn,
      label: layerLabel,
      renderer: null,
      scene: null,
      camera: null,
      animationFrame: null,
      animationLoopActive: false,
      layerGroups: [],
      pallets: [],
      activeIndex: null,
      currentVisibleLayers: 0,
      containerGroup: null,
      scale: 1,
    };

    var state = {
      items: [],
      totalWeight: 0,
    };

    var setStatus = function (message, tone) {
      if (!statusEl) {
        return;
      }

      statusEl.textContent = message || '';
      statusEl.classList.remove('bin-pack__status--info', 'bin-pack__status--error', 'bin-pack__status--success');

      if (!message) {
        return;
      }
      if (tone === 'error') {
        statusEl.classList.add('bin-pack__status--error');
      } else if (tone === 'success') {
        statusEl.classList.add('bin-pack__status--success');
      } else {
        statusEl.classList.add('bin-pack__status--info');
      }
    };

    var isViewerOpen = function () {
      return Boolean(viewerState.modal && viewerState.modal.classList.contains('is-visible'));
    };

    var cancelAnimation = function () {
      if (
        viewerState.renderer &&
        typeof viewerState.renderer.setAnimationLoop === 'function' &&
        viewerState.animationLoopActive
      ) {
        viewerState.renderer.setAnimationLoop(null);
        viewerState.animationLoopActive = false;
      }
      if (viewerState.animationFrame) {
        cancelAnimationFrame(viewerState.animationFrame);
        viewerState.animationFrame = null;
      }
    };

    var updateRendererSize = function () {
      if (!viewerState.renderer || !viewerState.canvas || !viewerState.camera) {
        return;
      }
      var width = viewerState.canvas.clientWidth || viewerState.canvas.width || 1;
      var height = viewerState.canvas.clientHeight || viewerState.canvas.height || 1;
      viewerState.renderer.setSize(width, height, false);
      viewerState.camera.aspect = width / height;
      viewerState.camera.updateProjectionMatrix();
    };

    var ensureRenderer = function () {
      if (!viewerState.canvas) {
        return false;
      }

      var three = window.THREE;

      if (!viewerState.renderer && three && typeof three.WebGLRenderer === 'function') {
        viewerState.renderer = new three.WebGLRenderer({
          canvas: viewerState.canvas,
          antialias: true,
          alpha: true,
        });

        viewerState.renderer.setPixelRatio(window.devicePixelRatio || 1);

        if (typeof viewerState.renderer.outputColorSpace !== 'undefined' && typeof three.SRGBColorSpace !== 'undefined') {
          viewerState.renderer.outputColorSpace = three.SRGBColorSpace;
        } else if (typeof viewerState.renderer.outputEncoding !== 'undefined' && typeof three.sRGBEncoding !== 'undefined') {
          viewerState.renderer.outputEncoding = three.sRGBEncoding;
        }

        if (three && three.ColorManagement) {
          if (typeof three.ColorManagement.legacyMode !== 'undefined') {
            three.ColorManagement.legacyMode = false;
          } else if (typeof three.ColorManagement.enabled !== 'undefined') {
            three.ColorManagement.enabled = true;
          }
        }
      }

      if (!viewerState.renderer) {
        return false;
      }

      updateRendererSize();
      return true;
    };

    var disposeObject = function (object) {
      if (!object) {
        return;
      }
      if (object.geometry && typeof object.geometry.dispose === 'function') {
        object.geometry.dispose();
      }
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(function (material) {
            if (material && typeof material.dispose === 'function') {
              material.dispose();
            }
          });
        } else if (typeof object.material.dispose === 'function') {
          object.material.dispose();
        }
      }
    };

    var clearScene = function () {
      if (!viewerState.scene) {
        return;
      }
      viewerState.scene.traverse(function (child) {
        disposeObject(child);
      });
      viewerState.scene = null;
      viewerState.camera = null;
      viewerState.animationLoopActive = false;
      viewerState.animationFrame = null;
      viewerState.layerGroups = [];
      viewerState.containerGroup = null;
      viewerState.currentVisibleLayers = 0;
    };

    var buildPalletScene = function (pallet) {
      if (!window.THREE) {
        return false;
      }

      clearScene();

      viewerState.scene = new THREE.Scene();
      viewerState.scene.background = new THREE.Color(0x0e0f13);

      var container = pallet && pallet.container ? pallet.container : {};
      var containerWidth = Number(container.w) || 0;
      var containerDepth = Number(container.d) || 0;
      var containerHeight = Number(container.h) || 0;
      var maxDim = Math.max(containerWidth, containerDepth, containerHeight, 1);
      var scale = SCENE_TARGET_SIZE / maxDim;
      viewerState.scale = scale;

      var width = viewerState.canvas ? (viewerState.canvas.clientWidth || viewerState.canvas.width || 1) : 1;
      var height = viewerState.canvas ? (viewerState.canvas.clientHeight || viewerState.canvas.height || 1) : 1;

      viewerState.camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 200);
      var cameraDistanceFactor = 1.5; // pull the camera back slightly so the pallet stays in frame
      viewerState.camera.position.set(6 * cameraDistanceFactor, 6 * cameraDistanceFactor, 7.5 * cameraDistanceFactor);
      viewerState.camera.lookAt(0, 0, 0);

      updateRendererSize();

      var ambient = new THREE.AmbientLight(0xffffff, 0.65);
      viewerState.scene.add(ambient);
      var directional = new THREE.DirectionalLight(0xffffff, 0.85);
      directional.position.set(8, 12, 10);
      viewerState.scene.add(directional);

      var offsetX = (containerWidth * scale) / 2;
      var offsetY = (containerHeight * scale) / 2;
      var offsetZ = (containerDepth * scale) / 2;

      if (containerWidth > 0 && containerDepth > 0 && containerHeight > 0) {
        var containerGroup = new THREE.Group();
        var containerGeometry = new THREE.BoxGeometry(containerWidth * scale, containerHeight * scale, containerDepth * scale);
        var containerEdges = new THREE.LineSegments(
          new THREE.EdgesGeometry(containerGeometry),
          new THREE.LineBasicMaterial({ color: 0x303540, transparent: true, opacity: 0.45 })
        );
        containerGroup.add(containerEdges);
        viewerState.scene.add(containerGroup);
        viewerState.containerGroup = containerGroup;
      }

      var majorSpan = Math.max(containerWidth, containerDepth);
      var gridSize = (majorSpan * scale) || 1;
      var gridDivisions = Math.min(20, Math.max(4, Math.round(majorSpan > 0 ? majorSpan / (maxDim / 6) : 6)));
      var grid = new THREE.GridHelper(gridSize, gridDivisions, 0xFF6A1F, 0x262B34);
      grid.position.y = -offsetY;
      viewerState.scene.add(grid);

      viewerState.layerGroups = [];

      var layers = Array.isArray(pallet.layers) ? pallet.layers : [];
      layers.forEach(function (layer) {
        var group = new THREE.Group();
        group.visible = false;
        var meshes = [];

        var placements = Array.isArray(layer.placements) ? layer.placements : [];
        placements.forEach(function (placement) {
          var px = Number(placement.x) || 0;
          var py = Number(placement.y) || 0;
          var pz = Number(placement.z) || 0;
          var pw = Number(placement.w) || 0;
          var pd = Number(placement.d) || 0;
          var ph = Number(placement.h) || 0;

          if (pw <= 0 || pd <= 0 || ph <= 0) {
            return;
          }

          var scaledW = pw * scale;
          var scaledD = pd * scale;
          var scaledH = ph * scale;

          var geometry = new THREE.BoxGeometry(scaledW, scaledH, scaledD);
          var material = new THREE.MeshPhongMaterial({
            color: COLOR_DEFAULT,
            transparent: true,
            opacity: 0.6,
            shininess: 40,
          });
          var mesh = new THREE.Mesh(geometry, material);
          var edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(geometry),
            new THREE.LineBasicMaterial({ color: EDGE_DEFAULT, transparent: true, opacity: 0.85 })
          );

          mesh.add(edges);
          mesh.position.set(
            (px + pw / 2) * scale - offsetX,
            (pz + ph / 2) * scale - offsetY,
            -((py + pd / 2) * scale - offsetZ)
          );

          group.add(mesh);
          meshes.push({ mesh: mesh, edges: edges });
        });

        viewerState.layerGroups.push({ group: group, meshes: meshes });
        viewerState.scene.add(group);
      });

      return true;
    };

    var setLayerVisibility = function (count) {
      var total = viewerState.layerGroups.length;
      var clamped = Math.max(0, Math.min(count, total));
      var highlightIndex = clamped - 1;

      viewerState.layerGroups.forEach(function (entry, index) {
        var visible = index < clamped;
        entry.group.visible = visible;
        entry.meshes.forEach(function (item) {
          if (item.mesh && item.mesh.material) {
            var isHighlight = index === highlightIndex;
            item.mesh.material.color.setHex(isHighlight ? COLOR_HIGHLIGHT : COLOR_DEFAULT);
            item.mesh.material.opacity = isHighlight ? 0.92 : 0.55;
          }
          if (item.edges && item.edges.material) {
            var edgesHighlight = index === highlightIndex;
            item.edges.material.color.setHex(edgesHighlight ? EDGE_HIGHLIGHT : EDGE_DEFAULT);
            item.edges.material.opacity = edgesHighlight ? 1 : 0.7;
          }
        });
      });

      viewerState.currentVisibleLayers = clamped;
    };

    var updateLayerControls = function () {
      if (!viewerState.label || !viewerState.upBtn || !viewerState.downBtn) {
        return;
      }

      var total = viewerState.layerGroups.length;
      var current = viewerState.currentVisibleLayers;

      if (total === 0) {
        viewerState.label.textContent = 'Layer 0 of 0';
        viewerState.upBtn.disabled = true;
        viewerState.downBtn.disabled = true;
        return;
      }

      if (current < 1) {
        current = 1;
        viewerState.currentVisibleLayers = 1;
      }

      var labelText = 'Layer ' + current + ' of ' + total;
      if (current === 1) {
        labelText += ' (Base)';
      }
      viewerState.label.textContent = labelText;
      viewerState.downBtn.disabled = current <= 1;
      viewerState.upBtn.disabled = current >= total;
    };

    var renderFrame = function () {
      if (!viewerState.renderer || !viewerState.scene || !viewerState.camera) {
        return;
      }
      viewerState.animationFrame = requestAnimationFrame(renderFrame);
      viewerState.renderer.render(viewerState.scene, viewerState.camera);
    };

    var startRenderLoop = function () {
      if (!viewerState.renderer || !viewerState.scene || !viewerState.camera) {
        return;
      }

      viewerState.animationFrame = null;

      if (typeof viewerState.renderer.setAnimationLoop === 'function') {
        viewerState.renderer.setAnimationLoop(function () {
          if (!viewerState.scene || !viewerState.camera) {
            viewerState.renderer.setAnimationLoop(null);
            viewerState.animationLoopActive = false;
            return;
          }
          viewerState.renderer.render(viewerState.scene, viewerState.camera);
        });
        viewerState.animationLoopActive = true;
      } else {
        renderFrame();
      }
    };

    var openViewer = function (pallet) {
      if (!viewerState.modal || !viewerState.canvas || !pallet) {
        return;
      }

      if (!window.THREE || typeof THREE.WebGLRenderer !== 'function') {
        setStatus('3D preview unavailable (missing renderer).', 'error');
        return;
      }

      if (!ensureRenderer()) {
        return;
      }

      cancelAnimation();

      if (!buildPalletScene(pallet)) {
        return;
      }

      setLayerVisibility(viewerState.layerGroups.length ? 1 : 0);
      updateLayerControls();

      viewerState.modal.classList.add('is-visible');
      viewerState.modal.setAttribute('aria-hidden', 'false');
      if (viewerState.closeBtn) {
        viewerState.closeBtn.focus();
      }

      startRenderLoop();
    };

    var closeViewer = function () {
      if (!viewerState.modal || !isViewerOpen()) {
        return;
      }

      viewerState.modal.classList.remove('is-visible');
      viewerState.modal.setAttribute('aria-hidden', 'true');

      cancelAnimation();
      clearScene();

      if (viewerState.renderer) {
        viewerState.renderer.clear();
      }

      updateLayerControls();
    };

    var showNextLayer = function () {
      if (!viewerState.layerGroups.length) {
        return;
      }
      var next = Math.min(viewerState.currentVisibleLayers + 1, viewerState.layerGroups.length);
      if (next !== viewerState.currentVisibleLayers) {
        setLayerVisibility(next);
        updateLayerControls();
      }
    };

    var showPreviousLayer = function () {
      if (!viewerState.layerGroups.length) {
        return;
      }
      var next = Math.max(1, viewerState.currentVisibleLayers - 1);
      if (next !== viewerState.currentVisibleLayers) {
        setLayerVisibility(next);
        updateLayerControls();
      }
    };

    (function attachViewerEvents() {
      if (!viewerState.modal) {
        return;
      }

      if (viewerState.closeBtn) {
        viewerState.closeBtn.addEventListener('click', function () {
          closeViewer();
        });
      }

      if (viewerState.upBtn) {
        viewerState.upBtn.addEventListener('click', function () {
          showNextLayer();
        });
      }

      if (viewerState.downBtn) {
        viewerState.downBtn.addEventListener('click', function () {
          showPreviousLayer();
        });
      }

      viewerState.modal.addEventListener('click', function (event) {
        if (event.target === viewerState.modal) {
          closeViewer();
        }
      });

      document.addEventListener('keydown', function (event) {
        if (!isViewerOpen()) {
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeViewer();
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          showNextLayer();
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          showPreviousLayer();
        }
      });

      window.addEventListener('resize', function () {
        updateRendererSize();
      });

      updateLayerControls();
    }());

    var renderErrors = function (errors) {
      if (!parseErrorsEl) {
        return;
      }
      parseErrorsEl.innerHTML = '';
      parseErrorsEl.classList.remove('is-visible');

      if (!errors || !errors.length) {
        return;
      }

      parseErrorsEl.classList.add('is-visible');
      errors.forEach(function (error) {
        var li = document.createElement('li');
        li.textContent = error;
        parseErrorsEl.appendChild(li);
      });
    };

    var updateAlgorithmAvailability = function (totalCount) {
      if (!algorithmSelect) {
        return;
      }
      var bruteOption = algorithmSelect.querySelector('option[value="bruteforce"]');
      if (!bruteOption) {
        return;
      }

      if (!Number.isFinite(totalCount) || totalCount <= 0) {
        bruteOption.disabled = true;
        if (bruteNoteEl) {
          bruteNoteEl.textContent = 'Load items to evaluate algorithm options.';
        }
        if (algorithmSelect.value === 'bruteforce') {
          algorithmSelect.value = 'laff';
        }
        return;
      }

      if (totalCount >= 8) {
        bruteOption.disabled = true;
        if (algorithmSelect.value === 'bruteforce') {
          algorithmSelect.value = 'laff';
        }
        if (bruteNoteEl) {
          bruteNoteEl.textContent = 'Bruteforce requires fewer than 8 total items. Current total: ' + totalCount + '.';
        }
      } else {
        bruteOption.disabled = false;
        if (bruteNoteEl) {
          bruteNoteEl.textContent = 'Bruteforce available. Current total items: ' + totalCount + '.';
        }
      }
    };

    var renderPreview = function () {
      if (!tableBody) {
        return;
      }

      tableBody.innerHTML = '';

      if (!state.items.length) {
        var emptyRow = document.createElement('tr');
        emptyRow.className = 'bin-pack__table-empty';
        var emptyCell = document.createElement('td');
        emptyCell.colSpan = 4;
        emptyCell.textContent = 'Items will appear here after parsing the CSV.';
        emptyRow.appendChild(emptyCell);
        tableBody.appendChild(emptyRow);
      } else {
        state.items.forEach(function (item) {
          var row = document.createElement('tr');
          var idCell = document.createElement('td');
          idCell.textContent = item.id;
          row.appendChild(idCell);

          var sizeCell = document.createElement('td');
          sizeCell.textContent = formatNumber(item.w, 0) + ' x ' + formatNumber(item.d, 0) + ' x ' + formatNumber(item.h, 0) + ' mm';
          row.appendChild(sizeCell);

          var weightCell = document.createElement('td');
          weightCell.textContent = formatNumber(item.weight) + ' kg';
          row.appendChild(weightCell);

          var qtyCell = document.createElement('td');
          qtyCell.textContent = String(item.qty);
          row.appendChild(qtyCell);

          tableBody.appendChild(row);
        });
      }

      var uniqueIds = new Set();
      var totalCount = 0;
      state.items.forEach(function (item) {
        uniqueIds.add(item.id);
        totalCount += item.qty;
      });

      if (uniqueCountEl) {
        uniqueCountEl.textContent = String(uniqueIds.size);
      }
      if (totalCountEl) {
        totalCountEl.textContent = String(totalCount);
      }
      if (totalWeightEl) {
        totalWeightEl.textContent = formatNumber(state.totalWeight);
      }

      updateAlgorithmAvailability(totalCount);
    };

    var applyParseResult = function (result) {
      state.items = result.items || [];
      state.totalWeight = result.totalWeight || 0;
      renderErrors(result.errors);
      renderPreview();
    };

    var parseFromTextarea = function () {
      var value = textarea ? textarea.value : '';
      if (!value || !value.trim()) {
        state.items = [];
        state.totalWeight = 0;
        renderErrors([]);
        renderPreview();
        return;
      }
      var result = parseItems(value);
      applyParseResult(result);
    };

    var readFile = function (file) {
      if (!file) {
        return;
      }

      var reader = new FileReader();
      reader.onload = function (event) {
        var text = event.target && event.target.result ? String(event.target.result) : '';
        if (textarea) {
          textarea.value = text;
        }
        parseFromTextarea();
      };
      reader.onerror = function () {
        setStatus('Failed to read the CSV file.', 'error');
      };
      reader.readAsText(file);
    };

    var resetResults = function () {
      if (outputEl) {
        outputEl.innerHTML = '';
        var placeholder = document.createElement('p');
        placeholder.className = 'bin-pack__placeholder';
        placeholder.textContent = 'No packing requests submitted yet.';
        outputEl.appendChild(placeholder);
      }
      if (metaSummaryEl) {
        metaSummaryEl.hidden = true;
      }
      if (viewerState) {
        if (isViewerOpen()) {
          closeViewer();
        }
        viewerState.pallets = [];
        updateLayerControls();
      }
    };

    var renderMeta = function (meta, payload, totalCount) {
      if (!metaSummaryEl || !metaAlgorithmEl || !metaContainerEl || !metaItemsEl) {
        return;
      }

      if (!meta) {
        metaSummaryEl.hidden = true;
        return;
      }

      metaAlgorithmEl.textContent = meta.algorithm || (payload && payload.algorithm) || '--';

      if (payload && payload.container) {
        var container = payload.container;
        var parts = [
          container.id || meta.containerId || 'container',
          '(' + formatNumber(container.w, 0) + ' x ' + formatNumber(container.d, 0) + ' x ' + formatNumber(container.h, 0) + ' mm',
          'empty ' + formatNumber(container.emptyWeight) + ' kg',
          'max ' + formatNumber(container.maxLoadWeight) + ' kg)',
        ];
        metaContainerEl.textContent = parts.join(' ');
      } else if (meta.containerId) {
        metaContainerEl.textContent = meta.containerId;
      } else {
        metaContainerEl.textContent = '--';
      }

      var countValue = meta.totalItemCount;
      if (!Number.isFinite(countValue) && Number.isFinite(totalCount)) {
        countValue = totalCount;
      }
      metaItemsEl.textContent = Number.isFinite(countValue) ? String(countValue) : '--';

      metaSummaryEl.hidden = false;
    };

    var createElement = function (tag, className, text) {
      var element = document.createElement(tag);
      if (className) {
        element.className = className;
      }
      if (text) {
        element.textContent = text;
      }
      return element;
    };

    var renderResult = function (data) {
      if (!outputEl) {
        return;
      }

      outputEl.innerHTML = '';

      if (!data) {
        var empty = createElement('p', 'bin-pack__placeholder', 'No result returned from the API.');
        outputEl.appendChild(empty);
        return;
      }

      if (viewerState) {
        if (isViewerOpen()) {
          closeViewer();
        }
        viewerState.pallets = [];
      }

      var summaryCard = createElement('div', 'bin-pack__result-card');
      var summaryHeader = createElement('div', 'bin-pack__result-header');
      summaryHeader.appendChild(createElement('div', 'bin-pack__result-title', 'Summary'));
      summaryHeader.appendChild(createElement('div', 'bin-pack__result-subtitle', data.success === false ? 'Failed' : 'Completed'));
      summaryCard.appendChild(summaryHeader);

      var summaryBody = createElement('div', 'bin-pack__result-body');
      var summaryGrid = createElement('div', 'bin-pack__summary');

      var used = Number.isFinite(data.containersUsed) ? data.containersUsed : (Array.isArray(data.pallets) ? data.pallets.length : 0);
      summaryGrid.appendChild(createElement('div', null, 'Containers used: ' + used));

      if (typeof data.note === 'string' && data.note.trim()) {
        var note = createElement('p', 'bin-pack__note', data.note);
        summaryBody.appendChild(note);
      }

      summaryBody.appendChild(summaryGrid);
      summaryCard.appendChild(summaryBody);
      outputEl.appendChild(summaryCard);

      if (Array.isArray(data.pallets) && data.pallets.length) {
        data.pallets.forEach(function (pallet, index) {
          var placements = Array.isArray(pallet.placements) ? pallet.placements : [];
          var layers = computeLayers(placements);
          var layerCount = layers.length;

          var containerForViewer = {
            w: Number(pallet.w) || 0,
            d: Number(pallet.d) || 0,
            h: Number(pallet.h) || 0,
          };

          var storedIndex = -1;
          if (viewerState) {
            storedIndex = viewerState.pallets.length;
            viewerState.pallets.push({
              container: containerForViewer,
              layers: layers,
            });
          }

          var card = createElement('div', 'bin-pack__result-card');
          var header = createElement('div', 'bin-pack__result-header');
          var titleText = 'Container ' + (pallet.containerId || pallet.id || (index + 1));
          header.appendChild(createElement('div', 'bin-pack__result-title', titleText));
          header.appendChild(createElement('div', 'bin-pack__result-subtitle', 'Index ' + (Number.isFinite(pallet.index) ? pallet.index : index)));
          card.appendChild(header);

          var body = createElement('div', 'bin-pack__result-body');
          var summaryInfo = createElement('div', 'bin-pack__summary');
          summaryInfo.appendChild(createElement('div', null, 'Size: ' + formatNumber(pallet.w, 0) + ' x ' + formatNumber(pallet.d, 0) + ' x ' + formatNumber(pallet.h, 0) + ' mm'));
          summaryInfo.appendChild(createElement('div', null, 'Layers: ' + layerCount));
          body.appendChild(summaryInfo);

          var buildPlacementListItem = function (placement) {
            var item = createElement('li', 'bin-pack__placement');
            var strong = createElement('strong', null, placement.itemId || 'Item');
            item.appendChild(strong);
            var detail = [
              'origin (' + formatNumber(placement.x, 0) + ', ' + formatNumber(placement.y, 0) + ', ' + formatNumber(placement.z, 0) + ') mm',
              'size ' + formatNumber(placement.w, 0) + ' x ' + formatNumber(placement.d, 0) + ' x ' + formatNumber(placement.h, 0) + ' mm',
              'rotation ' + (placement.rotation || 'default'),
            ].join(' | ');
            item.appendChild(createElement('span', null, ' ' + detail));
            return item;
          };

          if (placements.length && storedIndex >= 0) {
            var previewBtn = createElement('button', 'bin-pack__preview-btn', 'Preview 3D');
            previewBtn.type = 'button';
            previewBtn.addEventListener('click', function () {
              var palletData = viewerState.pallets[storedIndex];
              if (!palletData) {
                return;
              }
              openViewer(palletData);
            });
            body.appendChild(previewBtn);
          }

          if (placements.length) {
            if (layerCount) {
              var layersContainer = createElement('div', 'bin-pack__layers');
              layers.forEach(function (layer) {
                var layerCard = createElement('div', 'bin-pack__layer');
                if (layer.start <= EPSILON) {
                  layerCard.classList.add('bin-pack__layer--base');
                }

                var layerHeader = createElement('div', 'bin-pack__layer-header');
                var titleLabel = 'Layer ' + layer.index + (layer.start <= EPSILON ? ' (Base)' : '');
                layerHeader.appendChild(createElement('div', 'bin-pack__layer-title', titleLabel));

                var hasStart = Number.isFinite(layer.start);
                var hasEnd = Number.isFinite(layer.end);
                if (hasStart || hasEnd) {
                  var startText = hasStart ? formatNumber(layer.start, 0) : '';
                  var endText = hasEnd ? formatNumber(layer.end, 0) : '';
                  var rangeText = '';
                  if (hasStart && hasEnd) {
                    rangeText = startText + ' - ' + endText + ' mm';
                  } else if (hasStart) {
                    rangeText = startText + ' mm';
                  } else if (hasEnd) {
                    rangeText = endText + ' mm';
                  }
                  if (rangeText) {
                    layerHeader.appendChild(createElement('div', 'bin-pack__layer-range', rangeText));
                  }
                }

                layerCard.appendChild(layerHeader);

                var layerList = createElement('ul', 'bin-pack__placement-list');
                layer.placements.forEach(function (placement) {
                  layerList.appendChild(buildPlacementListItem(placement));
                });
                layerCard.appendChild(layerList);
                layersContainer.appendChild(layerCard);
              });
              body.appendChild(layersContainer);
            } else {
              var fallbackList = createElement('ul', 'bin-pack__placement-list');
              placements.forEach(function (placement) {
                fallbackList.appendChild(buildPlacementListItem(placement));
              });
              body.appendChild(fallbackList);
            }
          } else {
            body.appendChild(createElement('p', 'bin-pack__placeholder', 'No placements returned for this container.'));
          }

          card.appendChild(body);
          outputEl.appendChild(card);
        });
      }

      if (Array.isArray(data.notPlaced) && data.notPlaced.length) {
        var notPlacedCard = createElement('div', 'bin-pack__result-card');
        var notPlacedHeader = createElement('div', 'bin-pack__result-header');
        notPlacedHeader.appendChild(createElement('div', 'bin-pack__result-title', 'Not placed'));
        notPlacedCard.appendChild(notPlacedHeader);

        var notPlacedList = createElement('ul', 'bin-pack__not-placed');
        data.notPlaced.forEach(function (entry) {
          var listItem = createElement('li', 'bin-pack__not-placed-item');
          var reason = entry.reason ? ' - ' + entry.reason : '';
          listItem.textContent = (entry.itemId || 'Item') + ' x ' + String(entry.count || 0) + reason;
          notPlacedList.appendChild(listItem);
        });

        notPlacedCard.appendChild(notPlacedList);
        outputEl.appendChild(notPlacedCard);
      }
    };

    var collectPayload = function () {
      var errors = [];
      var containerId = (form.elements.containerId && form.elements.containerId.value || '').trim();
      var width = Number(form.elements.containerWidth && form.elements.containerWidth.value);
      var depth = Number(form.elements.containerDepth && form.elements.containerDepth.value);
      var height = Number(form.elements.containerHeight && form.elements.containerHeight.value);
      var emptyWeight = Number(form.elements.containerEmptyWeight && form.elements.containerEmptyWeight.value);
      var maxLoadWeight = Number(form.elements.containerMaxLoadWeight && form.elements.containerMaxLoadWeight.value);

      if (!containerId) errors.push('Container ID is required.');
      if (!Number.isFinite(width) || width <= 0) errors.push('Container width must be greater than 0.');
      if (!Number.isFinite(depth) || depth <= 0) errors.push('Container depth must be greater than 0.');
      if (!Number.isFinite(height) || height <= 0) errors.push('Container height must be greater than 0.');
      if (!Number.isFinite(emptyWeight) || emptyWeight < 0) errors.push('Empty weight must be zero or more.');
      if (!Number.isFinite(maxLoadWeight) || maxLoadWeight < 0) errors.push('Max load weight must be zero or more.');

      if (!state.items.length) {
        errors.push('Add at least one item to run the packing request.');
      }

      var algorithm = algorithmSelect ? algorithmSelect.value : 'laff';

      var payload = {
        algorithm: algorithm || 'laff',
        container: {
          id: containerId,
          w: width,
          d: depth,
          h: height,
          emptyWeight: emptyWeight,
          maxLoadWeight: maxLoadWeight,
        },
        items: state.items.map(function (item) {
          return {
            id: item.id,
            w: item.w,
            d: item.d,
            h: item.h,
            weight: item.weight,
            qty: item.qty,
          };
        }),
      };

      return { payload: payload, errors: errors };
    };

    var handleSubmit = function (event) {
      event.preventDefault();

      setStatus('', null);

      var collected = collectPayload();
      if (collected.errors.length) {
        setStatus(collected.errors.join(' '), 'error');
        return;
      }

      var payload = collected.payload;
      var totalCount = state.items.reduce(function (sum, item) {
        return sum + item.qty;
      }, 0);

      if (payload.algorithm === 'bruteforce' && totalCount >= 8) {
        setStatus('Bruteforce algorithm is limited to fewer than 8 total items.', 'error');
        return;
      }

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Running...';
      }

      setStatus('Submitting packing request...', 'info');

      fetch('/binpacking/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
        .then(function (response) {
          if (!response.ok) {
            return response.json().catch(function () {
              return null;
            }).then(function (body) {
              var message = body && body.message ? body.message : 'The bin packing request failed.';
              throw new Error(message);
            });
          }
          return response.json();
        })
        .then(function (data) {
          if (!data || data.success === false) {
            var message = data && data.message ? data.message : 'The bin packing service returned an error.';
            setStatus(message, 'error');
          } else {
            setStatus('Packing completed successfully.', 'success');
          }
          renderMeta(data && data.meta, payload, totalCount);
          renderResult(data && data.data);
        })
        .catch(function (error) {
          setStatus(error.message || 'The bin packing request failed.', 'error');
          resetResults();
        })
        .finally(function () {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Run packing';
          }
        });
    };

    if (fileInput) {
      fileInput.addEventListener('change', function (event) {
        var file = event.target && event.target.files ? event.target.files[0] : null;
        if (file) {
          readFile(file);
        }
      });
    }

    if (textarea) {
      textarea.addEventListener('input', parseFromTextarea);
    }

    if (sampleBtn && textarea) {
      sampleBtn.addEventListener('click', function () {
        textarea.value = SAMPLE_CSV;
        parseFromTextarea();
      });
    }

    if (clearBtn && textarea) {
      clearBtn.addEventListener('click', function () {
        textarea.value = '';
        if (fileInput) {
          fileInput.value = '';
        }
        parseFromTextarea();
        resetResults();
        setStatus('', null);
      });
    }

    form.addEventListener('submit', handleSubmit);
    resetResults();
  });
})();
