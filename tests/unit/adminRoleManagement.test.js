const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pug = require('pug');
const { hasCapabilities } = require('../../utils/authorization');
const { MIIEN_ROLE_CAPABILITY_BUNDLES } = require('../../utils/miienAuthorizationPolicy');
const capabilities = ['chat.conversation.read', 'chat.conversation.write', 'chat.audio.transcribe', 'chat.audio.synthesize'];
let JSDOM, dom;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
afterEach(() => dom?.window.close());
const checkboxFor = (document, capability) => Array.from(document.getElementsByName('route_permissions')).find(input => input.value === capability);

function fixture(stored = []) {
  const records = stored.map(role => ({ ...role, permissions: [...role.permissions], save: jest.fn() }));
  const RoleModel = jest.fn(function (entry) {
    Object.assign(this, entry);
    this.save = jest.fn(async () => records.push(this));
  });
  RoleModel.find = jest.fn(async () => records);
  RoleModel.findOne = jest.fn(async query => records.find(role => role.name === query.name && role.type === query.type));
  RoleModel.deleteOne = jest.fn();
  const UseraccountModel = { find: jest.fn().mockResolvedValue([{ name: 'reader', type_user: 'user' }]) };
  const controller = {};
  // Evaluate the real legacy controller with all integration imports stubbed.
  // No database, provider clients, filesystem writes or app startup are loaded.
  vm.runInNewContext(fs.readFileSync('controllers/admincontroller.js', 'utf8'), {
    exports: controller, __dirname: path.resolve('controllers'), process: { env: {} },
    require: name => {
      if (name === '../database') return { RoleModel, UseraccountModel };
      if (name === 'path' || name === 'fs') return require(name);
      if (name === '../utils/apiDebugLogger') return { createApiDebugLogger: jest.fn() };
      if (name.startsWith('../services/')) return class {};
      return {};
    },
  });
  return { controller, RoleModel, records };
}
async function page(f) {
  const res = { render: jest.fn() };
  await f.controller.manage_roles({}, res);
  const [view, data] = res.render.mock.calls[0];
  const html = pug.renderFile(`views/${view}.pug`, {
    ...data, csrfToken: 'A'.repeat(43), loggedIn: true, admin: true,
    permissions: [], htmlPaths: [], bookmarks: [],
  });
  dom = new JSDOM(html, { runScripts: 'outside-only' });
  vm.runInContext(fs.readFileSync('public/js/manage_roles.js', 'utf8'), dom.getInternalVMContext());
  return { data, document: dom.window.document };
}
async function saveSelected(f, document, role = 'reader') {
  dom.window.UpdateInputForm({ value: role });
  const form = document.querySelector('form[action="/admin/update_role"]');
  const entries = new dom.window.FormData(form);
  const body = Object.fromEntries(entries);
  body.route_permissions = entries.getAll('route_permissions');
  await f.controller.update_role({ body }, { redirect: jest.fn() });
  return body;
}

test('admin can explicitly grant all Miien capabilities and retain them on the next form roundtrip', async () => {
  const f = fixture();
  const { document } = await page(f);
  dom.window.UpdateInputForm({ value: 'reader' });
  for (const capability of capabilities) {
    const checkbox = checkboxFor(document, capability);
    expect(checkbox.checked).toBe(false);
    checkbox.checked = true;
  }
  const form = document.querySelector('form[action="/admin/update_role"]');
  const entries = new dom.window.FormData(form);
  await f.controller.update_role({ body: { role: 'reader', type: 'user', route_permissions: entries.getAll('route_permissions') } }, { redirect: jest.fn() });
  expect(f.records[0].permissions).toEqual(capabilities);
  await expect(hasCapabilities({ name: 'reader', type_user: 'user' }, capabilities, {
    roleModel: f.RoleModel, roleCapabilityBundles: MIIEN_ROLE_CAPABILITY_BUNDLES,
  })).resolves.toBe(true);
  dom.window.close();
  const next = await page(f);
  await saveSelected(f, next.document);
  expect(f.records[0].permissions).toEqual(capabilities);
  expect(f.records[0].save).toHaveBeenCalledTimes(2);
});

