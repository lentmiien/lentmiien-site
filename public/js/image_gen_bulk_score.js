// public/js/image_gen_bulk_score.js
(function(){
  const root = document.getElementById('scoreRoot');
  if (!root) return;
  const jobId = root.dataset.jobId;
  if (!jobId) return;

  const leftCard = document.getElementById('leftCard');
  const rightCard = document.getElementById('rightCard');
  const leftMedia = document.getElementById('leftMedia');
  const rightMedia = document.getElementById('rightMedia');
  const leftMeta = document.getElementById('leftMeta');
  const rightMeta = document.getElementById('rightMeta');
  const voteLeftBtn = document.getElementById('voteLeftBtn');
  const voteRightBtn = document.getElementById('voteRightBtn');
  const voteTieBtn = document.getElementById('voteTieBtn');
  const skipBtn = document.getElementById('skipBtn');
  const nextPairBtn = document.getElementById('nextPairBtn');
  const statusEl = document.getElementById('scoreStatus');

  let currentPair = null;

  function detectMediaTypeFromName(name) {
    const lower = String(name || '').toLowerCase();
    if (lower.endsWith('.mp4') || lower.endsWith('.webm') || lower.endsWith('.mov') || lower.endsWith('.mkv') || lower.endsWith('.m4v')) return 'video';
    if (lower.endsWith('.gif')) return 'gif';
    return 'image';
  }

  function createMediaElement(data) {
    const filename = data?.filename || '';
    const mediaType = (data?.media_type || detectMediaTypeFromName(filename)).toLowerCase();
    const src = data?.cached_url || data?.download_url || data?.file_url || '';
    let el;
    if (mediaType === 'video') {
      el = document.createElement('video');
      el.controls = true;
      el.preload = 'metadata';
      el.playsInline = true;
      el.muted = true;
    } else {
      el = document.createElement('img');
      el.alt = filename || 'Preview';
    }
    el.className = 'score-media-el';
    if (src) {
      el.src = src;
    } else {
      el.classList.add('score-media-empty');
    }
    return { element: el, mediaType };
  }

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

  function setStatus(message, tone = 'soft') {
    statusEl.textContent = message;
    statusEl.className = `status-note text-${tone}`;
  }

  function renderSide(card, mediaWrap, metaEl, data, side) {
    if (!data) {
      mediaWrap.innerHTML = '<div class="score-media-placeholder">No preview yet</div>';
      metaEl.textContent = 'No media available';
      card.classList.add('disabled');
      return;
    }
    card.classList.remove('disabled');
    mediaWrap.innerHTML = '';
    const { element, mediaType } = createMediaElement(data);
    mediaWrap.appendChild(element);

    const avg = (data.score_average || 0).toFixed(2);
    const count = data.score_count || 0;
    const vars = data.variables || {};
    const lines = [];
    if (mediaType === 'video') lines.push('Output: Video');
    if (data.template_label) lines.push(`Template: ${data.template_label}`);
    if (data.negative_used !== undefined) {
      lines.push(data.negative_used ? 'With negative prompt' : 'No negative prompt');
    }
    Object.entries(vars).forEach(([key, value]) => {
      lines.push(`${formatVariableKey(key)}: ${value}`);
    });
    lines.push(`Avg score: ${avg} (${count} vote${count === 1 ? '' : 's'})`);
    metaEl.innerHTML = lines.map(line => `<div>${escapeHtml(line)}</div>`).join('');
  }

  function formatVariableKey(key) {
    if (key === 'template') return 'Template';
    if (key === 'negative') return 'Negative';
    if (key.startsWith('placeholder:')) return `Placeholder ${key.slice('placeholder:'.length)}`;
    return key;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[m]));
  }

  async function loadPair() {
    try {
      setStatus('Loading pair…', 'soft');
      disableButtons(true);
      const data = await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}/score-pair`);
      currentPair = data.pair || null;
      if (!currentPair || currentPair.length < 2) {
      renderSide(leftCard, leftMedia, leftMeta, null, 'left');
      renderSide(rightCard, rightMedia, rightMeta, null, 'right');
      setStatus('Not enough completed images to score yet.', 'warning');
      return;
    }
    renderSide(leftCard, leftMedia, leftMeta, currentPair[0], 'left');
    renderSide(rightCard, rightMedia, rightMeta, currentPair[1], 'right');
      setStatus('Choose which output you prefer.', 'soft');
    } catch (err) {
      setStatus(`Failed to load pair: ${err.message}`, 'danger');
      currentPair = null;
    } finally {
      disableButtons(false);
    }
  }

  async function vote(winner) {
    if (!currentPair || currentPair.length < 2) return;
    try {
      disableButtons(true);
      setStatus('Submitting vote…', 'soft');
      await api(`/api/bulk/jobs/${encodeURIComponent(jobId)}/score`, {
        method: 'POST',
        body: JSON.stringify({
          left_id: currentPair[0].id,
          right_id: currentPair[1].id,
          winner
        })
      });
      setStatus('Vote recorded. Loading next pair…', 'success');
      await loadPair();
    } catch (err) {
      setStatus(`Failed to submit vote: ${err.message}`, 'danger');
    } finally {
      disableButtons(false);
    }
  }

  function disableButtons(disabled) {
    [voteLeftBtn, voteRightBtn, voteTieBtn, skipBtn, nextPairBtn].forEach(btn => {
      if (!btn) return;
      btn.disabled = disabled;
    });
  }

  voteLeftBtn?.addEventListener('click', () => vote('left'));
  voteRightBtn?.addEventListener('click', () => vote('right'));
  voteTieBtn?.addEventListener('click', () => vote('tie'));
  skipBtn?.addEventListener('click', () => loadPair());
  nextPairBtn?.addEventListener('click', () => loadPair());

  loadPair();
})();

