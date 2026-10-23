const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { JSDOM } = require('jsdom');
const sharedScript = fs.readFileSync(path.join(__dirname, '../../public/js/bin-packing.js'), 'utf8');
const editorScript = fs.readFileSync(path.join(__dirname, '../../public/js/smallest-box.js'), 'utf8')
  .replace(/^import .*\n/, '').replace('window.THREE = THREE;', '').replace("await import('/js/bin-packing.js');", '');
let dom, win;
const box = { id: '<img src=x onerror=alert(1)>', w: 20, d: 20, h: 20, emptyWeight: 0, maxLoadWeight: 10 };
const response = data => ({ ok: true, json: async () => data });
const flush = () => new Promise(resolve => setImmediate(resolve));
async function setup(smallest = true, options = {}) {
  const html = pug.renderFile(path.join(__dirname, smallest ? '../../views/bin_packing_smallest.pug' : '../../views/bin_packing.pug'), {
    canEditBoxes: true, ...options, csrfToken: 'A'.repeat(43), algorithms: ['laff', 'plain', 'bruteforce'],
  });
  dom = new JSDOM(html, { url: 'https://site.test/', runScripts: 'outside-only' }); win = dom.window;
  win.fetch = jest.fn().mockImplementation(async url => response(url.endsWith('/api-keys') ? { keys: [] } : { containers: [box], revision: 3 }));
  win.eval(sharedScript); win.document.dispatchEvent(new win.Event('DOMContentLoaded'));
  if (smallest) await win.eval('(async () => {' + editorScript + '\n})()');
}
afterEach(() => dom?.window.close());
function items(csv = 'id,w,d,h,weight,qty\nitem,1,1,1,0,2') {
  const field = win.document.getElementById('itemsTextarea'); field.value = csv;
  field.dispatchEvent(new win.Event('input', { bubbles: true }));
}
function submit(id) { win.document.getElementById(id).dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true })); }

