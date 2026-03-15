(() => {
  const templateSelect = document.getElementById('templateTypeSelect');
  if (!templateSelect) {
    return;
  }

  const pointsInput = document.getElementById('learningPointsInput');
  const deleteForms = document.querySelectorAll('form button[data-confirm-message]');

  const syncTemplateSections = () => {
    const activeTemplate = templateSelect.value;
    document.querySelectorAll('[data-template-section]').forEach((section) => {
      section.hidden = section.dataset.templateSection !== activeTemplate;
    });

    if (pointsInput) {
      if (activeTemplate === 'scene') {
        pointsInput.value = '0';
      }
    }
  };

  deleteForms.forEach((button) => {
    button.addEventListener('click', (event) => {
      const message = button.dataset.confirmMessage || 'Are you sure?';
      if (!window.confirm(message)) {
        event.preventDefault();
      }
    });
  });

  templateSelect.addEventListener('change', syncTemplateSections);
  syncTemplateSections();
})();
