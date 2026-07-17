(function () {
  const form = document.getElementById('trellis2GenerateForm');
  const imageInput = document.getElementById('trellis2Image');
  const preview = document.getElementById('trellis2Preview');
  const previewImage = document.getElementById('trellis2PreviewImage');
  const submitButton = document.getElementById('trellis2Submit');
  const submitStatus = document.getElementById('trellis2SubmitStatus');
  const alert = document.getElementById('trellis2Alert');
  const serviceBadge = document.getElementById('trellis2ServiceBadge');
  const serviceRefresh = document.getElementById('trellis2ServiceRefresh');
  let previewUrl = null;
  let pollTimer = null;

  function setAlert(message, type = 'info') {
    if (!alert) return;
    alert.hidden = !message;
    alert.className = `trellis2-alert trellis2-alert--${type}`;
    alert.textContent = message || '';
  }

  function setServiceBadge(message, type) {
    if (!serviceBadge) return;
    serviceBadge.textContent = message;
    serviceBadge.className = `trellis2-badge trellis2-badge--${type}`;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed with status ${response.status}.`);
    }
    return data;
  }

  async function loadServiceState() {
    setServiceBadge('Checking service', 'pending');
    try {
      const state = await requestJson('/trellis2/status', {
        headers: { Accept: 'application/json' },
      });
      if (!state.running) {
        setServiceBadge('Starts on demand', 'warn');
      } else if (state.busy) {
        setServiceBadge('Generation in progress', 'warn');
      } else if (state.healthOk) {
        const model = state.modelState === 'ready' ? 'model ready' : `model ${state.modelState}`;
        setServiceBadge(`Service online · ${model}`, 'ok');
      } else {
        setServiceBadge('Service running · health unknown', 'warn');
      }
    } catch {
      setServiceBadge('Status unavailable', 'error');
    }
  }

  function updatePreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    const file = imageInput?.files?.[0];
    if (!file || !preview || !previewImage) {
      if (preview) preview.hidden = true;
      return;
    }
    previewUrl = URL.createObjectURL(file);
    previewImage.src = previewUrl;
    preview.hidden = false;
  }

  async function submitGeneration(event) {
    event.preventDefault();
    if (!form || !form.reportValidity()) return;

    submitButton.disabled = true;
    submitButton.textContent = 'Uploading...';
    if (submitStatus) submitStatus.textContent = 'Saving the image and queueing the job.';
    setAlert('Uploading your reference image...', 'info');

    try {
      const data = await requestJson(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: new FormData(form),
      });
      setAlert('Job queued. Opening your updated model library...', 'success');
      window.location.assign(data.redirectUrl || '/trellis2?queued=1');
    } catch (error) {
      setAlert(error.message || 'Unable to queue the model.', 'error');
      submitButton.disabled = false;
      submitButton.textContent = 'Generate 3D model';
      if (submitStatus) submitStatus.textContent = '';
    }
  }

  async function updateSharing(toggle) {
    const card = toggle.closest('[data-trellis2-job-id]');
    const jobId = card?.dataset.trellis2JobId;
    const status = card?.querySelector('[data-trellis2-share-status]');
    if (!jobId) return;

    const requestedValue = toggle.checked;
    toggle.disabled = true;
    if (status) status.textContent = 'Saving...';
    try {
      const data = await requestJson(`/trellis2/jobs/${encodeURIComponent(jobId)}/share`, {
        method: 'PATCH',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ shared: requestedValue }),
      });
      toggle.checked = data.shared === true;
      if (status) status.textContent = data.shared ? 'Visible to other logged-in users.' : 'Private.';
    } catch (error) {
      toggle.checked = !requestedValue;
      if (status) status.textContent = error.message || 'Unable to save.';
    } finally {
      toggle.disabled = false;
    }
  }

  async function deleteJob(button) {
    const card = button.closest('[data-trellis2-job-id]');
    const jobId = card?.dataset.trellis2JobId;
    if (!jobId) return;

    const jobName = card.querySelector('h3')?.textContent?.trim() || 'this job';
    const confirmed = window.confirm(`Delete "${jobName}" and its image and 3D model files? This cannot be undone.`);
    if (!confirmed) return;

    const originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = 'Deleting...';
    card.setAttribute('aria-busy', 'true');
    setAlert('Deleting the job and its stored files...', 'info');
    try {
      await requestJson(`/trellis2/jobs/${encodeURIComponent(jobId)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      window.location.reload();
    } catch (error) {
      setAlert(error.message || 'Unable to delete the job.', 'error');
      card.removeAttribute('aria-busy');
      button.disabled = false;
      button.textContent = originalLabel;
    }
  }

  function activeJobCards() {
    return [...document.querySelectorAll('[data-trellis2-job-id]')]
      .filter((card) => ['queued', 'processing'].includes(card.dataset.trellis2JobStatus));
  }

  async function pollJobs() {
    pollTimer = null;
    const cards = activeJobCards();
    if (!cards.length) return;

    let shouldReload = false;
    await Promise.all(cards.map(async (card) => {
      const jobId = card.dataset.trellis2JobId;
      try {
        const job = await requestJson(`/trellis2/jobs/${encodeURIComponent(jobId)}`, {
          headers: { Accept: 'application/json' },
        });
        const previous = card.dataset.trellis2JobStatus;
        card.dataset.trellis2JobStatus = job.status;
        const badge = card.querySelector('[data-trellis2-status]');
        if (badge) {
          const label = job.status === 'processing'
            ? 'Generating'
            : `${job.status.charAt(0).toUpperCase()}${job.status.slice(1)}`;
          badge.textContent = label;
          badge.className = `trellis2-status trellis2-status--${job.status}`;
        }
        if (previous !== job.status && ['completed', 'failed'].includes(job.status)) {
          shouldReload = true;
        }
      } catch {
        // A transient polling failure should not disrupt the rest of the page.
      }
    }));

    if (shouldReload) {
      window.location.reload();
      return;
    }
    if (activeJobCards().length) {
      pollTimer = window.setTimeout(pollJobs, 8000);
    }
  }

  imageInput?.addEventListener('change', updatePreview);
  form?.addEventListener('submit', submitGeneration);
  serviceRefresh?.addEventListener('click', async () => {
    serviceRefresh.disabled = true;
    await loadServiceState();
    serviceRefresh.disabled = false;
  });
  document.querySelectorAll('[data-trellis2-share]').forEach((toggle) => {
    toggle.addEventListener('change', () => updateSharing(toggle));
  });
  document.querySelectorAll('[data-trellis2-delete]').forEach((button) => {
    button.addEventListener('click', () => deleteJob(button));
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && activeJobCards().length && !pollTimer) {
      pollJobs();
    }
  });
  window.addEventListener('beforeunload', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (pollTimer) window.clearTimeout(pollTimer);
  });

  loadServiceState();
  if (activeJobCards().length) pollJobs();
})();
