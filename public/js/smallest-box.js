import * as THREE from '/vendor/three/build/three.module.js';
window.THREE = THREE;
await import('/js/bin-packing.js');

const packingForm = document.getElementById('binPackForm');
const form = document.getElementById('boxCatalogForm');
const rows = document.getElementById('boxCatalogRows');
const status = document.querySelector('[data-catalog-status]');
const add = document.querySelector('[data-add-box]');
const save = document.querySelector('[data-save-boxes]');
const canEdit = form.dataset.canEdit === 'true';
const fields = { id: 'Box ID', w: 'Width (mm)', d: 'Depth (mm)', h: 'Height (mm)',
  emptyWeight: 'Empty weight (kg)', maxLoadWeight: 'Max load weight (kg)', tags: 'Tags' };
let busy = false;
let revision = 0;
let savedBoxes = [];

function setStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle('bin-pack__status--error', error);
}
function dirty() {
  packingForm.dataset.catalogDirty = 'true';
  setStatus('Unsaved changes. Save boxes before searching.');
  updateButtons();
}
function updateButtons() {
  if (add) add.disabled = busy || rows.children.length >= 50;
  if (save) save.disabled = busy;
  document.querySelector('[data-catalog-count]').textContent = rows.children.length + ' / 50 boxes';
}
function updateFilterCount() {
  const excluded = Array.from(document.querySelectorAll('[data-box-tag]'))
    .filter(select => select.value === 'requireNot').map(select => select.dataset.boxTag);
  const included = savedBoxes.filter(box => !(box.tags || []).some(tag => excluded.includes(tag))).length;
  document.querySelector('[data-filter-count]').textContent = included + ' of ' + savedBoxes.length + ' boxes included before size and weight checks.';
}
function renderFilters() {
  const target = document.querySelector('[data-tag-filters]');
  const previous = new Map(Array.from(target.querySelectorAll('select'), select => [select.dataset.boxTag, select.value]));
  target.replaceChildren();
  const tags = [...new Set(savedBoxes.flatMap(box => box.tags || []))].sort();
  for (const tag of tags) {
    const label = document.createElement('label');
    label.className = 'bin-pack__tag-filter';
    const name = document.createElement('span'); name.textContent = tag;
    const select = document.createElement('select');
    select.className = 'bin-pack__select'; select.dataset.boxTag = tag;
    for (const [value, text] of [['', 'Default'], ['require', 'Require'], ['requireNot', 'Require not']]) {
      const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option);
    }
    select.value = previous.get(tag) || '';
    select.addEventListener('change', updateFilterCount);
    label.append(name, select); target.append(label);
  }
  if (!tags.length) target.textContent = 'No box tags yet. All shared boxes are included.';
  updateFilterCount();
}
function addRow(box = {}) {
  const row = document.createElement('tr');
  for (const [key, title] of Object.entries(fields)) {
    const cell = document.createElement('td');
    const input = document.createElement('input');
    input.dataset.field = key;
    input.setAttribute('aria-label', title);
    input.className = 'bin-pack__input';
    input.required = key !== 'tags';
    input.disabled = !canEdit;
    input.type = ['id', 'tags'].includes(key) ? 'text' : 'number';
    if (key === 'id') input.maxLength = 100;
    else if (key === 'tags') { input.maxLength = 838; input.placeholder = 'small-box, fold-box'; }
    else {
      input.min = ['w', 'd', 'h'].includes(key) ? '0.000001' : '0';
      input.max = '1000000'; input.step = 'any';
    }
    input.value = key === 'tags' ? (box.tags || []).join(', ') : box[key] ?? (['emptyWeight', 'maxLoadWeight'].includes(key) ? 0 : '');
    cell.append(input); row.append(cell);
  }
  const action = document.createElement('td');
  if (canEdit) {
    const remove = document.createElement('button');
    remove.type = 'button'; remove.className = 'bin-pack__secondary'; remove.textContent = 'Remove';
    remove.addEventListener('click', () => { if (!busy) { row.remove(); dirty(); } });
    action.append(remove);
  }
  row.append(action); rows.append(row); updateButtons();
}
async function request(url, options = {}) {
  const response = await fetch('/binpacking-smallest' + url, { ...options,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': packingForm.dataset.csrf } });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || data?.error || 'The operation failed. Reload and try again.');
  return data;
}
form.addEventListener('input', dirty);
add?.addEventListener('click', () => {
  if (rows.children.length >= 50 || busy) return;
  addRow(); dirty(); rows.lastElementChild.querySelector('input').focus();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!canEdit || busy || packingForm.dataset.catalogReady !== 'true' || !form.reportValidity()) return;
  const containers = Array.from(rows.children, row => Object.fromEntries(
    Array.from(row.querySelectorAll('input'), input => [input.dataset.field, input.dataset.field === 'tags'
      ? [...new Set(input.value.split(',').map(tag => tag.trim().toLowerCase()).filter(Boolean))]
      : input.dataset.field === 'id' ? input.value.trim() : Number(input.value)])));
  if (new Set(containers.map(box => box.id)).size !== containers.length) {
    setStatus('Each box needs a unique ID.', true); return;
  }
  if (containers.some(box => box.tags.length > 20 || box.tags.some(tag => !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(tag)))) {
    setStatus('Use up to 20 tags per box, each 1–40 letters, numbers, hyphens or underscores.', true); return;
  }
  busy = true; updateButtons();
  rows.querySelectorAll('input, button').forEach(control => { control.disabled = true; });
  setStatus('Saving shared boxes…');
  try {
    const data = await request('/containers', { method: 'PUT', body: JSON.stringify({ containers, revision }) });
    revision = data.revision; savedBoxes = data.containers;
    packingForm.dataset.catalogDirty = 'false'; renderFilters();
    setStatus('Saved ' + containers.length + ' shared boxes.');
  } catch (error) { setStatus(error.message, true); }
  finally {
    busy = false; rows.querySelectorAll('input, button').forEach(control => { control.disabled = false; }); updateButtons();
  }
});
try {
  const data = await request('/containers');
  savedBoxes = data.containers; revision = data.revision;
  savedBoxes.forEach(addRow); renderFilters();
  packingForm.dataset.catalogReady = 'true'; packingForm.dataset.catalogDirty = 'false'; updateButtons();
  setStatus(savedBoxes.length ? 'Loaded ' + savedBoxes.length + ' shared boxes.' : 'No shared boxes yet. An administrator can add boxes below.');
} catch (error) {
  setStatus(error.message, true);
  document.querySelector('[data-catalog-count]').textContent = 'unavailable';
  document.querySelector('[data-filter-count]').textContent = 'Shared boxes unavailable: ' + error.message;
}

const keyForm = document.getElementById('packingApiKeyForm');
if (keyForm) {
  const keyStatus = document.querySelector('[data-api-status]');
  const secretPanel = document.querySelector('[data-api-secret-panel]');
  const secret = document.getElementById('packingApiSecret');
  const hideSecret = () => { secret.value = ''; secretPanel.hidden = true; };
  document.querySelector('[data-hide-api-secret]').addEventListener('click', hideSecret);
  window.addEventListener('pagehide', hideSecret);
  async function loadKeys() {
    const data = await request('/api-keys');
    const list = document.querySelector('[data-api-keys]'); list.replaceChildren();
    for (const key of data.keys) {
      const item = document.createElement('li');
      item.append(document.createTextNode(key.label + ' — expires ' + new Date(key.expiresAt).toLocaleDateString()));
      const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'bin-pack__secondary'; revoke.textContent = 'Revoke';
      revoke.addEventListener('click', async () => {
        revoke.disabled = true;
        try { await request('/api-keys/' + encodeURIComponent(key.id), { method: 'DELETE' }); hideSecret(); await loadKeys(); keyStatus.textContent = 'API key revoked.'; }
        catch (error) { keyStatus.textContent = error.message; revoke.disabled = false; }
      });
      item.append(revoke); list.append(item);
    }
  }
  keyForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (!keyForm.reportValidity()) return;
    const button = keyForm.querySelector('button'); button.disabled = true;
    try {
      const result = await request('/api-keys', { method: 'POST', body: JSON.stringify({
        label: document.getElementById('packingKeyLabel').value, days: Number(document.getElementById('packingKeyDays').value) }) });
      secret.value = result.secret; secretPanel.hidden = false;
      keyStatus.textContent = 'API key created. Copy it before leaving this page.';
      await loadKeys();
    } catch (error) { keyStatus.textContent = error.message; }
    finally { button.disabled = false; }
  });
  try { await loadKeys(); } catch (error) { keyStatus.textContent = error.message; }
}
