(function(){
  function $(sel, ctx=document){ return ctx.querySelector(sel); }
  function formatDate(iso){
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      });
    } catch { return iso; }
  }

  // Preview button handler
  document.addEventListener('click', function(e){
    const btn = e.target.closest('[data-preview]');
    if (!btn) return;
    const entry = btn.closest('.entry');
    if (!entry) return;

    const title = entry.dataset.title || '(untitled)';
    const summary = (entry.dataset.summary || '').trim();
    const category = entry.dataset.categoryLabel || '';
    const tags = entry.dataset.tags || '';
    const messagesCount = entry.dataset.messagesCount || '0';
    const members = entry.dataset.members || '';
    const createdISO = entry.dataset.createdIso || '';
    const updatedISO = entry.dataset.updatedIso || '';
    const openHref = entry.dataset.openHref || '#';

    // Fill modal
    const modal = $('#convPreviewModal');
    $('#previewTitle', modal).textContent = title;
    $('#previewSummary', modal).textContent = summary || 'No summary available.';
    $('#previewModelId', modal).textContent = `Model: ${entry.dataset.modelId || 'Not specified'}`;
    $('#previewModel', modal).textContent = entry.dataset.modelSummary;
    const warning = $('#previewModelWarning', modal);
    warning.textContent = entry.dataset.modelWarning;
    warning.hidden = !entry.dataset.modelWarning;
    warning.classList.toggle('chat5-model-warning--deprecated',
      JSON.parse(entry.dataset.filters).deprecation.includes('deprecated'));

    $('#previewCategory', modal).textContent = category || '-';
    $('#previewTags', modal).textContent = tags || '-';
    $('#previewMessagesCount', modal).textContent = messagesCount;
    $('#previewMembers', modal).textContent = members || '-';
    $('#previewCreated', modal).textContent = createdISO ? formatDate(createdISO) : '-';
    $('#previewUpdated', modal).textContent = updatedISO ? formatDate(updatedISO) : '-';
    const openLink = $('#previewOpenLink', modal);
    openLink.setAttribute('href', openHref);
    openLink.setAttribute('aria-label', `Open conversation: ${title}`);
  }, false);

  const form = document.getElementById('conversationFilters');
  if (!form) return;
  const titleInput = document.getElementById('filter-title');
  const selects = [...form.querySelectorAll('[data-conversation-filter]')];
  const entries = [...document.querySelectorAll('.entry')].map(element => ({
    element,
    title: (element.dataset.title || '').toLowerCase(),
    filters: JSON.parse(element.dataset.filters),
  }));
  const headers = [...document.querySelectorAll('.bucket-header')];
  const resultCount = document.getElementById('filterResults');
  const emptyState = document.getElementById('noConversations');

  function applyFilters() {
    const title = titleInput.value.trim().toLowerCase();
    const selected = selects.filter(select => select.value);
    const visibleBuckets = new Set();
    let count = 0;
    for (const entry of entries) {
      const matches = entry.title.includes(title) && selected.every(select =>
        entry.filters[select.dataset.conversationFilter].includes(select.value));
      entry.element.hidden = !matches;
      if (matches) {
        count += 1;
        visibleBuckets.add(entry.element.dataset.ageBucket);
      }
    }
    headers.forEach(header => { header.hidden = !visibleBuckets.has(header.dataset.ageBucket); });
    resultCount.textContent = `${count} of ${entries.length} conversations`;
    emptyState.hidden = count > 0;
  }

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', applyFilters);
  form.addEventListener('change', applyFilters);
  form.addEventListener('reset', event => {
    event.preventDefault();
    titleInput.value = '';
    selects.forEach(select => { select.value = ''; });
    applyFilters();
  });
  applyFilters();
})();
