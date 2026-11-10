(() => {
  'use strict';
  const root = document.getElementById('decision-app');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const storageKey = `decisions:v1:${root.dataset.storageScope}`;
  const state = { model: '', input: '', questions: [], result: null };
  let imageData;
  let imageVersion = 0;
  let active;
  let catalogVersion = 0;
  let sequence = 0;
  const typeNames = { predicate: 'Yes/no assessment', choice: 'Choose a value', score: 'Ordered score' };
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function status(message, error = false) {
    $('decision-status').textContent = message;
    $('decision-status').classList.toggle('error', error);
  }
  function save() {
    try { sessionStorage.setItem(storageKey, JSON.stringify(state)); }
    catch (_) { status('Browser session storage is unavailable or full. The form and results will remain only until this page closes.', true); }
  }
  function field(parent, labelText, tag, value, change, options = {}) {
    const wrapper = element('div');
    const id = `decision-field-${++sequence}`;
    const label = element('label', labelText); label.htmlFor = id;
    const control = element(tag); control.id = id;
    if (tag === 'input') { control.type = 'text'; control.maxLength = 6000; }
    if (tag === 'select') for (const choice of options.choices || []) {
      const option = element('option', choice.label); option.value = choice.value; control.append(option);
    }
    Object.assign(control, options.attributes || {});
    control.value = value;
    control.addEventListener(tag === 'select' ? 'change' : 'input', () => { change(control.value); save(); });
    wrapper.append(label, control); parent.append(wrapper);
    return control;
  }
  function button(parent, title, action) {
    const control = element('button', title); control.type = 'button';
    control.addEventListener('click', action); parent.append(control); return control;
  }
  function addQuestion(type) {
    if (state.questions.length >= 32) return status('Use at most 32 questions.', true);
    state.questions.push({ type, instructions: '', ...(type === 'choice' ? { choices: [{ value: '', description: '' }, { value: '', description: '' }] } : type === 'score' ? { levels: [{ label: 'low', description: '' }, { label: 'high', description: '' }] } : {}) });
    renderQuestions(); save();
  }
  function renderQuestions() {
    const container = $('decision-questions'); container.replaceChildren();
    state.questions.forEach((question, index) => {
      const card = element('section', undefined, 'question');
      card.append(element('h3', `${index + 1}. ${typeNames[question.type]}`));
      field(card, 'Name (optional, unique)', 'input', question.name || '', value => { if (value) question.name = value; else delete question.name; });
      field(card, 'Instructions', 'textarea', question.instructions, value => { question.instructions = value; }, { attributes: { required: true, maxLength: 2000, rows: 2 } });
      if (question.type !== 'predicate') {
        const isChoice = question.type === 'choice';
        const items = isChoice ? question.choices : question.levels;
        card.append(element('p', isChoice ? 'Choose text or boolean for each value. Values must be unique, including their type.' : 'Levels run from lowest to highest. Scores are probability-weighted zero-based indices.', 'help'));
        items.forEach((item, itemIndex) => {
          const row = element('div', undefined, `option-row${isChoice ? '' : ' score-row'}`);
          if (isChoice) {
            field(row, 'Value type', 'select', typeof item.value === 'boolean' ? 'boolean' : 'string', value => {
              item.value = value === 'boolean' ? true : ''; renderQuestions();
            }, { choices: [{ value: 'string', label: 'Text' }, { value: 'boolean', label: 'Boolean' }] });
            if (typeof item.value === 'boolean') {
              field(row, `Choice ${itemIndex + 1}`, 'select', String(item.value), value => { item.value = value === 'true'; }, { choices: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }] });
            } else field(row, `Choice ${itemIndex + 1}`, 'input', item.value, value => { item.value = value; });
          } else field(row, `Level ${itemIndex} label`, 'input', item.label, value => { item.label = value; }, { attributes: { required: true } });
          field(row, 'Description (optional)', 'input', item.description || '', value => { item.description = value; });
          const remove = button(row, 'Remove option', () => { items.splice(itemIndex, 1); renderQuestions(); save(); });
          remove.disabled = items.length <= 2;
          card.append(row);
        });
        const add = button(card, isChoice ? 'Add choice' : 'Add level', () => { items.push(isChoice ? { value: '', description: '' } : { label: '', description: '' }); renderQuestions(); save(); });
        add.disabled = items.length >= (isChoice ? 255 : 10);
      }
      const actions = element('div', undefined, 'actions');
      button(actions, 'Remove question', () => { state.questions.splice(index, 1); renderQuestions(); save(); });
      card.append(actions); container.append(card);
    });
    for (const type of Object.keys(typeNames)) $(`add-${type}`).disabled = state.questions.length >= 32;
  }
  function renderResult() {
    const result = state.result;
    $('decision-results').hidden = !result;
    const summary = $('answer-summary'); summary.replaceChildren();
    $('decision-raw').textContent = result ? JSON.stringify(result, null, 2) : '';
    if (!result) return;
    summary.append(element('p', `Model: ${result.model}`));
    (result.answers || []).forEach((answer, index) => {
      const card = element('article', undefined, 'answer');
      card.append(element('h3', `${index + 1}. ${answer.name || answer.type}`));
      if (answer.type === 'refusal') card.append(element('p', `Refused: ${typeof answer.refusal === 'string' ? answer.refusal : 'The provider declined this question. See the full response.'}`));
      else if (answer.type === 'predicate') card.append(element('p', `Yes probability: ${answer.probability} (threshold is chosen by the caller)`));
      else if (answer.type === 'choice') card.append(element('p', `Choice: ${JSON.stringify(answer.choice)} · Confidence: ${answer.confidence}`));
      else if (answer.type === 'score') card.append(element('p', `Score: ${answer.score} (zero-based weighted mean) · Confidence: ${answer.confidence}`));
      if (answer.probabilities) card.append(element('pre', JSON.stringify(answer.probabilities, null, 2)));
      summary.append(card);
    });
  }
  async function readResponse(response) {
    let data;
    try { data = await response.json(); }
    catch (_) { throw new Error(`Request failed (HTTP ${response.status}). Reload to check your login and permissions.`); }
    if (!response.ok) throw new Error(`${data.error || 'Request failed.'}${response.headers.get('Retry-After') ? ` Retry after ${response.headers.get('Retry-After')} seconds.` : ''}`);
    return data;
  }
  async function loadModels() {
    const version = ++catalogVersion;
    $('run-decision').disabled = true;
    $('catalog-status').textContent = 'Loading model catalog…';
    try {
      const response = await fetch('/admin/decisions/models', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      const catalog = await readResponse(response);
      if (version !== catalogVersion) return;
      $('decision-model').replaceChildren();
      for (const model of catalog.models) {
        const option = element('option', `${model.id} · ${model.provider}${model.configured === false ? ' · credentials missing' : ''}`);
        option.value = model.id; option.disabled = model.configured === false;
        $('decision-model').append(option);
      }
      const selected = catalog.models.find(model => model.id === state.model && model.configured !== false) || catalog.models.find(model => model.configured !== false);
      state.model = selected?.id || '';
      $('decision-model').value = state.model;
      $('run-decision').disabled = !selected;
      $('catalog-status').textContent = 'Local models use the Gateway GPU queue. OpenAI uses the configured cloud account. Requests may take up to 20 minutes.';
      save();
    } catch (error) { if (version === catalogVersion) $('catalog-status').textContent = error.message; }
  }
  $('decision-input').addEventListener('input', event => { state.input = event.target.value; save(); });
  $('decision-model').addEventListener('change', event => { state.model = event.target.value; save(); });
  $('refresh-models').addEventListener('click', loadModels);
  for (const type of Object.keys(typeNames)) $(`add-${type}`).addEventListener('click', () => addQuestion(type));
  function removeImage() {
    imageVersion += 1; imageData = undefined; $('decision-image').value = '';
    $('image-status').textContent = 'No image selected.';
  }
  $('remove-image').addEventListener('click', removeImage);
  $('decision-image').addEventListener('change', async event => {
    const version = ++imageVersion; imageData = undefined;
    const file = event.target.files[0];
    if (!file) return removeImage();
    $('image-status').textContent = 'Reading image…';
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) throw new Error('Choose a PNG, JPEG or WebP no larger than 5 MiB.');
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Unable to read this image.')); reader.readAsDataURL(file);
      });
      if (version !== imageVersion) return;
      imageData = data; $('image-status').textContent = `${file.name} selected. Image dimensions and content will be checked before inference.`;
    } catch (error) { if (version === imageVersion) { removeImage(); $('image-status').textContent = error.message; } }
  });
  $('clear-session').addEventListener('click', () => {
    state.input = ''; state.questions = []; state.result = null;
    $('decision-input').value = ''; removeImage(); renderQuestions(); renderResult(); status('Session form and result cleared.');
    try { sessionStorage.removeItem(storageKey); } catch (_) { /* No persistent state when storage is unavailable. */ }
  });
  $('cancel-decision').addEventListener('click', () => active?.abort());
  $('decision-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (active) return;
    if (!state.questions.length) return status('Add at least one question.', true);
    if (!state.input.trim() && !imageData) return status('Enter evidence text or select an image.', true);
    if ($('decision-image').files.length && !imageData) return status('Wait for the image to finish loading.', true);
    const payload = { model: state.model, input: state.input, questions: state.questions, ...(imageData ? { image_data_url: imageData } : {}) };
    active = new AbortController();
    $('decision-fields').disabled = true; $('cancel-decision').hidden = false;
    status('Waiting for the Gateway. Local queueing and model startup may take several minutes.');
    try {
      const response = await fetch('/admin/decisions', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': root.dataset.csrf }, body: JSON.stringify(payload), signal: active.signal, cache: 'no-store' });
      state.result = await readResponse(response); renderResult(); status('Decision request completed.'); save();
    } catch (error) { status(error.name === 'AbortError' ? 'Request cancelled. The Gateway will clean up any active local work.' : error.message, true); }
    finally { active = null; $('decision-fields').disabled = false; $('cancel-decision').hidden = true; }
  });
  window.addEventListener('pagehide', () => active?.abort());
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey));
    if (saved && typeof saved.input === 'string' && Array.isArray(saved.questions) && saved.questions.length <= 32
      && saved.questions.every(question => Object.hasOwn(typeNames, question.type) && typeof question.instructions === 'string'
        && (question.type !== 'choice' || Array.isArray(question.choices)) && (question.type !== 'score' || Array.isArray(question.levels)))) Object.assign(state, saved);
  } catch (_) { /* A fresh tab or unavailable storage starts with a blank form. */ }
  $('decision-input').value = state.input;
  renderQuestions(); renderResult(); loadModels();
})();
