'use strict';
document.querySelectorAll('[data-action][data-job]').forEach(button => button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const response = await fetch(`/local-ai/api/v1/jobs/${encodeURIComponent(button.dataset.job)}/${button.dataset.action}`, { method: 'POST', headers: { 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content, Accept: 'application/json' } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error?.code || 'Request failed');
    location.reload();
  } catch (error) { document.getElementById('local-ai-status').textContent = error.message; button.disabled = false; }
}));
