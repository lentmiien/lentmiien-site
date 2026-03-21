(function () {
  const copyButton = document.getElementById('copyRawButton');
  const rawTextarea = document.getElementById('projectDocsRaw');
  const statusEl = document.getElementById('copyRawStatus');

  if (!copyButton || !rawTextarea) {
    return;
  }

  let clearStatusTimeout = null;

  function setStatus(message, state) {
    if (!statusEl) {
      return;
    }

    statusEl.textContent = message || '';
    if (state) {
      statusEl.dataset.state = state;
    } else {
      delete statusEl.dataset.state;
    }
  }

  function scheduleStatusClear() {
    if (clearStatusTimeout) {
      window.clearTimeout(clearStatusTimeout);
    }

    clearStatusTimeout = window.setTimeout(() => {
      setStatus('', '');
    }, 2400);
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const fallback = document.createElement('textarea');
    fallback.value = value;
    fallback.setAttribute('readonly', 'readonly');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    fallback.style.pointerEvents = 'none';

    document.body.appendChild(fallback);
    fallback.focus();
    fallback.select();

    const success = document.execCommand('copy');
    document.body.removeChild(fallback);

    if (!success) {
      throw new Error('execCommand copy failed');
    }
  }

  copyButton.addEventListener('click', async () => {
    try {
      copyButton.disabled = true;
      setStatus('Copying raw Markdown...', '');
      await copyText(rawTextarea.value || '');
      setStatus('Raw Markdown copied.', 'success');
    } catch (error) {
      console.error('Failed to copy raw documentation text', error);
      setStatus('Copy failed.', 'error');
    } finally {
      copyButton.disabled = false;
      scheduleStatusClear();
    }
  });
})();
