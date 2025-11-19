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
  resetSectionResults,
  runDropboxPipelines,
  runSection,
  withRetry,
} = require('../../setup');

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
});
