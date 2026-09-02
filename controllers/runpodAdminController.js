const logger = require('../utils/logger');
const {
  BILLING_BUCKET_SIZES,
  MAX_BILLING_BUCKETS,
  RUNPOD_API_ORIGIN,
  RunpodApiV2Service,
  RunpodConfigurationError,
} = require('../services/runpodApiV2Service');
const { runpodBillingHistoryService } = require('../services/runpodBillingHistoryService');
const { runpodPodManager } = require('../services/runpodPodManager');

const PRIVATE_NO_STORE = 'private, no-store, max-age=0';
const RUNPOD_ADMIN_PATH = '/admin/runpod';
const DEFAULT_FILTERS = Object.freeze({
  bucketSize: 'day',
  lastN: 30,
  forceRefresh: false,
  notice: '',
});
const ALLOWED_QUERY_FIELDS = new Set(['bucketSize', 'lastN', 'refresh', 'notice']);
const AVAILABILITY_LEVELS = new Set(['NONE', 'LOW', 'MEDIUM', 'HIGH']);
const SECTION_LABELS = Object.freeze({
  gpus: 'GPU catalog',
  cpus: 'CPU catalog',
  dataCenters: 'Data centers',
  templates: 'Official templates',
  billing: 'Billing history',
});
const NOTICE_MESSAGES = Object.freeze({
  'template-synced': { type: 'success', message: 'The Ollama workload template is synced with Runpod v2.' },
  'template-failed': { type: 'error', message: 'The Ollama workload template could not be synced.' },
  'gateway-template-synced': { type: 'success', message: 'The Cloudflare Access Ollama template is synced with Runpod v2.' },
  'gateway-template-failed': { type: 'error', message: 'The Cloudflare Access template could not be synced. Check the gateway environment and Runpod Secret bootstrap.' },
  'cloudflare-access-denied': { type: 'error', message: 'Cloudflare Access rejected the service token before any GPU was rented. Add this token to a Service Auth policy using the Service Token selector, then retry.' },
  'cloudflare-access-not-enforced': { type: 'error', message: 'Cloudflare Access did not block an anonymous gateway request. Protect the entire LLM hostname before creating a Pod.' },
  'model-download-created': { type: 'success', message: 'The model download Pod was created. It will verify the model, delete itself, and keep the network volume.' },
  'model-download-failed': { type: 'error', message: 'The model download could not be started. Check volume location, GPU availability, and the confirmed cost limit.' },
  'model-artifact-preparation-created': { type: 'success', message: 'The pinned GLM artifact preparation Pod was created. It exposes no ports, verifies every shard, and deletes itself after completion.' },
  'model-artifact-preparation-failed': { type: 'error', message: 'The GLM artifact preparation could not be started. Check the dedicated volume, EU-RO-1 GPU availability, and the confirmed cost ceiling.' },
  'pod-created': { type: 'success', message: 'The pod was created. Ollama setup is running in the background.' },
  'pod-create-failed': { type: 'error', message: 'The pod could not be created. Check current availability and try again.' },
  'pod-started': { type: 'success', message: 'The pod start request was accepted.' },
  'pod-start-failed': { type: 'error', message: 'The pod could not be started in its current state.' },
  'pod-start-gpu-unavailable': { type: 'error', message: 'The original GPU for this stopped Pod is unavailable. Wait and retry, or delete and redeploy on currently available hardware.' },
  'pod-start-rate-limited': { type: 'error', message: 'Runpod is rate limiting Pod starts. Wait briefly and retry.' },
  'pod-stopped': { type: 'success', message: 'The pod stop request was accepted.' },
  'pod-stop-failed': { type: 'error', message: 'The pod could not be stopped in its current state.' },
  'pod-extended': { type: 'success', message: 'The automatic-stop deadline was extended.' },
  'pod-extend-failed': { type: 'error', message: 'The automatic-stop deadline could not be extended. Review the Pod error and current state.' },
  'pod-deleted': { type: 'success', message: 'The pod was permanently terminated and archived locally.' },
  'pod-delete-failed': { type: 'error', message: 'The pod could not be deleted. Confirm the exact pod name and try again.' },
  'setup-queued': { type: 'success', message: 'Ollama setup was queued again.' },
  'setup-failed': { type: 'error', message: 'Ollama setup could not be queued.' },
  'pods-synced': { type: 'success', message: 'Provider pod state was synchronized with the local records.' },
  'pods-sync-failed': { type: 'error', message: 'Provider pod state could not be synchronized.' },
  'billing-synced': { type: 'success', message: 'Monthly account and Pod billing history was synchronized.' },
  'billing-sync-failed': { type: 'error', message: 'Billing history could not be fully synchronized. Stored history remains available.' },
  'network-volume-created': { type: 'success', message: 'The network volume was created and is ready for Secure Cloud Pods in its data center.' },
  'network-volume-create-failed': { type: 'error', message: 'The network volume could not be created. Check the storage tier, data center, and confirmed monthly limit.' },
  'network-volume-deleted': { type: 'success', message: 'The network volume was permanently deleted and archived locally.' },
  'network-volume-delete-failed': { type: 'error', message: 'The network volume could not be deleted. Detach it from every Pod and confirm its exact name.' },
  'network-volumes-synced': { type: 'success', message: 'Provider network volumes were synchronized with the local records.' },
  'network-volumes-sync-failed': { type: 'error', message: 'Network volumes could not be synchronized. Stored records remain available.' },
  'insufficient-balance': { type: 'error', message: 'Runpod reported insufficient account balance for this operation.' },
  'cost-limit': { type: 'error', message: 'The current hourly price exceeds the confirmed or server-side cost limit.' },
  'storage-cost-limit': { type: 'error', message: 'The estimated monthly storage price exceeds the confirmed or server-side cost limit.' },
});

