const fs = require('fs');
const path = require('path');
const vm = require('vm');

test('--check initializes real Mongoose models without collection or index writes', async () => {
  await jest.isolateModulesAsync(async () => {
    const mongoose = require('mongoose');
    const createCollection = jest.spyOn(mongoose.Model, 'createCollection').mockResolvedValue({});
    const ensureIndexes = jest.spyOn(mongoose.Model, 'ensureIndexes').mockResolvedValue();
    const indexes = jest.spyOn(mongoose.Collection.prototype, 'indexes').mockResolvedValue([{ key: { _id: 1 } }]);
    const explain = jest.fn().mockResolvedValue({
      executionStats: { nReturned: 0, totalKeysExamined: 0, totalDocsExamined: 0, executionTimeMillis: 0 },
      queryPlanner: { winningPlan: { stage: 'IXSCAN', indexName: '_id_' } },
    });
    const query = { explain };
    for (const method of ['select', 'limit', 'maxTimeMS', 'lean']) query[method] = jest.fn(() => query);
    const find = jest.spyOn(mongoose.Model, 'find').mockReturnValue(query);
    const connect = jest.spyOn(mongoose, 'connect').mockImplementation(async (_uri, options) => {
      // Keep Mongoose's real model initialization/defaults; replace only the transport.
      Object.assign(mongoose.connection.config, options);
      mongoose.connection.db = { collection: jest.fn(() => ({})) };
      mongoose.connection.readyState = 1;
    });
    let finish;
    const finished = new Promise(resolve => { finish = resolve; });
    const disconnect = jest.spyOn(mongoose, 'disconnect').mockImplementation(async () => {
      await Promise.all(Object.values(mongoose.models).map(model => model.init()));
      finish();
    });
    const output = { log: jest.fn(), error: jest.fn() };
    const scriptProcess = { argv: ['node', 'check-disaster-local.js', '--check'], env: { MONGOOSE_URL: 'mongodb://synthetic.invalid/test' } };
    const script = path.resolve(__dirname, '../../scripts/check-disaster-local.js');
    try {
      vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
        require: id => id === 'mongoose' ? mongoose : require(path.resolve(path.dirname(script), id)),
        process: scriptProcess,
        console: output,
      }, { filename: script });
      await finished;
      expect(scriptProcess.exitCode).toBeUndefined();
      expect(output.error).not.toHaveBeenCalled();
      expect(createCollection).not.toHaveBeenCalled();
      expect(ensureIndexes).not.toHaveBeenCalled();
      expect(indexes).toHaveBeenCalledTimes(2);
      expect(explain).toHaveBeenCalledWith('executionStats');
      expect(Object.keys(mongoose.models).sort()).toEqual([
        'disaster_alert', 'disaster_local_summary', 'disaster_weather_observation',
      ]);
    } finally {
      for (const spy of [createCollection, ensureIndexes, indexes, find, connect, disconnect]) spy.mockRestore();
    }
  });
});
