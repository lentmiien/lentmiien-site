const fs = require('fs');
const { JSDOM } = require('jsdom');
const { workspacesFixture } = require('../fixtures/codexWorkspaces');

let dom;
afterEach(() => dom?.window.close());
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

function setup() {
  const fixture = workspacesFixture();
  dom = new JSDOM(fixture.render(), { url: 'http://localhost/codex/workspaces', runScripts: 'outside-only' });
  const win = dom.window;
  win.alert = jest.fn();
  win.console.error = jest.fn();
  // Failed stub writes retain the DOM without attempting a jsdom reload.
  win.fetch = jest.fn(async () => ({ ok: false, text: async () => JSON.stringify({ error: 'Synthetic validation error' }) }));
  win.eval(fs.readFileSync('public/js/codex.js', 'utf8'));
  return { fixture, win, doc: win.document };
}

test('workspace controls have unique labels, preserve values/order, and retain validation', () => {
  const { doc, fixture } = setup();
  const root = doc.querySelector('[data-codex-page="workspaces"]');
  const controls = [...root.querySelectorAll('input:not([type="hidden"]), select')];
  expect(new Set(controls.map((control) => control.id)).size).toBe(controls.length);
  for (const control of controls) {
    expect(control.id).toBeTruthy();
    expect(control.labels).toHaveLength(1);
    expect(control.labels[0].htmlFor).toBe(control.id);
  }
  for (const workspace of fixture.workspaces) {
    const form = root.querySelector(`[data-workspace-form="${workspace.id}"]`);
    expect([...form.elements].map((control) => control.name).filter(Boolean)).toEqual([
      'id', 'name', 'rootPath', 'defaultQuestionPermission', 'defaultActionPermission', 'defaultModel', 'defaultProfile', 'enabled', 'allowYolo',
    ]);
    for (const name of ['name', 'rootPath', 'defaultQuestionPermission', 'defaultActionPermission', 'defaultModel', 'defaultProfile']) {
      expect(form.elements[name].value).toBe(workspace[name]);
    }
    expect(form.elements.name.maxLength).toBe(140);
    expect(form.elements.defaultModel.maxLength).toBe(120);
    expect(form.elements.defaultProfile.maxLength).toBe(120);
    expect(form.elements.rootPath.hasAttribute('maxlength')).toBe(false);
    for (const name of ['name', 'rootPath']) {
      expect(form.elements[name].required).toBe(true);
      form.elements[name].value = '';
      expect(form.checkValidity()).toBe(false);
      form.elements[name].value = workspace[name];
    }
    expect(form.checkValidity()).toBe(true);
    for (const name of ['enabled', 'allowYolo']) {
      expect(form.elements[name].checked).toBe(workspace[name]);
      expect(form.elements[name].disabled).toBe(false);
    }
    expect(form.querySelector('.codex-status').textContent).toBe(workspace.enabled ? 'enabled' : 'disabled');
    expect(form.querySelector('[data-action="disable-workspace"]').dataset.workspaceId).toBe(workspace.id);
  }
  const create = doc.getElementById('codex-workspace-create');
  expect(create.elements.targetId.required).toBe(true);
  expect(create.elements.targetId.value).toBe(fixture.state.targets[0].id);
  expect(root.querySelector('tag')).toBeNull();
  expect([...doc.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.getAttribute('href'))).toContain('/css/codex-workspaces.css');
});

test.each(['long-workspace', 'disabled-workspace'])('save %s preserves payload/CSRF and keeps edits on error', async (id) => {
  const { win, doc, fixture } = setup();
  const form = doc.querySelector(`[data-workspace-form="${id}"]`);
  const rootPath = '/synthetic/' + 'long <tag> & "quoted" path/'.repeat(30);
  form.elements.rootPath.value = rootPath;
  form.elements.enabled.checked = false;
  form.elements.allowYolo.checked = true;
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  expect(form.querySelector('[type="submit"]').disabled).toBe(true);
  await flush();
  const [url, options] = win.fetch.mock.calls[0];
  expect(url).toBe(`/codex/api/workspaces/${id}`);
  expect(options.method).toBe('PATCH');
  expect(options.headers['X-CSRF-Token']).toBe('synthetic-test-token');
  expect(JSON.parse(options.body)).toEqual({
    ...fixture.workspaces.find((workspace) => workspace.id === id), rootPath, enabled: false, allowYolo: true,
  });
  expect(win.alert).toHaveBeenCalledWith('Synthetic validation error');
  expect(form.elements.rootPath.value).toBe(rootPath);
  expect(form.querySelector('[type="submit"]').disabled).toBe(false);
});

test('create and Disable preserve methods, payloads, CSRF, error feedback and available controls', async () => {
  const { win, doc } = setup();
  const create = doc.getElementById('codex-workspace-create');
  create.elements.name.value = 'New synthetic';
  create.elements.rootPath.value = '/synthetic/new';
  create.dispatchEvent(new win.Event('submit', { cancelable: true }));
  await flush();
  expect(win.fetch.mock.calls[0][0]).toBe('/codex/api/workspaces');
  expect(win.fetch.mock.calls[0][1].method).toBe('POST');
  expect(JSON.parse(win.fetch.mock.calls[0][1].body)).toEqual({
    name: 'New synthetic', targetId: 'synthetic-target', rootPath: '/synthetic/new',
    defaultQuestionPermission: 'read-only', defaultActionPermission: 'workspace-write', enabled: true, allowYolo: false,
  });
  expect(doc.getElementById('codex-workspace-status').textContent).toBe('Synthetic validation error');
  expect(create.querySelector('button').disabled).toBe(false);
  const disable = doc.querySelector('[data-workspace-id="long-workspace"]');
  disable.click();
  await flush();
  expect(win.fetch.mock.calls[1][0]).toBe('/codex/api/workspaces/long-workspace');
  expect(win.fetch.mock.calls[1][1].method).toBe('DELETE');
  expect(JSON.parse(win.fetch.mock.calls[1][1].body)).toEqual({});
  for (const [, options] of win.fetch.mock.calls) expect(options.headers['X-CSRF-Token']).toBe('synthetic-test-token');
  expect(win.alert).toHaveBeenCalledWith('Synthetic validation error');
  expect(disable.disabled).toBe(false);
});