test('loads, edits, saves and removes boxes without interpreting names as HTML', async () => {
  await setup();
  expect(win.document.querySelector('#boxCatalogRows input').value).toBe(box.id);
  expect(win.document.querySelector('#boxCatalogRows img')).toBeNull();
  win.document.querySelector('[data-add-box]').click();
  const row = win.document.querySelector('#boxCatalogRows').lastElementChild;
  for (const input of row.querySelectorAll('input')) input.value = input.dataset.field === 'id' ? 'new box' : input.dataset.field === 'tags' ? ' Small-Box, fold-box ' : '10';
  win.fetch.mockImplementation(async (_url, options) => response({ success: true, containers: JSON.parse(options.body).containers, revision: 4 }));
  submit('boxCatalogForm'); await flush();
  const [url, request] = win.fetch.mock.calls.at(-1);
  expect(url).toBe('/binpacking-smallest/containers'); expect(request.method).toBe('PUT');
  expect(JSON.parse(request.body).containers).toHaveLength(2);
  expect(JSON.parse(request.body).revision).toBe(3);
  expect(JSON.parse(request.body).containers[1].tags).toEqual(['small-box', 'fold-box']);
  expect(request.headers['X-CSRF-Token']).toBe('A'.repeat(43));
  row.querySelector('button').click(); submit('boxCatalogForm'); await flush();
  expect(JSON.parse(win.fetch.mock.calls.at(-1)[1].body).containers).toHaveLength(1);
});
test('sends items without a container and displays selected box and safe output', async () => {
  await setup(); items();
  win.fetch.mockResolvedValue(response({ success: true, container: box,
    meta: { attempts: 2, eligibleContainers: 3, filteredContainers: 1, containerId: box.id, totalItemCount: 2, algorithm: 'laff' },
    data: { success: true, containersUsed: 1, pallets: [{ ...box, containerId: box.id, placements: [] }] } }));
  submit('binPackForm'); await flush();
  const [url, request] = win.fetch.mock.calls.at(-1);
  expect(url).toBe('/binpacking-smallest/run');
  expect(JSON.parse(request.body)).toEqual({ algorithm: 'laff', safetyMarginMm: 10, items: [{ id: 'item', w: 1, d: 1, h: 1, weight: 0, qty: 2 }] });
  expect(win.document.querySelector('[data-request-status]').textContent).toContain('Tried 2 of 3');
  expect(win.document.querySelector('[data-meta-container]').textContent).toContain(box.id);
  expect(win.document.querySelector('#binPackOutput img')).toBeNull();
  expect(win.document.getElementById('binPackSubmit').textContent).toBe('Find smallest box');
});
test('unsaved catalog and malformed CSV prevent accidentally searching a partial input', async () => {
  await setup(); items();
  win.document.querySelector('[data-add-box]').click();
  submit('binPackForm'); expect(win.fetch).toHaveBeenCalledTimes(1);
  expect(win.document.querySelector('[data-request-status]').textContent).toContain('Save your box changes');
  win.document.getElementById('binPackForm').dataset.catalogDirty = 'false';
  items('id,w,d,h,weight,qty\nitem,1,1,1,0,2\nbad,0,1,1,0,1');
  submit('binPackForm'); expect(win.fetch).toHaveBeenCalledTimes(1);
  expect(win.document.querySelector('[data-request-status]').textContent).toContain('Fix the CSV');
});
test('margin is editable and alternatives display their own weights, box dimensions and placements', async () => {
  await setup(); items();
  win.document.getElementById('safetyMarginMm').value = '5';
  const solution = (id, size, weight) => ({ success: true, container: { ...box, id, w: size },
    estimatedCushionWeight: weight, estimatedShipmentWeight: weight + 1,
    meta: { safetyMarginMm: 5, emptyVolume: 4000, containerVolume: size * 400, algorithm: 'laff', totalItemCount: 2 },
    data: { success: true, pallets: [{ containerId: id, w: size, d: 20, h: 20,
      placements: [{ itemId: 'item', x: 5, y: 5, z: 5, w: 1, d: 1, h: 1 }] }] } });
  win.fetch.mockResolvedValue(response({ ...solution('small', 30, 0.1), alternatives: [solution('<img src=x>', 40, 0.2)] }));
  submit('binPackForm'); await flush();
  expect(JSON.parse(win.fetch.mock.calls.at(-1)[1].body).safetyMarginMm).toBe(5);
  const choices = win.document.querySelector('[data-solution-options]');
  expect(choices.hidden).toBe(false);
  expect(choices.children).toHaveLength(2);
  expect(choices.children[0].getAttribute('aria-pressed')).toBe('true');
  expect(win.document.getElementById('binPackOutput').textContent).toContain('0.1 kg');
  choices.children[1].click();
  expect(win.document.querySelector('[data-meta-container]').textContent).toContain('<img src=x>');
  expect(choices.children[1].getAttribute('aria-pressed')).toBe('true');
  const output = win.document.getElementById('binPackOutput');
  expect(output.textContent).toContain('0.2 kg');
  expect(output.textContent).toContain('1.2 kg');
  expect(output.textContent).toContain('origin (5, 5, 5)');
  expect(output.textContent).toContain('40 x 20 x 20');
  expect(choices.querySelector('img')).toBeNull();
  win.fetch.mockResolvedValue(response({ success: false, message: 'No fit', meta: {} }));
  submit('binPackForm'); await flush();
  expect(choices.hidden).toBe(true);
  expect(choices.children).toHaveLength(0);
});
test.each(['', '-1', '500001'])('invalid margin %p is rejected before submitting', async value => {
  await setup(); items();
  win.document.getElementById('safetyMarginMm').value = value;
  submit('binPackForm');
  expect(win.fetch).toHaveBeenCalledTimes(1);
  expect(win.document.querySelector('[data-request-status]').textContent).toContain('Safety margin');
});
test('original page still submits its fixed container to the original route', async () => {
  await setup(false); items();
  for (const [id, value] of Object.entries({ containerId: 'old', containerWidth: 10, containerDepth: 10,
    containerHeight: 10, containerEmptyWeight: 0, containerMaxLoadWeight: 10 })) win.document.getElementById(id).value = value;
  win.fetch.mockResolvedValue(response({ success: true, data: { success: true, pallets: [] }, meta: {} }));
  submit('binPackForm'); await flush();
  expect(win.fetch.mock.calls[0][0]).toBe('/binpacking/run');
  expect(JSON.parse(win.fetch.mock.calls[0][1].body).container.id).toBe('old');
  expect(win.document.getElementById('binPackSubmit').textContent).toBe('Run packing');
});

