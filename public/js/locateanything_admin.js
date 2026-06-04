(() => {
  const form = document.querySelector('[data-locateanything-form]');
  if (!form) {
    return;
  }

  const taskInput = form.querySelector('[data-locate-task]');
  const queryWrap = form.querySelector('[data-query-field]');
  const categoriesWrap = form.querySelector('[data-categories-field]');
  const queryInput = queryWrap ? queryWrap.querySelector('textarea, input') : null;
  const categoriesInput = categoriesWrap ? categoriesWrap.querySelector('textarea, input') : null;
  const imageInput = document.getElementById('locateImages');
  const preview = document.getElementById('locateImagePreview');
  const submitBtn = document.getElementById('locateSubmitBtn');
  const submitStatus = document.getElementById('locateSubmitStatus');
  const objectUrls = [];
  const queryTasks = new Set(['ground', 'ground_single', 'ground_text', 'ground_gui', 'point']);

  function clearObjectUrls() {
    while (objectUrls.length) {
      URL.revokeObjectURL(objectUrls.pop());
    }
  }

  function setFieldState(element, input, visible, required) {
    if (!element) {
      return;
    }
    element.hidden = !visible;
    if (input) {
      input.required = Boolean(required);
    }
  }

  function syncTaskFields() {
    const task = taskInput ? taskInput.value : '';
    setFieldState(queryWrap, queryInput, task !== 'detect_text' && task !== 'detect', queryTasks.has(task));
    setFieldState(categoriesWrap, categoriesInput, task === 'detect', task === 'detect');
  }

  function renderPreview() {
    if (!preview || !imageInput) {
      return;
    }
    clearObjectUrls();
    preview.textContent = '';
    const files = Array.from(imageInput.files || []);
    files.slice(0, 10).forEach((file) => {
      const url = URL.createObjectURL(file);
      objectUrls.push(url);

      const item = document.createElement('div');
      item.className = 'locateanything-admin__preview-item';

      const img = document.createElement('img');
      img.src = url;
      img.alt = file.name || 'Selected image';

      const label = document.createElement('span');
      label.textContent = file.name || 'image';

      item.append(img, label);
      preview.appendChild(item);
    });
  }

  if (taskInput) {
    taskInput.addEventListener('change', syncTaskFields);
    syncTaskFields();
  }

  if (imageInput) {
    imageInput.addEventListener('change', renderPreview);
  }

  form.addEventListener('submit', () => {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Running...';
    }
    if (submitStatus) {
      submitStatus.textContent = 'Waiting for synchronous gateway response.';
    }
  });

  window.addEventListener('beforeunload', clearObjectUrls);
})();
