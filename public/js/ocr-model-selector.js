(() => {
  const selector = document.getElementById('ocrModel');
  const container = document.getElementById('ocrModelOptions');
  if (!selector || !container) return;
  const models = window.__OCR_MODEL_CATALOG__?.models || {};
  const drafts = {};
  let previousModel = null;
  const labels = {
    prompt: 'Prompt', max_new_tokens: 'Max new tokens', task: 'Task', max_pixels: 'Processor pixel budget',
    image_mode: 'Image mode', max_length: 'Max length', no_repeat_ngram_size: 'No-repeat n-gram size', ngram_window: 'N-gram window',
  };
  const help = {
    task: 'Text, table (OTSL), formula (LaTeX), code, layout, distorted layout, or scientific figure.',
    max_pixels: 'Layout tasks require at least 1073296 pixels. This does not change gateway image resizing.',
    image_mode: 'Base is faster; gundam uses slower, high-detail crops.',
    prompt: 'Leave blank to use the native model/task prompt. A custom prompt overrides the selected task prompt.',
  };
  function renderOptions() {
    if (previousModel) drafts[previousModel] = Object.fromEntries(Array.from(container.querySelectorAll('[name]'), input => [input.name, input.value]));
    const model = selector.value;
    const definition = models[model];
    if (!definition) return;
    container.replaceChildren();
    const parameters = Object.entries(definition.parameters).sort(([a], [b]) => Number(a === 'prompt') - Number(b === 'prompt'));
    for (const [name, spec] of parameters) {
      const label = document.createElement('label');
      label.htmlFor = name;
      label.textContent = labels[name] || name;
      const input = document.createElement(spec.enum ? 'select' : name === 'prompt' ? 'textarea' : 'input');
      input.id = name;
      input.name = name;
      if (spec.enum) {
        for (const value of spec.enum) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = value;
          input.append(option);
        }
      } else if (spec.type === 'integer') {
        input.type = 'number';
        input.step = '1';
        if (spec.minimum != null) input.min = spec.minimum;
        if (spec.maximum != null) input.max = spec.maximum;
        input.placeholder = `Default: ${spec.default}`;
      } else if (spec.max_length) input.maxLength = spec.max_length;
      const hunyuanDefault = name === 'prompt' ? window.__OCR_DEFAULTS__.prompt : window.__OCR_DEFAULTS__.maxNewTokens;
      input.value = drafts[model]?.[name] ?? (model === 'hunyuanocr' ? hunyuanDefault : spec.enum ? spec.default : '');
      if (model === 'hunyuanocr' && name === 'max_new_tokens') input.required = true;
      container.append(label, input);
      if (help[name] && model !== 'hunyuanocr') {
        const note = document.createElement('p');
        note.className = 'ocr-note';
        note.textContent = help[name];
        container.append(note);
      }
    }
    const note = document.getElementById('ocrModelNote');
    note.textContent = model === 'hunyuanocr'
      ? 'Default workflow with bounding boxes, layout editing, embeddings and receipt forwarding.'
      : 'Test this model and save its text and full JSON response. Blank fields use gateway defaults. Upload raster images up to 10 MB each.';
    const warning = document.getElementById('ocrModelWarning');
    warning.textContent = definition.warning || '';
    warning.hidden = !definition.warning;
    previousModel = model;
    updateLayoutMinimum();
  }
  function updateLayoutMinimum() {
    if (selector.value !== 'teleocr') return;
    const pixels = container.querySelector('[name="max_pixels"]');
    const task = container.querySelector('[name="task"]');
    if (pixels && task) pixels.min = ['layout', 'layout_distorted'].includes(task.value) ? 1073296 : models.teleocr.parameters.max_pixels.minimum;
  }
  selector.addEventListener('change', renderOptions);
  container.addEventListener('change', updateLayoutMinimum);
  renderOptions();
})();
