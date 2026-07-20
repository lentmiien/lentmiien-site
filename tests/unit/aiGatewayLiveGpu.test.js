const fs = require('fs');
const path = require('path');
const pug = require('pug');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);

describe('AI gateway live GPU graph', () => {
  test('labels the GPU pressure graph as a one-second live view', () => {
    const html = pug.renderFile(projectFile('views', 'admin_ai_gateway.pug'), {
      dashboard: {
        errors: {},
        logs: [],
        logInsights: {},
        chartData: {},
        autoStop: null,
        containers: [],
        containerSummary: {},
        checkpoints: [],
        baseUrl: 'http://gateway.test',
        fetchedAt: '2026-07-20T00:00:00.000Z',
        summaryCards: [],
        health: {},
        limits: null,
        requests: { totals: {}, routes: [] },
        durations: [],
        gpu: {},
        waiters: {},
      },
      loggedIn: true,
      admin: true,
      permissions: [],
      htmlPaths: [],
      bookmarks: [],
    });

    expect(html).toContain('id="gpuTimelineChart"');
    expect(html).toContain('refreshed every second');
    expect(html).toContain('<script src="/js/aiGateway.js" defer>');
  });

  test('polls a GPU-only endpoint without reloading the page', () => {
    const clientSource = fs.readFileSync(projectFile('public', 'js', 'aiGateway.js'), 'utf8');
    const pollingStart = clientSource.indexOf('const initGpuTimelinePolling');
    const pollingEnd = clientSource.indexOf('const safeRequestChart', pollingStart);
    const pollingSource = clientSource.slice(pollingStart, pollingEnd);

    expect(pollingStart).toBeGreaterThan(-1);
    expect(pollingEnd).toBeGreaterThan(pollingStart);
    expect(pollingSource).toContain("fetch('/admin/ai-gateway/gpu'");
    expect(pollingSource).toContain('const refreshIntervalMs = 1000;');
    expect(pollingSource).toContain('requestInFlight');
    expect(pollingSource).toContain('renderChart();');
    expect(pollingSource).not.toContain('location.reload');
  });

  test('registers a no-cache GPU snapshot endpoint', () => {
    const routeSource = fs.readFileSync(projectFile('routes', 'admin.js'), 'utf8');
    const controllerSource = fs.readFileSync(projectFile('controllers', 'admincontroller.js'), 'utf8');
    const handlerStart = controllerSource.indexOf('exports.ai_gateway_gpu =');
    const handlerEnd = controllerSource.indexOf('async function fetchAiGatewayContainerState', handlerStart);
    const handlerSource = controllerSource.slice(handlerStart, handlerEnd);

    expect(routeSource).toContain("router.get('/ai-gateway/gpu', controller.ai_gateway_gpu);");
    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handlerSource).toContain('AI_GATEWAY_ENDPOINTS.gpu');
    expect(handlerSource).toContain(".set('Cache-Control', 'no-store')");
    expect(handlerSource).toContain('gpuTimeline: buildGpuTimeline(response.data)');
  });
});