const defaultRunpodService = new RunpodApiV2Service();

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function safeString(value, maxLength = 240) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, ' ').trim().slice(0, maxLength);
}

function safeStringList(value, { maxItems = 50, maxLength = 120 } = {}) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((entry) => safeString(entry, maxLength))
    .filter(Boolean);
}

function availability(value) {
  const normalized = safeString(value, 20).toUpperCase();
  return AVAILABILITY_LEVELS.has(normalized) ? normalized : 'UNKNOWN';
}

function sumAmounts(source, fields) {
  return fields.reduce((total, field) => total + (finiteNumber(source?.[field], 0) || 0), 0);
}

function mapBillingAmounts(source = {}) {
  const pods = sumAmounts(source, ['podGpuAmount', 'podCpuAmount', 'podDiskAmount']);
  const serverless = sumAmounts(source, [
    'serverlessGpuAmount',
    'serverlessCpuAmount',
    'serverlessDiskAmount',
    'serverlessFeeAmount',
  ]);
  const storage = sumAmounts(source, ['storageStandardAmount', 'storageHighPerformanceAmount']);
  const endpoints = finiteNumber(source.endpointAmount, 0) || 0;
  const clusters = sumAmounts(source, [
    'clusterGpuAmount',
    'clusterDiskAmount',
    'clusterNetworkingAmount',
  ]);
  const calculatedTotal = pods + serverless + storage + endpoints + clusters;

  return {
    total: finiteNumber(source.totalAmount, calculatedTotal) ?? calculatedTotal,
    pods,
    serverless,
    storage,
    endpoints,
    clusters,
  };
}

function mapGpu(gpu = {}) {
  const cudaVersions = Array.isArray(gpu.cudaVersions)
    ? gpu.cudaVersions.slice(0, 30).map((entry) => ({
      version: safeString(entry?.version, 20),
      available: entry?.available === true,
    })).filter((entry) => entry.version)
    : [];

  return {
    id: safeString(gpu.id),
    name: safeString(gpu.name) || safeString(gpu.id),
    manufacturer: safeString(gpu.manufacturer, 40) || 'Unknown',
    memoryGb: finiteNumber(gpu.memory),
    pool: safeString(gpu.pool, 80),
    availability: availability(gpu.availability),
    secure: gpu.secure === true,
    community: gpu.community === true,
    securePrice: finiteNumber(gpu.price?.secure),
    communityPrice: finiteNumber(gpu.price?.community),
    serverlessPrice: finiteNumber(gpu.price?.serverless),
    maxSecureCount: finiteNumber(gpu.maxCount?.secure),
    maxCommunityCount: finiteNumber(gpu.maxCount?.community),
    dataCenterCount: Array.isArray(gpu.dataCenters) ? gpu.dataCenters.length : 0,
    cudaVersions,
  };
}

