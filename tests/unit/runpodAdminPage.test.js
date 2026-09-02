const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { buildPageModel, DEFAULT_FILTERS } = require('../../controllers/runpodAdminController');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);

function renderPage(dashboard = {}, management = {}, storedHistory = {}) {
  const model = buildPageModel({
    apiVersion: 'v2',
    fetchedAt: '2026-09-01T00:00:00.000Z',
    gpus: [],
    cpus: [],
    dataCenters: [],
    templates: [],
    billing: {
      records: [],
      metadata: { query: {}, totals: {} },
    },
    errors: {},
    ...dashboard,
  }, DEFAULT_FILTERS, management, storedHistory);

  return pug.renderFile(projectFile('views', 'admin_runpod.pug'), {
    ...model,
    pageError: null,
    loggedIn: true,
    admin: true,
    permissions: [],
    bookmarks: [],
    currentPath: '/admin/runpod',
    csrfToken: 'csrf-test-token',
  });
}

describe('Runpod admin page', () => {
  test('offers a focused two-model library and guarded GLM quick launch when verified', () => {
    const html = renderPage({}, {
      limits: {
        maxActivePods: 2,
        maxGpuCount: 16,
        maxHourlyCostUsd: 100,
        defaultAutoStopMinutes: 60,
        maxRuntimeMinutes: 1440,
      },
      gateway: {
        readyForLargeModel: true,
        gatewayUrl: 'https://llm.lentmiien.com/',
      },
      templates: [],
      modelArtifactPresets: [{
        slug: 'glm-5-3-flash-ud-iq4-xs',
        name: 'GLM-5.3-Flash · UD-IQ4_XS',
        totalBytes: 156822111075,
        recommendedVolumeGb: 250,
        recommendedVramGb: 192,
        defaultContextTokens: 16384,
        sourceRevision: '2975ab414d30340466d8c51533c6e91f0cca64c1',
        runtimeRevision: '949f7efb097eb20ef36fecdb1afaebff9a4ae7ed',
      }],
      modelArtifacts: [{
        id: '507f191e810c19729de860ad',
        slug: 'glm-5-3-flash-ud-iq4-xs',
        name: 'GLM-5.3-Flash · UD-IQ4_XS',
        providerNetworkVolumeId: 'glm-volume-id',
        dataCenterId: 'EU-RO-1',
        preparationStatus: 'ready',
        preparationStage: 'ready',
        runtimeRevision: '949f7efb097eb20ef36fecdb1afaebff9a4ae7ed',
      }],
      gpuOptions: [{
        id: 'NVIDIA RTX PRO 6000 Blackwell Server Edition',
        name: 'RTX PRO 6000',
        memoryGb: 96,
        securePrice: 2.09,
        secureAvailability: 'HIGH',
        secureMaxCount: 8,
        secureDataCenters: [{ id: 'EU-RO-1', availability: 'LOW' }],
        communityDataCenters: [],
      }],
      networkVolumes: [{
        id: '507f191e810c19729de860ab',
        providerNetworkVolumeId: 'glm-volume-id',
        name: 'glm-5-3-flash-ud-iq4-xs',
        providerPresent: true,
        trackedLocally: true,
        dataCenterId: 'EU-RO-1',
        volumeType: 'STANDARD',
        sizeGb: 250,
        attachedPodCount: 0,
        cachedModels: [],
      }],
      archivedNetworkVolumes: [],
      managedPods: [],
      archivedPods: [],
      modelArtifactPreparations: [],
      modelDownloads: [],
      unmanagedProviderPods: [],
      errors: {},
    });

    expect(html).toContain('id="model-library"');
    expect(html).toContain('Qwen3.8 · 27B');
    expect(html).toContain('method="post" action="/admin/runpod/model-artifacts/pods"');
    expect(html).toContain('name="artifactId" value="507f191e810c19729de860ad"');
    expect(html).toContain('2× RTX PRO 6000');
    expect(html).toContain('No Pod-local persistent disk is allocated');
    expect(html).toContain('name="billingAcknowledged"');
  });

  test('renders v2 catalog, billing, template, picker, and lifecycle controls', () => {
    const html = renderPage({
      gpus: [{
        id: 'NVIDIA H200',
        name: 'H200',
        manufacturer: 'NVIDIA',
        memory: 141,
        availability: 'HIGH',
        secure: true,
        price: { secure: 3.59 },
        maxCount: { secure: 8 },
      }],
      cpus: [{ id: 'cpu3c', name: 'Compute-Optimized', availability: 'HIGH' }],
      dataCenters: [{
        id: 'EU-SE-1',
        name: 'EU-SE-1',
        region: 'EUROPE',
        networkVolumeTypes: ['STANDARD'],
      }],
      templates: [{ id: 'runpod-torch', name: 'Runpod PyTorch', image: 'runpod/pytorch:v2' }],
      billing: {
        records: [{
          startTime: '2026-08-31T00:00:00Z',
          endTime: '2026-09-01T00:00:00Z',
          totalAmount: 12.5,
          podGpuAmount: 12.5,
        }],
        metadata: {
          query: {
            startTime: '2026-08-31T00:00:00Z',
            endTime: '2026-09-01T00:00:00Z',
            bucketSize: 'day',
          },
          totals: { totalAmount: 12.5, podGpuAmount: 12.5 },
        },
      },
    }, {
      limits: {
        maxActivePods: 2,
        maxGpuCount: 4,
        maxHourlyCostUsd: 10,
        maxNetworkVolumeGb: 2048,
        maxNetworkVolumeMonthlyCostUsd: 150,
        standardStorageUsdPerGbMonth: 0.07,
        highPerformanceStorageUsdPerGbMonth: null,
        defaultAutoStopMinutes: 60,
        defaultModelArtifactMaxHourlyCostUsd: 0.99,
        maxRuntimeMinutes: 1440,
      },
      templates: [{
        id: 'local-template-id',
        slug: 'ollama',
        name: 'Ollama GPU',
        providerTemplateName: 'lentmiien-ollama-gpu-v2',
        providerTemplateId: 'provider-template-id',
        providerPresent: true,
        active: true,
        image: 'ollama/ollama:latest',
        defaultModel: 'qwen2.5:0.5b',
        diskGb: 20,
        persistentDiskGb: 10,
        servicePort: 11434,
      }, {
        id: 'artifact-template-id',
        slug: 'glm53-artifact-preparer',
        name: 'GLM-5.3 Artifact Preparer',
        providerTemplateName: 'lentmiien-glm53-artifact-preparer-v2',
        providerTemplateId: 'provider-artifact-template-id',
        providerPresent: true,
        active: true,
        image: 'runpod/pytorch:1.0.2-cu1281-torch280-ubuntu2404',
        defaultModel: 'glm-5-3-flash-ud-iq4-xs',
        diskGb: 40,
        persistentDiskGb: 10,
        servicePort: 1,
      }],
      modelArtifactPresets: [{
        slug: 'glm-5-3-flash-ud-iq4-xs',
        name: 'GLM-5.3-Flash · UD-IQ4_XS',
        sourceRepository: 'unsloth/GLM-5.3-Flash-GGUF',
        sourceRevision: '2975ab414d30340466d8c51533c6e91f0cca64c1',
        variant: 'UD-IQ4_XS',
        runtimeRepository: 'unslothai/llama.cpp',
        runtimeRevision: '949f7efb097eb20ef36fecdb1afaebff9a4ae7ed',
        totalBytes: 156822111075,
        recommendedVolumeGb: 250,
        recommendedVramGb: 192,
        defaultContextTokens: 16384,
      }],
      modelArtifacts: [{
        slug: 'glm-5-3-flash-ud-iq4-xs',
        name: 'GLM-5.3-Flash · UD-IQ4_XS',
        providerNetworkVolumeId: 'provider-glm-volume-id',
        dataCenterId: 'EU-SE-1',
        totalBytes: 156822111075,
        runtimeRevision: '949f7efb097eb20ef36fecdb1afaebff9a4ae7ed',
        preparationStatus: 'failed',
        preparationStage: 'failed',
        preparationErrorCode: 'HF_DOWNLOAD_TIMEOUT',
        preparationLastObservedAt: '2026-09-01T00:45:00.000Z',
      }],
      modelArtifactPreparations: [],
      gpuOptions: [{
        id: 'NVIDIA GeForce RTX 4090',
        name: 'RTX 4090',
        memoryGb: 24,
        securePrice: 0.69,
        communityPrice: 0.34,
        secureAvailability: 'HIGH',
        communityAvailability: 'MEDIUM',
        secureMaxCount: 4,
        communityMaxCount: 2,
        secureDataCenters: [{ id: 'EU-SE-1' }],
        communityDataCenters: [],
      }],
      networkVolumes: [{
        id: '507f191e810c19729de860ab',
        providerNetworkVolumeId: 'provider-volume-id',
        name: 'qwen-cache',
        providerPresent: true,
        trackedLocally: true,
        dataCenterId: 'EU-SE-1',
        volumeType: 'STANDARD',
        sizeGb: 50,
        estimatedMonthlyCostUsd: 3.5,
        attachedPodCount: 0,
        cachedModels: ['qwen3.8:27b'],
      }, {
        id: '507f191e810c19729de860ac',
        providerNetworkVolumeId: 'provider-glm-volume-id',
        name: 'glm-5-3-flash-ud-iq4-xs',
        providerPresent: true,
        trackedLocally: true,
        dataCenterId: 'EU-SE-1',
        volumeType: 'STANDARD',
        sizeGb: 250,
        estimatedMonthlyCostUsd: 17.5,
        attachedPodCount: 0,
        cachedModels: [],
      }],
      archivedNetworkVolumes: [],
      managedPods: [{
        id: 'local-pod-id',
        name: 'ollama-test',
        providerPodId: 'provider-pod-id',
        providerStatus: 'RUNNING',
        gpuName: 'RTX 4090',
        gpuId: 'NVIDIA GeForce RTX 4090',
        gpuCount: 1,
        costPerHour: 0.69,
        setupStatus: 'ready',
        setupModel: 'qwen2.5:0.5b',
        publicUrl: 'https://provider-pod-id-11434.proxy.runpod.net',
        autoStopMinutes: 60,
        autoStopAt: '2026-09-01T02:00:00.000Z',
        canStart: false,
        canStop: true,
        canExtend: true,
        canDelete: true,
        lastOperationError: {
          action: 'start',
          code: 'RUNPOD_START_GPU_UNAVAILABLE',
          providerCode: 'ZERO_GPUS',
          providerStatus: 409,
          providerTitle: 'Original GPU unavailable',
          detail: '<img src=x onerror=window.providerInjected=true>',
          message: 'Wait and retry, or delete and redeploy.',
          occurredAt: '2026-09-01T00:30:00.000Z',
        },
      }, {
        id: 'stopped-local-pod-id',
        name: 'stopped-ollama',
        providerPodId: 'stopped-provider-pod-id',
        providerStatus: 'EXITED',
        gpuName: 'RTX 4090',
        gpuId: 'NVIDIA GeForce RTX 4090',
        gpuCount: 1,
        costPerHour: 0,
        setupStatus: 'ready',
        autoStopMinutes: 240,
        autoStopAt: null,
        canStart: true,
        canStop: false,
        canExtend: false,
        canDelete: true,
      }],
      archivedPods: [],
      unmanagedProviderPods: [],
      errors: {},
    });

    expect(html).toContain('<h1>Runpod API v2</h1>');
    expect(html).toContain('Step 2 is enabled for administrators.');
    expect(html).toContain('NVIDIA H200');
    expect(html).toContain('RTX 4090');
    expect(html).toContain('Compute-Optimized');
    expect(html).toContain('EU-SE-1');
    expect(html).toContain('Runpod PyTorch');
    expect(html).toContain('$12.50');
    expect(html).toContain('action="/admin/runpod"');
    expect(html).toContain('method="get"');
    expect(html).toContain('method="post" action="/admin/runpod/templates/ollama"');
    expect(html).toContain('method="post" action="/admin/runpod/network-volumes"');
    expect(html).toContain('method="post" action="/admin/runpod/model-downloads"');
    expect(html).toContain('method="post" action="/admin/runpod/model-artifacts/prepare"');
    expect(html).toContain('Verify and record GLM-5.3-Flash storage');
    expect(html).toContain('Prepared models');
    expect(html).toContain('Verify/resume and record');
    expect(html).toContain('Immutable source contract');
    expect(html).toContain('UD-IQ4_XS');
    expect(html).toContain('data-runpod-artifact-preparer-form');
    expect(html).toContain('name="presetSlug" value="glm-5-3-flash-ud-iq4-xs"');
    expect(html).toContain('provider-glm-volume-id');
    expect(html).toContain('HF_DOWNLOAD_TIMEOUT');
    expect(html).toContain('reuse completed shards and make a fresh bounded attempt');
    expect(html).not.toMatch(/name="(?:repository|downloadUrl|command|sha256|runtimeRevision)"/u);
    expect(html).toContain('Download an Ollama model to a volume');
    expect(html).toContain('Advanced downloader settings');
    expect(html).toContain('Automatic · cheapest compatible GPU');
    expect(html).toContain('Advanced placement, pricing, and disk settings');
    expect(html).toContain('data-datacenter="EU-SE-1"');
    expect(html).toContain('data-models="qwen3.8:27b"');
    expect(html).toContain('action="/admin/runpod/network-volumes/507f191e810c19729de860ab/delete"');
    expect(html).toContain('qwen-cache');
    expect(html).toContain('name="networkVolumeId"');
    expect(html).toContain('action="/admin/runpod/pods"');
    expect(html).toContain('action="/admin/runpod/pods/local-pod-id/stop"');
    expect(html).toContain('action="/admin/runpod/pods/local-pod-id/extend"');
    expect(html).toContain('action="/admin/runpod/pods/stopped-local-pod-id/start"');
    expect(html).toContain('action="/admin/runpod/pods/local-pod-id/delete"');
    expect(html).toContain('Start for…');
    expect(html).toContain('Extend automatic stop');
    expect(html).toContain('+30m');
    expect(html).toContain('+1h');
    expect(html).toContain('+4h');
    expect(html).toContain('Custom (minutes)');
    expect(html).toContain('data-runpod-countdown');
    expect(html).toContain('RUNPOD_START_GPU_UNAVAILABLE');
    expect(html).toContain('Original GPU unavailable');
    expect(html).not.toContain('<img src=x onerror=window.providerInjected=true>');
    expect(html).toContain('&lt;img src=x onerror=window.providerInjected=true&gt;');
    expect(html).toContain('name="_csrf" value="csrf-test-token"');
    expect(html).toContain('https://provider-pod-id-11434.proxy.runpod.net');
    expect(html).toContain('https://api.runpod.io/v2');
    expect(html).not.toContain('https://rest.runpod.io/v1');
  });

  test('prefers the stable Cloudflare Access profile without rendering credentials', () => {
    const html = renderPage({
      dataCenters: [{ id: 'EU-RO-1', name: 'EU-RO-1', region: 'EUROPE' }],
    }, {
      gateway: {
        gatewayUrl: 'https://llm.lentmiien.com/',
        originHostHeader: 'localhost:8080',
        serviceTokenConfigured: true,
        tunnelTokenConfigured: true,
        runpodSecretName: 'lentmiien_cloudflare_tunnel_token',
        llmApiKeyConfigured: true,
        llmApiSecretName: 'lentmiien_llm_api_key',
        readyForTemplate: true,
      },
      templates: [{
        id: 'gateway-template-id',
        slug: 'ollama-cloudflare',
        name: 'Ollama GPU · Cloudflare Access',
        providerTemplateName: 'lentmiien-ollama-cloudflare-v2',
        providerTemplateId: 'provider-gateway-template-id',
        providerPresent: true,
        setupKind: 'ollama_pull',
        accessMode: 'cloudflare_access',
        gatewayUrl: 'https://llm.lentmiien.com/',
        image: 'ollama/ollama:latest',
        defaultModel: 'qwen3.8:27b',
        diskGb: 20,
        persistentDiskGb: 10,
      }],
      gpuOptions: [{
        id: 'NVIDIA A40',
        name: 'A40',
        memoryGb: 48,
        securePrice: 0.5,
        secureAvailability: 'HIGH',
        secureMaxCount: 1,
        secureDataCenters: [{ id: 'EU-RO-1' }],
        communityDataCenters: [],
      }],
      networkVolumes: [],
      managedPods: [{
        id: 'gateway-pod-record',
        providerPodId: 'gateway-pod-provider',
        name: 'ollama-gateway',
        providerStatus: 'RUNNING',
        setupStatus: 'ready',
        setupModel: 'qwen3.8:27b',
        accessMode: 'cloudflare_access',
        publicUrl: 'https://llm.lentmiien.com/',
        gpuName: 'A40',
        gpuCount: 1,
      }],
    });

    expect(html).toContain('action="/admin/runpod/templates/ollama-cloudflare"');
    expect(html).toContain('Stable authenticated profile ready.');
    expect(html).toContain('name="templateId"');
    expect(html).toContain('data-access-mode="cloudflare_access"');
    expect(html).toContain('Stable authenticated Ollama URL');
    expect(html).toContain('https://llm.lentmiien.com/');
    expect(html).toContain('Cloudflare route HTTP Host Header');
    expect(html).toContain('localhost:8080');
    expect(html).toContain('lentmiien_cloudflare_tunnel_token');
    expect(html).toContain('lentmiien_llm_api_key');
    expect(html).not.toContain('access-client-secret-value');
    expect(html).not.toContain('tunnel-token-value');
  });

  test('escapes provider-controlled text in every displayed catalog context', () => {
    const payload = '<script>window.runpodInjected=true</script>';
    const html = renderPage({
      gpus: [{ id: payload, name: payload, availability: 'HIGH' }],
      cpus: [{ id: payload, name: payload, availability: 'LOW' }],
      dataCenters: [{ id: payload, name: payload, region: payload }],
      templates: [{ id: payload, name: payload, image: payload }],
    }, {
      networkVolumes: [{
        id: '507f191e810c19729de860ab',
        providerNetworkVolumeId: 'provider-volume-id',
        name: payload,
        providerPresent: true,
        trackedLocally: true,
        dataCenterId: 'EU-RO-1',
        volumeType: 'STANDARD',
        sizeGb: 50,
        attachedPodCount: 0,
        lastOperationError: { code: 'RUNPOD_HTTP_ERROR', detail: payload },
      }],
    });

    expect(html).not.toContain(payload);
    expect(html).not.toContain('window.runpodInjected=true</script>');
    expect(html).toContain('&lt;script&gt;window.runpodInjected=true&lt;/script&gt;');
  });

  test('shows an explicit empty billing state when the account has no records', () => {
    const html = renderPage();

    expect(html).toContain('No billed usage in this period');
    expect(html).toContain('Runpod returned no billing records for the selected window.');
  });

  test('renders durable monthly billing sources and Pod usage accounting', () => {
    const html = renderPage({}, {
      managedPods: [],
      archivedPods: [{
        id: 'archived-id',
        name: 'Historical Pod 1234',
        providerPodId: 'historical-pod-1234',
        providerStatus: 'TERMINATED',
        lifecycleGroup: 'archived',
        gpuName: 'Unknown (billing history)',
        gpuCount: 1,
        archivedAt: '2025-12-01T00:00:00Z',
        usage: { trackingAvailable: false },
        billing: {
          available: true,
          totalUsd: 1.25,
          computeUsd: 1,
          storageUsd: 0.25,
          syncedAt: '2026-09-15T00:00:00Z',
        },
      }],
    }, {
      periods: [{
        periodKey: '2025-11',
        startTime: '2025-11-01T00:00:00Z',
        source: 'provider',
        providerRecordPresent: true,
        finalized: true,
        amounts: { totalAmount: 1.25, podGpuAmount: 1, podDiskAmount: 0.25 },
        syncedAt: '2026-09-15T00:00:00Z',
      }, {
        periodKey: '2025-12',
        startTime: '2025-12-01T00:00:00Z',
        source: 'synthesized_zero',
        providerRecordPresent: false,
        finalized: true,
        amounts: {},
        syncedAt: '2026-09-15T00:00:00Z',
      }],
      totals: { totalAmount: 1.25, podGpuAmount: 1, podDiskAmount: 0.25 },
      providerMonthCount: 1,
      zeroMonthCount: 1,
      lastSyncedAt: '2026-09-15T00:00:00Z',
    });

    expect(html).toContain('Stored monthly billing');
    expect(html).toContain('Runpod v2');
    expect(html).toContain('Stored zero');
    expect(html).toContain('Not recorded');
    expect(html).toContain('method="post" action="/admin/runpod/billing/sync"');
    expect(html).toContain('$1.25');
  });

  test('uses server-side POST mutations with CSRF fields and no unescaped interpolation', () => {
    const viewSource = fs.readFileSync(projectFile('views', 'admin_runpod.pug'), 'utf8');

    expect(viewSource).toContain("form.runpod-filter(method='get'");
    expect(viewSource).toContain("form.runpod-form(method='post'");
    expect(viewSource).toContain("input(type='hidden', name='_csrf', value=csrfToken)");
    expect(viewSource).not.toMatch(/method=['"](?:put|patch|delete)['"]/iu);
    expect(viewSource).not.toContain('!=' + ' ');
    expect(viewSource).not.toContain('!{');
    expect(viewSource).not.toContain('fetch(');
  });

  test('links the page from admin navigation and uses the theme stylesheet', () => {
    const layoutSource = fs.readFileSync(projectFile('views', 'layout.pug'), 'utf8');
    const viewSource = fs.readFileSync(projectFile('views', 'admin_runpod.pug'), 'utf8');
    const cssSource = fs.readFileSync(projectFile('public', 'css', 'runpodAdmin.css'), 'utf8');

    expect(layoutSource).toContain("+navLink('/admin/runpod', 'Runpod API v2')");
    expect(viewSource).toContain("link(rel='stylesheet', href='/css/runpodAdmin.css')");
    expect(cssSource).toContain('var(--bg)');
    expect(cssSource).toContain('var(--surface-1)');
    expect(cssSource).toContain('var(--brand)');
    expect(cssSource).toContain('var(--accent)');
  });
});
