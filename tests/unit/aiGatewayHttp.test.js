const fs = require('fs');
const path = require('path');
const { isAiGatewayDashboardStatusAccepted } = require('../../utils/aiGatewayHttp');

describe('AI gateway dashboard response status handling', () => {
  test.each([
    ['health', 200],
    ['health', 204],
    ['metricsText', 200],
  ])('accepts successful %s responses with status %i', (endpointKey, status) => {
    expect(isAiGatewayDashboardStatusAccepted(endpointKey, status)).toBe(true);
  });

  test('accepts a 503 health response so its degraded service data can be rendered', () => {
    expect(isAiGatewayDashboardStatusAccepted('health', 503)).toBe(true);
  });

  test.each([
    ['health', 500],
    ['health', 404],
    ['metricsText', 503],
    ['containers', 503],
  ])('rejects unexpected %s responses with status %i', (endpointKey, status) => {
    expect(isAiGatewayDashboardStatusAccepted(endpointKey, status)).toBe(false);
  });

  test('applies the endpoint-specific status rule to dashboard requests', () => {
    const controllerSource = fs.readFileSync(
      path.join(process.cwd(), 'controllers', 'admincontroller.js'),
      'utf8',
    );
    const handlerStart = controllerSource.indexOf('exports.ai_gateway_dashboard =');
    const handlerEnd = controllerSource.indexOf('exports.ai_gateway_gpu =', handlerStart);
    const handlerSource = controllerSource.slice(handlerStart, handlerEnd);

    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    expect(handlerSource).toContain(
      'validateStatus: (status) => isAiGatewayDashboardStatusAccepted(endpoint.key, status)',
    );
  });
});
