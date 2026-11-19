// Run offline after confirming the historical file belongs only to this receipt.
// See documentation/production-log-review-2026-11-19.md before using --apply.
const mongoose = require('mongoose');
const { privatizeLegacyScan } = require('../services/legacyReceiptScan');
const logger = require('../utils/logger');
const { errorDiagnostics } = require('../utils/errorDiagnostics');

async function main() {
  const [id, option, ...extra] = process.argv.slice(2);
  if (!/^[a-f\d]{24}$/i.test(id || '') || extra.length || (option && option !== '--apply') || !process.env.MONGOOSE_URL) {
    process.stderr.write('Set MONGOOSE_URL and supply RECEIPT_ID [--apply].\n');
    process.exitCode = 1;
    return;
  }
  await mongoose.connect(process.env.MONGOOSE_URL, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  const status = await privatizeLegacyScan(id, { apply: option === '--apply' });
  process.stdout.write(status + '\n');
}

if (require.main === module) {
  main().catch(error => {
    logger.error('Legacy receipt scan migration failed. Verify exclusive file ownership and the stored copy before retrying.', {
      category: 'receipt', metadata: errorDiagnostics(error),
    });
    process.exitCode = 1;
  }).finally(() => mongoose.disconnect());
}
