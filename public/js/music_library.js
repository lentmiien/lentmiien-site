(() => {
  const ratingLabels = {
    0: 'Delete',
    1: 'Bad',
    2: 'OK',
    3: 'Good',
    4: 'Great',
    5: 'Awesome',
  };

  const state = {
    library: [],
    libraryMap: new Map(),
    currentTrack: null,
    infinity: false,
    pollers: new Map(),
    backgroundJobId: null,
    lastBackgroundStart: 0,
  };

  const feedbackEl = document.getElementById('music-feedback');
  const generateForm = document.getElementById('music-generate-form');
  const aiForm = document.getElementById('music-ai-form');
  const aiDirectionInput = document.getElementById('ai-direction');
  const jobStatusEl = document.getElementById('music-job-status');
  const jobErrorEl = document.getElementById('music-job-error');
  const jobInfoEl = document.getElementById('music-job-info');
  const nowTitleEl = document.getElementById('music-now-title');
  const nowAudioEl = document.getElementById('music-now-audio');
  const nowRatingSelect = document.getElementById('music-now-rating');
  const nowRatingBtn = document.getElementById('music-now-rate-btn');
  const nowMetaEl = document.getElementById('music-now-meta');
  const libraryListEl = document.getElementById('music-library-list');
  const infinityToggle = document.getElementById('infinity-toggle');
  const infinityMinRating = document.getElementById('infinity-min-rating');
  const infinityIncludeUnrated = document.getElementById('infinity-include-unrated');
  const infinityNextBtn = document.getElementById('infinity-next-btn');
  const infinityStatusEl = document.getElementById('infinity-status');

  function parseJsonFromScript(id, fallback) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.textContent || el.innerText || '');
    } catch (error) {
      return fallback;
    }
  }

  function escapeHtml(value) {
    const str = String(value ?? '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function ratingLabel(value) {
    const num = Number.isFinite(value) ? value : null;
    if (num === null) return 'Unrated';
    return `${num} - ${ratingLabels[num] || 'Unknown'}`;
  }

  function setFeedback(message, type = 'info') {
    if (!feedbackEl) return;
    if (!message) {
      feedbackEl.classList.add('d-none');
      feedbackEl.textContent = '';
      return;
    }
    feedbackEl.textContent = message;
    feedbackEl.classList.remove('d-none');
    feedbackEl.classList.remove('alert-success', 'alert-danger', 'alert-warning', 'alert-info');
    feedbackEl.classList.add(`alert-${type}`);
  }

  function setJobStatus(status, error, info) {
    if (jobStatusEl) {
      jobStatusEl.textContent = status || 'Idle';
    }
    if (jobErrorEl) {
      if (error) {
        jobErrorEl.textContent = error;
        jobErrorEl.classList.remove('d-none');
      } else {
        jobErrorEl.textContent = '';
        jobErrorEl.classList.add('d-none');
      }
    }
    if (jobInfoEl) {
      jobInfoEl.textContent = info || '';
    }
  }

  function updateInfinityStatus(message) {
    if (infinityStatusEl) {
      infinityStatusEl.textContent = message;
    }
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (error) {
      return {};
    }
  }

  function initializeLibrary(items) {
    if (!Array.isArray(items)) return;
    state.library = items.slice();
    state.libraryMap.clear();
    items.forEach((item) => {
      if (item && item.id) {
        state.libraryMap.set(item.id, item);
      }
    });
  }

  function renderLibraryEntry(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'border rounded-3 p-3 mb-3 music-library-entry';
    wrapper.dataset.id = entry.id || '';
    wrapper.dataset.viewUrl = entry.viewUrl || '';

    const durationLabel = entry.durationSec ? `${entry.durationSec}s` : 'auto';
    const lastPlayedLabel = entry.lastPlayedAt
      ? new Date(entry.lastPlayedAt).toLocaleString('en-US')
      : 'Never';

    const ratingText = ratingLabel(entry.rating);
    const aiBadge = entry.promptSource === 'ai'
      ? '<span class="badge text-bg-light text-secondary ms-2">AI</span>'
      : '';

    const audioHtml = entry.viewUrl
      ? `<audio controls preload="none" class="w-100 mb-2" src="${escapeHtml(entry.viewUrl)}"></audio>`
      : '';

    const sizeLabel = entry.outputSizeLabel
      ? `<span class="text-muted small">${escapeHtml(entry.outputSizeLabel)}</span>`
      : '';

    wrapper.innerHTML = `
      <div class="d-flex justify-content-between align-items-start mb-2">
        <div class="me-3">
          <strong>${escapeHtml(entry.caption || entry.outputName || 'Untitled')}</strong>
          ${aiBadge}
        </div>
        <span class="badge text-bg-secondary">${escapeHtml(ratingText)}</span>
      </div>
      ${audioHtml}
      <p class="text-muted small mb-2">Duration: ${escapeHtml(durationLabel)} · Vocal: ${escapeHtml(entry.vocalLanguage || 'unknown')} · Last played: ${escapeHtml(lastPlayedLabel)}</p>
      <div class="d-flex flex-wrap align-items-center gap-2">
        <select class="form-select form-select-sm w-auto" data-rating-select="${escapeHtml(entry.id)}">
          <option value="">Set rating...</option>
          ${Object.keys(ratingLabels).map((value) => {
            const label = ratingLabels[value];
            const selected = Number.isFinite(entry.rating) && Number(entry.rating) === Number(value) ? 'selected' : '';
            return `<option value="${escapeHtml(value)}" ${selected}>${escapeHtml(value)} - ${escapeHtml(label)}</option>`;
          }).join('')}
        </select>
        ${sizeLabel}
      </div>
    `;
    return wrapper;
  }

  function upsertLibraryItem(item, { prepend = false } = {}) {
    if (!item || !item.id) return;
    state.libraryMap.set(item.id, item);
    const existing = libraryListEl ? libraryListEl.querySelector(`[data-id="${item.id}"]`) : null;
    const entryEl = renderLibraryEntry(item);
    if (existing && existing.parentNode) {
      existing.parentNode.replaceChild(entryEl, existing);
    } else if (libraryListEl) {
      const emptyEl = document.getElementById('music-library-empty');
      if (emptyEl) emptyEl.remove();
      if (prepend) {
        libraryListEl.prepend(entryEl);
      } else {
        libraryListEl.appendChild(entryEl);
      }
    }

    const existingIndex = state.library.findIndex((entry) => entry && entry.id === item.id);
    if (existingIndex >= 0) {
      state.library[existingIndex] = item;
    } else if (prepend) {
      state.library.unshift(item);
    } else {
      state.library.push(item);
    }
  }

  function removeLibraryItem(id) {
    state.library = state.library.filter((entry) => entry && entry.id !== id);
    state.libraryMap.delete(id);
    if (libraryListEl) {
      const existing = libraryListEl.querySelector(`[data-id="${id}"]`);
      if (existing) existing.remove();
      if (!state.library.length && !document.getElementById('music-library-empty')) {
        const empty = document.createElement('p');
        empty.id = 'music-library-empty';
        empty.className = 'text-muted mb-0';
        empty.textContent = 'No music saved yet.';
        libraryListEl.appendChild(empty);
      }
    }
  }

  function updateNowPlaying(track) {
    if (!track) {
      state.currentTrack = null;
      if (nowTitleEl) nowTitleEl.textContent = 'No track selected yet.';
      if (nowAudioEl) nowAudioEl.removeAttribute('src');
      if (nowRatingSelect) nowRatingSelect.value = '';
      if (nowMetaEl) nowMetaEl.textContent = '';
      return;
    }

    state.currentTrack = track;
    if (nowTitleEl) nowTitleEl.textContent = track.caption || track.outputName || 'Untitled track';
    if (nowAudioEl) {
      nowAudioEl.src = track.viewUrl || '';
      nowAudioEl.dataset.trackId = track.id || '';
    }
    if (nowRatingSelect) {
      nowRatingSelect.value = Number.isFinite(track.rating) ? String(track.rating) : '';
    }
    if (nowMetaEl) {
      const durationLabel = track.durationSec ? `${track.durationSec}s` : 'auto';
      nowMetaEl.textContent = `Rating: ${ratingLabel(track.rating)} · Duration: ${durationLabel} · Vocal: ${track.vocalLanguage || 'unknown'}`;
    }
  }

  async function playTrack(track, { autoplay = false } = {}) {
    updateNowPlaying(track);
    if (!track || !nowAudioEl) return;
    const sourceUrl = track.viewUrl || '';
    if (sourceUrl) {
      nowAudioEl.src = sourceUrl;
      nowAudioEl.load();
    }
    if (autoplay) {
      try {
        await nowAudioEl.play();
      } catch (error) {
        setFeedback('Autoplay blocked. Click play to start audio.', 'warning');
      }
    }
  }

  async function markPlayed(id, { updateUi = false } = {}) {
    if (!id) return;
    try {
      const response = await fetch(`/music/library/${id}/played`, { method: 'POST' });
      if (!response.ok) return;
      if (!updateUi) return;
      const data = await readJsonResponse(response);
      if (data.item) {
        upsertLibraryItem(data.item);
        if (state.currentTrack && state.currentTrack.id === data.item.id) {
          updateNowPlaying(data.item);
        }
      }
    } catch (error) {
      // ignore
    }
  }

  async function applyRating(id, rating) {
    if (!id) return;
    try {
      const response = await fetch(`/music/library/${id}/rating`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data.error || 'Unable to update rating.');
      }
      if (data.deleted) {
        removeLibraryItem(id);
        if (state.currentTrack && state.currentTrack.id === id) {
          updateNowPlaying(null);
          if (state.infinity) {
            playNextInfinityTrack();
          }
        }
        return;
      }
      if (data.item) {
        upsertLibraryItem(data.item);
        if (state.currentTrack && state.currentTrack.id === data.item.id) {
          updateNowPlaying(data.item);
        }
      }
    } catch (error) {
      setFeedback(error.message || 'Unable to update rating.', 'danger');
    }
  }

  function buildRandomQuery() {
    const minRating = infinityMinRating ? infinityMinRating.value : '0';
    const includeUnrated = infinityIncludeUnrated && infinityIncludeUnrated.checked;
    const url = new URL('/music/library/random', window.location.origin);
    url.searchParams.set('minRating', minRating);
    if (includeUnrated) {
      url.searchParams.set('includeUnrated', '1');
    }
    return url.toString();
  }

  async function fetchRandomTrack() {
    const response = await fetch(buildRandomQuery());
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || 'Unable to fetch random track.');
    }
    return data.item || null;
  }

  async function playNextInfinityTrack() {
    if (!state.infinity) return;
    updateInfinityStatus('Selecting next track...');
    try {
      const track = await fetchRandomTrack();
      if (!track) throw new Error('No track returned.');
      await playTrack(track, { autoplay: true });
      updateInfinityStatus('Playing random track.');
      maybeStartBackgroundGeneration();
    } catch (error) {
      updateInfinityStatus(error.message || 'Unable to play random track.');
    }
  }

  function startInfinity() {
    state.infinity = true;
    updateInfinityStatus('Infinity player active.');
    if (!state.currentTrack || (nowAudioEl && nowAudioEl.paused)) {
      playNextInfinityTrack();
    }
    maybeStartBackgroundGeneration();
  }

  function stopInfinity() {
    state.infinity = false;
    updateInfinityStatus('Infinity player idle.');
    if (nowAudioEl) {
      nowAudioEl.pause();
    }
  }

  function clearPoller(jobId) {
    const timer = state.pollers.get(jobId);
    if (timer) {
      clearInterval(timer);
      state.pollers.delete(jobId);
    }
  }

  function startPolling(jobId, { showStatus, kind }) {
    if (!jobId || state.pollers.has(jobId)) return;
    const poll = async () => {
      try {
        const response = await fetch(`/music/status/${jobId}`);
        const data = await readJsonResponse(response);
        if (response.status === 404) {
          if (showStatus) setJobStatus('not_found', 'Job not found or expired.');
          clearPoller(jobId);
          return;
        }
        if (!response.ok) return;
        if (showStatus) {
          setJobStatus(data.status || 'unknown', data.error || data.outputsError || '', data.status === 'completed' ? 'Job completed.' : '');
        }
        if (data.status === 'completed') {
          clearPoller(jobId);
          handleJobCompleted(jobId, data, { kind, showStatus });
        } else if (data.status === 'failed') {
          clearPoller(jobId);
          if (showStatus) setJobStatus('failed', data.error || 'Job failed.');
          if (kind === 'background') {
            state.backgroundJobId = null;
          }
        }
      } catch (error) {
        // ignore transient errors
      }
    };

    const timer = setInterval(poll, 3000);
    state.pollers.set(jobId, timer);
    poll();
  }

  function handleJobCompleted(jobId, data, { kind }) {
    if (kind === 'background' && state.backgroundJobId === jobId) {
      state.backgroundJobId = null;
    }

    const savedItems = Array.isArray(data.saved) ? data.saved : [];
    savedItems.slice().reverse().forEach((item) => {
      upsertLibraryItem(item, { prepend: true });
    });

    if (kind !== 'background' && !state.infinity && savedItems.length > 0) {
      playTrack(savedItems[0], { autoplay: true });
    }

    if (state.infinity) {
      maybeStartBackgroundGeneration();
    }
  }

  async function submitForm(form, url, { kind, showStatus, background = false } = {}) {
    const formData = new FormData(form);
    if (background) {
      formData.set('background', '1');
    }
    const body = new URLSearchParams(formData);
    const response = await fetch(url, {
      method: 'POST',
      body,
    });
    const data = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || 'Request failed.');
    }
    if (data.skipped) {
      if (background && data.reason) {
        updateInfinityStatus(data.reason);
      }
      if (showStatus && data.reason) {
        setJobStatus('idle', '', data.reason);
      }
      return null;
    }
    if (data.ai && kind !== 'background') {
      applyAiToForm(data.ai);
    }
    if (data.job && data.job.id) {
      if (showStatus) {
        setJobStatus(data.job.status || 'queued', '', 'Job queued.');
      }
      if (kind === 'background') {
        state.backgroundJobId = data.job.id;
      }
      startPolling(data.job.id, { showStatus, kind });
    }
    return data;
  }

  function applyAiToForm(ai) {
    if (!ai) return;
    const captionEl = document.getElementById('caption');
    const lyricsEl = document.getElementById('lyrics');
    const vocalEl = document.getElementById('vocal_language');
    const durationEl = document.getElementById('duration');

    if (captionEl) captionEl.value = ai.caption || '';
    if (lyricsEl) lyricsEl.value = ai.lyrics || '';
    if (vocalEl) vocalEl.value = ai.vocalLanguage || 'unknown';
    if (durationEl && Number.isFinite(ai.durationSec)) durationEl.value = ai.durationSec;
  }

  function maybeStartBackgroundGeneration() {
    if (!state.infinity) return;
    if (state.backgroundJobId) return;
    const now = Date.now();
    if (now - state.lastBackgroundStart < 15000) return;
    state.lastBackgroundStart = now;
    if (!aiForm) return;
    submitForm(aiForm, aiForm.action, { kind: 'background', showStatus: false, background: true })
      .then((data) => {
        if (!data || data.skipped) {
          state.backgroundJobId = null;
        }
      })
      .catch((error) => {
        state.backgroundJobId = null;
        updateInfinityStatus(error.message || 'Background generation failed.');
      });
  }

  function handleLibraryRatingChange(event) {
    const select = event.target.closest('[data-rating-select]');
    if (!select) return;
    const id = select.getAttribute('data-rating-select');
    const ratingRaw = select.value;
    if (!ratingRaw) return;
    const rating = Number.parseInt(ratingRaw, 10);
    if (!Number.isFinite(rating)) return;
    applyRating(id, rating);
  }

  function handleNowRatingSave() {
    if (!state.currentTrack || !nowRatingSelect) return;
    const ratingRaw = nowRatingSelect.value;
    if (!ratingRaw) return;
    const rating = Number.parseInt(ratingRaw, 10);
    if (!Number.isFinite(rating)) return;
    applyRating(state.currentTrack.id, rating);
  }

  function attachEventListeners() {
    if (generateForm) {
      generateForm.addEventListener('submit', (event) => {
        event.preventDefault();
        setFeedback('Submitting music generation...', 'info');
        submitForm(generateForm, generateForm.action, { kind: 'manual', showStatus: true })
          .then(() => setFeedback('Generation queued.', 'success'))
          .catch((error) => setFeedback(error.message || 'Unable to generate music.', 'danger'));
      });
    }

    if (aiForm) {
      aiForm.addEventListener('submit', (event) => {
        event.preventDefault();
        setFeedback('Generating AI prompt...', 'info');
        submitForm(aiForm, aiForm.action, { kind: 'ai', showStatus: true })
          .then(() => setFeedback('AI generation queued.', 'success'))
          .catch((error) => setFeedback(error.message || 'Unable to generate AI prompt.', 'danger'));
      });
    }

    if (libraryListEl) {
      libraryListEl.addEventListener('change', handleLibraryRatingChange);
      libraryListEl.addEventListener('play', (event) => {
        const target = event.target;
        if (!target || target.tagName !== 'AUDIO') return;
        const entry = target.closest('.music-library-entry');
        const id = entry ? entry.dataset.id : null;
        if (id) markPlayed(id, { updateUi: false });
      }, true);
    }

    if (nowRatingBtn) {
      nowRatingBtn.addEventListener('click', handleNowRatingSave);
    }

    if (nowAudioEl) {
      nowAudioEl.addEventListener('play', () => {
        if (state.currentTrack && state.currentTrack.id) {
          markPlayed(state.currentTrack.id, { updateUi: false });
        }
      });
      nowAudioEl.addEventListener('ended', () => {
        if (state.infinity) {
          playNextInfinityTrack();
        }
      });
    }

    if (infinityToggle) {
      infinityToggle.addEventListener('change', () => {
        if (infinityToggle.checked) {
          startInfinity();
        } else {
          stopInfinity();
        }
      });
    }

    if (infinityNextBtn) {
      infinityNextBtn.addEventListener('click', () => {
        if (!state.infinity) {
          infinityToggle.checked = true;
          startInfinity();
        } else {
          playNextInfinityTrack();
        }
      });
    }
  }

  const libraryData = parseJsonFromScript('music-library-data', []);
  initializeLibrary(libraryData);

  const defaults = parseJsonFromScript('music-defaults', {});
  if (defaults && typeof defaults.includeUnrated === 'boolean' && infinityIncludeUnrated) {
    infinityIncludeUnrated.checked = defaults.includeUnrated;
  }
  if (defaults && Number.isFinite(defaults.minRating) && infinityMinRating) {
    infinityMinRating.value = String(defaults.minRating);
  }

  attachEventListeners();
})();
