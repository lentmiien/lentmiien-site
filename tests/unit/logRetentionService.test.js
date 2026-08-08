const fs = require('fs');
const os = require('os');
const path = require('path');

const { pruneOldLogs } = require('../../services/logRetentionService');

describe('logRetentionService', () => {
  test('removes only expired log files when run independently of setup', async () => {
    const logDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'log-retention-test-'));
    const oldLog = path.join(logDir, 'app-old.log');
    const freshLog = path.join(logDir, 'app-fresh.log');
    const unrelated = path.join(logDir, 'keep.txt');
    await Promise.all([
      fs.promises.writeFile(oldLog, 'old'),
      fs.promises.writeFile(freshLog, 'fresh'),
      fs.promises.writeFile(unrelated, 'keep'),
    ]);
    const now = Date.now();
    const oldTime = new Date(now - (8 * 24 * 60 * 60 * 1000));
    await fs.promises.utimes(oldLog, oldTime, oldTime);

    try {
      await expect(pruneOldLogs({ logDir, retentionDays: 7, now })).resolves.toEqual({ removed: 1 });
      await expect(fs.promises.access(oldLog)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(fs.promises.access(freshLog)).resolves.toBeUndefined();
      await expect(fs.promises.access(unrelated)).resolves.toBeUndefined();
    } finally {
      await fs.promises.rm(logDir, { recursive: true, force: true });
    }
  });
});
