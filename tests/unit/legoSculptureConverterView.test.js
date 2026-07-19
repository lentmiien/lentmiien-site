const path = require('path');
const pug = require('pug');
const router = require('../../routes/lego_sculpture_converter');

describe('Lego sculpture converter page', () => {
  test('renders the standalone converter from its GET route', () => {
    const layer = router.stack.find((entry) => entry.route?.path === '/');
    const res = { render: jest.fn() };

    expect(layer.route.methods.get).toBe(true);
    layer.route.stack[0].handle({}, res);

    expect(res.render).toHaveBeenCalledWith('lego_sculpture_converter', {
      pageTitle: 'Brickify 3D — GLB-aware LEGO Sculpture Converter',
    });
  });

  test('loads external theme, page CSS, and JavaScript while preserving the converter controls', () => {
    const html = pug.renderFile(path.join(process.cwd(), 'views/lego_sculpture_converter.pug'), {
      pageTitle: 'Brickify 3D — GLB-aware LEGO Sculpture Converter',
    });

    expect(html).toContain('<link rel="stylesheet" href="/css/color-theme.css">');
    expect(html).toContain('<link rel="stylesheet" href="/css/lego-sculpture-converter.css">');
    expect(html).toContain('<script src="/js/lego-sculpture-converter-loader.js"></script>');
    expect(html).toContain('<script src="/js/lego-sculpture-converter.js"></script>');
    expect(html).toContain('id="fileInput"');
    expect(html).toContain('id="generateBtn"');
    expect(html).toContain('id="glCanvas"');
    expect(html).toContain('id="planCanvas"');
    expect(html).toContain('Generate connected sculpture');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('style=');
  });
});
