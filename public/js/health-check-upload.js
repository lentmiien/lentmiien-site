(() => {
  'use strict';
  const root = document.getElementById('health-check-upload'); if (!root) return;
  const $ = id => document.getElementById(id);
  let report = null; let mappingControls = []; let preview = null; let reviewedInput = null; let busy = false;
  const message = text => { $('hc-upload-message').textContent = text; };
  function el(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
  function option(value, label) { const node = el('option', label); node.value = value; return node; }
  function invalidate() { preview = null; reviewedInput = null; $('hc-conflict-panel').hidden = true; }
  function resetMapping() { invalidate(); $('hc-mapping-panel').hidden = true; mappingControls = []; }
  function input() { return { report, notesYear: Number($('hc-notes-year').value), mappings: Object.fromEntries(mappingControls.map(control => [control.key, control.select.value === 'new' ? { id: 'new', category: control.category.value } : control.select.value])) }; }
  async function post(action, data) {
    const response = await fetch(`/health-check/api/import/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': root.dataset.csrf }, body: JSON.stringify(data) });
    const result = await response.json().catch(() => ({ error: 'Your session may have expired. Reload this page.' }));
    if (!response.ok) { if (response.status === 409) invalidate(); throw new Error(result.error || 'Request failed. Reload this page and try again.'); }
    return result;
  }
  async function work(action) {
    if (busy) return; busy = true;
    root.querySelectorAll('button, input, select').forEach(node => { node.dataset.wasDisabled = node.disabled ? '1' : '0'; node.disabled = true; });
    try { await action(); } catch (error) { message(error.message); }
    finally { root.querySelectorAll('button, input, select').forEach(node => { node.disabled = node.dataset.wasDisabled === '1'; delete node.dataset.wasDisabled; }); busy = false; }
  }
  $('hc-file').addEventListener('change', async () => {
    resetMapping(); report = null; $('hc-map').disabled = true; $('hc-notes-year').disabled = true;
    const file = $('hc-file').files[0]; if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Choose a JSON file no larger than 2 MB.');
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed.exams) || !parsed.exams.length) throw new Error('The JSON file must contain an exams array.');
      const years = [...new Set(parsed.exams.map(exam => String(exam.exam_date || '').slice(0, 4)))].sort().reverse();
      if (years.some(year => !/^\d{4}$/.test(year))) throw new Error('Each exam must have a valid exam_date.');
      report = parsed; $('hc-notes-year').replaceChildren(...years.map(year => option(year, year))); $('hc-notes-year').disabled = false; $('hc-map').disabled = false;
      message('File loaded. Confirm the report year, then review mappings.');
    } catch (error) { message(error instanceof SyntaxError ? 'This file is not valid JSON.' : error.message); }
  });
  $('hc-notes-year').addEventListener('change', resetMapping);
  $('hc-map').addEventListener('click', () => work(async () => {
    resetMapping(); const review = await post('mapping', input()); $('hc-mappings').replaceChildren();
    const catalog = [...review.catalog].sort((a, b) => `${a.category} ${a.name} ${a.original}`.localeCompare(`${b.category} ${b.name} ${b.original}`));
    mappingControls = review.sources.map((source, index) => {
      const row = el('div', null, 'hc-mapping'); row.append(el('h3', `${source.category} / ${source.name}`), el('p', source.original || 'No source label', 'hc-muted'));
      row.append(el('p', source.certain ? 'Exact known match' : 'Uncertain mapping — choose explicitly', source.certain ? 'hc-muted' : 'hc-alert'));
      const values = el('p', source.samples.map(sample => `${sample.date}: ${sample.value ?? sample.finding ?? 'No value'} ${sample.unit}`).join(' · '), 'hc-value'); row.append(values);
      const label = el('label', 'Save as measurement'); label.htmlFor = `mapping-${index}`;
      const select = el('select'); select.id = label.htmlFor;
      if (!source.certain) select.append(option('', 'Choose a category, create a new one, or skip'));
      select.append(option('new', 'Create / retain a distinct measurement'), option('skip', 'Skip this measurement'));
      for (const known of catalog) select.append(option(known.id, `${known.category} / ${known.name}${known.original ? ` · ${known.original}` : ''}${!source.certain && known.id === source.suggested ? ' — suggested' : ''}`));
      select.value = source.certain ? source.suggested : '';
      const categoryLabel = el('label', 'Category for a new measurement'); const category = el('input'); category.type = 'text'; category.maxLength = 240; category.value = source.category; category.id = `category-${index}`; categoryLabel.htmlFor = category.id;
      categoryLabel.hidden = category.hidden = true;
      select.addEventListener('change', () => { invalidate(); categoryLabel.hidden = category.hidden = select.value !== 'new'; }); category.addEventListener('input', invalidate);
      row.append(label, select, categoryLabel, category); $('hc-mappings').append(row);
      return { key: source.key, select, category };
    });
    $('hc-mapping-panel').hidden = false; message(`${review.sources.length} measurement mappings ready for review.`);
  }));
  $('hc-preview').addEventListener('click', () => work(async () => {
    if (mappingControls.some(control => !control.select.value || (control.select.value === 'new' && !control.category.value.trim()))) throw new Error('Choose a mapping for every uncertain measurement and name each new category.');
    const candidate = input(); const result = await post('preview', candidate); preview = result; reviewedInput = candidate;
    $('hc-import-counts').textContent = `${result.addedExams} new exams · ${result.addedMeasurements} new measurements · ${result.conflicts.length} changed fields · ${result.identical} identical fields ignored.`;
    $('hc-conflicts').replaceChildren();
    result.conflicts.forEach((conflict, index) => {
      const fieldset = el('fieldset', null, 'hc-conflict'); fieldset.append(el('legend', conflict.label));
      const grid = el('div', null, 'hc-grid');
      for (const [choice, title, value] of [['keep', 'Keep saved value', conflict.existing], ['import', 'Use uploaded value', conflict.incoming]]) {
        const label = el('label'); const radio = el('input'); radio.type = 'radio'; radio.name = `conflict-${index}`; radio.value = choice; radio.dataset.key = conflict.key;
        label.append(radio, document.createTextNode(` ${title}`), el('span', value == null || value === '' ? '(empty)' : String(value), 'hc-value')); grid.append(label);
      }
      fieldset.append(grid); $('hc-conflicts').append(fieldset);
    });
    $('hc-conflict-panel').hidden = false; message(result.conflicts.length ? 'Choose a value for every changed field, then save.' : 'Review complete. Save to add new entries; identical data will be ignored.');
    $('hc-conflict-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  $('hc-save').addEventListener('click', () => work(async () => {
    if (!preview || !reviewedInput) throw new Error('Compare the report again before saving.');
    const choices = Object.fromEntries([...$('hc-conflicts').querySelectorAll('input:checked')].map(node => [node.dataset.key, node.value]));
    if (Object.keys(choices).length !== preview.conflicts.length) throw new Error('Choose which value to save for every changed field.');
    const result = await post('commit', { ...reviewedInput, signature: preview.signature, choices }); resetMapping(); message(`${result.message} Return to history to view your results.`);
  }));
  $('hc-cancel').addEventListener('click', () => { invalidate(); message('Review cancelled. Nothing was saved.'); });
})();
