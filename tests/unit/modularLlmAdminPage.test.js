const fs = require('fs');
const path = require('path');
const pug = require('pug');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);

function renderDashboard(overrides = {}) {
  return pug.renderFile(projectFile('views', 'admin_modular_llm.pug'), {
    pageTitle: 'Modular LLM - Admin',
    adminBase: '/admin/ai-gateway/modular-llm',
    documentationPath: '/admin/ai-gateway/documentation/modular-llm-gateway-usage.md',
    servicePrefix: '/modular-llm',
    live: {
      errors: {},
      baseUrl: 'http://gateway.test:8080',
      fetchedAtDisplay: '8/28/2026, 9:00:00 AM',
      serviceName: 'modular-llm',
      serviceStatusDisplay: 'Suspended',
      containerStateDisplay: 'Created',
      running: false,
      bundleId: 'qwen3-poc-v0.1',
      runtimeModeDisplay: 'Isolated Stage Workers',
      health: { ok: true },
      bundle: { description: 'Proof-of-concept bundle' },
      modelStages: [{
        stage: 'interpreter',
        stageDisplay: 'Interpreter',
        modelId: 'Qwen/Qwen3-0.6B',
        revision: 'revision-a',
        dtype: 'bf16',
        attention: 'sdpa',
        adapterPath: '',
        tokenLimitsDisplay: '8,192 input · 512 new',
      }],
      schemas: [{ name: 'cir-0.1', path: '/modular-llm/schemas/cir-0.1', title: 'CIR' }],
      gatewayRuns: [{
        runId: 'run-gateway-1',
        status: 'failed',
        statusDisplay: 'Failed',
        kindDisplay: 'Pipeline',
        failed_stage: 'interpreter',
        durationDisplay: '9.0 s',
        createdAtDisplay: '8/28/2026, 9:00:00 AM',
        detailPath: '/admin/ai-gateway/modular-llm/gateway-runs/run-gateway-1',
      }],
    },
    profiles: [{
      id: '507f1f77bcf86cd799439011',
      displayName: 'Interpreter canary',
      stageDisplay: 'Interpreter',
      stage: 'interpreter',
      modelId: 'Qwen/Qwen3-0.6B',
      bundleId: 'qwen3-poc-v0.1',
      dtype: 'bf16',
      tokenLimitsDisplay: '8,192 input · 512 new',
      useCasesText: 'CIR generation',
      notes: 'Track schema validity.',
      enabledForTesting: true,
      available: true,
      lastSeenDisplay: '8/28/2026, 9:00:00 AM',
      gatewayConfig: { model_id: 'Qwen/Qwen3-0.6B' },
    }],
    localRuns: [{
      id: 'local-run-1',
      status: 'succeeded',
      statusDisplay: 'Succeeded',
      inputPreview: 'Explain why 17 is prime.',
      gatewayRunId: 'run-gateway-2',
      durationDisplay: '22.5 s',
      createdAtDisplay: '8/28/2026, 9:00:00 AM',
      detailPath: '/admin/ai-gateway/modular-llm/runs/local-run-1',
    }],
    feedback: null,
    databaseError: null,
    modelProfileCollection: 'modular_llm_model_profiles',
    testRunCollection: 'modular_llm_test_runs',
    maxTestInputLength: 20000,
    loggedIn: true,
    admin: true,
    permissions: [],
    htmlPaths: [],
    bookmarks: [],
    currentPath: '/admin/ai-gateway/modular-llm',
    ...overrides,
  });
}

