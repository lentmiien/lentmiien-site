const fs = require('fs');
const path = require('path');
const pug = require('pug');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);

function renderPage(overrides = {}) {
  return pug.renderFile(projectFile('views', 'admin_qwen3_lora.pug'), {
    pageTitle: 'Qwen3 QLoRA - Admin',
    apiBase: 'http://192.168.0.20:8080',
    servicePrefix: '/qwen3-qlora',
    defaultTrainingParams: {
      num_train_epochs: 1,
      learning_rate: 0.0002,
      per_device_train_batch_size: 1,
      gradient_accumulation_steps: 16,
      max_seq_length: 512,
      lora_r: 16,
      lora_alpha: 32,
      lora_dropout: 0.05,
      seed: 42,
    },
    maxCompareTargets: 4,
    maxUploadMb: 200,
    trainingGroups: [],
    toolName: 'Qwen3 QLoRA',
    toolDescription: 'Train 4-bit QLoRA adapters.',
    adminBase: '/admin/qwen3-qlora',
    trainingGroupBase: '/admin/qwen3-qlora/training-groups',
    trainingGroupManagePath: '/admin/qwen3-lora/training-groups',
    documentationPath: '/admin/ai-gateway/documentation/qwen3-qlora-gateway-usage.md',
    supportsContainerActions: false,
    supportsThinking: true,
    supportsGpuReservation: true,
    reservationContainerId: 'qwen3_qlora',
    runtimeNotice: 'The Gateway starts this heavy service on demand.',
    modelActionLabel: 'Download / verify model',
    modelActionHelp: 'An empty cache takes at least about 58 minutes.',
    loggedIn: true,
    admin: true,
    permissions: [],
    htmlPaths: [],
    bookmarks: [],
    currentPath: '/admin/qwen3-qlora',
    ...overrides,
  });
}

describe('Qwen3 QLoRA admin page', () => {
  test('renders QLoRA-safe defaults and testing controls without manual lifecycle actions', () => {
    const html = renderPage();

    expect(html).toContain('Qwen3 QLoRA');
    expect(html).toContain('Prefix: /qwen3-qlora');
    expect(html).toContain('value="16"');
    expect(html).toContain('value="512"');
    expect(html).toContain('max 200MB');
    expect(html).toContain('id="generateEnableThinking"');
    expect(html).toContain('id="compareEnableThinking"');
    expect(html).toContain('id="gpuReserveBtn"');
    expect(html).toContain('id="gpuReleaseBtn"');
    expect(html).toContain('Download / verify model');
    expect(html).toContain('href="/admin/qwen3-training-guide"');
    expect(html).toContain('Training guide');
    expect(html).toContain('qwen3-qlora-gateway-usage.md');
    expect(html).not.toContain('id="containerStartBtn"');
    expect(html).not.toContain('id="containerStopBtn"');
  });

  test('publishes the QLoRA route profile to the shared browser client', () => {
    const html = renderPage();

    expect(html).toContain('"adminBase":"/admin/qwen3-qlora"');
    expect(html).toContain('"supportsThinking":true');
    expect(html).toContain('"reservationContainerId":"qwen3_qlora"');
    expect(html).toContain('<script src="/js/qwen3_lora_admin.js" defer></script>');
  });

  test('registers the tool inside the authenticated admin router and navigation', () => {
    const routeSource = fs.readFileSync(projectFile('routes', 'admin.js'), 'utf8');
    const appSource = fs.readFileSync(projectFile('app.js'), 'utf8');
    const layoutSource = fs.readFileSync(projectFile('views', 'layout.pug'), 'utf8');

    expect(routeSource).toContain("router.get('/qwen3-qlora', qwen3QloraAdminController.render);");
    expect(routeSource).toContain("router.post('/qwen3-qlora/train/jobs', qwen3QloraAdminController.createTrainingJob);");
    expect(routeSource).toContain("router.post('/qwen3-qlora/generate', qwen3QloraAdminController.generate);");
    expect(routeSource).toContain("router.delete('/qwen3-qlora/reservation', qwen3QloraAdminController.releaseReservation);");
    expect(appSource).toContain("app.use('/admin', isAuthenticated, isAdmin, adminRouter);");
    expect(layoutSource).toContain("+navLink('/admin/qwen3-qlora', 'Qwen3 QLoRA')");
  });
});
