const logger = require('../utils/logger');
const {
  RunpodBillingPeriod,
  RunpodOperationEvent,
  RunpodPod,
  RunpodPodBillingPeriod,
} = require('../database');
const {
  RESOURCE_ID_PATTERN,
  RunpodApiV2Service,
} = require('./runpodApiV2Service');
const { actorFromPrincipal } = require('./runpodPodManager');

const DEFAULT_HISTORY_START = '2025-11-01';
const MONTH_START_PATTERN = /^\d{4}-\d{2}-01$/;
const MAX_STORED_ACCOUNT_PERIODS = 240;
const MAX_STORED_POD_PERIODS = 10_000;
const ACCOUNT_AMOUNT_FIELDS = Object.freeze([
  'totalAmount',
  'podGpuAmount',
  'podCpuAmount',
  'podDiskAmount',
  'serverlessGpuAmount',
  'serverlessCpuAmount',
  'serverlessDiskAmount',
  'serverlessFeeAmount',
  'storageStandardAmount',
  'storageHighPerformanceAmount',
  'endpointAmount',
  'clusterGpuAmount',
  'clusterDiskAmount',
  'clusterNetworkingAmount',
]);

class RunpodBillingHistoryError extends Error {
  constructor(message, { code = 'RUNPOD_BILLING_SYNC_FAILED', status = 502 } = {}) {
    super(message);
    this.name = 'RunpodBillingHistoryError';
    this.code = code;
    this.status = status;
  }
}

function safeString(value, maxLength = 120) {
  if (value === undefined || value === null) return '';
  return String(value)
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .trim()
    .slice(0, maxLength);
}

function safeAmount(value) {
  if (value === null || value === undefined || value === '') return 0;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function addAmounts(left, right) {
  return Number((safeAmount(left) + safeAmount(right)).toFixed(12));
}

function dateOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcMonthStart(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addUtcMonths(value, amount) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + amount, 1));
}

function monthKey(value) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
}

function parseHistoryStart(value = process.env.RUNPOD_BILLING_HISTORY_START || DEFAULT_HISTORY_START) {
  const normalized = safeString(value, 10);
  if (!MONTH_START_PATTERN.test(normalized)) {
    throw new RunpodBillingHistoryError(
      'RUNPOD_BILLING_HISTORY_START must be the first day of a UTC month.',
      { code: 'RUNPOD_BILLING_START_INVALID', status: 500 }
    );
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || monthKey(date) !== normalized.slice(0, 7)) {
    throw new RunpodBillingHistoryError(
      'RUNPOD_BILLING_HISTORY_START is invalid.',
      { code: 'RUNPOD_BILLING_START_INVALID', status: 500 }
    );
  }
  return date;
}

function enumerateMonths(start, now) {
  const first = utcMonthStart(start);
  const current = utcMonthStart(now);
  if (!first || !current || first > current) {
    throw new RunpodBillingHistoryError('The Runpod billing history range is invalid.', {
      code: 'RUNPOD_BILLING_RANGE_INVALID', status: 500,
    });
  }
  const periods = [];
  for (let cursor = first; cursor <= current; cursor = addUtcMonths(cursor, 1)) {
    if (periods.length >= MAX_STORED_ACCOUNT_PERIODS) {
      throw new RunpodBillingHistoryError('The Runpod billing history range is too large.', {
        code: 'RUNPOD_BILLING_RANGE_TOO_LARGE', status: 500,
      });
    }
    periods.push({
      key: monthKey(cursor),
      startTime: new Date(cursor),
      endTime: addUtcMonths(cursor, 1),
      finalized: addUtcMonths(cursor, 1) <= current,
    });
  }
  return periods;
}

function accountAmounts(record = {}) {
  const source = record && typeof record === 'object' ? record : {};
  return Object.fromEntries(ACCOUNT_AMOUNT_FIELDS.map((field) => [field, safeAmount(source[field])]));
}

