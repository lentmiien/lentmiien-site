// public/js/image_gen_bulk_create.js
(function(){
  const $ = (selector, root = document) => root.querySelector(selector);
  const jobForm = $('#jobForm');
  const instanceSelect = $('#instanceSelect');
  const instanceSummary = $('#instanceSummary');
  const reloadInstancesBtn = $('#reloadInstancesBtn');
  const workflowSelect = $('#workflowSelect');
  const nodeFieldSelect = $('#nodeFieldSelect');
  const fieldBulkRole = $('#fieldBulkRole');
  const btnMakeEditable = $('#btnMakeEditable');
  const editableFieldsContainer = $('#editableFields');
  const workflowInputStatus = $('#workflowInputStatus');
  const workflowJsonArea = $('#workflowJson');
  const addTemplateBtn = $('#addTemplateBtn');
  const templateList = $('#templateList');
  const templateEmptyAlert = $('#templateEmptyAlert');
  const addPlaceholderBtn = $('#addPlaceholderBtn');
  const placeholderList = $('#placeholderList');
  const placeholderHint = $('#placeholderHint');
  const negativePrompt = $('#negativePrompt');
  const negativeOnly = $('#negativeOnly');
  const summaryPrompts = $('#summaryPrompts');
  const summaryPlaceholders = $('#summaryPlaceholders');
  const summaryCombinations = $('#summaryCombinations');
  const summaryNegativeMode = $('#summaryNegativeMode');
  const formStatus = $('#formStatus');
  const submitBtn = $('#submitBtn');
  const workflowImageInputs = $('#workflowImageInputs');
  const imageInputList = $('#imageInputList');
  const imageInputAlert = $('#imageInputAlert');
  const summaryImages = $('#summaryImages');
  const bulkCreateTitle = $('#bulkCreateTitle');
  const copySourceNotice = $('#copySourceNotice');

  const DEFAULT_INSTANCE_KEY = '__default__';
  const urlParams = new URLSearchParams(window.location.search);
  const copyFromJobId = (urlParams.get('copyFrom') || urlParams.get('copy_from') || '').trim();

  const state = {
    instances: [],
    instanceMap: new Map(),
    currentInstanceId: null,
    workflows: [],
    workflowMap: new Map(),
    originalWorkflow: null,
    availableFields: new Map(),
    editableFields: new Map(),
    currentImageSpecs: [],
    copySourceJob: null,
    desiredWorkflow: null,
    prefillImageInputs: {}
  };

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
      throw new Error(`${resp.status} ${resp.statusText} - ${text}`.trim());
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return resp.json();
    return resp;
  }

  function setInstanceSummary(text) {
    if (instanceSummary) instanceSummary.textContent = text || '';
  }

  function setWorkflowStatus(text, isError = false) {
    if (!workflowInputStatus) return;
    workflowInputStatus.textContent = text || '';
    workflowInputStatus.className = isError ? 'text-danger mt-2' : 'text-soft mt-2';
  }

  function getNegativePromptText() {
    return negativePrompt?.value.trim() || '';
  }

  function isNegativeOnlyMode() {
    return Boolean(negativeOnly?.checked);
  }

  function getNegativeVariantCount() {
    const hasNegativePrompt = Boolean(getNegativePromptText());
    if (!hasNegativePrompt) return isNegativeOnlyMode() ? 0 : 1;
    return isNegativeOnlyMode() ? 1 : 2;
  }

  function updateNegativeModeSummary() {
    if (!summaryNegativeMode) return;
    if (!getNegativePromptText()) {
      summaryNegativeMode.textContent = isNegativeOnlyMode()
        ? 'Add a negative prompt to generate only negative-prompt variations.'
        : 'A job will generate every combination of placeholders across all templates.';
    } else if (isNegativeOnlyMode()) {
      summaryNegativeMode.textContent = 'A job will generate every combination with the negative prompt applied.';
    } else {
      summaryNegativeMode.textContent = 'A job will generate every combination both with and without the negative prompt.';
    }
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
      const queueParts = [`pending ${pending}`];
      if (processing) queueParts.push(`processing ${processing}`);
      parts.push(`Bulk queue ${total} (${queueParts.join(', ')})`);
    }
    return parts.join(' | ');
  }

  function renderInstanceSummary() {
    const key = state.currentInstanceId;
    const inst = key ? state.instanceMap.get(key) : null;
    setInstanceSummary(describeInstance(inst) || 'Select an instance to load workflows.');
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
    if (!desired && preserveSelection && previous && ids.includes(previous)) desired = previous;
    if (!desired && state.currentInstanceId && ids.includes(state.currentInstanceId)) desired = state.currentInstanceId;
    if (!desired && options.defaultId && ids.includes(options.defaultId)) desired = options.defaultId;
    instanceSelect.value = desired || ids[0] || '';
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
    if (!options.skipPopulate && instanceSelect) instanceSelect.value = normalized || '';
    renderInstanceSummary();
    await loadWorkflows();
  }

  async function loadInstances(options = {}) {
    if (instanceSelect) instanceSelect.disabled = true;
    if (reloadInstancesBtn) reloadInstancesBtn.disabled = true;
    setInstanceSummary('Loading instances...');
    try {
      const payload = await api('/api/instances', { skipInstance: true });
      const list = Array.isArray(payload?.instances) ? payload.instances : [];
      state.instances = list;
      state.instanceMap = new Map(list.filter(inst => inst && inst.id).map(inst => [inst.id, inst]));
      const defaultId = determineDefaultInstanceId(list, payload);
      const requestedId = options.selectedId && state.instanceMap.has(options.selectedId) ? options.selectedId : null;
      populateInstanceOptions(list, {
        selectedId: requestedId || (options.preserveSelection ? state.currentInstanceId : defaultId),
        preserveSelection: options.preserveSelection,
        defaultId
      });
      const nextId = (() => {
        if (requestedId) return requestedId;
        if (options.preserveSelection && state.currentInstanceId && state.instanceMap.has(state.currentInstanceId)) return state.currentInstanceId;
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
      if (workflowSelect) workflowSelect.disabled = true;
      setWorkflowStatus('Unable to load workflows without an instance.', true);
      throw err;
    } finally {
      if (instanceSelect) instanceSelect.disabled = !state.instances.length;
      if (reloadInstancesBtn) reloadInstancesBtn.disabled = false;
    }
  }

  function cloneWorkflow(obj) {
    if (obj === null || obj === undefined) return null;
    try {
      return typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
    } catch (_) {
      return JSON.parse(JSON.stringify(obj));
    }
  }

  function unwrapWorkflowPayload(payload) {
    let workflow = payload?.workflow || payload;
    if (workflow?.workflow && typeof workflow.workflow === 'object' && !Array.isArray(workflow.workflow)) {
      workflow = workflow.workflow;
    }
    return workflow;
  }

  function isEditablePrimitive(value) {
    const t = typeof value;
    if (value === null || value === undefined) return false;
    return t === 'string' || t === 'number' || t === 'boolean';
  }

  function getNodeLabel(node, fallback) {
    return (
      node?.title ||
      node?._meta?.title ||
      node?.label ||
      node?.name ||
      node?.type ||
      node?.class_type ||
      (fallback ? `Node ${fallback}` : 'Node')
    );
  }

  function safeKeyPart(value) {
    const cleaned = String(value ?? '')
      .trim()
      .replace(/[^a-zA-Z0-9:_-]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return cleaned || 'field';
  }

  function makeFieldKey(ref, fieldName, usedKeys) {
    const base = safeKeyPart(`${ref.mode}_${ref.key}_${ref.nodeId}_${fieldName}`).slice(0, 140);
    let key = base;
    let index = 2;
    while (usedKeys.has(key)) {
      key = `${base}_${index}`;
      index += 1;
    }
    usedKeys.add(key);
    return key;
  }

  function collectNodeRefs(workflow) {
    const refs = [];
    if (!workflow || typeof workflow !== 'object') return refs;

    if (Array.isArray(workflow.nodes)) {
      workflow.nodes.forEach((node, idx) => {
        if (!node || typeof node !== 'object' || !node.inputs || typeof node.inputs !== 'object') return;
        const nodeId = String(node.id ?? node._id ?? idx);
        refs.push({
          node,
          nodeId,
          nodeLabel: getNodeLabel(node, nodeId),
          mode: 'array',
          key: nodeId
        });
      });
    }

    Object.entries(workflow).forEach(([key, node]) => {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      if (!node.inputs || typeof node.inputs !== 'object') return;
      const nodeId = String(node.id ?? node._id ?? key);
      refs.push({
        node,
        nodeId,
        nodeLabel: getNodeLabel(node, nodeId),
        mode: 'map',
        key
      });
    });

    return refs;
  }

  function buildAvailableFields(workflow) {
    state.availableFields.clear();
    const usedKeys = new Set();
    collectNodeRefs(workflow).forEach((ref) => {
      if (!ref.node || !ref.node.inputs || typeof ref.node.inputs !== 'object') return;
      Object.entries(ref.node.inputs).forEach(([field, value]) => {
        if (!isEditablePrimitive(value)) return;
        const key = makeFieldKey(ref, field, usedKeys);
        state.availableFields.set(key, {
          key,
          nodeId: ref.nodeId,
          nodeLabel: ref.nodeLabel,
          field,
          defaultValue: value,
          value,
          controlType: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text',
          bulkRole: 'base',
          loc: {
            mode: ref.mode,
            key: ref.key,
            nodeId: ref.nodeId,
            nodeLabel: ref.nodeLabel
          }
        });
      });
    });
  }

  function fieldLooksNegative(field) {
    const fieldName = String(field?.field || '').toLowerCase();
    const label = String(field?.nodeLabel || '').toLowerCase();
    return /negative/.test(fieldName) || (/negative/.test(label) && /text|prompt/.test(fieldName));
  }

  function fieldLooksPrompt(field) {
    if (fieldLooksNegative(field)) return false;
    const fieldName = String(field?.field || '').toLowerCase();
    const label = String(field?.nodeLabel || '').toLowerCase();
    return /prompt|text/.test(fieldName) || (/positive|prompt/.test(label) && typeof field?.defaultValue === 'string');
  }

  function fieldLooksImage(field) {
    const fieldName = String(field?.field || '').toLowerCase();
    return /^image[0-9]*$/.test(fieldName);
  }

  function inferRoleForField(field) {
    if (fieldLooksNegative(field)) return 'negative';
    if (fieldLooksPrompt(field)) return 'prompt';
    if (fieldLooksImage(field)) return 'image';
    return 'base';
  }

  function renderNodeFieldSelect() {
    if (!nodeFieldSelect) return;
    nodeFieldSelect.innerHTML = '';
    if (!state.availableFields.size) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No editable fields found in workflow';
      nodeFieldSelect.appendChild(opt);
      nodeFieldSelect.disabled = true;
      if (fieldBulkRole) fieldBulkRole.disabled = true;
      if (btnMakeEditable) btnMakeEditable.disabled = true;
      return;
    }

    const grouped = new Map();
    state.availableFields.forEach((field) => {
      const label = field.nodeLabel || `Node ${field.nodeId}`;
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(field);
    });

    Array.from(grouped.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .forEach(([groupLabel, fields]) => {
        const optGroup = document.createElement('optgroup');
        optGroup.label = groupLabel;
        fields
          .sort((a, b) => a.field.localeCompare(b.field))
          .forEach((field) => {
            const opt = document.createElement('option');
            opt.value = field.key;
            opt.textContent = `${field.field} (${String(field.defaultValue)})`;
            optGroup.appendChild(opt);
          });
        nodeFieldSelect.appendChild(optGroup);
      });

    nodeFieldSelect.disabled = false;
    if (fieldBulkRole) fieldBulkRole.disabled = false;
    if (btnMakeEditable) btnMakeEditable.disabled = false;
    if (!nodeFieldSelect.value) nodeFieldSelect.selectedIndex = 0;
    updateRoleSelectForCurrentField();
  }

  function updateRoleSelectForCurrentField() {
    if (!fieldBulkRole || !nodeFieldSelect) return;
    const field = state.availableFields.get(nodeFieldSelect.value);
    fieldBulkRole.value = inferRoleForField(field);
  }

  function addEditableField(descriptor, role) {
    if (!descriptor || !descriptor.key) return false;
    const existing = state.editableFields.get(descriptor.key);
    const nextRole = role || descriptor.bulkRole || inferRoleForField(descriptor);
    const value = existing?.value !== undefined ? existing.value : descriptor.value;
    state.editableFields.set(descriptor.key, Object.assign({}, descriptor, existing || {}, {
      bulkRole: nextRole,
      value
    }));
    return !existing;
  }

  function autoAddDefaultFields() {
    const fields = Array.from(state.availableFields.values());
    const promptField = fields.find(fieldLooksPrompt);
    if (promptField) addEditableField(promptField, 'prompt');
    const negativeField = fields.find(fieldLooksNegative);
    if (negativeField) addEditableField(negativeField, 'negative');
    fields.filter(fieldLooksImage).slice(0, 3).forEach((field) => addEditableField(field, 'image'));
  }

  function renderEditableFields() {
    if (!editableFieldsContainer) return;
    editableFieldsContainer.innerHTML = '';
    const fields = Array.from(state.editableFields.values());
    if (!fields.length) {
      const placeholder = document.createElement('div');
      placeholder.className = 'text-soft';
      placeholder.textContent = 'No workflow fields selected.';
      editableFieldsContainer.appendChild(placeholder);
      renderImageInputs([]);
      updateSummary();
      return;
    }

    fields.forEach((field) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'workflow-field';

      const header = document.createElement('div');
      header.className = 'd-flex justify-content-between align-items-start gap-2';
      const titleWrap = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'workflow-field__title';
      title.textContent = field.field;
      const meta = document.createElement('div');
      meta.className = 'workflow-field__meta';
      meta.textContent = field.nodeLabel || `Node ${field.nodeId}`;
      titleWrap.appendChild(title);
      titleWrap.appendChild(meta);
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-sm btn-outline-danger';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        state.editableFields.delete(field.key);
        renderEditableFields();
      });
      header.appendChild(titleWrap);
      header.appendChild(removeBtn);
      wrapper.appendChild(header);

      const row = document.createElement('div');
      row.className = 'row g-2 mt-2 align-items-end';
      const roleCol = document.createElement('div');
      roleCol.className = 'col-md-4';
      const roleLabel = document.createElement('label');
      roleLabel.className = 'form-label';
      roleLabel.textContent = 'Role';
      const roleSelect = document.createElement('select');
      roleSelect.className = 'form-select form-select-sm';
      [
        ['base', 'Base input'],
        ['prompt', 'Prompt template'],
        ['negative', 'Negative prompt'],
        ['image', 'Image list']
      ].forEach(([value, label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        roleSelect.appendChild(opt);
      });
      roleSelect.value = field.bulkRole || 'base';
      roleSelect.addEventListener('change', (event) => {
        field.bulkRole = event.target.value;
        state.editableFields.set(field.key, field);
        renderEditableFields();
      });
      roleCol.appendChild(roleLabel);
      roleCol.appendChild(roleSelect);
      row.appendChild(roleCol);

      const valueCol = document.createElement('div');
      valueCol.className = 'col-md-8';
      const valueLabel = document.createElement('label');
      valueLabel.className = 'form-label';
      valueLabel.textContent = field.bulkRole === 'base' ? 'Value' : 'Source';
      valueCol.appendChild(valueLabel);

      if (field.bulkRole === 'base') {
        if (field.controlType === 'boolean') {
          const checkWrap = document.createElement('div');
          checkWrap.className = 'form-check';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.className = 'form-check-input';
          checkbox.checked = Boolean(field.value);
          checkbox.addEventListener('change', (event) => {
            field.value = event.target.checked;
            state.editableFields.set(field.key, field);
          });
          const checkLabel = document.createElement('label');
          checkLabel.className = 'form-check-label';
          checkLabel.textContent = 'Enabled';
          checkWrap.appendChild(checkbox);
          checkWrap.appendChild(checkLabel);
          valueCol.appendChild(checkWrap);
        } else {
          const input = document.createElement('input');
          input.className = 'form-control form-control-sm';
          input.type = field.controlType === 'number' ? 'number' : 'text';
          input.value = field.value !== undefined ? field.value : field.defaultValue ?? '';
          input.addEventListener('input', (event) => {
            field.value = field.controlType === 'number' ? Number(event.target.value) : event.target.value;
            state.editableFields.set(field.key, field);
          });
          valueCol.appendChild(input);
        }
      } else {
        const source = document.createElement('input');
        source.className = 'form-control form-control-sm';
        source.type = 'text';
        source.disabled = true;
        source.value = field.bulkRole === 'prompt'
          ? 'Prompt templates'
          : field.bulkRole === 'negative'
            ? 'Negative prompt'
            : 'Image filename list';
        valueCol.appendChild(source);
      }

      row.appendChild(valueCol);
      wrapper.appendChild(row);
      editableFieldsContainer.appendChild(wrapper);
    });

    renderImageInputs(fields.filter((field) => field.bulkRole === 'image'));
    updateSummary();
  }

  function renderWorkflowList() {
    if (!workflowSelect) return;
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
      if (wf.outputType) labelParts.push(`- ${String(wf.outputType).toUpperCase()}`);
      opt.textContent = labelParts.join(' ');
      workflowSelect.appendChild(opt);
    });
    const validKeys = new Set(state.workflows.map((wf) => wf.key));
    const desiredWorkflow = state.desiredWorkflow && validKeys.has(state.desiredWorkflow)
      ? state.desiredWorkflow
      : null;
    workflowSelect.value = desiredWorkflow || (validKeys.has(previousValue) ? previousValue : state.workflows[0].key);
  }

  function copiedImageValuesByKey(job) {
    const result = {};
    (Array.isArray(job?.image_inputs) ? job.image_inputs : []).forEach((entry) => {
      const key = entry?.key;
      if (!key) return;
      result[key] = Array.isArray(entry.values) ? entry.values.slice() : [];
    });
    return result;
  }

  function normalizeCopiedMapping(mapping, baseInputs) {
    if (!mapping || !mapping.key) return null;
    const role = mapping.bulkRole || mapping.role || 'base';
    const copiedValue = role === 'base' && Object.prototype.hasOwnProperty.call(baseInputs || {}, mapping.key)
      ? baseInputs[mapping.key]
      : mapping.value;
    return Object.assign({}, mapping, {
      bulkRole: role,
      value: copiedValue
    });
  }

  function applyCopiedWorkflowFields(job) {
    const mappings = Array.isArray(job?.field_mappings) ? job.field_mappings : [];
    if (!mappings.length) return false;
    const baseInputs = job?.base_inputs || {};
    state.editableFields.clear();
    mappings.forEach((mapping) => {
      const normalized = normalizeCopiedMapping(mapping, baseInputs);
      if (!normalized || !normalized.key) return;
      const descriptor = state.availableFields.get(normalized.key) || normalized;
      addEditableField(Object.assign({}, descriptor, normalized), normalized.bulkRole);
    });
    return state.editableFields.size > 0;
  }

  async function loadWorkflowJson(name) {
    state.originalWorkflow = null;
    state.availableFields.clear();
    state.editableFields.clear();
    renderNodeFieldSelect();
    renderEditableFields();
    if (!name) {
      setWorkflowStatus('Select a workflow.');
      return;
    }
    setWorkflowStatus('Loading workflow JSON...');
    try {
      const resp = await api(`/api/workflows/${encodeURIComponent(name)}`);
      let workflow = unwrapWorkflowPayload(resp);
      if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) {
        throw new Error('Workflow response did not contain a JSON object.');
      }
      if (
        state.copySourceJob &&
        name === state.copySourceJob.workflow &&
        state.copySourceJob.workflow_template &&
        typeof state.copySourceJob.workflow_template === 'object'
      ) {
        workflow = state.copySourceJob.workflow_template;
      }
      state.originalWorkflow = cloneWorkflow(workflow);
      if (workflowJsonArea) workflowJsonArea.value = JSON.stringify(state.originalWorkflow);
      buildAvailableFields(state.originalWorkflow);
      autoAddDefaultFields();
      if (state.copySourceJob && name === state.copySourceJob.workflow) {
        applyCopiedWorkflowFields(state.copySourceJob);
      }
      renderNodeFieldSelect();
      renderEditableFields();
      const count = state.availableFields.size;
      setWorkflowStatus(`${count} editable workflow field${count === 1 ? '' : 's'} loaded.`);
    } catch (err) {
      state.originalWorkflow = null;
      if (workflowJsonArea) workflowJsonArea.value = '';
      renderNodeFieldSelect();
      renderEditableFields();
      setWorkflowStatus(`Failed to load workflow: ${err.message}`, true);
    }
  }

  async function loadWorkflows() {
    if (!workflowSelect) return;
    if (!state.currentInstanceId) {
      state.workflows = [];
      state.workflowMap = new Map();
      renderWorkflowList();
      workflowSelect.disabled = true;
      setWorkflowStatus('Select an instance to load workflows.');
      return;
    }
    workflowSelect.disabled = true;
    setWorkflowStatus('Loading workflows...');
    try {
      const data = await api('/api/workflows');
      state.workflows = Array.isArray(data.workflows) ? data.workflows : [];
      state.workflowMap = new Map(state.workflows.map(w => [w.key, w]));
      renderWorkflowList();
      workflowSelect.disabled = !state.workflows.length;
      if (state.workflows.length) {
        await loadWorkflowJson(workflowSelect.value);
      } else {
        setWorkflowStatus('No workflows available.');
      }
    } catch (err) {
      state.workflows = [];
      state.workflowMap = new Map();
      renderWorkflowList();
      workflowSelect.disabled = true;
      setWorkflowStatus(`Failed to load workflows: ${err.message}`, true);
    }
  }

  function extractPlaceholdersFromTemplates() {
    const regex = /{{\s*([\w.-]+)\s*}}/g;
    const set = new Set();
    templateList?.querySelectorAll('textarea.template-text').forEach(textarea => {
      const text = textarea.value || '';
      let match;
      while ((match = regex.exec(text)) !== null) set.add(match[1]);
    });
    return Array.from(set);
  }

  function findPlaceholderItem(name) {
    const items = Array.from(placeholderList?.querySelectorAll('.placeholder-item') || []);
    return items.find((item) => item.dataset.placeholder === name) || null;
  }

  function addTemplate(initial = {}) {
    if (!templateList) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'template-item';

    const header = document.createElement('div');
    header.className = 'd-flex justify-content-between align-items-center mb-2';
    const title = document.createElement('h3');
    title.className = 'mb-0';
    title.textContent = 'Template';
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
    header.appendChild(title);
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
    labelInput.addEventListener('input', updateSummary);
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
    if (!placeholderList) return;
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

  function setCopyNotice(message, isError = false) {
    if (!copySourceNotice) return;
    copySourceNotice.textContent = message || '';
    copySourceNotice.classList.toggle('d-none', !message);
    copySourceNotice.classList.toggle('alert-info', !isError);
    copySourceNotice.classList.toggle('alert-danger', isError);
  }

  function applyCopiedJobForm(job) {
    if (!job) return;
    state.copySourceJob = job;
    state.desiredWorkflow = job.workflow || null;
    state.prefillImageInputs = copiedImageValuesByKey(job);

    if (bulkCreateTitle) bulkCreateTitle.textContent = 'Create Bulk Prompt Experiment From Existing Job';
    setCopyNotice(`Prefilled from "${job.name || 'Untitled job'}". Change the workflow or inputs, then create a new job.`);

    const nameInput = $('#jobName');
    if (nameInput) nameInput.value = `Copy of ${job.name || 'bulk job'}`;

    if (templateList) {
      templateList.innerHTML = '';
      const templates = Array.isArray(job.prompt_templates) ? job.prompt_templates : [];
      templates.forEach((tpl, idx) => {
        addTemplate({
          label: tpl?.label || `Prompt ${idx + 1}`,
          template: tpl?.template || ''
        });
      });
      if (!templates.length) addTemplate();
    }

    if (placeholderList) {
      placeholderList.innerHTML = '';
      const placeholders = Array.isArray(job.placeholder_values) ? job.placeholder_values : [];
      placeholders.forEach((entry) => {
        addPlaceholder({
          name: entry?.key || '',
          values: Array.isArray(entry?.values) ? entry.values.join('\n') : ''
        });
      });
      syncPlaceholders();
    }

    if (negativePrompt) negativePrompt.value = job.negative_prompt || '';
    if (negativeOnly) negativeOnly.checked = (job.negative_prompt_mode || '').toLowerCase() === 'only';
    updateTemplateEmptyState();
    updateSummary();
  }

  async function loadCopySourceJob() {
    if (!copyFromJobId) return null;
    try {
      setCopyNotice('Loading source job...');
      const data = await api(`/api/bulk/jobs/${encodeURIComponent(copyFromJobId)}`, { skipInstance: true });
      const job = data?.job || null;
      if (!job) throw new Error('Source job response was empty.');
      applyCopiedJobForm(job);
      return job;
    } catch (err) {
      state.copySourceJob = null;
      setCopyNotice(`Could not load source job: ${err.message}`, true);
      throw err;
    }
  }

  function updateTemplateEmptyState() {
    const hasTemplates = templateList?.querySelector('.template-item');
    if (!templateEmptyAlert) return;
    templateEmptyAlert.classList.toggle('d-none', Boolean(hasTemplates));
  }

  function syncPlaceholders() {
    if (!placeholderHint) return;
    const detected = extractPlaceholdersFromTemplates();
    placeholderHint.classList.remove('d-none');
    if (!detected.length) {
      placeholderHint.textContent = 'No placeholders detected in your templates.';
      return;
    }
    placeholderHint.textContent = `Detected placeholders: ${detected.join(', ')}.`;
    detected.forEach((name) => {
      if (!findPlaceholderItem(name)) addPlaceholder({ name, values: '' });
    });
  }

  function gatherPlaceholderValues() {
    const values = {};
    placeholderList?.querySelectorAll('.placeholder-item').forEach((item) => {
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
      const textarea = Array.from(imageInputList?.querySelectorAll('textarea.image-input-values') || [])
        .find((el) => el.dataset.imageKey === key);
      if (!textarea) {
        values[key] = [];
        return;
      }
      values[key] = textarea.value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    });
    return values;
  }

  function renderImageInputs(specs = []) {
    if (!workflowImageInputs || !imageInputList || !imageInputAlert) return;
    const previousValues = gatherImageInputValues();
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
      title.textContent = `${spec.field || spec.key} (${spec.nodeLabel || 'workflow field'})`;
      wrapper.appendChild(title);

      const textarea = document.createElement('textarea');
      textarea.className = 'form-control image-input-values';
      textarea.rows = 4;
      textarea.dataset.imageKey = spec.key;
      textarea.placeholder = 'example.png\nexample-2.png';
      if (previousValues[spec.key]?.length) {
        textarea.value = previousValues[spec.key].join('\n');
      } else if (state.prefillImageInputs[spec.key]?.length) {
        textarea.value = state.prefillImageInputs[spec.key].join('\n');
      } else if (Array.isArray(spec.defaultValue)) {
        textarea.value = spec.defaultValue.join('\n');
      } else if (spec.defaultValue && typeof spec.defaultValue === 'string') {
        textarea.value = spec.defaultValue;
      }
      textarea.addEventListener('input', updateSummary);
      wrapper.appendChild(textarea);

      const note = document.createElement('small');
      note.className = 'text-soft';
      note.textContent = 'Enter one filename per line.';
      wrapper.appendChild(note);

      imageInputList.appendChild(wrapper);
    });
    updateSummary();
  }

  function collectImageInputs() {
    const values = gatherImageInputValues();
    if (!state.currentImageSpecs.length) return values;
    const missing = [];
    state.currentImageSpecs.forEach((spec) => {
      const key = spec?.key;
      if (!key) return;
      const entries = values[key] || [];
      if (!entries.length) missing.push(spec.field || key);
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
    const templateCount = templateList?.querySelectorAll('.template-item').length || 0;
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
    const negativeFactor = getNegativeVariantCount();
    return templateCount * multiplier * imageMultiplier * negativeFactor;
  }

  function updateSummary() {
    const templateCount = templateList?.querySelectorAll('.template-item').length || 0;
    const placeholderCount = placeholderList?.querySelectorAll('.placeholder-item').length || 0;
    const imageCount = state.currentImageSpecs.length;
    const placeholderValues = gatherPlaceholderValues();
    const detected = extractPlaceholdersFromTemplates();
    const missingPlaceholders = detected.filter((key) => !(placeholderValues[key] && placeholderValues[key].length));
    const imageValues = gatherImageInputValues();
    const missingImages = state.currentImageSpecs
      .map((spec) => spec?.key)
      .filter((key) => key && !(imageValues[key] && imageValues[key].length));
    const combos = computeCombinationEstimate();
    const missingNegativePrompt = isNegativeOnlyMode() && !getNegativePromptText();

    if (summaryPrompts) summaryPrompts.textContent = `${templateCount} template${templateCount === 1 ? '' : 's'}`;
    if (summaryPlaceholders) summaryPlaceholders.textContent = `${placeholderCount} placeholder${placeholderCount === 1 ? '' : 's'}`;
    if (summaryImages) summaryImages.textContent = `${imageCount} image input${imageCount === 1 ? '' : 's'}`;
    if (summaryCombinations) summaryCombinations.textContent = `${combos} combination${combos === 1 ? '' : 's'}`;
    updateNegativeModeSummary();

    if (workflowImageInputs && imageInputAlert) {
      if (state.currentImageSpecs.length && missingImages.length) {
        imageInputAlert.classList.remove('d-none');
        const labels = missingImages.map((key) => {
          const spec = state.currentImageSpecs.find((item) => item.key === key);
          return spec?.field || key;
        });
        imageInputAlert.textContent = `Add filenames for image input(s): ${labels.join(', ')}`;
      } else {
        imageInputAlert.classList.add('d-none');
      }
    }

    if (!formStatus) return;
    if (!templateCount) {
      formStatus.textContent = 'Add at least one template.';
      formStatus.className = 'text-warning';
    } else if (missingNegativePrompt) {
      formStatus.textContent = 'Add a negative prompt or turn off negative-only generation.';
      formStatus.className = 'text-warning';
    } else if (missingPlaceholders.length) {
      formStatus.textContent = `Add values for placeholder(s): ${missingPlaceholders.join(', ')}`;
      formStatus.className = 'text-warning';
    } else if (missingImages.length) {
      formStatus.textContent = 'Add required image filenames.';
      formStatus.className = 'text-warning';
    } else if (!combos) {
      formStatus.textContent = 'Specify values to produce combinations.';
      formStatus.className = 'text-warning';
    } else {
      formStatus.textContent = `Ready to generate ${combos} variation${combos === 1 ? '' : 's'}.`;
      formStatus.className = 'text-soft';
    }
  }

  function gatherTemplates() {
    const templates = [];
    templateList?.querySelectorAll('.template-item').forEach((item) => {
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

  function collectBaseInputs() {
    const inputs = {};
    state.editableFields.forEach((field) => {
      if (field.bulkRole !== 'base') return;
      inputs[field.key] = field.controlType === 'number'
        ? Number(field.value)
        : field.controlType === 'boolean'
          ? Boolean(field.value)
          : String(field.value ?? '');
    });
    return inputs;
  }

  function collectFieldMappings() {
    return Array.from(state.editableFields.values()).map((field) => ({
      key: field.key,
      nodeId: field.nodeId,
      nodeLabel: field.nodeLabel,
      field: field.field,
      bulkRole: field.bulkRole || 'base',
      controlType: field.controlType || 'text',
      value: field.value,
      defaultValue: field.defaultValue,
      loc: field.loc
    }));
  }

  async function handleSubmit(evt) {
    evt.preventDefault();
    if (submitBtn) submitBtn.disabled = true;
    try {
      if (!state.currentInstanceId) throw new Error('Select an instance before creating a job.');
      const name = $('#jobName')?.value.trim();
      if (!name) throw new Error('Job name is required.');
      if (!workflowSelect?.value) throw new Error('Select a workflow.');
      if (!state.originalWorkflow) throw new Error('Workflow JSON is not loaded.');

      const templates = gatherTemplates();
      if (!templates.length) throw new Error('Add at least one template with prompt text.');

      const fieldMappings = collectFieldMappings();
      if (!fieldMappings.some((field) => field.bulkRole === 'prompt')) {
        throw new Error('Select one workflow field as the prompt template target.');
      }

      const placeholderValues = gatherPlaceholderValues();
      const requiredPlaceholders = extractPlaceholdersFromTemplates();
      for (const key of requiredPlaceholders) {
        const values = placeholderValues[key] || [];
        if (!values.length) throw new Error(`Placeholder "${key}" needs at least one value.`);
      }

      const imageInputs = collectImageInputs();
      const baseInputs = collectBaseInputs();
      if (isNegativeOnlyMode() && !getNegativePromptText()) {
        throw new Error('Add a negative prompt or turn off negative-only generation.');
      }
      const payload = {
        name,
        workflow: workflowSelect.value,
        workflowTemplate: cloneWorkflow(state.originalWorkflow),
        fieldMappings,
        templates,
        placeholderValues,
        negativePrompt: negativePrompt?.value || '',
        negativePromptMode: isNegativeOnlyMode() ? 'only' : 'compare',
        negativePromptOnly: isNegativeOnlyMode(),
        baseInputs,
        imageInputs,
        instance_id: state.currentInstanceId,
        sourceJobId: state.copySourceJob?.id || copyFromJobId || null
      };

      const resp = await api('/api/bulk/jobs', {
        method: 'POST',
        body: payload
      });
      if (resp?.id) {
        window.location.href = `/image_gen/bulk/${encodeURIComponent(resp.id)}`;
      } else if (formStatus) {
        formStatus.textContent = 'Job created but response missing id.';
        formStatus.className = 'text-warning';
      }
    } catch (err) {
      if (formStatus) {
        formStatus.textContent = err.message;
        formStatus.className = 'text-danger';
      }
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  instanceSelect?.addEventListener('change', (event) => {
    changeInstance(event.target.value || null).catch((err) => {
      if (formStatus) {
        formStatus.textContent = err.message;
        formStatus.className = 'text-danger';
      }
    });
  });
  reloadInstancesBtn?.addEventListener('click', () => {
    loadInstances({ preserveSelection: true }).catch((err) => {
      if (formStatus) {
        formStatus.textContent = err.message;
        formStatus.className = 'text-danger';
      }
    });
  });
  workflowSelect?.addEventListener('change', (event) => {
    state.desiredWorkflow = null;
    loadWorkflowJson(event.target.value).catch((err) => {
      setWorkflowStatus(err.message, true);
    });
  });
  nodeFieldSelect?.addEventListener('change', updateRoleSelectForCurrentField);
  btnMakeEditable?.addEventListener('click', () => {
    const descriptor = state.availableFields.get(nodeFieldSelect?.value);
    if (!descriptor) return;
    addEditableField(descriptor, fieldBulkRole?.value || inferRoleForField(descriptor));
    renderEditableFields();
  });
  addTemplateBtn?.addEventListener('click', () => addTemplate());
  addPlaceholderBtn?.addEventListener('click', () => addPlaceholder());
  negativePrompt?.addEventListener('input', updateSummary);
  negativeOnly?.addEventListener('change', updateSummary);
  jobForm?.addEventListener('submit', handleSubmit);

  async function init() {
    if (!copyFromJobId) addTemplate();
    renderInstanceSummary();
    renderNodeFieldSelect();
    renderEditableFields();
    let sourceJob = null;
    if (copyFromJobId) {
      try {
        sourceJob = await loadCopySourceJob();
      } catch (err) {
        if (formStatus) {
          formStatus.textContent = err.message;
          formStatus.className = 'text-danger';
        }
      }
    }
    if (copyFromJobId && !sourceJob && !templateList?.querySelector('.template-item')) {
      addTemplate();
    }
    await loadInstances({
      selectedId: sourceJob?.instance_id || null
    });
  }

  init().catch((err) => {
    if (formStatus) {
      formStatus.textContent = err.message;
      formStatus.className = 'text-danger';
    }
  });
})();
