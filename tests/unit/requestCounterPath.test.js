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
  REQUEST_COUNTER_PATH_ENV_KEY,
  ensureRequestCounterPath,
} = require('../../utils/requestCounterPath');

describe('request counter path utility', () => {
  let tempDir;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[REQUEST_COUNTER_PATH_ENV_KEY];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'request-counter-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('generates and persists a hidden endpoint path', () => {
    const envPath = path.join(tempDir, '.env');

    const value = ensureRequestCounterPath({ envPath });

    expect(value).toMatch(/^\/[a-f0-9]{48}$/);
    expect(process.env[REQUEST_COUNTER_PATH_ENV_KEY]).toBe(value);
    expect(fs.readFileSync(envPath, 'utf8')).toContain(
      `${REQUEST_COUNTER_PATH_ENV_KEY}=${value}`
    );
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });

  test('uses an existing process env path without persisting it', () => {
    const envPath = path.join(tempDir, '.env');
    process.env[REQUEST_COUNTER_PATH_ENV_KEY] = 'already-set';

    const value = ensureRequestCounterPath({ envPath });

    expect(value).toBe('/already-set');
    expect(fs.existsSync(envPath)).toBe(false);
  });

  test('loads an existing env-file path and restricts the file permissions', () => {
    const envPath = path.join(tempDir, '.env');
    fs.writeFileSync(
      envPath,
      `${REQUEST_COUNTER_PATH_ENV_KEY}=/file-managed-path\n`,
      { mode: 0o644 }
    );
    fs.chmodSync(envPath, 0o644);

    expect(ensureRequestCounterPath({ envPath })).toBe('/file-managed-path');
    expect(fs.statSync(envPath).mode & 0o777).toBe(0o600);
  });
});
