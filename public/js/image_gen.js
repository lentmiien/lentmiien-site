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
  const jobIdInput = $('#jobId');
  const jobStatusEl = $('#jobStatus');
  const resultsEl = $('#results');
  const healthDot = $('#healthDot');
  const instanceMetaEl = $('#instanceMeta');
  let ratingBarVisible = false;
  let currentJobId = null;

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
    if (!name || !wfJsonArea) return;
    try {
      const resp = await api(`/api/workflows/${encodeURIComponent(name)}`);
      const wf = resp?.workflow || resp;
      wfJsonArea.value = JSON.stringify(wf, null, 2);
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
      const src = file?.cached_url || file?.download_url || file?.gateway_view_url || '';

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

      const downloadHref = src;
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
    const promptJson = parseWorkflowJson();
    if (!promptJson) return;
    const promptText = promptTextInput ? promptTextInput.value.trim() : '';
    const negativeText = negativeTextInput ? negativeTextInput.value.trim() : '';
    hideRatingBar();
    clearResults('Waiting for gateway…');
    setStatus('running');
    const btn = $('#btnGenerate');
    if (btn) btn.disabled = true;
    try {
      const resp = await api('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          workflow,
          prompt: promptJson,
          prompt_text: promptText,
          negative_prompt: negativeText,
          wait: true
        })
      });
      currentJobId = resp.job_id || resp.prompt_id || null;
      if (jobIdInput) jobIdInput.value = currentJobId || '';
      if (jobStatusEl) jobStatusEl.textContent = resp.status || 'completed';
      await showResults(currentJobId, resp.files);
      if (currentJobId) showRatingBar(currentJobId);
      setStatus('completed');
      log(`Generated job ${currentJobId || '(inline)'}.`, 'text-success');
    } catch (err) {
      setStatus('error');
      log('Generate failed: ' + err.message, 'text-danger');
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
    try {
      const j = await api(`/api/jobs/${encodeURIComponent(id)}`);
      currentJobId = id;
      if (jobStatusEl) jobStatusEl.textContent = j.status || '-';
      await showResults(id, j.files);
      showRatingBar(id);
      log(`Loaded job ${id}.`);
    } catch (err) {
      log('Load job failed: ' + err.message, 'text-danger');
    }
  }

  const btnLoad = $('#btnLoadWf');
  if (btnLoad) btnLoad.addEventListener('click', loadWorkflows);
  if (wfSelect) {
    wfSelect.addEventListener('change', (e) => loadWorkflowJson(e.target.value));
  }
  const btnGenerate = $('#btnGenerate');
  if (btnGenerate) btnGenerate.addEventListener('click', generate);
  const btnPoll = $('#btnPoll');
  if (btnPoll) btnPoll.addEventListener('click', loadJobById);
  const btnHealth = $('#btnHealth');
  if (btnHealth) btnHealth.addEventListener('click', checkHealth);

  setStatus('idle');
  loadWorkflows();
  checkHealth();
})(); 
