const {
  TapoReadingService,
  buildTapoBatchResponse,
  buildTapoDashboardData,
  normalizeTapoRecord,
  upsertFreshSnapshot,
} = require('../../services/tapoReadingService');

function createSampleRecord(overrides = {}) {
  return {
    reading_id: 'sample:192.168.0.30:2026-05-22T06:40:00+00:00',
    kind: 'sample',
    device_ip: '192.168.0.30',
    device_name: 'L-AC',
    model: 'P110M',
    timestamp_utc: '2026-05-22T06:41:38.293483+00:00',
    bucket_start_utc: '2026-05-22T06:40:00+00:00',
    metrics: {
      current_power: 0.883,
      today_energy: 0.012,
      this_month_energy: 2.089,
      voltage: 102.811,
      current: 0.052,
      state: true,
      rssi: -61,
      signal_level: 2,
      overloaded: false,
    },
    features: {
      current_consumption: 0.883,
      consumption_today: 0.012,
      consumption_this_month: 2.089,
      device_time: '2026-05-22T15:41:38+09:00',
    },
    feature_errors: [],
    collector: {
      library: 'python-kasa',
      connection_method: 'discover_single',
    },
    ...overrides,
  };
}

describe('TapoReadingService helpers', () => {
  test('normalizeTapoRecord uses device name and bucket time for dedupe', () => {
    const normalized = normalizeTapoRecord(createSampleRecord(), { source: 'n8n-tapo' });

    expect(normalized.rawReading.dedupeKey).toBe('l-ac|sample|2026-05-22T06:40:00.000Z');
    expect(normalized.rawReading.localDateKey).toBe('2026-05-22');
    expect(normalized.rawReading.localMonthKey).toBe('2026-05');
    expect(normalized.rawReading.deviceIp).toBe('192.168.0.30');
    expect(normalized.dailySnapshot.consumptionKwh).toBe(0.012);
    expect(normalized.monthlySnapshot.consumptionKwh).toBe(2.089);
  });

  test('dedupe key is stable when only the device IP changes', () => {
    const first = normalizeTapoRecord(createSampleRecord(), { source: 'n8n-tapo' });
    const second = normalizeTapoRecord(createSampleRecord({
      reading_id: 'sample:192.168.0.99:2026-05-22T06:40:00+00:00',
      device_ip: '192.168.0.99',
    }), { source: 'n8n-tapo' });

    expect(second.rawReading.deviceIp).toBe('192.168.0.99');
    expect(second.rawReading.dedupeKey).toBe(first.rawReading.dedupeKey);
  });

  test('upsertFreshSnapshot creates a missing snapshot', async () => {
    const Model = {
      updateOne: jest.fn().mockResolvedValueOnce({ upsertedCount: 1 }),
    };
    const snapshot = {
      deviceNameKey: 'l-ac',
      dateKey: '2026-05-22',
      lastReadingAt: new Date('2026-05-22T06:41:38Z'),
      consumptionKwh: 0.012,
    };

    const status = await upsertFreshSnapshot(Model, { deviceNameKey: 'l-ac', dateKey: '2026-05-22' }, snapshot);

    expect(status).toBe('created');
    expect(Model.updateOne).toHaveBeenCalledTimes(1);
    expect(Model.updateOne).toHaveBeenCalledWith(
      { deviceNameKey: 'l-ac', dateKey: '2026-05-22' },
      { $setOnInsert: snapshot },
      { upsert: true, setDefaultsOnInsert: true }
    );
  });

  test('upsertFreshSnapshot ignores older or equal snapshots', async () => {
    const Model = {
      updateOne: jest.fn()
        .mockResolvedValueOnce({ upsertedCount: 0 })
        .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 }),
    };
    const snapshot = {
      deviceNameKey: 'l-ac',
      dateKey: '2026-05-22',
      lastReadingAt: new Date('2026-05-22T06:41:38Z'),
      consumptionKwh: 0.012,
    };

    const status = await upsertFreshSnapshot(Model, { deviceNameKey: 'l-ac', dateKey: '2026-05-22' }, snapshot);

    expect(status).toBe('unchanged');
    expect(Model.updateOne).toHaveBeenCalledTimes(2);
    expect(Model.updateOne.mock.calls[1][0]).toEqual({
      deviceNameKey: 'l-ac',
      dateKey: '2026-05-22',
      $or: [
        { lastReadingAt: { $lt: snapshot.lastReadingAt } },
        { lastReadingAt: { $exists: false } },
      ],
    });
  });
});

