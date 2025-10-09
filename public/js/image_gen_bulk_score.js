// public/js/image_gen_bulk_score.js
(function(){
  const root = document.getElementById('scoreRoot');
  if (!root) return;
  const jobId = root.dataset.jobId;
  if (!jobId) return;

  const leftCard = document.getElementById('leftCard');
  const rightCard = document.getElementById('rightCard');
  const leftImage = document.getElementById('leftImage');
  const rightImage = document.getElementById('rightImage');
  const leftMeta = document.getElementById('leftMeta');
  const rightMeta = document.getElementById('rightMeta');
  const voteLeftBtn = document.getElementById('voteLeftBtn');
  const voteRightBtn = document.getElementById('voteRightBtn');
  const voteTieBtn = document.getElementById('voteTieBtn');
  const skipBtn = document.getElementById('skipBtn');
  const nextPairBtn = document.getElementById('nextPairBtn');
  const statusEl = document.getElementById('scoreStatus');

  let currentPair = null;

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

  function renderSide(card, imageEl, metaEl, data, side) {
    if (!data) {
      imageEl.src = '';
      imageEl.alt = 'No preview';
      imageEl.style.opacity = '0.2';
      metaEl.textContent = 'No image available';
      card.classList.add('disabled');
      return;
    }
    card.classList.remove('disabled');
    imageEl.style.opacity = '1';
    if (data.file_url) {
      imageEl.src = data.file_url;
      imageEl.alt = data.filename || `${side} preview`;
    } else {
      imageEl.removeAttribute('src');
      imageEl.alt = 'No image';
      imageEl.style.opacity = '0.3';
    }
    const avg = (data.score_average || 0).toFixed(2);
    const count = data.score_count || 0;
    const vars = data.variables || {};
    const lines = [];
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
        renderSide(leftCard, leftImage, leftMeta, null, 'left');
        renderSide(rightCard, rightImage, rightMeta, null, 'right');
        setStatus('Not enough completed images to score yet.', 'warning');
        return;
      }
      renderSide(leftCard, leftImage, leftMeta, currentPair[0], 'left');
      renderSide(rightCard, rightImage, rightMeta, currentPair[1], 'right');
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

