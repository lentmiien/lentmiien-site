const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
  warning: jest.fn(),
  notice: jest.fn(),
}));

const originalEnv = { ...process.env };

const {
  PUBLIC_TOBUY_LIST_PATH_ENV_KEY,
  buildEnvContent,
  consumePublicTobuyAddQuota,
  ensurePublicTobuyListPath,
} = require('../../utils/publicTobuyList');

describe('publicTobuyList utility helpers', () => {
  let tempDir;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[PUBLIC_TOBUY_LIST_PATH_ENV_KEY];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'public-tobuy-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('buildEnvContent appends a new env key cleanly', () => {
    expect(buildEnvContent('PORT=8080\n', 'PUBLIC_TOBUY_LIST_PATH', '/secret')).toBe(
      'PORT=8080\nPUBLIC_TOBUY_LIST_PATH=/secret\n'
    );
  });

  test('ensurePublicTobuyListPath generates and persists a hidden route', () => {
    const envPath = path.join(tempDir, '.env');

    const value = ensurePublicTobuyListPath({ envPath });

    expect(value).toMatch(/^\/[a-f0-9]{48}$/);
    expect(process.env[PUBLIC_TOBUY_LIST_PATH_ENV_KEY]).toBe(value);
    expect(fs.readFileSync(envPath, 'utf8')).toContain(
      `${PUBLIC_TOBUY_LIST_PATH_ENV_KEY}=${value}`
    );
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  test('ensurePublicTobuyListPath uses a process env path without persisting it', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(envPath, 'PORT=8080\n', { mode: 0o644 });
    fs.chmodSync(envPath, 0o644);
    process.env[PUBLIC_TOBUY_LIST_PATH_ENV_KEY] = '/already-set';

    const value = ensurePublicTobuyListPath({ envPath });

    expect(value).toBe('/already-set');
    expect(fs.readFileSync(envPath, 'utf8')).toBe('PORT=8080\n');
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o644);
  });

  test('process environment overrides a stale value without rewriting the env file', () => {
    const envPath = path.join(tempDir, '.env');
    const originalContent = `${PUBLIC_TOBUY_LIST_PATH_ENV_KEY}=/stale-path\n`;
    fs.writeFileSync(envPath, originalContent, { mode: 0o644 });
    fs.chmodSync(envPath, 0o644);
    process.env[PUBLIC_TOBUY_LIST_PATH_ENV_KEY] = '/rotated-path';

    expect(ensurePublicTobuyListPath({ envPath })).toBe('/rotated-path');
    expect(fs.readFileSync(envPath, 'utf8')).toBe(originalContent);
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o644);
  });

  test('loads an existing env-file path and restricts the file permissions', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(
      envPath,
      `${PUBLIC_TOBUY_LIST_PATH_ENV_KEY}=/file-managed-path\n`,
      { mode: 0o644 }
    );
    fs.chmodSync(envPath, 0o644);

    expect(ensurePublicTobuyListPath({ envPath })).toBe('/file-managed-path');
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  test('consumePublicTobuyAddQuota enforces both the per-second and daily caps', () => {
    const filePath = path.join(tempDir, 'limit.json');
    const first = consumePublicTobuyAddQuota(new Date('2026-04-05T10:00:00.000Z'), { filePath });
    expect(first.allowed).toBe(true);

    const tooFast = consumePublicTobuyAddQuota(new Date('2026-04-05T10:00:00.500Z'), { filePath });
    expect(tooFast).toMatchObject({
      allowed: false,
      reason: 'too_fast',
    });

    for (let index = 1; index < 10; index += 1) {
      const result = consumePublicTobuyAddQuota(
        new Date(`2026-04-05T10:00:${String(index).padStart(2, '0')}.000Z`),
        { filePath }
      );
      expect(result.allowed).toBe(true);
    }

    const overLimit = consumePublicTobuyAddQuota(new Date('2026-04-05T10:00:11.000Z'), { filePath });
    expect(overLimit).toMatchObject({
      allowed: false,
      reason: 'daily_limit',
      remainingToday: 0,
    });

    const nextDay = consumePublicTobuyAddQuota(new Date('2026-04-06T09:00:00.000Z'), { filePath });
    expect(nextDay.allowed).toBe(true);
  });
});
