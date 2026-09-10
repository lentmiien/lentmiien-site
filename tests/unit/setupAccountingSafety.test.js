const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('startup maintenance skips direct ledger category rewrites while retaining other maintenance', async () => {
  const imported = [];
  const writes = [];
  const mongoose = { connect: jest.fn(async () => {}), disconnect: jest.fn(async () => {}) };
  const fakeModel = name => ({
    deleteMany: jest.fn(async () => { writes.push(name); return { deletedCount: 0 }; }),
    find: () => {
      const chain = { select: () => chain, lean: () => chain, exec: async () => [], then: resolve => resolve([]) };
      return chain;
    },
  });
  const module = { exports: {} };
  const load = name => {
    imported.push(name);
    if (name === 'mongoose') return mongoose;
    if (['fs', 'path'].includes(name)) return require(name);
    if (name === 'dotenv') return { config: jest.fn() };
    if (name === './utils/logger') return { notice: jest.fn(), warning: jest.fn(), error: jest.fn() };
    if (name === './services/toolManagerService') return class { async seedDefaultTools() { return {}; } };
    if (name === './services/accountingBusinessService') return { seedFromExistingTransactions: jest.fn(async () => ({})) };
    if (name === './services/appSettingsService') return { appSettingsService: { seedDefaults: jest.fn(async () => ({})) } };
    if (name.startsWith('./models/')) return fakeModel(name);
    return {};
  };
  vm.runInNewContext(fs.readFileSync('setup.js', 'utf8'), {
    module, require: load, __dirname: path.resolve('.'), process: { env: { MONGOOSE_URL: 'synthetic-mock-only' } },
  });
  const summary = await module.exports.performDatabaseMaintenance();
  expect(summary.transactionCategoryCleanup).toMatchObject({ skipped: true });
  expect(mongoose.connect).toHaveBeenCalledTimes(1); // Mock only; no DB connection.
  expect(mongoose.disconnect).toHaveBeenCalledTimes(1);
  expect(writes.length).toBeGreaterThan(0); // Other maintenance still runs.
  expect(imported).not.toEqual(expect.arrayContaining(['./models/transaction_db']));
  expect(imported.some(name => /models\/(?:account_db|transaction_db|accounting_write_lock)$/.test(name))).toBe(false);
});
