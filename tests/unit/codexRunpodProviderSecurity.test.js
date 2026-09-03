const fs = require('fs');
const path = require('path');

const {
  CODEX_CAPABILITIES,
  CODEX_ROLE_CAPABILITY_BUNDLES,
} = require('../../utils/codexAuthorizationPolicy');

describe('Codex Runpod provider security wiring', () => {
  const routeSource = fs.readFileSync(
    path.join(__dirname, '../../routes/codex.js'),
    'utf8'
  );
  const clientSource = fs.readFileSync(
    path.join(__dirname, '../../public/js/codex.js'),
    'utf8'
  );

  test('grants the cost-incurring provider capability only to admins by default', () => {
    const capability = CODEX_CAPABILITIES.runpodModelRun;

    expect(CODEX_ROLE_CAPABILITY_BUNDLES.admin).toContain(capability);
    expect(CODEX_ROLE_CAPABILITY_BUNDLES.family).not.toContain(capability);
    expect(CODEX_ROLE_CAPABILITY_BUNDLES.user).not.toContain(capability);
    expect(CODEX_ROLE_CAPABILITY_BUNDLES.other).not.toContain(capability);
  });

  test('requires CSRF validation for every Codex mutation and sends the token from the browser', () => {
    const mutationRoutes = routeSource
      .split('\n')
      .filter((line) => /router\.(?:post|patch|delete)\(/.test(line));

    expect(mutationRoutes.length).toBeGreaterThan(0);
    mutationRoutes.forEach((route) => {
      expect(route).toContain('csrf.requireToken');
    });
    expect(clientSource).toContain("'X-CSRF-Token': bootstrap.csrfToken");
  });

  test('marks authenticated Codex responses private and non-cacheable', () => {
    expect(routeSource).toContain("res.set('Cache-Control', PRIVATE_NO_STORE)");
  });
});
