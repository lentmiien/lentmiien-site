// public/js/image_gen.js (full updated, includes rating + prompt library)
(function(){
  const $ = (s, r=document)=>r.querySelector(s);
  const logEl = $('#log');
  const statusPill = $('#statusPill');
  const promptFilterInput = $('#promptFilter');
  const browseArea = $('#browseArea');
  const browsePagination = $('#browsePagination');
  const browseSummary = $('#browseSummary');
  const browsePageLabel = $('#browsePageLabel');
  const browsePrevBtn = $('#browsePrev');
  const browseNextBtn = $('#browseNext');

  const instanceSelect = $('#instanceSelect');
  const instanceMetaEl = $('#instanceMeta');
  const instanceReloadBtn = $('#btnReloadInstances');

  let instances = [];
  let instanceMap = new Map();
  let currentInstanceId = null;

  let workflows = [];
  let wfMap = new Map();
  const workflowCache = new Map();
  let currentJobId = null;
  let activePollContext = null;
  let ratingBarVisible = false;
  let lastFocusedImageInputId = null;
  const imageDatalistId = 'inputImageNames';
  const inputFilenameState = {
    names: [],
    fetchPromise: null
  };
  const BROWSE_PAGE_SIZE = 24;
  const browseState = {
    bucket: null,
    items: [],
    page: 1,
    perPage: BROWSE_PAGE_SIZE
  };

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

  function setStatus(t){ statusPill.textContent = t; }
  function log(msg, cls){
    const t = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    if (cls) div.classList.add(cls);
    div.textContent = `[${t}] ${msg}`;
    logEl.prepend(div);
  }
  function isPlainObject(value){
    if (!value || typeof value !== 'object') return false;
    if (value instanceof FormData) return false;
    if (value instanceof URLSearchParams) return false;
    if (typeof Blob !== 'undefined' && value instanceof Blob) return false;
    if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) return false;
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(value)) return false;
    return Object.getPrototypeOf(value) === Object.prototype;
  }
  function withInstanceParam(url, instanceId = currentInstanceId){
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
  async function api(path, opts={}){
    const init = Object.assign({ headers: {} }, opts);
    const skipInstance = Boolean(init.skipInstance);
    if ('skipInstance' in init) delete init.skipInstance;
    const method = (init.method || 'GET').toUpperCase();
    init.method = method;
    const inst = currentInstanceId;
    let url = `/image_gen${path}`;
    if (!skipInstance && inst) {
      if (method === 'GET' || method === 'HEAD') {
        url = withInstanceParam(url, inst);
      } else if (init.body instanceof FormData) {
        if (!init.body.has('instance_id')) init.body.append('instance_id', inst);
      } else {
        let augmented = false;
        if (typeof init.body === 'string' && init.body.trim()) {
          try {
            const parsed = JSON.parse(init.body);
            if (parsed && typeof parsed === 'object' && !parsed.instance_id && !parsed.instanceId) {
              parsed.instance_id = inst;
            }
            init.body = JSON.stringify(parsed);
            augmented = true;
          } catch (err) {
            augmented = false;
          }
        } else if (isPlainObject(init.body)) {
          const payload = Object.assign({}, init.body);
          if (!payload.instance_id && !payload.instanceId) {
            payload.instance_id = inst;
          }
          init.body = JSON.stringify(payload);
          augmented = true;
        } else if (!init.body) {
          init.body = JSON.stringify({ instance_id: inst });
          augmented = true;
        }
        if (!augmented) {
          url = withInstanceParam(url, inst);
        }
      }
    }
    if(!(init.body instanceof FormData) && method !== 'GET' && method !== 'HEAD'){
      init.headers['Content-Type'] = init.headers['Content-Type'] || 'application/json';
    }
    const r = await fetch(url, init);
    if(!r.ok){
      const textResp = await r.text().catch(()=> '');
      throw new Error(`${r.status} ${r.statusText}  E${textResp}`);
    }
    const ct = r.headers.get('content-type') || '';
    if(ct.includes('application/json')) return r.json();
    return r;
  }
  function isImageInputSpec(spec){
    if (!spec || !spec.key) return false;
    const type = (spec.type || '').toLowerCase();
    if (type === 'image' || type === 'file') return true;
    const key = spec.key.toLowerCase();
    if (key === 'image' || key === 'input_image') return true;
    if (/^image(_\d+)?$/.test(key)) return true;
    if (/^image\d+$/.test(key)) return true;
    if (key.endsWith('_image')) return true;
    return false;
  }

  function ensureImageDatalist(){
    let list = document.getElementById(imageDatalistId);
    if (!list) {
      list = document.createElement('datalist');
      list.id = imageDatalistId;
      document.body.appendChild(list);
    }
    return list;
  }

  function renderImageFilenameOptions(){
    const list = ensureImageDatalist();
    list.innerHTML = '';
    const names = inputFilenameState.names.slice().sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = name;
      list.appendChild(opt);
    }
  }

  function resetInputFilenameCache(){
    inputFilenameState.names = [];
    inputFilenameState.fetchPromise = null;
    const list = document.getElementById(imageDatalistId);
    if (list) list.innerHTML = '';
  }

  function mergeInputFilename(name){
    if (!name) return;
    if (!inputFilenameState.names.includes(name)) {
      inputFilenameState.names.push(name);
      renderImageFilenameOptions();
    }
  }

  function mergeInputFilenames(names){
    let added = false;
    for (const name of names || []) {
      if (name && !inputFilenameState.names.includes(name)) {
        inputFilenameState.names.push(name);
        added = true;
      }
    }
    if (added) renderImageFilenameOptions();
  }

  function describeInstance(instance){
    if (!instance) return '';
    const parts = [];
    const name = instance.name || instance.id || 'unknown';
    parts.push(name);
    const storage = typeof instance.storage === 'string'
      ? instance.storage
      : (instance.storage && instance.storage.mode);
    if (storage) parts.push(`${storage} storage`);
    if (Array.isArray(instance.workflows)) {
      const count = instance.workflows.length;
      parts.push(`${count} workflow${count === 1 ? '' : 's'}`);
    }
    return parts.join(' • ');
  }

  function setInstanceMeta(text){
    if (instanceMetaEl) instanceMetaEl.textContent = text || '';
  }

  function renderInstanceMeta(){
    const summary = describeInstance(instanceMap.get(currentInstanceId)) || 'Select an instance to load workflows.';
    setInstanceMeta(summary);
  }

  function populateInstanceOptions(list, selectedId){
    if (!instanceSelect) return;
    instanceSelect.innerHTML = '';
    if (!Array.isArray(list) || !list.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No instances available';
      opt.disabled = true;
      instanceSelect.appendChild(opt);
      instanceSelect.value = '';
      instanceSelect.disabled = true;
      return;
    }
    list.forEach(inst => {
      if (!inst || !inst.id) return;
      const opt = document.createElement('option');
      opt.value = inst.id;
      opt.textContent = inst.name || inst.id;
      instanceSelect.appendChild(opt);
    });
    const validIds = new Set(list.filter(inst => inst && inst.id).map(inst => inst.id));
    const desired = selectedId && validIds.has(selectedId) ? selectedId : list[0].id;
    instanceSelect.value = desired;
    instanceSelect.disabled = false;
  }

  function pruneWorkflowCache(){
    for (const key of Array.from(workflowCache.keys())) {
      if (!instanceMap.has(key)) workflowCache.delete(key);
    }
  }

  function handleNoInstanceWorkflows(){
    workflows = [];
    wfMap = new Map();
    const sel = $('#wfSelect');
    if (sel) {
      sel.innerHTML = '';
      sel.disabled = true;
    }
    const wfCountEl = $('#wfCount');
    if (wfCountEl) wfCountEl.textContent = '0 loaded';
    clearForm('Select an instance to load workflows.');
    const generateBtn = $('#btnGenerate');
    if (generateBtn) generateBtn.disabled = true;
  }

  async function changeInstance(newId, options = {}){
    const targetId = newId ? String(newId).trim() : '';
    const resolvedId = targetId || null;
    const previous = currentInstanceId;
    const isSame = previous === resolvedId;
    const forceWorkflows = Boolean(options.forceWorkflows);
    if (isSame && !forceWorkflows) {
      renderInstanceMeta();
      return;
    }
    if (!isSame) {
      if (instanceSelect && instanceSelect.value !== (resolvedId || '')) {
        instanceSelect.value = resolvedId || '';
      }
      if (activePollContext && activePollContext.jobId) {
        cancelActivePoll({
          reason: `Instance changed to ${resolvedId || 'none'}. Polling paused for job ${activePollContext.jobId}.`,
          background: Boolean(currentJobId)
        });
      }
      currentInstanceId = resolvedId;
      resetInputFilenameCache();
    }
    renderInstanceMeta();
    if (!currentInstanceId) {
      handleNoInstanceWorkflows();
      return;
    }
    await loadWorkflows({ force: forceWorkflows, instanceId: currentInstanceId });
  }

  async function loadInstances(options = {}){
    if (!instanceSelect) return;
    const preserveSelection = Boolean(options.preserveSelection);
    instanceSelect.disabled = true;
    if (instanceReloadBtn) instanceReloadBtn.disabled = true;
    setInstanceMeta('Loading instances…');
    try {
      const payload = await api('/api/instances', { skipInstance: true });
      const list = Array.isArray(payload?.instances) ? payload.instances : [];
      instances = list;
      instanceMap = new Map(list.filter(inst => inst && inst.id).map(inst => [inst.id, inst]));
      pruneWorkflowCache();
      let nextId = currentInstanceId;
      if (!preserveSelection || !instanceMap.has(nextId)) {
        if (payload && payload.default_instance_id && instanceMap.has(payload.default_instance_id)) {
          nextId = payload.default_instance_id;
        } else {
          const flagged = list.find(inst => inst && (inst.default === true || inst.is_default === true));
          nextId = flagged && flagged.id ? flagged.id : (list[0] && list[0].id) || null;
        }
      }
      populateInstanceOptions(list, nextId);
      const appliedId = instanceSelect ? (instanceSelect.value || '') : (nextId || '');
      await changeInstance(appliedId, { forceWorkflows: true });
      log(`Loaded ${list.length} instance${list.length === 1 ? '' : 's'}.`);
    } catch (err) {
      instances = [];
      instanceMap = new Map();
      currentInstanceId = null;
      populateInstanceOptions([], null);
      handleNoInstanceWorkflows();
      setInstanceMeta('Failed to load instances.');
      log('Load instances failed: ' + err.message, 'text-danger');
    } finally {
      if (instanceSelect) instanceSelect.disabled = !instances.length;
      if (instanceReloadBtn) instanceReloadBtn.disabled = false;
    }
  }

  function extractNamesFromFileResponse(resp){
    const set = new Set();
    if (!resp) return [];
    if (Array.isArray(resp.cached)) {
      resp.cached.forEach(item => {
        if (item?.name) set.add(item.name);
        if (item?.original) set.add(item.original);
      });
    }
    if (Array.isArray(resp.files)) {
      resp.files.forEach(entry => {
        if (typeof entry === 'string') {
          set.add(entry);
        } else if (entry) {
          if (entry.name) set.add(entry.name);
          if (entry.original) set.add(entry.original);
        }
      });
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }

  async function ensureInputFileNames(force = false){
    if (!currentInstanceId) return [];
    if (!force && inputFilenameState.names.length) return inputFilenameState.names;
    if (inputFilenameState.fetchPromise && !force) return inputFilenameState.fetchPromise;
    inputFilenameState.fetchPromise = (async () => {
      try {
        const resp = await api('/api/files/input');
        const names = extractNamesFromFileResponse(resp);
        inputFilenameState.names = names;
        renderImageFilenameOptions();
        return names;
      } catch (_) {
        return [];
      } finally {
        inputFilenameState.fetchPromise = null;
      }
    })();
    return inputFilenameState.fetchPromise;
  }

  function handleImageInputFocus(e){
    lastFocusedImageInputId = e.currentTarget.id;
    if (!inputFilenameState.names.length && !inputFilenameState.fetchPromise) {
      ensureInputFileNames().catch(()=>{});
    }
  }

  function registerImageInputField(input, spec){
    if (!input) return;
    ensureImageDatalist();
    input.dataset.imageInput = '1';
    input.dataset.imageKey = spec?.key || '';
    input.setAttribute('list', imageDatalistId);
    if (!input.placeholder) input.placeholder = 'filename in input/ (e.g. photo.png)';
    input.addEventListener('focus', handleImageInputFocus);
    input.addEventListener('click', handleImageInputFocus);
  }

  function getImageInputs(){
    return Array.from(document.querySelectorAll('#formArea input[data-image-input="1"]'));
  }

  function getPreferredImageInput(){
    const inputs = getImageInputs();
    if (!inputs.length) return null;
    if (lastFocusedImageInputId) {
      const focused = document.getElementById(lastFocusedImageInputId);
      if (focused && inputs.includes(focused)) return focused;
    }
    return inputs[0];
  }

  function setImageInputValue(value, opts = {}){
    const target = getPreferredImageInput();
    if (!target) {
      if (!opts.silent) log('No image input fields available.', 'text-warning');
      return false;
    }
    target.value = value;
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      try { target.focus(); } catch (_) {}
    }
    if (!opts.silent) {
      const label = target.dataset.imageKey || 'image';
      log(`Selected ${value} for ${label}.`);
    }
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    lastFocusedImageInputId = target.id;
    return true;
  }

  function initializeImageInputs(imageControls){
    if (!imageControls.length) {
      lastFocusedImageInputId = null;
      return;
    }
    const extras = imageControls.slice(1);
    imageControls.forEach(({ col, input, spec }, index) => {
      registerImageInputField(input, spec);
      col.classList.add('image-input');
      if (index === 0) {
        lastFocusedImageInputId = input.id;
        col.classList.remove('d-none');
      } else {
        col.classList.add('d-none', 'image-input-extra');
      }
    });
    if (extras.length) {
      const firstCol = imageControls[0].col;
      const wrap = document.createElement('div');
      wrap.className = 'mt-2';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-sm btn-outline-secondary';
      btn.textContent = `Show ${extras.length} more image input${extras.length > 1 ? 's' : ''}`;
      btn.setAttribute('data-expanded', '0');
      btn.addEventListener('click', () => {
        const expand = btn.getAttribute('data-expanded') !== '1';
        btn.setAttribute('data-expanded', expand ? '1' : '0');
        extras.forEach(({ col }) => col.classList.toggle('d-none', !expand));
        btn.textContent = expand ? 'Hide extra image inputs' : `Show ${extras.length} more image input${extras.length > 1 ? 's' : ''}`;
      });
      wrap.appendChild(btn);
      firstCol.appendChild(wrap);
    }
  }

  // Health
  $('#btnHealth').addEventListener('click', async ()=>{
    try {
      const j = await api('/api/health');
      const dot = $('#healthDot');
      dot.textContent = j.ok ? 'ok' : 'error';
      dot.className = `badge ${j.ok ? 'bg-success' : 'bg-danger'}`;
      log('Health ok.');
    } catch (e) {
      const dot = $('#healthDot');
      dot.textContent = 'error';
      dot.className = 'badge bg-danger';
      log('Health failed: ' + e.message, 'text-danger');
    }
  });

  // Workflows
  function clearForm(descText = ''){
    $('#formArea').innerHTML = '';
    const descEl = $('#wfDesc');
    if (descEl) {
      descEl.textContent = descText || '';
      descEl.dataset.outputType = '';
    }
  }
  function ctl(spec){
    const col = document.createElement('div');
    col.className = 'col-12 col-md-6';
    const id = 'inp_' + spec.key;

    const label = document.createElement('label');
    label.className = 'form-label';
    label.setAttribute('for', id);
    label.textContent = spec.key + (spec.required ? ' *' : '');
    col.appendChild(label);

    let ctrl;
    if (spec.type === 'string' && (spec.key === 'prompt' || spec.key === 'negative')) {
      ctrl = document.createElement('textarea');
      ctrl.className = 'form-control';
      ctrl.rows = spec.key === 'prompt' ? 5 : 3;
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
    if (spec.default !== undefined) ctrl.value = spec.default;
    if (isImageInputSpec(spec) && ctrl.tagName === 'INPUT') ctrl.placeholder = 'filename in input/ (e.g. photo.png)';
    col.appendChild(ctrl);

    if (spec.note || spec.default !== undefined) {
      const small = document.createElement('small');
      small.className = 'text-muted';
      small.textContent = (spec.note ? spec.note + ' ' : '') + (spec.default !== undefined ? `(default: ${spec.default})` : '');
      col.appendChild(small);
    }
    return col;
  }
  function renderForm(def){
    clearForm();
    if(!def) return;
    const descParts = [];
    if (def.description) descParts.push(def.description);
    if (def.outputType) {
      const typeLabel = def.outputType === 'video' ? 'Outputs video.' : 'Outputs images.';
      descParts.push(typeLabel);
    }
    $('#wfDesc').textContent = descParts.join(' ');
    $('#wfDesc').dataset.outputType = def.outputType || '';
    const area = $('#formArea');
    const imageControls = [];
    def.inputs.forEach(spec => {
      const col = ctl(spec);
      area.appendChild(col);
      if (isImageInputSpec(spec)) {
        const input = col.querySelector('#inp_' + spec.key);
        if (input) imageControls.push({ spec, col, input });
      }
    });
    initializeImageInputs(imageControls);
  }
  function applyWorkflowList(instanceId, list){
    if (instanceId !== currentInstanceId) return;
    workflows = Array.isArray(list) ? list : [];
    wfMap = new Map(workflows.map(w => [w.key, w]));
    const sel = $('#wfSelect');
    if (!sel) return;
    const previousValue = sel.value;
    sel.innerHTML = '';
    if (!workflows.length) {
      sel.disabled = true;
      clearForm('No workflows available for this instance.');
      const wfCountEl = $('#wfCount');
      if (wfCountEl) wfCountEl.textContent = '0 loaded';
      const btnGenerate = $('#btnGenerate');
      if (btnGenerate) btnGenerate.disabled = true;
      return;
    }
    workflows.forEach(w => {
      if (!w || !w.key) return;
      const opt = document.createElement('option');
      opt.value = w.key;
      const labelParts = [];
      labelParts.push(w.name || w.key);
      if (w.outputType) {
        labelParts.push(`· ${String(w.outputType).toUpperCase()}`);
      }
      opt.textContent = labelParts.join(' ');
      opt.dataset.outputType = w.outputType || '';
      sel.appendChild(opt);
    });
    sel.disabled = false;
    const desired = wfMap.has(previousValue) ? previousValue : (workflows[0] && workflows[0].key);
    if (desired) sel.value = desired;
    const wfCountEl = $('#wfCount');
    if (wfCountEl) wfCountEl.textContent = `${workflows.length} loaded`;
    const btnGenerate = $('#btnGenerate');
    if (btnGenerate) btnGenerate.disabled = false;
    const def = desired ? wfMap.get(desired) : null;
    if (def) {
      renderForm(def);
    } else {
      clearForm();
    }
  }
  async function loadWorkflows(options = {}){
    const instanceId = options.instanceId || currentInstanceId;
    if (!instanceId) {
      handleNoInstanceWorkflows();
      return;
    }
    const sel = $('#wfSelect');
    if (sel) sel.disabled = true;
    setStatus('loading');
    if (!options.force) {
      const cached = workflowCache.get(instanceId);
      if (cached && Array.isArray(cached.workflows)) {
        applyWorkflowList(instanceId, cached.workflows);
        setStatus('ready');
        return;
      }
    }
    try{
      const j = await api('/api/workflows');
      const list = Array.isArray(j?.workflows) ? j.workflows : [];
      if (instanceId === currentInstanceId) {
        workflowCache.set(instanceId, { workflows: list, fetchedAt: Date.now() });
        applyWorkflowList(instanceId, list);
        setStatus('ready');
        log(`Loaded ${list.length} workflow${list.length === 1 ? '' : 's'} for ${instanceId}.`);
      }
    }catch(e){
      if (instanceId === currentInstanceId) {
        setStatus('error');
        log('Load workflows failed: ' + e.message, 'text-danger');
      }
    } finally {
      if (sel && instanceId === currentInstanceId) {
        sel.disabled = !workflows.length;
      }
    }
  }
  const reloadBtn = $('#btnLoadWf');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', ()=> loadWorkflows({ force: true }));
  }
  if (instanceSelect) {
    instanceSelect.addEventListener('change', (e)=>{
      changeInstance(e.target.value, { forceWorkflows: true }).catch(err => {
        log('Failed to switch instance: ' + err.message, 'text-danger');
      });
    });
  }
  if (instanceReloadBtn) {
    instanceReloadBtn.addEventListener('click', ()=>{
      loadInstances({ preserveSelection: true }).catch(err => {
        log('Reload instances failed: ' + err.message, 'text-danger');
      });
    });
  }
  const wfSelectEl = $('#wfSelect');
  if (wfSelectEl) {
    wfSelectEl.addEventListener('change', (e)=>{
      const def = wfMap.get(e.target.value);
      renderForm(def);
    });
  }

  // Generate
  async function generate(){
    if (!currentInstanceId) {
      log('Select an instance first.', 'text-warning');
      return;
    }
    const def = wfMap.get($('#wfSelect').value);
    if(!def){ log('Select a workflow first.', 'text-warning'); return; }

    const inputs = {};
    for(const spec of def.inputs){
      const el = $('#inp_' + spec.key);
      if(!el) continue;
      if(spec.type === 'number') {
        const v = el.value.trim();
        inputs[spec.key] = v === '' ? spec.default ?? null : Number(v);
      } else {
        inputs[spec.key] = el.value;
      }
      if (spec.required && (inputs[spec.key] === '' || inputs[spec.key] === null || inputs[spec.key] === undefined)) {
        log(`Missing required: ${spec.key}`, 'text-warning');
        return;
      }
    }

    $('#btnGenerate').disabled = true;
    setStatus('queuing');
    hideRatingBar();
    try{
      const resp = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({ workflow: $('#wfSelect').value, inputs })
      });
      $('#jobId').value = resp.job_id || '';
      currentJobId = resp.job_id || null;
      $('#jobStatus').textContent = 'queued';
      log(`Queued job ${resp.job_id}`);
      await poll(resp.job_id);
    }catch(e){
      log('Generate failed: ' + e.message, 'text-danger');
    }finally{
      $('#btnGenerate').disabled = false;
    }
  }
  $('#btnGenerate').addEventListener('click', generate);
  $('#btnPoll').addEventListener('click', ()=>{
    const id = $('#jobId').value.trim();
    if (id) poll(id);
  });

  function cancelActivePoll(options = {}){
    if (!activePollContext) return;
    activePollContext.cancelled = true;
    if (options.background) {
      setStatus('background');
      const jobStatusEl = $('#jobStatus');
      if (jobStatusEl) jobStatusEl.textContent = 'background';
    }
    if (!options.silent) {
      if (options.reason) {
        log(options.reason, 'text-muted');
      } else {
        log('Stopped polling.', 'text-muted');
      }
    }
  }

  async function poll(jobId){
    const trimmed = String(jobId || '').trim();
    if (!trimmed) return;
    cancelActivePoll({ silent: true });
    const context = { jobId: trimmed, instanceId: currentInstanceId, cancelled: false };
    activePollContext = context;
    setStatus('waiting');
    const resultsEl = $('#results');
    if (resultsEl) resultsEl.innerHTML = '';
    const jobStatusEl = $('#jobStatus');
    if (jobStatusEl) jobStatusEl.textContent = '-';
    for (let i=0;i<300;i++){
      if (context.cancelled || activePollContext !== context) return;
      try{
        const j = await api(`/api/jobs/${encodeURIComponent(trimmed)}`);
        if (context.cancelled || activePollContext !== context) return;
        if (jobStatusEl) jobStatusEl.textContent = j.status;
        const jobInstanceId = j.instance_id || context.instanceId || currentInstanceId;
        if (j.status === 'completed') {
          setStatus('completed');
          const counts = (j.files || []).reduce((acc, file) => {
            const mt = (file?.media_type || '').toLowerCase();
            if (mt === 'video') acc.videos += 1;
            else acc.images += 1;
            return acc;
          }, { images: 0, videos: 0 });
          const parts = [];
          if (counts.images) parts.push(`${counts.images} image${counts.images === 1 ? '' : 's'}`);
          if (counts.videos) parts.push(`${counts.videos} video${counts.videos === 1 ? '' : 's'}`);
          log(`Completed with ${parts.join(' and ') || 'no files'}.`, 'text-success');
          await showResults(trimmed, j.files, jobInstanceId);
          showRatingBar(trimmed);
          if (activePollContext === context) activePollContext = null;
          return;
        } else if (j.status === 'failed') {
          setStatus('failed');
          log(`Failed: ${j.error || 'Unknown error'}`, 'text-danger');
          if (activePollContext === context) activePollContext = null;
          return;
        }
      }catch(e){
        if (context.cancelled || activePollContext !== context) return;
        log('Poll error: ' + e.message, 'text-danger');
      }
      if (context.cancelled || activePollContext !== context) return;
      await new Promise(r=>setTimeout(r, 2000));
    }
    if (activePollContext === context) activePollContext = null;
    if (!context.cancelled) {
      setStatus('timeout');
      log('Polling timeout.', 'text-warning');
    }
  }

  async function showResults(jobId, files, instanceId){
    const effectiveInstanceId = instanceId || currentInstanceId;
    const wrap = $('#results');
    wrap.innerHTML = '';
    if (!Array.isArray(files) || !files.length) {
      wrap.innerHTML = '<div class="text-muted">No outputs yet.</div>';
      return;
    }
    for (let index = 0; index < files.length; index++) {
      const fileMeta = files[index];
      const data = typeof fileMeta === 'string' ? { filename: fileMeta } : (fileMeta || {});
      const filename = data.filename || data.name || data.file || `file_${index}`;
      const mediaType = (data.media_type || detectMediaTypeFromName(filename)).toLowerCase();
      const bucketHint = data.bucket || (mediaType === 'video' ? 'video' : 'output');
      const rawDownloadUrl = data.download_url || `/image_gen/api/jobs/${encodeURIComponent(jobId)}/files/${encodeURIComponent(index)}?filename=${encodeURIComponent(filename)}&bucket=${encodeURIComponent(bucketHint)}&mediaType=${encodeURIComponent(mediaType)}`;
      const downloadUrl = withInstanceParam(rawDownloadUrl, effectiveInstanceId);

      let mediaSrc = data.cached_url || data.remote_url || '';
      let objectUrl = null;
      if (downloadUrl) {
        try {
          const resp = await fetch(downloadUrl);
          if (!resp.ok) {
            throw new Error(`${resp.status} ${resp.statusText}`);
          }
          const blob = await resp.blob();
          if (data.cached_url) {
            mediaSrc = data.cached_url;
          } else {
            objectUrl = URL.createObjectURL(blob);
            mediaSrc = objectUrl;
          }
        } catch (err) {
          log(`Fetch output failed (${filename}): ${err.message}`, 'text-danger');
        }
      }
      if (!mediaSrc) {
        mediaSrc = data.cached_url || data.remote_url || '';
      }

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
      if (mediaSrc) {
        mediaEl.src = mediaSrc;
      } else {
        mediaEl.classList.add('thumb-media--empty');
      }
      if (objectUrl) {
        const eventName = mediaType === 'video' ? 'loadeddata' : 'load';
        mediaEl.addEventListener(eventName, () => {
          try { URL.revokeObjectURL(objectUrl); } catch (_) {}
        }, { once: true });
      }

      const caption = document.createElement('div');
      caption.className = 'muted mt-2';
      caption.textContent = filename;

      const actionRow = document.createElement('div');
      actionRow.className = 'd-flex justify-content-between align-items-center mt-2';

      const meta = document.createElement('span');
      meta.className = 'text-muted small';
      const bucketLabel = data.bucket || bucketHint || '';
      meta.textContent = bucketLabel ? `${bucketLabel}/` : '';
      actionRow.appendChild(meta);

      const downloadHref = data.cached_url || downloadUrl || data.remote_url || '';
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
      wrap.appendChild(col);
    }
  }

  // Rating bar
  function showRatingBar(jobId){
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
    const jobCard = document.getElementById("job_card_body") || document.body;
    jobCard.appendChild(cont);
    cont.querySelectorAll('button[data-rate]').forEach(btn=>{
      btn.addEventListener('click', async (e)=>{
        const rating = e.currentTarget.getAttribute('data-rate');
        if (!rating) return;
        try{
          cont.querySelectorAll('button').forEach(b=>b.disabled=true);
          const resp = await api('/api/rate', { method:'POST', body: JSON.stringify({ job_id: jobId, rating }) });
          const savedCount = Array.isArray(resp?.saved) ? resp.saved.length : 0;
          const msgEl = cont.querySelector('#ratingMsg');
          if (resp?.warnings?.length) {
            resp.warnings.forEach((w) => log(w, 'text-warning'));
          }
          msgEl.textContent = savedCount ? `Saved ${savedCount} favorite${savedCount === 1 ? '' : 's'} — thanks!` : 'Thanks!';
          setTimeout(hideRatingBar, 1500);
        }catch(err){
          const msgEl = cont.querySelector('#ratingMsg');
          if (msgEl) msgEl.textContent = 'Rating failed';
          log('Rate failed: ' + err.message, 'text-danger');
          cont.querySelectorAll('button').forEach(b=>b.disabled=false);
        }
      });
    });
    ratingBarVisible = true;
  }
  function hideRatingBar(){
    const el = $('#ratingBar');
    if (el) el.remove();
    ratingBarVisible = false;
  }

  // Upload
  $('#btnUpload').addEventListener('click', async ()=>{
    const f = $('#fileUp').files[0];
    if(!f){ log('Choose a file first.', 'text-warning'); return; }
    const fd = new FormData(); fd.append('image', f, f.name);
    try{
      const r = await api('/api/files/input', { method:'POST', body: fd });
      $('#lastUpload').textContent = `Uploaded as ${r.filename || r.file || '(see response)'}`;
      log(`Uploaded ${f.name}${r.filename ? ' -> ' + r.filename : ''}`, 'text-success');
      if (r.filename) {
        mergeInputFilename(r.filename);
        setImageInputValue(r.filename, { silent: true });
      }
    }catch(e){
      log('Upload failed: ' + e.message, 'text-danger');
    }
  });

  // Browse
  function toggleBrowsePagination(visible) {
    if (!browsePagination) return;
    browsePagination.classList.toggle('d-none', !visible);
  }

  function setBrowseMessage(text, className = 'text-muted') {
    if (!browseArea) return;
    browseArea.innerHTML = '';
    const div = document.createElement('div');
    div.className = className;
    div.textContent = text;
    browseArea.appendChild(div);
  }

  function showBrowseLoading(bucket) {
    const label = bucket ? `${bucket}/` : 'files';
    setBrowseMessage(`Loading ${label}…`);
    toggleBrowsePagination(false);
  }

  function clearBrowseListing(message = '') {
    browseState.bucket = null;
    browseState.items = [];
    browseState.page = 1;
    if (message) {
      setBrowseMessage(message);
    } else if (browseArea) {
      browseArea.innerHTML = '';
    }
    toggleBrowsePagination(false);
  }

  function buildBrowseCard(item, fallbackBucket) {
    if (!item) return null;
    const entry = Object.assign({}, item);
    const bucket = entry.bucket || fallbackBucket || '';
    const displayName = entry.name || entry.original || entry.filename || entry.file || '';
    const originalName = entry.original || displayName || entry.name || entry.filename || entry.file || '';
    const col = document.createElement('div');
    col.className = 'col';
    const card = document.createElement('div');
    card.className = 'thumb';
    if (bucket) card.classList.add(`thumb-${bucket}`);

    const mediaType = (entry.media_type || detectMediaTypeFromName(displayName || originalName)).toLowerCase();
    const fallbackSrc = originalName && bucket
      ? `/image_gen/api/files/${bucket}/${encodeURIComponent(originalName)}`
      : '';
    const src = entry.url || (fallbackSrc ? withInstanceParam(fallbackSrc, entry.instance_id || currentInstanceId) : '');

    let mediaEl;
    if (mediaType === 'video') {
      mediaEl = document.createElement('video');
      mediaEl.controls = true;
      mediaEl.preload = 'metadata';
      mediaEl.playsInline = true;
      mediaEl.muted = true;
    } else {
      mediaEl = document.createElement('img');
      mediaEl.alt = displayName || originalName || 'preview';
      mediaEl.loading = 'lazy';
    }
    mediaEl.classList.add('thumb-media');
    if (src) {
      mediaEl.src = src;
    } else {
      mediaEl.classList.add('thumb-media--empty');
    }
    card.appendChild(mediaEl);

    const cap = document.createElement('div');
    cap.className = 'muted mt-1';
    const bucketLabel = bucket ? `${bucket}/ ` : '';
    cap.textContent = `${bucketLabel}${displayName || originalName || '(unknown)'}`;
    card.appendChild(cap);

    if (bucket === 'input' && (displayName || originalName)) {
      const useName = displayName || originalName;
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-outline-primary mt-2';
      btn.textContent = 'Use for img2img';
      btn.addEventListener('click', () => {
        mergeInputFilename(useName);
        setImageInputValue(useName);
      });
      card.appendChild(btn);
    }

    if (bucket === 'output' && (mediaType === 'image' || mediaType === 'gif') && (displayName || originalName)) {
      const useName = displayName || originalName;
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-outline-success mt-2';
      btn.textContent = 'Use for img2img';
      btn.addEventListener('click', async () => {
        try {
          btn.disabled = true;
          const resp = await api('/api/files/promote', {
            method: 'POST',
            body: JSON.stringify({ bucket: 'output', filename: originalName || useName })
          });
          const newName = resp.filename || useName;
          mergeInputFilename(newName);
          setImageInputValue(newName, { silent: true });
          log(`Copied ${useName} to input as ${newName}.`, 'text-success');
        } catch (err) {
          log('Promote failed: ' + err.message, 'text-danger');
        } finally {
          btn.disabled = false;
        }
      });
      card.appendChild(btn);
    }

    col.appendChild(card);
    return col;
  }

  function renderBrowsePage(page = browseState.page) {
    if (!browseArea) return;
    const total = browseState.items.length;
    const bucket = browseState.bucket || 'files';
    if (!total) {
      setBrowseMessage(`No files in ${bucket}/ yet.`);
      toggleBrowsePagination(false);
      return;
    }
    const perPage = browseState.perPage || BROWSE_PAGE_SIZE;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const nextPage = Math.min(Math.max(1, page), totalPages);
    browseState.page = nextPage;
    const startIndex = (nextPage - 1) * perPage;
    const pageItems = browseState.items.slice(startIndex, startIndex + perPage);

    browseArea.innerHTML = '';
    pageItems.forEach((item) => {
      const col = buildBrowseCard(item, bucket);
      if (col) browseArea.appendChild(col);
    });

    const endIndex = Math.min(startIndex + pageItems.length, total);
    if (browseSummary) {
      browseSummary.textContent = `Showing ${startIndex + 1}-${endIndex} of ${total} in ${bucket}/`;
    }
    if (browsePageLabel) {
      browsePageLabel.textContent = `Page ${nextPage} of ${totalPages}`;
    }
    if (browsePrevBtn) browsePrevBtn.disabled = nextPage <= 1;
    if (browseNextBtn) browseNextBtn.disabled = nextPage >= totalPages;
    toggleBrowsePagination(true);
  }

  function setBrowseItems(bucket, items) {
    browseState.bucket = bucket || null;
    browseState.items = Array.isArray(items) ? items.slice() : [];
    browseState.page = 1;
    renderBrowsePage(1);
  }

  $('#btnListInput').addEventListener('click', () => list('input'));
  $('#btnListOutput').addEventListener('click', () => list('output'));
  const listVideoBtn = $('#btnListVideo');
  if (listVideoBtn) {
    listVideoBtn.addEventListener('click', () => list('video'));
  }
  const hideBtn = $('#btnHideBrowse');
  if (hideBtn) {
    hideBtn.addEventListener('click', () => {
      clearBrowseListing();
      log('Cleared browse list.');
    });
  }
  if (browsePrevBtn) {
    browsePrevBtn.addEventListener('click', () => {
      if (browseState.items.length) renderBrowsePage(browseState.page - 1);
    });
  }
  if (browseNextBtn) {
    browseNextBtn.addEventListener('click', () => {
      if (browseState.items.length) renderBrowsePage(browseState.page + 1);
    });
  }

  async function list(bucket){
    if (!bucket) return;
    if (!currentInstanceId) {
      clearBrowseListing('Select an instance first.');
      log('Select an instance first.', 'text-warning');
      return;
    }
    showBrowseLoading(bucket);
    try{
      const j = await api(`/api/files/${bucket}`);
      const rawItems = (Array.isArray(j.cached) && j.cached.length)
        ? j.cached
        : (Array.isArray(j.files)
          ? j.files.map(name => ({
              name,
              original: name,
              bucket,
              url: null,
              instance_id: j.instance_id || currentInstanceId || null
            }))
          : []);
      const items = rawItems.filter(Boolean);

      if (bucket === 'input') {
        const names = items.map(it => it.name || it.original).filter(Boolean);
        mergeInputFilenames(names);
      }

      const sortedItems = items.slice().reverse();
      setBrowseItems(bucket, sortedItems);
      log(`Listed ${items.length} file(s) in ${bucket}/.`);
    }catch(e){
      setBrowseMessage(`Failed to load ${bucket}/ list.`, 'text-danger');
      toggleBrowsePagination(false);
      log('List failed: ' + e.message, 'text-danger');
    }
  }

  // Prompt Library Modal
  const modalEl = $('#promptModal');
  let bsModal = null;
  function openPromptLib(type='positive'){
    if (!bsModal) bsModal = new bootstrap.Modal(modalEl);
    // set tabs visual
    $('#tabPos').classList.toggle('active', type==='positive');
    $('#tabNeg').classList.toggle('active', type==='negative');
    modalEl.dataset.type = type;
    modalEl._promptItems = [];
    if (promptFilterInput) promptFilterInput.value = '';
    $('#libShowAll').checked = false; // default filtered view
    loadPromptList();
    bsModal.show();
  }
  async function loadPromptList(){
    const type = modalEl.dataset.type || 'positive';
    const wfKey = $('#wfSelect').value;
    const show = $('#libShowAll').checked ? 'all' : 'default';
    const list = $('#promptList');
    list.innerHTML = '<div class="text-muted">Loading…</div>';
    try{
      const j = await api(`/api/prompts?workflow=${encodeURIComponent(wfKey)}&type=${encodeURIComponent(type)}&show=${show}`);
      modalEl._promptItems = j.items || [];
      renderPromptItems(modalEl._promptItems);
    }catch(e){
      modalEl._promptItems = [];
      list.innerHTML = `<div class="text-danger">Failed to load: ${e.message}</div>`;
    }
  }
  function renderPromptItems(items){
    const list = $('#promptList');
    if (!list) return;
    const filterValue = (promptFilterInput?.value || '').trim().toLowerCase();
    const type = modalEl.dataset.type || 'positive';
    if (!items || !items.length) {
      list.innerHTML = '<div class="text-muted">No prompts yet.</div>';
      return;
    }
    const filtered = filterValue
      ? items.filter(it => String(it.prompt || '').toLowerCase().includes(filterValue))
      : items;
    if (!filtered.length) {
      list.innerHTML = '<div class="text-muted">No prompts match filter.</div>';
      return;
    }
    list.innerHTML = '';
    for (const it of filtered) {
      const li = document.createElement('div');
      li.className = 'list-group-item';
      li.innerHTML = `
        <div class="d-flex justify-content-between align-items-start">
          <div class="me-3" style="white-space:pre-wrap">${escapeHtml(it.prompt)}</div>
          <div class="text-end" style="min-width:140px">
            <div><span class="badge bg-primary-subtle text-primary">avg ${(it.average||0).toFixed(2)}</span></div>
            <div class="text-muted small">uses ${it.uses} • rated ${it.rating_count}</div>
            <button type="button" class="btn btn-sm btn-outline-success mt-2" data-insert="1">Use</button>
          </div>
        </div>`;
      li.querySelector('[data-insert]').addEventListener('click', ()=>{
        if (type === 'positive') {
          const p = $('#inp_prompt'); if (p) p.value = it.prompt;
        } else {
          const n = $('#inp_negative'); if (n) n.value = it.prompt;
        }
        log('Inserted prompt from library.');
      });
      list.appendChild(li);
    }
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  $('#btnPromptLib').addEventListener('click', ()=> openPromptLib('positive'));
  $('#tabPos').addEventListener('click', ()=> { openPromptLib('positive'); });
  $('#tabNeg').addEventListener('click', ()=> { openPromptLib('negative'); });
  $('#libShowAll').addEventListener('change', loadPromptList);
  if (promptFilterInput) {
    promptFilterInput.addEventListener('input', () => {
      renderPromptItems(modalEl._promptItems || []);
    });
  }

  // Auto-load
  loadInstances().catch(err => {
    log('Initial instance load failed: ' + err.message, 'text-danger');
  });
})();
