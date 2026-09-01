const {
  RunpodBillingHistoryService,
  enumerateMonths,
  parseHistoryStart,
} = require('../../services/runpodBillingHistoryService');

const HISTORY_START = new Date('2025-11-01T00:00:00.000Z');
const SYNCED_AT = new Date('2026-09-15T12:00:00.000Z');

function queryResult(value) {
  const query = {
    lean: jest.fn().mockResolvedValue(value),
  };
  query.sort = jest.fn().mockReturnValue(query);
  query.limit = jest.fn().mockReturnValue(query);
  return query;
}

function createFixture() {
  const accountOperations = [];
  const podBillingDocuments = [];
  const podDocuments = new Map();
  const podUpdates = [];
  let nextId = 1;
  const accountBillingModel = {
    bulkWrite: jest.fn().mockImplementation(async (operations) => {
      accountOperations.push(...operations);
      return { acknowledged: true };
    }),
    find: jest.fn().mockImplementation(() => queryResult([])),
  };
  const podBillingModel = {
    bulkWrite: jest.fn().mockImplementation(async (operations) => {
      for (const operation of operations) {
        const value = operation.updateOne.update.$set;
        const index = podBillingDocuments.findIndex((document) => (
          document.providerPodId === value.providerPodId
          && document.periodKey === value.periodKey
        ));
        if (index >= 0) podBillingDocuments[index] = value;
        else podBillingDocuments.push(value);
      }
      return { acknowledged: true };
    }),
    find: jest.fn().mockImplementation(() => queryResult(podBillingDocuments)),
  };
  const podModel = {
    findOne: jest.fn().mockImplementation(({ providerPodId }) => (
      queryResult(podDocuments.get(providerPodId) || null)
    )),
    findOneAndUpdate: jest.fn().mockImplementation(async ({ providerPodId }, update) => {
      let document = podDocuments.get(providerPodId);
      if (!document) {
        document = {
          _id: `local-pod-${nextId++}`,
          ...update.$setOnInsert,
        };
        podDocuments.set(providerPodId, document);
      }
      return document;
    }),
    updateMany: jest.fn().mockResolvedValue({ acknowledged: true }),
    updateOne: jest.fn().mockImplementation(async (filter, update) => {
      podUpdates.push({ filter, update });
      const document = podDocuments.get(filter.providerPodId);
      if (document) Object.assign(document, update.$set);
      return { acknowledged: true };
    }),
  };
  const runpodService = {
    getBilling: jest.fn().mockResolvedValue({ records: [] }),
    getPodBilling: jest.fn().mockResolvedValue({ records: [] }),
  };
  const eventModel = { create: jest.fn().mockResolvedValue({}) };
  const appLogger = { warning: jest.fn(), error: jest.fn() };
  const service = new RunpodBillingHistoryService({
    runpodService,
    accountBillingModel,
    podBillingModel,
    podModel,
    eventModel,
    appLogger,
    historyStart: HISTORY_START,
    now: () => new Date(SYNCED_AT),
  });
  return {
    accountBillingModel,
    accountOperations,
    appLogger,
    eventModel,
    podBillingDocuments,
    podBillingModel,
    podDocuments,
    podModel,
    podUpdates,
    runpodService,
    service,
  };
}

