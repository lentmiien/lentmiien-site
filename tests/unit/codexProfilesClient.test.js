const fs = require('fs');
const { JSDOM } = require('jsdom');
const { profilesFixture } = require('../fixtures/codexProfiles');

let dom;
afterEach(() => dom?.window.close());
const flush = async () => { for (let i = 0; i < 40; i += 1) await Promise.resolve(); };

function setup() {
  const fixture = profilesFixture();
  dom = new JSDOM(fixture.render(), { url: 'http://localhost/codex/profiles', runScripts: 'outside-only' });
  const win = dom.window;
  win.alert = jest.fn();
  win.console.error = jest.fn();
  // Failed writes keep the DOM available for assertions without a jsdom reload.
  win.fetch = jest.fn(async () => ({ ok: false, text: async () => JSON.stringify({ error: 'Synthetic validation error' }) }));
  win.eval(fs.readFileSync('public/js/codex.js', 'utf8'));
  return { fixture, win, doc: win.document };
}

test('all editable profile controls have unique associated labels and retain native validation', () => {
  const { doc, fixture } = setup();
  const root = doc.querySelector('[data-codex-page="profiles"]');
  const controls = [...root.querySelectorAll('input:not([type="hidden"]), select, textarea')];
  expect(new Set(controls.map((control) => control.id)).size).toBe(controls.length);
  for (const control of controls) {
    expect(control.id).toBeTruthy();
    expect(control.labels).toHaveLength(1);
    expect(control.labels[0].htmlFor).toBe(control.id);
  }
  for (const profile of fixture.profiles) {
    const form = root.querySelector(`[data-profile-form="${profile.id}"]`);
    expect([...form.elements].map((control) => control.name).filter(Boolean)).toEqual([
      'id', 'name', 'model', 'reasoningEffort', 'codexProfile', 'sortOrder', 'description', 'enabled',
    ]);
    for (const name of ['name', 'model', 'codexProfile', 'description']) {
      expect(form.elements[name].value).toBe(profile[name]);
    }
    expect(form.elements.name.required).toBe(true);
    form.elements.name.value = '';
    expect(form.checkValidity()).toBe(false);
    form.elements.name.value = profile.name;
    expect(form.elements.codexProfile.pattern).toBe('[A-Za-z0-9_-]*');
    form.elements.sortOrder.value = '-1';
    expect(form.elements.sortOrder.validity.rangeUnderflow).toBe(true);
    form.elements.sortOrder.value = String(profile.sortOrder);
    expect(form.checkValidity()).toBe(true);
    expect(form.elements.description.maxLength).toBe(500);
    expect(form.elements.model.list.id).toBe('codex-model-options');
    expect(form.elements.reasoningEffort.title).toContain('Ultra');
  }
  expect(root.querySelector('tag')).toBeNull();
  expect([...doc.querySelectorAll('link[rel="stylesheet"]')].map((link) => link.getAttribute('href'))).toContain('/css/codex-profiles.css');
});

test('default stays enabled and non-disableable; disabled entries remain editable', () => {
  const { doc } = setup();
  const defaultForm = doc.querySelector('[data-profile-form="default"]');
  expect(defaultForm.elements.enabled.checked).toBe(true);
  expect(defaultForm.elements.enabled.disabled).toBe(true);
  expect(defaultForm.querySelector('[data-action="disable-profile"]')).toBeNull();
  const disabledForm = doc.querySelector('[data-profile-form="disabled-profile"]');
  expect(disabledForm.elements.enabled.checked).toBe(false);
  expect(disabledForm.elements.enabled.disabled).toBe(false);
  expect(disabledForm.elements.name.disabled).toBe(false);
  expect(disabledForm.querySelector('.codex-status').textContent).toBe('disabled');
});

test.each(['long-profile', 'default'])('saving %s sends unchanged fields and CSRF; failure retains edits and restores Save', async (id) => {
  const { win, doc } = setup();
  const form = doc.querySelector(`[data-profile-form="${id}"]`);
  const description = 'Editable long value <synthetic> & "quoted" '.repeat(10);
  form.elements.description.value = description;
  if (id !== 'default') form.elements.enabled.checked = false;
  form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  expect(form.querySelector('[type="submit"]').disabled).toBe(true);
  await flush();
  const [url, options] = win.fetch.mock.calls[0];
  expect(url).toBe(`/codex/api/profiles/${id}`);
  expect(options.method).toBe('PATCH');
  expect(options.headers['X-CSRF-Token']).toBe('synthetic-test-token');
  expect(JSON.parse(options.body)).toEqual({
    id, name: form.elements.name.value, model: form.elements.model.value,
    reasoningEffort: form.elements.reasoningEffort.value, codexProfile: form.elements.codexProfile.value,
    sortOrder: form.elements.sortOrder.value, description, enabled: id === 'default',
  });
  expect(win.alert).toHaveBeenCalledWith('Synthetic validation error');
  expect(form.elements.description.value).toBe(description);
  expect(form.querySelector('[type="submit"]').disabled).toBe(false);
});

test('create and Disable retain their methods, CSRF, error feedback and usable controls', async () => {
  const { win, doc } = setup();
  const create = doc.getElementById('codex-profile-create');
  create.elements.id.value = 'new-synthetic';
  create.elements.name.value = 'New synthetic';
  create.dispatchEvent(new win.Event('submit', { cancelable: true }));
  await flush();
  expect(win.fetch.mock.calls[0][0]).toBe('/codex/api/profiles');
  expect(win.fetch.mock.calls[0][1].method).toBe('POST');
  expect(JSON.parse(win.fetch.mock.calls[0][1].body).enabled).toBe(true);
  expect(doc.getElementById('codex-profile-status').textContent).toBe('Synthetic validation error');
  expect(create.querySelector('button').disabled).toBe(false);
  const disable = doc.querySelector('[data-profile-id="long-profile"]');
  disable.click();
  await flush();
  expect(win.fetch.mock.calls[1][0]).toBe('/codex/api/profiles/long-profile');
  expect(win.fetch.mock.calls[1][1].method).toBe('DELETE');
  for (const [, options] of win.fetch.mock.calls) expect(options.headers['X-CSRF-Token']).toBe('synthetic-test-token');
  expect(win.alert).toHaveBeenCalledWith('Synthetic validation error');
  expect(disable.disabled).toBe(false);
});
