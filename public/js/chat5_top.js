function Filter(e) {
  const v = e.value;
  const elms = document.getElementsByClassName("entry");
  for (let i = 0; i < elms.length; i++) {
    if (v.length === 0) elms[i].style.display = "block";
    else if (elms[i].dataset.category === v) elms[i].style.display = "block";
    else elms[i].style.display = "none";
  }
}

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

  // Existing filter function presumably present; if not, here's a simple one:
  window.Filter = window.Filter || function(sel){
    const want = sel.value;
    const entries = document.querySelectorAll('.entry');
    entries.forEach(el => {
      const cat = el.dataset.category;
      el.style.display = (!want || cat === want) ? '' : 'none';
    });
  };
})();