function mapCpu(cpu = {}) {
  return {
    id: safeString(cpu.id),
    name: safeString(cpu.name) || safeString(cpu.id),
    group: safeString(cpu.group, 80),
    availability: availability(cpu.availability),
    minimumVcpu: finiteNumber(cpu.vcpu?.min),
    maximumVcpu: finiteNumber(cpu.vcpu?.max),
    ramGbPerVcpu: finiteNumber(cpu.ramGbPerVcpu),
    securePricePerVcpu: finiteNumber(cpu.price?.securePerVcpu),
    serverlessPricePerVcpu: finiteNumber(cpu.price?.serverlessPerVcpu),
    dataCenterCount: Array.isArray(cpu.dataCenters) ? cpu.dataCenters.length : 0,
  };
}

function mapDataCenter(dataCenter = {}) {
  return {
    id: safeString(dataCenter.id),
    name: safeString(dataCenter.name) || safeString(dataCenter.id),
    region: safeString(dataCenter.region, 80) || 'UNKNOWN',
    globalNetwork: dataCenter.globalNetwork === true,
    networkVolumeTypes: safeStringList(dataCenter.networkVolumeTypes, { maxItems: 10 }),
    compliance: safeStringList(dataCenter.compliance, { maxItems: 20 }),
  };
}

function mapTemplate(template = {}) {
  return {
    id: safeString(template.id),
    name: safeString(template.name) || safeString(template.id),
    category: safeString(template.category, 40) || 'Unknown',
    image: safeString(template.image, 500),
    diskGb: finiteNumber(template.disk),
    persistentDiskGb: finiteNumber(template.mounts?.persistent?.size),
    persistentPath: safeString(template.mounts?.persistent?.path, 300),
    cudaVersions: safeStringList(template.allowedCudaVersions, { maxItems: 30, maxLength: 20 }),
    ports: safeStringList(template.ports, { maxItems: 30, maxLength: 40 }),
    startJupyter: template.startJupyter === true,
    startSsh: template.startSsh === true,
    serverless: template.serverless === true,
  };
}

function providerErrorMessage(label, code, status) {
  if (code === 'RUNPOD_TIMEOUT') return `${label} request timed out.`;
  if (code === 'RUNPOD_NETWORK_ERROR') return `${label} could not be reached.`;
  if (code === 'RUNPOD_INVALID_RESPONSE') return `${label} returned an invalid response.`;
  if (code === 'RUNPOD_RESPONSE_TOO_LARGE') return `${label} returned more data than the monitor accepts.`;
  if (code === 'RUNPOD_NOT_CONFIGURED') return 'Runpod is not configured on this server.';
  if (code === 'RUNPOD_HTTP_ERROR' && status) return `${label} request failed with HTTP ${status}.`;
  return `${label} could not be loaded.`;
}

function mapErrorSections(errors = {}) {
  return Object.entries(errors)
    .filter(([section]) => Object.hasOwn(SECTION_LABELS, section))
    .map(([section, error]) => {
      const label = SECTION_LABELS[section];
      const code = safeString(error?.code, 80) || 'RUNPOD_API_ERROR';
      const candidateStatus = finiteNumber(error?.status);
      const status = Number.isSafeInteger(candidateStatus)
        && candidateStatus >= 100
        && candidateStatus <= 599
        ? candidateStatus
        : null;
      return {
        section,
        label,
        code,
        status,
        message: providerErrorMessage(label, code, status),
      };
    });
}

function mapStoredBillingHistory(history = {}) {
  const records = (Array.isArray(history.periods) ? history.periods : [])
    .slice(0, 240)
    .map((period) => ({
      periodKey: safeString(period.periodKey, 7),
      startTime: period.startTime || null,
      endTime: period.endTime || null,
      source: safeString(period.source, 30),
      providerRecordPresent: period.providerRecordPresent === true,
      finalized: period.finalized === true,
      syncedAt: period.syncedAt || null,
      ...mapBillingAmounts(period.amounts || {}),
    }))
    .sort((left, right) => right.periodKey.localeCompare(left.periodKey));
  return {
    records,
    totals: mapBillingAmounts(history.totals || {}),
    historyStart: history.historyStart || null,
    lastSyncedAt: history.lastSyncedAt || null,
    providerMonthCount: finiteNumber(history.providerMonthCount, 0) || 0,
    zeroMonthCount: finiteNumber(history.zeroMonthCount, 0) || 0,
    error: history.error || null,
  };
}

