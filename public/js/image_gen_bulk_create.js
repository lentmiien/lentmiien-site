// public/js/image_gen_bulk_create.js
(function(){
  const jobForm = document.getElementById('jobForm');
  const instanceSelect = document.getElementById('instanceSelect');
  const instanceSummary = document.getElementById('instanceSummary');
  const reloadInstancesBtn = document.getElementById('reloadInstancesBtn');
  const workflowSelect = document.getElementById('workflowSelect');
  const workflowInputs = document.getElementById('workflowInputs');
  const addTemplateBtn = document.getElementById('addTemplateBtn');
  const templateList = document.getElementById('templateList');
  const templateEmptyAlert = document.getElementById('templateEmptyAlert');
  const addPlaceholderBtn = document.getElementById('addPlaceholderBtn');
  const placeholderList = document.getElementById('placeholderList');
  const placeholderHint = document.getElementById('placeholderHint');
  const negativePrompt = document.getElementById('negativePrompt');
  const summaryPrompts = document.getElementById('summaryPrompts');
  const summaryPlaceholders = document.getElementById('summaryPlaceholders');
  const summaryCombinations = document.getElementById('summaryCombinations');
  const formStatus = document.getElementById('formStatus');
  const submitBtn = document.getElementById('submitBtn');
  const workflowImageInputs = document.getElementById('workflowImageInputs');
  const imageInputList = document.getElementById('imageInputList');
  const imageInputAlert = document.getElementById('imageInputAlert');
  const summaryImages = document.getElementById('summaryImages');

  const IMAGE_INPUT_KEYS = ['image', 'image2', 'image3'];
  const DEFAULT_INSTANCE_KEY = '__default__';

  const state = {
    instances: [],
    instanceMap: new Map(),
    currentInstanceId: null,
    workflows: [],
    workflowMap: new Map(),
    currentImageSpecs: []
  };

  function toInstanceKey(value) {
    const normalized = typeof value === 'string' ? value.trim() : value;
    return normalized ? String(normalized) : DEFAULT_INSTANCE_KEY;
  }

  function isPlainObject(value) {
    if (!value || typeof value !== 'object') return false;
    if (value instanceof FormData) return false;
    if (value instanceof URLSearchParams) return false;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return false;
    if (typeof ArrayBuffer !== 'undefined') {
      if (value instanceof ArrayBuffer) return false;
      if (ArrayBuffer.isView && ArrayBuffer.isView(value)) return false;
    }
    return Object.getPrototypeOf(value) === Object.prototype;
  }

  function withInstanceParam(url, instanceId) {
    if (!instanceId || !url) return url;
    if (url.includes('instance_id=')) return url;
    const hashIndex = url.indexOf('#');
    let base = url;
    let hash = '';
    if (hashIndex >= 0) {
      hash = base.slice(hashIndex);
      base = base.slice(0, hashIndex);
    }
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}instance_id=${encodeURIComponent(instanceId)}${hash}`;
  }

  function setInstanceSummary(text) {
    if (instanceSummary) instanceSummary.textContent = text || '';
  }

  function describeInstance(inst) {
    if (!inst) return '';
    const parts = [];
    const name = inst.name || inst.id;
    if (name) parts.push(name);
    if (inst.bulk_queue) {
      const pending = Number(inst.bulk_queue.pending || 0);
      const processing = Number(inst.bulk_queue.processing || 0);
      const total = Number(inst.bulk_queue.total || pending + processing);
      const queueParts = [];
      queueParts.push(`pending ${pending}`);
      if (processing) queueParts.push(`processing ${processing}`);
      parts.push(`Bulk queue ${total} (${queueParts.join(', ')})`);
    }
    if (Array.isArray(inst.workflows)) {
      const count = inst.workflows.length;
      parts.push(`${count} workflow${count === 1 ? '' : 's'}`);
    }
    return parts.join(' • ');
  }

  function renderInstanceSummary() {
    const key = state.currentInstanceId;
    const inst = key ? state.instanceMap.get(key) : null;
    setInstanceSummary(describeInstance(inst) || 'Select an instance to load workflows.');
  }

  async function api(path, init = {}) {
    const opts = Object.assign({ headers: {} }, init);
    const skipInstance = Boolean(opts.skipInstance);
    if ('skipInstance' in opts) delete opts.skipInstance;

    const method = (opts.method || 'GET').toUpperCase();
    opts.method = method;

    let url = `/image_gen${path}`;
    const instanceId = state.currentInstanceId;

    if (!skipInstance && instanceId) {
      if (method === 'GET' || method === 'HEAD') {
        url = withInstanceParam(url, instanceId);
      } else if (opts.body instanceof FormData) {
        if (!opts.body.has('instance_id')) opts.body.append('instance_id', instanceId);
      } else if (isPlainObject(opts.body)) {
        const payload = Object.assign({}, opts.body);
        if (!payload.instance_id && !payload.instanceId) payload.instance_id = instanceId;
        opts.body = JSON.stringify(payload);
        opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      } else if (typeof opts.body === 'string' && opts.body.trim()) {
        try {
          const parsed = JSON.parse(opts.body);
          if (parsed && typeof parsed === 'object' && !parsed.instance_id && !parsed.instanceId) {
            parsed.instance_id = instanceId;
          }
          opts.body = JSON.stringify(parsed);
          opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
        } catch (_) {
          url = withInstanceParam(url, instanceId);
        }
      } else {
        opts.body = JSON.stringify({ instance_id: instanceId });
        opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
      }
    } else if (isPlainObject(opts.body)) {
      opts.body = JSON.stringify(opts.body);
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    }

    const resp = await fetch(url, opts);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${resp.status} ${resp.statusText} — ${text}`.trim());
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return resp.json();
    return resp;
  }

  function populateInstanceOptions(list, options = {}) {
    if (!instanceSelect) return;
    const preserveSelection = Boolean(options.preserveSelection);
    const previous = instanceSelect.value;
    instanceSelect.innerHTML = '';
    if (!Array.isArray(list) || !list.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No instances available';
      opt.disabled = true;
      opt.selected = true;
      instanceSelect.appendChild(opt);
      instanceSelect.disabled = true;
      return;
    }
    const ids = [];
    list.forEach((inst) => {
      if (!inst || !inst.id) return;
      const opt = document.createElement('option');
      opt.value = inst.id;
      opt.textContent = inst.name || inst.id;
      instanceSelect.appendChild(opt);
      ids.push(inst.id);
    });
    let desired = options.selectedId || null;
    if (!desired && preserveSelection && previous && ids.includes(previous)) {
      desired = previous;
    }
    if (!desired && state.currentInstanceId && ids.includes(state.currentInstanceId)) {
      desired = state.currentInstanceId;
    }
    if (!desired && options.defaultId && ids.includes(options.defaultId)) {
      desired = options.defaultId;
    }
    if (!desired) {
      desired = ids[0] || '';
    }
    instanceSelect.value = desired || '';
    instanceSelect.disabled = false;
  }

  function determineDefaultInstanceId(list, payload) {
    if (!Array.isArray(list) || !list.length) return null;
    const declared = typeof payload?.default_instance_id === 'string' ? payload.default_instance_id : null;
    if (declared && list.some(inst => inst && inst.id === declared)) return declared;
    const flagged = list.find(inst => inst && (inst.default === true || inst.is_default === true));
    if (flagged && flagged.id) return flagged.id;
    return list[0]?.id || null;
  }

  async function changeInstance(rawId, options = {}) {
    const normalized = rawId ? String(rawId) : null;
    if (state.currentInstanceId === normalized && !options.forceReload) {
      renderInstanceSummary();
      return;
    }
    state.currentInstanceId = normalized;
    if (!options.skipPopulate && instanceSelect) {
      instanceSelect.value = normalized || '';
    }
    renderInstanceSummary();
    await loadWorkflows();
  }

  async function loadInstances(options = {}) {
    if (instanceSelect) instanceSelect.disabled = true;
    if (reloadInstancesBtn) reloadInstancesBtn.disabled = true;
    setInstanceSummary('Loading instances…');
    try {
      const payload = await api('/api/instances', { skipInstance: true });
      const list = Array.isArray(payload?.instances) ? payload.instances : [];
      state.instances = list;
      state.instanceMap = new Map(list.filter(inst => inst && inst.id).map(inst => [inst.id, inst]));
      const defaultId = determineDefaultInstanceId(list, payload);
      populateInstanceOptions(list, {
        selectedId: options.preserveSelection ? state.currentInstanceId : defaultId,
        preserveSelection: options.preserveSelection,
        defaultId
      });
      const nextId = (() => {
        if (options.preserveSelection && state.currentInstanceId && state.instanceMap.has(state.currentInstanceId)) {
          return state.currentInstanceId;
        }
        if (instanceSelect && instanceSelect.value) return instanceSelect.value;
        return defaultId;
      })();
      await changeInstance(nextId || null, { forceReload: true, skipPopulate: true });
    } catch (err) {
      state.instances = [];
      state.instanceMap = new Map();
      state.currentInstanceId = null;
      populateInstanceOptions([]);
      setInstanceSummary(err?.message ? `Failed to load instances: ${err.message}` : 'Failed to load instances.');
      workflowSelect.disabled = true;
      workflowInputs.innerHTML = '<div class="text-danger">Unable to load workflows without an instance.</div>';
      throw err;
    } finally {
      if (instanceSelect) instanceSelect.disabled = !state.instances.length;
      if (reloadInstancesBtn) reloadInstancesBtn.disabled = false;
    }
  }

  function renderWorkflowList() {
    const previousValue = workflowSelect.value;
    workflowSelect.innerHTML = '';
    if (!state.workflows.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No workflows available';
      opt.disabled = true;
      opt.selected = true;
      workflowSelect.appendChild(opt);
      return;
    }
    state.workflows.forEach((wf) => {
      const opt = document.createElement('option');
      opt.value = wf.key;
      const labelParts = [wf.name || wf.key];
      if (wf.outputType) { labelParts.push('· ' + wf.outputType.toUpperCase()); }
      opt.textContent = labelParts.join(' ');
      workflowSelect.appendChild(opt);
    });
    const validKeys = new Set(state.workflows.map((wf) => wf.key));
    const desired = validKeys.has(previousValue) ? previousValue : state.workflows[0].key;
    workflowSelect.value = desired || '';
  }

  function createInputControl(spec) {
    const col = document.createElement('div');
    col.className = 'col-12 col-md-6';
    const id = `wfInp_${spec.key}`;

    const label = document.createElement('label');
    label.className = 'form-label';
    label.setAttribute('for', id);
    label.textContent = spec.key + (spec.required ? ' *' : '');
    col.appendChild(label);

    const isSpecialPrompt = spec.key === 'prompt' || spec.key === 'negative';
    let ctrl;
    if (spec.type === 'string' && !isSpecialPrompt) {
      ctrl = document.createElement('textarea');
      ctrl.className = 'form-control';
      ctrl.rows = 3;
    } else if (spec.type === 'number') {
      ctrl = document.createElement('input');
      ctrl.type = 'number';
      ctrl.className = 'form-control';
      if (spec.min !== undefined) ctrl.min = spec.min;
      if (spec.max !== undefined) ctrl.max = spec.max;
      if (spec.step !== undefined) ctrl.step = spec.step;
    } else {
      ctrl = document.createElement('input');
      ctrl.type = 'text';
      ctrl.className = 'form-control';
    }
    ctrl.id = id;
    if (spec.default !== undefined && !isSpecialPrompt) ctrl.value = spec.default;
    if (isSpecialPrompt) {
      ctrl.value = '(managed per template)';
      ctrl.disabled = true;
      ctrl.classList.add('bg-dark');
    }
    col.appendChild(ctrl);

    if (spec.note || spec.default !== undefined) {
      const small = document.createElement('small');
      small.className = 'text-soft';
      const parts = [];
      if (spec.note) parts.push(spec.note);
      if (spec.default !== undefined && !isSpecialPrompt) parts.push(`default: ${spec.default}`);
      small.textContent = parts.join(' • ');
      col.appendChild(small);
    }
    return col;
  }

  function renderWorkflowInputs() {
    const key = workflowSelect.value;
    const def = state.workflowMap.get(key);
    workflowInputs.innerHTML = '';
    state.currentImageSpecs = [];
    if (!def) {
      workflowInputs.innerHTML = '<div class="text-soft">Select a workflow to configure base inputs.</div>';
      renderImageInputs([]);
      return;
    }
    const row = document.createElement('div');
    row.className = 'row g-3';
    const imageSpecs = [];
    let hasBaseInputs = false;
    def.inputs.forEach((spec) => {
      if (IMAGE_INPUT_KEYS.includes(spec.key)) {
        imageSpecs.push(spec);
        return;
      }
      hasBaseInputs = true;
      row.appendChild(createInputControl(spec));
    });
    if (hasBaseInputs) {
      workflowInputs.appendChild(row);
    } else {
      workflowInputs.innerHTML = '<div class="text-soft">This workflow has no additional base inputs.</div>';
    }
    renderImageInputs(imageSpecs);
  }

  function renderImageInputs(specs = []) {
    if (!workflowImageInputs || !imageInputList || !imageInputAlert) return;
    imageInputList.innerHTML = '';
    state.currentImageSpecs = Array.isArray(specs) ? specs.slice() : [];
    if (!state.currentImageSpecs.length) {
      workflowImageInputs.classList.add('d-none');
      imageInputAlert.classList.add('d-none');
      updateSummary();
      return;
    }
    workflowImageInputs.classList.remove('d-none');
    state.currentImageSpecs.forEach((spec) => {
      if (!spec || !spec.key) return;
      const wrapper = document.createElement('div');
      wrapper.className = 'placeholder-item';
      wrapper.dataset.imageKey = spec.key;

      const title = document.createElement('h3');
      title.className = 'mb-2';
      title.textContent = spec.key + (spec.required ? ' *' : '');
      wrapper.appendChild(title);

      const textarea = document.createElement('textarea');
      textarea.className = 'form-control image-input-values';
      textarea.rows = 4;
      textarea.id = `wfImg_${spec.key}`;
      textarea.dataset.imageKey = spec.key;
      textarea.placeholder = 'example.png\nexample-2.png';
      if (Array.isArray(spec.default)) {
        textarea.value = spec.default.join('\n');
      } else if (spec.default) {
        textarea.value = spec.default;
      }
      textarea.addEventListener('input', updateSummary);
      wrapper.appendChild(textarea);

      const note = document.createElement('small');
      note.className = 'text-soft';
      const noteParts = ['Enter one filename per line.'];
      if (spec.note) noteParts.push(spec.note);
      note.textContent = noteParts.join(' ');
      wrapper.appendChild(note);

      imageInputList.appendChild(wrapper);
    });
    updateSummary();
  }

  function extractPlaceholdersFromTemplates() {
    const regex = /{{\s*([\w.-]+)\s*}}/g;
    const set = new Set();
    templateList.querySelectorAll('textarea.template-text').forEach(textarea => {
      const text = textarea.value || '';
      let match;
      while ((match = regex.exec(text)) !== null) {
        set.add(match[1]);
      }
    });
    return Array.from(set);
  }

  function findPlaceholderItem(name) {
    return placeholderList.querySelector(`[data-placeholder="${name}"]`);
  }

  function addTemplate(initial = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'template-item';

    const header = document.createElement('div');
    header.className = 'd-flex justify-content-between align-items-center mb-2';
    const title = document.createElement('h3');
    title.className = 'mb-0';
    title.textContent = 'Template';
    header.appendChild(title);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-sm btn-outline-danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      wrapper.remove();
      updateTemplateEmptyState();
      syncPlaceholders();
      updateSummary();
    });
    header.appendChild(removeBtn);

    const labelGroup = document.createElement('div');
    labelGroup.className = 'mb-2';
    const labelLabel = document.createElement('label');
    labelLabel.className = 'form-label';
    labelLabel.textContent = 'Display label';
    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.className = 'form-control template-label';
    labelInput.placeholder = 'e.g. Soft lighting';
    labelInput.value = initial.label || '';
    labelGroup.appendChild(labelLabel);
    labelGroup.appendChild(labelInput);

    const textGroup = document.createElement('div');
    const textLabel = document.createElement('label');
    textLabel.className = 'form-label';
    textLabel.textContent = 'Prompt template';
    const textarea = document.createElement('textarea');
    textarea.className = 'form-control template-text';
    textarea.placeholder = 'e.g. Portrait of {{subject}} lit by {{light}}';
    textarea.rows = 5;
    textarea.value = initial.template || '';
    textarea.addEventListener('input', () => {
      syncPlaceholders();
      updateSummary();
    });
    labelInput.addEventListener('input', updateSummary);
    textGroup.appendChild(textLabel);
    textGroup.appendChild(textarea);

    wrapper.appendChild(header);
    wrapper.appendChild(labelGroup);
    wrapper.appendChild(textGroup);
    templateList.appendChild(wrapper);
    updateTemplateEmptyState();
    syncPlaceholders();
    updateSummary();
  }

  function addPlaceholder(initial = {}) {
    const wrapper = document.createElement('div');
    wrapper.className = 'placeholder-item';
    wrapper.dataset.placeholder = initial.name || '';

    const header = document.createElement('div');
    header.className = 'd-flex justify-content-between align-items-center mb-2';
    const title = document.createElement('h3');
    title.className = 'mb-0';
    title.textContent = 'Placeholder';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-sm btn-outline-danger';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      wrapper.remove();
      updateSummary();
    });
    header.appendChild(title);
    header.appendChild(removeBtn);

    const row = document.createElement('div');
    row.className = 'row g-3 align-items-start';

    const nameCol = document.createElement('div');
    nameCol.className = 'col-md-4';
    const nameLabel = document.createElement('label');
    nameLabel.className = 'form-label';
    nameLabel.textContent = 'Name';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'form-control placeholder-name';
    nameInput.placeholder = 'e.g. subject';
    nameInput.value = initial.name || '';
    nameInput.addEventListener('input', () => {
      wrapper.dataset.placeholder = nameInput.value.trim();
      updateSummary();
    });
    nameCol.appendChild(nameLabel);
    nameCol.appendChild(nameInput);

    const valuesCol = document.createElement('div');
    valuesCol.className = 'col-md-8';
    const valuesLabel = document.createElement('label');
    valuesLabel.className = 'form-label';
    valuesLabel.textContent = 'Values (one per line)';
    const valuesTextarea = document.createElement('textarea');
    valuesTextarea.className = 'form-control placeholder-values';
    valuesTextarea.rows = 4;
    valuesTextarea.placeholder = 'Value A\nValue B';
    valuesTextarea.value = initial.values || '';
    valuesTextarea.addEventListener('input', updateSummary);
    valuesCol.appendChild(valuesLabel);
    valuesCol.appendChild(valuesTextarea);

    row.appendChild(nameCol);
    row.appendChild(valuesCol);

    wrapper.appendChild(header);
    wrapper.appendChild(row);
    placeholderList.appendChild(wrapper);
    updateSummary();
  }

  function updateTemplateEmptyState() {
    const hasTemplates = templateList.querySelector('.template-item');
    if (hasTemplates) {
      templateEmptyAlert.classList.add('d-none');
    } else {
      templateEmptyAlert.classList.remove('d-none');
    }
  }

  function syncPlaceholders() {
    const detected = extractPlaceholdersFromTemplates();
    if (!detected.length) {
      placeholderHint.classList.remove('d-none');
      placeholderHint.textContent = 'No placeholders detected in your templates.';
      return;
    }
    placeholderHint.classList.remove('d-none');
    placeholderHint.textContent = `Detected placeholders: ${detected.join(', ')}. Ensure each has values specified below.`;
    detected.forEach((name) => {
      if (!findPlaceholderItem(name)) {
        addPlaceholder({ name, values: '' });
      }
    });
  }

  function gatherPlaceholderValues() {
    const values = {};
    placeholderList.querySelectorAll('.placeholder-item').forEach((item) => {
      const key = item.querySelector('.placeholder-name')?.value.trim();
      if (!key) return;
      const lines = item.querySelector('.placeholder-values')?.value.split(/\r?\n/) || [];
      const cleaned = lines.map(v => v.trim()).filter(Boolean);
      values[key] = cleaned;
    });
    return values;
  }

  function gatherImageInputValues() {
    const values = {};
    if (!state.currentImageSpecs.length) return values;
    state.currentImageSpecs.forEach((spec) => {
      const key = spec?.key;
      if (!key) return;
      const textarea = imageInputList?.querySelector(`textarea[data-image-key="${key}"]`);
      if (!textarea) {
        values[key] = [];
        return;
      }
      const lines = textarea.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
      values[key] = lines;
    });
    return values;
  }

  function collectImageInputs() {
    const values = gatherImageInputValues();
    if (!state.currentImageSpecs.length) return values;
    const missing = [];
    state.currentImageSpecs.forEach((spec) => {
      const key = spec?.key;
      if (!key) return;
      const entries = values[key] || [];
      if (!entries.length) missing.push(key);
    });
    if (missing.length) {
      throw new Error(`Image input(s) ${missing.join(', ')} require at least one filename.`);
    }
    return values;
  }

  function computeImageMultiplier(imageValues) {
    if (!state.currentImageSpecs.length) return 1;
    let multiplier = 1;
    for (const spec of state.currentImageSpecs) {
      if (!spec || !spec.key) continue;
      const entries = imageValues?.[spec.key] || [];
      if (!entries.length) return 0;
      multiplier *= entries.length;
    }
    return multiplier;
  }

  function computeCombinationEstimate() {
    const templateCount = templateList.querySelectorAll('.template-item').length;
    if (!templateCount) return 0;
    const placeholderValues = gatherPlaceholderValues();
    const detected = extractPlaceholdersFromTemplates();
    let multiplier = 1;
    for (const key of detected) {
      const entries = placeholderValues[key] || [];
      if (!entries.length) return 0;
      multiplier *= entries.length;
    }
    const imageValues = gatherImageInputValues();
    const imageMultiplier = computeImageMultiplier(imageValues);
    if (imageMultiplier === 0) return 0;
    const negativeFactor = negativePrompt.value.trim() ? 2 : 1;
    return templateCount * multiplier * imageMultiplier * negativeFactor;
  }

  function updateSummary() {
    const templateCount = templateList.querySelectorAll('.template-item').length;
    const placeholderCount = placeholderList.querySelectorAll('.placeholder-item').length;
    const imageCount = state.currentImageSpecs.length;
    const placeholderValues = gatherPlaceholderValues();
    const detected = extractPlaceholdersFromTemplates();
    const missingPlaceholders = detected.filter((key) => !(placeholderValues[key] && placeholderValues[key].length));
    const imageValues = gatherImageInputValues();
    const missingImages = state.currentImageSpecs
      .map((spec) => spec?.key)
      .filter((key) => key && !(imageValues[key] && imageValues[key].length));
    const combos = computeCombinationEstimate();

    summaryPrompts.textContent = `${templateCount} template${templateCount === 1 ? '' : 's'}`;
    summaryPlaceholders.textContent = `${placeholderCount} placeholder${placeholderCount === 1 ? '' : 's'}`;
    if (summaryImages) {
      summaryImages.textContent = `${imageCount} image input${imageCount === 1 ? '' : 's'}`;
    }
    summaryCombinations.textContent = `${combos} combination${combos === 1 ? '' : 's'}`;

    if (workflowImageInputs && imageInputAlert) {
      if (state.currentImageSpecs.length && missingImages.length) {
        imageInputAlert.classList.remove('d-none');
        imageInputAlert.textContent = `Add filenames for image input(s): ${missingImages.join(', ')}`;
      } else {
        imageInputAlert.classList.add('d-none');
      }
    }

    if (!templateCount) {
      formStatus.textContent = 'Add at least one template.';
      formStatus.className = 'text-warning';
    } else if (missingPlaceholders.length) {
      formStatus.textContent = `Add values for placeholder(s): ${missingPlaceholders.join(', ')}`;
      formStatus.className = 'text-warning';
    } else if (missingImages.length) {
      formStatus.textContent = `Add filenames for image input(s): ${missingImages.join(', ')}`;
      formStatus.className = 'text-warning';
    } else if (!combos) {
      formStatus.textContent = 'Specify values to produce combinations.';
      formStatus.className = 'text-warning';
    } else {
      formStatus.textContent = `Ready to generate ${combos} variation${combos === 1 ? '' : 's'}.`;
      formStatus.className = 'text-soft';
    }
  }

  function collectBaseInputs() {
    const key = workflowSelect.value;
    const def = state.workflowMap.get(key);
    if (!def) return {};
    const inputs = {};
    for (const spec of def.inputs) {
      if (spec.key === 'prompt' || spec.key === 'negative') continue;
      if (IMAGE_INPUT_KEYS.includes(spec.key)) continue;
      const el = document.getElementById(`wfInp_${spec.key}`);
      if (!el) continue;
      if (spec.type === 'number') {
        const raw = el.value.trim();
        if (raw === '') {
          if (spec.required) {
            throw new Error(`Missing value for ${spec.key}`);
          }
          continue;
        }
        inputs[spec.key] = Number(raw);
      } else {
        const value = el.value;
        if (!value && spec.required) {
          throw new Error(`Missing value for ${spec.key}`);
        }
        if (value) inputs[spec.key] = value;
      }
    }
    return inputs;
  }

  async function loadWorkflows() {
    if (!state.currentInstanceId) {
      state.workflows = [];
      state.workflowMap = new Map();
      renderWorkflowList();
      state.currentImageSpecs = [];
      workflowInputs.innerHTML = '<div class="text-soft">Select an instance to load workflows.</div>';
      updateSummary();
      workflowSelect.disabled = true;
      return;
    }
    workflowSelect.disabled = true;
    workflowInputs.innerHTML = '<div class="text-soft">Loading workflows…</div>';
    try {
      const data = await api('/api/workflows');
      state.workflows = data.workflows || [];
      state.workflowMap = new Map(state.workflows.map(w => [w.key, w]));
      renderWorkflowList();
      renderWorkflowInputs();
      updateSummary();
    } catch (err) {
      state.workflows = [];
      state.workflowMap = new Map();
      renderWorkflowList();
      workflowInputs.innerHTML = `<div class="text-danger">Failed to load workflows: ${err.message}</div>`;
    } finally {
      workflowSelect.disabled = !state.workflows.length;
    }
  }

  function gatherTemplates() {
    const templates = [];
    templateList.querySelectorAll('.template-item').forEach((item) => {
      const label = item.querySelector('.template-label')?.value.trim();
      const template = item.querySelector('.template-text')?.value.trim();
      if (!template) return;
      templates.push({
        label: label || 'Template',
        template
      });
    });
    return templates;
  }

  async function handleSubmit(evt) {
    evt.preventDefault();
    submitBtn.disabled = true;
    try {
      if (!state.currentInstanceId) throw new Error('Select an instance before creating a job.');
      const name = document.getElementById('jobName').value.trim();
      if (!name) throw new Error('Job name is required.');
      if (!workflowSelect.value) throw new Error('Select a workflow.');

      const templates = gatherTemplates();
      if (!templates.length) throw new Error('Add at least one template with prompt text.');

      const placeholderValues = gatherPlaceholderValues();
      const requiredPlaceholders = extractPlaceholdersFromTemplates();
      for (const key of requiredPlaceholders) {
        const values = placeholderValues[key] || [];
        if (!values.length) throw new Error(`Placeholder "${key}" needs at least one value.`);
      }

      const imageInputs = collectImageInputs();

      const baseInputs = collectBaseInputs();
      const payload = {
        name,
        workflow: workflowSelect.value,
        templates,
        placeholderValues,
        negativePrompt: negativePrompt.value,
        baseInputs,
        imageInputs,
        instance_id: state.currentInstanceId
      };

      const resp = await api('/api/bulk/jobs', {
        method: 'POST',
        body: payload
      });
      if (resp?.id) {
        window.location.href = `/image_gen/bulk/${encodeURIComponent(resp.id)}`;
      } else {
        formStatus.textContent = 'Job created but response missing id.';
        formStatus.className = 'text-warning';
      }
    } catch (err) {
      formStatus.textContent = err.message;
      formStatus.className = 'text-danger';
    } finally {
      submitBtn.disabled = false;
    }
  }

  instanceSelect?.addEventListener('change', (e) => {
    changeInstance(e.target.value || null).catch((err) => {
      formStatus.textContent = err.message;
      formStatus.className = 'text-danger';
    });
  });
  reloadInstancesBtn?.addEventListener('click', () => {
    loadInstances({ preserveSelection: true }).catch((err) => {
      formStatus.textContent = err.message;
      formStatus.className = 'text-danger';
    });
  });
  addTemplateBtn?.addEventListener('click', () => addTemplate());
  addPlaceholderBtn?.addEventListener('click', () => addPlaceholder());
  workflowSelect?.addEventListener('change', () => {
    renderWorkflowInputs();
    updateSummary();
  });
  negativePrompt?.addEventListener('input', updateSummary);
  jobForm?.addEventListener('submit', handleSubmit);

  // Initialize with one template by default
  addTemplate();
  renderInstanceSummary();
  loadInstances().catch((err) => {
    formStatus.textContent = err.message;
    formStatus.className = 'text-danger';
  });
})();
