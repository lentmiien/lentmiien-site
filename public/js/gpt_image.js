(function () {
  const pageConfigElement = document.getElementById('gptImagePageConfig');
  if (!pageConfigElement) {
    return;
  }

  let pageConfig = {};
  try {
    pageConfig = JSON.parse(pageConfigElement.textContent || '{}');
  } catch (error) {
    console.error('Failed to parse GPT Image page config.', error);
    return;
  }

  const STORAGE_KEY = 'gpt-image-selected-inputs';
  const form = document.getElementById('gptImageForm');
  const statusElement = document.getElementById('gptImageStatus');
  const selectedInputsElement = document.getElementById('gptImageSelectedInputs');
  const selectedCountElement = document.getElementById('gptImageSelectedCount');
  const clearSelectionButton = document.getElementById('gptImageClearSelection');
  const submitButton = document.getElementById('gptImageSubmit');
  const sizeModeInput = document.getElementById('gptImageSizeMode');
  const presetField = document.getElementById('gptImagePresetField');
  const customSizeField = document.getElementById('gptImageCustomSize');
  const outputFormatInput = document.getElementById('gptImageOutputFormat');
  const compressionField = document.getElementById('gptImageCompressionField');
  const uploadInput = document.getElementById('gptImageUploads');
  const uploadSummary = document.getElementById('gptImageUploadSummary');

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

  function readSelection() {
    try {
      const parsed = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter((entry) => entry && typeof entry.id === 'string');
    } catch (_error) {
      return [];
    }
  }

  function writeSelection(items) {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function setStatus(message, tone) {
    if (!statusElement) {
      return;
    }
    statusElement.textContent = message || '';
    if (tone) {
      statusElement.dataset.tone = tone;
    } else {
      delete statusElement.dataset.tone;
    }
  }

  function getCardPayload(card) {
    if (!card) {
      return null;
    }
    return {
      id: card.dataset.imageId,
      previewUrl: card.dataset.previewUrl || '',
      label: card.dataset.cardLabel || card.dataset.previewUrl || card.dataset.imageId,
    };
  }

  function syncCardButtons() {
    const selectedIds = new Set(readSelection().map((entry) => entry.id));
    document.querySelectorAll('[data-select-input]').forEach((button) => {
      const card = button.closest('[data-gallery-card]');
      const imageId = card ? card.dataset.imageId : '';
      const isSelected = selectedIds.has(imageId);
      button.textContent = isSelected ? 'Selected' : 'Use as input';
      button.classList.toggle('btn-primary', isSelected);
      button.classList.toggle('btn-outline-primary', !isSelected);
    });
  }

  function renderSelectedInputs() {
    if (!selectedInputsElement || !selectedCountElement) {
      return;
    }

    const items = readSelection();
    selectedCountElement.textContent = `${items.length} selected`;

    if (items.length === 0) {
      selectedInputsElement.innerHTML = '<div class="gpt-image-selection__empty">No gallery images selected yet.</div>';
      syncCardButtons();
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'gpt-image-selection__item';
      const thumb = document.createElement('img');
      thumb.className = 'gpt-image-selection__thumb';
      thumb.src = item.previewUrl;
      thumb.alt = '';

      const label = document.createElement('p');
      label.className = 'gpt-image-selection__label';
      label.textContent = item.label;

      const removeButton = document.createElement('button');
      removeButton.type = 'button';
      removeButton.className = 'btn btn-outline-secondary btn-sm';
      removeButton.setAttribute('data-remove-selected', item.id);
      removeButton.textContent = 'Remove';

      wrapper.appendChild(thumb);
      wrapper.appendChild(label);
      wrapper.appendChild(removeButton);
      fragment.appendChild(wrapper);
    });

    selectedInputsElement.innerHTML = '';
    selectedInputsElement.appendChild(fragment);

    selectedInputsElement.querySelectorAll('[data-remove-selected]').forEach((button) => {
      button.addEventListener('click', () => {
        const targetId = button.getAttribute('data-remove-selected');
        const remaining = readSelection().filter((entry) => entry.id !== targetId);
        writeSelection(remaining);
        renderSelectedInputs();
      });
    });

    syncCardButtons();
  }

  function updateSizeFields() {
    if (!sizeModeInput || !presetField || !customSizeField) {
      return;
    }
    const mode = sizeModeInput.value;
    presetField.hidden = mode !== 'preset';
    customSizeField.hidden = mode !== 'custom';
  }

  function updateCompressionField() {
    if (!outputFormatInput || !compressionField) {
      return;
    }
    compressionField.hidden = outputFormatInput.value === 'png';
  }

  function updateUploadSummary() {
    if (!uploadInput || !uploadSummary) {
      return;
    }
    const files = Array.from(uploadInput.files || []);
    if (files.length === 0) {
      uploadSummary.textContent = 'No uploaded files selected.';
      return;
    }
    const summary = files.map((file) => file.name).join(', ');
    uploadSummary.textContent = summary;
  }

  async function handleLike(button) {
    const imageId = button.getAttribute('data-image-id');
    if (!imageId) {
      return;
    }

    button.disabled = true;
    try {
      const response = await fetch(`${pageConfig.likeEndpointBase}/${encodeURIComponent(imageId)}/like`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
        },
      });
      const payload = await readJsonResponse(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Unable to update the like.');
      }

      const card = button.closest('[data-gallery-card]');
      if (card) {
        const likeCountElement = card.querySelector('[data-like-count]');
        if (likeCountElement) {
          likeCountElement.textContent = payload.likeCount;
        }
        card.classList.toggle('gpt-image-card--liked', Boolean(payload.liked));
      }

      button.textContent = payload.liked ? 'Unlike' : 'Like';
      button.dataset.liked = payload.liked ? 'true' : 'false';
    } catch (error) {
      setStatus(error.message || 'Unable to update the like.', 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form || !submitButton) {
      return;
    }

    const selected = readSelection();
    const formData = new FormData(form);
    selected.forEach((entry) => {
      formData.append('selectedImageIds', entry.id);
    });

    submitButton.disabled = true;
    setStatus('Generating images. This can take a little while for larger or higher-quality requests.', 'success');

    try {
      const response = await fetch(pageConfig.generateEndpoint, {
        method: 'POST',
        body: formData,
      });
      const payload = await readJsonResponse(response);
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || 'Unable to generate the image.');
      }

      setStatus('Images saved. Reloading the gallery.', 'success');
      window.location.href = payload.redirectUrl || window.location.pathname;
    } catch (error) {
      submitButton.disabled = false;
      setStatus(error.message || 'Unable to generate the image.', 'error');
    }
  }

  document.querySelectorAll('[data-select-input]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('[data-gallery-card]');
      const payload = getCardPayload(card);
      if (!payload || !payload.id) {
        return;
      }

      const items = readSelection();
      const existingIndex = items.findIndex((entry) => entry.id === payload.id);
      if (existingIndex >= 0) {
        items.splice(existingIndex, 1);
      } else {
        if (items.length >= Number(pageConfig.selectedInputLimit || 16)) {
          setStatus(`You can select up to ${pageConfig.selectedInputLimit || 16} gallery references.`, 'error');
          return;
        }
        items.push(payload);
      }
      writeSelection(items);
      renderSelectedInputs();
    });
  });

  document.querySelectorAll('[data-like-button]').forEach((button) => {
    button.addEventListener('click', () => handleLike(button));
  });

  if (clearSelectionButton) {
    clearSelectionButton.addEventListener('click', () => {
      writeSelection([]);
      renderSelectedInputs();
    });
  }

  if (sizeModeInput) {
    sizeModeInput.addEventListener('change', updateSizeFields);
  }

  if (outputFormatInput) {
    outputFormatInput.addEventListener('change', updateCompressionField);
  }

  if (uploadInput) {
    uploadInput.addEventListener('change', updateUploadSummary);
  }

  if (form) {
    form.addEventListener('submit', handleSubmit);
  }

  updateSizeFields();
  updateCompressionField();
  updateUploadSummary();
  renderSelectedInputs();
})();
