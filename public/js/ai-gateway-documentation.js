(function () {
  const copyButtons = Array.from(document.querySelectorAll('[data-copy-button]'));
  const statusElement = document.getElementById('gatewayDocumentationCopyStatus');
  let clearStatusTimeout = null;

  if (!copyButtons.length) {
    return;
  }

  function setStatus(message, state) {
    if (!statusElement) {
      return;
    }

    statusElement.textContent = message || '';
    if (state) {
      statusElement.dataset.state = state;
    } else {
      delete statusElement.dataset.state;
    }
  }

  function scheduleStatusClear() {
    if (clearStatusTimeout) {
      window.clearTimeout(clearStatusTimeout);
    }
    clearStatusTimeout = window.setTimeout(() => setStatus('', ''), 2600);
  }

  function copyWithSelection(value) {
    const fallback = document.createElement('textarea');
    fallback.value = value;
    fallback.setAttribute('readonly', 'readonly');
    fallback.style.position = 'fixed';
    fallback.style.opacity = '0';
    fallback.style.pointerEvents = 'none';
    document.body.appendChild(fallback);
    fallback.focus();
    fallback.select();

    const copied = document.execCommand('copy');
    document.body.removeChild(fallback);
    if (!copied) {
      throw new Error('Clipboard copy was rejected.');
    }
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    copyWithSelection(value);
  }

  function getCopyValue(button) {
    if (button.dataset.copyValue !== undefined) {
      return button.dataset.copyValue;
    }

    const sourceSelector = button.dataset.copySource;
    const source = sourceSelector ? document.querySelector(sourceSelector) : null;
    if (!source) {
      throw new Error('Copy source was not found.');
    }
    return 'value' in source ? source.value : source.textContent;
  }

  copyButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const label = button.dataset.copyLabel || 'Content';
      try {
        button.disabled = true;
        setStatus(`Copying ${label}…`, '');
        await copyText(getCopyValue(button));
        setStatus(`${label} copied.`, 'success');
      } catch (error) {
        console.error('Failed to copy AI Gateway documentation content', error);
        setStatus(`Unable to copy ${label}.`, 'error');
      } finally {
        button.disabled = false;
        scheduleStatusClear();
      }
    });
  });
})();
