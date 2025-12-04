// public/js/image_gen_bulk_slideshow.js
(function () {
  const root = document.getElementById('slideshowRoot');
  if (!root) return;
  const jobId = root.dataset.jobId;
  if (!jobId) return;

  const mediaContainer = document.getElementById('slideshowMedia');
  const statusEl = document.getElementById('slideshowStatus');
  const remainingEl = document.getElementById('slideshowRemaining');
  const jobNameEl = document.getElementById('slideshowJobName');
  const jobWorkflowEl = document.getElementById('slideshowJobWorkflow');
  const templateEl = document.getElementById('slideshowTemplate');
  const promptTextEl = document.getElementById('slideshowPromptText');
  const placeholderListEl = document.getElementById('slideshowPlaceholderList');
  const inputListEl = document.getElementById('slideshowInputList');
  const negativeEl = document.getElementById('slideshowNegative');
  const downloadLinkEl = document.getElementById('slideshowDownloadLink');
  const ratingForm = document.getElementById('slideshowRatingForm');
  const defectOptionsEl = document.getElementById('defectRatingOptions');
  const alignmentFieldset = document.getElementById('alignmentRatingFieldset');
  const alignmentControlsEl = document.getElementById('alignmentControls');
  const errorEl = document.getElementById('slideshowError');
  const emptyEl = document.getElementById('slideshowEmpty');
  const skipBtn = document.getElementById('skipBtn');
  const submitBtn = ratingForm?.querySelector('button[type="submit"]');

  let jobSummary = null;
  let currentItem = null;
  let currentAlignmentParts = [];
  let loading = false;

  async function api(path, init = {}) {
    const opts = Object.assign({ headers: {} }, init);
    if (opts.body && !(opts.body instanceof FormData)) {
      opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    }
    const resp = await fetch(`/image_gen${path}`, opts);
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(text || `${resp.status} ${resp.statusText}`);
    }
    const ct = resp.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      return resp.json();
    }
    return resp;
  }

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text || '';
  }

  function setRemaining(count) {
    if (!remainingEl) return;
    const value = Number(count || 0);
    remainingEl.textContent = `Remaining: ${value}`;
  }

  function setError(message) {
    if (!errorEl) return;
    if (!message) {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
      return;
    }
    errorEl.textContent = message;
    errorEl.style.display = '';
  }

  function setEmpty(visible) {
    if (!emptyEl) return;
    emptyEl.style.display = visible ? '' : 'none';
  }

  function toggleFormDisabled(disabled) {
    if (!ratingForm) return;
    const controls = ratingForm.querySelectorAll('input, button, select, textarea');
    controls.forEach((el) => {
      el.disabled = disabled;
    });
  }

  function updateJobSummary(info) {
    if (!info) return;
    if (jobNameEl) jobNameEl.textContent = info.name || 'Bulk job';
    if (jobWorkflowEl) {
      jobWorkflowEl.textContent = info.workflow ? `Workflow: ${info.workflow}` : 'Workflow: -';
    }
  }

  function renderMedia(item) {
    if (!mediaContainer) return;
    mediaContainer.innerHTML = '';
    if (!item || (!item.cached_url && !item.download_url)) {
      const empty = document.createElement('div');
      empty.className = 'text-soft';
      empty.textContent = 'No preview available.';
      mediaContainer.appendChild(empty);
      return;
    }
    const url = item.cached_url || item.download_url;
    const mediaType = (item.media_type || '').toLowerCase();
    let element;
    if (mediaType === 'video') {
      element = document.createElement('video');
      element.controls = true;
      element.playsInline = true;
      element.preload = 'metadata';
    } else {
      element = document.createElement('img');
      element.alt = item.filename || 'Prompt output';
      element.loading = 'lazy';
    }
    element.src = url;
    const figure = document.createElement('figure');
    figure.appendChild(element);
    mediaContainer.appendChild(figure);
  }

  function renderKeyValueList(listEl, values, emptyText) {
    if (!listEl) return;
    listEl.innerHTML = '';
    const entries = Object.entries(values || {});
    if (!entries.length) {
      const li = document.createElement('li');
      li.className = 'text-soft';
      li.textContent = emptyText;
      listEl.appendChild(li);
      return;
    }
    entries.forEach(([key, value]) => {
      const li = document.createElement('li');
      const strong = document.createElement('strong');
      strong.textContent = key;
      li.appendChild(strong);
      li.appendChild(document.createTextNode(`: ${value || '-'}`));
      listEl.appendChild(li);
    });
  }

  function clearDetails() {
    if (templateEl) templateEl.textContent = '-';
    if (promptTextEl) promptTextEl.textContent = '-';
    renderKeyValueList(placeholderListEl, {}, 'No placeholders for this image.');
    renderKeyValueList(inputListEl, {}, 'No image inputs for this image.');
    if (negativeEl) negativeEl.textContent = '-';
    if (downloadLinkEl) {
      downloadLinkEl.textContent = 'Open cached file';
      downloadLinkEl.removeAttribute('href');
      downloadLinkEl.style.display = 'none';
    }
  }

  function renderDetails(item) {
    if (!item) {
      clearDetails();
      return;
    }
    if (templateEl) {
      templateEl.textContent = item.template_label || `Template #${(item.template_index || 0) + 1}`;
    }
    if (promptTextEl) {
      promptTextEl.textContent = item.prompt_text || '-';
    }
    renderKeyValueList(placeholderListEl, item.placeholder_values, 'No placeholders for this image.');
    renderKeyValueList(inputListEl, item.input_values, 'No image inputs for this image.');
    if (negativeEl) {
      if (item.negative_used) {
        negativeEl.textContent = jobSummary?.negative_prompt || 'Negative prompt was applied.';
      } else {
        negativeEl.textContent = 'Negative prompt not used.';
      }
    }
    if (downloadLinkEl) {
      const url = item.cached_url || item.download_url;
      if (url) {
        downloadLinkEl.href = url;
        downloadLinkEl.style.display = '';
        downloadLinkEl.textContent = 'Open original file';
      } else {
        downloadLinkEl.removeAttribute('href');
        downloadLinkEl.style.display = 'none';
      }
    }
  }

  function slugify(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'part';
  }

  function renderDefectOptions(selectedValue) {
    if (!defectOptionsEl) return;
    defectOptionsEl.innerHTML = '';
    const values = [0, 1, 2, 3, 4, 5];
    values.forEach((value) => {
      const id = `defect-${value}`;
      const input = document.createElement('input');
      input.type = 'radio';
      input.className = 'btn-check';
      input.name = 'defectRating';
      input.id = id;
      input.value = String(value);
      if (value === selectedValue) {
        input.checked = true;
      }
      const label = document.createElement('label');
      label.className = 'btn btn-outline-secondary';
      label.htmlFor = id;
      label.textContent = value;
      defectOptionsEl.appendChild(input);
      defectOptionsEl.appendChild(label);
    });
  }

  function renderAlignmentControls(parts, ratings) {
    currentAlignmentParts = Array.isArray(parts) ? parts : [];
    if (!alignmentControlsEl || !alignmentFieldset) return;
    alignmentControlsEl.innerHTML = '';
    if (!currentAlignmentParts.length) {
      alignmentFieldset.classList.add('d-none');
      return;
    }
    alignmentFieldset.classList.remove('d-none');
    currentAlignmentParts.forEach((part, index) => {
      const card = document.createElement('div');
      card.className = 'alignment-card';
      card.dataset.partKey = part.part_key;

      const label = document.createElement('div');
      label.className = 'alignment-card__label';
      label.textContent = `Part ${index}: ${part.label || part.part_key}`;
      card.appendChild(label);

      const text = document.createElement('div');
      text.className = 'alignment-card__text';
      text.textContent = part.text || '(No prompt text)';
      card.appendChild(text);

      const btnGroup = document.createElement('div');
      btnGroup.className = 'btn-group';
      const slug = slugify(part.part_key);
      const selected = Number(ratings?.[part.part_key]);
      [1, 2, 3, 4, 5].forEach((score) => {
        const inputId = `align-${slug}-${score}`;
        const input = document.createElement('input');
        input.type = 'radio';
        input.className = 'btn-check';
        input.name = `align-${slug}`;
        input.id = inputId;
        input.value = String(score);
        input.dataset.partKey = part.part_key;
        if (score === selected) {
          input.checked = true;
        }
        const labelBtn = document.createElement('label');
        labelBtn.className = 'btn btn-outline-primary btn-sm';
        labelBtn.htmlFor = inputId;
        labelBtn.textContent = score;
        btnGroup.appendChild(input);
        btnGroup.appendChild(labelBtn);
      });
      card.appendChild(btnGroup);
      alignmentControlsEl.appendChild(card);
    });
  }

  function getSelectedDefectRating() {
    const input = defectOptionsEl?.querySelector('input[name="defectRating"]:checked');
    if (!input) return null;
    const value = Number(input.value);
    return Number.isFinite(value) ? value : null;
  }

  function collectAlignmentRatings() {
    const ratings = {};
    const missing = new Set();
    if (!currentAlignmentParts.length) {
      return { ratings, missing: [] };
    }
    currentAlignmentParts.forEach((part) => {
      if (part?.part_key) {
        missing.add(part.part_key);
      }
    });
    const cards = alignmentControlsEl.querySelectorAll('[data-part-key]');
    cards.forEach((card) => {
      const partKey = card.dataset.partKey;
      if (!partKey) return;
      let selected = null;
      const inputs = card.querySelectorAll('input[type="radio"]');
      inputs.forEach((input) => {
        if (input.checked) {
          selected = Number(input.value);
        }
      });
      if (Number.isFinite(selected)) {
        ratings[partKey] = selected;
        missing.delete(partKey);
      }
    });
    return { ratings, missing: Array.from(missing) };
  }

  async function loadNext(options = {}) {
    if (loading) return;
    loading = true;
    const { showLoader = false } = options;
    setError('');
    if (showLoader) {
      setStatus('Loading next prompt…');
      renderMedia(null);
    }
    try {
      const data = await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}/slideshow/next`);
      jobSummary = data.job || jobSummary;
      setRemaining(data.remaining || 0);
      updateJobSummary(jobSummary);
      const item = data.item || null;
      currentItem = item;
      if (!item) {
        setEmpty(true);
        setStatus('No pending prompts need ratings.');
        clearDetails();
        renderDefectOptions(null);
        renderAlignmentControls([], {});
        toggleFormDisabled(true);
        return;
      }
      setEmpty(false);
      toggleFormDisabled(false);
      setStatus('Rate this image, then submit to continue.');
      renderMedia(item);
      renderDetails(item);
      renderDefectOptions(Number.isFinite(item.defect_rating) ? item.defect_rating : null);
      renderAlignmentControls(item.alignment_parts || [], item.alignment_ratings || {});
    } catch (err) {
      setError(err.message || 'Failed to load next prompt.');
      setStatus('Unable to load next prompt.');
    } finally {
      loading = false;
    }
  }

  ratingForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentItem) return;
    const defectRating = getSelectedDefectRating();
    if (!Number.isInteger(defectRating)) {
      setError('Select a defect rating between 0 and 5.');
      return;
    }
    const { ratings, missing } = collectAlignmentRatings();
    if (missing.length) {
      setError('Please rate every prompt part before submitting.');
      return;
    }
    setError('');
    toggleFormDisabled(true);
    setStatus('Saving ratings…');
    try {
      await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}/slideshow/rate`, {
        method: 'POST',
        body: JSON.stringify({
          prompt_id: currentItem.id,
          defect_rating: defectRating,
          alignment_ratings: ratings
        })
      });
      setStatus('Saved! Loading next prompt…');
      await loadNext({ showLoader: true });
    } catch (err) {
      setError(err.message || 'Failed to save ratings.');
      setStatus('Unable to save ratings.');
    } finally {
      toggleFormDisabled(false);
    }
  });

  skipBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    if (loading) return;
    setStatus('Skipping to the next prompt…');
    loadNext({ showLoader: true });
  });

  toggleFormDisabled(true);
  renderDefectOptions(null);
  renderAlignmentControls([], {});
  loadNext({ showLoader: true });
})();
