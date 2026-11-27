'use strict';
const button = document.getElementById('maintenanceChange'),
  status = document.getElementById('harborStatus');
button.addEventListener('click', async () => {
  const paused = button.dataset.paused !== 'true';
  button.disabled = true;
  status.textContent = paused
    ? 'Bringing the crew ashore and writing the checkpoint…'
    : 'Reopening the harbor…';
  try {
    const result = await fetch('/emberwake-online/maintenance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': document.querySelector('meta[name=csrf-token]').content
      },
      body: JSON.stringify({ paused })
    });
    if (!result.ok)
      throw Error('The server could not confirm this change. Reload to check the harbor before maintenance.');
    const saved = await result.json();
    button.dataset.paused = String(saved.paused);
    button.textContent = saved.paused ? 'Reopen harbor' : 'Pause and save';
    status.textContent = saved.paused
      ? 'Paused · all crew disconnected · checkpoint saved at ' + new Date(saved.savedAt).toLocaleTimeString()
      : 'Open · crew can join again';
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
