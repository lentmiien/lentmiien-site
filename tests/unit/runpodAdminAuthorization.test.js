const fs = require('fs');
const path = require('path');
const { createRequireCapabilities, PRIVATE_NO_STORE } = require('../../middleware/requireCapabilities');
const { hasCapabilities } = require('../../utils/authorization');
const {
  RUNPOD_READ_CAPABILITIES,
  RUNPOD_ROLE_CAPABILITY_BUNDLES,
} = require('../../utils/runpodAuthorizationPolicy');

function roleModel({ userPermissions = [], groupPermissions = [] } = {}) {
  return {
    findOne: jest.fn(({ type }) => Promise.resolve({
      permissions: type === 'user' ? userPermissions : groupPermissions,
    })),
  };
}

function response() {
  return {
    status: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    render: jest.fn().mockReturnThis(),
  };
}

describe('Runpod semantic capability policy', () => {
  test('assigns every Runpod read capability to admin through the explicit bundle', async () => {
    const model = roleModel();

    await expect(hasCapabilities(
      { name: 'admin-user', type_user: 'admin' },
      RUNPOD_READ_CAPABILITIES,
      { roleModel: model, roleCapabilityBundles: RUNPOD_ROLE_CAPABILITY_BUNDLES }
    )).resolves.toBe(true);
    expect(model.findOne).not.toHaveBeenCalled();
  });

  test.each(['family', 'user', 'other'])(
    'denies the %s role when no capabilities were explicitly granted',
    async (typeUser) => {
      const model = roleModel();
      await expect(hasCapabilities(
        { name: `${typeUser}-account`, type_user: typeUser },
        RUNPOD_READ_CAPABILITIES,
        { roleModel: model, roleCapabilityBundles: RUNPOD_ROLE_CAPABILITY_BUNDLES }
      )).resolves.toBe(false);
    }
  );

  test('accepts an individually granted authenticated user', async () => {
    const model = roleModel({ userPermissions: RUNPOD_READ_CAPABILITIES });

    await expect(hasCapabilities(
      { name: 'operations-user', type_user: 'user' },
      RUNPOD_READ_CAPABILITIES,
      { roleModel: model, roleCapabilityBundles: RUNPOD_ROLE_CAPABILITY_BUNDLES }
    )).resolves.toBe(true);
    expect(model.findOne).toHaveBeenCalledWith({ name: 'operations-user', type: 'user' });
    expect(model.findOne).toHaveBeenCalledWith({ name: 'user', type: 'group' });
  });

  test('denies a principal missing any required read authority', async () => {
    const model = roleModel({ userPermissions: ['runpod.catalog.read'] });

    await expect(hasCapabilities(
      { name: 'catalog-only', type_user: 'user' },
      RUNPOD_READ_CAPABILITIES,
      { roleModel: model, roleCapabilityBundles: RUNPOD_ROLE_CAPABILITY_BUNDLES }
    )).resolves.toBe(false);
  });
});

describe('createRequireCapabilities', () => {
  test('fails closed with a private 403 response', async () => {
    const user = { name: 'ordinary-user', type_user: 'user' };
    const middleware = createRequireCapabilities({
      capabilities: RUNPOD_READ_CAPABILITIES,
      roleModel: roleModel(),
      roleCapabilityBundles: RUNPOD_ROLE_CAPABILITY_BUNDLES,
      logger: { error: jest.fn() },
    });
    const res = response();
    const next = jest.fn();

    await middleware({ user }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', PRIVATE_NO_STORE);
    expect(res.render).toHaveBeenCalledWith('accessDenied', {
      title: 'Access Denied',
      message: 'You do not have permission to access this page.',
      user,
    });
  });

  test('continues only after every capability is verified', async () => {
    const middleware = createRequireCapabilities({
      capabilities: RUNPOD_READ_CAPABILITIES,
      roleModel: roleModel(),
      roleCapabilityBundles: RUNPOD_ROLE_CAPABILITY_BUNDLES,
      logger: { error: jest.fn() },
    });
    const next = jest.fn();

    await middleware({ user: { name: 'admin-user', type_user: 'admin' } }, response(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  test('logs an actionable error and returns 503 when grants cannot be loaded', async () => {
    const logger = { error: jest.fn() };
    const middleware = createRequireCapabilities({
      capabilities: RUNPOD_READ_CAPABILITIES,
      roleModel: {
        findOne: jest.fn().mockRejectedValue(new Error('database host and credentials')),
      },
      roleCapabilityBundles: RUNPOD_ROLE_CAPABILITY_BUNDLES,
      logger,
    });
    const user = { name: 'explicit-user', type_user: 'user' };
    const res = response();

    await middleware({ user }, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith('Cache-Control', PRIVATE_NO_STORE);
    expect(logger.error).toHaveBeenCalledWith(
      'Capability authorization lookup failed',
      {
        category: 'authorization',
        metadata: { capabilityCount: RUNPOD_READ_CAPABILITIES.length, errorName: 'Error' },
      }
    );
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('database host and credentials');
  });
});

describe('Runpod route wiring', () => {
  const appSource = fs.readFileSync(path.join(process.cwd(), 'app.js'), 'utf8');
  const routeSource = fs.readFileSync(path.join(process.cwd(), 'routes', 'runpodAdmin.js'), 'utf8');

  test('requires authentication and the admin bundle before the dedicated capability router', () => {
    expect(appSource).toContain("app.use('/admin/runpod', isAuthenticated, isAdmin, runpodAdminRouter);");
    expect(appSource.indexOf("app.use('/admin/runpod', isAuthenticated, isAdmin, runpodAdminRouter);"))
      .toBeLessThan(appSource.indexOf("app.use('/admin', isAuthenticated, isAdmin, adminRouter);"));
  });

  test('exposes read and CSRF-protected capability-scoped Pod mutations', () => {
    expect(routeSource).toContain("router.get('/', runpodReadLimiter, runpodAdminController.index);");
    expect(routeSource).toContain("'/templates/ollama'");
    expect(routeSource).toContain("'/pods'");
    expect(routeSource).toContain("'/pods/:id/start'");
    expect(routeSource).toContain("'/pods/:id/stop'");
    expect(routeSource).toContain("'/pods/:id/extend'");
    expect(routeSource).toContain("'/pods/:id/delete'");
    expect(routeSource).toContain("'/billing/sync'");
    expect(routeSource).toContain('csrf.requireToken');
    expect(routeSource).toContain('requireBoundedRunpodForm');
    expect(routeSource).toContain('requireCapability(RUNPOD_CAPABILITIES.podCreate)');
    expect(routeSource).toContain('requireCapability(RUNPOD_CAPABILITIES.podExtend)');
    expect(routeSource).toContain('requireCapability(RUNPOD_CAPABILITIES.podDelete)');
    expect(routeSource).toContain('requireCapability(RUNPOD_CAPABILITIES.billingSync)');
    expect(routeSource).not.toMatch(/router\.(?:put|patch|delete)\s*\(/u);
    expect(routeSource).toContain('RUNPOD_READ_CAPABILITIES');
  });
});
