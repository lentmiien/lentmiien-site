const fs = require('fs');
const path = require('path');
const pug = require('pug');
const { buildPageModel, DEFAULT_FILTERS } = require('../../controllers/runpodAdminController');

const projectFile = (...segments) => path.join(process.cwd(), ...segments);

function renderPage(dashboard = {}) {
  const model = buildPageModel({
    apiVersion: 'v2',
    fetchedAt: '2026-09-01T00:00:00.000Z',
    gpus: [],
    cpus: [],
    dataCenters: [],
    templates: [],
    billing: {
      records: [],
      metadata: { query: {}, totals: {} },
    },
    errors: {},
    ...dashboard,
  }, DEFAULT_FILTERS);

  return pug.renderFile(projectFile('views', 'admin_runpod.pug'), {
    ...model,
    pageError: null,
    loggedIn: true,
    admin: true,
    permissions: [],
    bookmarks: [],
    currentPath: '/admin/runpod',
  });
}

describe('Runpod admin page', () => {
  test('renders catalog and billing output with v2 and read-only context', () => {
    const html = renderPage({
      gpus: [{
        id: 'NVIDIA H200',
        name: 'H200',
        manufacturer: 'NVIDIA',
        memory: 141,
        availability: 'HIGH',
        secure: true,
        price: { secure: 3.59 },
        maxCount: { secure: 8 },
      }],
      cpus: [{ id: 'cpu3c', name: 'Compute-Optimized', availability: 'HIGH' }],
      dataCenters: [{ id: 'EU-SE-1', name: 'EU-SE-1', region: 'EUROPE' }],
      templates: [{ id: 'runpod-torch', name: 'Runpod PyTorch', image: 'runpod/pytorch:v2' }],
      billing: {
        records: [{
          startTime: '2026-08-31T00:00:00Z',
          endTime: '2026-09-01T00:00:00Z',
          totalAmount: 12.5,
          podGpuAmount: 12.5,
        }],
        metadata: {
          query: {
            startTime: '2026-08-31T00:00:00Z',
            endTime: '2026-09-01T00:00:00Z',
            bucketSize: 'day',
          },
          totals: { totalAmount: 12.5, podGpuAmount: 12.5 },
        },
      },
    });

    expect(html).toContain('<h1>Runpod API v2</h1>');
    expect(html).toContain('Step 1 is read-only.');
    expect(html).toContain('NVIDIA H200');
    expect(html).toContain('Compute-Optimized');
    expect(html).toContain('EU-SE-1');
    expect(html).toContain('Runpod PyTorch');
    expect(html).toContain('$12.50');
    expect(html).toContain('action="/admin/runpod"');
    expect(html).toContain('method="get"');
    expect(html).toContain('https://api.runpod.io/v2');
    expect(html).not.toContain('https://rest.runpod.io/v1');
  });

  test('escapes provider-controlled text in every displayed catalog context', () => {
    const payload = '<script>window.runpodInjected=true</script>';
    const html = renderPage({
      gpus: [{ id: payload, name: payload, availability: 'HIGH' }],
      cpus: [{ id: payload, name: payload, availability: 'LOW' }],
      dataCenters: [{ id: payload, name: payload, region: payload }],
      templates: [{ id: payload, name: payload, image: payload }],
    });

    expect(html).not.toContain(payload);
    expect(html).not.toContain('window.runpodInjected=true</script>');
    expect(html).toContain('&lt;script&gt;window.runpodInjected=true&lt;/script&gt;');
  });

  test('shows an explicit empty billing state when the account has no records', () => {
    const html = renderPage();

    expect(html).toContain('No billed usage in this period');
    expect(html).toContain('Runpod returned no billing records for the selected window.');
  });

  test('contains no browser mutation or unescaped interpolation in the feature view', () => {
    const viewSource = fs.readFileSync(projectFile('views', 'admin_runpod.pug'), 'utf8');

    expect(viewSource).toContain("form.runpod-filter(method='get'");
    expect(viewSource).not.toMatch(/method=['"](?:post|put|patch|delete)['"]/iu);
    expect(viewSource).not.toContain('!=' + ' ');
    expect(viewSource).not.toContain('!{');
    expect(viewSource).not.toContain('fetch(');
  });

  test('links the page from admin navigation and uses the theme stylesheet', () => {
    const layoutSource = fs.readFileSync(projectFile('views', 'layout.pug'), 'utf8');
    const viewSource = fs.readFileSync(projectFile('views', 'admin_runpod.pug'), 'utf8');
    const cssSource = fs.readFileSync(projectFile('public', 'css', 'runpodAdmin.css'), 'utf8');

    expect(layoutSource).toContain("+navLink('/admin/runpod', 'Runpod API v2')");
    expect(layoutSource).toContain('hasPermission("runpod.catalog.read") && hasPermission("runpod.billing.read")');
    expect(viewSource).toContain("link(rel='stylesheet', href='/css/runpodAdmin.css')");
    expect(cssSource).toContain('var(--bg)');
    expect(cssSource).toContain('var(--surface-1)');
    expect(cssSource).toContain('var(--brand)');
    expect(cssSource).toContain('var(--accent)');
  });
});
