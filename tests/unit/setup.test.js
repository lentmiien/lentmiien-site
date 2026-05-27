const fs = require('fs');
const path = require('path');

jest.mock('../../utils/logger', () => ({
  notice: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
}));

jest.mock('../../dropbox', () => ({
  backup: jest.fn().mockResolvedValue('backup-ok'),
  setup: jest.fn().mockResolvedValue('restore-ok'),
}));

const logger = require('../../utils/logger');
const dropbox = require('../../dropbox');

const {
  buildSummary,
  canRunDropboxOperations,
  cleanTempAndPdfCaches,
  convertPngAssets,
  ensureDirectoriesAndFiles,
  performDatabaseMaintenance,
  pruneExpiredInboxMessages,
  pruneOldLogs,
  resetSectionResults,
  runDropboxPipelines,
  runSection,
  withRetry,
} = require('../../setup');
const MessageInboxEntry = require('../../models/message_inbox');
const VectorEmbedding = require('../../models/vector_embedding');
const VectorEmbeddingHighQuality = require('../../models/vector_embedding_high_quality');

const originalEnv = { ...process.env };
const tokenPath = path.join(__dirname, '..', '..', 'tokens.json');

afterEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  process.env = { ...originalEnv };
  resetSectionResults();
});

describe('withRetry', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries failing operations before succeeding', async () => {
    const operation = jest.fn()
      .mockRejectedValueOnce(new Error('nope'))
      .mockResolvedValue('ok');

    const promise = withRetry(operation, { attempts: 2, baseDelayMs: 50, label: 'retry-op' });
    await jest.advanceTimersByTimeAsync(50);
    const result = await promise;

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(logger.warning).toHaveBeenCalledWith(
      'retry-op attempt 1 failed',
      expect.objectContaining({ metadata: expect.any(Object) })
    );
  });

  it('throws after exhausting retry attempts', async () => {
    const operation = jest.fn().mockRejectedValue(new Error('still down'));

    const promise = expect(
      withRetry(operation, { attempts: 2, baseDelayMs: 50, label: 'retry-fail' })
    ).rejects.toThrow('still down');
    await jest.advanceTimersByTimeAsync(50);

    await promise;
    expect(operation).toHaveBeenCalledTimes(2);
  });
});

describe('runSection', () => {
  it('records successful sections', async () => {
    resetSectionResults();
    const payload = { created: ['a'] };
    const result = await runSection('Directory preparation', () => payload);

    expect(result).toBe(payload);
    const summary = buildSummary();
    expect(summary.okCount).toBe(1);
    expect(summary.sections[0]).toMatchObject({ name: 'Directory preparation', status: 'ok' });
  });

  it('captures failures and rethrows when bailOnError is true', async () => {
    resetSectionResults();
    await expect(
      runSection('Critical step', () => {
        throw new Error('Boom');
      }, { critical: true, bailOnError: true })
    ).rejects.toThrow('Boom');
    const summary = buildSummary();
    expect(summary.failedSections).toContain('Critical step');
    expect(logger.error).toHaveBeenCalledWith(
      'Critical step failed',
      expect.objectContaining({ metadata: expect.any(Object) })
    );
  });

  it('records skipped sections', async () => {
    resetSectionResults();
    const result = await runSection('Optional step', () => ({ skipped: true, reason: 'not configured' }));

    expect(result).toEqual({ skipped: true, reason: 'not configured' });
    const summary = buildSummary();
    expect(summary.sections[0]).toMatchObject({ name: 'Optional step', status: 'skipped' });
  });

  it('records non-critical failures as warnings', async () => {
    resetSectionResults();
    const result = await runSection('Warning step', () => {
      throw new Error('soft fail');
    });

    expect(result).toBeNull();
    const summary = buildSummary();
    expect(summary.warningSections).toContain('Warning step');
  });
});

