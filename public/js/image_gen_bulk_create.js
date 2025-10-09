// public/js/image_gen_bulk_create.js
(function(){
  const jobForm = document.getElementById('jobForm');
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

  const state = {
    workflows: [],
    workflowMap: new Map()
  };

  async function api(path, init = {}) {
    const opts = Object.assign({ headers: {} }, init);
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    }
    const resp = await fetch(`/image_gen${path}`, opts);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${resp.status} ${resp.statusText} — ${text}`.trim());
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return resp.json();
    return resp;
  }

  function renderWorkflowList() {
    workflowSelect.innerHTML = '';
    state.workflows.forEach((wf, idx) => {
      const opt = document.createElement('option');
      opt.value = wf.key;
      opt.textContent = wf.name || wf.key;
      if (idx === 0) opt.selected = true;
      workflowSelect.appendChild(opt);
    });
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
    if (!def) {
      workflowInputs.innerHTML = '<div class="text-soft">Select a workflow to configure base inputs.</div>';
      return;
    }
    const row = document.createElement('div');
    row.className = 'row g-3';
    def.inputs.forEach((spec) => {
      row.appendChild(createInputControl(spec));
    });
    workflowInputs.appendChild(row);
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
    const negativeFactor = negativePrompt.value.trim() ? 2 : 1;
    return templateCount * multiplier * negativeFactor;
  }

  function updateSummary() {
    const templateCount = templateList.querySelectorAll('.template-item').length;
    const placeholderCount = placeholderList.querySelectorAll('.placeholder-item').length;
    const combos = computeCombinationEstimate();

    summaryPrompts.textContent = `${templateCount} template${templateCount === 1 ? '' : 's'}`;
    summaryPlaceholders.textContent = `${placeholderCount} placeholder${placeholderCount === 1 ? '' : 's'}`;
    summaryCombinations.textContent = `${combos} combination${combos === 1 ? '' : 's'}`;

    const placeholderValues = gatherPlaceholderValues();
    const detected = extractPlaceholdersFromTemplates();
    const missing = detected.filter((key) => !(placeholderValues[key] && placeholderValues[key].length));
    if (!templateCount) {
      formStatus.textContent = 'Add at least one template.';
      formStatus.className = 'text-warning';
    } else if (missing.length) {
      formStatus.textContent = `Add values for placeholder(s): ${missing.join(', ')}`;
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
    try {
      workflowInputs.innerHTML = '<div class="text-soft">Loading workflows…</div>';
      const data = await api('/api/workflows');
      state.workflows = data.workflows || [];
      state.workflowMap = new Map(state.workflows.map(w => [w.key, w]));
      renderWorkflowList();
      renderWorkflowInputs();
    } catch (err) {
      workflowInputs.innerHTML = `<div class="text-danger">Failed to load workflows: ${err.message}</div>`;
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

      const baseInputs = collectBaseInputs();
      const payload = {
        name,
        workflow: workflowSelect.value,
        templates,
        placeholderValues,
        negativePrompt: negativePrompt.value,
        baseInputs
      };

      const resp = await api('/api/bulk/jobs', {
        method: 'POST',
        body: JSON.stringify(payload)
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
  loadWorkflows();
})();