describe('TapoReadingService', () => {
  test('saveBatch inserts raw readings once and ignores duplicate raw entries', async () => {
    const duplicateError = new Error('duplicate key');
    duplicateError.code = 11000;
    const TapoReading = {
      create: jest.fn()
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(duplicateError),
    };
    const TapoDailyConsumptionSnapshot = {
      updateOne: jest.fn()
        .mockResolvedValueOnce({ upsertedCount: 1 })
        .mockResolvedValueOnce({ upsertedCount: 0 })
        .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 }),
    };
    const TapoMonthlyConsumptionSnapshot = {
      updateOne: jest.fn()
        .mockResolvedValueOnce({ upsertedCount: 1 })
        .mockResolvedValueOnce({ upsertedCount: 0 })
        .mockResolvedValueOnce({ matchedCount: 0, modifiedCount: 0 }),
    };
    const service = new TapoReadingService({
      TapoReading,
      TapoDailyConsumptionSnapshot,
      TapoMonthlyConsumptionSnapshot,
    });
    const payload = {
      source: 'n8n-tapo',
      records: [
        createSampleRecord(),
        createSampleRecord({ device_ip: '192.168.0.99' }),
      ],
    };

    const result = await service.saveBatch(payload);

    expect(result.status).toBe('saved');
    expect(result.summary.inserted).toBe(1);
    expect(result.summary.duplicates).toBe(1);
    expect(result.summary.dailySnapshots).toEqual({ created: 1, updated: 0, unchanged: 1, skipped: 0 });
    expect(result.summary.monthlySnapshots).toEqual({ created: 1, updated: 0, unchanged: 1, skipped: 0 });
  });

  test('buildTapoDashboardData summarizes latest device values', () => {
    const dashboard = buildTapoDashboardData({
      readings: [
        {
          deviceName: 'L-AC',
          timestampUtc: new Date('2026-05-22T06:00:00Z'),
          bucketStartUtc: new Date('2026-05-22T06:00:00Z'),
          metrics: { current_power: 10 },
        },
        {
          deviceName: 'L-AC',
          timestampUtc: new Date('2026-05-22T06:10:00Z'),
          bucketStartUtc: new Date('2026-05-22T06:10:00Z'),
          metrics: { current_power: 20 },
        },
        {
          deviceName: 'L-PC',
          timestampUtc: new Date('2026-05-22T06:05:00Z'),
          bucketStartUtc: new Date('2026-05-22T06:00:00Z'),
          metrics: { current_power: 80 },
        },
      ],
      dailySnapshots: [
        { deviceName: 'L-AC', dateKey: '2026-05-22', consumptionKwh: 0.4 },
        { deviceName: 'L-PC', dateKey: '2026-05-22', consumptionKwh: 3.2 },
      ],
      monthlySnapshots: [
        { deviceName: 'L-AC', monthKey: '2026-05', consumptionKwh: 8 },
        { deviceName: 'L-PC', monthKey: '2026-05', consumptionKwh: 106 },
      ],
      totalRawCount: 30,
    });

    expect(dashboard.stats.deviceCount).toBe(2);
    expect(dashboard.stats.totalCurrentPowerW).toBe(100);
    expect(dashboard.stats.totalTodayKwh).toBeCloseTo(3.6);
    expect(dashboard.stats.totalMonthKwh).toBe(114);
    expect(dashboard.deviceStats.map((entry) => entry.deviceName)).toEqual(['L-PC', 'L-AC']);
    expect(dashboard.powerSeries[0].bucketStart).toBe('2026-05-22T06:00:00.000Z');
  });

  test('buildTapoBatchResponse matches the compact API response shape', () => {
    const response = buildTapoBatchResponse({
      results: [
        { status: 'inserted', readingId: 'sample:192.168.0.27:2026-05-22T18:30:00+00:00', index: 0 },
        { status: 'inserted', readingId: 'sample:192.168.0.29:2026-05-22T18:30:00+00:00', index: 1 },
        { status: 'duplicate', readingId: 'sample:192.168.0.30:2026-05-22T18:30:00+00:00', index: 2 },
      ],
    });

    expect(response).toEqual({
      ok: true,
      accepted: [
        'sample:192.168.0.27:2026-05-22T18:30:00+00:00',
        'sample:192.168.0.29:2026-05-22T18:30:00+00:00',
      ],
      duplicates: [
        'sample:192.168.0.30:2026-05-22T18:30:00+00:00',
      ],
      failed: [],
    });
  });
});
