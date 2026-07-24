(function () {
  const configElement = document.getElementById('promptTo3dPageConfig');
  if (!configElement) return;

  let config;
  try {
    config = JSON.parse(configElement.textContent || '{}');
  } catch {
    return;
  }

  const ACTIVE_STATUSES = new Set(['queued', 'generating_image', 'generating_model']);
  const form = document.getElementById('promptTo3dForm');
  const fields = document.getElementById('promptTo3dFields');
  const submitButton = document.getElementById('promptTo3dSubmit');
  const formStatus = document.getElementById('promptTo3dFormStatus');
  const jobPanel = document.getElementById('promptTo3dJob');
  const jobTitle = document.getElementById('promptTo3dJobTitle');
  const jobBadge = document.getElementById('promptTo3dJobBadge');
  const jobMessage = document.getElementById('promptTo3dJobMessage');
  const generatedImage = document.getElementById('promptTo3dGeneratedImage');
  const imageLink = document.getElementById('promptTo3dImageLink');
  const pixalLink = document.getElementById('promptTo3dPixalLink');
  const sizeMode = document.getElementById('promptTo3dSizeMode');
  const presetField = document.getElementById('promptTo3dPresetField');
  const customSize = document.getElementById('promptTo3dCustomSize');
  const outputFormat = document.getElementById('promptTo3dOutputFormat');
  const compressionField = document.getElementById('promptTo3dCompressionField');
  const fovInput = document.getElementById('promptTo3dFov');
  let currentJob = config.currentJob || null;
  let pollTimer = null;
  let redirectPending = false;

  function setFormStatus(message, tone = '') {
    if (!formStatus) return;
    formStatus.textContent = message || '';
    if (tone) formStatus.dataset.tone = tone;
    else delete formStatus.dataset.tone;
  }

  function setFormLocked(locked) {
    if (fields) fields.disabled = locked;
    if (submitButton) {
      submitButton.textContent = locked
        ? 'Generation in progress'
        : 'Generate image and 3D model';
    }
  }

  function updateSizeControls() {
    if (!sizeMode) return;
    const mode = sizeMode.value;
    if (presetField) {
      presetField.hidden = mode !== 'preset';
      presetField.querySelectorAll('select, input').forEach((input) => {
        input.disabled = mode !== 'preset';
      });
    }
    if (customSize) {
      customSize.hidden = mode !== 'custom';
      customSize.querySelectorAll('select, input').forEach((input) => {
        input.disabled = mode !== 'custom';
      });
    }
  }

  function updateCompressionControl() {
    if (!outputFormat || !compressionField) return;
    const enabled = outputFormat.value !== 'png';
    compressionField.hidden = !enabled;
    compressionField.querySelectorAll('input').forEach((input) => {
      input.disabled = !enabled;
    });
  }

  function validateFov() {
    if (!fovInput) return;
    const value = Number(fovInput.value);
    const valid = Number.isFinite(value) && (value === 0 || (value >= 5 && value <= 120));
    fovInput.setCustomValidity(
      valid ? '' : 'Use 0 for automatic FOV, or enter a value from 5 to 120 degrees.',
    );
  }

  async function readJson(response) {
    const text = await response.text();
    let payload = {};
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { error: text || 'Unexpected server response.' };
    }
    if (!response.ok || payload.ok === false) {
      const error = new Error(payload.error || `Request failed with status ${response.status}.`);
      error.job = payload.job || null;
      throw error;
    }
    return payload;
  }

  function setLink(link, href) {
    if (!link) return;
    link.hidden = !href;
    if (href) link.href = href;
  }

  function setProgress(job) {
    const steps = [...document.querySelectorAll('[data-progress-step]')];
    steps.forEach((step) => step.classList.remove('is-active', 'is-complete', 'is-failed'));
    const imageStep = steps.find((step) => step.dataset.progressStep === 'image');
    const modelStep = steps.find((step) => step.dataset.progressStep === 'model');
    const previewStep = steps.find((step) => step.dataset.progressStep === 'preview');

    if (job.status === 'queued' || job.status === 'generating_image') {
      imageStep?.classList.add('is-active');
    } else if (job.status === 'generating_model') {
      imageStep?.classList.add('is-complete');
      modelStep?.classList.add('is-active');
    } else if (job.status === 'completed') {
      imageStep?.classList.add('is-complete');
      modelStep?.classList.add('is-complete');
      previewStep?.classList.add('is-complete');
    } else if (job.status === 'failed') {
      if (job.imageUrl) {
        imageStep?.classList.add('is-complete');
        modelStep?.classList.add('is-failed');
      } else {
        imageStep?.classList.add('is-failed');
      }
    }
  }

  function statusCopy(job) {
    if (job.status === 'queued') {
      return 'Queued. The background worker will start the source image shortly.';
    }
    if (job.status === 'generating_image') {
      return 'GPT Image is generating and saving the source image. You can leave this page safely.';
    }
    if (job.status === 'generating_model') {
      return 'The image is saved. Pixal3D is generating the textured model in its background queue.';
    }
    if (job.status === 'completed') {
      return 'The model is ready. Opening the 3D previewer…';
    }
    if (job.status === 'failed') {
      return job.error || 'The generation failed. You can adjust the settings and try again.';
    }
    return 'Checking generation status…';
  }

  function statusLabel(status) {
    const labels = {
      queued: 'Queued',
      generating_image: 'Generating image',
      generating_model: 'Generating model',
      completed: 'Completed',
      failed: 'Failed',
    };
    return labels[status] || status;
  }

  function redirectToPreview(job) {
    if (!job.previewUrl || redirectPending) return;
    redirectPending = true;
    const redirect = () => window.location.assign(job.previewUrl);
    if (document.visibilityState === 'visible') {
      window.setTimeout(redirect, 500);
    } else {
      const onVisible = () => {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', onVisible);
        redirect();
      };
      document.addEventListener('visibilitychange', onVisible);
    }
  }

  function renderJob(job) {
    if (!job || !jobPanel) return;
    currentJob = job;
    jobPanel.hidden = false;
    jobPanel.dataset.jobId = job.id || '';
    jobPanel.dataset.jobStatus = job.status || '';
    if (jobTitle) {
      const prompt = String(job.prompt || '');
      jobTitle.textContent = prompt.length > 90 ? `${prompt.slice(0, 90)}…` : prompt || 'Prompt to 3D job';
    }
    if (jobBadge) {
      jobBadge.textContent = statusLabel(job.status);
      jobBadge.dataset.status = job.status || '';
    }
    if (jobMessage) jobMessage.textContent = statusCopy(job);
    if (generatedImage) {
      generatedImage.hidden = !job.imageUrl;
      if (job.imageUrl) generatedImage.src = job.imageUrl;
    }
    setLink(imageLink, job.imageGalleryUrl);
    setLink(pixalLink, job.pixal3dUrl);
    setProgress(job);

    const active = ACTIVE_STATUSES.has(job.status);
    setFormLocked(active);
    if (job.status === 'failed') {
      setFormStatus('The previous job finished with an error. You can start another job.', 'error');
    } else if (active) {
      setFormStatus('This job continues in the background if you navigate away.');
    } else {
      setFormStatus('');
    }
    if (job.status === 'completed') redirectToPreview(job);
  }

  function clearPollTimer() {
    if (pollTimer) window.clearTimeout(pollTimer);
    pollTimer = null;
  }

  function schedulePoll() {
    clearPollTimer();
    if (!currentJob || !ACTIVE_STATUSES.has(currentJob.status)) return;
    pollTimer = window.setTimeout(
      pollJob,
      Math.max(1000, Number(config.pollIntervalMs) || 4000),
    );
  }

  async function pollJob() {
    clearPollTimer();
    if (!currentJob?.id || !ACTIVE_STATUSES.has(currentJob.status)) return;
    try {
      const response = await fetch(`/prompt-to-3d/jobs/${encodeURIComponent(currentJob.id)}`, {
        headers: { Accept: 'application/json' },
      });
      const payload = await readJson(response);
      renderJob(payload.job);
    } catch (error) {
      setFormStatus(`${error.message} Retrying automatically.`, 'error');
    }
    schedulePoll();
  }

  async function submitJob(event) {
    event.preventDefault();
    if (!form || !fields || fields.disabled) return;
    validateFov();
    if (!form.reportValidity()) return;

    const body = Object.fromEntries(new FormData(form).entries());
    setFormLocked(true);
    setFormStatus('Validating all settings and queueing the background workflow.');

    try {
      const response = await fetch(form.action, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const payload = await readJson(response);
      renderJob(payload.job);
      schedulePoll();
    } catch (error) {
      if (error.job) {
        renderJob(error.job);
        schedulePoll();
      } else {
        setFormLocked(false);
      }
      setFormStatus(error.message || 'Unable to queue the job.', 'error');
    }
  }

  sizeMode?.addEventListener('change', updateSizeControls);
  outputFormat?.addEventListener('change', updateCompressionControl);
  fovInput?.addEventListener('input', validateFov);
  form?.addEventListener('submit', submitJob);
  document.addEventListener('visibilitychange', () => {
    if (
      document.visibilityState === 'visible'
      && currentJob
      && ACTIVE_STATUSES.has(currentJob.status)
    ) {
      void pollJob();
    }
  });
  window.addEventListener('beforeunload', clearPollTimer);

  updateSizeControls();
  updateCompressionControl();
  validateFov();
  if (currentJob) {
    renderJob(currentJob);
    schedulePoll();
  } else {
    setFormLocked(false);
  }
})();
