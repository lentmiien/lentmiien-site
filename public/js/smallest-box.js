import * as THREE from '/vendor/three/build/three.module.js';
window.THREE = THREE;
await import('/js/bin-packing.js');

const packingForm = document.getElementById('binPackForm');
const form = document.getElementById('boxCatalogForm');
const rows = document.getElementById('boxCatalogRows');
const status = document.querySelector('[data-catalog-status]');
const add = document.querySelector('[data-add-box]');
const save = document.querySelector('[data-save-boxes]');
const fields = { id: 'Box ID', w: 'Width (mm)', d: 'Depth (mm)', h: 'Height (mm)',
  emptyWeight: 'Empty weight (kg)', maxLoadWeight: 'Max load weight (kg)' };
let serial = 0;
let busy = false;

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('bin-pack__status--error', error);
}
function dirty() {
  packingForm.dataset.catalogDirty = 'true';
  setStatus('Unsaved changes. Save boxes before searching.');
}
function updateButtons() {
  add.disabled = busy || rows.children.length >= 30;
  save.disabled = busy;
}
function addRow(box = {}) {
  const row = document.createElement('fieldset');
  row.className = 'bin-pack__fieldset';
  const legend = document.createElement('legend');
  legend.className = 'bin-pack__legend';
  legend.textContent = 'Available box';
  row.append(legend);
  const grid = document.createElement('div');
  grid.className = 'bin-pack__input-grid';
  for (const [key, title] of Object.entries(fields)) {
    const field = document.createElement('div');
    field.className = 'bin-pack__field';
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.id = 'saved-box-' + (++serial);
    label.htmlFor = input.id;
    label.textContent = title;
    input.dataset.field = key;
    input.className = 'bin-pack__input';
    input.required = true;
    input.type = key === 'id' ? 'text' : 'number';
    if (key === 'id') input.maxLength = 100;
    else {
      input.min = ['w', 'd', 'h'].includes(key) ? '0.000001' : '0';
      input.max = '1000000';
      input.step = 'any';
    }
    input.value = box[key] ?? (['emptyWeight', 'maxLoadWeight'].includes(key) ? 0 : '');
    field.append(label, input);
    grid.append(field);
  }
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'bin-pack__secondary';
  remove.textContent = 'Remove box';
  remove.addEventListener('click', () => { if (!busy) { row.remove(); dirty(); updateButtons(); } });
  row.append(grid, remove);
  rows.append(row);
  updateButtons();
}
async function request(options = {}) {
  const response = await fetch('/binpacking-smallest/containers', {
    ...options, headers: { Accept: 'application/json', 'Content-Type': 'application/json',
      'X-CSRF-Token': packingForm.dataset.csrf },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || data?.error || 'Could not access the box list. Reload and try again.');
  return data;
}
form.addEventListener('input', dirty);
add.addEventListener('click', () => {
  if (rows.children.length >= 30 || busy) return;
  addRow(); dirty(); rows.lastElementChild.querySelector('input').focus();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || packingForm.dataset.catalogReady !== 'true' || !form.reportValidity()) return;
  const containers = Array.from(rows.children, row => Object.fromEntries(
    Array.from(row.querySelectorAll('input'), input => [input.dataset.field,
      input.dataset.field === 'id' ? input.value.trim() : Number(input.value)])));
  if (new Set(containers.map(box => box.id)).size !== containers.length) {
    setStatus('Each box needs a unique ID.', true); return;
  }
  busy = true;
  updateButtons();
  for (const row of rows.children) row.disabled = true;
  setStatus('Saving boxes…');
  try {
    await request({ method: 'PUT', body: JSON.stringify({ containers }) });
    packingForm.dataset.catalogDirty = 'false';
    setStatus('Saved ' + containers.length + ' available boxes.');
  } catch (error) { setStatus(error.message, true); }
  finally {
    busy = false;
    for (const row of rows.children) row.disabled = false;
    updateButtons();
  }
});
try {
  const data = await request();
  data.containers.forEach(addRow);
  packingForm.dataset.catalogReady = 'true';
  packingForm.dataset.catalogDirty = 'false';
  updateButtons();
  setStatus(data.containers.length ? 'Loaded ' + data.containers.length + ' saved boxes.' : 'No saved boxes yet. Add your available boxes to begin.');
} catch (error) { setStatus(error.message, true); }
