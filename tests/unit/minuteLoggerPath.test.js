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
  MINUTE_LOGGER_PATH_ENV_KEY,
  ensureMinuteLoggerPath,
} = require('../../utils/minuteLoggerPath');

describe('minute logger path utility', () => {
  let tempDir;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env[MINUTE_LOGGER_PATH_ENV_KEY];
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minute-logger-'));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('generates and persists a hidden endpoint path', () => {
    const envPath = path.join(tempDir, '.env');

    const value = ensureMinuteLoggerPath({ envPath });

    expect(value).toMatch(/^\/[a-f0-9]{48}$/);
    expect(process.env[MINUTE_LOGGER_PATH_ENV_KEY]).toBe(value);
    expect(fs.readFileSync(envPath, 'utf8')).toContain(
      `${MINUTE_LOGGER_PATH_ENV_KEY}=${value}`
    );
  });

  test('persists an existing process env path', () => {
    const envPath = path.join(tempDir, '.env');
    process.env[MINUTE_LOGGER_PATH_ENV_KEY] = 'already-set';

    const value = ensureMinuteLoggerPath({ envPath });

    expect(value).toBe('/already-set');
    expect(fs.readFileSync(envPath, 'utf8')).toContain(
      `${MINUTE_LOGGER_PATH_ENV_KEY}=/already-set`
    );
  });
});
