// public/js/image_gen_bulk_job.js
(function(){
  const root = document.getElementById('jobRoot');
  if (!root) return;
  const jobId = root.dataset.jobId;
  if (!jobId) return;

  const jobStatusPill = document.getElementById('jobStatusPill');
  const jobNameEl = document.getElementById('jobName');
  const jobWorkflowEl = document.getElementById('jobWorkflow');
  const jobCreatedEl = document.getElementById('jobCreated');
  const jobUpdatedEl = document.getElementById('jobUpdated');
  const jobStartedEl = document.getElementById('jobStarted');
  const jobCompletedEl = document.getElementById('jobCompleted');
  const jobProgressBar = document.getElementById('jobProgress');
  const jobProgressLabel = document.getElementById('jobProgressLabel');
  const jobCountsList = document.getElementById('jobCounts');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const redoBtn = document.getElementById('redoBtn');
  const varSelectA = document.getElementById('varSelectA');
  const varSelectB = document.getElementById('varSelectB');
  const refreshMatrixBtn = document.getElementById('refreshMatrixBtn');
  const matrixArea = document.getElementById('matrixArea');
  const promptTableBody = document.getElementById('promptTableBody');
  const refreshPromptsBtn = document.getElementById('refreshPromptsBtn');
  const galleryFilterForm = document.getElementById('galleryFilterForm');
  const galleryFilterFields = document.getElementById('galleryFilterFields');
  const gallerySummary = document.getElementById('gallerySummary');
  const galleryLoading = document.getElementById('galleryLoading');
  const galleryEmpty = document.getElementById('galleryEmpty');
  const galleryError = document.getElementById('galleryError');
  const galleryGrid = document.getElementById('galleryGrid');
  const galleryResetBtn = document.getElementById('galleryResetBtn');
  const galleryRateForm = document.getElementById('galleryRateForm');
  const galleryRatingControls = document.getElementById('galleryRatingControls');
  const galleryRateSubmitBtn = document.getElementById('galleryRateSubmitBtn');
  const galleryRateCancelBtn = document.getElementById('galleryRateCancelBtn');

  let currentVars = { a: null, b: null };
  let availableVariables = [];
  let autoRefreshTimer = null;
  let lastJobStatus = null;
  let jobDetails = null;
  let galleryInitialized = false;
  let galleryOptionsFingerprint = '';
  const gallerySelects = new Map();
  const galleryState = {
    filters: {},
    items: [],
    ratingLocked: false,
    lastResponse: null
  };
  const GALLERY_RATING_VALUES = Object.freeze({
    good: 1,
    neutral: 0.5,
    bad: 0
  });

  async function api(path, init = {}) {
    const opts = Object.assign({ headers: {} }, init);
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    }
    const resp = await fetch(`/image_gen${path}`, opts);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`${resp.status} ${resp.statusText} - ${text}`.trim());
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) return resp.json();
    return resp;
  }

  function detectMediaTypeFromName(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.endsWith('.mkv') || lower.endsWith('.m4v')) return 'video';
    if (lower.endsWith('.gif')) return 'gif';
    return 'image';
  }

  function createMatrixPreview(prompt) {
    const filename = prompt?.filename || '';
    const mediaType = (prompt?.media_type || detectMediaTypeFromName(filename)).toLowerCase();
    const src = prompt?.cached_url || prompt?.download_url || prompt?.file_url || '';
    let el;
    if (mediaType === 'video') {
      el = document.createElement('video');
      el.muted = true;
      el.loop = true;
      el.controls = false;
      el.playsInline = true;
      el.preload = 'metadata';
    } else {
      el = document.createElement('img');
      el.alt = filename || 'Preview';
    }
    el.className = 'matrix-thumb-media';
    if (src) {
      el.src = src;
    } else {
      el.classList.add('matrix-thumb-media--empty');
    }
    return { element: el, mediaType };
  }

  function pickBestPrompt(prompts) {
    if (!Array.isArray(prompts) || !prompts.length) return null;
    let bestScore = -Infinity;
    let bestOptions = [];
    prompts.forEach((prompt) => {
      const raw = Number(prompt?.score_average);
      const score = Number.isFinite(raw) ? raw : 0;
      if (score > bestScore) {
        bestScore = score;
        bestOptions = [prompt];
        return;
      }
      if (score === bestScore) {
        bestOptions.push(prompt);
      }
    });
    const candidates = bestOptions.length ? bestOptions : prompts;
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }

  function formatDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString();
  }

  function setStatusPill(text) {
    jobStatusPill.textContent = text || 'unknown';
  }

  function setProgress(progress, counters) {
    const pct = Math.max(0, Math.min(1, Number(progress || 0)));
    jobProgressBar.style.width = `${(pct * 100).toFixed(0)}%`;
    const total = counters?.total || 0;
    const completed = counters?.completed || 0;
    jobProgressLabel.textContent = `${completed} / ${total} completed`;
  }

  function renderCounts(counters) {
    const merged = Object.assign({
      total: 0,
      pending: 0,
      processing: 0,
      paused: 0,
      completed: 0,
      canceled: 0
    }, counters || {});
    jobCountsList.innerHTML = `
      <li>Total prompts: ${merged.total}</li>
      <li>Pending: ${merged.pending}</li>
      <li>Processing: ${merged.processing}</li>
      <li>Paused: ${merged.paused}</li>
      <li>Completed: ${merged.completed}</li>
      <li>Canceled: ${merged.canceled}</li>
    `;
    return merged;
  }

  function updateActionButtons(status) {
    const normalized = (status || '').toLowerCase();
    const startVisible = normalized === 'created';
    const pauseVisible = normalized === 'processing';
    const resumeVisible = normalized === 'paused';
    const cancelVisible = ['processing', 'paused'].includes(normalized);

    toggleButton(startBtn, startVisible);
    toggleButton(pauseBtn, pauseVisible);
    toggleButton(resumeBtn, resumeVisible);
    toggleButton(cancelBtn, cancelVisible);
  }

  function toggleButton(btn, visible) {
    if (!btn) return;
    if (visible) {
      btn.classList.remove('d-none');
      btn.disabled = false;
    } else {
      btn.classList.add('d-none');
    }
  }

  function updateRedoButton(counters, status) {
    if (!redoBtn) return;
    const canceled = counters?.canceled || 0;
    if (canceled > 0) {
      redoBtn.classList.remove('d-none');
      redoBtn.disabled = false;
    } else {
      redoBtn.classList.add('d-none');
    }
    if ((status || '').toLowerCase() === 'canceled') {
      redoBtn.classList.remove('d-none');
      redoBtn.disabled = false;
    }
  }

  function populateVariableSelects(variables) {
    if (!Array.isArray(variables)) variables = [];
    const changed = variables.join('|') !== availableVariables.join('|');
    availableVariables = variables;
    if (!changed) return;
    const options = variables.map((key) => ({ key, label: formatVariableKey(key) }));
    const renderOptions = (select, selected) => {
      select.innerHTML = '';
      options.forEach(({ key, label }) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = label;
        if (selected === key) opt.selected = true;
        select.appendChild(opt);
      });
    };
    const defaultA = options[0]?.key || '';
    const defaultB = options[1]?.key || '';
    currentVars.a = defaultA;
    currentVars.b = defaultB;
    renderOptions(varSelectA, currentVars.a);
    renderOptions(varSelectB, currentVars.b);
  }

  function formatVariableKey(key) {
    if (!key) return '-';
    if (key === 'template') return 'Template';
    if (key === 'negative') return 'Negative prompt';
    if (key.startsWith('placeholder:')) {
      return `Placeholder: ${key.slice('placeholder:'.length)}`;
    }
    if (key.startsWith('input:')) {
      return `Image input: ${key.slice('input:'.length)}`;
    }
    return key;
  }

  function uniqueList(values) {
    const seen = new Set();
    const list = [];
    (Array.isArray(values) ? values : []).forEach((value) => {
      const text = String(value ?? '').trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      list.push(text);
    });
    return list;
  }

  function slugifyFilterKey(key) {
    const base = String(key || 'field').toLowerCase();
    const slug = base.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return `gallery-filter-${slug || 'field'}`;
  }

  function valuesForVariable(job, key) {
    if (!job || !key) return [];
    if (key === 'template') {
      const labels = (Array.isArray(job.prompt_templates) ? job.prompt_templates : [])
        .map((tpl) => tpl && typeof tpl.label === 'string' ? tpl.label : '')
        .filter(Boolean);
      return uniqueList(labels);
    }
    if (key === 'negative') {
      return ['With negative', 'No negative'];
    }
    if (key.startsWith('placeholder:')) {
      const placeholderKey = key.slice('placeholder:'.length);
      const entry = Array.isArray(job.placeholder_values)
        ? job.placeholder_values.find((item) => item && item.key === placeholderKey)
        : null;
      return entry ? uniqueList(entry.values || []) : [];
    }
    if (key.startsWith('input:')) {
      const inputKey = key.slice('input:'.length);
      const entry = Array.isArray(job.image_inputs)
        ? job.image_inputs.find((item) => item && item.key === inputKey)
        : null;
      return entry ? uniqueList(entry.values || []) : [];
    }
    return [];
  }

  function buildGalleryOptions(job) {
    const variables = Array.isArray(job?.variables_available) ? job.variables_available : [];
    return variables.map((key) => ({
      key,
      label: formatVariableKey(key),
      values: valuesForVariable(job, key)
    }));
  }

  function renderGalleryFilterFields(job) {
    if (!galleryFilterFields) return false;
    const options = buildGalleryOptions(job);
    const fingerprint = JSON.stringify(options.map((opt) => ({ key: opt.key, values: opt.values })));
    if (fingerprint === galleryOptionsFingerprint) return false;
    galleryOptionsFingerprint = fingerprint;
    gallerySelects.clear();
    galleryFilterFields.innerHTML = '';
    if (!options.length) {
      const msg = document.createElement('div');
      msg.className = 'col-12 text-soft';
      msg.textContent = 'No variable filters are available for this job.';
      galleryFilterFields.appendChild(msg);
      return true;
    }
    const validKeys = new Set(options.map((opt) => opt.key));
    Object.keys(galleryState.filters || {}).forEach((key) => {
      if (!validKeys.has(key)) {
        delete galleryState.filters[key];
      }
    });
    options.forEach((opt) => {
      const col = document.createElement('div');
      col.className = 'col-md-4 col-sm-6';
      const label = document.createElement('label');
      const selectId = slugifyFilterKey(opt.key);
      label.className = 'form-label';
      label.setAttribute('for', selectId);
      label.textContent = opt.label;
      const select = document.createElement('select');
      select.className = 'form-select';
      select.id = selectId;
      select.dataset.filterKey = opt.key;
      const allOption = document.createElement('option');
      allOption.value = '';
      allOption.textContent = 'All';
      select.appendChild(allOption);
      opt.values.forEach((value) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        select.appendChild(option);
      });
      const savedValue = galleryState.filters?.[opt.key];
      if (savedValue && opt.values.includes(savedValue)) {
        select.value = savedValue;
      }
      select.addEventListener('change', () => {
        galleryState.ratingLocked = false;
      });
      col.appendChild(label);
      col.appendChild(select);
      galleryFilterFields.appendChild(col);
      gallerySelects.set(opt.key, select);
    });
    return true;
  }

  function collectGalleryFilters() {
    const filters = {};
    gallerySelects.forEach((select, key) => {
      if (!select) return;
      const value = String(select.value || '').trim();
      if (value) filters[key] = value;
    });
    return filters;
  }

  function setGalleryLoading(visible) {
    if (!galleryLoading) return;
    galleryLoading.style.display = visible ? '' : 'none';
  }

  function setGalleryError(message) {
    if (!galleryError) return;
    if (!message) {
      galleryError.textContent = '';
      galleryError.style.display = 'none';
      return;
    }
    galleryError.textContent = message;
    galleryError.style.display = '';
  }

  function setGalleryEmpty(visible) {
    if (!galleryEmpty) return;
    galleryEmpty.style.display = visible ? '' : 'none';
  }

  function showGalleryRatingControls(visible) {
    if (!galleryRatingControls) return;
    if (visible) {
      galleryRatingControls.classList.remove('d-none');
      if (galleryRateSubmitBtn) galleryRateSubmitBtn.disabled = false;
    } else {
      galleryRatingControls.classList.add('d-none');
    }
  }

  function updateGallerySummary(data) {
    if (!gallerySummary) return;
    const returned = Array.isArray(data?.items) ? data.items.length : 0;
    if (!returned) {
      gallerySummary.textContent = '';
      return;
    }
    const total = Number(data?.total || returned);
    const filterKeys = Object.keys(galleryState.filters || {});
    const scope = filterKeys.length ? 'the current filters' : 'all variants';
    if (total > returned) {
      gallerySummary.textContent = `Showing ${returned} of ${total} matching images for ${scope}.`;
    } else {
      gallerySummary.textContent = `Showing ${returned} image${returned === 1 ? '' : 's'} for ${scope}.`;
    }
  }

  function createGalleryMediaElement(item) {
    const filename = item?.filename || '';
    const mediaType = (item?.media_type || detectMediaTypeFromName(filename)).toLowerCase();
    const src = item?.cached_url || item?.download_url || item?.file_url || '';
    let el;
    if (mediaType === 'video') {
      el = document.createElement('video');
      el.controls = true;
      el.playsInline = true;
      el.preload = 'metadata';
      el.muted = true;
      el.loop = false;
    } else {
      el = document.createElement('img');
      el.alt = filename || 'Image preview';
      el.loading = 'lazy';
    }
    el.classList.add('gallery-media');
    if (mediaType === 'video') el.classList.add('gallery-media--video');
    if (src) el.src = src;
    return el;
  }

  function createGalleryCard(item) {
    const card = document.createElement('article');
    card.className = 'gallery-card';
    card.dataset.promptId = item.id || '';
    card.dataset.scoreTotal = String(item.score_total || 0);
    card.dataset.scoreCount = String(item.score_count || 0);
    const mediaEl = createGalleryMediaElement(item);
    card.appendChild(mediaEl);

    const meta = document.createElement('div');
    meta.className = 'gallery-meta';

    const avg = Number(item.score_average || 0);
    const count = Number(item.score_count || 0);
    const scoreLine = document.createElement('div');
    scoreLine.textContent = `Score ${avg.toFixed(2)} (${count})`;
    meta.appendChild(scoreLine);

    if (item.template_label) {
      const tplLine = document.createElement('div');
      tplLine.textContent = `Template: ${item.template_label}`;
      meta.appendChild(tplLine);
    }

    const placeholders = Object.entries(item.placeholder_values || {});
    if (placeholders.length) {
      const placeholderLine = document.createElement('div');
      placeholderLine.textContent = `Placeholders: ${placeholders.map(([k, v]) => `${k}: ${v}`).join(', ')}`;
      meta.appendChild(placeholderLine);
    }

    const inputs = Object.entries(item.input_values || {});
    if (inputs.length) {
      const inputLine = document.createElement('div');
      inputLine.textContent = `Inputs: ${inputs.map(([k, v]) => `${k}: ${v}`).join(', ')}`;
      meta.appendChild(inputLine);
    }

    if (item.negative_used !== undefined) {
      const negativeLine = document.createElement('div');
      negativeLine.textContent = `Negative: ${item.negative_used ? 'With negative' : 'No negative'}`;
      meta.appendChild(negativeLine);
    }

    if (item.completed_at) {
      const completedLine = document.createElement('div');
      completedLine.textContent = `Completed: ${formatDate(item.completed_at)}`;
      meta.appendChild(completedLine);
    }

    if (item.download_url) {
      const linkLine = document.createElement('div');
      const link = document.createElement('a');
      link.href = item.download_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open original';
      link.className = 'small';
      linkLine.appendChild(link);
      meta.appendChild(linkLine);
    }

    card.appendChild(meta);
    return card;
  }

  function renderGalleryItems(items) {
    if (!galleryGrid) return;
    galleryGrid.innerHTML = '';
    items.forEach((item) => {
      const card = createGalleryCard(item);
      galleryGrid.appendChild(card);
    });
    setGalleryEmpty(!items.length);
  }

  async function loadGalleryImages({ showLoading = true, keepRatingLock = false } = {}) {
    if (!galleryFilterForm || !galleryGrid) return;
    const filters = collectGalleryFilters();
    if (!keepRatingLock) galleryState.ratingLocked = false;
    galleryState.filters = filters;
    if (showLoading) setGalleryLoading(true);
    setGalleryError('');
    setGalleryEmpty(false);
    try {
      const params = new URLSearchParams();
      params.set('limit', '25');
      if (Object.keys(filters).length) {
        params.set('filters', JSON.stringify(filters));
      }
      const data = await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}/gallery?${params.toString()}`);
      galleryState.lastResponse = data;
      const items = Array.isArray(data.items) ? data.items : [];
      galleryState.items = items.map((item) => Object.assign({}, item));
      renderGalleryItems(galleryState.items);
      updateGallerySummary(data);
      setGalleryLoading(false);
      if (items.length && !galleryState.ratingLocked) {
        showGalleryRatingControls(true);
        galleryRateForm?.reset();
      } else {
        showGalleryRatingControls(false);
      }
    } catch (err) {
      setGalleryLoading(false);
      galleryGrid.innerHTML = '';
      showGalleryRatingControls(false);
      setGalleryError(err.message || 'Failed to load images.');
    }
  }

  function getSelectedGalleryRating() {
    if (!galleryRateForm) return null;
    const selected = galleryRateForm.querySelector('input[name="galleryRating"]:checked');
    return selected ? selected.value : null;
  }

  function applyGalleryRatingLocally(ratingKey) {
    const delta = GALLERY_RATING_VALUES[ratingKey];
    if (delta === undefined) return;
    galleryState.items = galleryState.items.map((item) => {
      const total = Number(item.score_total || 0) + delta;
      const count = Number(item.score_count || 0) + 1;
      const average = count > 0 ? total / count : 0;
      return Object.assign({}, item, {
        score_total: total,
        score_count: count,
        score_average: average
      });
    });
    if (galleryState.lastResponse) {
      galleryState.lastResponse.items = galleryState.items;
    }
    renderGalleryItems(galleryState.items);
    if (galleryState.lastResponse) {
      updateGallerySummary(galleryState.lastResponse);
    }
  }

  async function loadJob() {
    try {
      const data = await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}`);
      const job = data.job || {};
      jobNameEl.textContent = job.name || '-';
      jobWorkflowEl.textContent = job.workflow || '-';
      jobCreatedEl.textContent = formatDate(job.created_at);
      jobUpdatedEl.textContent = formatDate(job.updated_at);
      jobStartedEl.textContent = formatDate(job.started_at);
      jobCompletedEl.textContent = formatDate(job.completed_at);
        setStatusPill(job.status);
        setProgress(job.progress, job.counters);
        const counters = renderCounts(job.counters);
        updateActionButtons(job.status);
        updateRedoButton(counters, job.status);
        populateVariableSelects(job.variables_available || []);
        const filtersUpdated = renderGalleryFilterFields(job);
        jobDetails = job;
        if (!galleryInitialized) {
          galleryInitialized = true;
          await loadGalleryImages({ showLoading: true });
        } else if (filtersUpdated) {
          await loadGalleryImages({ showLoading: true });
        }

        const statusNormalized = (job.status || '').toLowerCase();
        const hasValidVars = currentVars.a && currentVars.b && currentVars.a !== currentVars.b;

        if (!hasValidVars) {
          matrixArea.innerHTML = '<div>Select two different variables to render the matrix.</div>';
        } else {
          const shouldRefreshMatrix =
            lastJobStatus === null ||
            statusNormalized === 'processing' ||
            (lastJobStatus === 'processing' && statusNormalized !== 'processing');

          if (shouldRefreshMatrix) {
            await loadMatrix(true);
          }
        }

        lastJobStatus = statusNormalized;
      } catch (err) {
        matrixArea.innerHTML = `<div class="text-danger">Failed to load job: ${err.message}</div>`;
      }
    }

  function renderMatrix(data) {
    const matrixRows = data.data || [];
    if (!matrixRows.length) {
      matrixArea.innerHTML = '<div>No completed prompts for the selected variables yet.</div>';
      return;
    }
    const cols = data.cols || [];
    const columnStats = cols.map(() => ({ sum: 0, count: 0 }));
    const rowStats = matrixRows.map((row) => {
      let sum = 0;
      let count = 0;
      (row.columns || []).forEach((col, idx) => {
        const promptsCount = Array.isArray(col.prompts) ? col.prompts.length : 0;
        if (!promptsCount) return;
        const cellAvgRaw = Number(col.average_score);
        const cellAvg = Number.isFinite(cellAvgRaw) ? cellAvgRaw : 0;
        sum += cellAvg * promptsCount;
        count += promptsCount;
        const columnStat = columnStats[idx];
        if (columnStat) {
          columnStat.sum += cellAvg * promptsCount;
          columnStat.count += promptsCount;
        }
      });
      return { sum, count };
    });
    const rowAverages = rowStats.map((stat) => stat.count > 0 ? stat.sum / stat.count : 0);
    const columnAverages = columnStats.map((stat) => stat.count > 0 ? stat.sum / stat.count : 0);
    const overallStats = columnStats.reduce((acc, stat) => {
      acc.sum += stat.sum;
      acc.count += stat.count;
      return acc;
    }, { sum: 0, count: 0 });
    const overallAverage = overallStats.count > 0 ? overallStats.sum / overallStats.count : 0;
    const table = document.createElement('table');
    table.className = 'matrix-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    const cornerLabel = document.createElement('div');
    cornerLabel.textContent = `${formatVariableKey(data.varA)} vs ${formatVariableKey(data.varB)}`;
    const cornerAvg = document.createElement('div');
    cornerAvg.className = 'avg';
    cornerAvg.textContent = overallStats.count > 0 ? `Avg ${overallAverage.toFixed(2)}` : 'Avg -';
    corner.appendChild(cornerLabel);
    corner.appendChild(cornerAvg);
    headRow.appendChild(corner);
    cols.forEach((col, idx) => {
      const th = document.createElement('th');
      const label = document.createElement('div');
      label.textContent = col || '-';
      th.appendChild(label);
      const avgEl = document.createElement('div');
      avgEl.className = 'avg';
      const colStat = columnStats[idx];
      avgEl.textContent = colStat && colStat.count > 0 ? `Avg ${columnAverages[idx].toFixed(2)}` : 'Avg -';
      th.appendChild(avgEl);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    matrixRows.forEach((row, rowIndex) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      const rowLabel = document.createElement('div');
      rowLabel.textContent = row.value || '-';
      const rowAvgEl = document.createElement('div');
      rowAvgEl.className = 'avg';
      const rowStat = rowStats[rowIndex];
      rowAvgEl.textContent = rowStat && rowStat.count > 0 ? `Avg ${rowAverages[rowIndex].toFixed(2)}` : 'Avg -';
      th.appendChild(rowLabel);
      th.appendChild(rowAvgEl);
      tr.appendChild(th);
      (row.columns || []).forEach((col, idx) => {
        const td = document.createElement('td');
        const cellWrap = document.createElement('div');
        cellWrap.className = 'matrix-cell';
        const avgText = document.createElement('div');
        avgText.className = 'avg';
        const cellAvgRaw = Number(col.average_score);
        const avgValue = Number.isFinite(cellAvgRaw) ? cellAvgRaw : 0;
        const promptCount = Array.isArray(col.prompts) ? col.prompts.length : 0;
        avgText.textContent = `Avg ${avgValue.toFixed(2)} - ${promptCount} item(s)`;
          cellWrap.appendChild(avgText);
          const grid = document.createElement('div');
          grid.className = 'thumb-grid';
          if (col.prompts && col.prompts.length) {
            const prompt = pickBestPrompt(col.prompts);
            const card = document.createElement('a');
            card.className = 'matrix-thumb';
            const linkUrl = prompt?.download_url || prompt?.file_url || '#';
            if (linkUrl !== '#') {
              card.href = linkUrl;
              card.target = '_blank';
            } else {
              card.href = '#';
              card.addEventListener('click', (e) => e.preventDefault());
            }
            const preview = createMatrixPreview(prompt || {});
            if (preview.element) {
              card.appendChild(preview.element);
            }
            const badge = document.createElement('span');
            badge.className = `matrix-thumb-badge matrix-thumb-badge--${preview.mediaType}`;
            badge.textContent = preview.mediaType === 'video' ? 'VIDEO' : (preview.mediaType === 'gif' ? 'GIF' : 'IMAGE');
            card.appendChild(badge);
            const meta = document.createElement('div');
            meta.className = 'meta';
            const scoreAvg = Number(prompt?.score_average);
            const formattedScore = Number.isFinite(scoreAvg) ? scoreAvg : 0;
            meta.textContent = `${formattedScore.toFixed(2)} (${prompt?.score_count || 0})`;
            card.appendChild(meta);
            grid.appendChild(card);
          } else {
            const empty = document.createElement('div');
            empty.textContent = 'No results yet';
            grid.appendChild(empty);
          }
        cellWrap.appendChild(grid);
        td.appendChild(cellWrap);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    matrixArea.innerHTML = '';
    matrixArea.appendChild(table);
  }

  async function loadMatrix(force) {
    if (!currentVars.a || !currentVars.b || currentVars.a === currentVars.b) {
      if (force) {
        matrixArea.innerHTML = '<div>Select two different variables to render the matrix.</div>';
      }
      return;
    }
    try {
      matrixArea.innerHTML = '<div>Loading matrix…</div>';
      const data = await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}/matrix?varA=${encodeURIComponent(currentVars.a)}&varB=${encodeURIComponent(currentVars.b)}`);
      renderMatrix(data);
    } catch (err) {
      matrixArea.innerHTML = `<div class="text-danger">Failed to load matrix: ${err.message}</div>`;
    }
  }

  function renderPrompts(items) {
    promptTableBody.innerHTML = '';
    if (!items || !items.length) {
      promptTableBody.innerHTML = '<tr><td colspan="6">No prompts recorded yet.</td></tr>';
      return;
    }
    items.forEach((item) => {
      const tr = document.createElement('tr');
      const templateTd = document.createElement('td');
      templateTd.innerHTML = `<div>${item.template_label || 'Template'}</div><div class="small">${item.prompt_text || ''}</div>`;

      const placeholdersTd = document.createElement('td');
      const placeholders = item.placeholder_values || {};
      const placeholderLines = Object.entries(placeholders).map(([key, value]) => `${key}: ${value}`);
      placeholdersTd.textContent = placeholderLines.join(', ') || '-';

      const negativeTd = document.createElement('td');
      negativeTd.textContent = item.negative_used ? 'With negative' : 'No negative';

      const statusTd = document.createElement('td');
      statusTd.textContent = item.status;

      const scoreTd = document.createElement('td');
      const avg = (item.score_count || 0) > 0 ? (item.score_total || 0) / item.score_count : 0;
      scoreTd.textContent = `${avg.toFixed(2)} (${item.score_count || 0})`;

      const updatedTd = document.createElement('td');
      updatedTd.textContent = formatDate(item.updated_at);

      tr.appendChild(templateTd);
      tr.appendChild(placeholdersTd);
      tr.appendChild(negativeTd);
      tr.appendChild(statusTd);
      tr.appendChild(scoreTd);
      tr.appendChild(updatedTd);
      promptTableBody.appendChild(tr);
    });
  }

  async function loadPrompts(showLoading = true) {
    try {
      if (showLoading) {
        promptTableBody.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
      }
      const data = await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}/prompts?limit=200`);
      renderPrompts(data.items || []);
    } catch (err) {
      promptTableBody.innerHTML = `<tr><td colspan="6" class="text-danger">Failed to load prompts: ${err.message}</td></tr>`;
    }
  }

  async function updateStatus(action) {
    try {
      disableActionButtons(true);
      await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ action })
      });
      await loadJob();
      await loadPrompts(false);
    } catch (err) {
      alert(`Failed to update job: ${err.message}`);
    } finally {
      disableActionButtons(false);
    }
  }

  function disableActionButtons(disabled) {
    [startBtn, pauseBtn, resumeBtn, cancelBtn, redoBtn].forEach(btn => {
      if (!btn) return;
      btn.disabled = disabled;
    });
  }

  function setupAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(() => {
      loadJob();
      loadPrompts(false);
    }, 60 * 1000);
  }

  startBtn?.addEventListener('click', () => updateStatus('start'));
  pauseBtn?.addEventListener('click', () => updateStatus('pause'));
  resumeBtn?.addEventListener('click', () => updateStatus('resume'));
  cancelBtn?.addEventListener('click', () => updateStatus('cancel'));
  redoBtn?.addEventListener('click', () => updateStatus('redo_canceled'));
  varSelectA?.addEventListener('change', () => {
    currentVars.a = varSelectA.value;
    loadMatrix(true);
  });
  varSelectB?.addEventListener('change', () => {
    currentVars.b = varSelectB.value;
    loadMatrix(true);
  });
  refreshMatrixBtn?.addEventListener('click', () => loadMatrix(true));
  refreshPromptsBtn?.addEventListener('click', () => loadPrompts(true));
  galleryFilterForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    loadGalleryImages({ showLoading: true });
  });
  galleryResetBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    galleryFilterForm?.reset();
    gallerySelects.forEach((select) => {
      if (select) select.value = '';
    });
    galleryState.filters = {};
    loadGalleryImages({ showLoading: true });
  });
  galleryRateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (galleryState.ratingLocked) return;
    if (!galleryState.items.length) return;
    const rating = getSelectedGalleryRating();
    if (!rating) {
      alert('Select a rating before submitting.');
      return;
    }
    setGalleryError('');
    if (galleryRateSubmitBtn) galleryRateSubmitBtn.disabled = true;
    try {
      await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}/gallery/rate`, {
        method: 'POST',
        body: JSON.stringify({
          rating,
          prompt_ids: galleryState.items.map((item) => item.id)
        })
      });
      applyGalleryRatingLocally(rating);
      galleryState.ratingLocked = true;
      showGalleryRatingControls(false);
      galleryRateForm.reset();
    } catch (err) {
      setGalleryError(`Failed to submit rating: ${err.message}`);
    } finally {
      if (galleryRateSubmitBtn) galleryRateSubmitBtn.disabled = false;
    }
  });
  galleryRateCancelBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    galleryState.ratingLocked = true;
    showGalleryRatingControls(false);
    galleryRateForm?.reset();
  });

  loadJob();
  loadPrompts(true);
  setupAutoRefresh();
})();

