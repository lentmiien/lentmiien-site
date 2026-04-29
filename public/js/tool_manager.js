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
})();
