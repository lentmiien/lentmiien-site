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
  const inputUploadForm = $('#inputUploadForm');
  const inputFileEl = $('#inputFile');
  const inputOverwriteEl = $('#inputOverwrite');
  const inputUploadStatusEl = $('#inputUploadStatus');
  const inputBrowseSubfolderEl = $('#inputBrowseSubfolder');
  const inputFilterEl = $('#inputFilter');
  const inputGridEl = $('#inputGrid');
  const inputBrowserStatusEl = $('#inputBrowserStatus');
  const inputPageMetaEl = $('#inputPageMeta');
  const inputTargetFieldEl = $('#inputTargetField');
  const selectedInputNameEl = $('#selectedInputName');
  const btnUseInput = $('#btnUseInput');
  const btnInputPrev = $('#btnInputPrev');
  const btnInputNext = $('#btnInputNext');
  let ratingBarVisible = false;
  let currentJobId = null;
  let pollTimer = null;
  let pollJobId = null;
  let currentWorkflowName = null;
  let originalWorkflow = null;
  let inputFiles = [];
  let selectedInputFile = null;
  let inputPage = 1;
  let inputPages = 1;
  let inputTotal = 0;
  let inputFilesLoading = false;
  const availableFields = new Map();
  const editableFields = new Map();
  const STATUS_POLL_INTERVAL_MS = 2500;
  const STATUS_POLL_ERROR_INTERVAL_MS = 4500;
  const STATUS_POLL_MAX_ERROR_INTERVAL_MS = 60000;
  const STATUS_POLL_MAX_CONSECUTIVE_ERRORS = 8;
  const STATUS_POLL_JITTER_RATIO = 0.2;
  const JOB_STORAGE_KEY = 'imageGenActiveJobId';
  const JOB_STORAGE_TTL_MS = 24 * 60 * 60 * 1000;
  let pollErrorCount = 0;
  let pollStartedAt = 0;
  const INPUT_PAGE_SIZE = 48;
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
      let payload = null;
      try {
        payload = txt ? JSON.parse(txt) : null;
      } catch (_) {
        payload = null;
      }
      const upstreamMessage = payload?.error || payload?.details || txt;
      const err = new Error(`${resp.status} ${resp.statusText} ${upstreamMessage || ''}`.trim());
      err.status = resp.status;
      err.code = payload?.code || null;
      err.details = payload?.details || null;
      err.terminal = payload?.terminal === true;
      throw err;
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
    pollErrorCount = 0;
    pollStartedAt = 0;
  }

  function parseStoredJob(raw) {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      const jobId = typeof parsed?.jobId === 'string' ? parsed.jobId.trim() : '';
      const storedAt = Number(parsed?.storedAt);
      if (!jobId || !Number.isFinite(storedAt)) return null;
      return { jobId, storedAt };
    } catch (_) {
      // Legacy values had no timestamp and could be resumed forever. Discard them.
      return null;
    }
  }

  function getStoredJobId() {
    if (typeof localStorage === 'undefined') return null;
    try {
      const stored = parseStoredJob(localStorage.getItem(JOB_STORAGE_KEY));
      if (!stored || Date.now() - stored.storedAt > JOB_STORAGE_TTL_MS) {
        localStorage.removeItem(JOB_STORAGE_KEY);
        return null;
      }
      return stored.jobId;
    } catch (err) {
      return null;
    }
  }

  function storeJobId(jobId) {
    if (!jobId || typeof localStorage === 'undefined') return Date.now();
    try {
      const normalizedJobId = String(jobId).trim();
      const existing = parseStoredJob(localStorage.getItem(JOB_STORAGE_KEY));
      const storedAt = existing?.jobId === normalizedJobId ? existing.storedAt : Date.now();
      localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify({ jobId: normalizedJobId, storedAt }));
      return storedAt;
    } catch (err) {
      log('Unable to store job id: ' + err.message, 'text-warning');
      return Date.now();
    }
  }

  function clearStoredJobId(jobId) {
    if (typeof localStorage === 'undefined') return;
    try {
      const stored = parseStoredJob(localStorage.getItem(JOB_STORAGE_KEY));
      if (!jobId || !stored || stored.jobId === jobId) {
        localStorage.removeItem(JOB_STORAGE_KEY);
      }
    } catch (err) {
      log('Unable to clear stored job id: ' + err.message, 'text-warning');
    }
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
    const awaitingFiles = isSuccessStatus(job?.status) && files.length === 0;
    if (files.length) {
      await showResults(jobId, files);
    } else if (!fromPoll && job?.status) {
      if (awaitingFiles) {
        clearResults('Finalizing outputs...');
      } else {
        clearResults('No outputs yet.');
      }
    }

    if (jobId) {
      if (isTerminalStatus(job?.status) && !awaitingFiles) {
        clearStoredJobId(jobId);
      } else {
        storeJobId(jobId);
      }
    }

    if (isTerminalStatus(job?.status) && !awaitingFiles) {
      stopPolling();
      if (isSuccessStatus(job?.status)) {
        setStatus('completed');
        if (jobId) showRatingBar(jobId);
      } else {
        setStatus('error');
      }
      return true;
    }

    if (awaitingFiles) {
      setStatus('finalizing');
    } else {
      setStatus(normalizeStatus(job?.status) || 'running');
    }
    return false;
  }

  async function pollJob(jobId, { repeat = true } = {}) {
    if (!jobId) return;
    pollJobId = jobId;
    if (pollStartedAt && Date.now() - pollStartedAt > JOB_STORAGE_TTL_MS) {
      clearStoredJobId(jobId);
      stopPolling();
      setStatus('expired');
      setJobStatus('expired');
      clearResults('This job exceeded the polling lifetime.');
      log('Job polling expired after 24 hours.', 'text-warning');
      return;
    }
    try {
      const job = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      if (pollJobId !== jobId) return;
      pollErrorCount = 0;
      const done = await handleJobUpdate(job, { fromPoll: true });
      if (!done && repeat && pollJobId === jobId) {
        pollTimer = setTimeout(() => pollJob(jobId, { repeat: true }), STATUS_POLL_INTERVAL_MS);
      }
    } catch (err) {
      if (pollJobId !== jobId) return;
      if (err?.status === 404 || err?.code === 'JOB_NOT_FOUND' || err?.terminal === true) {
        clearStoredJobId(jobId);
        stopPolling();
        setStatus('expired');
        setJobStatus('not found');
        clearResults('This job expired or is no longer available.');
        log('Job expired or was not found; polling stopped.', 'text-warning');
        return;
      }

      pollErrorCount += 1;
      log('Poll failed: ' + err.message, 'text-danger');
      if (pollErrorCount >= STATUS_POLL_MAX_CONSECUTIVE_ERRORS) {
        clearStoredJobId(jobId);
        stopPolling();
        setStatus('unavailable');
        setJobStatus('unavailable');
        log('Polling stopped after repeated gateway errors. Retry manually when the gateway is available.', 'text-warning');
        return;
      }
      if (repeat && pollJobId === jobId) {
        const exponentialDelay = Math.min(
          STATUS_POLL_ERROR_INTERVAL_MS * Math.pow(2, pollErrorCount - 1),
          STATUS_POLL_MAX_ERROR_INTERVAL_MS
        );
        const jitter = exponentialDelay * STATUS_POLL_JITTER_RATIO * ((Math.random() * 2) - 1);
        const retryDelay = Math.max(STATUS_POLL_ERROR_INTERVAL_MS, Math.round(exponentialDelay + jitter));
        pollTimer = setTimeout(() => pollJob(jobId, { repeat: true }), retryDelay);
      }
    }
  }

  function startPolling(jobId) {
    if (!jobId) return;
    stopPolling();
    pollStartedAt = storeJobId(jobId);
    pollJob(jobId, { repeat: true });
  }

  function resumeStoredPolling() {
    if (pollJobId) return;
    const stored = getStoredJobId();
    const current = currentJobId || (jobIdInput ? jobIdInput.value.trim() : '');
    const jobId = current || stored;
    if (!jobId) return;
    currentJobId = jobId;
    if (jobIdInput && !jobIdInput.value) jobIdInput.value = jobId;
    startPolling(jobId);
    log(`Resuming polling for job ${jobId}.`);
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
    renderInputTargetFields();
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
    renderInputTargetFields();
  }

  function normalizeInputFile(file) {
    const source = typeof file === 'string' ? { path: file } : file;
    if (!source || typeof source !== 'object') return null;
    const subfolder = String(source.subfolder || '').trim().replace(/^\/+|\/+$/g, '');
    let filePath = String(source.path || '').trim().replace(/^\/+/, '');
    let filename = String(source.filename || source.name || '').trim();
    if (!filePath && filename) filePath = subfolder ? `${subfolder}/${filename}` : filename;
    if (!filename && filePath) filename = filePath.split('/').pop() || filePath;
    if (!filePath || !filename) return null;
    return {
      name: filename,
      filename,
      subfolder,
      path: filePath,
      size_bytes: Number(source.size_bytes),
      modified_ts: source.modified_ts,
      content_type: String(source.content_type || '').trim(),
      type: source.type || 'input'
    };
  }

  function inputPreviewUrl(file) {
    return `/image_gen/api/files/input/view?path=${encodeURIComponent(file.path)}`;
  }

  function inputFileExtension(name) {
    const filename = String(name || '');
    const dot = filename.lastIndexOf('.');
    return dot >= 0 && dot < filename.length - 1 ? filename.slice(dot + 1).toLowerCase() : '';
  }

  function detectInputPreviewType(file) {
    const contentType = String(file?.content_type || '').toLowerCase();
    const extension = inputFileExtension(file?.filename || file?.path);
    if (contentType.startsWith('image/') && contentType !== 'image/svg+xml') return 'image';
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'apng', 'bmp', 'avif'].includes(extension)) return 'image';
    if (contentType.startsWith('audio/')) return 'audio';
    if (['wav', 'mp3', 'm4a', 'aac', 'flac', 'ogg', 'oga', 'opus'].includes(extension)) return 'audio';
    if (contentType.startsWith('video/')) return 'video';
    if (['mp4', 'webm', 'mov', 'mkv', 'm4v', 'avi'].includes(extension)) return 'video';
    if (contentType === 'application/pdf' || extension === 'pdf') return 'pdf';
    if (contentType.startsWith('text/') || ['txt', 'json', 'csv', 'md', 'log'].includes(extension)) return 'text';
    return 'file';
  }

  function formatInputBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KiB', 'MiB', 'GiB'];
    let amount = bytes / 1024;
    let index = 0;
    while (amount >= 1024 && index < units.length - 1) {
      amount /= 1024;
      index += 1;
    }
    return `${amount.toFixed(amount >= 10 ? 1 : 2)} ${units[index]}`;
  }

  function createInputPreview(file) {
    const preview = document.createElement('div');
    preview.className = 'input-card__preview';
    const previewType = detectInputPreviewType(file);
    const src = inputPreviewUrl(file);
    let media;

    if (previewType === 'image') {
      media = document.createElement('img');
      media.alt = file.filename;
      media.loading = 'lazy';
      media.src = src;
    } else if (previewType === 'audio') {
      media = document.createElement('audio');
      media.controls = true;
      media.preload = 'metadata';
      media.src = src;
    } else if (previewType === 'video') {
      media = document.createElement('video');
      media.controls = true;
      media.preload = 'metadata';
      media.playsInline = true;
      media.src = src;
    } else if (previewType === 'pdf' || previewType === 'text') {
      media = document.createElement('iframe');
      media.title = `Preview of ${file.filename}`;
      media.loading = 'lazy';
      media.setAttribute('sandbox', '');
      media.src = src;
    } else {
      media = document.createElement('div');
      media.className = 'input-card__fallback';
      const extension = document.createElement('span');
      extension.className = 'input-card__extension';
      extension.textContent = inputFileExtension(file.filename) || 'FILE';
      const message = document.createElement('span');
      message.textContent = 'Preview unavailable';
      media.appendChild(extension);
      media.appendChild(message);
    }

    preview.appendChild(media);
    return preview;
  }

  function inputTargetScore(field, file) {
    const haystack = `${field.field || ''} ${field.nodeLabel || ''}`.toLowerCase();
    const mediaType = detectInputPreviewType(file);
    const mediaHints = {
      image: ['image', 'img', 'photo', 'picture', 'frame', 'reference', 'ref'],
      audio: ['audio', 'sound', 'voice', 'music', 'speech', 'reference', 'ref'],
      video: ['video', 'movie', 'clip', 'frames', 'reference', 'ref'],
      pdf: ['pdf', 'document', 'file', 'path'],
      text: ['text_file', 'document', 'file', 'path'],
      file: ['file', 'path', 'source', 'input']
    };
    let score = ['file', 'path', 'filename', 'source', 'input'].some((hint) => haystack.includes(hint)) ? 2 : 0;
    if ((mediaHints[mediaType] || mediaHints.file).some((hint) => haystack.includes(hint))) score += 4;
    const defaultType = detectInputPreviewType({ filename: String(field.defaultValue || '') });
    if (defaultType !== 'file' && defaultType === mediaType) score += 5;
    if (haystack.includes('prompt') || haystack.includes('negative')) score -= 5;
    return score;
  }

  function renderInputTargetFields() {
    if (!inputTargetFieldEl) return;
    const previousValue = inputTargetFieldEl.value;
    inputTargetFieldEl.innerHTML = '';
    const candidates = Array.from(availableFields.values())
      .filter((field) => typeof field.defaultValue === 'string')
      .map((field) => ({ field, score: selectedInputFile ? inputTargetScore(field, selectedInputFile) : 0 }))
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return `${left.field.nodeLabel} ${left.field.field}`.localeCompare(`${right.field.nodeLabel} ${right.field.field}`);
      });

    if (!candidates.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = originalWorkflow ? 'No string-valued fields in this workflow' : 'Load a workflow first';
      inputTargetFieldEl.appendChild(option);
      inputTargetFieldEl.disabled = true;
      if (btnUseInput) btnUseInput.disabled = true;
      return;
    }

    const recommended = candidates.filter((entry) => entry.score > 0);
    const other = candidates.filter((entry) => entry.score <= 0);
    const appendOptions = (label, entries) => {
      if (!entries.length) return;
      const group = document.createElement('optgroup');
      group.label = label;
      entries.forEach(({ field }) => {
        const option = document.createElement('option');
        option.value = field.key;
        const defaultValue = String(field.defaultValue || '');
        const summary = defaultValue.length > 34 ? `${defaultValue.slice(0, 31)}…` : defaultValue;
        option.textContent = `${field.nodeLabel} · ${field.field}${summary ? ` (${summary})` : ''}`;
        group.appendChild(option);
      });
      inputTargetFieldEl.appendChild(group);
    };
    appendOptions('Likely file inputs', recommended);
    appendOptions(recommended.length ? 'Other string fields' : 'String fields', other);
    inputTargetFieldEl.disabled = false;
    if (candidates.some((entry) => entry.field.key === previousValue)) {
      inputTargetFieldEl.value = previousValue;
    }
    if (!inputTargetFieldEl.value) inputTargetFieldEl.selectedIndex = 0;
    if (btnUseInput) btnUseInput.disabled = !selectedInputFile || !inputTargetFieldEl.value;
  }

  function updateInputCardSelection() {
    if (!inputGridEl) return;
    inputGridEl.querySelectorAll('.input-card').forEach((card) => {
      const selected = Boolean(selectedInputFile && card.dataset.inputPath === selectedInputFile.path);
      card.classList.toggle('is-selected', selected);
      const button = card.querySelector('[data-select-input]');
      if (button) {
        button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        button.textContent = selected ? 'Selected' : 'Select';
        button.classList.toggle('btn-warning', selected);
        button.classList.toggle('btn-outline-primary', !selected);
      }
    });
  }

  function selectInputFile(file) {
    selectedInputFile = normalizeInputFile(file);
    if (selectedInputNameEl) {
      selectedInputNameEl.textContent = selectedInputFile ? selectedInputFile.path : 'No file selected';
    }
    renderInputTargetFields();
    updateInputCardSelection();
  }

  function renderInputFiles() {
    if (!inputGridEl) return;
    inputGridEl.innerHTML = '';
    const filter = String(inputFilterEl?.value || '').trim().toLowerCase();
    const visibleFiles = inputFiles.filter((file) => !filter || file.path.toLowerCase().includes(filter));

    if (!visibleFiles.length) {
      const empty = document.createElement('div');
      empty.className = 'input-empty';
      empty.textContent = inputFiles.length ? 'No files on this page match the filter.' : 'No ComfyUI input files were found.';
      inputGridEl.appendChild(empty);
      return;
    }

    visibleFiles.forEach((file) => {
      const card = document.createElement('article');
      card.className = 'input-card';
      card.dataset.inputPath = file.path;
      card.appendChild(createInputPreview(file));

      const body = document.createElement('div');
      body.className = 'input-card__body';
      const filePath = document.createElement('div');
      filePath.className = 'input-card__path';
      filePath.textContent = file.path;
      body.appendChild(filePath);

      const metaParts = [formatInputBytes(file.size_bytes), formatTimestamp(file.modified_ts)].filter(Boolean);
      if (metaParts.length) {
        const meta = document.createElement('div');
        meta.className = 'input-card__meta';
        meta.textContent = metaParts.join(' · ');
        body.appendChild(meta);
      }

      const actions = document.createElement('div');
      actions.className = 'input-card__actions';
      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'btn btn-sm btn-outline-primary';
      selectButton.dataset.selectInput = file.path;
      selectButton.setAttribute('aria-pressed', 'false');
      selectButton.textContent = 'Select';
      selectButton.addEventListener('click', () => selectInputFile(file));
      actions.appendChild(selectButton);

      const openLink = document.createElement('a');
      openLink.className = 'btn btn-sm btn-outline-secondary';
      openLink.href = inputPreviewUrl(file);
      openLink.target = '_blank';
      openLink.rel = 'noopener';
      openLink.textContent = 'Open';
      actions.appendChild(openLink);
      body.appendChild(actions);
      card.appendChild(body);
      inputGridEl.appendChild(card);
    });
    updateInputCardSelection();
  }

  function updateInputPagination() {
    if (inputPageMetaEl) {
      inputPageMetaEl.textContent = `Page ${inputPage} of ${inputPages} · ${inputTotal} file${inputTotal === 1 ? '' : 's'}`;
    }
    if (btnInputPrev) btnInputPrev.disabled = inputFilesLoading || inputPage <= 1;
    if (btnInputNext) btnInputNext.disabled = inputFilesLoading || inputPage >= inputPages;
  }

  async function loadInputFiles({ page = inputPage } = {}) {
    if (!inputGridEl || inputFilesLoading) return;
    inputFilesLoading = true;
    inputPage = Math.max(1, Number(page) || 1);
    if (inputBrowserStatusEl) inputBrowserStatusEl.textContent = 'Loading ComfyUI input files…';
    updateInputPagination();
    const params = new URLSearchParams({
      recursive: 'true',
      page: String(inputPage),
      limit: String(INPUT_PAGE_SIZE)
    });
    const subfolder = String(inputBrowseSubfolderEl?.value || '').trim();
    if (subfolder) params.set('subfolder', subfolder);

    try {
      const payload = await api(`/api/files/input?${params.toString()}`);
      inputFiles = (Array.isArray(payload?.files) ? payload.files : [])
        .map(normalizeInputFile)
        .filter(Boolean);
      inputTotal = Number.isFinite(Number(payload?.total)) ? Number(payload.total) : inputFiles.length;
      inputPage = Math.max(1, Number(payload?.page) || inputPage);
      inputPages = Math.max(1, Number(payload?.pages) || 1);
      if (selectedInputFile) {
        const refreshedSelection = inputFiles.find((file) => file.path === selectedInputFile.path);
        if (refreshedSelection) selectedInputFile = refreshedSelection;
      }
      renderInputFiles();
      if (inputBrowserStatusEl) {
        inputBrowserStatusEl.textContent = inputFiles.length
          ? `Showing ${inputFiles.length} file${inputFiles.length === 1 ? '' : 's'} from ComfyUI input storage.`
          : 'This location has no input files.';
      }
    } catch (err) {
      inputFiles = [];
      inputTotal = 0;
      inputPages = 1;
      renderInputFiles();
      if (inputBrowserStatusEl) inputBrowserStatusEl.textContent = `Could not load input files: ${err.message}`;
      log('Load input files failed: ' + err.message, 'text-danger');
    } finally {
      inputFilesLoading = false;
      updateInputPagination();
    }
  }

  function setInputUploadStatus(message, className = 'text-muted') {
    if (!inputUploadStatusEl) return;
    inputUploadStatusEl.className = `small mt-2 ${className}`;
    inputUploadStatusEl.textContent = message;
  }

  async function uploadInput(event) {
    event.preventDefault();
    const file = inputFileEl?.files?.[0];
    if (!file) {
      setInputUploadStatus('Choose a file to upload.', 'text-warning');
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      setInputUploadStatus('The selected file is larger than 100 MiB.', 'text-danger');
      return;
    }

    const submitButton = $('#btnUploadInput');
    if (submitButton) submitButton.disabled = true;
    setInputUploadStatus(`Uploading ${file.name}…`);
    try {
      const formData = new FormData(inputUploadForm);
      const payload = await api('/api/files/input', { method: 'POST', body: formData });
      const uploaded = normalizeInputFile(payload?.file || payload);
      if (uploaded) {
        selectInputFile(uploaded);
        if (inputBrowseSubfolderEl) inputBrowseSubfolderEl.value = uploaded.subfolder || '';
      }
      if (inputFileEl) inputFileEl.value = '';
      if (inputOverwriteEl) inputOverwriteEl.checked = false;
      setInputUploadStatus(`${uploaded?.path || file.name} is ready for a workflow.`, 'text-success');
      await loadInputFiles({ page: 1 });
      log(`Uploaded ComfyUI input ${uploaded?.path || file.name}.`, 'text-success');
    } catch (err) {
      const conflict = String(err.message || '').startsWith('409');
      setInputUploadStatus(
        conflict ? 'That destination already exists. Enable replacement to overwrite it.' : `Upload failed: ${err.message}`,
        'text-danger'
      );
      log('Input upload failed: ' + err.message, 'text-danger');
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  }

  function useSelectedInput() {
    if (!selectedInputFile || !inputTargetFieldEl?.value) {
      log('Select an input file and workflow field first.', 'text-warning');
      return;
    }
    const descriptor = availableFields.get(inputTargetFieldEl.value);
    if (!descriptor) {
      log('The selected workflow field is no longer available.', 'text-warning');
      return;
    }
    const existing = editableFields.get(descriptor.key);
    if (existing) {
      existing.value = selectedInputFile.path;
      existing.controlType = 'text';
    } else {
      editableFields.set(descriptor.key, Object.assign({}, descriptor, {
        value: selectedInputFile.path,
        controlType: 'text'
      }));
    }
    saveUiState();
    renderEditableFields();
    refreshPromptPreview();
    updateJsonViewer();
    log(`Using ${selectedInputFile.path} for ${descriptor.nodeLabel} · ${descriptor.field}.`, 'text-success');
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
      const done = await handleJobUpdate(resp);
      if (currentJobId && !done) {
        const hasFiles = Array.isArray(resp?.files) && resp.files.length > 0;
        if (!hasFiles && !isSuccessStatus(resp?.status)) {
          clearResults('Queued - waiting for outputs...');
        }
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
  if (inputUploadForm) inputUploadForm.addEventListener('submit', uploadInput);
  const btnRefreshInputs = $('#btnRefreshInputs');
  if (btnRefreshInputs) btnRefreshInputs.addEventListener('click', () => loadInputFiles());
  const btnBrowseInputs = $('#btnBrowseInputs');
  if (btnBrowseInputs) btnBrowseInputs.addEventListener('click', () => loadInputFiles({ page: 1 }));
  if (inputBrowseSubfolderEl) {
    inputBrowseSubfolderEl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      loadInputFiles({ page: 1 });
    });
  }
  if (inputFilterEl) inputFilterEl.addEventListener('input', renderInputFiles);
  if (btnInputPrev) btnInputPrev.addEventListener('click', () => loadInputFiles({ page: inputPage - 1 }));
  if (btnInputNext) btnInputNext.addEventListener('click', () => loadInputFiles({ page: inputPage + 1 }));
  if (inputTargetFieldEl) {
    inputTargetFieldEl.addEventListener('change', () => {
      if (btnUseInput) btnUseInput.disabled = !selectedInputFile || !inputTargetFieldEl.value;
    });
  }
  if (btnUseInput) btnUseInput.addEventListener('click', useSelectedInput);

  renderNodeFieldSelect();
  renderInputTargetFields();
  renderEditableFields();
  updateInputPagination();
  setStatus('idle');
  loadWorkflows();
  loadInputFiles();
  checkHealth();
  resumeStoredPolling();
})(); 
