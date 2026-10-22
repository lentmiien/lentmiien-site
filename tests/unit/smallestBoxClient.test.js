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
async function setup(smallest = true) {
  const html = pug.renderFile(path.join(__dirname, smallest ? '../../views/bin_packing_smallest.pug' : '../../views/bin_packing.pug'), {
    csrfToken: 'A'.repeat(43), algorithms: ['laff', 'plain', 'bruteforce'],
  });
  dom = new JSDOM(html, { url: 'https://site.test/', runScripts: 'outside-only' }); win = dom.window;
  win.fetch = jest.fn().mockResolvedValue(response({ containers: [box] }));
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
  for (const input of row.querySelectorAll('input')) input.value = input.dataset.field === 'id' ? 'new box' : '10';
  win.fetch.mockResolvedValue(response({ success: true }));
  submit('boxCatalogForm'); await flush();
  const [url, request] = win.fetch.mock.calls.at(-1);
  expect(url).toBe('/binpacking-smallest/containers'); expect(request.method).toBe('PUT');
  expect(JSON.parse(request.body).containers).toHaveLength(2);
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
  expect(JSON.parse(request.body)).toEqual({ algorithm: 'laff', items: [{ id: 'item', w: 1, d: 1, h: 1, weight: 0, qty: 2 }] });
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
