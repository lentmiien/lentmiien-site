(() => {
  function pad(value) {
    return String(value).padStart(2, '0');
  }

  function toDateTimeLocal(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
      + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  document.querySelectorAll('[data-local-datetime]').forEach((element) => {
    const date = new Date(element.getAttribute('datetime'));
    if (Number.isNaN(date.getTime())) return;
    element.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  });

  const form = document.querySelector('[data-reminder-form]');
  if (!form) return;

  const dateInput = form.querySelector('#reminder-scheduled-for');
  const isoInput = form.querySelector('[data-scheduled-iso]');
  if (!dateInput || !isoInput) return;

  const scheduledUtc = dateInput.dataset.scheduledUtc;
  if (scheduledUtc) {
    const scheduledDate = new Date(scheduledUtc);
    if (!Number.isNaN(scheduledDate.getTime())) {
      dateInput.value = toDateTimeLocal(scheduledDate);
    }
  }

  const minimumDate = new Date(Date.now() + 60 * 1000);
  minimumDate.setSeconds(0, 0);
  dateInput.min = toDateTimeLocal(minimumDate);

  const syncIsoValue = () => {
    const date = new Date(dateInput.value);
    isoInput.value = Number.isNaN(date.getTime()) ? '' : date.toISOString();
  };

  dateInput.addEventListener('change', syncIsoValue);
  form.addEventListener('submit', syncIsoValue);
})();
