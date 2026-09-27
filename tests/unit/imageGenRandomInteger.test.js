const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { createRequire } = require('module');
const { JSDOM } = createRequire(__filename)('jsdom');

const clientSource = fs.readFileSync(path.join(__dirname, '../../public/js/image_gen.js'), 'utf8');
const html = pug.renderFile(path.join(__dirname, '../../views/image_gen/index.pug'), {
  loggedIn: true, permissions: ['image_gen'], htmlPaths: [], bookmarks: [],
});
const storageKey = 'imageGenWorkflowUi:fixture';
const workflow = {
  '3': { class_type: 'KSampler', inputs: { seed: 42, steps: 20, model: ['4', 0] } },
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'Original prompt' } },
};
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let dom;

afterEach(() => dom?.window.close());

async function loadPage({ saved, template = workflow, failSubmit = false } = {}) {
  dom = new JSDOM(html, { url: 'https://fixture.invalid/image_gen', runScripts: 'outside-only' });
  const { window } = dom;
  if (saved) window.localStorage.setItem(storageKey, saved);
  const submissions = [];
  const random = jest.spyOn(window.crypto, 'getRandomValues')
    .mockImplementationOnce((array) => { array[0] = 0; return array; })
    .mockImplementationOnce((array) => { array[0] = 4294967295; return array; });
  window.fetch = jest.fn(async (url, options) => {
    let payload = { ok: true };
    if (url.endsWith('/api/workflows')) payload = { workflows: [{ key: 'fixture' }] };
    if (url.endsWith('/api/workflows/fixture')) payload = { workflow: template };
    if (url.endsWith('/api/generate')) {
      submissions.push(JSON.parse(options.body));
      // A terminal fixture avoids polling or loading generated media.
      payload = { job_id: 'fixture-job', status: 'failed' };
      if (failSubmit) return { ok: false, status: 503, text: async () => 'Unavailable' };
    }
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => payload };
  });
  window.eval(clientSource);
  await flush();
  const doc = window.document;
  const change = (element, value) => {
    element.value = value;
    element.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const add = (key) => {
    change(doc.querySelector('#nodeFieldSelect'), key);
    doc.querySelector('#btnMakeEditable').click();
  };
  const setType = (index, type) => change(doc.querySelectorAll('#editableFields select')[index], type);
  const submit = async () => { doc.querySelector('#btnGenerate').click(); await flush(); };
  return { window, doc, random, submissions, add, setType, submit };
}

test('randomizes seeds for each submission, preserves other inputs, and keeps JSON previews stable', async () => {
  const page = await loadPage();
  page.add('3::seed');
  page.setType(0, 'random-integer');
  page.add('6::text');
  page.setType(1, 'prompt');
  const prompt = page.doc.querySelector('#editableFields textarea');
  prompt.value = 'Custom prompt';
  prompt.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  expect(page.doc.querySelector('#editableFields .workflow-field input')).toBeNull();
  expect(page.random).not.toHaveBeenCalled();

  await page.submit();
  page.doc.querySelector('#btnViewJson').click();
  page.doc.querySelector('#btnViewJson').click();
  expect(page.random).toHaveBeenCalledTimes(1);
  expect(JSON.parse(page.doc.querySelector('#workflowJson').value)).toEqual(page.submissions[0].prompt);
  expect(page.doc.querySelector('#editableFields').textContent).toContain('Last submitted: 0.');
  await page.submit();

  expect(page.submissions.map((request) => request.prompt['3'].inputs.seed)).toEqual([0, 4294967295]);
  expect(page.random).toHaveBeenCalledTimes(2);
  for (const request of page.submissions) {
    expect(request.prompt['3'].inputs.steps).toBe(20);
    expect(request.prompt['3'].inputs.model).toEqual(['4', 0]);
    expect(request.prompt['6'].inputs.text).toBe('Custom prompt');
    expect(request.prompt_text).toBe('Custom prompt');
  }
  expect(workflow['3'].inputs.seed).toBe(42);
  expect(page.doc.querySelector('#editableFields').textContent).toContain('Last submitted: 4294967295.');
});

test('restores the random type after reload without reusing a saved value', async () => {
  const first = await loadPage();
  first.add('3::seed');
  first.setType(0, 'random-integer');
  await first.submit();
  const saved = first.window.localStorage.getItem(storageKey);
  expect(JSON.parse(saved).fields[0].controlType).toBe('random-integer');
  expect(JSON.parse(saved).fields[0]).not.toHaveProperty('randomValue');
  first.window.close();

  const tampered = JSON.parse(saved);
  tampered.fields[0].value = '<script>invalid seed</script>';
  tampered.fields[0].randomValue = -1;
  tampered.fields.push({ key: 'missing::seed', controlType: 'random-integer' });
  const page = await loadPage({ saved: JSON.stringify(tampered) });
  expect(page.doc.querySelectorAll('#editableFields select')).toHaveLength(1);
  expect(page.doc.querySelector('#editableFields select').value).toBe('random-integer');
  expect(page.random).not.toHaveBeenCalled();
  await page.submit();
  expect(page.submissions[0].prompt['3'].inputs.seed).toBe(0);
});

test('switching back to number and removing a random field restore fixed values', async () => {
  const page = await loadPage();
  page.add('3::seed');
  page.setType(0, 'random-integer');
  await page.submit();
  page.setType(0, 'number');
  const input = page.doc.querySelector('#editableFields input');
  input.value = '123';
  input.dispatchEvent(new page.window.Event('input', { bubbles: true }));
  await page.submit();
  page.setType(0, 'random-integer');
  page.doc.querySelector('#editableFields button').click();
  await page.submit();
  expect(page.submissions.map((request) => request.prompt['3'].inputs.seed)).toEqual([0, 123, 42]);
  expect(page.random).toHaveBeenCalledTimes(1);
});

test('rerolls on retry after a failed request and supports array-based workflows', async () => {
  const page = await loadPage({
    template: { nodes: [{ id: 3, ...workflow['3'] }] },
    failSubmit: true,
  });
  page.add('3::seed');
  page.setType(0, 'random-integer');
  await page.submit();
  await page.submit();
  expect(page.submissions.map((request) => request.prompt.nodes[0].inputs.seed)).toEqual([0, 4294967295]);
  expect(page.doc.querySelector('#btnGenerate').disabled).toBe(false);
});
