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

  let currentVars = { a: null, b: null };
  let availableVariables = [];
  let autoRefreshTimer = null;
  let lastJobStatus = null;

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
          col.prompts.forEach((prompt) => {
            const card = document.createElement('a');
            card.className = 'matrix-thumb';
            const linkUrl = prompt.download_url || prompt.file_url || '#';
            if (linkUrl !== '#') {
              card.href = linkUrl;
              card.target = '_blank';
            } else {
              card.href = '#';
              card.addEventListener('click', (e) => e.preventDefault());
            }
            const preview = createMatrixPreview(prompt);
            if (preview.element) {
              card.appendChild(preview.element);
            }
            const badge = document.createElement('span');
            badge.className = `matrix-thumb-badge matrix-thumb-badge--${preview.mediaType}`;
            badge.textContent = preview.mediaType === 'video' ? 'VIDEO' : (preview.mediaType === 'gif' ? 'GIF' : 'IMAGE');
            card.appendChild(badge);
            const meta = document.createElement('div');
            meta.className = 'meta';
            meta.textContent = `${(prompt.score_average || 0).toFixed(2)} (${prompt.score_count || 0})`;
            card.appendChild(meta);
            grid.appendChild(card);
          });
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

  loadJob();
  loadPrompts(true);
  setupAutoRefresh();
})();

