(() => {
  'use strict';
  const form = document.getElementById('disaster-refresh');
  if (!form) return;
  const status = document.getElementById('disaster-refresh-status');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Requesting source refresh…';
    try {
      const response = await fetch(form.action, { method: 'POST', credentials: 'same-origin',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(new FormData(form)), signal: AbortSignal.timeout(10000) });
      const result = await response.json();
      status.textContent = result.message || result.error || 'Could not request a refresh.';
    } catch (_) { status.textContent = 'Refresh request could not be confirmed. Reload stored data before retrying.'; }
    finally { button.disabled = false; }
  });
})();
