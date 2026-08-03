const fs = require('fs');
const path = require('path');
const pug = require('pug');
const {
  buildDocumentationLinks,
  renderDocumentationMarkdown,
} = require('../../services/aiGatewayDocumentationService');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);

function renderPage(overrides = {}) {
  return pug.renderFile(projectFile('views', 'admin_ai_gateway_documentation.pug'), {
    pageTitle: 'AI Gateway Documentation',
    files: [],
    selectedDoc: null,
    errorMessage: null,
    isDetail: false,
    gatewayBaseUrl: 'http://192.168.0.20:8080',
    loggedIn: true,
    admin: true,
    permissions: [],
    htmlPaths: [],
    bookmarks: [],
    currentPath: '/admin/ai-gateway/documentation',
    ...overrides,
  });
}

describe('AI Gateway documentation admin page', () => {
  test('renders a landing page from the available Gateway filenames', () => {
    const html = renderPage({
      files: [
        {
          name: 'ai-gateway.md',
          href: '/admin/ai-gateway/documentation/ai-gateway.md',
        },
        {
          name: 'voicevox-gateway-usage.md',
          href: '/admin/ai-gateway/documentation/voicevox-gateway-usage.md',
        },
      ],
    });

    expect(html).toContain('Available files');
    expect(html).toContain('2 files');
    expect(html).toContain('href="/admin/ai-gateway/documentation/ai-gateway.md"');
    expect(html).toContain('voicevox-gateway-usage.md');
    expect(html).not.toContain('Copy Markdown');
  });

  test('renders safe HTML, raw Markdown, and all four copy actions on a detail page', () => {
    const rawContent = '# Gateway guide\n\n<script>alert("unsafe")</script>';
    const links = buildDocumentationLinks({
      fileName: 'ai-gateway.md',
      gatewayBaseUrl: 'http://192.168.0.20:8080',
      publicAppBaseUrl: 'https://my.lentmiien.com',
    });
    const html = renderPage({
      pageTitle: 'Gateway guide - AI Gateway Documentation',
      isDetail: true,
      selectedDoc: {
        name: 'ai-gateway.md',
        title: 'Gateway guide',
        rawContent,
        contentHtml: renderDocumentationMarkdown(rawContent),
        links,
      },
    });

    expect(html).toContain('Copy Markdown');
    expect(html.match(/data-copy-button/g)).toHaveLength(4);
    expect(html).toContain('http://127.0.0.1:8080/documentation/ai-gateway.md');
    expect(html).toContain('http://192.168.0.20:8080/documentation/ai-gateway.md');
    expect(html).toContain('https://my.lentmiien.com/admin/ai-gateway/documentation/ai-gateway.md');
    expect(html).toContain('&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert("unsafe")</script>');
    expect(html).toContain('<script src="/js/ai-gateway-documentation.js" defer></script>');
  });

  test('registers the pages inside the authenticated admin router', () => {
    const routeSource = fs.readFileSync(projectFile('routes', 'admin.js'), 'utf8');
    const appSource = fs.readFileSync(projectFile('app.js'), 'utf8');
    const layoutSource = fs.readFileSync(projectFile('views', 'layout.pug'), 'utf8');

    expect(routeSource).toContain(
      "router.get('/ai-gateway/documentation', aiGatewayDocumentationAdminController.index);",
    );
    expect(routeSource).toContain(
      "router.get('/ai-gateway/documentation/:filename', aiGatewayDocumentationAdminController.show);",
    );
    expect(appSource).toContain("app.use('/admin', isAuthenticated, isAdmin, adminRouter);");
    expect(layoutSource).toContain(
      "+navLink('/admin/ai-gateway/documentation', 'Gateway documentation', 'secondary')",
    );
  });
});
