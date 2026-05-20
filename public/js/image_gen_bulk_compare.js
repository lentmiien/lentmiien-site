// public/js/image_gen_bulk_compare.js
(function(){
  const jobSelection = document.getElementById('jobSelection');
  const reloadJobsBtn = document.getElementById('reloadJobsBtn');
  const compareBtn = document.getElementById('compareBtn');
  const compareStatus = document.getElementById('compareStatus');
  const compareSummary = document.getElementById('compareSummary');
  const compareResults = document.getElementById('compareResults');
  const completeOnly = document.getElementById('completeOnly');
  const compareLimit = document.getElementById('compareLimit');

  const selectedIds = new Set();
  let jobs = [];

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

  function parseInitialSelection() {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('jobIds') || params.get('job_ids') || params.get('jobs') || '';
    raw.split(',').map(part => part.trim()).filter(Boolean).forEach(id => selectedIds.add(id));
    const single = params.get('job');
    const withJob = params.get('with');
    if (single) selectedIds.add(single);
    if (withJob) selectedIds.add(withJob);
  }

  function formatDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString();
  }

  function formatScore(item) {
    const avg = Number(item?.score_average || 0);
    const count = Number(item?.score_count || 0);
    return `${avg.toFixed(2)} (${count})`;
  }

  function detectMediaTypeFromName(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.endsWith('.mkv') || lower.endsWith('.m4v')) return 'video';
    if (lower.endsWith('.gif')) return 'gif';
    return 'image';
  }

  function maybeAutoSelectRelatedJobs() {
    if (selectedIds.size !== 1) return;
    const selected = Array.from(selectedIds)[0];
    const byId = new Map(jobs.map(job => [job.id, job]));
    const job = byId.get(selected);
    if (job?.copied_from_job && byId.has(job.copied_from_job)) {
      selectedIds.add(job.copied_from_job);
    }
    jobs
      .filter(item => item.copied_from_job === selected)
      .slice(0, 5)
      .forEach(item => selectedIds.add(item.id));
  }

  function renderJobSelection() {
    if (!jobSelection) return;
    jobSelection.innerHTML = '';
    if (!jobs.length) {
      jobSelection.innerHTML = '<div class="text-soft">No bulk jobs yet.</div>';
      return;
    }
    jobs.forEach((job) => {
      const card = document.createElement('div');
      card.className = 'job-select-card';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'form-check-input mt-1';
      checkbox.value = job.id;
      checkbox.checked = selectedIds.has(job.id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedIds.add(job.id);
        else selectedIds.delete(job.id);
      });
      card.appendChild(checkbox);

      const label = document.createElement('label');
      label.addEventListener('click', (event) => {
        if (event.target === checkbox) return;
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      });
      const title = document.createElement('span');
      title.className = 'job-select-title';
      title.textContent = job.name || 'Untitled job';
      const workflow = document.createElement('span');
      workflow.className = 'job-select-meta';
      workflow.textContent = `Workflow: ${job.workflow || '-'}`;
      const counts = document.createElement('span');
      counts.className = 'job-select-meta';
      const counters = job.counters || {};
      counts.textContent = `${job.status || 'unknown'} - ${counters.completed || 0}/${counters.total || 0} completed`;
      const updated = document.createElement('span');
      updated.className = 'job-select-meta';
      updated.textContent = `Updated: ${formatDate(job.updated_at)}`;
      label.appendChild(title);
      label.appendChild(workflow);
      label.appendChild(counts);
      label.appendChild(updated);
      card.appendChild(label);
      jobSelection.appendChild(card);
    });
  }

  async function loadJobs() {
    if (compareStatus) compareStatus.textContent = 'Loading jobs...';
    if (reloadJobsBtn) reloadJobsBtn.disabled = true;
    try {
      const data = await api('/api/bulk/jobs?limit=200');
      jobs = Array.isArray(data.items) ? data.items : [];
      maybeAutoSelectRelatedJobs();
      renderJobSelection();
      if (compareStatus) compareStatus.textContent = `${jobs.length} job${jobs.length === 1 ? '' : 's'} loaded.`;
      if (selectedIds.size >= 2) {
        await loadComparison();
      }
    } catch (err) {
      if (jobSelection) jobSelection.innerHTML = `<div class="text-danger">Failed to load jobs: ${err.message}</div>`;
      if (compareStatus) compareStatus.textContent = 'Job load failed.';
    } finally {
      if (reloadJobsBtn) reloadJobsBtn.disabled = false;
    }
  }

  function selectedJobIds() {
    return Array.from(selectedIds).filter(Boolean).slice(0, 6);
  }

  function createMediaElement(item) {
    const mediaType = (item?.media_type || detectMediaTypeFromName(item?.filename)).toLowerCase();
    const src = item?.cached_url || item?.download_url || '';
    let el;
    if (mediaType === 'video') {
      el = document.createElement('video');
      el.controls = true;
      el.muted = true;
      el.playsInline = true;
      el.preload = 'metadata';
    } else {
      el = document.createElement('img');
      el.alt = item?.filename || 'Generated image';
      el.loading = 'lazy';
    }
    if (src) el.src = src;
    return el;
  }

  function appendObjectLine(parent, label, obj) {
    const entries = Object.entries(obj || {});
    if (!entries.length) return;
    const div = document.createElement('div');
    div.textContent = `${label}: ${entries.map(([key, value]) => `${key}: ${value}`).join(', ')}`;
    parent.appendChild(div);
  }

  function createResultCell(item) {
    const wrapper = document.createElement('div');
    wrapper.className = 'compare-result';
    if (!item) {
      const missing = document.createElement('div');
      missing.className = 'missing-result';
      missing.textContent = 'No matching completed output';
      wrapper.appendChild(missing);
      return wrapper;
    }

    wrapper.appendChild(createMediaElement(item));
    const meta = document.createElement('div');
    meta.className = 'compare-result-meta';
    const score = document.createElement('div');
    score.textContent = `Score ${formatScore(item)}`;
    meta.appendChild(score);
    if (item.defect_rating !== null && item.defect_rating !== undefined) {
      const defect = document.createElement('div');
      defect.textContent = `Defect ${item.defect_rating}`;
      meta.appendChild(defect);
    }
    if (item.completed_at) {
      const completed = document.createElement('div');
      completed.textContent = `Completed ${formatDate(item.completed_at)}`;
      meta.appendChild(completed);
    }
    if (item.download_url) {
      const linkWrap = document.createElement('div');
      const link = document.createElement('a');
      link.href = item.download_url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open original';
      linkWrap.appendChild(link);
      meta.appendChild(linkWrap);
    }
    wrapper.appendChild(meta);
    return wrapper;
  }

  function createPromptCell(group) {
    const cell = document.createElement('div');
    cell.className = 'prompt-cell';
    const prompt = document.createElement('strong');
    prompt.textContent = group.prompt_text || '-';
    cell.appendChild(prompt);
    appendObjectLine(cell, 'Placeholders', group.placeholder_values);
    appendObjectLine(cell, 'Inputs', group.input_values);
    const negative = document.createElement('div');
    negative.textContent = `Negative: ${group.negative_used ? 'With negative' : 'No negative'}`;
    cell.appendChild(negative);
    return cell;
  }

  function renderComparison(data) {
    if (!compareResults) return;
    const groups = Array.isArray(data.groups) ? data.groups : [];
    const compareJobs = Array.isArray(data.jobs) ? data.jobs : [];
    if (compareSummary) {
      compareSummary.textContent = groups.length
        ? `Showing ${data.returned || groups.length} of ${data.total_groups || groups.length} matched prompt group${(data.total_groups || groups.length) === 1 ? '' : 's'}.`
        : 'No matching completed prompt groups found for the selected jobs.';
    }
    if (!groups.length) {
      compareResults.innerHTML = '<div class="text-soft">No matching completed outputs yet.</div>';
      return;
    }

    const table = document.createElement('table');
    table.className = 'compare-table';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const promptHead = document.createElement('th');
    promptHead.textContent = 'Prompt';
    headRow.appendChild(promptHead);
    compareJobs.forEach((job) => {
      const th = document.createElement('th');
      th.textContent = `${job.name || 'Untitled'} (${job.workflow || '-'})`;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    groups.forEach((group) => {
      const tr = document.createElement('tr');
      const promptTd = document.createElement('td');
      promptTd.appendChild(createPromptCell(group));
      tr.appendChild(promptTd);
      const items = Array.isArray(group.items) ? group.items : [];
      compareJobs.forEach((_job, index) => {
        const td = document.createElement('td');
        td.appendChild(createResultCell(items[index] || null));
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    compareResults.innerHTML = '';
    compareResults.appendChild(table);
  }

  async function loadComparison() {
    const ids = selectedJobIds();
    if (ids.length < 2) {
      if (compareStatus) compareStatus.textContent = 'Select at least two jobs.';
      return;
    }
    if (compareBtn) compareBtn.disabled = true;
    if (compareStatus) compareStatus.textContent = 'Comparing jobs...';
    if (compareResults) compareResults.innerHTML = '<div class="text-soft">Loading comparison...</div>';
    try {
      const params = new URLSearchParams();
      params.set('jobIds', ids.join(','));
      params.set('limit', String(Math.max(1, Math.min(300, Number(compareLimit?.value || 100)))));
      params.set('complete', completeOnly?.checked ? '1' : '0');
      const data = await api(`/api/bulk/compare?${params.toString()}`);
      renderComparison(data);
      if (compareStatus) compareStatus.textContent = 'Comparison loaded.';
      const nextUrl = new URL(window.location.href);
      nextUrl.searchParams.set('jobIds', ids.join(','));
      window.history.replaceState(null, '', nextUrl.toString());
    } catch (err) {
      if (compareStatus) compareStatus.textContent = 'Comparison failed.';
      if (compareResults) compareResults.innerHTML = `<div class="text-danger">Failed to compare jobs: ${err.message}</div>`;
    } finally {
      if (compareBtn) compareBtn.disabled = false;
    }
  }

  reloadJobsBtn?.addEventListener('click', loadJobs);
  compareBtn?.addEventListener('click', loadComparison);

  parseInitialSelection();
  loadJobs();
})();