test('catalog is collapsed below results; saved tags populate filters and serialize exclusions', async () => {
  await setup();
  const details = win.document.querySelector('details.bin-pack__catalog');
  expect(details.open).toBe(false);
  expect(win.document.getElementById('binPackOutput').compareDocumentPosition(details) & win.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const tags = win.document.querySelector('[data-field="tags"]');
  tags.value = 'tube, fold-box'; tags.dispatchEvent(new win.Event('input', { bubbles: true }));
  win.fetch.mockImplementation(async (_url, options) => response({ success: true, containers: JSON.parse(options.body).containers, revision: 4 }));
  submit('boxCatalogForm'); await flush();
  const filter = win.document.querySelector('[data-box-tag="tube"]'); filter.value = 'requireNot';
  filter.dispatchEvent(new win.Event('change'));
  expect(win.document.querySelector('[data-filter-count]').textContent).toContain('0 of 1');
  items(); win.fetch.mockResolvedValue(response({ success: false, message: 'No fit', meta: {} }));
  submit('binPackForm'); await flush();
  expect(JSON.parse(win.fetch.mock.calls.at(-1)[1].body).tagFilter).toEqual({ require: [], requireNot: ['tube'] });
});

test('ordinary readers can inspect boxes and search while catalog mutation controls are disabled', async () => {
  await setup(true, { canEditBoxes: false });
  expect(win.document.querySelector('[data-add-box]')).toBeNull();
  expect(win.document.querySelector('[data-save-boxes]')).toBeNull();
  expect([...win.document.querySelectorAll('#boxCatalogRows input')].every(input => input.disabled)).toBe(true);
  expect(win.document.querySelector('#packingApiKeyForm')).toBeNull();
  submit('boxCatalogForm'); await flush();
  expect(win.fetch).toHaveBeenCalledTimes(1);
});
test('API key controls show the new secret once and revoke through the protected route', async () => {
  await setup(true, { canManagePackingApi: true });
  const key = { id: 'c'.repeat(24), label: '<img src=x onerror=alert(1)>', expiresAt: '2027-01-01' };
  let active = false;
  win.fetch.mockImplementation(async (url, options) => {
    if (options.method === 'POST') { active = true; return response({ ...key, secret: 'synthetic-key' }); }
    if (options.method === 'DELETE') { active = false; return response({ success: true }); }
    return response({ keys: active ? [key] : [] });
  });
  win.document.getElementById('packingKeyLabel').value = 'client';
  submit('packingApiKeyForm'); await flush();
  const secret = win.document.getElementById('packingApiSecret');
  expect(secret.value).toBe('synthetic-key');
  expect(win.document.querySelector('[data-api-secret-panel]').hidden).toBe(false);
  expect(win.document.querySelector('[data-api-keys] img')).toBeNull();
  win.document.querySelector('[data-hide-api-secret]').click();
  expect(secret.value).toBe('');
  win.document.querySelector('[data-api-keys] button').click(); await flush();
  const mutation = win.fetch.mock.calls.find(([url, options]) => url.endsWith(key.id) && options.method === 'DELETE');
  expect(mutation[1].headers['X-CSRF-Token']).toBe('A'.repeat(43));
  expect(win.document.querySelector('[data-api-keys]').children).toHaveLength(0);
});
