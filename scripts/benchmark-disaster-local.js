// Synthetic benchmark ONLY. Uses a dedicated loopback mongod on port 27189.
// Does not load .env, application startup, providers or a configured application database.
// Start an isolated mongod with a disposable dbpath, then: node scripts/benchmark-disaster-local.js
const mongoose = require('mongoose');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { createLocalSummaryService, ids, order } = require('../services/disasterLocalSummaryService');
async function main() {
  await mongoose.connect('mongodb://127.0.0.1:27189/disaster_watch_synthetic_benchmark', { autoIndex: false, serverSelectionTimeoutMS: 2000, monitorCommands: true });
  const db = mongoose.connection.db;
  await db.dropDatabase(); // Fixed, disposable benchmark database; never configurable.
  const summaryModel = require('../models/disaster_local_summary');
  const alertModel = require('../models/disaster_alert');
  const observationModel = require('../models/disaster_weather_observation');
  await alertModel.collection.createIndex({ category: 1, reportAt: -1 });
  await observationModel.collection.createIndex({ locationName: 1, bucketStartAt: -1 });
  const now = new Date();
  for (let offset = 0; offset < 114000; offset += 2000) {
    await alertModel.collection.insertMany(Array.from({ length: 2000 }, (_, n) => ({ dedupeKey: `synthetic:${offset + n}`, category: 'extreme_weather', source: 'jma', reportAt: new Date(+now - 10 * 86400000), raw: { synthetic: 'x'.repeat(512) } })));
    await summaryModel.collection.insertMany(Array.from({ length: 2000 }, (_, n) => ({ _id: `noise:${offset + n}`, order: '0', data: { synthetic: true } })));
  }
  const service = createLocalSummaryService();
  const sample = {
    weather: { observedAt: now, receivedAt: now, source: 'openweathermap-current', temperatureC: 21.4, feelsLikeC: 21.9, humidityPercent: 64, windSpeedMs: 2.3, precipitationMm: 0, weatherCode: '800', isDay: true, description: 'Clear sky' },
    estimate: { observedAt: now, receivedAt: now, source: 'open-meteo-jma-hourly', estimated: true, temperatureC: 22, weatherCode: '3', description: 'Cloudy' },
    warnings: { at: now, coverage: true, hazards: [{ areaCode: '1410011', code: '15', name: '強風注意報', active: true, severity: 'advisory', status: '継続' }] },
    earthquake: { at: now, intensity: '1', nationalMax: '2', magnitude: 4, source: 'jma' },
    typhoon: { at: now, state: 'proximity', proximity: true, validUntil: new Date(+now + 3600000) },
    health: { at: now, ok: true },
  };
  for (const [slot, data] of Object.entries(sample)) await service.put(slot, data, order(now));
  const commands = [];
  mongoose.connection.getClient().on('commandStarted', event => { if (['find', 'aggregate', 'count', 'update'].includes(event.commandName)) commands.push({ name: event.commandName, collection: event.command[event.commandName] }); });
  const plan = await summaryModel.find({ _id: { $in: ids() } }).select('_id data').limit(6).maxTimeMS(1500).lean().explain('executionStats');
  const elapsed = [];
  for (let n = 0; n < 200; n++) {
    const start = performance.now(); await service.read(); elapsed.push(performance.now() - start);
  }
  elapsed.sort((a, b) => a - b);
  assert.equal(plan.executionStats.nReturned, 6);
  assert.equal(plan.executionStats.totalDocsExamined, 6);
  assert(!JSON.stringify(plan.queryPlanner.winningPlan).includes('COLLSCAN'));
  assert(commands.every(c => c.name === 'find' && c.collection === 'disaster_local_summaries'));
  assert.equal(commands.length, 200);
  console.log(JSON.stringify({ environment: 'Isolated loopback MongoDB 8.0.15; synthetic data, not production', alertDocuments: 114000, summaryDocuments: 114006,
    iterations: 200, p50Ms: +elapsed[100].toFixed(3), p95Ms: +elapsed[190].toFixed(3), maxMs: +elapsed[199].toFixed(3),
    documentsExamined: plan.executionStats.totalDocsExamined, keysExamined: plan.executionStats.totalKeysExamined,
    winningPlan: plan.queryPlanner.winningPlan, summaryQueries: commands.length, archiveQueries: 0 }, null, 2));
  // Exercise genuine duplicate-key/CAS semantics, including sticky conflicting variants.
  const t = new Date(+now + 1000);
  await service.put('warnings', { coverage: true, hazards: [], at: t }, order(t));
  await service.put('warnings', { coverage: true, hazards: [{ active: true }], at: t }, order(t));
  await service.put('warnings', { coverage: true, hazards: [], at: t }, order(t));
  assert.equal((await service.read()).warnings.state, 'stale');
  await service.put('warnings', { coverage: true, hazards: [], at: now }, order(now));
  assert.equal((await service.read()).warnings.state, 'stale');
  const start = performance.now();
  await service.bootstrap({ DisasterAlert: alertModel, DisasterWeatherObservation: observationModel });
  console.log(`Bounded empty-window bootstrap: ${(performance.now() - start).toFixed(3)} ms. Genuine MongoDB conflict/out-of-order checks passed.`);
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => mongoose.disconnect());
