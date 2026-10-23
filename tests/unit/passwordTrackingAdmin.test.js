const fs = require('fs');
const path = require('path');
const vm = require('vm');
const bcrypt = require('bcryptjs');

function fixture() {
  const saved = [];
  const existing = { _id: '1'.repeat(24), hash_password: 'previous', password_changed_at: null, password_change_requested: false, save: jest.fn() };
  const UseraccountModel = jest.fn(function (entry) {
    Object.assign(this, entry);
    this.save = jest.fn(async () => saved.push(this));
  });
  UseraccountModel.findOne = jest.fn(async () => null);
  UseraccountModel.findById = jest.fn(async () => existing);
  const controller = {};
  vm.runInNewContext(fs.readFileSync('controllers/admincontroller.js', 'utf8'), {
    exports: controller, __dirname: path.resolve('controllers'), process: { env: {} }, Date,
    require: name => {
      if (name === '../database') return { UseraccountModel };
      if (['path', 'fs', 'crypto', 'bcryptjs'].includes(name)) return require(name);
      if (name === '../utils/apiDebugLogger') return { createApiDebugLogger: jest.fn() };
      if (name.startsWith('../services/')) return class {};
      return {};
    },
  });
  return { controller, saved, existing };
}

test.each(['create', 'reset'])('admin %s records the temporary password time and requests a personal change', async operation => {
  const f = fixture();
  const res = { json: jest.fn() };
  const started = Date.now();
  if (operation === 'create') {
    await f.controller.create_user({ body: { name: 'fixture', email: 'fixture@example.invalid', type_user: 'user' } }, res);
  } else {
    await f.controller.reset_password({ body: { id: f.existing._id } }, res);
  }
  const record = operation === 'create' ? f.saved[0] : f.existing;
  expect(record.password_change_requested).toBe(true);
  expect(record.password_changed_at.getTime()).toBeGreaterThanOrEqual(started);
  expect(record.save).toHaveBeenCalledTimes(1);
  expect(await bcrypt.compare(res.json.mock.calls[0][0].temporaryPassword, record.hash_password)).toBe(true);
});
