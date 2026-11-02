jest.mock('fs/promises', () => ({ readFile: jest.fn() }));
jest.mock('../../utils/logger', () => ({ error: jest.fn(), warning: jest.fn() }));

const fs = require('fs/promises');
const path = require('path');
const pug = require('pug');
const controller = require('../../controllers/yamlcontroller');
const logger = require('../../utils/logger');

beforeEach(() => {
  fs.readFile.mockResolvedValue('openapi: 3.0.0\ninfo:\n  title: Example\n  version: 1.0.0\npaths: {}');
});

test('Swagger includes shared navigation while retaining its viewer assets', async () => {
  const res = {
    render: (view, callback) => callback(null, pug.renderFile(path.join(__dirname, '../../views', `${view}.pug`), {
      loggedIn: false,
    })),
    send: jest.fn(),
  };
  const next = jest.fn();
  await controller.renderSwagger({ params: { filename: 'example.yaml' } }, res, next);
  expect(next).not.toHaveBeenCalled();
  const html = res.send.mock.calls[0][0];
  expect(html.match(/class="account-topbar"/g)).toHaveLength(1);
  expect(html).toContain('/css/color-theme.css');
  expect(html).toContain('/css/nav.css');
  expect(html).toContain('/js/nav.js');
  expect(html).toContain('name="viewport"');
  expect(html).toContain('id="swagger-ui"');
  expect(html).toContain('swagger-ui-init.js');
});

test('a failed navigation render follows the existing logged error path', async () => {
  const error = new Error('Template failed');
  const res = { render: (_, callback) => callback(error), send: jest.fn() };
  const next = jest.fn();
  await controller.renderSwagger({ params: { filename: 'example.yaml' } }, res, next);
  expect(res.send).not.toHaveBeenCalled();
  expect(next).toHaveBeenCalledWith(error);
  expect(logger.error).toHaveBeenCalledWith('Failed to render Swagger UI', expect.objectContaining({ category: 'yaml-viewer' }));
});
