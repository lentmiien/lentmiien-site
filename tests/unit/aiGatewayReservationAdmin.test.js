const fs = require('fs');
const path = require('path');
const pug = require('pug');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);

function renderDashboard(overrides = {}) {
  return pug.renderFile(projectFile('views', 'admin_ai_gateway.pug'), {
    dashboard: {
      errors: {},
      logs: [],
      logInsights: {},
      chartData: {},
      autoStop: null,
      containers: [],
      containerSummary: {},
      reservation: null,
      checkpoints: [],
      baseUrl: 'http://gateway.test',
      fetchedAt: '2026-08-05T00:00:00.000Z',
      summaryCards: [],
      health: {},
      limits: null,
      requests: { totals: {}, routes: [] },
      durations: [],
      gpu: {},
      waiters: {},
      ...overrides,
    },
    loggedIn: true,
    admin: true,
    permissions: [],
    htmlPaths: [],
    bookmarks: [],
  });
}

describe('AI Gateway GPU reservation admin controls', () => {
  test('renders controls using only containers marked as GPU-reservable', () => {
    const html = renderDashboard({
      reservation: {
        active: false,
        statusDisplay: 'Not reserved',
        phaseDisplay: 'Idle',
        defaultIdleTimeoutSec: 900,
        blockedQueueDepth: 0,
      },
      containers: [
        {
          id: 'ollama',
          name: 'ollama',
          label: 'Ollama',
          gpuReservable: true,
          gpuRoleDisplay: 'Heavy',
          running: false,
          meta: [],
        },
        {
          id: 'voicevox',
          name: 'voicevox-engine',
          label: 'VoiceVox',
          gpuReservable: false,
          gpuRoleDisplay: 'None',
          running: true,
          meta: [],
        },
      ],
    });

    expect(html).toContain('id="reservationControls"');
    expect(html).toContain('id="reservationService"');
    expect(html).toContain('<option value="ollama">Ollama · Heavy</option>');
    expect(html).not.toContain('<option value="voicevox">');
    expect(html).toContain('id="reservationIdleTimeout"');
    expect(html).toContain('value="900"');
    expect(html).toContain('Wait until the service is ready');
    expect(html).toContain('id="reservationReserve"');
    expect(html).toMatch(/id="reservationRelease"[^>]*disabled/);
  });

  test('renders an active release failure with its owner and recovery warning', () => {
    const html = renderDashboard({
      reservation: {
        active: true,
        statusDisplay: 'Reserved',
        service: 'ollama',
        serviceLabel: 'Ollama',
        phase: 'release_failed',
        phaseDisplay: 'Release Failed',
        idleTimeoutSec: 900,
        remainingDisplay: '14m 30s',
        expiresAtDisplay: '8/5/2026, 12:00:00 PM',
        lastActivityAtDisplay: '8/5/2026, 11:45:00 AM',
        containerStateDisplay: 'Running',
        blockedQueueDepth: 2,
        lastError: 'VRAM reclaim failed',
      },
      containers: [{
        id: 'ollama',
        name: 'ollama',
        label: 'Ollama',
        gpuReservable: true,
        gpuRoleDisplay: 'Heavy',
        running: true,
        meta: [],
      }],
    });

    expect(html).toContain('reservation-controls__badge--error');
    expect(html).toContain('Attention');
    expect(html).toContain('id="reservationOwner">Ollama');
    expect(html).toContain('id="reservationPhase">Release Failed');
    expect(html).toContain('id="reservationError"');
    expect(html).toContain('VRAM reclaim failed');
    expect(html).toMatch(/id="reservationReserve"[^>]*disabled/);
    expect(html).not.toMatch(/id="reservationRelease"[^>]*disabled/);
  });

  test('wires authenticated proxy routes and browser interactions', () => {
    const routeSource = fs.readFileSync(projectFile('routes', 'admin.js'), 'utf8');
    const controllerSource = fs.readFileSync(projectFile('controllers', 'admincontroller.js'), 'utf8');
    const clientSource = fs.readFileSync(projectFile('public', 'js', 'aiGateway.js'), 'utf8');
    const createStart = controllerSource.indexOf('exports.ai_gateway_reservation_create =');
    const createEnd = controllerSource.indexOf('exports.ai_gateway_reservation_release =', createStart);
    const releaseEnd = controllerSource.indexOf('function buildGatewayContainerActionBody', createEnd);
    const createSource = controllerSource.slice(createStart, createEnd);
    const releaseSource = controllerSource.slice(createEnd, releaseEnd);

    expect(routeSource).toContain("router.get('/ai-gateway/reservation', controller.ai_gateway_reservation);");
    expect(routeSource).toContain("router.post('/ai-gateway/reservation', controller.ai_gateway_reservation_create);");
    expect(routeSource).toContain("router.delete('/ai-gateway/reservation', controller.ai_gateway_reservation_release);");
    expect(controllerSource).toContain("{ key: 'reservation', path: AI_GATEWAY_ENDPOINTS.reservation }");
    expect(createSource).toContain('axios.post(');
    expect(createSource).toContain('headers: buildAiGatewayAdminHeaders()');
    expect(releaseSource).toContain('axios.delete(');
    expect(releaseSource).toContain('headers: buildAiGatewayAdminHeaders()');
    expect(clientSource).toContain("fetch('/admin/ai-gateway/reservation'");
    expect(clientSource).toContain("method: 'POST'");
    expect(clientSource).toContain("method: 'DELETE'");
    expect(clientSource).toContain('This will stop ${owner}');
    expect(clientSource).not.toContain('LLM_ADMIN_TOKEN');
  });
});
