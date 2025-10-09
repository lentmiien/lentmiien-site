// public/js/image_gen_bulk_index.js
(function(){
  const jobListEl = document.getElementById('jobList');
  const refreshBtn = document.getElementById('refreshBtn');
  const refreshStatus = document.getElementById('refreshStatus');
  let refreshTimer = null;
  let lastLoadedAt = null;

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

  function formatDate(value) {
    if (!value) return '-';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '-';
    return d.toLocaleString();
  }

  function formatPercent(progress) {
    const pct = Math.max(0, Math.min(1, Number(progress || 0)));
    return `${(pct * 100).toFixed(0)}%`;
  }

  function counterLines(counters) {
    const base = Object.assign({
      total: 0, pending: 0, processing: 0, paused: 0, completed: 0, canceled: 0
    }, counters || {});
    return [
      `Total: ${base.total}`,
      `Completed: ${base.completed}`,
      `In queue: ${base.pending}`,
      `Processing: ${base.processing}`,
      `Paused: ${base.paused}`,
      `Canceled: ${base.canceled}`
    ];
  }

  function availableActions(status) {
    switch ((status || '').toLowerCase()) {
      case 'created':
        return [{ action: 'start', label: 'Start', cls: 'btn-success' }];
      case 'processing':
        return [
          { action: 'pause', label: 'Pause', cls: 'btn-warning' },
          { action: 'cancel', label: 'Cancel', cls: 'btn-outline-danger' }
        ];
      case 'paused':
        return [
          { action: 'resume', label: 'Resume', cls: 'btn-primary' },
          { action: 'cancel', label: 'Cancel', cls: 'btn-outline-danger' }
        ];
      default:
        return [];
    }
  }

  function renderJobs(items) {
    jobListEl.innerHTML = '';
    if (!items || !items.length) {
      jobListEl.innerHTML = '<div class="text-soft">No bulk jobs yet.</div>';
      return;
    }
    items.forEach((job) => {
      const card = document.createElement('div');
      card.className = 'bulk-card';

      const title = document.createElement('h3');
      const link = document.createElement('a');
      link.href = `/image_gen/bulk/${encodeURIComponent(job.id)}`;
      link.textContent = job.name || 'Untitled job';
      title.appendChild(link);

      const statusPill = document.createElement('span');
      statusPill.className = 'status-pill';
      statusPill.textContent = job.status || 'unknown';

      const header = document.createElement('div');
      header.className = 'd-flex justify-content-between align-items-center flex-wrap gap-2';
      header.appendChild(title);
      header.appendChild(statusPill);

      const meta = document.createElement('div');
      meta.className = 'bulk-meta';
      meta.innerHTML = `
        <span>Workflow: <strong>${job.workflow || '-'}</strong></span>
        <span>Updated: ${formatDate(job.updated_at)}</span>
        <span>Started: ${formatDate(job.started_at)}</span>
        <span>Completed: ${formatDate(job.completed_at)}</span>
      `;

      const progressWrap = document.createElement('div');
      progressWrap.className = 'bulk-progress';
      const bar = document.createElement('div');
      bar.className = 'bulk-progress-bar';
      bar.style.width = formatPercent(job.progress || 0);
      progressWrap.appendChild(bar);

      const counters = document.createElement('div');
      counters.className = 'text-soft';
      counters.textContent = counterLines(job.counters).join(' • ');

      const actionWrap = document.createElement('div');
      actionWrap.className = 'bulk-actions';
      const actions = availableActions(job.status);
      actions.forEach(({ action, label, cls }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn btn-sm ${cls}`;
        btn.textContent = label;
        btn.addEventListener('click', () => updateStatus(job.id, action));
        actionWrap.appendChild(btn);
      });
      const detailBtn = document.createElement('a');
      detailBtn.className = 'btn btn-sm btn-outline-secondary';
      detailBtn.href = `/image_gen/bulk/${encodeURIComponent(job.id)}`;
      detailBtn.textContent = 'Open details';
      actionWrap.appendChild(detailBtn);
      const scoreBtn = document.createElement('a');
      scoreBtn.className = 'btn btn-sm btn-outline-primary';
      scoreBtn.href = `/image_gen/bulk/${encodeURIComponent(job.id)}/score`;
      scoreBtn.textContent = 'Open scoring';
      actionWrap.appendChild(scoreBtn);
      if ((job.counters?.canceled || 0) > 0) {
        const redoBtn = document.createElement('button');
        redoBtn.type = 'button';
        redoBtn.className = 'btn btn-sm btn-outline-info';
        redoBtn.textContent = 'Redo canceled';
        redoBtn.addEventListener('click', () => updateStatus(job.id, 'redo_canceled'));
        actionWrap.appendChild(redoBtn);
      }

      card.appendChild(header);
      card.appendChild(meta);
      card.appendChild(progressWrap);
      card.appendChild(counters);
      card.appendChild(actionWrap);
      jobListEl.appendChild(card);
    });
  }

  async function updateStatus(id, action) {
    try {
      disableActions(true);
      await api(`/api/bulk/jobs/${encodeURIComponent(id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ action })
      });
      await loadJobs();
    } catch (err) {
      alert(`Failed to update job: ${err.message}`);
    } finally {
      disableActions(false);
    }
  }

  function disableActions(disabled) {
    jobListEl.querySelectorAll('button').forEach(btn => {
      btn.disabled = disabled;
    });
  }

  async function loadJobs() {
    try {
      refreshStatus.textContent = 'Loading…';
      const data = await api('/api/bulk/jobs?limit=200');
      renderJobs(data.items || []);
      lastLoadedAt = new Date();
      refreshStatus.textContent = `Last updated ${lastLoadedAt.toLocaleTimeString()}`;
    } catch (err) {
      jobListEl.innerHTML = `<div class="text-danger">Failed to load jobs: ${err.message}</div>`;
      refreshStatus.textContent = 'Refresh failed';
    }
  }

  function scheduleAutoRefresh() {
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(loadJobs, 60 * 1000);
  }

  refreshBtn?.addEventListener('click', loadJobs);
  loadJobs();
  scheduleAutoRefresh();
})();