describe('RunpodBillingHistoryService', () => {
  test('enumerates November 2025 through the current month and validates the configured start', () => {
    const periods = enumerateMonths(HISTORY_START, SYNCED_AT);

    expect(periods).toHaveLength(11);
    expect(periods[0]).toEqual(expect.objectContaining({ key: '2025-11', finalized: true }));
    expect(periods.at(-1)).toEqual(expect.objectContaining({ key: '2026-09', finalized: false }));
    expect(parseHistoryStart('2025-11-01')).toEqual(HISTORY_START);
    expect(() => parseHistoryStart('2025-11-02')).toThrow(expect.objectContaining({
      code: 'RUNPOD_BILLING_START_INVALID',
    }));
  });

  test('persists provider months, explicit closed zero months, and a provisional current zero', async () => {
    const fixture = createFixture();

    await fixture.service.persistAccountHistory([{
      startTime: '2025-11-01T00:00:00Z',
      totalAmount: 2.5,
      podGpuAmount: 2,
      podDiskAmount: 0.5,
    }], SYNCED_AT);

    expect(fixture.accountOperations).toHaveLength(11);
    const values = fixture.accountOperations.map((operation) => operation.updateOne.update.$set);
    expect(values[0]).toEqual(expect.objectContaining({
      periodKey: '2025-11',
      source: 'provider',
      providerRecordPresent: true,
      finalized: true,
      amounts: expect.objectContaining({ totalAmount: 2.5, podDiskAmount: 0.5 }),
    }));
    expect(values.slice(1, -1)).toHaveLength(9);
    expect(values.slice(1, -1).every((period) => (
      period.source === 'synthesized_zero'
      && period.amounts.totalAmount === 0
      && period.finalized
    ))).toBe(true);
    expect(values.at(-1)).toEqual(expect.objectContaining({
      periodKey: '2026-09',
      source: 'provisional_zero',
      providerRecordPresent: false,
      finalized: false,
    }));
  });

  test('does not erase a stored provider month when a later valid response omits it', async () => {
    const fixture = createFixture();
    fixture.accountBillingModel.find.mockReturnValue(queryResult([{
      periodKey: '2025-11',
      startTime: HISTORY_START,
      source: 'provider',
      providerRecordPresent: true,
      amounts: { totalAmount: 2.5, podGpuAmount: 2, podDiskAmount: 0.5 },
    }]));

    await fixture.service.persistAccountHistory([], SYNCED_AT);

    const november = fixture.accountOperations[0].updateOne.update.$set;
    expect(november).toEqual(expect.objectContaining({
      source: 'provider',
      providerRecordPresent: true,
      amounts: expect.objectContaining({ totalAmount: 2.5, podGpuAmount: 2 }),
    }));
  });

  test('stores exact per-Pod compute/disk billing and creates view-only historical Pod records', async () => {
    const fixture = createFixture();

    const result = await fixture.service.persistPodHistory([{
      podId: 'historical_pod_1',
      startTime: '2025-11-01T00:00:00Z',
      totalAmount: 3,
      gpuAmount: 2.4,
      cpuAmount: 0.1,
      diskAmount: 0.5,
    }, {
      podId: 'historical_pod_1',
      startTime: '2025-11-01T00:00:00Z',
      totalAmount: 1,
      gpuAmount: 0.7,
      cpuAmount: 0.1,
      diskAmount: 0.2,
    }], { name: 'admin' }, SYNCED_AT);

    expect(result).toEqual({ periods: 1, historicalPods: 1 });
    expect(fixture.podBillingDocuments).toEqual([
      expect.objectContaining({
        providerPodId: 'historical_pod_1',
        periodKey: '2025-11',
        totalAmount: 4,
        gpuAmount: 3.1,
        cpuAmount: 0.2,
        diskAmount: 0.7,
      }),
    ]);
    expect(fixture.podDocuments.get('historical_pod_1')).toEqual(expect.objectContaining({
      recordOrigin: 'billing_history',
      lifecycleGroup: 'archived',
      usageTrackingMode: 'billing_only',
      archivedAt: new Date('2025-12-01T00:00:00.000Z'),
    }));
    expect(fixture.podUpdates).toContainEqual({
      filter: { providerPodId: 'historical_pod_1' },
      update: { $set: expect.objectContaining({
        billingTotalUsd: 4,
        billingComputeUsd: 3.3,
        billingStorageUsd: 0.7,
        billingSyncedAt: SYNCED_AT,
      }) },
    });
  });

  test('queries complete UTC month boundaries and preserves partial provider success', async () => {
    const fixture = createFixture();
    fixture.runpodService.getBilling.mockResolvedValue({ records: [] });
    fixture.runpodService.getPodBilling.mockRejectedValue(Object.assign(new Error('private'), {
      code: 'RUNPOD_HTTP_ERROR', status: 503,
    }));

    const result = await fixture.service.syncHistory({ name: 'admin' });

    expect(fixture.runpodService.getBilling).toHaveBeenCalledWith({
      bucketSize: 'month',
      startTime: '2025-11-01T00:00:00.000Z',
      endTime: '2026-10-01T00:00:00.000Z',
      forceRefresh: true,
    });
    expect(result.accountPeriods).toBe(11);
    expect(result.errors).toEqual({
      pods: { code: 'RUNPOD_HTTP_ERROR', status: 503 },
    });
    expect(JSON.stringify(fixture.appLogger.warning.mock.calls)).not.toContain('private');
  });

  test('fails safely only when both provider billing sections are unavailable', async () => {
    const fixture = createFixture();
    fixture.runpodService.getBilling.mockRejectedValue(new Error('account secret'));
    fixture.runpodService.getPodBilling.mockRejectedValue(new Error('pod secret'));

    await expect(fixture.service.syncHistory({ name: 'admin' })).rejects.toEqual(
      expect.objectContaining({ code: 'RUNPOD_BILLING_PROVIDER_UNAVAILABLE' })
    );
    expect(JSON.stringify(fixture.appLogger.error.mock.calls)).not.toContain('secret');
  });
});