function podAmounts(record = {}) {
  const source = record && typeof record === 'object' ? record : {};
  return {
    totalAmount: safeAmount(source.totalAmount),
    gpuAmount: safeAmount(source.gpuAmount),
    cpuAmount: safeAmount(source.cpuAmount),
    diskAmount: safeAmount(source.diskAmount),
  };
}

function providerError(error) {
  return {
    code: safeString(error?.code, 80) || 'RUNPOD_BILLING_SYNC_FAILED',
    status: Number.isSafeInteger(error?.status) ? error.status : null,
  };
}

function queryLean(query) {
  return typeof query?.lean === 'function' ? query.lean() : query;
}

class RunpodBillingHistoryService {
  constructor({
    runpodService = new RunpodApiV2Service(),
    accountBillingModel = RunpodBillingPeriod,
    podBillingModel = RunpodPodBillingPeriod,
    podModel = RunpodPod,
    eventModel = RunpodOperationEvent,
    appLogger = logger,
    now = () => new Date(),
    historyStart = parseHistoryStart(),
  } = {}) {
    this.runpodService = runpodService;
    this.accountBillingModel = accountBillingModel;
    this.podBillingModel = podBillingModel;
    this.podModel = podModel;
    this.eventModel = eventModel;
    this.logger = appLogger;
    this.now = now;
    this.historyStart = utcMonthStart(historyStart);
    if (!this.historyStart) {
      throw new RunpodBillingHistoryError('The Runpod billing history start is invalid.', {
        code: 'RUNPOD_BILLING_START_INVALID', status: 500,
      });
    }
    this.syncQueue = Promise.resolve();
  }

