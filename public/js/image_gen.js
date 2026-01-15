// public/js/image_gen.js (gateway-driven, single image generation)
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const statusPill = $('#statusPill');
  const logEl = $('#log');
  const wfSelect = $('#wfSelect');
  const wfCount = $('#wfCount');
  const wfJsonArea = $('#workflowJson');
  const promptTextInput = $('#promptText');
  const negativeTextInput = $('#negativeText');
  const nodeFieldSelect = $('#nodeFieldSelect');
  const fieldAsPromptToggle = $('#fieldAsPrompt');
  const editableFieldsContainer = $('#editableFields');
  const btnMakeEditable = $('#btnMakeEditable');
  const btnViewJson = $('#btnViewJson');
  const jobIdInput = $('#jobId');
  const jobStatusEl = $('#jobStatus');
  const jobMetaEl = $('#jobMeta');
  const resultsEl = $('#results');
  const healthDot = $('#healthDot');
  const instanceMetaEl = $('#instanceMeta');
  let ratingBarVisible = false;
  let currentJobId = null;
  let pollTimer = null;
  let pollJobId = null;
  let currentWorkflowName = null;
  let originalWorkflow = null;
  const availableFields = new Map();
  const editableFields = new Map();
  if (wfJsonArea) wfJsonArea.readOnly = true;
  if (promptTextInput) {
    promptTextInput.readOnly = true;
  }

  function setStatus(text) {
    if (statusPill) statusPill.textContent = text;
  }

  function log(msg, cls) {
    if (!logEl) return;
    const t = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    if (cls) div.classList.add(cls);
    div.textContent = `[${t}] ${msg}`;
    logEl.prepend(div);
  }

  async function api(path, opts = {}) {
    const init = Object.assign({ headers: {} }, opts);
    const method = (init.method || 'GET').toUpperCase();
    init.method = method;
    let url = `/image_gen${path}`;
    if (!(init.body instanceof FormData) && method !== 'GET' && method !== 'HEAD') {
      init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
    }
    const resp = await fetch(url, init);
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Error(`${resp.status} ${resp.statusText} ${txt}`.trim());
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return resp.json();
    return resp;
  }

  function normalizeStatus(status) {
    return String(status || '').trim().toLowerCase();
  }

  function isTerminalStatus(status) {
    const normalized = normalizeStatus(status);
    return ['completed', 'complete', 'done', 'failed', 'error', 'timeout', 'canceled'].includes(normalized);
  }

  function isSuccessStatus(status) {
    const normalized = normalizeStatus(status);
    return ['completed', 'complete', 'done'].includes(normalized);
  }

  function setJobStatus(status) {
    if (!jobStatusEl) return;
    const normalized = normalizeStatus(status);
    let cls = 'bg-secondary';
    if (isSuccessStatus(normalized)) cls = 'bg-success';
    else if (['failed', 'error'].includes(normalized)) cls = 'bg-danger';
    else if (['timeout', 'canceled'].includes(normalized)) cls = 'bg-warning';
    else if (['running', 'processing'].includes(normalized)) cls = 'bg-info';
    jobStatusEl.className = `badge ${cls}`;
    jobStatusEl.textContent = status || '-';
  }

  function formatTimestamp(value) {
    if (value === null || value === undefined || value === '') return '';
    let ts = value;
    if (typeof value === 'string') {
      const num = Number(value);
      if (Number.isFinite(num)) ts = num;
    }
    if (typeof ts === 'number') {
      const ms = ts > 1e12 ? ts : ts * 1000;
      return new Date(ms).toLocaleString();
    }
    const parsed = new Date(ts);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
  }

  function updateJobMeta(job) {
    if (!jobMetaEl) return;
    const parts = [];
    if (job?.queue_number !== null && job?.queue_number !== undefined && job?.queue_number !== '') {
      parts.push(`Queue #${job.queue_number}`);
    }
    if (job?.queue_wait_sec !== null && job?.queue_wait_sec !== undefined && job?.queue_wait_sec !== '') {
      const wait = Number(job.queue_wait_sec);
      const waitText = Number.isFinite(wait) ? `${wait.toFixed(2)}s` : String(job.queue_wait_sec);
      parts.push(`Wait ${waitText}`);
    }
    const submitted = formatTimestamp(job?.submitted_at);
    if (submitted) parts.push(`Submitted ${submitted}`);
    const completed = formatTimestamp(job?.completed_at);
    if (completed) parts.push(`Completed ${completed}`);
    jobMetaEl.textContent = parts.join(' | ');
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    pollJobId = null;
  }

  async function handleJobUpdate(job, { fromPoll = false } = {}) {
    if (!job) return false;
    const jobId = job.job_id || job.prompt_id || currentJobId;
    if (jobId) {
      currentJobId = jobId;
      if (jobIdInput) jobIdInput.value = jobId;
    }
    setJobStatus(job.status || '-');
    updateJobMeta(job);

    const files = Array.isArray(job.files) ? job.files : [];
    if (files.length) {
      await showResults(jobId, files);
    } else if (!fromPoll && job?.status) {
      clearResults('No outputs yet.');
    }

    if (isTerminalStatus(job?.status)) {
      stopPolling();
      if (isSuccessStatus(job?.status)) {
        setStatus('completed');
        if (jobId) showRatingBar(jobId);
      } else {
        setStatus('error');
      }
      return true;
    }

    setStatus(normalizeStatus(job?.status) || 'running');
    return false;
  }

  async function pollJob(jobId, { repeat = true } = {}) {
    if (!jobId) return;
    pollJobId = jobId;
    try {
      const job = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (pollJobId !== jobId) return;
      const done = await handleJobUpdate(job, { fromPoll: true });
      if (!done && repeat && pollJobId === jobId) {
        pollTimer = setTimeout(() => pollJob(jobId, { repeat: true }), 3000);
      }
    } catch (err) {
      log('Poll failed: ' + err.message, 'text-danger');
      if (repeat && pollJobId === jobId) {
        pollTimer = setTimeout(() => pollJob(jobId, { repeat: true }), 4500);
      }
    }
  }

  function startPolling(jobId) {
    stopPolling();
    pollJob(jobId, { repeat: true });
  }

  function cloneWorkflow(obj) {
    if (obj === null || obj === undefined) return null;
    try {
      return typeof structuredClone === 'function' ? structuredClone(obj) : JSON.parse(JSON.stringify(obj));
    } catch (_) {
      return JSON.parse(JSON.stringify(obj));
    }
  }

  function workflowStorageKey() {
    const name = currentWorkflowName ? String(currentWorkflowName).trim() : '';
    return name ? `imageGenWorkflowUi:${name}` : null;
  }

  function isEditablePrimitive(value) {
    const t = typeof value;
    if (value === null || value === undefined) return false;
    if (t === 'string' || t === 'number' || t === 'boolean') return true;
    return false;
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

  function renderNodeFieldSelect() {
    if (!nodeFieldSelect) return;
    nodeFieldSelect.innerHTML = '';
    if (!availableFields.size) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No editable fields found in workflow';
      nodeFieldSelect.appendChild(opt);
      nodeFieldSelect.disabled = true;
      if (btnMakeEditable) btnMakeEditable.disabled = true;
      if (fieldAsPromptToggle) fieldAsPromptToggle.disabled = true;
      return;
    }

    const grouped = new Map();
    availableFields.forEach((field) => {
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
    if (btnMakeEditable) btnMakeEditable.disabled = false;
    if (fieldAsPromptToggle) fieldAsPromptToggle.disabled = false;
    if (!nodeFieldSelect.value) nodeFieldSelect.selectedIndex = 0;
  }

  function enforceSinglePrompt() {
    let promptSeen = false;
    editableFields.forEach((field) => {
      if (field.controlType === 'prompt') {
        if (promptSeen) field.controlType = 'text';
        promptSeen = true;
      }
    });
  }

  function buildFieldValue(field) {
    if (!field) return null;
    if (field.controlType === 'number') {
      if (field.value === '' || field.value === undefined || field.value === null) {
        return Number(field.defaultValue) || 0;
      }
      const num = Number(field.value);
      return Number.isFinite(num) ? num : Number(field.defaultValue) || 0;
    }
    const raw = field.value !== undefined ? field.value : field.defaultValue;
    return String(raw ?? '');
  }

  function findNodeForField(workflow, loc = {}) {
    if (!workflow || typeof workflow !== 'object') return null;
    if (loc.mode === 'map' && loc.key && workflow[loc.key]) return workflow[loc.key];

    if (Array.isArray(workflow.nodes)) {
      const match = workflow.nodes.find((node) => String(node.id ?? node._id ?? node.name) === loc.nodeId);
      if (match) return match;
    }

    if (loc.mode === 'map' && loc.nodeId && workflow[loc.nodeId]) {
      return workflow[loc.nodeId];
    }

    const ref = collectNodeRefs(workflow).find(
      (entry) => entry.nodeId === loc.nodeId || entry.key === loc.key || entry.nodeLabel === loc.nodeLabel
    );
    return ref ? ref.node : null;
  }

  function applyFieldOverrides(workflow) {
    if (!workflow || typeof workflow !== 'object') return workflow;
    editableFields.forEach((field) => {
      const node = findNodeForField(workflow, field.loc);
      if (!node || !node.inputs || typeof node.inputs !== 'object') return;
      node.inputs[field.field] = buildFieldValue(field);
    });
    return workflow;
  }

  function renderEditableFields() {
    if (!editableFieldsContainer) return;
    editableFieldsContainer.innerHTML = '';
    if (!editableFields.size) {
      const placeholder = document.createElement('div');
      placeholder.className = 'text-muted';
      placeholder.textContent = 'No custom inputs yet. Pick a node + field, then click Make editable.';
      editableFieldsContainer.appendChild(placeholder);
      return;
    }

    editableFields.forEach((field) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'workflow-field mb-2';

      const header = document.createElement('div');
      header.className = 'd-flex justify-content-between align-items-start';
      const title = document.createElement('div');
      title.innerHTML = `
        <div class="workflow-field__title">${field.field}</div>
        <div class="workflow-field__meta">${field.nodeLabel}</div>
      `;
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'btn btn-sm btn-outline-danger';
      removeBtn.textContent = 'Remove';
      removeBtn.addEventListener('click', () => {
        editableFields.delete(field.key);
        saveUiState();
        renderEditableFields();
        refreshPromptPreview();
        updateJsonViewer();
      });

      header.appendChild(title);
      header.appendChild(removeBtn);
      wrapper.appendChild(header);

      const controlRow = document.createElement('div');
      controlRow.className = 'd-flex flex-wrap gap-2 align-items-center mt-2';
      const typeSelect = document.createElement('select');
      typeSelect.className = 'form-select form-select-sm';
      [
        { value: 'text', label: 'Text input' },
        { value: 'number', label: 'Number input' },
        { value: 'prompt', label: 'Prompt (textarea)' }
      ].forEach((opt) => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        typeSelect.appendChild(option);
      });
      typeSelect.value = field.controlType || 'text';
      typeSelect.addEventListener('change', (e) => {
        setFieldControlType(field.key, e.target.value);
      });
      controlRow.appendChild(typeSelect);
      wrapper.appendChild(controlRow);

      const inputWrap = document.createElement('div');
      inputWrap.className = 'mt-2';
      const valueInput =
        field.controlType === 'prompt'
          ? document.createElement('textarea')
          : document.createElement('input');
      if (field.controlType === 'prompt') {
        valueInput.rows = 3;
      } else {
        valueInput.type = field.controlType === 'number' ? 'number' : 'text';
      }
      valueInput.className = 'form-control';
      valueInput.value = field.value !== undefined ? field.value : field.defaultValue ?? '';
      valueInput.addEventListener('input', (e) => {
        updateFieldValue(field.key, e.target.value);
      });
      inputWrap.appendChild(valueInput);
      wrapper.appendChild(inputWrap);

      editableFieldsContainer.appendChild(wrapper);
    });
  }

  function refreshPromptPreview() {
    if (!promptTextInput) return;
    const promptField = Array.from(editableFields.values()).find((f) => f.controlType === 'prompt');
    const value = promptField ? String(promptField.value ?? promptField.defaultValue ?? '') : '';
    promptTextInput.value = value;
  }

  function saveUiState() {
    const storageKey = workflowStorageKey();
    if (!storageKey || typeof localStorage === 'undefined') return;
    const payload = {
      fields: Array.from(editableFields.values()).map((field) => ({
        key: field.key,
        nodeId: field.nodeId,
        field: field.field,
        controlType: field.controlType,
        value: field.value
      }))
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(payload));
    } catch (err) {
      log('Unable to save UI state locally: ' + err.message, 'text-warning');
    }
  }

  function loadSavedUiState() {
    editableFields.clear();
    const storageKey = workflowStorageKey();
    if (!storageKey || typeof localStorage === 'undefined') {
      renderEditableFields();
      refreshPromptPreview();
      return;
    }
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        renderEditableFields();
        refreshPromptPreview();
        return;
      }
      const payload = JSON.parse(raw);
      const fields = Array.isArray(payload?.fields) ? payload.fields : [];
      fields.forEach((saved) => {
        const descriptor = availableFields.get(saved.key || `${saved.nodeId}::${saved.field}`);
        if (!descriptor) return;
        const controlType =
          saved.controlType === 'prompt'
            ? 'prompt'
            : saved.controlType === 'number'
            ? 'number'
            : descriptor.controlType;
        editableFields.set(descriptor.key, Object.assign({}, descriptor, { controlType, value: saved.value }));
      });
      enforceSinglePrompt();
      renderEditableFields();
      refreshPromptPreview();
    } catch (err) {
      log('Failed to load saved UI state: ' + err.message, 'text-warning');
      renderEditableFields();
      refreshPromptPreview();
    }
  }

  function clearWorkflowUiState() {
    availableFields.clear();
    editableFields.clear();
    renderNodeFieldSelect();
    renderEditableFields();
    if (fieldAsPromptToggle) fieldAsPromptToggle.checked = false;
    if (wfJsonArea) wfJsonArea.value = '';
    if (promptTextInput) promptTextInput.value = '';
  }

  function buildAvailableFields(workflow) {
    availableFields.clear();
    const refs = collectNodeRefs(workflow);
    refs.forEach((ref) => {
      if (!ref.node || !ref.node.inputs || typeof ref.node.inputs !== 'object') return;
      Object.entries(ref.node.inputs).forEach(([field, value]) => {
        if (!isEditablePrimitive(value)) return;
        const key = `${ref.nodeId}::${field}`;
        if (availableFields.has(key)) return;
        availableFields.set(key, {
          key,
          nodeId: ref.nodeId,
          nodeLabel: ref.nodeLabel,
          field,
          defaultValue: value,
          value,
          controlType: typeof value === 'number' ? 'number' : 'text',
          loc: {
            mode: ref.mode,
            key: ref.key,
            nodeId: ref.nodeId,
            nodeLabel: ref.nodeLabel
          }
        });
      });
    });
    renderNodeFieldSelect();
  }

  function detectMediaTypeFromName(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.endsWith('.mkv') || lower.endsWith('.m4v')) {
      return 'video';
    }
    if (lower.endsWith('.gif')) return 'gif';
    if (lower.endsWith('.png') || lower.endsWith('.apng') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.bmp')) {
      return 'image';
    }
    return 'image';
  }

  function formatMediaBadgeText(mediaType) {
    if (!mediaType) return 'FILE';
    const mt = mediaType.toLowerCase();
    if (mt === 'video') return 'VIDEO';
    if (mt === 'gif') return 'GIF';
    return 'IMAGE';
  }

  function clearResults(message = '') {
    if (!resultsEl) return;
    resultsEl.innerHTML = '';
    if (message) {
      const div = document.createElement('div');
      div.className = 'text-muted';
      div.textContent = message;
      resultsEl.appendChild(div);
    }
  }

  async function checkHealth() {
    if (healthDot) {
      healthDot.className = 'badge bg-secondary';
      healthDot.textContent = 'checking…';
    }
    try {
      const resp = await api('/api/health');
      if (healthDot) {
        healthDot.className = resp.ok ? 'badge bg-success' : 'badge bg-warning';
        healthDot.textContent = resp.ok ? 'online' : 'warn';
      }
      if (instanceMetaEl) {
        const system = resp.system || resp;
        const os = system?.os ? `• ${system.os}` : '';
        instanceMetaEl.textContent = `Gateway reachable ${os}`.trim();
      }
      log('Health check OK');
    } catch (err) {
      if (healthDot) {
        healthDot.className = 'badge bg-danger';
        healthDot.textContent = 'offline';
      }
      if (instanceMetaEl) instanceMetaEl.textContent = 'Gateway unreachable';
      log('Health check failed: ' + err.message, 'text-danger');
    }
  }

  async function loadWorkflowJson(name, options = {}) {
    if (!name) return;
    currentWorkflowName = name;
    originalWorkflow = null;
    clearWorkflowUiState();
    try {
      const resp = await api(`/api/workflows/${encodeURIComponent(name)}`);
      const wf = resp?.workflow || resp;
      originalWorkflow = wf;
      buildAvailableFields(wf);
      loadSavedUiState();
      updateJsonViewer();
      if (!options.quiet) log(`Loaded workflow ${name}`);
    } catch (err) {
      log('Load workflow failed: ' + err.message, 'text-danger');
    }
  }

  async function loadWorkflows() {
    if (!wfSelect) return;
    setStatus('loading');
    wfSelect.disabled = true;
    try {
      const resp = await api('/api/workflows');
      const list = Array.isArray(resp?.workflows) ? resp.workflows : [];
      wfSelect.innerHTML = '';
      if (wfCount) wfCount.textContent = `${list.length} loaded`;
      if (!list.length) {
        wfSelect.disabled = true;
        clearWorkflowUiState();
        updateJsonViewer();
        setStatus('idle');
        clearResults('No workflows available.');
        return;
      }
      list.forEach((wf, idx) => {
        if (!wf || !wf.key) return;
        const opt = document.createElement('option');
        opt.value = wf.key;
        opt.textContent = wf.name || wf.key;
        if (typeof wf.bytes === 'number') opt.textContent += ` (${Math.round(wf.bytes / 1024)} KB)`;
        wfSelect.appendChild(opt);
        if (idx === 0 && !wfSelect.value) {
          wfSelect.value = wf.key;
        }
      });
      wfSelect.disabled = false;
      await loadWorkflowJson(wfSelect.value, { quiet: true });
      setStatus('ready');
      log(`Loaded ${list.length} workflow${list.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setStatus('error');
      log('Load workflows failed: ' + err.message, 'text-danger');
    }
  }

  function parseWorkflowJson() {
    if (originalWorkflow) {
      return cloneWorkflow(originalWorkflow);
    }
    if (!wfJsonArea) return null;
    const text = wfJsonArea.value.trim();
    if (!text) {
      log('Workflow JSON is empty.', 'text-warning');
      return null;
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      log('Workflow JSON invalid: ' + err.message, 'text-danger');
      return null;
    }
  }

  function buildWorkflowPayload() {
    const base = parseWorkflowJson();
    if (!base) return null;
    const payload = cloneWorkflow(base);
    return applyFieldOverrides(payload);
  }

  function updateJsonViewer() {
    if (!wfJsonArea) return;
    const payload = buildWorkflowPayload();
    wfJsonArea.value = payload ? JSON.stringify(payload, null, 2) : '';
  }

  function setFieldControlType(key, type) {
    const field = editableFields.get(key);
    if (!field) return;
    const nextType = type === 'number' ? 'number' : type === 'prompt' ? 'prompt' : 'text';
    field.controlType = nextType;
    if (nextType === 'prompt') {
      editableFields.forEach((entry, entryKey) => {
        if (entryKey !== key && entry.controlType === 'prompt') entry.controlType = 'text';
      });
    }
    saveUiState();
    renderEditableFields();
    refreshPromptPreview();
    updateJsonViewer();
  }

  function updateFieldValue(key, value) {
    const field = editableFields.get(key);
    if (!field) return;
    field.value = value;
    saveUiState();
    refreshPromptPreview();
    updateJsonViewer();
  }

  function makeSelectedFieldEditable() {
    if (!nodeFieldSelect) return;
    const selectedKey = nodeFieldSelect.value;
    if (!selectedKey) {
      log('Select a node field first.', 'text-warning');
      return;
    }
    const descriptor = availableFields.get(selectedKey);
    if (!descriptor) {
      log('Field not available in this workflow.', 'text-warning');
      return;
    }
    if (editableFields.has(descriptor.key)) {
      log('Field already editable.', 'text-muted');
      return;
    }
    const controlType = fieldAsPromptToggle && fieldAsPromptToggle.checked ? 'prompt' : descriptor.controlType;
    editableFields.set(descriptor.key, Object.assign({}, descriptor, { controlType }));
    if (fieldAsPromptToggle) fieldAsPromptToggle.checked = false;
    enforceSinglePrompt();
    saveUiState();
    renderEditableFields();
    refreshPromptPreview();
    updateJsonViewer();
  }

  function getPromptFieldValue() {
    const promptField = Array.from(editableFields.values()).find((f) => f.controlType === 'prompt');
    if (promptField) return String(promptField.value ?? promptField.defaultValue ?? '');
    return promptTextInput ? promptTextInput.value.trim() : '';
  }

  function hideRatingBar() {
    const el = document.getElementById('ratingBar');
    if (el) el.remove();
    ratingBarVisible = false;
  }

  function showRatingBar(jobId) {
    if (!jobId || ratingBarVisible) return;
    const cont = document.createElement('div');
    cont.id = 'ratingBar';
    cont.className = 'd-flex gap-2 align-items-center mt-3';
    const ratingButtons = [
      { label: 'Bad', value: 'bad', cls: 'btn-outline-secondary' },
      { label: 'OK', value: 'ok', cls: 'btn-outline-primary' },
      { label: 'Good', value: 'good', cls: 'btn-outline-success' },
      { label: 'Great', value: 'great', cls: 'btn-success' }
    ].map((entry) => `<button type="button" class="btn ${entry.cls}" data-rate="${entry.value}">${entry.label}</button>`).join('');
    cont.innerHTML = `
      <span class="text-muted">Rate this result:</span>
      <div class="btn-group" role="group" aria-label="Rating">
        ${ratingButtons}
      </div>
      <a class="btn btn-link btn-sm ms-1" href="/image_gen/good" target="_blank" rel="noopener">View saved</a>
      <span id="ratingMsg" class="text-muted ms-2"></span>
    `;
    const jobCard = document.getElementById('job_card_body') || document.body;
    jobCard.appendChild(cont);
    cont.querySelectorAll('button[data-rate]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const rating = e.currentTarget.getAttribute('data-rate');
        if (!rating) return;
        try {
          cont.querySelectorAll('button').forEach((b) => (b.disabled = true));
          const resp = await api('/api/rate', { method: 'POST', body: JSON.stringify({ job_id: jobId, rating }) });
          const savedCount = Array.isArray(resp?.saved) ? resp.saved.length : 0;
          const msgEl = cont.querySelector('#ratingMsg');
          if (resp?.warnings?.length) {
            resp.warnings.forEach((w) => log(w, 'text-warning'));
          }
          if (msgEl) msgEl.textContent = savedCount ? `Saved ${savedCount} favorite${savedCount === 1 ? '' : 's'} — thanks!` : 'Thanks!';
          setTimeout(hideRatingBar, 1500);
        } catch (err) {
          const msgEl = cont.querySelector('#ratingMsg');
          if (msgEl) msgEl.textContent = 'Rating failed';
          log('Rate failed: ' + err.message, 'text-danger');
          cont.querySelectorAll('button').forEach((b) => (b.disabled = false));
        }
      });
    });
    ratingBarVisible = true;
  }

  async function showResults(jobId, files) {
    clearResults();
    if (!resultsEl) return;
    const list = Array.isArray(files) ? files : [];
    if (!list.length) {
      clearResults('No outputs yet.');
      return;
    }
    list.forEach((file) => {
      const filename = file?.filename || file?.name || file?.file || 'output';
      const mediaType = (file?.media_type || detectMediaTypeFromName(filename)).toLowerCase();
      const bucket = file?.bucket || (mediaType === 'video' ? 'video' : 'output');
      const src = file?.cached_url || file?.gateway_view_url || file?.download_url || '';

      const col = document.createElement('div');
      col.className = 'col';
      const card = document.createElement('div');
      card.className = `thumb ${mediaType === 'video' ? 'thumb-video' : 'thumb-image'}`;

      const badge = document.createElement('span');
      badge.className = `media-badge media-badge--${mediaType}`;
      badge.textContent = formatMediaBadgeText(mediaType);
      card.appendChild(badge);

      let mediaEl;
      if (mediaType === 'video') {
        mediaEl = document.createElement('video');
        mediaEl.controls = true;
        mediaEl.preload = 'metadata';
        mediaEl.playsInline = true;
        mediaEl.muted = true;
      } else {
        mediaEl = document.createElement('img');
        mediaEl.alt = filename;
      }
      mediaEl.classList.add('thumb-media');
      if (src) {
        mediaEl.src = src;
      } else {
        mediaEl.classList.add('thumb-media--empty');
      }

      const caption = document.createElement('div');
      caption.className = 'muted mt-2';
      caption.textContent = filename;

      const actionRow = document.createElement('div');
      actionRow.className = 'd-flex justify-content-between align-items-center mt-2';

      const meta = document.createElement('span');
      meta.className = 'text-muted small';
      const bucketLabel = bucket || '';
      meta.textContent = bucketLabel ? `${bucketLabel}/` : '';
      actionRow.appendChild(meta);

      const downloadHref = file?.download_url || file?.cached_url || file?.gateway_view_url || '';
      if (downloadHref) {
        const dl = document.createElement('a');
        dl.href = downloadHref;
        dl.download = filename;
        dl.className = 'btn btn-sm btn-outline-primary';
        dl.textContent = 'Download';
        actionRow.appendChild(dl);
      }

      card.appendChild(mediaEl);
      card.appendChild(caption);
      card.appendChild(actionRow);
      col.appendChild(card);
      resultsEl.appendChild(col);
    });
  }

  async function generate() {
    if (!wfSelect) {
      log('Workflow selector missing.', 'text-danger');
      return;
    }
    const workflow = wfSelect.value;
    if (!workflow) {
      log('Select a workflow first.', 'text-warning');
      return;
    }
    const promptJson = buildWorkflowPayload();
    if (!promptJson) return;
    const promptText = getPromptFieldValue();
    const negativeText = negativeTextInput ? negativeTextInput.value.trim() : '';
    hideRatingBar();
    stopPolling();
    clearResults('Submitting job...');
    setStatus('submitting');
    const btn = $('#btnGenerate');
    if (btn) btn.disabled = true;
    try {
      const resp = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          workflow,
          prompt: promptJson,
          prompt_text: promptText,
          negative_prompt: negativeText
        })
      });
      currentJobId = resp.job_id || resp.prompt_id || null;
      if (jobIdInput) jobIdInput.value = currentJobId || '';
      await handleJobUpdate(resp);
      if (currentJobId && !isTerminalStatus(resp?.status)) {
        clearResults('Queued - waiting for outputs...');
        startPolling(currentJobId);
      }
      log(`Submitted job ${currentJobId || '(queued)'}.`, 'text-success');
    } catch (err) {
      setStatus('error');
      log('Submit failed: ' + err.message, 'text-danger');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadJobById() {
    const id = jobIdInput ? jobIdInput.value.trim() : '';
    if (!id) {
      log('Enter a job id first.', 'text-warning');
      return;
    }
    currentJobId = id;
    clearResults('Loading job status...');
    startPolling(id);
    log(`Polling job ${id}.`);
  }

  const btnLoad = $('#btnLoadWf');
  if (btnLoad) btnLoad.addEventListener('click', loadWorkflows);
  if (wfSelect) {
    wfSelect.addEventListener('change', (e) => loadWorkflowJson(e.target.value));
  }
  if (btnMakeEditable) btnMakeEditable.addEventListener('click', makeSelectedFieldEditable);
  if (btnViewJson) btnViewJson.addEventListener('click', updateJsonViewer);
  const btnGenerate = $('#btnGenerate');
  if (btnGenerate) btnGenerate.addEventListener('click', generate);
  const btnPoll = $('#btnPoll');
  if (btnPoll) btnPoll.addEventListener('click', loadJobById);
  const btnHealth = $('#btnHealth');
  if (btnHealth) btnHealth.addEventListener('click', checkHealth);

  renderNodeFieldSelect();
  renderEditableFields();
  setStatus('idle');
  loadWorkflows();
  checkHealth();
})(); 
