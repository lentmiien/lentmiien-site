const {
  EXECUTE_FLAG,
  main,
  safeCode,
} = require('../../scripts/sync-runpod-billing-history-v2');

function fixture() {
  const output = [];
  const errors = [];
  const mongooseInstance = {
    connection: { readyState: 0 },
    connect: jest.fn().mockImplementation(async () => {
      mongooseInstance.connection.readyState = 1;
    }),
    disconnect: jest.fn().mockImplementation(async () => {
      mongooseInstance.connection.readyState = 0;
    }),
  };
  const billingService = {
    syncHistory: jest.fn().mockResolvedValue({
      accountPeriods: 11,
      podPeriods: 2,
      historicalPods: 1,
      errors: {},
    }),
    getStoredHistory: jest.fn().mockResolvedValue({
      periods: [{ periodKey: '2025-11' }, { periodKey: '2026-09' }],
    }),
  };
  return {
    billingService,
    errors,
    mongooseInstance,
    output,
    options: {
      billingService,
      mongooseInstance,
      mongoUrl: 'mongodb://example.invalid/test',
      apiKey: 'secret-key',
      stdout: (line) => output.push(line),
      stderr: (line) => errors.push(line),
    },
  };
}

describe('Runpod billing history standalone script', () => {
  test('is non-mutating unless explicitly executed', async () => {
    const test = fixture();

    await expect(main({ ...test.options, argv: [] })).resolves.toBe(0);

    expect(test.mongooseInstance.connect).not.toHaveBeenCalled();
    expect(test.billingService.syncHistory).not.toHaveBeenCalled();
    expect(test.output.join(' ')).toContain('Dry run only');
  });

  test('connects, syncs bounded summaries, and disconnects without printing credentials', async () => {
    const test = fixture();

    await expect(main({ ...test.options, argv: [EXECUTE_FLAG] })).resolves.toBe(0);

    expect(test.billingService.syncHistory).toHaveBeenCalledWith({
      name: 'runpod-billing-backfill',
    });
    expect(test.mongooseInstance.disconnect).toHaveBeenCalledTimes(1);
    expect(test.output.join(' ')).toContain('2025-11 through 2026-09');
    expect(JSON.stringify(test.output)).not.toContain('secret-key');
    expect(JSON.stringify(test.output)).not.toContain('mongodb://');
  });

  test('fails before connecting when required configuration is absent', async () => {
    const test = fixture();

    await expect(main({
      ...test.options,
      argv: [EXECUTE_FLAG],
      apiKey: '',
    })).resolves.toBe(1);

    expect(test.mongooseInstance.connect).not.toHaveBeenCalled();
    expect(test.errors).toEqual(['Runpod billing sync failed: RUNPOD_NOT_CONFIGURED']);
    expect(safeCode(new Error('secret'))).toBe('RUNPOD_BILLING_SYNC_FAILED');
  });
});
