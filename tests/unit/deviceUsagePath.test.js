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
  DEVICE_USAGE_PATH_ENV_KEY,
  ensureDeviceUsagePath,
} = require('../../utils/deviceUsagePath');

describe('device usage path utility', () => {
  let tempDir;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[DEVICE_USAGE_PATH_ENV_KEY];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'device-usage-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('generates and persists a hidden endpoint path', () => {
    const envPath = path.join(tempDir, '.env');

    const value = ensureDeviceUsagePath({ envPath });

    expect(value).toMatch(/^\/[a-f0-9]{48}$/);
    expect(process.env[DEVICE_USAGE_PATH_ENV_KEY]).toBe(value);
    expect(fs.readFileSync(envPath, 'utf8')).toContain(
      `${DEVICE_USAGE_PATH_ENV_KEY}=${value}`
    );
  });

  test('persists an existing process env path', () => {
    const envPath = path.join(tempDir, '.env');
    process.env[DEVICE_USAGE_PATH_ENV_KEY] = 'already-set';

    const value = ensureDeviceUsagePath({ envPath });

    expect(value).toBe('/already-set');
    expect(fs.readFileSync(envPath, 'utf8')).toContain(
      `${DEVICE_USAGE_PATH_ENV_KEY}=/already-set`
    );
  });
});
