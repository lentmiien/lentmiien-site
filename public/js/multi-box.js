import { parseItems } from './multi-box-input.js';
import { createPreview, itemColor } from './multi-box-preview.js';

const $ = id => document.getElementById(id);
const form = $('multiBoxForm');
const status = $('multiStatus');
let jobId = null; let timer; let busy = false; let generation = 0; let result = null; let catalogReady = false;
const number = value => Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 });
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
function setBusy(value) {
  busy = value; $('multiSubmit').disabled = value || !catalogReady;
  $('multiResumeForm').querySelector('button').disabled = value;
  $('multiSubmit').textContent = value ? 'Packing…' : 'Pack into boxes';
}
async function request(path, options = {}) {
  const response = await fetch('/binpacking-multi' + path, { ...options, signal: AbortSignal.timeout(20000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-CSRF-Token': form.dataset.csrf } });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const error = new Error(data?.message || (typeof data?.error === 'string' && data.error) || 'Request failed. Reload the page if your session expired.');
    error.status = response.status; throw error;
  }
  return data;
}
async function loadBoxes() {
  catalogReady = false; setBusy(busy); $('multiCatalogStatus').textContent = 'Loading boxes…';
  $('multiReloadBoxes').disabled = true;
  try {
    const data = await request('/containers'); $('multiBoxes').replaceChildren();
    data.containers.forEach(box => {
      const label = element('label', undefined, 'multi-pack__box-option');
      const input = document.createElement('input'); input.type = 'checkbox'; input.value = box.id; input.checked = true;
      label.append(input, element('span', `${box.id} · ${[box.width, box.height, box.depth].map(number).join(' × ')} cm (W × H × D) · max ${number(box.max_weight)} kg · tare ${number(box.emptyWeight)} kg${box.tags.length ? ' · ' + box.tags.join(', ') : ''}`));
      $('multiBoxes').append(label);
    });
    catalogReady = data.containers.length > 0;
    $('multiCatalogStatus').textContent = `${data.containers.length} eligible sizes; ${data.excludedContainers} excluded with Max kg = 0. Unlimited supply of each selected size.`;
  } catch (error) { $('multiCatalogStatus').textContent = error.message; }
  finally { $('multiReloadBoxes').disabled = false; setBusy(busy); }
}
function overview() {
  try {
    const items = parseItems($('multiItems').value);
    $('multiItemSummary').textContent = `${items.length} item types · ${items.reduce((sum, item) => sum + (item.quantity ?? 1), 0)} total items · ${number(items.reduce((sum, item) => sum + (item.weight || 0) * (item.quantity ?? 1), 0))} kg`;
  } catch (error) { $('multiItemSummary').textContent = error.message; }
}
function details(title, data) {
  const node = element('details'); node.append(element('summary', title), element('pre', JSON.stringify(data, null, 2))); return node;
}
function renderResult(plan) {
  result = plan; $('multiExport').hidden = false;
  const output = $('multiResults'); output.replaceChildren();
  const summary = element('div', undefined, 'multi-pack__summary');
  summary.append(element('strong', `${plan.stats.packedItems} / ${plan.stats.inputItems} items packed`),
    element('strong', `${plan.boxes.length} boxes`), element('span', `${number(plan.stats.fill * 100)}% content utilization`),
    element('span', `${number(plan.boxes.reduce((sum, box) => sum + box.weightEstimate.estimatedShipmentWeight, 0))} kg estimated shipment total`));
  output.append(summary);
  if (plan.unplaced.length) {
    const warning = element('section', undefined, 'multi-pack__warning');
    warning.append(element('h3', `${plan.unplaced.length} unplaced items — this plan is incomplete`));
    const list = element('ul');
    plan.unplaced.forEach(item => list.append(element('li', `${item.id} (copy ${item.copy || 1}): ${item.reason}`)));
    warning.append(list); output.append(warning);
  }
  output.append(element('p', 'Previews show post-shrink rigid items. Soft items reserve volume without a position. Fragile cushion and diagonal envelopes contribute to reserved space. Use the manifest and exact coordinates when packing.', 'bin-pack__hint'));
  const plans = element('div', undefined, 'multi-pack__plans');
  for (const box of plan.boxes) {
    const card = element('section', undefined, 'multi-pack__plan'); const weight = box.weightEstimate;
    card.append(element('h3', `${box.id} · ${box.type}`), element('p', `${box.dimensions.map(number).join(' × ')} cm (W × H × D) · ${box.items.length} items`));
    try { card.append(createPreview(box)); }
    catch (_) { card.append(element('p', 'Preview unavailable: placement geometry is missing or invalid. See the exported details.', 'multi-pack__warning')); }
    card.append(element('p', `Items ${number(weight.itemWeight)} kg + box ${number(weight.emptyBoxWeight)} kg + cushion ${number(weight.estimatedCushionWeight)} kg`),
      element('strong', `Estimated shipment: ${number(weight.estimatedShipmentWeight)} kg`),
      element('p', `Empty space ${number(weight.emptyVolumeCm3 / 1000)} L · value ${number(box.value)} · reserved utilization ${number(box.usableVolume ? box.reservedVolume / box.usableVolume * 100 : 0)}%`));
    if (weight.exceedsMaxLoadWeight) card.append(element('p', `Weight warning: items + estimated cushion exceed the ${number(weight.maxLoadWeight)} kg content limit. Choose another box or split this load.`, 'multi-pack__warning'));
    if (box.fallback) card.append(element('p', `Preferred-limit exception: ${(box.fallbackReasons || []).join('; ') || 'An item needs a box outside your preferred limits.'}`, 'multi-pack__warning'));
    const scroll = element('div', undefined, 'multi-pack__scroll');
    const table = element('table', undefined, 'bin-pack__table');
    const head = element('thead'); const header = element('tr');
    ['Item / copy', 'Local size (cm)', 'kg', 'Handling'].forEach(title => { const cell = element('th', title); cell.scope = 'col'; header.append(cell); });
    head.append(header); table.append(head);
    const body = element('tbody');
    box.items.forEach((item, index) => {
      const row = element('tr'); const name = element('td');
      const swatch = element('span', undefined, 'multi-pack__legend'); swatch.style.backgroundColor = itemColor(index);
      name.append(swatch, document.createTextNode(`${item.id} / ${item.copy || 1}`));
      row.append(name, element('td', item.dimensions.map(number).join(' × ')), element('td', number(item.weight)),
        element('td', [item.soft ? 'Soft · no position' : item.rotation, item.fragile ? 'Fragile' : '', item.shrink ? `${item.shrink}% shrink` : ''].filter(Boolean).join(' · ')));
      body.append(row);
    });
    table.append(body); scroll.append(table); card.append(scroll, details('Exact box & placement details (cm)', box)); plans.append(card);
  }
  output.append(plans, details('Plan settings and coordinate system', { options: plan.options, units: plan.units, coordinates: plan.coordinates, stats: plan.stats }));
}
function displayJob(job, version) {
  if (version !== generation) return;
  jobId = job.jobId; $('multiJobId').value = jobId;
  if (job.status === 'completed') {
    setBusy(false); $('multiResume').hidden = true;
    status.textContent = `Job ${jobId} completed${job.result.unplaced.length ? ' with unplaced items' : ''}.`;
    renderResult(job.result); return;
  }
  if (job.status === 'failed') {
    setBusy(false); $('multiResume').hidden = true;
    status.textContent = `Job ${jobId} failed. ${job.error.message}`; return;
  }
  const progress = job.progress ? ` · ${job.progress.phase}: ${job.progress.done}/${job.progress.total}` : '';
  status.textContent = `Job ${jobId}: ${job.status}${job.status === 'queued' ? ` (queue position ${job.queuePosition})` : progress}. Checking again in 5 seconds…`;
  timer = setTimeout(() => poll(version), 5000);
}
async function poll(version) {
  try { displayJob(await request('/jobs/' + encodeURIComponent(jobId)), version); }
  catch (error) {
    if (version !== generation) return;
    if ([401, 403, 404].includes(error.status)) {
      setBusy(false); $('multiResume').hidden = false; status.textContent = error.message; return;
    }
    status.textContent = `Job ${jobId}: ${error.message} Checking again in 5 seconds…`;
    timer = setTimeout(() => poll(version), 5000);
  }
}
function reset() {
  clearTimeout(timer); generation += 1; result = null; $('multiResults').replaceChildren();
  $('multiExport').hidden = true; $('multiResume').hidden = true; setBusy(true); return generation;
}
form.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  let input;
  try {
    const items = parseItems($('multiItems').value);
    const options = { approach: $('multiApproach').value, margin: Number($('multiMargin').value) };
    ['maxSide', 'maxSum', 'maxWeight', 'maxValue'].forEach(key => { options[key] = form.elements[key].value === '' ? null : Number(form.elements[key].value); });
    const boxIds = [...$('multiBoxes').querySelectorAll('input:checked')].map(node => node.value);
    if (!boxIds.length) throw new Error('Select at least one box.');
    input = { items, options, boxIds };
  } catch (error) { status.textContent = error.message; return; }
  const version = reset(); jobId = null; $('multiJobId').value = ''; status.textContent = 'Submitting packing job…';
  try { displayJob(await request('/jobs', { method: 'POST', body: JSON.stringify(input) }), version); }
  catch (error) { setBusy(false); status.textContent = `${error.message} Submission was not retried automatically.`; }
});
$('multiResumeForm').addEventListener('submit', event => {
  event.preventDefault(); if (busy) return;
  const id = $('multiJobId').value.trim();
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) { status.textContent = 'Enter a valid job UUID.'; return; }
  const version = reset(); jobId = id; poll(version);
});
$('multiResume').addEventListener('click', () => { if (jobId && !busy) { const version = reset(); poll(version); } });
$('multiItems').addEventListener('input', overview);
$('multiSample').addEventListener('click', () => {
  $('multiItems').value = 'id,width,height,depth,quantity,weight,value,rotation,shrink,soft,fragile\nCamera,18,12,10,1,1.2,480,orthogonal,0,false,true\nPoster tube,44,3,3,1,0.18,20,free,0,false,false\nWool sweater,28,6,22,2,0.4,65,orthogonal,20,true,false'; overview();
});
$('multiClear').addEventListener('click', () => { $('multiItems').value = ''; overview(); });
$('multiItemsFile').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 262144) throw new Error('CSV file must be no larger than 256 KiB.');
    const text = await file.text(); parseItems(text); $('multiItems').value = text; overview();
  } catch (error) { status.textContent = error.message; }
  event.target.value = '';
});
$('multiReloadBoxes').addEventListener('click', loadBoxes);
for (const [id, checked] of [['multiSelectAll', true], ['multiSelectNone', false]]) {
  $(id).addEventListener('click', () => $('multiBoxes').querySelectorAll('input').forEach(node => { node.checked = checked; }));
}
$('multiExport').addEventListener('click', () => {
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `packing-${jobId}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
window.addEventListener('pagehide', () => { clearTimeout(timer); generation += 1; });
loadBoxes();
