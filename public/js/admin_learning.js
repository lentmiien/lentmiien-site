(() => {
  const deleteButtons = document.querySelectorAll('form button[data-confirm-message]');
  const artPickerModalEl = document.getElementById('artPickerModal');
  const artPickerSearchInput = document.getElementById('artPickerSearch');
  const artPickerTargetLabel = document.getElementById('artPickerTargetLabel');
  const artLibraryCards = document.querySelectorAll('[data-art-card]');
  const artUploadForms = document.querySelectorAll('[data-learning-art-upload-form]');
  const templateForms = document.querySelectorAll('[data-template-form-root]');
  const templateProfilesBootstrap = document.getElementById('learning-template-profiles-json');
  const maxChoiceOptions = 6;

  const templateProfiles = (() => {
    if (!templateProfilesBootstrap) {
      return [];
    }

    try {
      const parsed = JSON.parse(templateProfilesBootstrap.textContent || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  })();

  const templateProfilesById = new Map(
    templateProfiles
      .filter((profile) => profile && profile._id)
      .map((profile) => [String(profile._id), profile])
  );

  const sharedFieldNames = [
    'templateType',
    'points',
    'prompt',
    'helperText',
    'blurb',
    'sceneType',
    'sceneBodyText',
    'sceneHintText',
    'sceneExampleText',
    'scenePieces',
    'sceneSlotCount',
    'correctOptionKey',
    'shuffleChoiceOptions',
    'targetCount',
    'maxCount',
    'counterLabel',
    'countDisplayMode',
    'countTokenArtKind',
    'countTokenArtValue',
    'builderPieces',
    'builderTargetSequence',
    'builderSlotCount',
    'builderDisplayMode',
    'builderShufflePieces',
    'startState',
    'targetState',
    'showCoolButton',
    'goodFeedback',
    'badFeedback',
  ];

  const checkboxFields = new Set([
    'shuffleChoiceOptions',
    'builderShufflePieces',
    'showCoolButton',
  ]);

  function dispatchFieldEvents(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function findField(form, name) {
    if (!form || !name) {
      return null;
    }
    return form.querySelector(`[name="${name}"]`);
  }

  function setFieldValue(form, name, value) {
    const field = findField(form, name);
    if (!field) {
      return;
    }

    if (checkboxFields.has(name)) {
      field.checked = Boolean(value);
    } else {
      field.value = value == null ? '' : String(value);
    }

    dispatchFieldEvents(field);
  }

  function getFieldValue(form, name) {
    const field = findField(form, name);
    if (!field) {
      return checkboxFields.has(name) ? false : '';
    }
    return checkboxFields.has(name) ? !!field.checked : field.value || '';
  }

  function syncTemplateSections(root) {
    if (!root) {
      return;
    }

    const templateSelect = root.querySelector('[data-template-select]');
    if (!templateSelect) {
      return;
    }

    const activeTemplate = templateSelect.value;
    root.querySelectorAll('[data-template-section]').forEach((section) => {
      section.hidden = section.dataset.templateSection !== activeTemplate;
    });

    const pointsInput = root.querySelector('[data-template-points]');
    if (pointsInput) {
      const isScene = activeTemplate === 'scene';
      if (isScene) {
        pointsInput.value = '0';
      }
      pointsInput.readOnly = isScene;
      pointsInput.classList.toggle('is-readonly', isScene);
    }
  }

  function syncAllTemplateSections() {
    templateForms.forEach((form) => syncTemplateSections(form));
  }

  function setupTemplateForms() {
    templateForms.forEach((form) => {
      const select = form.querySelector('[data-template-select]');
      if (select) {
        select.addEventListener('change', () => syncTemplateSections(form));
      }
      syncTemplateSections(form);
    });
  }

  function applyChoiceOptions(form, options = []) {
    for (let index = 1; index <= maxChoiceOptions; index += 1) {
      const option = Array.isArray(options) ? options[index - 1] || {} : {};
      setFieldValue(form, `choiceOption${index}Key`, option.key || '');
      setFieldValue(form, `choiceOption${index}Label`, option.label || '');
      setFieldValue(form, `choiceOption${index}ArtKind`, option.artKind || 'builtin');
      setFieldValue(form, `choiceOption${index}ArtValue`, option.artValue || '');
    }
  }

  function applyTemplatePayloadToForm(form, payload = {}, { setItemTitle = false } = {}) {
    if (!form || !payload) {
      return;
    }

    if (setItemTitle && payload.defaultItemTitle) {
      setFieldValue(form, 'title', payload.defaultItemTitle);
    }

    sharedFieldNames.forEach((name) => {
      if (name in payload) {
        setFieldValue(form, name, payload[name]);
      }
    });

    applyChoiceOptions(form, payload.choiceOptions || []);
    syncTemplateSections(form);
  }

  function captureFormPayload(form) {
    const payload = {};
    sharedFieldNames.forEach((name) => {
      payload[name] = getFieldValue(form, name);
    });

    payload.choiceOptions = [];
    for (let index = 1; index <= maxChoiceOptions; index += 1) {
      payload.choiceOptions.push({
        key: getFieldValue(form, `choiceOption${index}Key`),
        label: getFieldValue(form, `choiceOption${index}Label`),
        artKind: getFieldValue(form, `choiceOption${index}ArtKind`),
        artValue: getFieldValue(form, `choiceOption${index}ArtValue`),
      });
    }

    return payload;
  }

  function setupTemplateProfileApply() {
    const itemForm = document.querySelector('[data-template-form-root="item"]');
    if (!itemForm) {
      return;
    }

    const select = itemForm.querySelector('[data-template-profile-select]');
    const button = itemForm.querySelector('[data-template-profile-apply]');
    if (!select || !button) {
      return;
    }

    button.addEventListener('click', () => {
      const profile = templateProfilesById.get(String(select.value || ''));
      if (!profile) {
        window.alert('Choose a saved template profile first.');
        return;
      }

      applyTemplatePayloadToForm(itemForm, profile, { setItemTitle: true });
    });
  }

  function setupCopyItemToTemplate() {
    const itemForm = document.querySelector('[data-template-form-root="item"]');
    const templateForm = document.querySelector('[data-template-form-root="template-profile"]');
    const button = document.querySelector('[data-copy-item-to-template]');

    if (!itemForm || !templateForm || !button) {
      return;
    }

    button.addEventListener('click', () => {
      const payload = captureFormPayload(itemForm);
      const itemTitle = getFieldValue(itemForm, 'title').trim();

      setFieldValue(templateForm, 'templateProfileId', '');
      setFieldValue(templateForm, 'slug', '');
      setFieldValue(templateForm, 'title', itemTitle ? `${itemTitle} template` : 'New template profile');
      setFieldValue(templateForm, 'description', '');
      setFieldValue(templateForm, 'defaultItemTitle', itemTitle);
      applyTemplatePayloadToForm(templateForm, payload);

      templateForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
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
          dispatchFieldEvents(currentTargetInput);
        }

        if (currentKindInput) {
          currentKindInput.value = 'builtin';
          dispatchFieldEvents(currentKindInput);
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
  setupTemplateForms();
  setupTemplateProfileApply();
  setupCopyItemToTemplate();
  setupArtPicker();
  setupArtUploadForms();
  syncAllTemplateSections();
})();
