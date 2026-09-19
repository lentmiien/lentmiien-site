const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { createRequire } = require('module');
const { JSDOM } = createRequire(__filename)('jsdom');

const HumanToolRequest = require('../../models/human_tool_request');
const PendingRequests = require('../../models/pending_requests');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);
const pageTemplate = pug.compileFile(projectFile('views', 'admin_ask_lennart.pug'));

function renderPage(overrides = {}) {
  return pageTemplate({
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

describe('pending request Markdown in the browser', () => {
  let dom;
  let win;
  let prompt;
  const clientSource = fs.readFileSync(projectFile('public/js/ask_lennart.js'), 'utf8');
  const markdownSource = fs.readFileSync(projectFile('node_modules/marked/lib/marked.umd.js'), 'utf8');
  const sanitizerSource = fs.readFileSync(projectFile('node_modules/dompurify/dist/purify.min.js'), 'utf8');

  function setup(source, overrides = {}) {
    dom = new JSDOM(renderPage({
      pendingRequests: [{ _id: 'synthetic-request', toolName: 'ask_lennart', prompt: source }],
      recentRequests: [{ _id: 'synthetic-history', toolName: 'ask_lennart', prompt: '**Past prompt**', response: '*Past response*', status: 'responded' }],
      ...overrides,
    }), { url: 'https://example.test/admin/ask-lennart', runScripts: 'outside-only', pretendToBeVisual: true });
    win = dom.window;
    win.setInterval = jest.fn(() => 42);
    win.clearInterval = jest.fn();
    win.eval(markdownSource);
    win.eval(sanitizerSource);
    prompt = win.document.querySelector('[data-pending-prompt]');
  }

  afterEach(() => dom?.window.close());

  test('formats initial prompts, preserves history/forms, and loads dependencies before the client', () => {
    setup('# Review\n\nFirst **bold** and *emphasized* paragraph.\n\nSecond paragraph.\n\n- One\n- Two\n\n3. Three\n4. Four\n\n> A quotation\n\n[Codex](/codex/turns/example) and [Reference](https://example.org/guide)\n\n```js\nconst sample = "<script>inert()</script>";\n```');
    const history = win.document.querySelector('.ask-lennart-history').outerHTML;
    const form = win.document.querySelector('form.ask-lennart-response-form').outerHTML;
    const scripts = [...win.document.querySelectorAll('script[src]')].map(script => script.getAttribute('src'));
    expect(scripts.slice(-3)).toEqual([
      '/vendor/dompurify/purify.min.js',
      'https://cdn.jsdelivr.net/npm/marked@18.0.6/lib/marked.umd.js',
      '/js/ask_lennart.js',
    ]);
    expect(prompt.tagName).toBe('DIV');
    expect(prompt.querySelector('h1')).toBeNull();
    win.eval(clientSource);
    expect(prompt.querySelector('h1').textContent).toBe('Review');
    expect(prompt.querySelectorAll('p').length).toBeGreaterThanOrEqual(4);
    expect(prompt.querySelector('strong').textContent).toBe('bold');
    expect(prompt.querySelector('em').textContent).toBe('emphasized');
    expect(prompt.querySelectorAll('ul > li')).toHaveLength(2);
    expect(prompt.querySelector('ol').start).toBe(3);
    expect(prompt.querySelector('blockquote p').textContent).toBe('A quotation');
    expect(prompt.querySelector('pre code').textContent).toBe('const sample = "<script>inert()</script>";\n');
    expect(prompt.querySelector('pre').tabIndex).toBe(0);
    expect(prompt.querySelector('pre').getAttribute('aria-label')).toBe('Code block');
    const links = prompt.querySelectorAll('a');
    expect(links[0].getAttribute('href')).toBe('/codex/turns/example');
    expect(links[0].hasAttribute('target')).toBe(false);
    expect(links[1].target).toBe('_blank');
    expect(links[1].rel).toBe('noopener noreferrer nofollow');
    expect(win.document.querySelector('.ask-lennart-history').outerHTML).toBe(history);
    expect(win.document.querySelector('form.ask-lennart-response-form').outerHTML).toBe(form);
  });

  test('removes active HTML, embedded resources, events, styles and DOM-clobbering attributes', () => {
    setup('<script>steal()</script>\n\n<img src="/admin/action" onerror="steal()"><iframe src="https://example.org"></iframe><svg onload="steal()"></svg><object data="/admin/action"></object><style>body { display: none }</style><form action="/admin/action"><input name="response"></form>\n\n<p id="request-synthetic-request" name="location" style="position:fixed" onclick="steal()" data-pending-prompt="" aria-label="spoof">Readable <strong>text</strong></p>\n\n![Tracker](https://example.org/track.png)\n\n<a href="/codex" target="_blank" rel="opener" ping="/admin/action" onclick="steal()">Safe destination</a>');
    expect(prompt.querySelector('*')).toBeNull();
    win.eval(clientSource);
    expect(prompt.querySelector('script, img, iframe, svg, object, style, form, input')).toBeNull();
    expect(prompt.querySelector('[id], [name], [style], [onclick], [onerror], [onload], [ping], [data-pending-prompt], [aria-label]')).toBeNull();
    expect(prompt.querySelector('strong').textContent).toBe('text');
    expect(prompt.querySelector('a').getAttribute('target')).toBeNull();
    expect(prompt.querySelector('a').rel).toBe('noopener noreferrer nofollow');
  });

  test.each([
    'javascript:alert(1)', 'jav&#x61;script:alert(1)', 'java&#10;script:alert(1)',
    'data:text/html,unsafe', 'vbscript:msgbox(1)', 'file:///tmp/example',
    '//example.org/path', '/\\example.org/path', '/&#10;/example.org/path',
    'https://user:password@example.org/path', 'https:\\example.org/path',
    'mailto:example@example.org',
  ])('rejects an unsafe/non-allowlisted HTML link: %s', href => {
    setup(`<a href="${href}">Link text</a>`);
    win.eval(clientSource);
    const link = prompt.querySelector('a');
    expect(link.textContent).toBe('Link text');
    expect(link.hasAttribute('href')).toBe(false);
    expect(link.hasAttribute('target')).toBe(false);
  });

  test('sanitizes Markdown-generated unsafe links too', () => {
    setup('[Unsafe](javascript:alert%281%29) and [Protocol relative](//example.org)');
    win.eval(clientSource);
    expect(prompt.querySelectorAll('a')).toHaveLength(2);
    expect(prompt.querySelector('a[href]')).toBeNull();
  });

  test.each(['marked', 'DOMPurify', 'parse failure', 'sanitize failure'])('falls back to escaped source when %s is unavailable', failure => {
    const source = '**Review**\n\n<img src=x onerror=steal()>';
    setup(source);
    if (failure === 'parse failure') win.marked = { parse: () => { throw new Error('Synthetic failure'); } };
    else if (failure === 'sanitize failure') win.DOMPurify.sanitize = () => { throw new Error('Synthetic failure'); };
    else delete win[failure];
    win.eval(clientSource);
    expect(prompt.textContent).toBe(source);
    expect(prompt.querySelector('*')).toBeNull();
    expect(win.setInterval).toHaveBeenCalledWith(expect.any(Function), 30000);
  });

  test('renders independently of refresh settings and on a refreshed page', () => {
    setup('**First load**', { autoRefreshMs: 1000 });
    win.eval(clientSource);
    expect(prompt.querySelector('strong').textContent).toBe('First load');
    expect(win.setInterval).not.toHaveBeenCalled();
    dom.window.close();
    setup('**Newly pending request after refresh**');
    win.eval(clientSource);
    expect(prompt.querySelector('strong').textContent).toBe('Newly pending request after refresh');
    // Drafts/focus continue to suppress the existing reload, and the timer is cleaned up.
    const refresh = win.setInterval.mock.calls[0][0];
    const input = win.document.querySelector('[data-human-response-input]');
    input.focus();
    refresh();
    input.value = 'Synthetic draft';
    input.dispatchEvent(new win.Event('input'));
    input.blur();
    refresh();
    expect(input.value).toBe('Synthetic draft');
    win.dispatchEvent(new win.Event('beforeunload'));
    expect(win.clearInterval).toHaveBeenCalledWith(42);
  });
});