test('uncatalogued grants roundtrip without checkbox errors or HTML execution', async () => {
  const unknown = 'roles'; // Must not collide with the page's JSON element ID.
  const escaped = '<img src=x onerror=alert(1)>&grant';
  const f = fixture([{ name: 'reader', type: 'user', permissions: ['chat5', ...capabilities, unknown, escaped] }]);
  const { document } = await page(f);
  expect(document.querySelector('img[onerror]')).toBeNull();
  await saveSelected(f, document);
  expect(new Set(f.records[0].permissions)).toEqual(new Set(['chat5', ...capabilities, unknown, escaped]));
});

test('matching role type prevents another record from checking extra grants', async () => {
  const f = fixture([
    { name: 'reader', type: 'user', permissions: [capabilities[0]] },
    { name: 'reader', type: 'group', permissions: capabilities },
  ]);
  const { document } = await page(f);
  await saveSelected(f, document);
  expect(f.records[0].permissions).toEqual([capabilities[0]]);
});

test.each(['user', 'family'])('rendering the admin catalog does not grant default %s privileges', async type_user => {
  const f = fixture();
  const { document } = await page(f);
  expect(f.RoleModel).not.toHaveBeenCalled();
  expect(f.RoleModel.deleteOne).not.toHaveBeenCalled();
  for (const capability of capabilities) {
    expect(checkboxFor(document, capability).checked).toBe(false);
    await expect(hasCapabilities({ name: 'reader', type_user }, [capability], {
      roleModel: f.RoleModel, roleCapabilityBundles: MIIEN_ROLE_CAPABILITY_BUNDLES,
    })).resolves.toBe(false);
  }
});

test('registered role routes issue and enforce shared CSRF before permission writes', async () => {
  const f = fixture();
  const registered = new Map();
  const router = {};
  for (const method of ['get', 'post', 'put', 'delete', 'use']) {
    router[method] = (url, ...handlers) => registered.set(`${method} ${url}`, handlers);
  }
  const logger = { warning: jest.fn(), error: jest.fn() };
  vm.runInNewContext(fs.readFileSync('routes/admin.js', 'utf8'), {
    module: { exports: {} }, __dirname: path.resolve('routes'), process: { env: {} },
    require: name => {
      if (name === 'express') return { Router: () => router };
      if (name === '../controllers/admincontroller') return f.controller;
      if (name === '../middleware/sessionCsrf') return {
        createSessionCsrf: () => require('../../middleware/sessionCsrf').createSessionCsrf({ appLogger: logger, allowedOrigins: [] }),
      };
      if (name === '../utils/logger') return logger;
      if (['fs', 'path', 'crypto', 'multer'].includes(name)) return require(name);
      return {};
    },
  });
  const session = {};
  const res = { locals: {}, status: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(), json: jest.fn(), render: jest.fn(), redirect: jest.fn() };
  const [issue] = registered.get('get /manage_roles');
  issue({ method: 'GET', session }, res, jest.fn());
  expect(res.locals.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const [requireToken, update] = registered.get('post /update_role');
  for (const [token, origin] of [['', null], ['B'.repeat(43), null], [session.csrfToken, 'https://hostile.invalid']]) {
    const next = jest.fn();
    requireToken({ method: 'POST', session, protocol: 'https', body: { _csrf: token },
      get: name => ({ host: 'site.invalid', accept: 'application/json', origin }[name]),
    }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenLastCalledWith(403);
  }
  expect(f.RoleModel.findOne).not.toHaveBeenCalled();
  const next = jest.fn();
  const req = { method: 'POST', session, protocol: 'https',
    body: { _csrf: session.csrfToken, role: 'reader', type: 'user', route_permissions: capabilities },
    get: name => ({ host: 'site.invalid', accept: 'application/json', origin: 'https://site.invalid' }[name]),
  };
  requireToken(req, res, next);
  expect(next).toHaveBeenCalledTimes(1);
  await update(req, res);
  expect(f.records[0].permissions).toEqual(capabilities);
});

test('admin can explicitly revoke Miien grants while retaining unrelated permissions', async () => {
  const f = fixture([{ name: 'reader', type: 'user', permissions: ['future.feature.read', ...capabilities] }]);
  const { document } = await page(f);
  dom.window.UpdateInputForm({ value: 'reader' });
  for (const capability of capabilities) checkboxFor(document, capability).checked = false;
  const form = document.querySelector('form[action="/admin/update_role"]');
  const entries = new dom.window.FormData(form);
  await f.controller.update_role({ body: { role: 'reader', type: 'user', route_permissions: entries.getAll('route_permissions') } }, { redirect: jest.fn() });
  expect(f.records[0].permissions).toEqual(['future.feature.read']);
});
