(function(){
  const grid = document.getElementById('goodGrid');
  const pinnedArea = document.getElementById('pinnedArea');
  const summaryEl = document.getElementById('goodSummary');
  const pageLabel = document.getElementById('goodPageLabel');
  const prevBtn = document.getElementById('goodPrev');
  const nextBtn = document.getElementById('goodNext');
  const totalBadge = document.getElementById('goodTotal');

  const state = {
    page: 1,
    totalPages: 1,
    totalItems: 0,
    limit: 16,
    pinnedId: (window.goodImagePageConfig && window.goodImagePageConfig.pinnedId) || null
  };

  function formatDate(value) {
    if (!value) return '';
    try {
      const d = new Date(value);
      if (Number.isNaN(d.getTime())) return '';
      return d.toLocaleString();
    } catch (_) {
      return '';
    }
  }

  function renderCard(item, pinned = false) {
    if (!item) return null;
    const col = document.createElement('div');
    col.className = 'col';
    const card = document.createElement('div');
    card.className = 'good-card';
    if (pinned) card.classList.add('pinned');

    const img = document.createElement('img');
    img.className = 'good-thumb';
    img.loading = 'lazy';
    img.alt = item.original_filename || item.filename || 'saved image';
    img.src = item.public_url || item.cached_url || item.download_url || '';
    card.appendChild(img);

    const meta = document.createElement('div');
    meta.className = 'meta mt-2';
    const rating = item.rating_value ? `Rated ${item.rating_value}` : 'Rated';
    const model = item.model ? ` • ${item.model}` : '';
    const workflow = item.workflow ? ` • ${item.workflow}` : '';
    meta.textContent = `${rating}${model}${workflow}`;
    card.appendChild(meta);

    if (item.prompt) {
      const prompt = document.createElement('div');
      prompt.className = 'prompt mt-1';
      prompt.textContent = item.prompt;
      card.appendChild(prompt);
    }

    const detail = document.createElement('div');
    detail.className = 'meta mt-auto';
    const created = formatDate(item.created_at);
    const instance = item.instance_id ? ` • inst ${item.instance_id}` : '';
    detail.textContent = `${created}${instance}`;
    card.appendChild(detail);

    col.appendChild(card);
    return col;
  }

  function renderPinned(pinned) {
    if (!pinnedArea) return;
    pinnedArea.innerHTML = '';
    if (!pinned) return;
    const title = document.createElement('div');
    title.className = 'text-muted mb-2';
    title.textContent = 'Pinned';
    const card = renderCard(pinned, true);
    if (card) {
      const row = document.createElement('div');
      row.className = 'row row-cols-1';
      row.appendChild(card);
      pinnedArea.appendChild(title);
      pinnedArea.appendChild(row);
    }
  }

  function renderItems(items) {
    if (!grid) return;
    grid.innerHTML = '';
    if (!items || !items.length) {
      grid.innerHTML = '<div class="text-muted">No saved images yet.</div>';
      return;
    }
    items.forEach((item) => {
      const card = renderCard(item);
      if (card) grid.appendChild(card);
    });
  }

  function updatePagination() {
    if (pageLabel) pageLabel.textContent = `Page ${state.page} of ${state.totalPages}`;
    if (prevBtn) prevBtn.disabled = state.page <= 1;
    if (nextBtn) nextBtn.disabled = state.page >= state.totalPages;
    if (summaryEl) {
      const start = (state.page - 1) * state.limit + 1;
      const end = Math.min(state.page * state.limit, state.totalItems);
      summaryEl.textContent = state.totalItems ? `Showing ${start}-${end} of ${state.totalItems}` : 'Nothing saved yet.';
    }
    if (totalBadge) totalBadge.textContent = state.totalItems;
  }

  async function load(page = 1) {
    if (summaryEl) summaryEl.textContent = 'Loading…';
    try {
      const params = new URLSearchParams({ page, limit: state.limit });
      if (state.pinnedId) params.set('pinned_id', state.pinnedId);
      const resp = await fetch(`/image_gen/api/good-images?${params.toString()}`);
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        throw new Error(txt || `${resp.status} ${resp.statusText}`);
      }
      const data = await resp.json();
      state.page = data.page || 1;
      state.totalPages = data.total_pages || 1;
      state.totalItems = data.total_items || 0;
      renderPinned(data.pinned);
      renderItems(data.items || []);
      updatePagination();
    } catch (err) {
      if (summaryEl) summaryEl.textContent = `Failed to load: ${err.message}`;
    }
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (state.page > 1) load(state.page - 1);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (state.page < state.totalPages) load(state.page + 1);
    });
  }

  load().catch(() => {});
})();