describe('Modular LLM admin UI', () => {
  test('renders live state, catalog management, pipeline testing, and both histories', () => {
    const html = renderDashboard();

    expect(html).toContain('Read-only monitor');
    expect(html).toContain('Stopped until GPU work');
    expect(html).toContain('action="/admin/ai-gateway/modular-llm/runs"');
    expect(html).toContain('name="maxRepairAttempts"');
    expect(html).toContain('Persist Gateway run');
    expect(html).toContain('action="/admin/ai-gateway/modular-llm/models/sync"');
    expect(html).toContain('Interpreter canary');
    expect(html).toContain('modular_llm_model_profiles');
    expect(html).toContain('modular_llm_test_runs');
    expect(html).toContain('href="/admin/ai-gateway/modular-llm/runs/local-run-1"');
    expect(html).toContain('href="/admin/ai-gateway/modular-llm/gateway-runs/run-gateway-1"');
    expect(html).toContain('Not exposed by Gateway');
    expect(html).toContain('<script src="/js/modularLlmAdmin.js" defer></script>');
  });

  test('registers the authenticated admin routes and navigation entry', () => {
    const routeSource = fs.readFileSync(projectFile('routes', 'admin.js'), 'utf8');
    const appSource = fs.readFileSync(projectFile('app.js'), 'utf8');
    const layoutSource = fs.readFileSync(projectFile('views', 'layout.pug'), 'utf8');
    const gatewayViewSource = fs.readFileSync(projectFile('views', 'admin_ai_gateway.pug'), 'utf8');

    expect(routeSource).toContain(
      "router.get('/ai-gateway/modular-llm', modularLlmAdminController.index);",
    );
    expect(routeSource).toContain(
      "router.post('/ai-gateway/modular-llm/runs', modularLlmAdminController.createRun);",
    );
    expect(routeSource).toContain(
      "router.get('/ai-gateway/modular-llm/gateway-runs/:runId', modularLlmAdminController.showGatewayRun);",
    );
    expect(appSource).toContain("app.use('/admin', isAuthenticated, isAdmin, adminRouter);");
    expect(layoutSource).toContain(
      "+navLink('/admin/ai-gateway/modular-llm', 'Modular LLM', 'secondary')",
    );
    expect(gatewayViewSource).toContain("href='/admin/ai-gateway/modular-llm'");
  });

  test('uses a no-reload fetch flow for long-running tests and read-only monitoring', () => {
    const clientSource = fs.readFileSync(
      projectFile('public', 'js', 'modularLlmAdmin.js'),
      'utf8',
    );

    expect(clientSource).toContain("Accept: 'application/json'");
    expect(clientSource).toContain('window.location.assign(payload.detailUrl)');
    expect(clientSource).toContain('window.setInterval(refreshRuntimeState, 10000)');
    expect(clientSource).toContain("cache: 'no-store'");
  });

  test('renders escaped run input, output, diagnostics, and Gateway correlation', () => {
    const html = pug.renderFile(projectFile('views', 'admin_modular_llm_run.pug'), {
      pageTitle: 'Modular LLM test local-run-1',
      adminBase: '/admin/ai-gateway/modular-llm',
      documentationPath: '/admin/ai-gateway/documentation/modular-llm-gateway-usage.md',
      errorMessage: null,
      run: {
        title: 'Admin test local-run-1',
        source: 'local',
        id: 'local-run-1',
        status: 'failed',
        statusDisplay: 'Failed',
        operationDisplay: 'Pipeline',
        bundleId: 'qwen3-poc-v0.1',
        durationDisplay: '9.0 s',
        httpStatusDisplay: 502,
        startedAtDisplay: '8/28/2026, 9:00:00 AM',
        completedAtDisplay: '8/28/2026, 9:00:09 AM',
        requestedByDisplay: 'admin-user',
        gatewayRunId: 'run-gateway-1',
        gatewayDetailPath: '/admin/ai-gateway/modular-llm/gateway-runs/run-gateway-1',
        input: '<script>unsafe()</script>',
        output: '',
        failedStage: 'interpreter',
        errorMessage: 'CIR validation failed.',
        errorJson: '{"schema":"cir-0.1"}',
        diagnosticsJson: '{"interpreter":{"ok":false}}',
        rawJson: '{"run_id":"run-gateway-1"}',
      },
      loggedIn: true,
      admin: true,
      permissions: [],
      htmlPaths: [],
      bookmarks: [],
      currentPath: '/admin/ai-gateway/modular-llm/runs/local-run-1',
    });

    expect(html).toContain('CIR validation failed.');
    expect(html).toContain('Stage interpreter');
    expect(html).toContain('href="/admin/ai-gateway/modular-llm/gateway-runs/run-gateway-1"');
    expect(html).toContain('&lt;script&gt;unsafe()&lt;/script&gt;');
    expect(html).not.toContain('<script>unsafe()</script>');
    expect(html).toContain('{&quot;interpreter&quot;:{&quot;ok&quot;:false}}');
  });

  test('declares distinct MongoDB collections for model profiles and test history', () => {
    const profileModel = require('../../models/modular_llm_model_profile');
    const runModel = require('../../models/modular_llm_test_run');

    expect(profileModel.collection.name).toBe('modular_llm_model_profiles');
    expect(runModel.collection.name).toBe('modular_llm_test_runs');
    expect(profileModel.schema.path('useCases')).toBeDefined();
    expect(profileModel.schema.path('adapterPath')).toBeDefined();
    expect(runModel.schema.path('gatewayRunId')).toBeDefined();
    expect(runModel.schema.path('response')).toBeDefined();
  });
});
