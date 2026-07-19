const path = require('path');
const pug = require('pug');
const router = require('../../routes/lego_sculpture_converter');
const {
  getLayerPlanRect,
  MAX_VOXEL_CELLS,
} = require('../../public/js/lego-sculpture-converter');

const pageLocals = {
  pageTitle: 'Brickify 3D — GLB-aware LEGO Sculpture Converter',
  bodyClass: 'lego-converter-page',
  contentContainerClass: 'lego-converter-container',
  hideLayoutFooterSpacer: true,
  loggedIn: false,
  permissions: [],
  htmlPaths: [],
  bookmarks: [],
};

describe('Lego sculpture converter page', () => {
  test('renders the converter in the application layout from its GET route', () => {
    const layer = router.stack.find((entry) => entry.route?.path === '/');
    const res = { render: jest.fn() };

    expect(layer.route.methods.get).toBe(true);
    layer.route.stack[0].handle({}, res);

    expect(res.render).toHaveBeenCalledWith('lego_sculpture_converter', {
      pageTitle: pageLocals.pageTitle,
      bodyClass: pageLocals.bodyClass,
      contentContainerClass: pageLocals.contentContainerClass,
      hideLayoutFooterSpacer: true,
    });
  });

  test('loads the navbar and external converter assets while preserving the controls', () => {
    const html = pug.renderFile(
      path.join(process.cwd(), 'views/lego_sculpture_converter.pug'),
      pageLocals
    );

    expect(html).toContain('<link rel="stylesheet" href="/css/color-theme.css">');
    expect(html).toContain('<link rel="stylesheet" href="/css/nav.css">');
    expect(html).toContain('<link rel="stylesheet" href="/css/lego-sculpture-converter.css">');
    expect(html).toContain('id="navbar"');
    expect(html).toContain('class="navbar-icon"');
    expect(html).toContain('<script src="/js/nav.js" defer>');
    expect(html).toContain('<script src="/js/lego-sculpture-converter-loader.js"></script>');
    expect(html).toContain('<script src="/js/lego-sculpture-converter.js"></script>');
    expect(html).toContain('id="fileInput"');
    expect(html).toContain('id="resolution" type="range" min="10" max="128"');
    expect(html).toContain('id="generateBtn"');
    expect(html).toContain('id="glCanvas"');
    expect(html).toContain('id="planCanvas"');
    expect(html).toContain('Generate connected sculpture');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('style=');
  });

  test('uses the higher cell ceiling for large sculptures', () => {
    expect(MAX_VOXEL_CELLS).toBe(2000000);
  });

  test('mirrors the plan horizontally to show layers from above', () => {
    const grid = { nx: 12, nz: 8 };
    const leftBrick = getLayerPlanRect(grid, { x: 1, z: 2, w: 2, d: 3 });
    const rightBrick = getLayerPlanRect(grid, { x: 9, z: 2, w: 2, d: 3 });

    expect(leftBrick).toEqual({ x: 9, y: 3, width: 2, height: 3 });
    expect(rightBrick).toEqual({ x: 1, y: 3, width: 2, height: 3 });
  });
});