function mapManagementPod(pod = {}) {
  return {
    ...pod,
    usage: {
      trackingAvailable: false,
      runningMs: 0,
      stoppedMs: 0,
      lifetimeMs: 0,
      estimatedComputeUsd: 0,
      estimatedStorageUsd: 0,
      estimatedTotalUsd: 0,
      ...(pod.usage || {}),
    },
    billing: {
      available: false,
      totalUsd: 0,
      computeUsd: 0,
      storageUsd: 0,
      syncedAt: null,
      ...(pod.billing || {}),
    },
  };
}

function buildPageModel(
  dashboard = {},
  filters = DEFAULT_FILTERS,
  management = {},
  storedHistory = {}
) {
  const gpus = (Array.isArray(dashboard.gpus) ? dashboard.gpus : [])
    .map(mapGpu)
    .sort((left, right) => (
      (right.memoryGb ?? -1) - (left.memoryGb ?? -1)
      || left.name.localeCompare(right.name)
    ));
  const cpus = (Array.isArray(dashboard.cpus) ? dashboard.cpus : [])
    .map(mapCpu)
    .sort((left, right) => left.name.localeCompare(right.name));
  const dataCenters = (Array.isArray(dashboard.dataCenters) ? dashboard.dataCenters : [])
    .map(mapDataCenter)
    .sort((left, right) => left.region.localeCompare(right.region) || left.name.localeCompare(right.name));
  const templates = (Array.isArray(dashboard.templates) ? dashboard.templates : [])
    .map(mapTemplate)
    .sort((left, right) => left.name.localeCompare(right.name));
  const billingSource = dashboard.billing && typeof dashboard.billing === 'object'
    ? dashboard.billing
    : { records: [], metadata: { totals: {} } };
  const billingRecords = (Array.isArray(billingSource.records) ? billingSource.records : [])
    .slice(0, MAX_BILLING_BUCKETS)
    .map((record) => ({
      startTime: safeString(record?.startTime, 80),
      endTime: safeString(record?.endTime, 80),
      ...mapBillingAmounts(record),
    }))
    .sort((left, right) => right.startTime.localeCompare(left.startTime));
  const billingTotals = mapBillingAmounts(billingSource.metadata?.totals || {});
  const errorSections = mapErrorSections(dashboard.errors);
  const regions = Array.from(new Set(dataCenters.map((entry) => entry.region))).sort();

  return {
    pageTitle: 'Runpod API v2 - Admin',
    adminPath: RUNPOD_ADMIN_PATH,
    apiBaseUrl: `${RUNPOD_API_ORIGIN}/v2`,
    apiVersion: safeString(dashboard.apiVersion, 20) || 'v2',
    fetchedAt: safeString(dashboard.fetchedAt, 80),
    filters,
    billingBucketSizes: BILLING_BUCKET_SIZES,
    maxBillingBuckets: MAX_BILLING_BUCKETS,
    gpus,
    cpus,
    dataCenters,
    templates,
    billing: {
      records: billingRecords,
      recordCount: billingRecords.length,
      totals: billingTotals,
      query: {
        startTime: safeString(billingSource.metadata?.query?.startTime, 80),
        endTime: safeString(billingSource.metadata?.query?.endTime, 80),
        bucketSize: safeString(billingSource.metadata?.query?.bucketSize, 20) || filters.bucketSize,
      },
    },
    billingHistory: mapStoredBillingHistory(storedHistory),
    errorSections,
    notice: NOTICE_MESSAGES[filters.notice] || null,
    podManagement: {
      limits: {
        maxActivePods: 2,
        maxGpuCount: 16,
        maxHourlyCostUsd: 100,
        maxNetworkVolumeGb: 2048,
        maxNetworkVolumeMonthlyCostUsd: 150,
        standardStorageUsdPerGbMonth: 0.07,
        highPerformanceStorageUsdPerGbMonth: null,
        defaultAutoStopMinutes: 60,
        defaultModelDownloadAutoStopMinutes: 240,
        defaultModelDownloadMaxHourlyCostUsd: 1,
        defaultModelArtifactMaxHourlyCostUsd: 0.99,
        maxRuntimeMinutes: 1440,
        ...(management.limits || {}),
      },
      gateway: {
        accessMode: 'cloudflare_access',
        gatewayUrl: 'https://llm.lentmiien.com/',
        originHostHeader: 'localhost:8080',
        serviceTokenConfigured: false,
        serviceTokenPartiallyConfigured: false,
        tunnelTokenConfigured: false,
        runpodSecretName: 'lentmiien_cloudflare_tunnel_token',
        llmApiKeyConfigured: false,
        llmApiSecretName: 'lentmiien_llm_api_key',
        readyForTemplate: false,
        ...(management.gateway || {}),
      },
      templates: Array.isArray(management.templates) ? management.templates.slice(0, 100) : [],
      modelDownloads: Array.isArray(management.modelDownloads)
        ? management.modelDownloads.slice(0, 200).map(mapManagementPod)
        : [],
      modelArtifactPreparations: Array.isArray(management.modelArtifactPreparations)
        ? management.modelArtifactPreparations.slice(0, 200).map(mapManagementPod)
        : [],
      modelArtifacts: Array.isArray(management.modelArtifacts)
        ? management.modelArtifacts.slice(0, 200)
        : [],
      modelArtifactPresets: Array.isArray(management.modelArtifactPresets)
        ? management.modelArtifactPresets.slice(0, 20)
        : [],
      managedPods: Array.isArray(management.managedPods)
        ? management.managedPods.slice(0, 200).map(mapManagementPod)
        : [],
      archivedPods: Array.isArray(management.archivedPods)
        ? management.archivedPods.slice(0, 200).map(mapManagementPod)
        : [],
      networkVolumes: Array.isArray(management.networkVolumes)
        ? management.networkVolumes.slice(0, 200)
        : [],
      archivedNetworkVolumes: Array.isArray(management.archivedNetworkVolumes)
        ? management.archivedNetworkVolumes.slice(0, 200)
        : [],
      unmanagedProviderPods: Array.isArray(management.unmanagedProviderPods)
        ? management.unmanagedProviderPods.slice(0, 200)
        : [],
      providerTemplateCount: finiteNumber(management.providerTemplateCount, 0) || 0,
      gpuOptions: Array.isArray(management.gpuOptions) ? management.gpuOptions.slice(0, 500) : [],
      errors: management.errors && typeof management.errors === 'object' ? management.errors : {},
    },
    summary: {
      gpuCount: gpus.length,
      availableGpuCount: gpus.filter((gpu) => gpu.availability !== 'NONE' && gpu.availability !== 'UNKNOWN').length,
      cpuCount: cpus.length,
      dataCenterCount: dataCenters.length,
      regionCount: regions.length,
      templateCount: templates.length,
      billingTotal: billingTotals.total,
    },
  };
}

