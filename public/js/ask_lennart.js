(function () {
  const page = document.querySelector('.ask-lennart-page');
  if (!page) return;

  const refreshMs = Number.parseInt(page.dataset.autoRefreshMs, 10);
  if (!Number.isFinite(refreshMs) || refreshMs < 5000) return;

  let dirty = false;
  document.querySelectorAll('[data-human-response-input]').forEach((input) => {
    input.addEventListener('input', () => {
      dirty = true;
    });
  });

  const handle = window.setInterval(() => {
    if (document.hidden || dirty || document.activeElement?.matches('[data-human-response-input]')) {
      return;
    }
    window.location.reload();
  }, refreshMs);

  window.addEventListener('beforeunload', () => window.clearInterval(handle), { once: true });
}());