  range(now = this.now()) {
    const current = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(current.getTime()) || current < this.historyStart) {
      throw new RunpodBillingHistoryError('The Runpod billing history range is invalid.', {
        code: 'RUNPOD_BILLING_RANGE_INVALID', status: 500,
      });
    }
    return {
      startTime: this.historyStart.toISOString(),
      endTime: addUtcMonths(utcMonthStart(current), 1).toISOString(),
      bucketSize: 'month',
    };
  }

  async recordSyncEvent(outcome, actor, error = null) {
    try {
      await this.eventModel.create({
        resourceType: 'billing',
        action: 'billing_sync',
        outcome,
        errorCode: error ? providerError(error).code : null,
        providerStatus: error ? providerError(error).status : null,
        actor,
      });
    } catch (eventError) {
      this.logger.warning('Unable to persist Runpod billing synchronization audit event', {
        category: 'runpod_billing',
        metadata: { errorName: safeString(eventError?.name, 80) || 'Error' },
      });
    }
  }

  syncHistory(principal) {
    const operation = this.syncQueue.then(() => this._syncHistory(principal));
    this.syncQueue = operation.catch(() => {});
    return operation;
  }

  async _syncHistory(principal) {
    const syncedAt = this.now();
    const actor = actorFromPrincipal(principal);
    const range = this.range(syncedAt);
    const [accountResult, podResult] = await Promise.allSettled([
      this.runpodService.getBilling({ ...range, forceRefresh: true }),
      this.runpodService.getPodBilling({ ...range, forceRefresh: true }),
    ]);
    const errors = {};
    let accountPeriods = 0;
    let podPeriods = 0;
    let historicalPods = 0;

    try {
      if (accountResult.status === 'fulfilled') {
        accountPeriods = await this.persistAccountHistory(accountResult.value.records, syncedAt);
      } else {
        errors.account = providerError(accountResult.reason);
      }
      if (podResult.status === 'fulfilled') {
        const podSummary = await this.persistPodHistory(podResult.value.records, actor, syncedAt);
        podPeriods = podSummary.periods;
        historicalPods = podSummary.historicalPods;
      } else {
        errors.pods = providerError(podResult.reason);
      }
    } catch (error) {
      await this.recordSyncEvent('failed', actor, error);
      this.logger.error('Runpod billing history persistence failed', {
        category: 'runpod_billing',
        metadata: providerError(error),
      });
      throw error;
    }

    if (accountResult.status === 'rejected' && podResult.status === 'rejected') {
      const error = new RunpodBillingHistoryError('Runpod billing history is temporarily unavailable.', {
        code: 'RUNPOD_BILLING_PROVIDER_UNAVAILABLE', status: 502,
      });
      await this.recordSyncEvent('failed', actor, error);
      this.logger.error('Runpod account and pod billing synchronization failed', {
        category: 'runpod_billing',
        metadata: {
          accountErrorCode: errors.account.code,
          accountStatus: errors.account.status,
          podErrorCode: errors.pods.code,
          podStatus: errors.pods.status,
        },
      });
      throw error;
    }

    await this.recordSyncEvent(Object.keys(errors).length ? 'failed' : 'succeeded', actor);
    if (Object.keys(errors).length) {
      this.logger.warning('Runpod billing history synchronized with partial provider failures', {
        category: 'runpod_billing',
        metadata: {
          failedSections: Object.keys(errors),
          errorCodes: Object.values(errors).map((error) => error.code),
        },
      });
    }
    return { accountPeriods, podPeriods, historicalPods, errors };
  }

  async persistAccountHistory(records = [], syncedAt = this.now()) {
    const periods = enumerateMonths(this.historyStart, syncedAt);
    const existingDocuments = await this.accountBillingModel
      .find({
        bucketSize: 'month',
        startTime: { $gte: this.historyStart, $lte: utcMonthStart(syncedAt) },
      })
      .sort({ startTime: 1 })
      .limit(MAX_STORED_ACCOUNT_PERIODS)
      .lean();
    const existingByMonth = new Map();
    for (const document of Array.isArray(existingDocuments) ? existingDocuments : []) {
      const startTime = utcMonthStart(document?.startTime);
      if (startTime) existingByMonth.set(monthKey(startTime), document);
    }
    const providerByMonth = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      const startTime = utcMonthStart(record?.startTime);
      if (!startTime || startTime < this.historyStart || startTime > utcMonthStart(syncedAt)) continue;
      providerByMonth.set(monthKey(startTime), record);
    }
    const operations = periods.map((period) => {
      const providerRecord = providerByMonth.get(period.key);
      const existing = existingByMonth.get(period.key);
      const retainProviderRecord = !providerRecord && (
        existing?.providerRecordPresent === true
        || existing?.source === 'provider'
      );
      const source = providerRecord || retainProviderRecord
        ? 'provider'
        : (period.finalized ? 'synthesized_zero' : 'provisional_zero');
      return {
        updateOne: {
          filter: { bucketSize: 'month', startTime: period.startTime },
          update: {
            $set: {
              bucketSize: 'month',
              periodKey: period.key,
              startTime: period.startTime,
              endTime: period.endTime,
              currency: 'USD',
              source,
              providerRecordPresent: Boolean(providerRecord || retainProviderRecord),
              finalized: period.finalized,
              amounts: accountAmounts(
                providerRecord || (retainProviderRecord ? existing?.amounts : null)
              ),
              syncedAt,
            },
          },
          upsert: true,
        },
      };
    });
    if (operations.length) await this.accountBillingModel.bulkWrite(operations, { ordered: false });
    return operations.length;
  }

  async ensureHistoricalPod(providerPodId, bounds, actor, syncedAt) {
    const suffix = providerPodId.slice(-8);
    const document = await this.podModel.findOneAndUpdate(
      { providerPodId },
      {
        $setOnInsert: {
          providerPodId,
          name: `Historical Pod ${suffix}`,
          recordOrigin: 'billing_history',
          providerStatus: 'TERMINATED',
          lifecycleGroup: 'archived',
          validActions: [],
          setupStatus: 'not_applicable',
          setupModel: '',
          cloud: 'UNKNOWN',
          gpu: {
            id: 'Unknown (billing history)',
            name: 'Unknown (billing history)',
            count: 1,
          },
          providerCostPerHour: 0,
          autoStopAt: null,
          providerCreatedAt: bounds.first,
          lastProviderSyncAt: syncedAt,
          archivedAt: bounds.last,
          usageTrackingMode: 'billing_only',
          usageState: 'archived',
          usageLastObservedAt: syncedAt,
          createdBy: actor,
          updatedBy: actor,
        },
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    return {
      id: document?._id || null,
      inserted: document?.recordOrigin === 'billing_history'
        && document?.createdAt
        && Math.abs(new Date(document.createdAt).getTime() - syncedAt.getTime()) < 10_000,
    };
  }

  async persistPodHistory(records = [], actor = actorFromPrincipal(), syncedAt = this.now()) {
    const currentMonth = utcMonthStart(syncedAt);
    const byPodMonth = new Map();
    const boundsByPod = new Map();
    for (const record of Array.isArray(records) ? records : []) {
      const providerPodId = safeString(record?.podId, 128);
      const startTime = utcMonthStart(record?.startTime);
      if (
        !RESOURCE_ID_PATTERN.test(providerPodId)
        || !startTime
        || startTime < this.historyStart
        || startTime > currentMonth
      ) continue;
      const key = `${providerPodId}:${monthKey(startTime)}`;
      const existing = byPodMonth.get(key);
      const amounts = podAmounts(record);
      byPodMonth.set(key, existing ? {
        ...existing,
        totalAmount: addAmounts(existing.totalAmount, amounts.totalAmount),
        gpuAmount: addAmounts(existing.gpuAmount, amounts.gpuAmount),
        cpuAmount: addAmounts(existing.cpuAmount, amounts.cpuAmount),
        diskAmount: addAmounts(existing.diskAmount, amounts.diskAmount),
      } : {
        providerPodId,
        startTime,
        endTime: addUtcMonths(startTime, 1),
        periodKey: monthKey(startTime),
        finalized: addUtcMonths(startTime, 1) <= currentMonth,
        ...amounts,
      });
      const boundedPeriodEnd = addUtcMonths(startTime, 1) > syncedAt
        ? syncedAt
        : addUtcMonths(startTime, 1);
      const bounds = boundsByPod.get(providerPodId) || {
        first: startTime,
        last: boundedPeriodEnd,
      };
      if (startTime < bounds.first) bounds.first = startTime;
      const periodEnd = boundedPeriodEnd;
      if (periodEnd > bounds.last) bounds.last = periodEnd;
      boundsByPod.set(providerPodId, bounds);
    }

    const podRecordIds = new Map();
    let historicalPods = 0;
    for (const [providerPodId, bounds] of boundsByPod) {
      const existing = await queryLean(this.podModel.findOne({ providerPodId }));
      if (existing) {
        podRecordIds.set(providerPodId, existing._id);
        continue;
      }
      const ensured = await this.ensureHistoricalPod(providerPodId, bounds, actor, syncedAt);
      podRecordIds.set(providerPodId, ensured.id);
      historicalPods += 1;
    }

    const operations = Array.from(byPodMonth.values()).map((record) => ({
      updateOne: {
        filter: {
          providerPodId: record.providerPodId,
          bucketSize: 'month',
          startTime: record.startTime,
        },
        update: {
          $set: {
            providerPodId: record.providerPodId,
            podRecordId: podRecordIds.get(record.providerPodId) || null,
            bucketSize: 'month',
            periodKey: record.periodKey,
            startTime: record.startTime,
            endTime: record.endTime,
            currency: 'USD',
            totalAmount: record.totalAmount,
            gpuAmount: record.gpuAmount,
            cpuAmount: record.cpuAmount,
            diskAmount: record.diskAmount,
            finalized: record.finalized,
            syncedAt,
          },
        },
        upsert: true,
      },
    }));
    if (operations.length) await this.podBillingModel.bulkWrite(operations, { ordered: false });

    await this.podModel.updateMany(
      { providerPodId: { $type: 'string' } },
      { $set: { billingSyncedAt: syncedAt } }
    );
    const billingDocuments = await this.podBillingModel
      .find({ startTime: { $gte: this.historyStart } })
      .sort({ startTime: 1 })
      .limit(MAX_STORED_POD_PERIODS)
      .lean();
    const totals = new Map();
    for (const record of billingDocuments) {
      const providerPodId = safeString(record.providerPodId, 128);
      if (!providerPodId) continue;
      const aggregate = totals.get(providerPodId) || {
        total: 0,
        compute: 0,
        storage: 0,
        first: record.startTime,
        last: record.endTime,
      };
      aggregate.total = addAmounts(aggregate.total, record.totalAmount);
      aggregate.compute = addAmounts(
        aggregate.compute,
        addAmounts(record.gpuAmount, record.cpuAmount)
      );
      aggregate.storage = addAmounts(aggregate.storage, record.diskAmount);
      if (record.startTime < aggregate.first) aggregate.first = record.startTime;
      if (record.endTime > aggregate.last) aggregate.last = record.endTime;
      totals.set(providerPodId, aggregate);
    }
    for (const [providerPodId, aggregate] of totals) {
      await this.podModel.updateOne(
        { providerPodId },
        {
          $set: {
            billingTotalUsd: aggregate.total,
            billingComputeUsd: aggregate.compute,
            billingStorageUsd: aggregate.storage,
            billingFirstPeriodAt: aggregate.first,
            billingLastPeriodEndAt: aggregate.last,
            billingSyncedAt: syncedAt,
            updatedBy: actor,
          },
        }
      );
    }
    return { periods: operations.length, historicalPods };
  }

  async getStoredHistory() {
    const documents = await this.accountBillingModel
      .find({ bucketSize: 'month', startTime: { $gte: this.historyStart } })
      .sort({ startTime: 1 })
      .limit(MAX_STORED_ACCOUNT_PERIODS)
      .lean();
    const periods = documents.map((document) => ({
      periodKey: safeString(document.periodKey, 7),
      startTime: document.startTime || null,
      endTime: document.endTime || null,
      source: safeString(document.source, 30),
      providerRecordPresent: document.providerRecordPresent === true,
      finalized: document.finalized === true,
      amounts: accountAmounts(document.amounts),
      syncedAt: document.syncedAt || null,
    }));
    const totals = accountAmounts();
    for (const period of periods) {
      for (const field of ACCOUNT_AMOUNT_FIELDS) {
        totals[field] = addAmounts(totals[field], period.amounts[field]);
      }
    }
    return {
      historyStart: this.historyStart,
      periods,
      totals,
      providerMonthCount: periods.filter((period) => period.providerRecordPresent).length,
      zeroMonthCount: periods.filter((period) => !period.providerRecordPresent).length,
      lastSyncedAt: periods.reduce((latest, period) => {
        const syncedAt = dateOrNull(period.syncedAt);
        return syncedAt && (!latest || syncedAt > latest) ? syncedAt : latest;
      }, null),
    };
  }
}

const runpodBillingHistoryService = new RunpodBillingHistoryService();

module.exports = {
  ACCOUNT_AMOUNT_FIELDS,
  DEFAULT_HISTORY_START,
  MAX_STORED_ACCOUNT_PERIODS,
  MAX_STORED_POD_PERIODS,
  RunpodBillingHistoryError,
  RunpodBillingHistoryService,
  accountAmounts,
  addAmounts,
  addUtcMonths,
  enumerateMonths,
  monthKey,
  parseHistoryStart,
  podAmounts,
  runpodBillingHistoryService,
  safeAmount,
  utcMonthStart,
};
