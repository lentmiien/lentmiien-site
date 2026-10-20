const { maintenanceWindow } = require('../utils/maintenanceWindow');
const logger = require('../utils/logger');

async function run(args, { state = maintenanceWindow, log = logger } = {}) {
  const [command, duration, reason] = args;
  if (command === 'start' && args.length >= 2 && args.length <= 3 && /^[1-9]\d*$/.test(duration)) {
    const window = state.start(Number(duration), reason);
    await log.notice('Planned maintenance window started', { category: 'maintenance', metadata: window });
    return window;
  }
  if (command === 'end' && args.length === 1) {
    const previous = state.end();
    await log.notice('Planned maintenance window ended; downtime alerts enabled', { category: 'maintenance', metadata: { previous } });
    return { active: false };
  }
  if (command === 'status' && args.length === 1) return { active: state.active() };
  throw new Error('Usage: node scripts/maintenance.js start <minutes> [deployment|host|database|network|other] | end | status');
}

if (require.main === module) {
  run(process.argv.slice(2)).then(result => {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }).catch(async error => {
    await logger.error('Maintenance command failed; verify the duration and local state file', { category: 'maintenance' });
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
module.exports = { run };
