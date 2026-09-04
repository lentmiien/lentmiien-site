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

  test('grants turn steering to normal authenticated roles but not unknown roles', () => {
    const capability = CODEX_CAPABILITIES.turnSteer;

    expect(CODEX_ROLE_CAPABILITY_BUNDLES.admin).toContain(capability);
    expect(CODEX_ROLE_CAPABILITY_BUNDLES.family).toContain(capability);
    expect(CODEX_ROLE_CAPABILITY_BUNDLES.user).toContain(capability);
    expect(CODEX_ROLE_CAPABILITY_BUNDLES.other).not.toContain(capability);
  });

  test.each(['turnRead', 'turnCancel', 'turnRetry'])(
    'grants %s only to recognized authenticated role bundles',
    (capabilityKey) => {
      const capability = CODEX_CAPABILITIES[capabilityKey];

      expect(CODEX_ROLE_CAPABILITY_BUNDLES.admin).toContain(capability);
      expect(CODEX_ROLE_CAPABILITY_BUNDLES.family).toContain(capability);
      expect(CODEX_ROLE_CAPABILITY_BUNDLES.user).toContain(capability);
      expect(CODEX_ROLE_CAPABILITY_BUNDLES.other).not.toContain(capability);
    }
  );

  test('keeps the log-review service identity owner-scoped and unable to run paid infrastructure', () => {
    expect(CODEX_ROLE_CAPABILITY_BUNDLES.codex_system).toEqual(expect.arrayContaining([
      CODEX_CAPABILITIES.turnRead,
      CODEX_CAPABILITIES.turnRetry,
      CODEX_CAPABILITIES.turnSteer,
    ]));
    expect(CODEX_ROLE_CAPABILITY_BUNDLES.codex_system)
      .not.toContain(CODEX_CAPABILITIES.runpodModelRun);
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
    expect(routeSource).toContain("router.post('/api/turns/:turnId/messages', additionalMessageLimiter, csrf.requireToken");
  });

  test('marks authenticated Codex responses private and non-cacheable', () => {
    expect(routeSource).toContain("res.set('Cache-Control', PRIVATE_NO_STORE)");
  });
});
