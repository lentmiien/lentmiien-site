(() => {
  function onMarkDoneClick(e) {
    const btn = e.currentTarget;
    const id = btn.getAttribute('data-id');
    if (!id) return;
    btn.disabled = true;
    btn.textContent = 'Saving...';

    fetch(`/scheduleTask/api/tasks/${encodeURIComponent(id)}/done`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true })
    })
      .then(res => {
        if (!res.ok) throw new Error('Request failed');
        return res.json();
      })
      .then(() => {
        // Remove the card from DOM
        const card = btn.closest('.task-card');
        const col = btn.closest('.col');
        const section = btn.closest('.section-expired, .section-group');
        if (col) col.remove();

        // If section has no more cards, hide the heading and section
        if (section && !section.querySelector('.task-card')) {
          // Find the previous sibling heading (h3) and remove it too
          let prev = section.previousElementSibling;
          if (prev && prev.tagName && prev.tagName.toLowerCase() === 'h3') {
            prev.remove();
          }
          section.remove();
        }
      })
      .catch(err => {
        console.error(err);
        btn.disabled = false;
        btn.textContent = 'Mark as done';
        alert('Failed to mark as done. Please try again.');
      });
  }

  function init() {
    document.querySelectorAll('.btn-complete').forEach(btn => {
      btn.addEventListener('click', onMarkDoneClick);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

