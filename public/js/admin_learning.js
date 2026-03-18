(() => {
  const templateSelect = document.getElementById('templateTypeSelect');
  const pointsInput = document.getElementById('learningPointsInput');
  const deleteButtons = document.querySelectorAll('form button[data-confirm-message]');
  const artPickerModalEl = document.getElementById('artPickerModal');
  const artPickerSearchInput = document.getElementById('artPickerSearch');
  const artPickerTargetLabel = document.getElementById('artPickerTargetLabel');
  const artLibraryCards = document.querySelectorAll('[data-art-card]');
  const artUploadForms = document.querySelectorAll('[data-learning-art-upload-form]');

  function syncTemplateSections() {
    if (!templateSelect) {
      return;
    }

    const activeTemplate = templateSelect.value;
    document.querySelectorAll('[data-template-section]').forEach((section) => {
      section.hidden = section.dataset.templateSection !== activeTemplate;
    });

    if (pointsInput) {
      const isScene = activeTemplate === 'scene';
      if (isScene) {
        pointsInput.value = '0';
      }
      pointsInput.readOnly = isScene;
      pointsInput.classList.toggle('is-readonly', isScene);
    }
  }

  function setupDeleteConfirms() {
    deleteButtons.forEach((button) => {
      button.addEventListener('click', (event) => {
        const message = button.dataset.confirmMessage || 'Are you sure?';
        if (!window.confirm(message)) {
          event.preventDefault();
        }
      });
    });
  }

  function setupArtPicker() {
    if (!artPickerModalEl) {
      return;
    }

    let currentTargetInput = null;
    let currentKindInput = null;

    artPickerModalEl.addEventListener('show.bs.modal', (event) => {
      const trigger = event.relatedTarget;
      currentTargetInput = trigger?.dataset?.artPickerTarget
        ? document.querySelector(trigger.dataset.artPickerTarget)
        : null;
      currentKindInput = trigger?.dataset?.artKindTarget
        ? document.querySelector(trigger.dataset.artKindTarget)
        : null;

      if (artPickerTargetLabel) {
        artPickerTargetLabel.textContent = trigger?.dataset?.artLabel || 'art value';
      }

      if (artPickerSearchInput) {
        artPickerSearchInput.value = '';
      }

      artLibraryCards.forEach((card) => {
        card.hidden = false;
      });
    });

    artPickerModalEl.querySelectorAll('[data-art-pick-value]').forEach((button) => {
      button.addEventListener('click', () => {
        if (currentTargetInput) {
          currentTargetInput.value = button.dataset.artPickValue || '';
          currentTargetInput.dispatchEvent(new Event('input', { bubbles: true }));
          currentTargetInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        if (currentKindInput) {
          currentKindInput.value = 'builtin';
          currentKindInput.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const modal = window.bootstrap?.Modal.getInstance(artPickerModalEl);
        if (modal) {
          modal.hide();
        }
      });
    });

    if (artPickerSearchInput) {
      artPickerSearchInput.addEventListener('input', () => {
        const query = artPickerSearchInput.value.trim().toLowerCase();
        artLibraryCards.forEach((card) => {
          const haystack = card.dataset.artSearch || '';
          card.hidden = Boolean(query) && !haystack.includes(query);
        });
      });
    }
  }

  function setupArtUploadForms() {
    if (!artUploadForms.length) {
      return;
    }

    const returnTo = `${window.location.pathname}${window.location.search}`;
    artUploadForms.forEach((form) => {
      const returnInput = form.querySelector('input[name="returnTo"]');
      if (returnInput) {
        returnInput.value = returnTo;
      }
    });
  }

  setupDeleteConfirms();
  syncTemplateSections();
  setupArtPicker();
  setupArtUploadForms();

  if (templateSelect) {
    templateSelect.addEventListener('change', syncTemplateSections);
  }
})();
