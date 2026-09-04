const fs = require('fs');
const path = require('path');
const pug = require('pug');

const HumanToolRequest = require('../../models/human_tool_request');
const PendingRequests = require('../../models/pending_requests');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);

function renderPage(overrides = {}) {
  return pug.renderFile(projectFile('views', 'admin_ask_lennart.pug'), {
    pageTitle: 'Ask Lennart Requests',
    pendingRequests: [],
    recentRequests: [],
    feedback: null,
    maxResponseChars: 20000,
    autoRefreshMs: 30000,
    csrfToken: 'csrf-safe-token',
    loggedIn: true,
    admin: true,
    permissions: [],
    htmlPaths: [],
    bookmarks: [],
    currentPath: '/admin/ask-lennart',
    ...overrides,
  });
}

describe('Ask Lennart admin page', () => {
  test('renders escaped private requests, response forms, CSRF, and durable history', () => {
    const html = renderPage({
      pendingRequests: [{
        _id: 'd9428888-122b-4e1b-9bc0-3df042f22d44',
        variant: 'codex',
        toolName: 'ask_lennart_for_codex',
        prompt: '<script>steal()</script>\nDeploy the app.',
        conversationId: 'conversation-1',
        createdAt: new Date('2026-09-05T00:00:00.000Z'),
      }],
      recentRequests: [{
        _id: 'cd2910cc-3bd8-432c-90a4-b3bc3f5947a0',
        variant: 'general',
        toolName: 'ask_lennart',
        prompt: 'What happened?',
        response: '<img src=x onerror=steal()> All done.',
        status: 'responded',
        respondedAt: new Date('2026-09-05T01:00:00.000Z'),
      }],
    });

    expect(html).toContain('Ask Lennart');
    expect(html).toContain('including after an app restart');
    expect(html).toContain('name="_csrf" value="csrf-safe-token"');
    expect(html).toContain('action="/admin/ask-lennart/d9428888-122b-4e1b-9bc0-3df042f22d44/respond"');
    expect(html).toContain('&lt;script&gt;steal()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=steal()&gt; All done.');
    expect(html).not.toContain('<script>steal()</script>');
    expect(html).not.toContain('<img src=x onerror=steal()>');
    expect(html).toContain('/css/ask_lennart.css');
    expect(html).toContain('/js/ask_lennart.js');
  });

  test('mounts a dedicated authenticated capability router before the legacy admin router', () => {
    const appSource = fs.readFileSync(projectFile('app.js'), 'utf8');
    const routeSource = fs.readFileSync(projectFile('routes', 'askLennartAdmin.js'), 'utf8');
    const dedicatedMount = "app.use('/admin/ask-lennart', isAuthenticated, askLennartAdminRouter);";
    const legacyMount = "app.use('/admin', isAuthenticated, isAdmin, adminRouter);";

    expect(appSource).toContain(dedicatedMount);
    expect(appSource.indexOf(dedicatedMount)).toBeLessThan(appSource.indexOf(legacyMount));
    expect(routeSource).toContain('requireHumanRequestManagement');
    expect(routeSource).toContain('csrf.requireToken');
    expect(routeSource).toContain('requireBoundedForm');
    expect(routeSource).toContain("router.post(\n  '/:requestId/respond'");
  });

  test('declares bounded private records and the non-recoverable human-wait state', () => {
    expect(HumanToolRequest.collection.name).toBe('human_tool_requests');
    expect(HumanToolRequest.schema.path('prompt').options.maxlength).toBe(20000);
    expect(HumanToolRequest.schema.path('response').options.maxlength).toBe(20000);
    expect(HumanToolRequest.schema.path('status').options.enum).toEqual([
      'pending',
      'responded',
      'timed_out',
    ]);
    expect(HumanToolRequest.schema.indexes()).toContainEqual([
      { deleteAfter: 1 },
      expect.objectContaining({ expireAfterSeconds: 0 }),
    ]);
    expect(PendingRequests.schema.path('recoveryState').options.enum).toContain('tool_wait');
  });

  test('protects every Tool Manager mutation with the shared CSRF middleware', () => {
    const routeSource = fs.readFileSync(projectFile('routes', 'admin.js'), 'utf8');
    const viewSource = fs.readFileSync(projectFile('views', 'admin_tool_manager.pug'), 'utf8');
    const scriptSource = fs.readFileSync(projectFile('public', 'js', 'tool_manager.js'), 'utf8');

    expect(routeSource).toContain("router.use('/tools', toolManagerCsrf.issueToken);");
    expect(routeSource.match(/toolManagerCsrf\.requireToken/g)).toHaveLength(5);
    expect(viewSource).toContain("name='_csrf', value=csrfToken");
    expect(scriptSource).toContain("'X-CSRF-Token': pageConfig.csrfToken || ''");
  });
});