describe('Dropbox readiness', () => {
  it('reports missing env vars', () => {
    delete process.env.DROPBOX_CLIENT_ID;
    delete process.env.DROPBOX_CLIENT_SECRET;
    delete process.env.DROPBOX_REDIRECT_URI;

    const readiness = canRunDropboxOperations();

    expect(readiness.ok).toBe(false);
    expect(readiness.reason).toContain('DROPBOX_CLIENT_ID');
  });

  it('skips pipeline when readiness fails', async () => {
    delete process.env.DROPBOX_CLIENT_ID;
    const summary = await runDropboxPipelines();
    expect(summary).toMatchObject({ skipped: true });
    expect(dropbox.backup).not.toHaveBeenCalled();
  });

  it('runs backup and restore when env and token exist', async () => {
    process.env.DROPBOX_CLIENT_ID = 'id';
    process.env.DROPBOX_CLIENT_SECRET = 'secret';
    process.env.DROPBOX_REDIRECT_URI = 'uri';

    jest.spyOn(fs, 'existsSync').mockImplementation((target) => {
      if (target === tokenPath) {
        return true;
      }
      return true;
    });

    const summary = await runDropboxPipelines();

    expect(summary).toEqual({ backup: 'ok', restore: 'ok' });
    expect(dropbox.backup).toHaveBeenCalledTimes(1);
    expect(dropbox.setup).toHaveBeenCalledTimes(1);
  });

  it('reports missing Dropbox token when env is configured', () => {
    process.env.DROPBOX_CLIENT_ID = 'id';
    process.env.DROPBOX_CLIENT_SECRET = 'secret';
    process.env.DROPBOX_REDIRECT_URI = 'uri';

    jest.spyOn(fs, 'existsSync').mockImplementation((target) => target !== tokenPath);

    const readiness = canRunDropboxOperations();

    expect(readiness).toEqual({ ok: false, reason: 'tokens.json not found' });
  });
});

describe('Filesystem helpers', () => {
  it('creates missing directories and cache files', async () => {
    const existsSpy = jest.spyOn(fs, 'existsSync').mockImplementation((target) => {
      if (
        target.includes('tmp_data') ||
        target.includes('chat3vdb.json') ||
        target.includes('default_models.json') ||
        target.includes('embedding.json')
      ) {
        return false;
      }
      if (target.endsWith('.env')) {
        return true;
      }
      return true;
    });
    const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    const result = await ensureDirectoriesAndFiles();

    expect(result.createdDirs.length).toBeGreaterThan(0);
    expect(result.createdFiles.length).toBeGreaterThan(0);
    expect(mkdirSpy).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalled();
    existsSpy.mockRestore();
  });

  it('warns when .env is missing', async () => {
    jest.spyOn(fs, 'existsSync').mockImplementation((target) => !target.endsWith('.env'));
    jest.spyOn(fs, 'mkdirSync').mockImplementation(() => {});
    jest.spyOn(fs, 'writeFileSync').mockImplementation(() => {});

    await ensureDirectoriesAndFiles();

    expect(logger.warning).toHaveBeenCalledWith(
      '.env file not found; using only environment variables',
      expect.objectContaining({ category: 'startup:env' })
    );
  });

  it('skips PNG conversion when assets folder missing', async () => {
    const pngFolder = path.join(__dirname, '..', '..', 'public', 'img');
    jest.spyOn(fs, 'existsSync').mockImplementation((target) => target !== pngFolder ? true : false);
    const result = await convertPngAssets();
    expect(result).toEqual({ skipped: true, reason: 'public/img directory missing' });
  });

  it('resets temp directories and prunes stale pdf jobs', async () => {
    const now = Date.now();
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(now);
    jest.spyOn(fs.promises, 'rm').mockResolvedValue();
    jest.spyOn(fs.promises, 'mkdir').mockResolvedValue();
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue([
      { isDirectory: () => true, name: 'job-old' },
    ]);
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({
      mtimeMs: now - (48 * 60 * 60 * 1000),
    });

    const result = await cleanTempAndPdfCaches();

    expect(result).toMatchObject({ tempReset: true, prunedPdfJobs: 1 });
    expect(fs.promises.rm).toHaveBeenCalled();
    dateSpy.mockRestore();
  });

  it('keeps fresh pdf jobs and handles prune errors', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    jest.spyOn(fs.promises, 'rm').mockResolvedValue();
    jest.spyOn(fs.promises, 'mkdir').mockResolvedValue();
    jest.spyOn(fs.promises, 'readdir')
      .mockResolvedValueOnce([
        { isDirectory: () => false, name: 'readme.txt' },
        { isDirectory: () => true, name: 'job-fresh' },
      ])
      .mockRejectedValueOnce(new Error('cannot read'));
    jest.spyOn(fs.promises, 'stat').mockResolvedValue({
      mtimeMs: now,
    });

    const freshResult = await cleanTempAndPdfCaches();
    const errorResult = await cleanTempAndPdfCaches();

    expect(freshResult).toMatchObject({ prunedPdfJobs: 0 });
    expect(errorResult).toMatchObject({ prunedPdfJobs: 0 });
    expect(logger.warning).toHaveBeenCalledWith('Unable to prune PDF conversion cache', expect.any(Error));
  });

  it('prunes old logs and ignores non-log files', async () => {
    const now = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    jest.spyOn(fs.promises, 'mkdir').mockResolvedValue();
    jest.spyOn(fs.promises, 'readdir').mockResolvedValue(['old.log', 'fresh.log', 'notes.txt']);
    jest.spyOn(fs.promises, 'stat').mockImplementation(async (filePath) => ({
      isFile: () => true,
      mtimeMs: filePath.includes('old.log') ? now - (8 * 24 * 60 * 60 * 1000) : now,
    }));
    jest.spyOn(fs.promises, 'unlink').mockResolvedValue();

    const result = await pruneOldLogs();

    expect(result).toEqual({ removed: 1 });
    expect(fs.promises.unlink).toHaveBeenCalledTimes(1);
  });
});

