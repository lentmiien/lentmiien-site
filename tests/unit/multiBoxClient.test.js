const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { JSDOM } = require('jsdom');
const { box, result, job, jobId } = require('../fixtures/multiBoxPlan');
const { addWeightEstimates, convertBoxes } = require('../../services/multiBoxService');
const source = name => fs.readFileSync(path.join(__dirname, '../../public/js/', name), 'utf8').replace(/^import .*\n/gm, '').replace(/^export /gm, '');
const script = [source('multi-box-input.js'), source('multi-box-preview.js'), source('multi-box.js'),
  'window.packingTest = { parseItems, itemCorners };'].join('\n');
let dom, win, timers;
const response = (data, status = 200) => ({ ok: status < 400, status, json: async () => data });
const flush = () => new Promise(resolve => setImmediate(resolve));
beforeEach(async () => {
  dom = new JSDOM(pug.renderFile(path.join(__dirname, '../../views/bin_packing_multi.pug'), { csrfToken: 'A'.repeat(43) }), {
    url: 'https://site.test/binpacking-multi', runScripts: 'outside-only',
  });
  win = dom.window; timers = [];
  win.AbortSignal.timeout = () => new win.AbortController().signal;
  win.setTimeout = jest.fn((callback, delay) => { timers.push({ callback, delay }); return timers.length; });
  win.clearTimeout = jest.fn();
  win.fetch = jest.fn().mockResolvedValue(response({ containers: convertBoxes([box]), excludedContainers: 1, revision: 1 }));
  win.eval(`(() => { ${script}\n})()`); await flush();
});
afterEach(() => dom.window.close());
const submit = id => win.document.getElementById(id).dispatchEvent(new win.Event('submit', { cancelable: true, bubbles: true }));
const csv = text => { win.document.getElementById('multiItems').value = text; };
test('loads eligible cm boxes safely and parses optional item fields and quoted CSV', () => {
  expect(win.document.getElementById('multiBoxes').textContent).toContain('40 × 30 × 20 cm');
  const items = win.packingTest.parseItems('\uFEFFid,width,height,depth,quantity,rotation,shrink,soft,fragile\r\n"Tube, long",44,3,3,2,free,20,no,yes\r\n"Soft\nitem",10,5,3,,,30,true,false');
  expect(items).toEqual([{ id: 'Tube, long', width: 44, height: 3, depth: 3, quantity: 2, rotation: 'free', shrink: 20, soft: false, fragile: true },
    { id: 'Soft\nitem', width: 10, height: 5, depth: 3, shrink: 30, soft: true, fragile: false }]);
});
test.each([
  'id,width,height,depth\na,1,1,1\na,1,1,1', 'id,width,height,depth,secret\na,1,1,1,x',
  'id,width,height,depth,soft\na,1,1,1,maybe', 'id,width,height,depth\na,0,1,1',
  'id,width,height,depth,quantity\na,1,1,1,501', 'id,width,height,depth\n"unclosed,1,1,1',
])('invalid CSV never submits partial work %#', text => {
  csv(text); submit('multiBoxForm'); expect(win.fetch).toHaveBeenCalledTimes(1);
  expect(win.document.getElementById('multiStatus').textContent).not.toBe('Submitting packing job…');
});
test('submits cm input and polls every five seconds until complete, showing every box and soft membership', async () => {
  csv('id,width,height,depth,rotation,soft\nTube,44,3,3,free,false\nSweater,28,6,22,orthogonal,true');
  const plan = result(); plan.boxes.push({ ...plan.boxes[0], id: 'box-2' });
  const completed = { ...job('completed'), result: addWeightEstimates(plan, [box]) };
  win.fetch.mockResolvedValueOnce(response(job('queued'))).mockResolvedValueOnce(response({ ...job('running'), progress: { phase: 'Packing', done: 1, total: 2 } }))
    .mockResolvedValueOnce(response(completed));
  submit('multiBoxForm'); await flush();
  const [url, options] = win.fetch.mock.calls[1];
  expect(url).toBe('/binpacking-multi/jobs'); expect(options.headers['X-CSRF-Token']).toBe('A'.repeat(43));
  expect(JSON.parse(options.body)).toMatchObject({ boxIds: ['Medium'], items: [{ rotation: 'free' }, { soft: true }], options: { margin: 1, maxWeight: null } });
  expect(timers).toHaveLength(1); expect(timers[0].delay).toBe(5000);
  await timers[0].callback(); expect(timers).toHaveLength(2); expect(timers[1].delay).toBe(5000);
  expect(win.fetch.mock.calls[2][0]).toBe('/binpacking-multi/jobs/' + jobId);
  await timers[1].callback();
  expect(timers).toHaveLength(2); expect(win.document.querySelectorAll('.multi-pack__plan')).toHaveLength(2);
  expect(win.document.querySelectorAll('svg polygon')).toHaveLength(12); // one rigid item (6 faces) per box, no soft geometry
  const output = win.document.getElementById('multiResults');
  expect(output.textContent).toContain('Soft · no position'); expect(output.textContent).toContain('cushion 0.189 kg');
  expect(output.textContent).toContain('Estimated shipment: 1.889 kg');
  expect(win.document.getElementById('multiSubmit').disabled).toBe(false);
});
test('free rotation uses row-major matrix and center, not envelope dimensions or minimum corner', () => {
  const c = Math.SQRT1_2;
  const corners = win.packingTest.itemCorners({ center: [10,20,30], dimensions: [4,2,2],
    position: [0,0,0], envelope: [100,100,100], orientation: { matrix: [c,-c,0,c,c,0,0,0,1] } });
  expect(corners[0][0]).toBeCloseTo(10 - c); expect(corners[0][1]).toBeCloseTo(20 - 3 * c); expect(corners[0][2]).toBe(29);
  expect(win.packingTest.itemCorners({ soft: true })).toEqual([]);
});
test('shows unplaced reasons, limit exceptions and weight warnings, without executing item HTML', async () => {
  const plan = result(); const evil = '<img src=x onerror=alert(1)>';
  plan.boxes[0].items[0].id = evil; plan.boxes[0].fallback = true; plan.boxes[0].fallbackReasons = ['Long item'];
  plan.unplaced = [{ id: evil, reason: '<script>secret</script>' }];
  win.fetch.mockResolvedValue(response({ ...job('completed'), result: addWeightEstimates(plan, [{ ...box, maxLoadWeight: 1.3 }]) }));
  win.document.getElementById('multiJobId').value = jobId; submit('multiResumeForm'); await flush();
  const output = win.document.getElementById('multiResults');
  expect(output.querySelectorAll('img,script')).toHaveLength(0); expect(output.textContent).toContain(evil);
  expect(output.textContent).toContain('plan is incomplete'); expect(output.textContent).toContain('Weight warning');
  expect(output.textContent).toContain('Long item');
});
test('transient polling failure retries after five seconds; expiry stops; failed job stops', async () => {
  win.fetch.mockResolvedValueOnce(response({ message: 'Unavailable' }, 503)).mockResolvedValueOnce(response({ message: 'Expired' }, 404));
  win.document.getElementById('multiJobId').value = jobId; submit('multiResumeForm'); await flush();
  expect(timers).toHaveLength(1); expect(timers[0].delay).toBe(5000);
  await timers[0].callback(); expect(timers).toHaveLength(1); expect(win.document.getElementById('multiStatus').textContent).toBe('Expired');
  expect(win.document.getElementById('multiSubmit').disabled).toBe(false);
  win.fetch.mockResolvedValue(response({ ...job('failed'), error: { message: 'Computation failed' } }));
  win.document.getElementById('multiResume').click(); await flush();
  expect(timers).toHaveLength(1); expect(win.document.getElementById('multiStatus').textContent).toContain('Computation failed');
});
