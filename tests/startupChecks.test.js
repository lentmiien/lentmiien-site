jest.mock('../utils/logger', () => ({
  notice: jest.fn(() => Promise.resolve()),
  warning: jest.fn(() => Promise.resolve()),
  error: jest.fn(() => Promise.resolve()),
}));

jest.mock('axios', () => ({
  post: jest.fn(() => Promise.resolve()),
}));

jest.mock('mailgun.js', () => {
  return jest.fn().mockImplementation(() => ({
    client: () => ({
      messages: {
        create: jest.fn(() => Promise.resolve()),
      },
    }),
  }));
});

const axios = require('axios');

const {
  validateEnvVars,
  checkDiskSpaceForPath,
  verifyMongoConnection,
  runPreflightChecks,
  notifyStartupAlert,
} = require('../utils/startupChecks');

const originalEnv = { ...process.env };

afterEach(() => {
  jest.clearAllMocks();
  process.env = { ...originalEnv };
});

describe('validateEnvVars', () => {
  it('detects missing keys', () => {
    const result = validateEnvVars(['A', 'B'], { env: { A: 'yes' }, log: false });
    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(['B']);
  });
});

describe('checkDiskSpaceForPath', () => {
  it('fails when available space is below minimum', async () => {
    const diskInfoProvider = jest.fn(async () => ({ free: 10 }));
    const result = await checkDiskSpaceForPath('/', 100, { diskInfoProvider });
    expect(result.ok).toBe(false);
    expect(result.availableBytes).toBe(10);
  });
});

describe('verifyMongoConnection', () => {
  it('resolves success when mongoose connect/disconnect succeed', async () => {
    const connect = jest.fn(async () => ({}));
    const disconnect = jest.fn(async () => ({}));
    const result = await verifyMongoConnection('mongodb://localhost:27017/db', {
      mongooseLib: { connect, disconnect },
    });
    expect(result.ok).toBe(true);
    expect(connect).toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalled();
  });

  it('flags missing uri', async () => {
    const result = await verifyMongoConnection('', {});
    expect(result.ok).toBe(false);
  });
});

describe('runPreflightChecks', () => {
  it('aggregates failures when env missing', async () => {
    const result = await runPreflightChecks({
      env: {},
      diskInfoProvider: async () => ({ free: 1e9 }),
      skipMongo: true,
    });
    expect(result.ok).toBe(false);
    expect(result.results[0].status).toBe('failed');
  });
});

describe('notifyStartupAlert', () => {
  it('sends Slack alert when webhook configured', async () => {
    process.env.STARTUP_SLACK_WEBHOOK_URL = 'https://hooks.slack.test/123';
    const response = await notifyStartupAlert({
      subject: 'Diag failure',
      message: 'Example',
      severity: 'critical',
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(response.some((res) => res.transport === 'slack')).toBe(true);
  });
});