function singleQueryValue(value) {
  return typeof value === 'string' ? value.trim() : null;
}

function parseDashboardQuery(query = {}) {
  const errors = [];
  const unknownFields = Object.keys(query).filter((key) => !ALLOWED_QUERY_FIELDS.has(key));
  if (unknownFields.length) {
    errors.push('The request contains unsupported query fields.');
  }

  const rawBucketSize = query.bucketSize === undefined
    ? DEFAULT_FILTERS.bucketSize
    : singleQueryValue(query.bucketSize);
  const rawLastN = query.lastN === undefined
    ? String(DEFAULT_FILTERS.lastN)
    : singleQueryValue(query.lastN);
  const rawRefresh = query.refresh === undefined ? '0' : singleQueryValue(query.refresh);
  const rawNotice = query.notice === undefined ? '' : singleQueryValue(query.notice);

  if (!BILLING_BUCKET_SIZES.includes(rawBucketSize)) {
    errors.push('Choose a valid billing bucket size.');
  }
  if (!rawLastN || !/^\d{1,3}$/u.test(rawLastN)) {
    errors.push(`Billing bucket count must be an integer from 1 to ${MAX_BILLING_BUCKETS}.`);
  }
  const lastN = Number(rawLastN);
  if (Number.isSafeInteger(lastN) && (lastN < 1 || lastN > MAX_BILLING_BUCKETS)) {
    errors.push(`Billing bucket count must be an integer from 1 to ${MAX_BILLING_BUCKETS}.`);
  }
  if (!['0', '1'].includes(rawRefresh)) {
    errors.push('Refresh must be either 0 or 1.');
  }
  if (rawNotice && !Object.hasOwn(NOTICE_MESSAGES, rawNotice)) {
    errors.push('The status message is not recognized.');
  }

  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors)),
    filters: {
      bucketSize: BILLING_BUCKET_SIZES.includes(rawBucketSize)
        ? rawBucketSize
        : DEFAULT_FILTERS.bucketSize,
      lastN: Number.isSafeInteger(lastN) && lastN >= 1 && lastN <= MAX_BILLING_BUCKETS
        ? lastN
        : DEFAULT_FILTERS.lastN,
      forceRefresh: rawRefresh === '1',
      notice: rawNotice && Object.hasOwn(NOTICE_MESSAGES, rawNotice) ? rawNotice : '',
    },
  };
}

