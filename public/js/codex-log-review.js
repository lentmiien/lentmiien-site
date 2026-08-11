(function initCodexLogReview() {
  'use strict';

  document.addEventListener('click', async (event) => {
    const copyButton = event.target.closest('[data-copy-target]');
    if (copyButton) {
      event.preventDefault();
      event.stopPropagation();
      const target = document.getElementById(copyButton.dataset.copyTarget);
      if (!target) return;
      const previousLabel = copyButton.textContent;
      try {
        await navigator.clipboard.writeText(target.textContent || '');
        copyButton.textContent = 'Copied';
      } catch (_error) {
        copyButton.textContent = 'Copy failed';
      }
      window.setTimeout(() => {
        copyButton.textContent = previousLabel;
      }, 1800);
      return;
    }

    const confirmationButton = event.target.closest('[data-confirm]');
    if (confirmationButton && !window.confirm(confirmationButton.dataset.confirm)) {
      event.preventDefault();
    }
  });

  const page = document.querySelector('.log-review-page[data-auto-refresh="true"]');
  if (page) {
    window.setTimeout(() => {
      if (document.visibilityState === 'visible') {
        window.location.reload();
      }
    }, 20_000);
  }
}());
