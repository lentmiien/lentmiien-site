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
      dataCenters: [{ id: 'EU-SE-1', name: 'EU-SE-1', region: 'EUROPE' }],
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
        defaultAutoStopMinutes: 60,
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
      }],
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

  test('escapes provider-controlled text in every displayed catalog context', () => {
    const payload = '<script>window.runpodInjected=true</script>';
    const html = renderPage({
      gpus: [{ id: payload, name: payload, availability: 'HIGH' }],
      cpus: [{ id: payload, name: payload, availability: 'LOW' }],
      dataCenters: [{ id: payload, name: payload, region: payload }],
      templates: [{ id: payload, name: payload, image: payload }],
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