function renderPage(res, model, { status = 200, pageError = null } = {}) {
  return res
    .status(status)
    .set('Cache-Control', PRIVATE_NO_STORE)
    .render('admin_runpod', {
      ...model,
      pageError,
    });
}

function createRunpodAdminController({
  runpodService = defaultRunpodService,
  manager = runpodPodManager,
  billingHistoryService = runpodBillingHistoryService,
  appLogger = logger,
} = {}) {
  return {
    async index(req, res) {
      const parsedQuery = parseDashboardQuery(req.query || {});
      if (!parsedQuery.valid) {
        return renderPage(
          res,
          buildPageModel({}, parsedQuery.filters),
          {
            status: 400,
            pageError: parsedQuery.errors.join(' '),
          }
        );
      }

      try {
        const [dashboard, management, storedHistory] = await Promise.all([
          runpodService.getDashboard({
            bucketSize: parsedQuery.filters.bucketSize,
            lastN: parsedQuery.filters.lastN,
            forceRefresh: parsedQuery.filters.forceRefresh,
          }),
          manager.getAdminState(),
          billingHistoryService.getStoredHistory().catch((error) => {
            appLogger.warning('Stored Runpod billing history could not be loaded', {
              category: 'runpod_billing',
              metadata: {
                errorCode: safeString(error?.code, 80) || 'RUNPOD_BILLING_HISTORY_UNAVAILABLE',
                errorName: safeString(error?.name, 80) || 'Error',
              },
            });
            return {
              error: {
                code: safeString(error?.code, 80) || 'RUNPOD_BILLING_HISTORY_UNAVAILABLE',
              },
            };
          }),
        ]);
        const model = buildPageModel(dashboard, parsedQuery.filters, management, storedHistory);
        if (model.errorSections.length) {
          appLogger.warning('Runpod admin dashboard loaded with provider failures', {
            category: 'runpod_api_v2',
            metadata: {
              failedSections: model.errorSections.map((entry) => entry.section),
              errorCodes: model.errorSections.map((entry) => entry.code),
              providerStatuses: model.errorSections.map((entry) => entry.status).filter(Number.isFinite),
            },
          });
        }
        const managementFailures = Object.entries(model.podManagement.errors || {});
        if (managementFailures.length) {
          appLogger.warning('Runpod pod management page loaded with partial failures', {
            category: 'runpod_management',
            metadata: {
              failedSections: managementFailures.map(([section]) => section),
              errorCodes: managementFailures.map(([, error]) => error.code),
              providerStatuses: managementFailures
                .map(([, error]) => error.status)
                .filter(Number.isFinite),
            },
          });
        }

        const allSectionsFailed = model.errorSections.length === Object.keys(SECTION_LABELS).length;
        return renderPage(res, model, {
          status: allSectionsFailed ? 502 : 200,
          pageError: allSectionsFailed ? 'Runpod data is temporarily unavailable.' : null,
        });
      } catch (error) {
        const configurationFailure = error instanceof RunpodConfigurationError
          || error?.code === 'RUNPOD_NOT_CONFIGURED';
        appLogger[configurationFailure ? 'error' : 'warning'](
          configurationFailure
            ? 'Runpod API v2 integration is not configured'
            : 'Runpod admin dashboard request failed',
          {
            category: 'runpod_api_v2',
            metadata: {
              errorCode: safeString(error?.code, 80) || 'RUNPOD_API_ERROR',
              errorName: safeString(error?.name, 80) || 'Error',
            },
          }
        );

        return renderPage(
          res,
          buildPageModel({}, parsedQuery.filters),
          {
            status: configurationFailure ? 503 : 502,
            pageError: configurationFailure
              ? 'Runpod is not configured on this server. Add RUNPOD_API_KEY and try again.'
              : 'Runpod data is temporarily unavailable.',
          }
        );
      }
    },
  };
}

const controller = createRunpodAdminController();

module.exports = {
  ...controller,
  DEFAULT_FILTERS,
  PRIVATE_NO_STORE,
  RUNPOD_ADMIN_PATH,
  SECTION_LABELS,
  NOTICE_MESSAGES,
  buildPageModel,
  createRunpodAdminController,
  mapBillingAmounts,
  mapManagementPod,
  mapStoredBillingHistory,
  parseDashboardQuery,
};
