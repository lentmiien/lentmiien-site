const {
  DEFAULT_RUNPOD_BILLING_SYNC_INTERVAL_MS,
  MAX_RUNPOD_BILLING_SYNC_INTERVAL_MS,
  MIN_RUNPOD_BILLING_SYNC_INTERVAL_MS,
  billingSyncInterval,
  createRunpodBillingHistoryRunner,
} = require('../../schedulers/runpodBillingHistory');

describe('Runpod billing history scheduler', () => {
  test('bounds the configured synchronization interval', () => {
    expect(billingSyncInterval('invalid')).toBe(DEFAULT_RUNPOD_BILLING_SYNC_INTERVAL_MS);
    expect(billingSyncInterval('1000')).toBe(MIN_RUNPOD_BILLING_SYNC_INTERVAL_MS);
    expect(billingSyncInterval(String(48 * 60 * 60 * 1000)))
      .toBe(MAX_RUNPOD_BILLING_SYNC_INTERVAL_MS);
  });

  test('prevents overlapping syncs and passes a system principal', async () => {
    let release;
    const billingService = {
      syncHistory: jest.fn().mockReturnValue(new Promise((resolve) => {
        release = resolve;
      })),
    };
    const tick = createRunpodBillingHistoryRunner({
      billingService,
      appLogger: { error: jest.fn() },
    });

    const first = tick('scheduled');
    await expect(tick('scheduled')).resolves.toEqual({ skipped: true });
    release({ accountPeriods: 11 });

    await expect(first).resolves.toEqual({
      skipped: false,
      result: { accountPeriods: 11 },
    });
    expect(billingService.syncHistory).toHaveBeenCalledWith({
      name: 'runpod-billing-scheduler',
    });
  });

  test('logs safe failure metadata and releases the overlap guard', async () => {
    const secret = 'credential details';
    const billingService = {
      syncHistory: jest.fn()
        .mockRejectedValueOnce(Object.assign(new Error(secret), {
          code: 'RUNPOD_HTTP_ERROR', status: 503,
        }))
        .mockResolvedValueOnce({}),
    };
    const appLogger = { error: jest.fn() };
    const tick = createRunpodBillingHistoryRunner({ billingService, appLogger });

    await expect(tick('startup')).resolves.toEqual(expect.objectContaining({ skipped: false }));
    await expect(tick('scheduled')).resolves.toEqual({ skipped: false, result: {} });

    expect(appLogger.error).toHaveBeenCalledWith(
      'Runpod billing history synchronization failed',
      {
        category: 'runpod_billing',
        metadata: {
          reason: 'startup',
          errorCode: 'RUNPOD_HTTP_ERROR',
          providerStatus: 503,
        },
      }
    );
    expect(JSON.stringify(appLogger.error.mock.calls)).not.toContain(secret);
  });
});
