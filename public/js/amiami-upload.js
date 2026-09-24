(() => {
  'use strict';
  const base = '/admin/amiami-items/upload';
  const byId = id => document.getElementById(id);
  const status = byId('upload-status');
  let timer;
  let submitting = false;
  let refreshing = false;
  let generation = 0;
  const text = (id, value) => { byId(id).textContent = value; };
  const formatDate = value => value ? new Date(value).toLocaleString() : '';

  function showJob(job) {
    byId('job-panel').hidden = !job;
    byId('upload-panel').hidden = Boolean(job?.active);
    if (!job) return;
    text('job-state', job.state === 'completed' && job.failed ? 'Completed with errors' : ({ queued: 'Waiting', running: 'Fetching', completed: 'Completed', failed: 'Stopped' }[job.state] || job.state));
    text('job-message', job.message || (job.active ? 'Fetching missing items at a steady pace.' : 'You can upload another list.'));
    text('job-total', job.totalCodes);
    text('job-existing', job.skippedExisting);
    text('job-fetched', job.fetched);
    text('job-failed', job.failed);
    const processed = job.skippedExisting + job.fetched + job.failed;
    byId('job-progress').max = Math.max(1, job.totalCodes);
    byId('job-progress').value = processed;
    text('job-summary', `${processed} of ${job.totalCodes} item codes processed`);
    text('job-timing', job.active ? `At least ${job.delaySeconds} seconds between item attempts. Next check: ${formatDate(job.nextFetchAt)}` : `Finished: ${formatDate(job.finishedAt)}`);
    text('job-current', job.currentCode ? `Current item: ${job.currentCode}` : '');
    byId('background-note').hidden = !job.active;
    text('job-reference', `Started: ${formatDate(job.startedAt)} · Job ${job.jobId}`);
    const failures = byId('job-failures');
    failures.replaceChildren();
    for (const failure of job.failures || []) {
      const item = document.createElement('li');
      item.textContent = `${failure.itemCode}: ${failure.message}`;
      failures.append(item);
    }
    byId('failure-panel').hidden = !job.failures?.length;
  }

  async function responseJson(response) {
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('Your session or permission may have changed. Reload this page and sign in again.');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The request failed. Please try again.');
    return data;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(refresh, 5000);
  }

  async function refresh() {
    if (refreshing || submitting) return;
    refreshing = true;
    const currentGeneration = generation;
    try {
      const data = await responseJson(await fetch(`${base}/status`, { headers: { Accept: 'application/json' }, cache: 'no-store' }));
      if (currentGeneration !== generation) return;
      showJob(data.job);
      status.classList.remove('error');
      status.textContent = data.job?.active ? 'Import is running in the background.' : 'Ready for an HTML upload.';
    } catch (error) {
      if (currentGeneration !== generation) return;
      status.classList.add('error');
      status.textContent = error.message;
      // Keep the form closed until the server confirms the shared slot is free.
      byId('upload-panel').hidden = true;
    } finally {
      refreshing = false;
      schedule();
    }
  }

  byId('upload-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    const file = byId('html-file').files[0];
    const html = byId('html-input').value;
    if ((file && html.trim()) || (!file && !html.trim())) {
      status.classList.add('error');
      status.textContent = 'Choose one HTML file or paste HTML, not both.';
      return;
    }
    if ((file?.size || new Blob([html]).size) > 2 * 1024 * 1024) {
      status.classList.add('error');
      status.textContent = 'HTML must be no larger than 2 MiB.';
      return;
    }
    const body = new FormData();
    if (file) body.append('file', file);
    else body.append('html', html);
    submitting = true;
    generation += 1;
    clearTimeout(timer);
    byId('upload-submit').disabled = true;
    status.classList.remove('error');
    status.textContent = 'Checking item codes and existing records…';
    try {
      const data = await responseJson(await fetch(base, { method: 'POST', headers: {
        Accept: 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content,
      }, body }));
      byId('upload-form').reset();
      showJob(data.job);
      status.textContent = data.job.active ? 'Upload accepted. You can leave this page.' : 'All item codes are already in the catalog.';
    } catch (error) {
      status.classList.add('error');
      status.textContent = error.message;
    } finally {
      submitting = false;
      byId('upload-submit').disabled = false;
      schedule();
    }
  });
  byId('refresh-status').addEventListener('click', refresh);
  window.addEventListener('pagehide', () => clearTimeout(timer));
  refresh();
})();
