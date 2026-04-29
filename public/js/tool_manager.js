(function () {
  function statusFor(field) {
    return document.querySelector(`[data-json-status-for="${field.id}"]`);
  }

  function validateJsonField(field) {
    const status = statusFor(field);
    if (!field.value.trim()) {
      if (status) {
        status.textContent = '';
        delete status.dataset.state;
      }
      field.setCustomValidity('');
      return true;
    }

    try {
      JSON.parse(field.value);
      field.setCustomValidity('');
      if (status) {
        status.textContent = 'Valid JSON';
        status.dataset.state = 'ok';
      }
      return true;
    } catch (error) {
      field.setCustomValidity(error.message);
      if (status) {
        status.textContent = error.message;
        status.dataset.state = 'error';
      }
      return false;
    }
  }

  const jsonFields = Array.from(document.querySelectorAll('[data-json-field]'));
  jsonFields.forEach((field) => {
    field.addEventListener('input', () => validateJsonField(field));
    validateJsonField(field);
  });

  const form = document.getElementById('toolManagerForm');
  if (form) {
    form.addEventListener('submit', (event) => {
      const validJson = jsonFields.every(validateJsonField);
      if (!validJson || !form.checkValidity()) {
        event.preventDefault();
        form.reportValidity();
      }
    });
  }

  document.querySelectorAll('form[data-confirm]').forEach((confirmForm) => {
    confirmForm.addEventListener('submit', (event) => {
      const message = confirmForm.getAttribute('data-confirm') || 'Continue?';
      if (!window.confirm(message)) {
        event.preventDefault();
      }
    });
  });

  const configElement = document.getElementById('toolManagerPageConfig');
  const testerForm = document.getElementById('toolTesterForm');
  const testerName = document.getElementById('toolTesterName');
  const testerArguments = document.getElementById('toolTesterArguments');
  const testerOutput = document.getElementById('toolTesterOutput');
  const testerStatus = document.getElementById('toolTesterStatus');
  const testerSubmit = document.getElementById('toolTesterSubmit');
  const testerCopy = document.getElementById('toolTesterCopy');

  let pageConfig = {};
  if (configElement) {
    try {
      pageConfig = JSON.parse(configElement.textContent || '{}');
    } catch (error) {
      console.error('Unable to parse tool manager page config.', error);
    }
  }

  function setTesterStatus(message, state) {
    if (!testerStatus) return;
    testerStatus.textContent = message || '';
    if (state) {
      testerStatus.dataset.state = state;
    } else {
      delete testerStatus.dataset.state;
    }
  }

  function setTesterOutput(value) {
    if (!testerOutput) return;
    if (typeof value === 'string') {
      testerOutput.textContent = value;
      return;
    }
    testerOutput.textContent = JSON.stringify(value, null, 2);
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    try {
      return text ? JSON.parse(text) : {};
    } catch (_error) {
      return {
        ok: false,
        error: text || 'Unexpected server response.',
      };
    }
  }

  if (testerForm) {
    testerForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const endpoint = pageConfig.endpoint || '/admin/tools/test';
      const toolName = testerName ? testerName.value : '';
      const rawArguments = testerArguments ? testerArguments.value : '{}';

      if (!toolName) {
        setTesterStatus('Select a tool first.', 'error');
        return;
      }

      try {
        JSON.parse(rawArguments || '{}');
      } catch (error) {
        setTesterStatus(`Arguments JSON is invalid: ${error.message}`, 'error');
        return;
      }

      if (testerSubmit) testerSubmit.disabled = true;
      setTesterStatus('Running tool...', 'running');
      setTesterOutput('Waiting for tool output...');

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            toolName,
            arguments: rawArguments,
          }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok || !payload.ok) {
          throw new Error(payload.error || 'Tool test failed.');
        }
        setTesterStatus('Tool completed.', 'ok');
        setTesterOutput(payload.execution);
      } catch (error) {
        setTesterStatus(error.message || 'Tool test failed.', 'error');
        setTesterOutput({
          ok: false,
          error: error.message || 'Tool test failed.',
        });
      } finally {
        if (testerSubmit) testerSubmit.disabled = false;
      }
    });
  }

  if (testerCopy && testerOutput) {
    testerCopy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(testerOutput.textContent || '');
        setTesterStatus('Output copied.', 'ok');
      } catch (_error) {
        setTesterStatus('Unable to copy output.', 'error');
      }
    });
  }
})();
