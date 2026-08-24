(() => {
  const form = document.querySelector('[data-task-form]');
  if (!form) return;

  const list = form.querySelector('[data-task-reminder-list]');
  const template = document.getElementById('task-reminder-template');
  const addButton = form.querySelector('[data-add-task-reminder]');
  const count = form.querySelector('[data-task-reminder-count]');
  const warning = form.querySelector('[data-task-reminder-date-warning]');
  const startInput = form.querySelector('[data-task-start]');
  const deadlineInput = form.querySelector('[data-task-deadline]');
  const maxReminders = Number.parseInt(form.dataset.maxReminders, 10) || 5;

  if (!list || !template || !addButton || !count || !startInput || !deadlineInput) return;

  function rows() {
    return Array.from(list.querySelectorAll('[data-task-reminder-row]'));
  }

  function updateAnchorAvailability(row) {
    const select = row.querySelector('[data-reminder-anchor]');
    const help = row.querySelector('[data-reminder-row-help]');
    if (!select) return;

    const startOption = select.querySelector('option[value="start"]');
    const deadlineOption = select.querySelector('option[value="deadline"]');
    const hasStart = Boolean(startInput.value);
    const hasDeadline = Boolean(deadlineInput.value);
    if (startOption) startOption.disabled = !hasStart;
    if (deadlineOption) deadlineOption.disabled = !hasDeadline;

    if (select.value === 'start' && !hasStart && hasDeadline) select.value = 'deadline';
    if (select.value === 'deadline' && !hasDeadline && hasStart) select.value = 'start';

    const anchorAvailable = select.value === 'start' ? hasStart : hasDeadline;
    select.setCustomValidity(anchorAvailable ? '' : 'Choose an anchor date that is set on the task.');
    if (help) {
      help.textContent = anchorAvailable
        ? `Scheduled before the task ${select.value === 'start' ? 'start' : 'deadline'}.`
        : 'Set a task start or deadline to use this reminder.';
    }
  }

  function refresh() {
    const reminderRows = rows();
    reminderRows.forEach((row, index) => {
      const number = row.querySelector('[data-task-reminder-number]');
      if (number) number.textContent = String(index + 1);
      updateAnchorAvailability(row);
    });
    count.textContent = `${reminderRows.length} / ${maxReminders}`;
    addButton.disabled = reminderRows.length >= maxReminders;
    if (warning) warning.hidden = reminderRows.length === 0 || Boolean(startInput.value || deadlineInput.value);
  }

  addButton.addEventListener('click', () => {
    if (rows().length >= maxReminders) return;
    const fragment = template.content.cloneNode(true);
    list.appendChild(fragment);
    refresh();
    const addedRow = rows().at(-1);
    addedRow?.querySelector('select, input')?.focus();
  });

  list.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove-task-reminder]');
    if (!removeButton) return;
    removeButton.closest('[data-task-reminder-row]')?.remove();
    refresh();
  });

  list.addEventListener('change', (event) => {
    const row = event.target.closest('[data-task-reminder-row]');
    if (row) updateAnchorAvailability(row);
  });
  startInput.addEventListener('input', refresh);
  deadlineInput.addEventListener('input', refresh);
  form.addEventListener('submit', () => rows().forEach(updateAnchorAvailability));

  refresh();
})();
