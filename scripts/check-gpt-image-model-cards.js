// Read-only deployment check. No application startup, provider calls or seeding.
// Run with configured environment: node --env-file=.env scripts/check-gpt-image-model-cards.js
const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function main() {
  if (process.argv.length > 2 || !process.env.MONGOOSE_URL) throw new Error('Invalid configuration');
  await mongoose.connect(process.env.MONGOOSE_URL, {
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000,
  });
  const result = await require('../services/gptImageModelCardAudit').auditGptImageModelCards();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
  main().catch(() => {
    logger.error('GPT Image model-card deployment check failed; check database configuration and availability', {
      category: 'openai_model_deprecation',
    });
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}

module.exports = { main };
