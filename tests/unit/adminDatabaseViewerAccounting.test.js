const fs = require('fs');
const path = require('path');
const vm = require('vm');
let JSDOM;
let dom;
beforeAll(async () => { ({ JSDOM } = await import('jsdom')); });
afterEach(() => dom?.window.close());

function fixture() {
  const names = ['account_dbs', 'transaction_dbs', 'accounting_write_locks', 'ordinary_entries'];
  const records = [{ _id: 'ledger', note: 'synthetic' }];
  const deleteOne = jest.fn(async () => ({ deletedCount: 1 }));
  const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => records };
  const db = {
    listCollections: jest.fn(() => ({ toArray: async () => names.map(name => ({ name })) })),
    collection: jest.fn(() => ({ find: () => cursor, deleteOne })),
  };
  const logger = { warning: jest.fn(), error: jest.fn(), notice: jest.fn() };
  const controller = {};
  vm.runInNewContext(fs.readFileSync('controllers/admincontroller.js', 'utf8'), {
    exports: controller, __dirname: path.resolve('controllers'), process: { env: {} },
    require: name => {
      if (name === 'mongoose') return { connection: { readyState: 1, db }, Types: require('mongoose').Types };
      if (name === '../utils/logger') return logger;
      if (name === 'path' || name === 'fs') return require(name);
      if (name === '../utils/apiDebugLogger') return { createApiDebugLogger: jest.fn() };
      if (name.startsWith('../services/')) return class {};
      return {};
    },
  });
  const res = { set: jest.fn().mockReturnThis(), status: jest.fn().mockReturnThis(), json: jest.fn(), render: jest.fn() };
  return { controller, res, db, deleteOne, logger };
}

test.each(['account_dbs', 'transaction_dbs', 'accounting_write_locks'])('admin cannot delete from %s, including a crafted direct POST', async collection => {
  const f = fixture();
  for (const id of ['ledger', '1'.repeat(24), '']) {
    await f.controller.database_viewer_delete({ user: { type_user: 'admin' }, body: { collection: ` ${collection} `, id } }, f.res);
    expect(f.res.status).toHaveBeenLastCalledWith(403);
    expect(f.res.json).toHaveBeenLastCalledWith({ error: expect.stringContaining('Use audited Accounting operations') });
    expect(f.res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  }
  expect(f.db.listCollections).not.toHaveBeenCalled();
  expect(f.db.collection).not.toHaveBeenCalled();
  expect(f.deleteOne).not.toHaveBeenCalled();
  expect(f.logger.warning).toHaveBeenCalledWith(expect.any(String), { category: 'accounting', metadata: { collection } });
  expect(JSON.stringify(f.logger.warning.mock.calls)).not.toContain('1'.repeat(24));
});

test('unrelated collection deletion remains available and invalid collections remain rejected', async () => {
  const f = fixture();
  await f.controller.database_viewer_delete({ body: { collection: 'ordinary_entries', id: 'synthetic' } }, f.res);
  expect(f.deleteOne).toHaveBeenCalledWith({ _id: 'synthetic' });
  expect(f.res.json).toHaveBeenLastCalledWith({ ok: true, deletedCount: 1 });
  await f.controller.database_viewer_delete({ body: { collection: 'missing', id: 'synthetic' } }, f.res);
  expect(f.res.status).toHaveBeenLastCalledWith(400);
  expect(f.deleteOne).toHaveBeenCalledTimes(1);
});

test.each(['account_dbs', 'transaction_dbs', 'accounting_write_locks', 'ordinary_entries'])('viewer renders %s with server-controlled destructive access', async collection => {
  const f = fixture();
  await f.controller.database_viewer_data({ query: { collection } }, f.res);
  const payload = f.res.json.mock.calls[0][0];
  const canDelete = collection === 'ordinary_entries';
  expect(payload.canDelete).toBe(canDelete);
  expect(f.res.set).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  dom = new JSDOM(`<select id="dbViewerCollection"><option>${collection}</option></select>
    <input id="dbViewerLimit"><button id="dbViewerLoadBtn"></button><div id="dbViewerResults"></div><div id="dbViewerStatus"></div>`, { runScripts: 'outside-only' });
  dom.window.fetch = jest.fn(async () => ({ ok: true, json: async () => payload }));
  vm.runInContext(fs.readFileSync('public/js/database_viewer.js', 'utf8'), dom.getInternalVMContext());
  await new Promise(resolve => setImmediate(resolve));
  expect(dom.window.document.querySelectorAll('.db-viewer__delete').length).toBe(canDelete ? 1 : 0);
  if (!canDelete) expect(dom.window.document.getElementById('dbViewerStatus').textContent).toContain('offline operator procedure');
});
