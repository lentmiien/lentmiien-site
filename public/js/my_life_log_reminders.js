(() => {
  const scheduleSelect = document.querySelector('[data-reminder-schedule-select]');
  if (!scheduleSelect) return;

  const fields = Array.from(document.querySelectorAll('[data-reminder-fields]'));
  const updateFields = () => {
    fields.forEach((field) => {
      const isActive = field.getAttribute('data-reminder-fields') === scheduleSelect.value;
      field.style.display = isActive ? '' : 'none';
      field.querySelectorAll('input, select, textarea').forEach((input) => {
        input.disabled = !isActive;
      });
    });
  };

  scheduleSelect.addEventListener('change', updateFields);
  updateFields();
})();
