// Operator tool: no application startup, provider requests, ingestion or generation.
// node --env-file=.env scripts/check-disaster-local.js [--check|--indexes|--bootstrap]
const mongoose = require('mongoose');
const { createLocalSummaryService, ids } = require('../services/disasterLocalSummaryService');
async function main() {
  const mode = process.argv[2] || '--check';
  if (!['--check', '--indexes', '--bootstrap'].includes(mode) || process.argv.length > 3) throw new Error('Use --check, --indexes or --bootstrap.');
  if (!process.env.MONGOOSE_URL) throw new Error('MONGOOSE_URL is required.');
  await mongoose.connect(process.env.MONGOOSE_URL, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
  const models = { DisasterAlert: require('../models/disaster_alert'), DisasterWeatherObservation: require('../models/disaster_weather_observation') };
  const summary = require('../models/disaster_local_summary');
  if (mode === '--indexes') {
    // Additive only; never syncIndexes/dropIndexes. These already exist in the legacy schema.
    await models.DisasterAlert.collection.createIndex({ category: 1, reportAt: -1 });
    await models.DisasterWeatherObservation.collection.createIndex({ locationName: 1, bucketStartAt: -1 });
    console.log('Required source indexes ensured. Summary uses its built-in _id index.');
  } else if (mode === '--bootstrap') {
    await createLocalSummaryService().bootstrap(models);
    console.log('Bounded bootstrap completed or was already completed. Source freshness was not advanced.');
  } else {
    for (const [name, model] of Object.entries(models)) {
      const indexes = await model.collection.indexes();
      console.log(name, JSON.stringify(indexes.map(i => i.key)));
    }
    const plan = await summary.find({ _id: { $in: ids() } }).select('_id data').limit(6).maxTimeMS(1500).lean().explain('executionStats');
    console.log(JSON.stringify({ returned: plan.executionStats?.nReturned, keysExamined: plan.executionStats?.totalKeysExamined,
      documentsExamined: plan.executionStats?.totalDocsExamined, executionTimeMillis: plan.executionStats?.executionTimeMillis,
      hasCollectionScan: JSON.stringify(plan.queryPlanner?.winningPlan).includes('COLLSCAN') }, null, 2));
  }
}
main().catch(error => {
  require('../utils/logger').error('Local disaster maintenance failed', { category: 'disaster_ingestion', metadata: { errorName: error.name } });
  console.error('Local disaster maintenance failed. Check configuration and database availability.');
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
