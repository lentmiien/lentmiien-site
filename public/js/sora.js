(function () {
  const appEl = document.getElementById('sora-app');
  if (!appEl) {
    return;
  }

  const configEl = document.getElementById('sora-config');
  let parsedConfig = {
    modelOptions: {},
    defaultPageSize: 12,
    ratingDescriptions: {},
    categories: [],
  };

  if (configEl) {
    try {
      const data = JSON.parse(configEl.textContent || '{}');
      parsedConfig = Object.assign(parsedConfig, data || {});
    } catch (error) {
      console.warn('Unable to parse Sora config payload', error);
    }
  }

  const state = {
    config: parsedConfig,
    filters: {
      page: 1,
      limit: parsedConfig.defaultPageSize || 12,
      search: '',
      model: '',
      seconds: '',
      size: '',
      category: '',
      rating: '',
      includeLowRated: false,
    },
    pagination: {
      page: 1,
      pages: 1,
    },
    pollTimer: null,
    activeVideoId: null,
  };

  const STATUS_POLL_INTERVAL_MS = 5000;
  const FINALIZING_POLL_INTERVAL_MS = 3000;
  const FINALIZING_POLL_SLOW_INTERVAL_MS = 10000;
  const FINALIZING_POLL_SLOW_THRESHOLD = 10;

  const dom = {
    form: document.getElementById('sora-generate-form'),
    prompt: document.getElementById('sora-prompt'),
    model: document.getElementById('sora-model'),
    seconds: document.getElementById('sora-seconds'),
    size: document.getElementById('sora-size'),
    category: document.getElementById('sora-category'),
    categoryDatalist: document.getElementById('sora-category-list'),
    inputImage: document.getElementById('sora-input-image'),
    generateBtn: document.getElementById('sora-generate-btn'),
    statusSection: document.getElementById('sora-status'),
    statusLabel: document.getElementById('sora-status-label'),
    statusProgress: document.getElementById('sora-status-progress'),
    statusMessage: document.getElementById('sora-status-message'),
    filterForm: document.getElementById('sora-filter-form'),
    search: document.getElementById('sora-search'),
    filterModel: document.getElementById('sora-filter-model'),
    filterSeconds: document.getElementById('sora-filter-seconds'),
    filterSize: document.getElementById('sora-filter-size'),
    filterCategory: document.getElementById('sora-filter-category'),
    filterRating: document.getElementById('sora-filter-rating'),
    resetFilters: document.getElementById('sora-reset-filters'),
    videoGrid: document.getElementById('sora-video-grid'),
    emptyState: document.getElementById('sora-empty-state'),
    pagination: document.getElementById('sora-pagination'),
    prevPage: document.getElementById('sora-prev'),
    nextPage: document.getElementById('sora-next'),
    pageIndicator: document.getElementById('sora-page-indicator'),
    totalCount: document.getElementById('sora-total-count'),
  };

  function escapeHtml(value) {
    if (!value && value !== 0) return '';
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getOrientationFromSize(size) {
    if (!size) return null;
    const parts = String(size).toLowerCase().split('x');
    if (parts.length !== 2) return null;
    const width = parseInt(parts[0], 10);
    const height = parseInt(parts[1], 10);
    if (Number.isNaN(width) || Number.isNaN(height) || width <= 0 || height <= 0) {
      return null;
    }
    if (height > width) return 'portrait';
    if (width > height) return 'landscape';
    return 'square';
  }

  function encodePromptDataset(prompt) {
    try {
      return encodeURIComponent(prompt || '');
    } catch (_) {
      return '';
    }
  }

  function decodePromptDataset(encodedPrompt) {
    if (!encodedPrompt) return '';
    try {
      return decodeURIComponent(encodedPrompt);
    } catch (_) {
      return encodedPrompt;
    }
  }

  function formatDate(value) {
    if (!value) return '—';
    try {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return '—';
      return date.toLocaleString();
    } catch (_) {
      return '—';
    }
  }

  function clearTimer() {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  }

  function setFormDisabled(disabled) {
    if (!dom.form) return;
    const fields = dom.form.querySelectorAll('input, textarea, select, button');
    fields.forEach((node) => {
      node.disabled = disabled;
    });
  }

  function setStatus(options) {
    if (!dom.statusSection) return;
    const { visible = false, label = '', progress = 0, message = '', tone = 'info' } = options || {};
    if (!visible) {
      dom.statusSection.classList.remove('active');
      dom.statusMessage.classList.remove('text-danger');
      return;
    }
    dom.statusSection.classList.add('active');
    dom.statusLabel.textContent = label;
    const safeProgress = Math.max(0, Math.min(progress || 0, 100));
    dom.statusProgress.style.width = `${safeProgress}%`;
    dom.statusProgress.setAttribute('aria-valuenow', String(Math.round(safeProgress)));
    dom.statusMessage.textContent = message;
    dom.statusMessage.classList.toggle('text-danger', tone === 'error');
  }

  function updateModelDependentFields() {
    const model = dom.model.value;
    const modelConfig = state.config.modelOptions[model] || { seconds: [], sizes: [] };

    const secondsValues = Array.isArray(modelConfig.seconds) ? modelConfig.seconds : [];
    const sizeValues = Array.isArray(modelConfig.sizes) ? modelConfig.sizes : [];

    const previousSeconds = dom.seconds.value;
    dom.seconds.innerHTML = '';
    secondsValues.forEach((sec, index) => {
      const option = document.createElement('option');
      option.value = String(sec);
      option.textContent = `${sec} sec`;
      if (previousSeconds === String(sec) || (index === 0 && !previousSeconds)) {
        option.selected = true;
      }
      dom.seconds.appendChild(option);
    });

    const previousSize = dom.size.value;
    dom.size.innerHTML = '';
    sizeValues.forEach((sz, index) => {
      const option = document.createElement('option');
      option.value = sz;
      option.textContent = sz;
      if (previousSize === sz || (index === 0 && !previousSize)) {
        option.selected = true;
      }
      dom.size.appendChild(option);
    });
  }

  function updateCategoryOptions(list) {
    if (!dom.filterCategory || !dom.categoryDatalist) return;
    const unique = Array.from(new Set(Array.isArray(list) ? list : []));
    state.config.categories = unique;

    const currentFilter = dom.filterCategory.value;
    dom.filterCategory.innerHTML = '';
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = 'All categories';
    dom.filterCategory.appendChild(allOption);
    unique.forEach((cat) => {
      const option = document.createElement('option');
      option.value = cat;
      option.textContent = cat;
      dom.filterCategory.appendChild(option);
    });
    if (currentFilter && unique.includes(currentFilter)) {
      dom.filterCategory.value = currentFilter;
    }

    dom.categoryDatalist.innerHTML = '';
    unique.forEach((cat) => {
      const option = document.createElement('option');
      option.value = cat;
      dom.categoryDatalist.appendChild(option);
    });
  }

  async function refreshCategories() {
    try {
      const response = await fetch('/sora/api/categories', { headers: { 'Accept': 'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      if (data && Array.isArray(data.categories)) {
        updateCategoryOptions(data.categories);
      }
    } catch (error) {
      console.warn('Failed to refresh categories', error);
    }
  }

  function buildRatingButtons(video) {
    const currentRating = Number(video.rating) || 0;
    return [1, 2, 3, 4, 5].map((value) => {
      const active = currentRating === value ? ' active' : '';
      return `<button type="button" data-rating="${value}" class="${active}">${value}</button>`;
    }).join('');
  }

  function renderVideoCard(video) {
    const promptHtml = escapeHtml(video.prompt || '').replace(/\n/g, '<br>');
    const category = video.category ? escapeHtml(video.category) : 'Uncategorized';
    const ratingLabel = state.config.ratingDescriptions[String(video.rating)] || '';
    const ratingText = video.rating ? `${video.rating}${ratingLabel ? ` · ${escapeHtml(ratingLabel)}` : ''}` : 'Not rated';
    const statusText = video.status ? video.status.replace(/_/g, ' ') : 'unknown';
    const progressText = typeof video.progress === 'number' ? `${Math.round(video.progress)}%` : '';
    const orientation = getOrientationFromSize(video.size);
    const orientationClass = orientation ? ` orientation-${orientation}` : '';
    const videoClass = orientation ? ` orientation-${orientation}` : '';
    const preview = video.fileUrl
      ? `<video class="sora-video-player${videoClass}" src="${escapeHtml(video.fileUrl)}" controls preload="metadata"></video>`
      : `<div class="sora-video-placeholder small">Status: ${escapeHtml(statusText)} ${progressText ? `(${escapeHtml(progressText)})` : ''}</div>`;
    const promptDataset = encodePromptDataset(video.prompt || '');
    const promptTitle = escapeHtml((video.prompt || '').replace(/\s+/g, ' ').trim());

    return `
      <article class="sora-video-card" data-video-id="${escapeHtml(video.id)}">
        <div class="sora-video-preview${orientationClass}">
          ${preview}
        </div>
        <div class="sora-video-prompt" role="button" tabindex="0" title="${promptTitle}" data-action="reuse-prompt" data-prompt="${promptDataset}">
          ${promptHtml}
        </div>
        <div class="sora-prompt-hint">Click prompt to reuse</div>
        <div class="sora-video-meta">
          <span><strong>Model:</strong> ${escapeHtml(video.model || '')}</span>
          <span><strong>Length:</strong> ${escapeHtml(video.seconds)} sec · ${escapeHtml(video.size || '')}</span>
          <span><strong>Category:</strong> ${category}</span>
          <span><strong>Status:</strong> ${escapeHtml(statusText)}${progressText ? ` · ${escapeHtml(progressText)}` : ''}</span>
          <span><strong>Started:</strong> ${escapeHtml(formatDate(video.startedAt))}</span>
          <span><strong>Completed:</strong> ${escapeHtml(formatDate(video.completedAt))}</span>
          <span><strong>Rating:</strong> <span class="sora-rating-display">${escapeHtml(ratingText)}</span></span>
        </div>
        <div class="sora-rating" data-video-id="${escapeHtml(video.id)}">
          ${buildRatingButtons(video)}
        </div>
      </article>
    `;
  }

  function renderVideos(items) {
    if (!dom.videoGrid || !dom.emptyState) return;
    if (!items || items.length === 0) {
      dom.videoGrid.innerHTML = '';
      dom.emptyState.style.display = 'block';
      return;
    }
    dom.emptyState.style.display = 'none';
    dom.videoGrid.innerHTML = items.map((video) => renderVideoCard(video)).join('');
  }

  function updatePagination(page, pages) {
    state.pagination.page = page;
    state.pagination.pages = pages;
    if (dom.pageIndicator) {
      dom.pageIndicator.textContent = `${page} / ${pages}`;
    }
    if (dom.prevPage) {
      dom.prevPage.disabled = page <= 1;
    }
    if (dom.nextPage) {
      dom.nextPage.disabled = page >= pages;
    }
  }

  function updateTotalCount(total) {
    if (!dom.totalCount) return;
    const label = total === 1 ? '1 video' : `${total} videos`;
    dom.totalCount.textContent = label;
  }

  function handlePromptReuse(element) {
    if (!element || !dom.prompt) return;
    const promptValue = decodePromptDataset(element.getAttribute('data-prompt') || '');
    if (!promptValue) return;
    dom.prompt.value = promptValue;
    dom.prompt.focus();
    if (typeof dom.prompt.setSelectionRange === 'function') {
      const idx = promptValue.length;
      dom.prompt.setSelectionRange(idx, idx);
    }
    dom.prompt.classList.remove('sora-prompt-flash');
    requestAnimationFrame(() => {
      dom.prompt.classList.add('sora-prompt-flash');
    });
    setTimeout(() => {
      dom.prompt.classList.remove('sora-prompt-flash');
    }, 900);
  }

  async function loadVideos() {
    if (!dom.videoGrid) return;
    const params = new URLSearchParams();
    params.set('page', String(state.filters.page));
    params.set('limit', String(state.filters.limit));
    if (state.filters.search) params.set('search', state.filters.search);
    if (state.filters.model) params.set('model', state.filters.model);
    if (state.filters.seconds) params.set('seconds', state.filters.seconds);
    if (state.filters.size) params.set('size', state.filters.size);
    if (state.filters.category) params.set('category', state.filters.category);
    if (state.filters.rating) params.set('rating', state.filters.rating);
    if (state.filters.includeLowRated) params.set('includeLowRated', 'true');

    dom.emptyState.style.display = 'none';
    try {
      const response = await fetch(`/sora/api/videos?${params.toString()}`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Server responded with ${response.status}`);
      }
      const data = await response.json();
      const items = Array.isArray(data.items) ? data.items : [];
      state.filters.page = data.page || 1;
      updateTotalCount(data.total || 0);
      updatePagination(data.page || 1, data.pages || 1);
      renderVideos(items);
      if (items.length === 0) {
        dom.emptyState.style.display = 'block';
        dom.emptyState.textContent = 'No videos found. Adjust filters to see more results.';
      }
    } catch (error) {
      console.error('Failed to load videos', error);
      dom.videoGrid.innerHTML = '';
      dom.emptyState.textContent = 'Failed to load videos. Please try again.';
      dom.emptyState.style.display = 'block';
    }
  }

  function updateStatusFromVideo(video, options = {}) {
    const status = video.status || 'unknown';
    const progress = typeof video.progress === 'number' ? video.progress : 0;
    const awaitingFile = Boolean(options.awaitingFile);
    let message = 'Processing your request...';
    let tone = 'info';
    if (status === 'completed') {
      message = awaitingFile
        ? 'Finalizing video and syncing to your library...'
        : 'Video ready! Refreshing library.';
    } else if (status === 'failed') {
      message = video.errorMessage ? `Failed: ${video.errorMessage}` : 'Video generation failed.';
      tone = 'error';
    } else if (status === 'queued') {
      message = 'Generation queued.';
    } else if (status === 'in_progress') {
      message = 'Sora is working on it.';
    }
    setStatus({
      visible: true,
      label: `Status: ${status.replace(/_/g, ' ')}`,
      progress,
      message,
      tone,
    });
  }

  async function pollVideoStatus(videoId, finalizeAttempt = 0) {
    clearTimer();
    if (!videoId) return;
    state.activeVideoId = videoId;
    try {
      const response = await fetch(`/sora/api/videos/${videoId}/status`, {
        headers: { 'Accept': 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`Status request failed (${response.status})`);
      }
      const data = await response.json();
      const video = data.video;
      if (!video) {
        throw new Error('Malformed status response');
      }
      const awaitingFile = video.status === 'completed' && !video.fileUrl;
      const readyForLibrary = video.status === 'completed' && Boolean(video.fileUrl);
      updateStatusFromVideo(video, { awaitingFile });
      if (readyForLibrary) {
        await loadVideos();
        await refreshCategories();
        setFormDisabled(false);
        setTimeout(() => setStatus({ visible: false }), 3500);
        return;
      }
      if (awaitingFile) {
        setFormDisabled(false);
        const nextAttempt = finalizeAttempt + 1;
        const delay = nextAttempt > FINALIZING_POLL_SLOW_THRESHOLD
          ? FINALIZING_POLL_SLOW_INTERVAL_MS
          : FINALIZING_POLL_INTERVAL_MS;
        state.pollTimer = setTimeout(() => pollVideoStatus(videoId, nextAttempt), delay);
        return;
      }
      if (video.status === 'failed') {
        setFormDisabled(false);
        return;
      }
      state.pollTimer = setTimeout(() => pollVideoStatus(videoId), STATUS_POLL_INTERVAL_MS);
    } catch (error) {
      console.warn('Status polling failed', error);
      setStatus({
        visible: true,
        label: 'Status check failed',
        progress: 0,
        message: 'Retrying status check shortly...',
        tone: 'error',
      });
      state.pollTimer = setTimeout(() => pollVideoStatus(videoId), 7000);
    }
  }

  async function handleGenerationSubmit(event) {
    event.preventDefault();
    const promptValue = dom.prompt.value.trim();
    const modelValue = dom.model.value;
    const secondsValue = dom.seconds.value;
    const sizeValue = dom.size.value;
    const categoryValue = dom.category.value.trim();

    if (!promptValue) {
      setStatus({
        visible: true,
        label: 'Validation error',
        progress: 0,
        message: 'Prompt is required.',
        tone: 'error',
      });
      return;
    }

    const formData = new FormData();
    formData.append('prompt', promptValue);
    formData.append('model', modelValue);
    formData.append('seconds', secondsValue);
    formData.append('size', sizeValue);
    formData.append('category', categoryValue);
    const hasReferenceImage = dom.inputImage && dom.inputImage.files && dom.inputImage.files.length > 0;
    if (hasReferenceImage) {
      formData.append('inputImage', dom.inputImage.files[0]);
    }

    setFormDisabled(true);
    setStatus({
      visible: true,
      label: 'Submitting request',
      progress: 5,
      message: 'Sending video request to Sora...',
    });

    try {
      const response = await fetch('/sora/api/videos', {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody.error || 'Generation request failed');
      }
      const data = await response.json();
      const video = data.video;
      if (!video) {
        throw new Error('Unexpected response from server');
      }
      dom.category.value = '';
      dom.prompt.value = '';
      updateStatusFromVideo(video);
      pollVideoStatus(video.id);
    } catch (error) {
      console.error('Failed to start generation', error);
      setFormDisabled(false);
      setStatus({
        visible: true,
        label: 'Request failed',
        progress: 0,
        message: error.message || 'Unable to start generation.',
        tone: 'error',
      });
    }
  }

  function resetFilters() {
    state.filters = Object.assign({}, state.filters, {
      page: 1,
      search: '',
      model: '',
      seconds: '',
      size: '',
      category: '',
      rating: '',
      includeLowRated: false,
    });
    dom.search.value = '';
    dom.filterModel.value = '';
    dom.filterSeconds.value = '';
    dom.filterSize.value = '';
    dom.filterCategory.value = '';
    dom.filterRating.value = '';
    loadVideos();
  }

  async function updateRating(videoId, rating) {
    if (!videoId || !rating) return;
    try {
      const response = await fetch(`/sora/api/videos/${videoId}/rating`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Rating update failed');
      }
      await loadVideos();
    } catch (error) {
      console.error('Rating update error', error);
      setStatus({
        visible: true,
        label: 'Rating failed',
        progress: 0,
        message: error.message || 'Unable to update rating.',
        tone: 'error',
      });
    }
  }

  function wireEventListeners() {
    if (dom.model) {
      dom.model.addEventListener('change', updateModelDependentFields);
    }
    if (dom.form) {
      dom.form.addEventListener('submit', handleGenerationSubmit);
    }
    let searchTimer = null;
    if (dom.search) {
      dom.search.addEventListener('input', () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.filters.search = dom.search.value.trim();
          state.filters.page = 1;
          loadVideos();
        }, 300);
      });
    }
    if (dom.filterModel) {
      dom.filterModel.addEventListener('change', () => {
        state.filters.model = dom.filterModel.value;
        state.filters.page = 1;
        loadVideos();
      });
    }
    if (dom.filterSeconds) {
      dom.filterSeconds.addEventListener('change', () => {
        state.filters.seconds = dom.filterSeconds.value;
        state.filters.page = 1;
        loadVideos();
      });
    }
    if (dom.filterSize) {
      dom.filterSize.addEventListener('change', () => {
        state.filters.size = dom.filterSize.value;
        state.filters.page = 1;
        loadVideos();
      });
    }
    if (dom.filterCategory) {
      dom.filterCategory.addEventListener('change', () => {
        state.filters.category = dom.filterCategory.value;
        state.filters.page = 1;
        loadVideos();
      });
    }
    if (dom.filterRating) {
      dom.filterRating.addEventListener('change', () => {
        state.filters.rating = dom.filterRating.value;
        state.filters.includeLowRated = dom.filterRating.value === 'all';
        state.filters.page = 1;
        loadVideos();
      });
    }
    if (dom.resetFilters) {
      dom.resetFilters.addEventListener('click', resetFilters);
    }
    if (dom.prevPage) {
      dom.prevPage.addEventListener('click', () => {
        if (state.pagination.page > 1) {
          state.filters.page = state.pagination.page - 1;
          loadVideos();
        }
      });
    }
    if (dom.nextPage) {
      dom.nextPage.addEventListener('click', () => {
        if (state.pagination.page < state.pagination.pages) {
          state.filters.page = state.pagination.page + 1;
          loadVideos();
        }
      });
    }
    if (dom.videoGrid) {
      dom.videoGrid.addEventListener('click', (event) => {
        const promptEl = event.target.closest('.sora-video-prompt');
        if (promptEl) {
          handlePromptReuse(promptEl);
          return;
        }
        const button = event.target.closest('.sora-rating button');
        if (!button) return;
        const wrapper = button.closest('.sora-rating');
        if (!wrapper) return;
        const videoId = wrapper.getAttribute('data-video-id');
        const rating = parseInt(button.getAttribute('data-rating'), 10);
        if (!videoId || Number.isNaN(rating)) return;
        updateRating(videoId, rating);
      });
      dom.videoGrid.addEventListener('keydown', (event) => {
        if (!(event.key === 'Enter' || event.key === ' ')) return;
        const promptEl = event.target.closest('.sora-video-prompt');
        if (!promptEl) return;
        event.preventDefault();
        handlePromptReuse(promptEl);
      });
    }
  }

  function init() {
    updateModelDependentFields();
    updateCategoryOptions(state.config.categories || []);
    wireEventListeners();
    loadVideos();
  }

  init();
})();