describe('Database maintenance helpers', () => {
  it('skips database maintenance when MongoDB is not configured', async () => {
    delete process.env.MONGOOSE_URL;

    const result = await performDatabaseMaintenance();

    expect(result).toEqual({ skipped: true, reason: 'MONGOOSE_URL missing' });
  });

  it('returns an empty inbox cleanup summary when no messages expired', async () => {
    jest.spyOn(MessageInboxEntry, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([]),
        }),
      }),
    });

    const result = await pruneExpiredInboxMessages();

    expect(result).toEqual({
      removed: 0,
      defaultEmbeddingsRemoved: 0,
      highQualityEmbeddingsRemoved: 0,
    });
  });

  it('removes expired inbox messages and related embeddings', async () => {
    jest.spyOn(MessageInboxEntry, 'find').mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue([
            {
              _id: 'msg-1',
              threadId: 'thread-1',
              hasEmbedding: true,
              hasHighQualityEmbedding: false,
            },
            {
              _id: 'msg-2',
              threadId: null,
              hasEmbedding: false,
              hasHighQualityEmbedding: true,
            },
          ]),
        }),
      }),
    });
    jest.spyOn(VectorEmbedding, 'deleteMany').mockResolvedValue({ deletedCount: 1 });
    jest.spyOn(VectorEmbeddingHighQuality, 'deleteMany').mockResolvedValue({ deletedCount: 1 });
    jest.spyOn(MessageInboxEntry, 'deleteMany').mockResolvedValue({ deletedCount: 2 });

    const result = await pruneExpiredInboxMessages();

    expect(VectorEmbedding.deleteMany).toHaveBeenCalledWith({ $or: [expect.any(Object)] });
    expect(VectorEmbeddingHighQuality.deleteMany).toHaveBeenCalledWith({ $or: [expect.any(Object)] });
    expect(result).toEqual({
      removed: 2,
      defaultEmbeddingsRemoved: 1,
      highQualityEmbeddingsRemoved: 1,
    });
  });
});
